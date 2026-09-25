import { useState, useMemo, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, selectAll } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Modal } from '@/components/ui/Modal'
import JobPicker from '@/components/JobPicker'
import { Input, Select, TextArea } from '@/components/ui/Field'
import { fmtCurrency, today } from '@/lib/utils'
import {
  Plus, Loader2, Trash2, Edit2, Copy, ReceiptText, ArrowUpDown, Info, Printer,
} from 'lucide-react'
import { useBusinessSettings } from '@/pages/SettingsPage'

type Row = Record<string, any>

const METHODS = ['Bank Transfer', 'Cash', 'Credit Card', 'Other']
const money2 = (v: any) => '$' + Number(v || 0).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const auDate = (d?: string | null) => (d ? new Date(d + 'T00:00').toLocaleDateString('en-AU') : '')

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
      const { error } = await (supabase.from('np_receipts') as any)
        .upsert({ ...row, user_id: user!.id, updated_at: new Date().toISOString() })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['np_receipts'] }),
  })
}

function useDel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.from('np_receipts') as any).delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['np_receipts'] }),
  })
}

// V16 nextReceiptNo()
function nextReceiptNo(existing: Row[]) {
  const nums = existing
    .map(r => parseInt(String(r.id ?? '').replace(/\D/g, ''), 10))
    .filter(n => !isNaN(n))
  const max = nums.length ? Math.max(...nums) : 0
  return `R-${String(max + 1).padStart(4, '0')}`
}

// V16 copyReceiptMsg()
function receiptMessage(r: Row, biz: any) {
  const who = [biz?.owner_name, biz?.company_name || 'Northern Painters'].filter(Boolean).join('\n')
  const lic = [biz?.licence ? `Lic ${biz.licence}` : '', biz?.abn ? `ABN ${biz.abn}` : ''].filter(Boolean).join(' | ')
  const contact = [biz?.phone, biz?.email].filter(Boolean).join(' | ')
  return `Hi ${r.client || ''},\n\nPlease find your payment receipt details below.\n\nReceipt No.: ${r.id || ''}\nAmount received: ${money2(r.total_inc_gst)}\nPayment date: ${auDate(r.payment_date)}\nMethod: ${r.category || ''}${r.category === 'Other' && r.method_other ? ` (${r.method_other})` : ''}${r.inv_ref ? `\nInvoice reference: ${r.inv_ref}` : ''}\n\nThank you for your payment.\n\nKind regards,\n${who}${lic ? `\n${lic}` : ''}${contact ? `\n${contact}` : ''}`
}

// V16 _renderReceiptPreview()
function buildReceiptHTML(r: Row, biz: any) {
  const origin = window.location.origin
  const addrLines = String(r.address || '').split('\n').map(l => l.trim()).filter(Boolean)
  while (addrLines.length < 2) addrLines.push('')
  const methodRows = ['Bank Transfer', 'Cash', 'Credit Card']
    .map(m => `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px"><span style="font-size:16px">${r.category === m ? '☑' : '☐'}</span><span>${m}</span></div>`)
    .join('')
  const otherChecked = r.category === 'Other'
  const owner = biz?.owner_name || 'Pablo Suane'
  const company = biz?.company_name || 'Northern Painters'

  const page = `<div id="receipt-prev" class="np-receipt-sample" style="background:#fff;width:794px;min-height:1030px;margin:0 auto;padding:56px 64px 40px;font-family:Arial,Helvetica,sans-serif;color:#111;font-size:14px;line-height:1.3">
  <div style="display:grid;grid-template-columns:1fr auto;align-items:end;border-bottom:2px solid #111;padding-bottom:10px;margin-bottom:26px">
    <div><img src="${origin}/np-logo.png" alt="${esc(company)}" style="width:260px;height:auto;display:block"></div>
    <div style="text-align:right">
      ${biz?.phone ? `<div style="font-size:11px;color:#555;margin-bottom:2px">${esc(biz.phone)}</div>` : ''}
      ${biz?.email ? `<div style="font-size:11px;color:#555;margin-bottom:2px">${esc(biz.email)}</div>` : ''}
      ${biz?.website ? `<div style="font-size:11px;color:#555;margin-bottom:6px">${esc(biz.website)}</div>` : ''}
      ${biz?.abn ? `<div style="font-size:12px;font-weight:700">ABN: ${esc(biz.abn)}</div>` : ''}
    </div>
  </div>
  <div style="display:grid;grid-template-columns:1fr 260px;gap:24px;margin-bottom:26px">
    <div style="font-size:28px;font-weight:800;letter-spacing:.3px">PAYMENT RECEIPT</div>
    <div style="background:#f0f0ee;border-radius:4px;padding:12px 16px;font-size:13px">
      <div style="display:flex;justify-content:space-between;margin-bottom:4px"><strong>Receipt No.:</strong><span>${esc(r.id)}</span></div>
      <div style="display:flex;justify-content:space-between"><strong>Date Issued:</strong><span>${auDate(r.date)}</span></div>
    </div>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:20px">
    <div>
      <div style="font-weight:700;margin-bottom:4px">Received From:</div>
      <div style="border-bottom:1px solid #111;padding-bottom:4px;margin-bottom:14px;min-height:18px">${esc(r.client)}</div>
      <div style="font-weight:700;margin-bottom:4px">Property Address:</div>
      ${addrLines.map(l => `<div style="border-bottom:1px solid #111;padding-bottom:4px;margin-bottom:8px;min-height:18px">${esc(l)}</div>`).join('')}
    </div>
    <div>
      <div style="font-weight:700;font-size:15px;border-bottom:1px solid #111;padding-bottom:6px;margin-bottom:10px">PAYMENT RECEIVED</div>
      <div style="margin-bottom:10px"><div style="font-weight:700;font-size:12px;color:#555">Description:</div><div>${esc(r.rec_desc)}</div></div>
      <div style="margin-bottom:10px"><div style="font-weight:700;font-size:12px;color:#555">Amount Received:</div><div style="font-size:16px;font-weight:700">AUD ${money2(r.total_inc_gst)}</div></div>
      <div style="margin-bottom:10px"><div style="font-weight:700;font-size:12px;color:#555">Payment Date:</div><div>${auDate(r.payment_date)}</div></div>
      <div style="margin-bottom:10px">
        <div style="font-weight:700;font-size:12px;color:#555;margin-bottom:4px">Payment Method:</div>
        ${methodRows}
        <div style="display:flex;align-items:center;gap:8px"><span style="font-size:16px">${otherChecked ? '☑' : '☐'}</span><span>Other: <span style="border-bottom:1px solid #111;display:inline-block;min-width:140px">${otherChecked ? esc(r.method_other) : ''}</span></span></div>
      </div>
      ${r.inv_ref ? `<div><div style="font-weight:700;font-size:12px;color:#555">Invoice Reference:</div><div>${esc(r.inv_ref)}</div></div>` : ''}
    </div>
  </div>
  <div style="border-top:1px solid #ccc;padding-top:16px;margin-top:16px;display:grid;grid-template-columns:1fr 220px;align-items:end">
    <div style="font-size:12.5px;color:#333;line-height:1.5">
      Thank you. This receipt confirms that the above payment has been received and will be applied toward the total cost of the painting services as outlined in the quoted invoice.
      <div style="font-family:'Segoe Script','Brush Script MT',cursive;font-size:26px;margin-top:18px">${esc(owner)}</div>
      <div style="border-top:1px solid #111;width:200px;margin-top:-6px"></div>
      <div style="font-weight:700;font-size:12px;margin-top:6px">${esc(owner.toUpperCase())}</div>
      <div style="font-weight:700;font-size:12px">${esc(company)}</div>
    </div>
    <div style="font-family:'Segoe Script','Brush Script MT',cursive;font-size:32px;text-align:center">Thank you!</div>
  </div>
  <div style="background:#111;color:#fff;text-align:center;font-size:11px;letter-spacing:2px;padding:8px 0;margin-top:22px;border-radius:0 0 6px 6px">PROFESSIONAL &bull; RELIABLE &bull; DETAIL FOCUSED</div>
</div>`

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Receipt_${esc(r.id)}</title><style>
*{box-sizing:border-box;margin:0;padding:0}
@page{size:A4 portrait;margin:0}
body{font-family:Arial,Helvetica,sans-serif;background:#fff;color:#111}
@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body>${page}</body></html>`
}

export default function Receipts() {
  const { data: receipts = [], isLoading } = useTable('np_receipts')
  const { data: invoices = [] } = useTable('np_invoices')
  const { data: jobs = [] } = useTable('np_jobs')
  const { data: biz } = useBusinessSettings()
  const upsert = useUpsert()
  const del = useDel()

  const [q, setQ] = useState('')
  const [asc, setAsc] = useState(false)
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState<Row>({})
  const [saving, setSaving] = useState(false)

  const rows = useMemo(() => {
    const s = q.toLowerCase()
    const list = receipts.filter(r => !s || `${r.client ?? ''}${r.id ?? ''}${r.inv_ref ?? ''}`.toLowerCase().includes(s))
    return [...list].sort((a, b) => {
      const da = a.date || '', db = b.date || ''
      return asc ? (da < db ? -1 : da > db ? 1 : 0) : (da > db ? -1 : da < db ? 1 : 0)
    })
  }, [receipts, q, asc])

  const totAmt = receipts.reduce((a, b) => a + (b.total_inc_gst || 0), 0)

  function openNew(prefill?: Row) {
    setForm({
      id: nextReceiptNo(receipts),
      date: today(), payment_date: today(), category: 'Bank Transfer',
      ...(prefill ?? {}),
    })
    setModal(true)
  }

  // Prefill when arriving from an invoice row
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('new') !== '1') return
    let prefill: Row = {}
    try {
      const raw = sessionStorage.getItem('np_prefill_receipt')
      if (raw) { prefill = JSON.parse(raw); sessionStorage.removeItem('np_prefill_receipt') }
    } catch {}
    openNew(prefill)
    window.history.replaceState({}, '', window.location.pathname)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const ef = (k: string) => (e: React.ChangeEvent<any>) => setForm(p => ({ ...p, [k]: e.target.value }))

  // V16 _applyReceiptInvLink()
  function linkInvoice(invId: string) {
    if (!invId) { setForm(p => ({ ...p, inv_ref: '' })); return }
    const inv = invoices.find(i => i.id === invId)
    if (!inv) return
    const job = jobs.find(j => j.id === inv.job_id)
    setForm(p => ({
      ...p,
      client: inv.client || p.client,
      address: job?.address || p.address,
      rec_desc: `Payment — ${inv.notes || 'Painting Services'}`,
      total_inc_gst: inv.received || inv.total_inc_gst || p.total_inc_gst,
      inv_ref: inv.id || '',
      job_id: inv.job_id || null,
    }))
  }

  async function save() {
    if (!form.client?.trim()) { alert('Received From is required'); return }
    setSaving(true)
    try {
      const amount = parseFloat(form.total_inc_gst) || 0
      await upsert.mutateAsync({
        ...form,
        id: form.id || nextReceiptNo(receipts),
        total_inc_gst: amount,
        cost_ex_gst: amount,
        created_at: form.created_at || new Date().toISOString(),
      })
      setModal(false)
    } catch (e: any) { alert('Save failed: ' + e.message) } finally { setSaving(false) }
  }

  function printReceipt(r: Row) {
    const w = window.open('', '_blank')
    if (!w) return
    w.document.write(buildReceiptHTML(r, biz))
    w.document.close()
    setTimeout(() => w.print(), 400)
  }

  async function copyMsg(r: Row) {
    const msg = receiptMessage(r, biz)
    try {
      await navigator.clipboard.writeText(msg)
      alert('Copied! Paste this into an email or text message to send to the client.')
    } catch { prompt('Copy:', msg) }
  }

  if (isLoading) return (
    <div className="flex items-center justify-center h-64"><Loader2 size={20} className="animate-spin text-blue-600" /></div>
  )

  const BTN = 'ml-1 px-1.5 py-1 rounded-md bg-white border border-black/20 hover:bg-[#f5f4f0] align-middle'

  return (
    <div className="p-5">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <h2 className="text-[17px] font-semibold text-gray-900">Receipts</h2>
        <button onClick={() => openNew()}
          className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white font-medium text-[13px] px-3 py-1.5 rounded-lg">
          <Plus size={14} /> New Receipt
        </button>
      </div>

      <div className="grid gap-2.5 mb-3.5" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))' }}>
        {[
          { l: 'Total receipts', v: String(receipts.length) },
          { l: 'Total receipted', v: fmtCurrency(totAmt), c: '#16a34a' },
        ].map(m => (
          <div key={m.l} className="bg-[#f5f4f0] rounded-lg px-4 py-3.5">
            <div className="text-[11px] text-[#666] mb-1">{m.l}</div>
            <div className="text-xl font-semibold" style={m.c ? { color: m.c } : undefined}>{m.v}</div>
          </div>
        ))}
      </div>

      <div className="text-[11px] text-[#666] mb-2 flex items-center gap-1">
        <Info size={12} /> Create a receipt straight from an invoice row (Invoices page) to link it automatically,
        or use "New Receipt" for a standalone receipt.
      </div>

      <div className="flex gap-2 mb-3 flex-wrap items-center">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search..."
          className="w-[220px] px-2.5 py-1.5 text-[12.5px] bg-white border border-black/20 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500" />
        <button onClick={() => setAsc(a => !a)}
          className="flex items-center gap-1 px-2.5 py-1.5 text-[12.5px] bg-white border border-black/20 rounded-lg hover:bg-[#f5f4f0] whitespace-nowrap">
          <ArrowUpDown size={13} /> {asc ? 'Oldest first' : 'Newest first'}
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="bg-white border border-black/[0.12] rounded-xl text-center py-8 text-[#666]">
          <ReceiptText size={32} className="mx-auto mb-2.5 opacity-30" />
          No receipts yet.
        </div>
      ) : (
        <div className="bg-white border border-black/[0.12] rounded-xl overflow-hidden">
          <div className="overflow-auto max-h-[70vh]">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr>
                  {['Receipt No.','Date','Received From','Amount','Method','Invoice Ref',''].map((h, i) => (
                    <th key={i} className="text-left px-2.5 py-[7px] border-b border-black/[0.12] text-[#666] font-medium whitespace-nowrap bg-[#fafaf8] sticky top-0 z-[2]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} className="border-b border-black/[0.06] hover:bg-[#fafaf8]">
                    <td className="px-2.5 py-[7px] font-medium">{r.id || '—'}</td>
                    <td className="px-2.5 py-[7px]">{auDate(r.date) || '—'}</td>
                    <td className="px-2.5 py-[7px]">{r.client || ''}</td>
                    <td className="px-2.5 py-[7px] font-medium">{fmtCurrency(r.total_inc_gst)}</td>
                    <td className="px-2.5 py-[7px] text-xs text-[#666]">
                      {r.category || ''}{r.category === 'Other' && r.method_other ? ` — ${r.method_other}` : ''}
                    </td>
                    <td className="px-2.5 py-[7px] text-[11px]">{r.inv_ref || 'Standalone'}</td>
                    <td className="px-2.5 py-[7px] whitespace-nowrap">
                      <button onClick={() => { setForm({ ...r }); setModal(true) }} title="Edit"
                        className="ml-1 px-1.5 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700 align-middle"><Edit2 size={12} /></button>
                      <button onClick={() => printReceipt(r)} title="Preview / Print" className={BTN}><Printer size={12} /></button>
                      <button onClick={() => copyMsg(r)} title="Copy message to send" className={BTN}><Copy size={12} /></button>
                      <button onClick={() => { if (confirm('Delete this receipt?')) del.mutate(r.id) }} title="Delete"
                        className={BTN} style={{ color: '#c0392b' }}><Trash2 size={12} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal open={modal} onClose={() => setModal(false)} size="lg" title={form.created_at ? 'Edit Receipt' : 'New Receipt'}>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-500 mb-1">Link to invoice (optional)</label>
            <select value={form.inv_ref || ''} onChange={e => linkInvoice(e.target.value)}
              className="w-full bg-white border border-black/20 rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-blue-500">
              <option value="">— None (standalone receipt) —</option>
              {invoices.map(iv => <option key={iv.id} value={iv.id}>{iv.id || '—'} — {iv.client}</option>)}
            </select>
          </div>
          {/* A receipt could only get a job by being linked from an invoice.
              Searchable here so a standalone receipt can be attributed too. */}
          <JobPicker jobs={jobs} value={form.job_id} label="Job (optional)" className="col-span-2"
            onChange={(id, j) => setForm(p => ({
              ...p, job_id: id || null,
              client: j?.client ?? p.client,
              address: (j as any)?.address ?? p.address,
            }))} />
          <Input label="Receipt No." value={form.id || ''} onChange={ef('id')} />
          <Input label="Date Issued" type="date" value={form.date || ''} onChange={ef('date')} />
          <Input label="Received From" value={form.client || ''} onChange={ef('client')} />
          <Input label="Amount Received ($)" type="number" step="0.01" value={form.total_inc_gst ?? ''} onChange={ef('total_inc_gst')} />
          <TextArea label="Property Address" rows={2} value={form.address || ''} onChange={ef('address')} wrapperClassName="col-span-2" />
          <Input label="Description" placeholder="e.g. 10% Deposit — Painting Services"
            value={form.rec_desc || ''} onChange={ef('rec_desc')} wrapperClassName="col-span-2" />
          <Input label="Payment Date" type="date" value={form.payment_date || ''} onChange={ef('payment_date')} />
          <Select label="Payment Method" value={form.category || 'Bank Transfer'} onChange={ef('category')} options={METHODS} />
          {form.category === 'Other' && (
            <Input label="Other method — details" value={form.method_other || ''} onChange={ef('method_other')} />
          )}
          <Input label="Invoice Reference" placeholder="Optional" value={form.inv_ref || ''} onChange={ef('inv_ref')} />
          <Input label="Notes" placeholder="Optional" value={form.notes || ''} onChange={ef('notes')} wrapperClassName="col-span-2" />
        </div>

        <div className="text-[11px] text-[#666] my-2.5">
          Tip: if this receipt is for a deposit or partial payment, adjust "Amount Received" — it defaults to the
          invoice's running total received, not necessarily this single payment.
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t border-black/10">
          <button onClick={() => setModal(false)} className="px-4 py-2 text-[13px] rounded-lg bg-[#f5f4f0] text-gray-600 border border-black/10 hover:bg-gray-200">Cancel</button>
          <button onClick={save} disabled={saving}
            className="flex items-center gap-1.5 px-5 py-2 text-[13px] rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold disabled:opacity-50">
            {saving && <Loader2 size={13} className="animate-spin" />} Save
          </button>
        </div>
      </Modal>
    </div>
  )
}
