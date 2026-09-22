import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Modal } from '@/components/ui/Modal'
import { Input, TextArea } from '@/components/ui/Field'
import { fmtCurrency, fmtDate, calcOwed, invStatus, genId, today } from '@/lib/utils'
import {
  Plus, Loader2, Trash2, Check, Banknote, Edit2, FileText, Receipt,
  ArrowUpDown, List, BarChart3, Info, MapPin,
} from 'lucide-react'
import { useBusinessSettings } from '@/pages/SettingsPage'

type Invoice = Record<string, any>

const cashOf = (inv: Invoice) => inv?.extra?.cash_received ?? 0

// V16 ibadge()
const IBADGE: Record<string, string> = {
  'Paid':      'bg-[#dcfce7] text-[#166534]',
  'Part Paid': 'bg-[#fef3c7] text-[#92400e]',
  'Unpaid':    'bg-[#fee2e2] text-[#991b1b]',
}
function IBadge({ s }: { s: string }) {
  return <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap ${IBADGE[s] || 'bg-[#f1f0e8] text-[#5f5e5a]'}`}>{s || 'Unpaid'}</span>
}

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
      const { data } = await supabase.from('np_jobs').select('*').eq('user_id', user!.id).order('created_at', { ascending: false })
      return (data ?? []) as any[]
    },
    enabled: !!user,
  })
}

function usePaySchedules() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['np_pay_schedules', user?.id],
    queryFn: async () => {
      const { data } = await supabase.from('np_pay_schedules').select('*').eq('user_id', user!.id)
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

const II = 'border-none bg-transparent text-[12.5px] w-full focus:outline-none focus:bg-blue-50/60 rounded px-0.5'
const BTN = 'ml-1 px-1.5 py-1 rounded-md bg-white border border-black/20 hover:bg-[#f5f4f0] align-middle inline-flex items-center gap-1 text-[11px]'

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`bg-white border border-black/[0.12] rounded-xl ${className}`}>{children}</div>
}

export default function Invoices() {
  const { data: invoices = [], isLoading } = useInvoices()
  const { data: jobs = [] } = useJobs()
  const { data: paySchedules = [] } = usePaySchedules()
  const { data: bizSettings } = useBusinessSettings()
  const upsert = useUpsertInvoice()
  const del = useDeleteInvoice()
  const nav = useNavigate()

  const [view, setView] = useState<'list' | 'byjob'>('list')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [asc, setAsc] = useState(false)
  const [form, setForm] = useState<Invoice>(emptyForm())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  const filtered = useMemo(() => {
    const rows = invoices.filter(inv => {
      const s = search.toLowerCase()
      if (s && !`${inv.client ?? ''}${inv.id ?? ''}${inv.job_id ?? ''}`.toLowerCase().includes(s)) return false
      if (statusFilter && invStatus(inv) !== statusFilter) return false
      return true
    })
    return rows.sort((a, b) => {
      const da = a.date || '', db = b.date || ''
      return asc ? (da < db ? -1 : da > db ? 1 : 0) : (da > db ? -1 : da < db ? 1 : 0)
    })
  }, [invoices, search, statusFilter, asc])

  // V16 KPI totals
  const totI = invoices.reduce((a, b) => a + (b.total_inc_gst || 0), 0)
  const totR = invoices.reduce((a, b) => a + (b.received || 0), 0)
  const totO = invoices.reduce((a, b) => a + calcOwed(b), 0)
  const totCash = invoices.reduce((a, b) => a + cashOf(b), 0)

  function set(k: string, v: any) { setForm(prev => ({ ...prev, [k]: v })) }
  const fld = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const val: any = e.target.value
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

  function openNew(prefill?: Invoice) {
    setForm({ ...emptyForm(), ...(prefill ?? {}) })
    setSelectedId(null)
    setModalOpen(true)
  }
  function openEdit(inv: Invoice) {
    setForm({ ...inv }); setSelectedId(inv.id); setModalOpen(true)
  }

  async function handleSave() {
    setSaving(true)
    try {
      const id = selectedId || genId('INV-')
      await upsert.mutateAsync({ ...form, id, created_at: form.created_at || new Date().toISOString() })
      setModalOpen(false)
    } catch (e: any) { alert('Save failed: ' + e.message) } finally { setSaving(false) }
  }

  async function handleDelete() {
    if (!selectedId || !confirm('Delete this invoice?')) return
    await del.mutateAsync(selectedId)
    setModalOpen(false)
  }

  // V16 markInvPaid()
  async function markInvPaid(inv: Invoice) {
    await upsert.mutateAsync({
      ...inv, manual_paid: true,
      received: inv.received || inv.total_inc_gst || 0,
      date_paid: inv.date_paid || today(),
    })
  }

  // V16 recordCashPayment()
  async function recordCash(inv: Invoice) {
    const amt = prompt('Cash amount received ($):', String(inv.received || inv.total_inc_gst || ''))
    if (amt === null) return
    const v = parseFloat(amt) || 0
    const total = inv.total_inc_gst || 0
    const received = Math.min(total, (inv.received || 0) + v)
    const fullyPaid = received >= total || inv.manual_paid
    await upsert.mutateAsync({
      ...inv,
      extra: { ...(inv.extra ?? {}), cash_received: cashOf(inv) + v },
      received,
      manual_paid: fullyPaid ? true : inv.manual_paid,
      date_paid: fullyPaid ? (inv.date_paid || today()) : inv.date_paid,
    })
  }

  // V16 inline received edit
  async function setReceived(inv: Invoice, raw: string) {
    const received = parseFloat(raw) || 0
    const total = inv.total_inc_gst || 0
    const fullyPaid = received >= total
    await upsert.mutateAsync({
      ...inv, received,
      manual_paid: fullyPaid ? true : inv.manual_paid,
      date_paid: fullyPaid ? (inv.date_paid || today()) : inv.date_paid,
    })
  }

  async function deleteRow(inv: Invoice) {
    if (!confirm('Delete this invoice?')) return
    await del.mutateAsync(inv.id)
  }

  function printInvoice(inv: Invoice) {
    const html = buildInvoiceHTML(inv, bizSettings)
    const w = window.open('', '_blank')
    if (w) { w.document.write(html); w.document.close(); setTimeout(() => w.print(), 400) }
  }

  function newReceiptFor(inv: Invoice) {
    try {
      sessionStorage.setItem('np_prefill_receipt', JSON.stringify({
        job_id: inv.job_id, client: inv.client,
        cost_ex_gst: inv.agreed_ex_gst, total_inc_gst: inv.total_inc_gst,
        rec_desc: inv.notes, date: today(),
      }))
    } catch {}
    nav('/receipts?new=1')
  }

  return (
    <div className="p-5">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <h2 className="text-[17px] font-semibold text-gray-900">Invoices</h2>
        <button onClick={() => openNew()}
          className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white font-medium text-[13px] px-3 py-1.5 rounded-lg transition-colors">
          <Plus size={14} /> New Invoice
        </button>
      </div>

      {/* KPI metrics */}
      <div className="grid gap-2.5 mb-3.5" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))' }}>
        {[
          { l: 'Total invoiced (inc GST)', v: fmtCurrency(totI), c: '#2563eb' },
          { l: 'Total received', v: fmtCurrency(totR), c: '#16a34a' },
          { l: 'Still owed', v: fmtCurrency(totO), c: '#dc2626' },
          { l: 'Cash received', v: fmtCurrency(totCash), c: '#d97706' },
        ].map(m => (
          <div key={m.l} className="bg-[#f5f4f0] rounded-lg px-4 py-3.5">
            <div className="text-[11px] text-[#666] mb-1">{m.l}</div>
            <div className="text-xl font-semibold" style={{ color: m.c }}>{m.v}</div>
          </div>
        ))}
      </div>

      {/* View toggle */}
      <div className="flex gap-[3px] bg-[#f5f4f0] border border-black/[0.12] rounded-lg p-[3px] mb-2.5 w-fit">
        <button onClick={() => setView('list')}
          className={`flex items-center gap-1 text-xs px-3.5 py-1.5 rounded-md ${view !== 'byjob' ? 'bg-blue-600 text-white' : 'text-[#666]'}`}>
          <List size={12} /> Invoices
        </button>
        <button onClick={() => setView('byjob')}
          className={`flex items-center gap-1 text-xs px-3.5 py-1.5 rounded-md ${view === 'byjob' ? 'bg-blue-600 text-white' : 'text-[#666]'}`}>
          <BarChart3 size={12} /> By Job
        </button>
      </div>

      {view === 'byjob' ? (
        <JobFinancialSummary
          jobs={jobs} invoices={invoices} paySchedules={paySchedules}
          onMarkPaid={markInvPaid} onCash={recordCash} onPreview={printInvoice}
          onNewInvoice={j => openNew({
            job_id: j.id, client: j.client, notes: j.job_desc || '',
            agreed_ex_gst: j.agreed_ex_gst ?? undefined,
            gst: j.agreed_ex_gst ? +(j.agreed_ex_gst * 0.1).toFixed(2) : 0,
            total_inc_gst: j.agreed_ex_gst ? +(j.agreed_ex_gst * 1.1).toFixed(2) : 0,
          })}
        />
      ) : (
        <>
          <div className="text-[11px] text-[#666] mb-2 flex items-center gap-1">
            <Info size={12} /> Edit received amount inline. <b>Mark Paid</b> marks as fully paid regardless of amount. <b>Cash</b> records a cash payment.
          </div>

          <div className="flex gap-2 mb-3 flex-wrap items-center">
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..."
              className="w-[200px] px-2.5 py-1.5 text-[12.5px] bg-white border border-black/20 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500" />
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
              className="px-2.5 py-1.5 text-[12.5px] bg-white border border-black/20 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500">
              <option value="">All statuses</option>
              {['Paid', 'Part Paid', 'Unpaid'].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <button onClick={() => setAsc(a => !a)}
              className="flex items-center gap-1 px-2.5 py-1.5 text-[12.5px] bg-white border border-black/20 rounded-lg hover:bg-[#f5f4f0] whitespace-nowrap">
              <ArrowUpDown size={13} /> {asc ? 'Oldest first' : 'Newest first'}
            </button>
          </div>

          <Card className="overflow-hidden">
            {isLoading ? (
              <div className="flex items-center justify-center py-16"><Loader2 size={20} className="animate-spin text-blue-600" /></div>
            ) : (
              <div className="overflow-auto max-h-[70vh]">
                <table className="w-full border-collapse text-[12.5px]">
                  <thead>
                    <tr>
                      {['Job','Client','Invoice #','Description','Inc GST','Received ($)','Cash','Owed','Status',''].map((h, i) => (
                        <th key={i} className="text-left px-2.5 py-[7px] border-b border-black/[0.12] text-[#666] font-medium whitespace-nowrap bg-[#fafaf8] sticky top-0 z-[2]">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(inv => {
                      const owed = calcOwed(inv), ist = invStatus(inv), cash = cashOf(inv)
                      return (
                        <tr key={inv.id} className="border-b border-black/[0.06] hover:bg-[#fafaf8]">
                          <td className="px-2.5 py-[7px] text-[#2563eb] font-medium whitespace-nowrap">
                            <button onClick={() => setView('byjob')} className="hover:underline">{inv.job_id || '—'}</button>
                          </td>
                          <td className="px-2.5 py-[7px] text-xs">{inv.client}</td>
                          <td className="px-2.5 py-[7px] text-[11px]">{inv.id || '—'}</td>
                          <td className="px-2.5 py-[7px] text-xs text-[#666] max-w-[130px] truncate">{inv.notes || ''}</td>
                          <td className="px-2.5 py-[7px] font-medium">{fmtCurrency(inv.total_inc_gst)}</td>
                          <td className="px-2.5 py-[7px]">
                            <input type="number" step="0.01" defaultValue={inv.received || ''} placeholder="0" className={II} style={{ width: 80 }}
                              onBlur={e => { if ((parseFloat(e.target.value) || 0) !== (inv.received || 0)) setReceived(inv, e.target.value) }} />
                          </td>
                          <td className="px-2.5 py-[7px] text-[11px] text-center">
                            {cash ? (
                              <span className="bg-[#fef3c7] text-[#92400e] rounded px-1.5 py-0.5 text-[10px] font-bold whitespace-nowrap">💵 {fmtCurrency(cash)}</span>
                            ) : '—'}
                          </td>
                          <td className="px-2.5 py-[7px] font-medium" style={{ color: owed > 0 ? '#c0392b' : '#0a7c4e' }}>
                            {owed > 0 ? fmtCurrency(owed) : 'Paid'}
                          </td>
                          <td className="px-2.5 py-[7px]"><IBadge s={ist} /></td>
                          <td className="px-2.5 py-[7px] whitespace-nowrap">
                            {ist !== 'Paid' && (
                              <button onClick={() => markInvPaid(inv)} title="Mark as fully paid"
                                className="ml-1 px-1.5 py-1 rounded-md bg-[#dcfce7] text-[#166534] border border-[#dcfce7] text-[11px] inline-flex items-center gap-1 align-middle hover:brightness-95">
                                <Check size={11} /> Mark Paid
                              </button>
                            )}
                            <button onClick={() => recordCash(inv)} title="Record cash payment"
                              className="ml-1 px-1.5 py-1 rounded-md bg-[#fef3c7] text-[#92400e] border border-[#fde68a] text-[11px] inline-flex items-center gap-1 align-middle hover:brightness-95">
                              <Banknote size={11} /> Cash
                            </button>
                            <button onClick={() => openEdit(inv)} title="Edit"
                              className="ml-1 px-1.5 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700 align-middle"><Edit2 size={12} /></button>
                            <button onClick={() => printInvoice(inv)} title="Preview" className={BTN}><FileText size={12} /></button>
                            <button onClick={() => newReceiptFor(inv)} title="Receipt"
                              className="ml-1 px-1.5 py-1 rounded-md bg-[#dcfce7] text-[#166534] border border-[#dcfce7] align-middle hover:brightness-95"><Receipt size={12} /></button>
                            <button onClick={() => deleteRow(inv)} title="Delete" className={BTN} style={{ color: '#c0392b' }}><Trash2 size={12} /></button>
                          </td>
                        </tr>
                      )
                    })}
                    {filtered.length === 0 && (
                      <tr><td colSpan={10} className="text-center py-16 text-[#666]">No invoices found</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} size="lg"
        title={selectedId ? `Edit invoice ${selectedId}` : 'New Invoice'}>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-500 mb-1">Linked job</label>
            <select value={form.job_id || ''} onChange={fld('job_id')}
              className="w-full bg-white border border-black/20 rounded-lg px-3 py-2 text-[13px] text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500">
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
              className="w-4 h-4 accent-blue-600" />
            <label htmlFor="manual-paid" className="text-[13px] text-gray-600">Mark as paid (override)</label>
          </div>
          <TextArea label="Description / notes" value={form.notes || ''} onChange={fld('notes')} wrapperClassName="col-span-2" />
        </div>

        <div className="flex justify-between mt-5 pt-4 border-t border-black/10">
          <div>{selectedId && <button onClick={handleDelete} className="flex items-center gap-1.5 text-[13px] text-red-500 hover:text-red-700"><Trash2 size={14} /> Delete</button>}</div>
          <div className="flex gap-2">
            <button onClick={() => setModalOpen(false)} className="text-[13px] px-4 py-2 rounded-lg bg-[#f5f4f0] text-gray-600 hover:bg-gray-200 border border-black/10">Cancel</button>
            <button onClick={handleSave} disabled={saving}
              className="flex items-center gap-1.5 text-[13px] px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold disabled:opacity-50">
              {saving && <Loader2 size={13} className="animate-spin" />} Save
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

// ── V16 _renderJobFinancialSummary() ─────────────────────────
function JobFinancialSummary({ jobs, invoices, paySchedules, onMarkPaid, onCash, onPreview, onNewInvoice }: {
  jobs: any[]; invoices: Invoice[]; paySchedules: any[]
  onMarkPaid: (inv: Invoice) => void; onCash: (inv: Invoice) => void
  onPreview: (inv: Invoice) => void; onNewInvoice: (j: any) => void
}) {
  const jobsToShow = jobs.filter(j =>
    invoices.some(i => i.job_id === j.id) ||
    ['Accepted', 'Booked'].includes(j.quote_status) ||
    ['In Progress', 'Scheduled', 'Not Started', 'Hourly Rate Accepted'].includes(j.status)
  ).sort((a, b) => (a.id || '').localeCompare(b.id || ''))

  if (!jobsToShow.length) return (
    <Card className="text-center py-8 text-[#666]">No active or invoiced jobs yet.</Card>
  )

  const Tile = ({ label, value, valueColor, sub, subColor, borderColor }: {
    label: string; value: string; valueColor: string; sub?: string; subColor?: string; borderColor?: string
  }) => (
    <div className="bg-[#f5f4f0] rounded-[7px] px-2.5 py-2 text-center"
      style={{ border: `1px solid ${borderColor ?? 'rgba(0,0,0,.12)'}` }}>
      <div className="text-[9px] font-bold uppercase text-[#666] tracking-wider mb-1">{label}</div>
      <div className="font-mono text-[15px] font-bold" style={{ color: valueColor }}>{value}</div>
      {sub && <div className="text-[9px]" style={{ color: subColor ?? '#999' }}>{sub}</div>}
    </div>
  )

  return (
    <>
      <div className="text-[11px] text-[#666] mb-2.5 flex items-center gap-1">
        <Info size={12} /> Shows all active, accepted, and invoiced jobs. Job value is the agreed price inc GST.
        Left to invoice = job value minus total invoiced.
      </div>
      {jobsToShow.map(j => {
        const invs = invoices.filter(i => i.job_id === j.id)
        const terms = (j.terms || '').toLowerCase()
        const isEstimate = terms.includes('estimate') || terms.includes('hourly')
        const jobValueExGST = j.agreed_ex_gst || j.quote_ex_gst || 0
        const jobValueIncGST = jobValueExGST * 1.1
        const totalInvoiced = invs.reduce((s, i) => s + (i.total_inc_gst || 0), 0)
        const totalReceived = invs.reduce((s, i) => s + (i.received || 0), 0)
        const cashReceived = invs.reduce((s, i) => s + cashOf(i), 0)
        const totalOwed = invs.reduce((s, i) => s + calcOwed(i), 0)

        // Deposit from pay schedule milestones (stored as JSON in notes)
        let depositAmt = 0, depositPaid = false
        const ps = paySchedules.find(s => s.id === j.id)
        if (ps?.notes) {
          try {
            const ms = JSON.parse(ps.notes)
            if (Array.isArray(ms) && ms[0]) { depositAmt = ms[0].amount || 0; depositPaid = !!ms[0].received }
          } catch {}
        }

        const leftToInvoice = Math.max(0, jobValueIncGST - totalInvoiced)
        const invoicePct = jobValueIncGST > 0 ? Math.min(100, (totalInvoiced / jobValueIncGST) * 100) : 0
        const paidPct = totalInvoiced > 0 ? Math.min(100, (totalReceived / totalInvoiced) * 100) : 0

        return (
          <Card key={j.id} className="px-4 py-3.5 mb-2.5">
            <div className="flex justify-between items-start flex-wrap gap-2 mb-3">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[13px] font-bold text-[#2563eb]">{j.id}</span>
                  <span className="text-sm font-bold">{j.client}</span>
                  {j.address && (
                    <span className="text-[11px] text-[#666] inline-flex items-center gap-0.5">
                      <MapPin size={10} /> {j.address.split(',')[0]}
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-[#666] mt-1">
                  {j.job_desc || j.type || ''} ·{' '}
                  {isEstimate
                    ? <span className="text-[#d97706] font-semibold">Estimate / Hourly</span>
                    : <span className="text-[#0369a1] font-semibold">Fixed price</span>}
                </div>
              </div>
              <button onClick={() => onNewInvoice(j)}
                className="flex items-center gap-1 px-2.5 py-1 text-[11px] bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                <Plus size={11} /> New Invoice
              </button>
            </div>

            <div className="grid gap-2 mb-3" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(130px,1fr))' }}>
              <Tile label={isEstimate ? 'Budget / Est.' : 'Job Value'} value={jobValueIncGST ? fmtCurrency(jobValueIncGST) : '—'} valueColor="#2563eb" sub="inc GST" />
              <Tile label="Invoiced" value={fmtCurrency(totalInvoiced)} valueColor="#1d4ed8" sub={`${invs.length} invoice${invs.length !== 1 ? 's' : ''}`} />
              <Tile label="Received" value={fmtCurrency(totalReceived)} valueColor="#16a34a"
                sub={cashReceived ? `💵 ${fmtCurrency(cashReceived)} cash` : undefined} subColor="#92400e" />
              <Tile label="Outstanding" value={totalOwed > 0 ? fmtCurrency(totalOwed) : 'Paid ✓'}
                valueColor={totalOwed > 0 ? '#dc2626' : '#16a34a'} sub="left to pay"
                borderColor={totalOwed > 0 ? '#fca5a5' : undefined} />
              {!isEstimate && jobValueIncGST > 0 && (
                <Tile label="Left to Invoice" value={leftToInvoice > 0 ? fmtCurrency(leftToInvoice) : 'Done ✓'}
                  valueColor={leftToInvoice > 0 ? '#d97706' : '#16a34a'} sub={`of ${fmtCurrency(jobValueIncGST)}`}
                  borderColor={leftToInvoice > 0 ? '#fde68a' : undefined} />
              )}
              {depositAmt > 0 && (
                <Tile label="Deposit" value={fmtCurrency(depositAmt)}
                  valueColor={depositPaid ? '#16a34a' : '#d97706'}
                  sub={depositPaid ? 'Received ✓' : 'Pending'} subColor={depositPaid ? '#16a34a' : '#d97706'}
                  borderColor={depositPaid ? '#86efac' : '#fde68a'} />
              )}
            </div>

            {jobValueIncGST > 0 && (
              <>
                <div className="mb-2">
                  <div className="flex justify-between text-[10px] text-[#666] mb-1">
                    <span>{isEstimate ? 'Budget used' : 'Invoiced'} ({invoicePct.toFixed(0)}%)</span>
                    <span>{fmtCurrency(totalInvoiced)} of {fmtCurrency(jobValueIncGST)}</span>
                  </div>
                  <div className="h-1.5 bg-black/[0.12] rounded-[3px] overflow-hidden">
                    <div className="h-full bg-[#1d4ed8] rounded-[3px] transition-all" style={{ width: `${invoicePct}%` }} />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-[10px] text-[#666] mb-1">
                    <span>Paid ({paidPct.toFixed(0)}%)</span>
                    <span>{fmtCurrency(totalReceived)} of {fmtCurrency(totalInvoiced)}</span>
                  </div>
                  <div className="h-1.5 bg-black/[0.12] rounded-[3px] overflow-hidden">
                    <div className="h-full bg-[#16a34a] rounded-[3px] transition-all" style={{ width: `${paidPct}%` }} />
                  </div>
                </div>
              </>
            )}

            {invs.length ? (
              <div className="mt-2.5 border-t border-black/[0.12] pt-2">
                <div className="text-[10px] font-bold uppercase text-[#666] mb-1.5 tracking-wider">Invoices</div>
                {invs.map((inv, idx) => {
                  const ist = invStatus(inv), cash = cashOf(inv)
                  return (
                    <div key={inv.id} className="flex items-center gap-2 py-1.5 border-b border-black/[0.05] flex-wrap">
                      <span className="text-[11px] font-mono text-[#666] min-w-[60px]">{inv.id || `INV-${idx}`}</span>
                      <span className="flex-1 text-xs min-w-[100px]">{inv.notes || ''}</span>
                      <span className="text-xs font-mono font-semibold">{fmtCurrency(inv.total_inc_gst)}</span>
                      {cash > 0 && <span className="text-[10px] bg-[#fef3c7] text-[#92400e] rounded px-1.5 py-px">💵 {fmtCurrency(cash)}</span>}
                      <IBadge s={ist} />
                      {ist !== 'Paid' && (
                        <button onClick={() => onMarkPaid(inv)}
                          className="text-[10px] px-1.5 py-1 rounded-md bg-[#dcfce7] text-[#166534] border border-[#dcfce7] hover:brightness-95">✓ Paid</button>
                      )}
                      <button onClick={() => onCash(inv)}
                        className="text-[10px] px-1.5 py-1 rounded-md bg-[#fef3c7] text-[#92400e] border border-[#fde68a] hover:brightness-95">💵 Cash</button>
                      <button onClick={() => onPreview(inv)}
                        className="text-[10px] px-1.5 py-1 rounded-md bg-white border border-black/20 hover:bg-[#f5f4f0]"><FileText size={11} /></button>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="mt-2.5 text-xs text-[#666] text-center py-2">No invoices yet for this job.</div>
            )}
          </Card>
        )
      })}
    </>
  )
}

// ── Invoice print HTML ───────────────────────────────────────
function buildInvoiceHTML(inv: Invoice, biz?: any): string {
  const exGST = inv.agreed_ex_gst ?? 0
  const gst = inv.gst ?? exGST * 0.1
  const total = inv.total_inc_gst ?? exGST * 1.1
  const received = inv.received ?? 0
  const deposit = inv.deposit ?? 0
  const owed = Math.max(0, total - received - deposit)
  const companyName = biz?.company_name || 'Northern Painters'
  const abn = biz?.abn ? `ABN: ${biz.abn}` : ''
  const licence = biz?.licence ? ` · Licence: ${biz.licence}` : ''
  const hasBankDetails = biz?.bsb || biz?.account_no
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Invoice ${inv.id}</title>
<style>
  body{font-family:Arial,sans-serif;font-size:13px;color:#111;margin:0;padding:40px;max-width:800px}
  .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:32px}
  .company{font-size:22px;font-weight:700} .meta{color:#555;font-size:12px;line-height:1.8;margin-top:4px}
  .inv-title{font-size:28px;font-weight:700;color:#1d4ed8;text-align:right}
  .inv-meta{text-align:right;color:#555;font-size:12px;line-height:1.8;margin-top:4px}
  table{width:100%;border-collapse:collapse;margin:16px 0}
  th{background:#f5f5f3;padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#555;border-bottom:1px solid #ddd}
  td{padding:8px 12px;border-bottom:1px solid #eee}
  .total-row td{font-weight:700;font-size:14px;border-top:2px solid #ddd;border-bottom:none}
  .payment{background:#f5f5f3;padding:16px;border-radius:8px;margin-top:16px;font-size:12px}
  .footer{margin-top:32px;padding-top:16px;border-top:1px solid #ddd;font-size:11px;color:#999}
  @media print{body{padding:24px}}
</style></head><body>
<div class="header">
  <div>
    <div class="company">${companyName}</div>
    <div class="meta">${abn}${licence}${biz?.address ? '<br>' + biz.address : ''}${biz?.phone ? '<br>' + biz.phone : ''}${biz?.email ? ' · ' + biz.email : ''}</div>
  </div>
  <div>
    <div class="inv-title">TAX INVOICE</div>
    <div class="inv-meta">Invoice #${inv.id || ''}<br>Date: ${fmtDate(inv.date)}${inv.due_date ? '<br>Due: ' + fmtDate(inv.due_date) : ''}</div>
  </div>
</div>
<div style="margin-bottom:24px"><strong>Bill to:</strong><br>${inv.client || ''}${inv.address ? '<br>' + inv.address : ''}</div>
<table>
  <thead><tr><th>Description</th><th style="text-align:right">Amount (ex GST)</th></tr></thead>
  <tbody>
    <tr><td>${inv.notes || 'Painting services as agreed'}</td><td style="text-align:right">${fmtCurrency(exGST)}</td></tr>
    <tr><td style="color:#555">GST (10%)</td><td style="text-align:right;color:#555">${fmtCurrency(gst)}</td></tr>
    <tr class="total-row"><td>Total inc GST</td><td style="text-align:right">${fmtCurrency(total)}</td></tr>
    ${deposit > 0 ? `<tr><td style="color:#555">Deposit received</td><td style="text-align:right;color:#555">(${fmtCurrency(deposit)})</td></tr>` : ''}
    ${received > 0 ? `<tr><td style="color:#555">Amount received</td><td style="text-align:right;color:#555">(${fmtCurrency(received)})</td></tr>` : ''}
    ${(deposit > 0 || received > 0) ? `<tr class="total-row"><td>Balance owing</td><td style="text-align:right">${fmtCurrency(owed)}</td></tr>` : ''}
  </tbody>
</table>
${hasBankDetails ? `<div class="payment">
  <strong>Payment details</strong><br>
  Bank Transfer: BSB ${biz.bsb} · Account ${biz.account_no}${biz.account_name ? ' · ' + biz.account_name : ''}<br>
  Reference: ${inv.id || inv.client || ''}${biz?.invoice_terms ? '<br><em>' + biz.invoice_terms + '</em>' : ''}
</div>` : ''}
<div class="footer">${biz?.invoice_footer || 'This invoice is issued in accordance with the Building and Construction Industry Security of Payment Act 1999 (NSW).'}</div>
</body></html>`
}
