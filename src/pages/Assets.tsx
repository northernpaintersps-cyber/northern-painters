import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, selectAll } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Modal } from '@/components/ui/Modal'
import { Input, Select, TextArea } from '@/components/ui/Field'
import { fmtCurrency, genId, today, GST } from '@/lib/utils'
import { PAID_BY, isCashPaid } from '@/lib/cashBooks'
import InfoTip, { TipCalc } from '@/components/InfoTip'
import {
  ASSET_CATEGORIES, DEP_METHODS, METHOD_LABEL, DEFAULT_LIFE,
  assetMethod, depreciationFor, registerTotals, schedule, disposalResult,
  businessShare, yearOf,
} from '@/lib/assets'
import { Plus, Loader2, Trash2, Edit2, Truck } from 'lucide-react'
import { invalidateTable } from '../lib/queryKeys'

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

function useUpsert() {
  const qc = useQueryClient()
  const { user } = useAuth()
  return useMutation({
    mutationFn: async (row: Row) => {
      const { error } = await (supabase.from('np_assets') as any)
        .upsert({ ...row, user_id: user!.id, updated_at: new Date().toISOString() })
      if (error) throw error
    },
    onSuccess: () => invalidateTable(qc, 'np_assets'),
  })
}

function useDel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.from('np_assets') as any).delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => invalidateTable(qc, 'np_assets'),
  })
}

const emptyForm = (): Row => ({
  id: '', name: '', category: 'Tools', supplier: '', purchase_date: today(),
  invoice_no: '', cost_ex_gst: '', gst: '', paid_by: 'Bank',
  method: 'prime_cost', effective_life_yr: DEFAULT_LIFE.Tools, business_use_pct: 100,
  prior_depreciation: '', serial_no: '', location: '', notes: '',
  disposal_date: '', disposal_amount_ex_gst: '',
})

export default function Assets() {
  const { data: assets = [], isLoading } = useTable('np_assets')
  const upsert = useUpsert()
  const del = useDel()

  const curYear = new Date().getFullYear()
  const [year, setYear] = useState(curYear)
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [showSold, setShowSold] = useState(false)
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState<Row>(emptyForm())
  const [scheduleOf, setScheduleOf] = useState<Row | null>(null)

  const ef = (k: string) => (e: any) => setForm(p => ({ ...p, [k]: e.target.value }))

  const years = useMemo(() => {
    const ys = [...new Set(assets.map(a => yearOf(a.purchase_date)).filter((y): y is number => y !== null))]
    for (let y = Math.min(curYear, ...(ys.length ? ys : [curYear])); y <= curYear; y++) ys.push(y)
    return [...new Set(ys)].sort((a, b) => b - a)
  }, [assets, curYear])

  const rows = useMemo(() => assets.filter(a => {
    const bought = yearOf(a.purchase_date)
    if (bought !== null && bought > year) return false          // not owned yet
    const sold = yearOf(a.disposal_date)
    if (sold !== null && sold < year && !showSold) return false  // long gone
    if (cat && a.category !== cat) return false
    if (q && !`${a.name ?? ''}${a.supplier ?? ''}${a.serial_no ?? ''}${a.invoice_no ?? ''}`
      .toLowerCase().includes(q.toLowerCase())) return false
    return true
  }).sort((a, b) => String(b.purchase_date ?? '').localeCompare(String(a.purchase_date ?? ''))),
    [assets, q, cat, year, showSold])

  const totals = useMemo(() => registerTotals(assets, year), [assets, year])

  function openNew() { setForm(emptyForm()); setModal(true) }
  function openEdit(a: Row) {
    setForm({ ...emptyForm(), ...a, cost_ex_gst: a.cost_ex_gst ?? '', gst: a.gst ?? '' })
    setModal(true)
  }

  // Picking a category sets the effective life it usually has, which is the
  // field nobody wants to look up. Still editable.
  function pickCategory(e: any) {
    const c = e.target.value
    setForm(p => ({ ...p, category: c, effective_life_yr: DEFAULT_LIFE[c] ?? p.effective_life_yr }))
  }

  async function save() {
    if (!form.name?.trim()) { alert('Give the asset a name.'); return }
    if (!form.purchase_date) { alert('A purchase date is needed — it is what the depreciation runs from.'); return }
    const ex = parseFloat(form.cost_ex_gst) || 0
    const gst = form.gst === '' || form.gst === null ? parseFloat((ex * GST).toFixed(2)) : parseFloat(form.gst) || 0
    await upsert.mutateAsync({
      ...form,
      id: form.id || genId('ast'),
      cost_ex_gst: ex,
      gst,
      total_inc_gst: parseFloat((ex + gst).toFixed(2)),
      effective_life_yr: parseFloat(form.effective_life_yr) || 5,
      business_use_pct: form.business_use_pct === '' ? 100 : parseFloat(form.business_use_pct) || 0,
      prior_depreciation: parseFloat(form.prior_depreciation) || 0,
      disposal_date: form.disposal_date || null,
      disposal_amount_ex_gst: form.disposal_amount_ex_gst === '' ? null : parseFloat(form.disposal_amount_ex_gst) || 0,
      created_at: form.created_at || new Date().toISOString(),
    })
    setModal(false)
  }

  if (isLoading) return (
    <div className="flex items-center justify-center h-64"><Loader2 size={20} className="animate-spin text-blue-600" /></div>
  )

  const formEx = parseFloat(form.cost_ex_gst) || 0
  const preview = formEx > 0 && form.purchase_date
    ? depreciationFor({ ...form, cost_ex_gst: formEx, prior_depreciation: parseFloat(form.prior_depreciation) || 0 },
        yearOf(form.purchase_date) ?? curYear)
    : null

  return (
    <div className="p-5">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <h2 className="text-[17px] font-semibold text-gray-900 flex items-center gap-2">
          <Truck size={17} /> Business Assets
        </h2>
        <button onClick={openNew}
          className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white font-medium text-[13px] px-3 py-1.5 rounded-lg">
          <Plus size={14} /> Add Asset
        </button>
      </div>

      <div className="grid gap-2.5 mb-3.5" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))' }}>
        {[
          {
            l: 'Assets owned', v: String(totals.count), c: '#2563eb',
            help: <>Everything on the register still owned at the end of {year}.
              <TipCalc>Bought on or before {year}, not disposed of before it. Something sold
              during {year} still counts — you owned it for part of the year.</TipCalc></>,
          },
          {
            l: 'Cost of assets', v: fmtCurrency(totals.costExGST),
            help: <>What you paid for them, ex GST. This never changes with age — it is the
              purchase price, not what they are worth.
              <TipCalc>Sum of the ex-GST purchase price of every asset still owned.</TipCalc></>,
          },
          {
            l: 'Written-down value', v: fmtCurrency(totals.writtenDown), c: '#0369a1',
            help: <>What they are worth on paper at the end of {year}, after depreciation. This
              is the figure a balance sheet carries.
              <TipCalc>Cost less all depreciation charged up to the end of {year}, per asset,
              on the method each one is set to. An asset written off completely sits at nil and
              stays on the register.</TipCalc></>,
          },
          {
            l: `Depreciation ${year}`, v: fmtCurrency(totals.deduction), c: '#16a34a',
            help: <>This year&rsquo;s deduction from the register, which the Tax page carries into
              the P&amp;L as an expense.
              <TipCalc>Each asset&rsquo;s charge for {year} times its business-use share. An asset
              bought with cash deducts nothing{totals.nonDeductible
                ? ` — ${fmtCurrency(totals.nonDeductible)} of depreciation is forgone that way this year`
                : ''}.</TipCalc></>,
          },
          {
            l: `Bought in ${year}`, v: fmtCurrency(totals.purchasedExGST), c: '#7c3aed',
            help: <>Spent on assets this year, ex GST, with {fmtCurrency(totals.purchasedGST)} of
              GST credit to claim on the BAS.
              <TipCalc>Assets whose purchase date falls in {year}. The GST credit is the business-use
              share of the GST paid, and nil on anything bought with cash.</TipCalc></>,
          },
        ].map(m => (
          <div key={m.l} className="bg-[#f5f4f0] rounded-lg px-4 py-3.5">
            <div className="text-[11px] text-[#666] mb-1 flex items-center gap-1">
              {m.l}<InfoTip title={m.l}>{m.help}</InfoTip>
            </div>
            <div className="text-xl font-semibold" style={m.c ? { color: m.c } : undefined}>{m.v}</div>
          </div>
        ))}
      </div>

      <div className="bg-white border border-black/[0.12] rounded-xl px-3.5 py-3 mb-2.5">
        <div className="flex gap-2 flex-wrap items-center">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="🔍 Search name, supplier, serial…"
            className="flex-[2] min-w-[160px] px-2.5 py-2 text-[13px] bg-white border border-black/20 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500" />
          <select value={cat} onChange={e => setCat(e.target.value)}
            className="flex-1 min-w-[150px] px-2.5 py-2 text-[13px] bg-white border border-black/20 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500">
            <option value="">All categories</option>
            {ASSET_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={year} onChange={e => setYear(parseInt(e.target.value))}
            className="px-2.5 py-2 text-[13px] bg-white border border-black/20 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500">
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-[12px] text-[#666] cursor-pointer">
            <input type="checkbox" checked={showSold} onChange={e => setShowSold(e.target.checked)}
              className="w-4 h-4 accent-blue-600" />
            Show disposed
          </label>
        </div>
      </div>

      <div className="bg-white border border-black/[0.12] rounded-xl overflow-hidden">
        <div className="overflow-auto max-h-[70vh]">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr>
                {['Asset', 'Category', 'Bought', 'Cost ex GST', 'Method', `Dep. ${year}`, 'Written down', ''].map((h, i) => (
                  <th key={i} className={`px-2.5 py-[7px] border-b border-black/[0.12] text-[#666] font-medium whitespace-nowrap bg-[#fafaf8] sticky top-0 z-[2] ${[3, 5, 6].includes(i) ? 'text-right' : 'text-left'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(a => {
                const d = depreciationFor(a, year)
                const sold = yearOf(a.disposal_date)
                const gone = sold !== null && sold <= year
                const cash = isCashPaid(a)
                const share = businessShare(a)
                return (
                  <tr key={a.id} className={`border-b border-black/[0.06] hover:bg-[#fafaf8] ${gone ? 'opacity-55' : ''}`}>
                    <td className="px-2.5 py-[7px]">
                      <div className="font-medium">{a.name || '—'}</div>
                      <div className="text-[11px] text-[#666]">
                        {a.supplier || ''}{a.serial_no ? ` · ${a.serial_no}` : ''}
                        {share < 1 && <span className="text-[#92400e]"> · {Math.round(share * 100)}% business</span>}
                        {cash && <span className="text-[#92400e]"> · cash, not deductible</span>}
                        {gone && <span> · disposed {a.disposal_date}</span>}
                      </div>
                    </td>
                    <td className="px-2.5 py-[7px]">
                      <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#f1f0e8] text-[#5f5e5a]">{a.category || 'Other'}</span>
                    </td>
                    <td className="px-2.5 py-[7px] text-xs whitespace-nowrap">{a.purchase_date || '—'}</td>
                    <td className="px-2.5 py-[7px] text-right font-medium">{fmtCurrency(a.cost_ex_gst || 0)}</td>
                    <td className="px-2.5 py-[7px] text-[11px] whitespace-nowrap">
                      {METHOD_LABEL[assetMethod(a)]}
                      {assetMethod(a) !== 'immediate' && assetMethod(a) !== 'none' &&
                        <span className="text-[#666]"> · {a.effective_life_yr || 5} yr</span>}
                    </td>
                    <td className="px-2.5 py-[7px] text-right" style={{ color: d.deduction ? '#16a34a' : '#666' }}>
                      {d.deduction ? fmtCurrency(d.deduction) : '—'}
                      {d.charge > 0 && d.deduction !== d.charge &&
                        <div className="text-[10px] text-[#666]">of {fmtCurrency(d.charge)}</div>}
                    </td>
                    <td className="px-2.5 py-[7px] text-right">{gone ? '—' : fmtCurrency(d.closing)}</td>
                    <td className="px-2.5 py-[7px] whitespace-nowrap">
                      <button onClick={() => setScheduleOf(a)} title="Depreciation schedule"
                        className="px-1.5 py-1 rounded-md bg-white border border-black/20 hover:bg-[#f5f4f0] align-middle text-[10px]">Schedule</button>
                      <button onClick={() => openEdit(a)}
                        className="ml-1 px-1.5 py-1 rounded-md bg-white border border-black/20 hover:bg-[#f5f4f0] align-middle"><Edit2 size={12} /></button>
                      <button onClick={() => { if (confirm(`Delete ${a.name || 'this asset'}? Its depreciation leaves the P&L for every year.`)) del.mutate(a.id) }}
                        className="ml-1 px-1.5 py-1 rounded-md bg-white border border-black/20 hover:bg-[#f5f4f0] align-middle text-[#c0392b]"><Trash2 size={12} /></button>
                    </td>
                  </tr>
                )
              })}
              {rows.length === 0 && (
                <tr><td colSpan={8} className="text-center text-[#666] py-6">
                  Nothing on the register for {year}. Add the ute, the compressor, the ladders — anything
                  bought once that is used for years.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="text-[11px] text-[#666] mt-2.5">
        Depreciation from this register is carried into the P&amp;L on the Tax page, and the GST on an
        asset bought this period appears on the BAS. Which method and which effective life apply to a
        given asset is between you and your accountant — this does the arithmetic, not the ruling.
      </div>

      {/* ── Add / edit ─────────────────────────────────────── */}
      <Modal open={modal} onClose={() => setModal(false)} title={form.id ? 'Edit Asset' : 'New Asset'}>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Name" value={form.name || ''} onChange={ef('name')}
            placeholder="Graco 395 spray rig" wrapperClassName="col-span-2" />
          <Select label="Category" value={form.category || 'Other'} onChange={pickCategory} options={[...ASSET_CATEGORIES]} />
          <Input label="Purchase date" type="date" value={form.purchase_date || ''} onChange={ef('purchase_date')} />
          <Input label="Supplier" value={form.supplier || ''} onChange={ef('supplier')} />
          <Input label="Invoice / receipt no." value={form.invoice_no || ''} onChange={ef('invoice_no')} />

          <Input label="Cost ex GST ($)" type="number" step="0.01" value={form.cost_ex_gst ?? ''} onChange={ef('cost_ex_gst')} />
          <Input label="GST ($)" type="number" step="0.01" value={form.gst ?? ''} onChange={ef('gst')}
            placeholder={formEx ? (formEx * GST).toFixed(2) : '10% of the cost'} />

          <Select label="Paid by" value={form.paid_by || 'Bank'} onChange={ef('paid_by')} options={[...PAID_BY]} />
          <div className="flex items-end pb-2 text-[11px] text-[#92400e]">
            {isCashPaid(form) && 'Cash — no deduction, no GST credit'}
          </div>

          <Select label="Depreciation method" value={form.method || 'prime_cost'} onChange={ef('method')}
            options={[...DEP_METHODS]} wrapperClassName="col-span-2" />
          <div className="col-span-2 -mt-1 text-[11px] text-[#666]">
            {METHOD_LABEL[assetMethod(form)]} — {
              assetMethod(form) === 'immediate' ? 'the whole cost deducted in the year of purchase, under the instant asset write-off. Check the threshold for the year with your accountant.'
                : assetMethod(form) === 'prime_cost' ? 'the same amount every year across the effective life.'
                : assetMethod(form) === 'diminishing' ? 'a larger deduction early, tapering off — 200% ÷ life, applied to what is left.'
                : 'kept on the register at cost, with no deduction taken.'}
          </div>

          <Input label="Effective life (years)" type="number" step="0.5" value={form.effective_life_yr ?? ''} onChange={ef('effective_life_yr')}
            disabled={['immediate', 'none'].includes(assetMethod(form))} />
          <Input label="Business use (%)" type="number" step="1" value={form.business_use_pct ?? ''} onChange={ef('business_use_pct')} />

          <Input label="Depreciation already claimed ($)" type="number" step="0.01"
            value={form.prior_depreciation ?? ''} onChange={ef('prior_depreciation')}
            placeholder="0 — only for something you already owned" wrapperClassName="col-span-2" />

          <Input label="Serial / rego" value={form.serial_no || ''} onChange={ef('serial_no')} />
          <Input label="Kept at" value={form.location || ''} onChange={ef('location')} placeholder="Ute, shed…" />

          <Input label="Disposed on" type="date" value={form.disposal_date || ''} onChange={ef('disposal_date')} />
          <Input label="Sold for ex GST ($)" type="number" step="0.01"
            value={form.disposal_amount_ex_gst ?? ''} onChange={ef('disposal_amount_ex_gst')} />

          <TextArea label="Notes" value={form.notes || ''} onChange={ef('notes')} rows={2} wrapperClassName="col-span-2" />

          {preview && (
            <div className="col-span-2 rounded-lg bg-[#f5f4f0] px-3 py-2.5 text-[12px]">
              <b>First year</b> ({yearOf(form.purchase_date)}): {fmtCurrency(preview.charge)} depreciation
              {preview.deduction !== preview.charge && <> · <b>{fmtCurrency(preview.deduction)}</b> of it deductible</>}
              {' '}· written down to {fmtCurrency(preview.closing)}
              {assetMethod(form) !== 'immediate' && assetMethod(form) !== 'none' &&
                <div className="text-[11px] text-[#666] mt-0.5">
                  Part-year: the first year is pro-rated from the purchase date, so a late purchase deducts less.
                </div>}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={() => setModal(false)}
            className="px-3 py-1.5 text-[13px] rounded-lg border border-black/20 hover:bg-[#f5f4f0]">Cancel</button>
          <button onClick={save} disabled={upsert.isPending}
            className="px-3 py-1.5 text-[13px] rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-60">
            {upsert.isPending ? 'Saving…' : 'Save asset'}
          </button>
        </div>
      </Modal>

      {/* ── The schedule, year by year ─────────────────────── */}
      <Modal open={!!scheduleOf} onClose={() => setScheduleOf(null)}
        title={scheduleOf ? `${scheduleOf.name || 'Asset'} — depreciation schedule` : ''}>
        {scheduleOf && (() => {
          const bought = yearOf(scheduleOf.purchase_date) ?? curYear
          const rows = [...schedule(scheduleOf, bought + Math.ceil(Number(scheduleOf.effective_life_yr) || 5) + 2)]
            .filter(([, d], i) => d.charge > 0 || i === 0)
          const gainLoss = disposalResult(scheduleOf)
          return (
            <>
              <div className="text-[12px] text-[#666] mb-2">
                {METHOD_LABEL[assetMethod(scheduleOf)]} · {fmtCurrency(scheduleOf.cost_ex_gst || 0)} ex GST
                {businessShare(scheduleOf) < 1 && ` · ${Math.round(businessShare(scheduleOf) * 100)}% business use`}
              </div>
              <table className="w-full border-collapse text-[12.5px]">
                <thead>
                  <tr>{['Year', 'Opening', 'Depreciation', 'Deductible', 'Closing'].map((h, i) => (
                    <th key={h} className={`px-2 py-1.5 border-b border-black/[0.12] text-[#666] font-medium ${i ? 'text-right' : 'text-left'}`}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {rows.map(([y, d]) => (
                    <tr key={y} className={`border-b border-black/[0.06] ${y === year ? 'bg-[#f5f4f0] font-medium' : ''}`}>
                      <td className="px-2 py-1.5">{y}</td>
                      <td className="px-2 py-1.5 text-right">{fmtCurrency(d.opening)}</td>
                      <td className="px-2 py-1.5 text-right">{fmtCurrency(d.charge)}</td>
                      <td className="px-2 py-1.5 text-right" style={{ color: d.deduction ? '#16a34a' : '#666' }}>
                        {d.deduction ? fmtCurrency(d.deduction) : '—'}
                      </td>
                      <td className="px-2 py-1.5 text-right">{fmtCurrency(d.closing)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {gainLoss && (
                <div className="mt-3 rounded-lg bg-[#f5f4f0] px-3 py-2.5 text-[12px]">
                  <b>Disposed {scheduleOf.disposal_date}</b> for {fmtCurrency(scheduleOf.disposal_amount_ex_gst || 0)} ex GST
                  {' '}against a book value of {fmtCurrency((scheduleOf.disposal_amount_ex_gst || 0) - gainLoss.gain)} —
                  {' '}a <b style={{ color: gainLoss.gain >= 0 ? '#16a34a' : '#c0392b' }}>
                    {gainLoss.gain >= 0 ? 'gain' : 'loss'} of {fmtCurrency(Math.abs(gainLoss.gain))}
                  </b>. A gain is assessable income and a loss is deductible, both in {gainLoss.year} —
                  neither is applied automatically, so tell your accountant.
                </div>
              )}
            </>
          )
        })()}
      </Modal>
    </div>
  )
}
