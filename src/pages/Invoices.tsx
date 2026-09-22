import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Input, Select, TextArea } from '@/components/ui/Field'
import { fmtCurrency, fmtDate, calcOwed, invStatus, genId, today } from '@/lib/utils'
import { Plus, Search, Loader2, Trash2, CheckCircle, Printer } from 'lucide-react'

type Invoice = Record<string, any>

function useInvoices() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['np_invoices', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('np_invoices').select('*').eq('user_id', user!.id).order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as Invoice[]
    },
    enabled: !!user,
  })
}

function useJobs() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['np_jobs', user?.id],
    queryFn: async () => {
      const { data } = await supabase.from('np_jobs').select('id,client,address,agreed_ex_gst').eq('user_id', user!.id).order('created_at', { ascending: false })
      return (data ?? []) as any[]
    },
    enabled: !!user,
  })
}

function useUpsertInvoice() {
  const qc = useQueryClient()
  const { user } = useAuth()
  return useMutation({
    mutationFn: async (inv: Invoice) => {
      const { error } = await supabase.from('np_invoices').upsert({ ...inv, user_id: user!.id, updated_at: new Date().toISOString() } as any)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['np_invoices'] }),
  })
}

function useDeleteInvoice() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('np_invoices').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['np_invoices'] }),
  })
}

function emptyForm(): Invoice {
  return { date: today(), inv_status: 'Unpaid', gst: 0, total_inc_gst: 0 }
}

const STATUS_FILTERS = ['All', 'Unpaid', 'Part Paid', 'Paid']

export default function Invoices() {
  const { data: invoices = [], isLoading } = useInvoices()
  const { data: jobs = [] } = useJobs()
  const upsert = useUpsertInvoice()
  const del = useDeleteInvoice()

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  const [form, setForm] = useState<Invoice>(emptyForm())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  const filtered = useMemo(() => {
    return invoices.filter(inv => {
      const s = search.toLowerCase()
      const matchSearch = !s || [inv.client, inv.id, inv.job_id, inv.notes].some(v => v?.toLowerCase().includes(s))
      const st = invStatus(inv)
      const matchStatus = statusFilter === 'All' || st === statusFilter
      return matchSearch && matchStatus
    })
  }, [invoices, search, statusFilter])

  // Summary stats
  const totalOwed = invoices.reduce((s, inv) => s + calcOwed(inv), 0)
  const totalReceived = invoices.filter(inv => invStatus(inv) === 'Paid').reduce((s, inv) => s + (inv.agreed_ex_gst ?? 0), 0)
  const overdue = invoices.filter(inv => calcOwed(inv) > 0 && inv.due_date && inv.due_date < today()).length

  function set(k: string, v: any) { setForm(prev => ({ ...prev, [k]: v })) }
  const fld = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    let val: any = e.target.value
    if (k === 'agreed_ex_gst') {
      const ex = parseFloat(val) || 0
      setForm(prev => ({ ...prev, agreed_ex_gst: ex, gst: parseFloat((ex * 0.1).toFixed(2)), total_inc_gst: parseFloat((ex * 1.1).toFixed(2)) }))
      return
    }
    if (k === 'job_id') {
      const job = jobs.find(j => j.id === val)
      setForm(prev => ({ ...prev, job_id: val, client: job?.client || prev.client }))
      return
    }
    set(k, val)
  }

  function openNew() {
    setForm(emptyForm())
    setSelectedId(null)
    setModalOpen(true)
  }

  function openEdit(inv: Invoice) {
    setForm({ ...inv })
    setSelectedId(inv.id)
    setModalOpen(true)
  }

  async function handleSave() {
    setSaving(true)
    try {
      const id = selectedId || genId('INV-')
      await upsert.mutateAsync({ ...form, id, created_at: form.created_at || new Date().toISOString() })
      setModalOpen(false)
    } catch (e: any) {
      alert('Save failed: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  async function markPaid(inv: Invoice) {
    await upsert.mutateAsync({ ...inv, manual_paid: true, date_paid: inv.date_paid || today() })
  }

  async function handleDelete() {
    if (!selectedId || !confirm('Delete this invoice?')) return
    await del.mutateAsync(selectedId)
    setModalOpen(false)
  }

  function printInvoice(inv: Invoice) {
    const html = buildInvoiceHTML(inv)
    const w = window.open('', '_blank')
    if (w) { w.document.write(html); w.document.close(); w.print() }
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-gray-800 space-y-3 shrink-0">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold text-white">Invoices</h1>
          <button onClick={openNew} className="flex items-center gap-1.5 bg-yellow-400 hover:bg-yellow-300 text-gray-900 font-semibold text-sm px-3 py-1.5 rounded-lg transition-colors">
            <Plus size={14} /> New invoice
          </button>
        </div>

        {/* Summary row */}
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-gray-800 rounded-lg p-3">
            <p className="text-xs text-gray-500">Outstanding</p>
            <p className="text-lg font-bold text-amber-400">{fmtCurrency(totalOwed)}</p>
          </div>
          <div className="bg-gray-800 rounded-lg p-3">
            <p className="text-xs text-gray-500">Received (paid)</p>
            <p className="text-lg font-bold text-green-400">{fmtCurrency(totalReceived)}</p>
          </div>
          <div className="bg-gray-800 rounded-lg p-3">
            <p className="text-xs text-gray-500">Overdue</p>
            <p className={`text-lg font-bold ${overdue > 0 ? 'text-red-400' : 'text-gray-400'}`}>{overdue}</p>
          </div>
        </div>

        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search client, invoice number…"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-8 pr-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-yellow-400" />
        </div>
        <div className="flex gap-1.5">
          {STATUS_FILTERS.map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`text-xs px-3 py-1 rounded-full transition-colors ${statusFilter === s ? 'bg-yellow-400 text-gray-900 font-semibold' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading && <div className="flex items-center justify-center py-16"><Loader2 size={20} className="animate-spin text-yellow-400" /></div>}
        {!isLoading && filtered.length === 0 && <div className="text-center py-16 text-gray-500 text-sm">No invoices found</div>}
        <div className="divide-y divide-gray-800">
          {filtered.map(inv => {
            const st = invStatus(inv)
            const owed = calcOwed(inv)
            return (
              <div key={inv.id} className="flex items-center px-6 py-4 hover:bg-gray-800/30 transition-colors">
                <button className="flex-1 text-left min-w-0" onClick={() => openEdit(inv)}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        <span className="text-xs font-mono text-gray-500">{inv.id}</span>
                        <Badge label={st} />
                        {inv.due_date && inv.due_date < today() && owed > 0 && (
                          <Badge label="Overdue" variant="red" />
                        )}
                      </div>
                      <div className="text-sm font-semibold text-white">{inv.client || '—'}</div>
                      <div className="text-xs text-gray-400">{inv.job_id} · {fmtDate(inv.date)}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-bold text-white">{fmtCurrency(inv.total_inc_gst)}</div>
                      {owed > 0 && <div className="text-xs text-amber-400">owed {fmtCurrency(owed)}</div>}
                      {st === 'Paid' && <div className="text-xs text-green-400">paid {fmtDate(inv.date_paid)}</div>}
                    </div>
                  </div>
                </button>
                <div className="flex items-center gap-1.5 ml-3 shrink-0">
                  {st !== 'Paid' && (
                    <button onClick={() => markPaid(inv)} title="Mark paid"
                      className="p-1.5 rounded-lg text-gray-500 hover:text-green-400 hover:bg-green-400/10 transition-colors">
                      <CheckCircle size={15} />
                    </button>
                  )}
                  <button onClick={() => printInvoice(inv)} title="Print"
                    className="p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-gray-700 transition-colors">
                    <Printer size={15} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} size="lg"
        title={selectedId ? `Edit invoice ${selectedId}` : 'New Invoice'}>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-400 mb-1">Linked job</label>
            <select value={form.job_id || ''} onChange={fld('job_id')}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-yellow-400">
              <option value="">— No job —</option>
              {jobs.map(j => <option key={j.id} value={j.id}>{j.id} — {j.client}</option>)}
            </select>
          </div>
          <Input label="Client" value={form.client || ''} onChange={fld('client')} />
          <Input label="Invoice date" type="date" value={form.date || ''} onChange={fld('date')} />
          <Input label="Due date" type="date" value={form.due_date || ''} onChange={fld('due_date')} />
          <Input label="Amount ex GST ($)" type="number" value={form.agreed_ex_gst || ''} onChange={fld('agreed_ex_gst')} min={0} />
          <Input label="GST ($)" type="number" value={form.gst || ''} readOnly className="opacity-60 cursor-not-allowed" />
          <Input label="Total inc GST ($)" type="number" value={form.total_inc_gst || ''} readOnly className="opacity-60 cursor-not-allowed" />
          <Input label="Amount received ($)" type="number" value={form.received || ''} onChange={e => {
            const received = parseFloat(e.target.value) || 0
            const paid = received >= (form.total_inc_gst || 0)
            setForm(prev => ({ ...prev, received, manual_paid: paid, date_paid: paid ? (prev.date_paid || today()) : prev.date_paid }))
          }} min={0} />
          <Input label="Date paid" type="date" value={form.date_paid || ''} onChange={fld('date_paid')} />
          <Input label="Deposit ($)" type="number" value={form.deposit || ''} onChange={e => set('deposit', parseFloat(e.target.value) || 0)} />
          <Input label="Deposit date" type="date" value={form.deposit_date || ''} onChange={fld('deposit_date')} />
          <div className="col-span-2 flex items-center gap-2">
            <input type="checkbox" id="manual-paid" checked={!!form.manual_paid} onChange={e => set('manual_paid', e.target.checked)}
              className="w-4 h-4 accent-yellow-400" />
            <label htmlFor="manual-paid" className="text-sm text-gray-300">Mark as paid (override)</label>
          </div>
          <TextArea label="Notes" value={form.notes || ''} onChange={fld('notes')} wrapperClassName="col-span-2" />
        </div>

        <div className="flex justify-between mt-5 pt-4 border-t border-gray-800">
          <div>{selectedId && <button onClick={handleDelete} className="flex items-center gap-1.5 text-sm text-red-400 hover:text-red-300"><Trash2 size={14} /> Delete</button>}</div>
          <div className="flex gap-2">
            <button onClick={() => setModalOpen(false)} className="text-sm px-4 py-2 rounded-lg bg-gray-800 text-gray-400 hover:text-white">Cancel</button>
            <button onClick={handleSave} disabled={saving}
              className="flex items-center gap-1.5 text-sm px-5 py-2 rounded-lg bg-yellow-400 hover:bg-yellow-300 text-gray-900 font-semibold disabled:opacity-50">
              {saving && <Loader2 size={13} className="animate-spin" />} Save
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

// ── Invoice print HTML ───────────────────────────────────────
function buildInvoiceHTML(inv: Invoice): string {
  const exGST = inv.agreed_ex_gst ?? 0
  const gst = inv.gst ?? exGST * 0.1
  const total = inv.total_inc_gst ?? exGST * 1.1
  const received = inv.received ?? 0
  const owed = Math.max(0, total - received)
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Invoice ${inv.id}</title>
<style>
  body{font-family:Arial,sans-serif;font-size:13px;color:#1a1a18;margin:0;padding:40px}
  .header{display:flex;justify-content:space-between;margin-bottom:32px}
  .company{font-size:22px;font-weight:700;color:#1a1a18}
  .inv-title{font-size:28px;font-weight:700;color:#2563eb;text-align:right}
  table{width:100%;border-collapse:collapse;margin:16px 0}
  th{background:#f5f4f0;padding:8px 12px;text-align:left;font-size:12px;color:#666;border-bottom:1px solid #ddd}
  td{padding:8px 12px;border-bottom:1px solid #eee}
  .total-row td{font-weight:700;font-size:14px;border-top:2px solid #ddd}
  .footer{margin-top:32px;padding-top:16px;border-top:1px solid #ddd;font-size:11px;color:#888}
</style></head><body>
<div class="header">
  <div><div class="company">Northern Painters</div><div style="color:#666;margin-top:4px">ABN: — · NSW Fair Trading Licence</div></div>
  <div><div class="inv-title">TAX INVOICE</div><div style="text-align:right;color:#666;margin-top:4px">Invoice #${inv.id || ''}<br>Date: ${fmtDate(inv.date)}<br>${inv.due_date ? 'Due: ' + fmtDate(inv.due_date) : ''}</div></div>
</div>
<div style="margin-bottom:24px"><strong>Bill to:</strong><br>${inv.client || ''}<br>${inv.address || ''}</div>
<table>
  <thead><tr><th>Description</th><th style="text-align:right">Amount</th></tr></thead>
  <tbody>
    <tr><td>${inv.notes || 'Painting services'}</td><td style="text-align:right">${fmtCurrency(exGST)}</td></tr>
    <tr><td>GST (10%)</td><td style="text-align:right">${fmtCurrency(gst)}</td></tr>
    <tr class="total-row"><td>Total inc GST</td><td style="text-align:right">${fmtCurrency(total)}</td></tr>
    ${received > 0 ? `<tr><td>Amount received</td><td style="text-align:right">(${fmtCurrency(received)})</td></tr><tr class="total-row"><td>Balance owing</td><td style="text-align:right">${fmtCurrency(owed)}</td></tr>` : ''}
  </tbody>
</table>
<div style="background:#f5f4f0;padding:16px;border-radius:8px;margin-top:16px">
  <strong>Payment details</strong><br>
  Bank Transfer: BSB 067 873 · Account 2252 1951<br>
  Reference: ${inv.id || inv.client || ''}
</div>
<div class="footer">This invoice is issued in accordance with the Building and Construction Industry Security of Payment Act 1999 (NSW).</div>
</body></html>`
}
