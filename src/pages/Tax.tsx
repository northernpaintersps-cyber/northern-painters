import { useState, useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase, selectAll } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { fmtCurrency, invStatus, isCashJob, today } from '@/lib/utils'
import { reconcileBankStatement } from '@/lib/ai'
import {
  Printer, Loader2, FileSpreadsheet, Download, ReceiptText, LineChart,
  Landmark, Upload, X,
} from 'lucide-react'
import { useBusinessSettings } from '@/pages/SettingsPage'

type Row = Record<string, any>

function useTable(table: string) {
  const { user } = useAuth()
  return useQuery({
    queryKey: [table, user?.id],
    queryFn: async () => {
      const { data } = await selectAll(table, user!.id)
      return (data ?? []) as Row[]
    },
    enabled: !!user,
  })
}

// Calendar quarters, as V16 uses
const qRanges = (y: number, q: number): [string, string] => ([
  [`${y}-01-01`, `${y}-03-31`],
  [`${y}-04-01`, `${y}-06-30`],
  [`${y}-07-01`, `${y}-09-30`],
  [`${y}-10-01`, `${y}-12-31`],
] as [string, string][])[q - 1]

const inRange = (date: string | null, y: number, q: number) => {
  if (!date) return false
  const [s, e] = qRanges(y, q)
  return date >= s && date <= e
}
const inYear = (date: string | null, y: number) => !!date && date.startsWith(String(y))

// np_expenses has no has_gst / amount_inc_gst columns — derive them
const hasGST = (e: Row) => (e.gst || 0) > 0
const expIncGST = (e: Row) => (e.amount_ex_gst || 0) + (e.gst || 0)

type LineSpec = [string, string, string] | null

function StatementRows({ rows }: { rows: LineSpec[] }) {
  return (
    <>
      {rows.map((r, i) => {
        if (r === null) return <hr key={i} className="border-none border-t border-black/[0.08] my-2" />
        const [label, value, kind] = r
        if (kind === 'header') return (
          <div key={i} className="text-[11px] font-bold text-[#666] uppercase mt-3 mb-1">{label}</div>
        )
        if (kind === 'sub') return (
          <div key={i} className="flex justify-between py-1 pl-4 border-b border-black/[0.04]">
            <span className="text-xs text-[#666]">{label}</span>
            <span className="text-xs text-[#666]">{value}</span>
          </div>
        )
        const bold = kind === 'bold' || kind.startsWith('total')
        const color = kind === 'total-red' ? '#c0392b' : kind === 'total-green' ? '#0a7c4e' : undefined
        return (
          <div key={i} className="flex justify-between py-1.5 border-b border-black/[0.06]">
            <span className="text-[13px]" style={bold ? { fontWeight: 600 } : undefined}>{label}</span>
            <span className="text-[13px]" style={{ fontWeight: bold ? 700 : 500, color }}>{value}</span>
          </div>
        )
      })}
    </>
  )
}


// Minimal markdown -> HTML for the reconciliation result
function mdHTML(src: string): string {
  const e = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const out: string[] = []
  let inList = false
  for (const raw of e(src).split('\n')) {
    const line = raw
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code style="background:rgba(0,0,0,.06);padding:1px 4px;border-radius:3px">$1</code>')
    const li = line.match(/^\s*[-*\u2022]\s+(.*)$/)
    const h = line.match(/^(#{1,4})\s+(.*)$/)
    if (li) {
      if (!inList) { out.push('<ul style="margin:4px 0;padding-left:18px">'); inList = true }
      out.push(`<li style="margin:2px 0">${li[1]}</li>`)
      continue
    }
    if (inList) { out.push('</ul>'); inList = false }
    if (h) { out.push(`<div style="font-weight:700;margin:10px 0 4px">${h[2]}</div>`); continue }
    if (!line.trim()) { out.push('<div style="height:6px"></div>'); continue }
    out.push(`<div>${line}</div>`)
  }
  if (inList) out.push('</ul>')
  return out.join('')
}

function csvRow(vals: (string | number)[]) {
  return vals.map(v => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }).join(',')
}
function downloadCSV(name: string, rows: string[]) {
  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = name
  document.body.appendChild(a); a.click()
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url) }, 500)
}

export default function Tax() {
  const { data: invoices = [], isLoading } = useTable('np_invoices')
  const { data: materials = [] } = useTable('np_materials')
  const { data: expenses = [] } = useTable('np_expenses')
  const { data: labour = [] } = useTable('np_labour')
  const { data: jobs = [] } = useTable('np_jobs')

  // Cash jobs are off the books: their income, materials, labour and expenses
  // are excluded from BAS and from the tax summary entirely. Rows with no job
  // are overheads and stay in.
  const cashJobIds = useMemo(
    () => new Set(jobs.filter(isCashJob).map(j => j.id)),
    [jobs])
  const onBooks = (r: any) => !r.job_id || !cashJobIds.has(r.job_id)
  const { data: biz } = useBusinessSettings()

  const curYear = new Date().getFullYear()
  const [tab, setTab] = useState<'bas' | 'pl'>('bas')
  const [basis, setBasis] = useState<'cash' | 'accrual'>('cash')
  const [year, setYear] = useState(curYear)
  const [quarter, setQuarter] = useState(Math.ceil((new Date().getMonth() + 1) / 3))

  // ── AI bank reconciliation (V16 analyzeBankStatement) ────
  const [recon, setRecon] = useState('')
  const [reconBusy, setReconBusy] = useState(false)
  const [reconErr, setReconErr] = useState('')
  const bankRef = useRef<HTMLInputElement>(null)

  async function analyseStatement(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const apiKey = biz?.ai_api_key?.trim()
    if (!apiKey) { setReconErr('No AI API key set. Add your Anthropic API key in Settings.'); return }
    setReconBusy(true); setReconErr(''); setRecon('')
    try {
      const text = await file.text()
      setRecon(await reconcileBankStatement(apiKey, text, {
        invoices, materials, expenses,
        companyName: biz?.company_name, abn: biz?.abn,
      }))
    } catch (err: any) {
      setReconErr(err?.message ?? 'Reconciliation failed')
    } finally {
      setReconBusy(false)
    }
  }

  const fyYears = useMemo(() => {
    const ys = [...new Set(
      [...invoices, ...materials, ...expenses]
        .map(x => (x.date || '').slice(0, 4)).filter(Boolean).map(Number)
    )].sort((a, b) => b - a)
    return ys.length ? ys : [curYear]
  }, [invoices, materials, expenses, curYear])

  // V16 aggBAS()
  const bas = useMemo(() => {
    const invs = invoices.filter(i => onBooks(i) && (basis === 'cash'
      ? (i.date_paid && inRange(i.date_paid, year, quarter)) || (invStatus(i) === 'Paid' && !i.date_paid && inRange(i.date || '', year, quarter))
      : inRange(i.date || '', year, quarter)))
    const mats = materials.filter(m => onBooks(m) && inRange(m.date || '', year, quarter))
    const exps = expenses.filter(e => onBooks(e) && inRange(e.date || '', year, quarter) && hasGST(e))
    const gstCollected = invs.reduce((s, i) => s + (i.gst || 0), 0)
    const gstOnMats = mats.reduce((s, m) => s + (m.gst || 0), 0)
    const gstOnExps = exps.reduce((s, e) => s + (e.gst || 0), 0)
    return {
      gstCollected,
      totalGSTCredits: gstOnMats + gstOnExps,
      netGST: gstCollected - (gstOnMats + gstOnExps),
      totalSales: invs.reduce((s, i) => s + (i.agreed_ex_gst || 0), 0),
      totalPurchases: mats.reduce((s, m) => s + (m.cost_ex_gst || 0), 0) + exps.reduce((s, e) => s + (e.amount_ex_gst || 0), 0),
      invCount: invs.length,
      txnCount: mats.length + exps.length,
      matsIncGST: materials.filter(m => onBooks(m) && inRange(m.date || '', year, quarter)).reduce((s, m) => s + (m.total_inc_gst || 0), 0),
      expsIncGST: expenses.filter(e => onBooks(e) && inRange(e.date || '', year, quarter)).reduce((s, e) => s + expIncGST(e), 0),
    }
  }, [invoices, materials, expenses, basis, year, quarter])

  // V16 aggPL()
  const pl = useMemo(() => {
    const invs = invoices.filter(i => onBooks(i) && inYear(i.date || '', year))
    const mats = materials.filter(m => onBooks(m) && inYear(m.date || '', year))
    const labs = labour.filter(l => onBooks(l) && inYear(l.date || '', year))
    const exps = expenses.filter(e => onBooks(e) && inYear(e.date || '', year))
    const income = invs.reduce((s, i) => s + (i.agreed_ex_gst || 0), 0)
    const matCost = mats.reduce((s, m) => s + (m.cost_ex_gst || 0), 0)
    const labCost = labs.reduce((s, l) => s + (l.cost || (l.hours || 0) * (l.rate || 0)), 0)
    const expCost = exps.reduce((s, e) => s + (e.amount_ex_gst || 0), 0)
    const byCat: Record<string, number> = {}
    exps.forEach(e => {
      const c = e.category || 'Other'
      byCat[c] = (byCat[c] || 0) + (e.amount_ex_gst || 0)
    })
    const gstCollected = invs.reduce((s, i) => s + (i.gst || 0), 0)
    const gstCredits = mats.reduce((s, m) => s + (m.gst || 0), 0) + exps.filter(hasGST).reduce((s, e) => s + (e.gst || 0), 0)
    return {
      income, matCost, labCost, expCost,
      totalExpenses: matCost + labCost + expCost,
      grossProfit: income - matCost - labCost,
      netProfit: income - (matCost + labCost + expCost),
      byCat, gstCollected, gstCredits, netGST: gstCollected - gstCredits,
    }
  }, [invoices, materials, expenses, labour, year])

  const basRows: LineSpec[] = [
    ['SALES & INCOME', '', 'header'],
    ['G1 — Total sales (inc GST)', fmtCurrency(bas.totalSales * 1.1), ''],
    ['G2 — Export sales', '$0.00', ''],
    ['G3 — Other GST-free sales', '$0.00', ''],
    ['G10 — Capital acquisitions', '$0.00', ''],
    ['1A — GST on sales', fmtCurrency(bas.gstCollected), 'bold'],
    null,
    ['PURCHASES & EXPENSES', '', 'header'],
    ['G11 — Total purchases (inc GST)', fmtCurrency(bas.totalPurchases * 1.1), ''],
    ['Materials purchased', fmtCurrency(bas.matsIncGST), 'sub'],
    ['Overhead expenses (inc GST)', fmtCurrency(bas.expsIncGST), 'sub'],
    ['1B — GST credits on purchases', fmtCurrency(bas.totalGSTCredits), 'bold'],
    null,
    ['NET GST POSITION', '', 'header'],
    [bas.netGST > 0 ? 'Net GST payable to ATO' : 'GST refund due',
      fmtCurrency(Math.abs(bas.netGST)), bas.netGST > 0 ? 'total-red' : 'total-green'],
  ]

  const plRows: LineSpec[] = [
    ['INCOME', '', 'header'],
    ['Revenue from painting services (ex GST)', fmtCurrency(pl.income), ''],
    ['TOTAL INCOME', fmtCurrency(pl.income), 'total-green'],
    null,
    ['COST OF GOODS SOLD', '', 'header'],
    ['Materials & supplies', fmtCurrency(pl.matCost), ''],
    ['Labour & subcontractors', fmtCurrency(pl.labCost), ''],
    ['GROSS PROFIT', fmtCurrency(pl.grossProfit), pl.grossProfit >= 0 ? 'total-green' : 'total-red'],
    null,
    ['OVERHEAD EXPENSES', '', 'header'],
    ...Object.entries(pl.byCat).sort((a, b) => b[1] - a[1]).map(([c, v]) => [c, fmtCurrency(v), ''] as LineSpec),
    pl.expCost ? ['TOTAL OVERHEADS', fmtCurrency(pl.expCost), 'bold'] as LineSpec : null,
    null,
    ['NET PROFIT BEFORE TAX', fmtCurrency(pl.netProfit), pl.netProfit >= 0 ? 'total-green' : 'total-red'],
    ['Estimated income tax (25%)', fmtCurrency(Math.max(0, pl.netProfit) * 0.25), ''],
    ['NET PROFIT AFTER TAX', fmtCurrency(pl.netProfit - Math.max(0, pl.netProfit) * 0.25), pl.netProfit >= 0 ? 'total-green' : 'total-red'],
    null,
    ['GST SUMMARY', '', 'header'],
    ['GST collected from clients', fmtCurrency(pl.gstCollected), ''],
    ['GST credits (materials + expenses)', fmtCurrency(pl.gstCredits), ''],
    ['Net GST payable', fmtCurrency(pl.netGST), pl.netGST > 0 ? 'total-red' : 'total-green'],
  ]

  function printReport(type: 'bas' | 'pl') {
    const title = type === 'bas' ? `BAS Q${quarter} ${year}` : `P&L Statement ${year}`
    const el = document.getElementById(type === 'bas' ? 'tax-bas-detail' : 'tax-pl-detail')
    const content = el?.innerHTML ?? ''
    const company = biz?.company_name || 'Northern Painters'
    const meta = [biz?.abn ? `ABN ${biz.abn}` : '', biz?.licence ? `Lic ${biz.licence}` : '',
      `Generated ${new Date().toLocaleDateString('en-AU')}`].filter(Boolean).join(' · ')
    const w = window.open('', '_blank')
    if (!w) return
    w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title} — ${company}</title>
<style>body{font-family:Arial,sans-serif;font-size:12px;padding:30px;color:#1a1a18}
h1{font-size:18px;margin-bottom:4px}h2{font-size:14px;margin:16px 0 8px;border-bottom:1px solid #ccc;padding-bottom:4px}
.meta{font-size:10px;color:#888;margin-bottom:16px}</style></head>
<body><h1>${company}</h1><div class="meta">${meta}</div>${content}</body></html>`)
    w.document.close()
    setTimeout(() => w.print(), 400)
  }

  // V16 exportXeroSales()
  function exportXeroSales() {
    const headers = ['*ContactName','EmailAddress','*InvoiceNumber','Reference','*InvoiceDate','*DueDate','*Description','*Quantity','*UnitAmount','*AccountCode','*TaxType','Currency']
    const rows = [csvRow(headers)]
    invoices.filter(i => (i.agreed_ex_gst || 0) > 0).forEach(inv => {
      const date = inv.date || today()
      rows.push(csvRow([
        inv.client || '', inv.email || '', inv.id || '', inv.job_id || '',
        date, inv.due_date || date, inv.notes || 'Painting services',
        '1', (inv.agreed_ex_gst || 0).toFixed(2), '200', 'OUTPUT2', 'AUD',
      ]))
    })
    downloadCSV(`NP_Xero_Sales_${today()}.csv`, rows)
    alert(`Sales CSV exported — ${rows.length - 1} invoice${rows.length - 1 !== 1 ? 's' : ''}. Import via Xero → Accounting → Import.`)
  }

  // V16 exportXeroBills()
  function exportXeroBills() {
    const headers = ['*ContactName','*InvoiceNumber','Reference','*InvoiceDate','*DueDate','*Description','*Quantity','*UnitAmount','*AccountCode','*TaxType','Currency']
    const rows = [csvRow(headers)]
    materials.forEach((m, i) => {
      const invno = m.receipt_no || `MAT-${String(i + 1).padStart(4, '0')}`
      rows.push(csvRow([
        m.supplier || 'Unknown', invno, m.job_id || '', m.date || '', m.date || '',
        m.mat_desc || '', '1', (m.cost_ex_gst || 0).toFixed(2), '310', 'INPUT2', 'AUD',
      ]))
    })
    expenses.forEach((e, i) => {
      rows.push(csvRow([
        e.supplier || 'Unknown', `EXP-${String(i + 1).padStart(4, '0')}`, e.job_id || '',
        e.date || '', e.date || '', e.exp_desc || '', '1', (e.amount_ex_gst || 0).toFixed(2), '310', 'INPUT2', 'AUD',
      ]))
    })
    downloadCSV(`NP_Xero_Bills_${today()}.csv`, rows)
    alert(`Bills CSV exported — ${rows.length - 1} item${rows.length - 1 !== 1 ? 's' : ''}. Import via Xero → Accounting → Import.`)
  }

  if (isLoading) return (
    <div className="flex items-center justify-center h-64"><Loader2 size={20} className="animate-spin text-blue-600" /></div>
  )

  const [qFrom, qTo] = qRanges(year, quarter)
  const fmtD = (d: string) => new Date(d + 'T00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
  const BTN = 'px-2.5 py-1.5 text-[13px] bg-white border border-black/20 rounded-lg hover:bg-[#f5f4f0]'

  return (
    <div className="p-5">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <h2 className="text-[17px] font-semibold text-gray-900">Tax &amp; Bookkeeping</h2>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => printReport('bas')} className={`${BTN} flex items-center gap-1.5`}><Printer size={14} /> Print BAS</button>
          <button onClick={() => printReport('pl')} className={`${BTN} flex items-center gap-1.5`}><Printer size={14} /> Print P&amp;L</button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border border-black/[0.12] rounded-lg overflow-hidden w-fit mb-4">
        {([['bas', 'BAS / GST', ReceiptText], ['pl', 'P&L / Income', LineChart]] as const).map(([id, label, Icon], i) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-3.5 py-2 text-[13px] ${i ? 'border-l border-black/[0.12]' : ''} ${tab === id ? 'bg-blue-600 text-white' : 'bg-white hover:bg-[#f5f4f0]'}`}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {tab === 'bas' ? (
        <>
          <div className="flex gap-2 mb-3 flex-wrap items-center">
            <label className="text-[13px] font-semibold">Accounting basis:</label>
            <div className="flex border border-black/[0.12] rounded-[7px] overflow-hidden">
              {(['cash', 'accrual'] as const).map((b, i) => (
                <button key={b} onClick={() => setBasis(b)}
                  className={`text-xs px-3 py-1.5 ${i ? 'border-l border-black/[0.12]' : ''} ${basis === b ? 'bg-blue-600 text-white' : 'bg-white hover:bg-[#f5f4f0]'}`}>
                  {b === 'cash' ? 'Cash basis' : 'Accrual basis'}
                </button>
              ))}
            </div>
            <span className="text-[11px] text-[#666]">
              {basis === 'cash' ? 'GST reported when payment received (date paid)' : 'GST reported when invoice issued (invoice date)'}
            </span>
          </div>

          <div className="flex gap-2 mb-3 flex-wrap items-center">
            <label className="text-[13px] font-semibold">Year:</label>
            <select value={year} onChange={e => setYear(parseInt(e.target.value))}
              className="px-2.5 py-1.5 border border-black/20 rounded-lg text-[13px] bg-white focus:outline-none focus:ring-1 focus:ring-blue-500">
              {fyYears.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <label className="text-[13px] font-semibold">Quarter:</label>
            {[1, 2, 3, 4].map(q => (
              <button key={q} onClick={() => setQuarter(q)}
                className={`px-2.5 py-1.5 text-[13px] rounded-lg border ${quarter === q ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-black/20 hover:bg-[#f5f4f0]'}`}>
                Q{q}
              </button>
            ))}
            <span className="text-xs text-[#666]">{fmtD(qFrom)} – {fmtD(qTo)}</span>
          </div>

          <div className="grid gap-2.5 mb-3.5" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))' }}>
            {[
              { l: 'Total sales (ex GST)', v: fmtCurrency(bas.totalSales), c: '#16a34a' },
              { l: 'GST collected', v: fmtCurrency(bas.gstCollected) },
              { l: 'GST credits', v: fmtCurrency(bas.totalGSTCredits), c: '#16a34a' },
              { l: 'Net GST to ATO', v: fmtCurrency(bas.netGST), c: bas.netGST > 0 ? '#dc2626' : '#16a34a' },
            ].map(m => (
              <div key={m.l} className="bg-[#f5f4f0] rounded-lg px-4 py-3.5">
                <div className="text-[11px] text-[#666] mb-1">{m.l}</div>
                <div className="text-xl font-semibold" style={m.c ? { color: m.c } : undefined}>{m.v}</div>
              </div>
            ))}
          </div>

          <div id="tax-bas-detail">
            <div className="bg-white border border-black/[0.12] rounded-xl p-4 mb-3.5">
              <h2 className="text-sm font-bold mb-3">BAS Summary — Q{quarter} {year}</h2>
              <div className="text-[11px] text-[#666] mb-3">
                Period: {new Date(qFrom + 'T00:00').toLocaleDateString('en-AU')} to {new Date(qTo + 'T00:00').toLocaleDateString('en-AU')}
              </div>
              <StatementRows rows={basRows} />
              <div className="text-[11px] text-[#666] mt-4 pt-2.5 border-t border-black/[0.08]">
                Based on {bas.invCount} invoice{bas.invCount !== 1 ? 's' : ''} and {bas.txnCount} purchase/expense
                transaction{bas.txnCount !== 1 ? 's' : ''} in this period. Confirm with your registered BAS agent or accountant before lodging.
              </div>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="flex gap-2 mb-3 flex-wrap items-center">
            <label className="text-[13px] font-semibold">Financial Year:</label>
            <select value={year} onChange={e => setYear(parseInt(e.target.value))}
              className="px-2.5 py-1.5 border border-black/20 rounded-lg text-[13px] bg-white focus:outline-none focus:ring-1 focus:ring-blue-500">
              {fyYears.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>

          <div className="grid gap-2.5 mb-3.5" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))' }}>
            {[
              { l: 'Total income (ex GST)', v: fmtCurrency(pl.income), c: '#16a34a' },
              { l: 'Total expenses (ex GST)', v: fmtCurrency(pl.totalExpenses) },
              { l: 'Net profit', v: fmtCurrency(pl.netProfit), c: pl.netProfit >= 0 ? '#16a34a' : '#dc2626' },
              { l: 'Est. tax @ 25%', v: fmtCurrency(Math.max(0, pl.netProfit) * 0.25), c: '#d97706' },
            ].map(m => (
              <div key={m.l} className="bg-[#f5f4f0] rounded-lg px-4 py-3.5">
                <div className="text-[11px] text-[#666] mb-1">{m.l}</div>
                <div className="text-xl font-semibold" style={m.c ? { color: m.c } : undefined}>{m.v}</div>
              </div>
            ))}
          </div>

          <div id="tax-pl-detail">
            <div className="bg-white border border-black/[0.12] rounded-xl p-4 mb-3.5">
              <h2 className="text-sm font-bold mb-1">Profit &amp; Loss Statement — {year}</h2>
              <div className="text-[11px] text-[#666] mb-3.5">
                1 January {year} to 31 December {year} · {biz?.company_name || 'Northern Painters'}
                {biz?.abn ? ` · ABN ${biz.abn}` : ''}
              </div>
              <StatementRows rows={plRows} />
              <div className="text-[11px] text-[#666] mt-4 pt-2.5 border-t border-black/[0.08]">
                This report is prepared from app data only. Confirm all figures with your accountant before lodging your
                tax return. Income tax rate of 25% applies to base rate entities — verify your applicable rate.
              </div>
            </div>
          </div>
        </>
      )}

      {/* Xero export */}
      <div className="bg-white border border-black/[0.12] rounded-xl p-4">
        <div className="flex justify-between items-center mb-2 flex-wrap gap-2">
          <div className="text-[13px] font-bold flex items-center gap-1.5"><FileSpreadsheet size={14} /> Xero Export</div>
          <span className="text-[11px] text-[#666]">Compatible CSV for Xero import</span>
        </div>
        <div className="text-xs text-[#666] mb-2.5">
          In Xero: Accounting → Import. Sales = invoices, Bills = materials &amp; expenses.
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={exportXeroSales}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] bg-blue-600 hover:bg-blue-700 text-white rounded-lg">
            <FileSpreadsheet size={14} /> Sales (Invoices) CSV
          </button>
          <button onClick={exportXeroBills}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] bg-blue-600 hover:bg-blue-700 text-white rounded-lg">
            <FileSpreadsheet size={14} /> Bills (Materials+Expenses) CSV
          </button>
          <button onClick={() => { exportXeroSales(); setTimeout(exportXeroBills, 500) }} className={`${BTN} flex items-center gap-1.5`}>
            <Download size={14} /> Export Both
          </button>
        </div>
      </div>

      {/* AI bank reconciliation */}
      <div className="bg-white border border-black/[0.12] rounded-xl p-4 mt-3.5">
        <div className="flex justify-between items-center mb-2 flex-wrap gap-2">
          <div className="text-[13px] font-bold flex items-center gap-1.5"><Landmark size={14} /> Bank Reconciliation</div>
          <span className="text-[11px] text-[#666]">AI-powered matching</span>
        </div>
        <div className="text-xs text-[#666] mb-2.5">
          Upload a bank statement CSV — AI matches credits to invoices, debits to purchases, flags unmatched
          transactions, and verifies the GST position.
        </div>

        <button onClick={() => bankRef.current?.click()} disabled={reconBusy}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50">
          {reconBusy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
          {reconBusy ? 'Analysing statement…' : 'Upload Bank Statement (CSV)'}
        </button>
        <input ref={bankRef} type="file" accept=".csv,.txt,text/csv" className="hidden" onChange={analyseStatement} />

        {reconErr && (
          <div className="mt-2.5 text-xs text-[#c0392b] bg-[#fef2f2] rounded-lg px-3 py-2">{reconErr}</div>
        )}

        {recon && (
          <div className="mt-3 border-t border-black/[0.12] pt-3">
            <div className="text-[13px] leading-relaxed" dangerouslySetInnerHTML={{ __html: mdHTML(recon) }} />
            <button onClick={() => setRecon('')}
              className="flex items-center gap-1 mt-2.5 px-2.5 py-1 text-[11px] bg-white border border-black/20 rounded-lg hover:bg-[#f5f4f0]">
              <X size={11} /> Clear
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
