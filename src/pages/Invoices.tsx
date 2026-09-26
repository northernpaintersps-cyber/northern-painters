import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, selectAll } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Modal } from '@/components/ui/Modal'
import JobPicker from '@/components/JobPicker'
import { Input, TextArea } from '@/components/ui/Field'
import {
  fmtCurrency, fmtDate, calcOwed, invStatus, genId, today,
  normaliseDate, parseMilestones, exOf, matchesJob,
} from '@/lib/utils'
import {
  Plus, Loader2, Trash2, Check, Banknote, Edit2, FileText, Receipt,
  ArrowUpDown, List, BarChart3, Info, MapPin, Search, X,
} from 'lucide-react'
import { useBusinessSettings } from '@/pages/SettingsPage'
import {
  computeJobBilling, billingBreakdown, unbilledSummary,
  invoiceableLines, selectedTotal, billedLinesOf,
  billingStage, BILLING_STAGES, type BillingStage, type JobBilling,
} from '@/lib/jobBilling'

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
      const { data, error } = await selectAll('np_invoices', user!.id, { orderBy: 'created_at' })
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
      const { data } = await selectAll('np_jobs', user!.id, { orderBy: 'created_at' })
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
      const { data } = await selectAll('np_pay_schedules', user!.id)
      return (data ?? []) as any[]
    },
    enabled: !!user,
  })
}

/** Labour, materials and variations back the actuals basis — an hourly job has
 *  no contract sum, so what has been logged is the only measure of billable work. */
function useUserTable(table: string) {
  const { user } = useAuth()
  return useQuery({
    queryKey: [table, user?.id],
    queryFn: async () => {
      const { data } = await selectAll(table, user!.id)
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
  const { data: labour = [] } = useUserTable('np_labour')
  const { data: materials = [] } = useUserTable('np_materials')
  const { data: variations = [] } = useUserTable('np_variations')
  const markupPct = bizSettings?.default_markup_pct ?? 0
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
  // An invoice is either a typed amount or a selection of logged lines.
  const [invMode, setInvMode] = useState<'manual' | 'lines'>('manual')
  const [picked, setPicked] = useState<Set<string>>(new Set())

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

  // Logged labour and materials for the job this invoice is against. Lines
  // already covered by another invoice are included but flagged, so the record
  // of what has been billed stays visible.
  const lines = useMemo(() => {
    const job = jobs.find(j => j.id === form.job_id)
    if (!job) return []
    return invoiceableLines({
      job,
      invoices: invoices.filter(i => i.id !== selectedId),
      labour, materials, markupPct,
    })
  }, [jobs, form.job_id, invoices, selectedId, labour, materials, markupPct])

  const pickedTotal = selectedTotal(lines, picked)

  function togglePick(id: string) {
    setPicked(p => {
      const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id)
      const total = selectedTotal(lines, n)
      setForm(f => ({ ...f, agreed_ex_gst: total, gst: +(total * 0.1).toFixed(2), total_inc_gst: +(total * 1.1).toFixed(2) }))
      return n
    })
  }

  // Milestones of the job this invoice is linked to, for the milestone select
  const formMilestones = useMemo(
    () => parseMilestones(paySchedules.find(s => s.id === form.job_id)),
    [paySchedules, form.job_id])

  function set(k: string, v: any) { setForm(prev => ({ ...prev, [k]: v })) }
  function setExtra(k: string, v: any) {
    setForm(prev => {
      const extra = { ...(prev.extra ?? {}) }
      if (v === '' || v == null) delete extra[k]; else extra[k] = v
      return { ...prev, extra }
    })
  }
  const fld = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const val: any = e.target.value
    if (k === 'agreed_ex_gst') {
      const ex = parseFloat(val) || 0
      setForm(prev => ({ ...prev, agreed_ex_gst: ex, gst: parseFloat((ex * 0.1).toFixed(2)), total_inc_gst: parseFloat((ex * 1.1).toFixed(2)) }))
      return
    }
    if (k === 'job_id') {
      const job = jobs.find(j => j.id === val)
      setForm(prev => {
        // A milestone index only means something against its own job.
        const extra = { ...(prev.extra ?? {}) }
        delete extra.milestone_index; delete extra.milestone_job_id
        return { ...prev, job_id: val, client: job?.client || prev.client, extra }
      })
      return
    }
    set(k, val)
  }

  function openNew(prefill?: Invoice) {
    setForm({ ...emptyForm(), ...(prefill ?? {}) })
    setSelectedId(null)
    setInvMode('manual'); setPicked(new Set())
    setModalOpen(true)
  }
  function openEdit(inv: Invoice) {
    setForm({ ...inv }); setSelectedId(inv.id)
    // Reopen in the mode it was built in, with its lines still ticked.
    const b = billedLinesOf(inv)
    const ids = [...b.labour, ...b.materials]
    setInvMode(ids.length ? 'lines' : 'manual')
    setPicked(new Set(ids))
    setModalOpen(true)
  }

  async function handleSave() {
    setSaving(true)
    try {
      const id = selectedId || genId('INV-')
      let payload: Invoice = { ...form, id, created_at: form.created_at || new Date().toISOString() }

      if (invMode === 'lines' && form.job_id) {
        const chosen = lines.filter(l => picked.has(l.id))
        const total = selectedTotal(lines, picked)
        payload = {
          ...payload,
          agreed_ex_gst: total,
          gst: +(total * 0.1).toFixed(2),
          total_inc_gst: +(total * 1.1).toFixed(2),
          extra: {
            ...(payload.extra ?? {}),
            // What this invoice covers, so a line is never billed twice and the
            // job can say exactly what is left.
            billed_labour:    chosen.filter(l => l.kind === 'labour').map(l => l.id),
            billed_materials: chosen.filter(l => l.kind === 'material').map(l => l.id),
            // Itemise it on the printed invoice too.
            line_items: chosen.map(l => ({ description: l.description, qty: 1, total_ex_gst: l.amountExGST })),
          },
        }
      } else if (selectedId) {
        // Switched back to a typed amount — drop the line record so those
        // lines become available to invoice again.
        const extra = { ...(payload.extra ?? {}) }
        delete extra.billed_labour; delete extra.billed_materials
        payload = { ...payload, extra }
      }

      await upsert.mutateAsync(payload)
      setModalOpen(false)
    } catch (e: any) { alert('Save failed: ' + e.message) } finally { setSaving(false) }
  }

  async function handleDelete() {
    if (!selectedId || !confirm('Delete this invoice?')) return
    await del.mutateAsync(selectedId)
    setModalOpen(false)
  }

  /** Ask for the date the money actually arrived.
   *  This used to default silently to today(), which stamped the current date on
   *  invoices paid months earlier and pushed their revenue into the wrong year. */
  function askPaymentDate(inv: Invoice): string | null {
    const entered = prompt(
      'Payment date (YYYY-MM-DD) — the date the money arrived, not today:',
      inv.date_paid || today())
    if (entered === null) return null                      // cancelled
    // normaliseDate accepts the dd/mm/yyyy the rest of the app takes, not just ISO.
    const d = normaliseDate(entered.trim())
    if (!d || isNaN(Date.parse(d))) {
      alert('Enter the date as YYYY-MM-DD, for example 2026-03-09.')
      return null
    }
    if (d > today()) { alert('That date is in the future.'); return null }
    if (inv.date && d < inv.date &&
        !confirm(`That is before the invoice date (${inv.date}). Use it anyway?`)) return null
    return d
  }

  /** The unpaid→paid transition, in one place. Nothing here defaults date_paid
   *  to today(): when a payment settles an invoice we ask when the money
   *  arrived, and asking-only-once is a policy of this function, not its
   *  callers. Returns null when the user cancels. */
  function paidPatch(inv: Invoice, received: number, manualPaid = false) {
    const fullyPaid = manualPaid || !!inv.manual_paid || received >= (inv.total_inc_gst || 0)
    if (!fullyPaid) return { received, manual_paid: inv.manual_paid, date_paid: inv.date_paid }
    const datePaid = inv.date_paid || askPaymentDate(inv)
    if (!datePaid) return null
    return { received, manual_paid: true, date_paid: datePaid }
  }

  // V16 markInvPaid()
  async function markInvPaid(inv: Invoice) {
    const patch = paidPatch(inv, inv.received || inv.total_inc_gst || 0, true)
    if (!patch) return
    await upsert.mutateAsync({ ...inv, ...patch })
  }

  // V16 recordCashPayment()
  async function recordCash(inv: Invoice) {
    const amt = prompt('Cash amount received ($):', String(inv.received || inv.total_inc_gst || ''))
    if (amt === null) return
    const v = parseFloat(amt) || 0
    const received = Math.min(inv.total_inc_gst || 0, (inv.received || 0) + v)
    const patch = paidPatch(inv, received)
    if (!patch) return
    await upsert.mutateAsync({
      ...inv, ...patch,
      extra: { ...(inv.extra ?? {}), cash_received: cashOf(inv) + v },
    })
  }

  // V16 inline received edit
  async function setReceived(inv: Invoice, raw: string) {
    const patch = paidPatch(inv, parseFloat(raw) || 0)
    if (!patch) return
    await upsert.mutateAsync({ ...inv, ...patch })
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
          labour={labour} materials={materials} variations={variations} markupPct={markupPct}
          onMarkPaid={markInvPaid} onCash={recordCash} onPreview={printInvoice}
          onNewInvoice={(j, b, milestoneIndex) => {
            // Invoicing a milestone bills that milestone's amount; otherwise
            // prefill what is still unbilled, not the whole contract — on a
            // progress invoice the remainder is the number actually wanted,
            // and on an hourly job agreed_ex_gst is zero or stale.
            const ms = milestoneIndex != null ? b.milestones[milestoneIndex] : undefined
            const ex = ms
              ? Math.round(exOf(ms.amount) * 100) / 100
              : Math.round(Math.max(0, b.billableToDateExGST - b.invoicedExGST) * 100) / 100
            // Pick up where the last claim stopped, through to today.
            const from = b.invoicedUpTo
              ? new Date(new Date(b.invoicedUpTo).getTime() + 86400000).toISOString().slice(0, 10)
              : (b.unbilled.fromDate || '')
            openNew({
              job_id: j.id, client: j.client,
              notes: ms ? `${j.job_desc || j.client} — ${ms.label}` : (j.job_desc || ''),
              agreed_ex_gst: ex || undefined,
              gst: +(ex * 0.1).toFixed(2),
              total_inc_gst: +(ex * 1.1).toFixed(2),
              extra: {
                ...(ms ? { milestone_index: milestoneIndex, milestone_job_id: j.id } : {}),
                ...(from ? { covers_from: from } : {}),
                covers_to: today(),
              },
            })
          }}
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
          <JobPicker jobs={jobs} value={form.job_id} label="Linked job" className="col-span-2"
            onChange={id => fld('job_id')({ target: { value: id } } as any)} />
          {formMilestones.length > 0 && (
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Payment milestone <span className="font-normal text-[#999]">(optional — links this invoice to the schedule)</span>
              </label>
              <select
                value={form.extra?.milestone_index ?? ''}
                onChange={e => {
                  const v = e.target.value
                  setForm(prev => {
                    const extra = { ...(prev.extra ?? {}) }
                    if (v === '') { delete extra.milestone_index; delete extra.milestone_job_id }
                    else { extra.milestone_index = Number(v); extra.milestone_job_id = prev.job_id }
                    return { ...prev, extra }
                  })
                }}
                className="w-full bg-white border border-black/20 rounded-lg px-3 py-2 text-[13px] text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500">
                <option value="">— Not linked —</option>
                {formMilestones.map((m, i) => (
                  <option key={i} value={i}>{m.label} — {fmtCurrency(m.amount)}</option>
                ))}
              </select>
            </div>
          )}
          <Input label="Client" value={form.client || ''} onChange={fld('client')} />
          <Input label="Invoice date" type="date" value={form.date || ''} onChange={fld('date')} />
          <Input label="Due date" type="date" value={form.due_date || ''} onChange={fld('due_date')} />
          {/* A progress claim covers a period, which is not the same as the date
              it was raised. Recording it is what lets the job say how far the
              billing has been carried. */}
          <Input label="Covers work from" type="date" value={form.extra?.covers_from || ''}
            onChange={e => setExtra('covers_from', e.target.value)} />
          <Input label="Covers work to" type="date" value={form.extra?.covers_to || ''}
            onChange={e => setExtra('covers_to', e.target.value)} />
          {form.job_id && (
            <div className="col-span-2">
              <div className="flex gap-1 mb-2 bg-gray-50 p-1 rounded-lg w-fit">
                {([['manual', 'Enter an amount'], ['lines', 'Pick logged work']] as const).map(([id, label]) => (
                  <button key={id} type="button" onClick={() => setInvMode(id)}
                    className={`text-xs px-3 py-1.5 rounded-md font-medium ${invMode === id ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}>
                    {label}
                  </button>
                ))}
              </div>

              {invMode === 'lines' && (lines.length === 0 ? (
                <div className="text-[11px] text-[#666] bg-[#f5f4f0] rounded-lg px-3 py-2.5">
                  No billable labour or materials logged against this job yet. Lines marked
                  <b> Fixed Quote</b> are excluded, since a fixed price already covers them.
                </div>
              ) : (
                <div className="border border-black/[0.12] rounded-lg overflow-hidden">
                  <div className="flex items-center justify-between px-2.5 py-1.5 bg-[#f5f4f0] text-[11px]">
                    <div className="flex gap-2">
                      <button type="button" className="text-[#2563eb] font-semibold"
                        onClick={() => { const n = new Set(lines.filter(l => !l.billed).map(l => l.id)); setPicked(n)
                          const tt = selectedTotal(lines, n)
                          setForm(f => ({ ...f, agreed_ex_gst: tt, gst: +(tt * 0.1).toFixed(2), total_inc_gst: +(tt * 1.1).toFixed(2) })) }}>
                        Select all unbilled
                      </button>
                      <button type="button" className="text-[#666]"
                        onClick={() => { setPicked(new Set())
                          setForm(f => ({ ...f, agreed_ex_gst: 0, gst: 0, total_inc_gst: 0 })) }}>
                        Clear
                      </button>
                    </div>
                    <span className="text-[#666]">
                      {picked.size} selected · <b className="text-[#2563eb]">{fmtCurrency(pickedTotal)}</b> ex GST
                    </span>
                  </div>
                  <div className="max-h-56 overflow-y-auto">
                    {lines.map(l => (
                      <label key={l.id}
                        className={`flex items-center gap-2 px-2.5 py-1.5 text-[11px] border-t border-black/[0.06] cursor-pointer ${l.billed ? 'bg-[#fafaf8]' : 'hover:bg-[#f8f8f6]'}`}>
                        <input type="checkbox" checked={picked.has(l.id)} onChange={() => togglePick(l.id)}
                          className="w-4 h-4 accent-blue-600 shrink-0" />
                        <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-semibold shrink-0 ${
                          l.kind === 'labour' ? 'bg-[#dbeafe] text-[#1e40af]' : 'bg-[#f3e8ff] text-[#6b21a8]'}`}>
                          {l.kind === 'labour' ? 'Labour' : 'Material'}
                        </span>
                        <span className="text-[#666] whitespace-nowrap">{fmtDate(l.date)}</span>
                        <span className="flex-1 truncate">{l.description}</span>
                        {l.billed && (
                          <span className="text-[9px] text-[#b45309] whitespace-nowrap"
                            title={`Already on invoice ${l.billedOn ?? ''}`}>
                            invoiced {l.billedOn ? `· ${l.billedOn}` : ''}
                          </span>
                        )}
                        <span className="font-mono whitespace-nowrap">{fmtCurrency(l.amountExGST)}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          <Input label="Amount ex GST ($)" type="number" value={form.agreed_ex_gst || ''}
            onChange={fld('agreed_ex_gst')} min={0}
            readOnly={invMode === 'lines' && !!form.job_id}
            className={invMode === 'lines' && !!form.job_id ? 'opacity-60 cursor-not-allowed' : undefined} />
          <Input label="GST ($)" type="number" value={form.gst || ''} readOnly className="opacity-60 cursor-not-allowed" />
          <Input label="Total inc GST ($)" type="number" value={form.total_inc_gst || ''} readOnly className="opacity-60 cursor-not-allowed" />
          <Input label="Amount received ($)" type="number" value={form.received || ''} onChange={e => {
            const received = parseFloat(e.target.value) || 0
            const paid = received >= (form.total_inc_gst || 0)
            // No today() default here either — the "Date paid" field below is
            // the entry point, and this fires on every keystroke so it must not prompt.
            setForm(prev => ({ ...prev, received, manual_paid: paid, date_paid: prev.date_paid }))
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
function JobFinancialSummary({
  jobs, invoices, paySchedules, labour, materials, variations, markupPct,
  onMarkPaid, onCash, onPreview, onNewInvoice,
}: {
  jobs: any[]; invoices: Invoice[]; paySchedules: any[]
  labour: any[]; materials: any[]; variations: any[]; markupPct: number
  onMarkPaid: (inv: Invoice) => void; onCash: (inv: Invoice) => void
  onPreview: (inv: Invoice) => void
  onNewInvoice: (j: any, b: JobBilling, milestoneIndex?: number) => void
}) {
  const [q, setQ] = useState('')
  const [stage, setStage] = useState<BillingStage | 'all'>('all')

  const active = jobs.filter(j =>
    invoices.some(i => i.job_id === j.id) ||
    ['Accepted', 'Booked'].includes(j.quote_status) ||
    ['In Progress', 'Scheduled', 'Not Started', 'Hourly Rate Accepted'].includes(j.status)
  ).sort((a, b) => (a.id || '').localeCompare(b.id || ''))

  // Worked out once per job so the filter and the cards agree, and so the
  // arithmetic is not repeated for every render of every card.
  const billingByJob = useMemo(() => {
    const m = new Map<string, JobBilling>()
    active.forEach(j => m.set(j.id, computeJobBilling({
      job: j, invoices, labour, materials, variations, markupPct,
      paySchedule: paySchedules.find(s => s.id === j.id),
    })))
    return m
  }, [active, invoices, labour, materials, variations, markupPct, paySchedules])

  // Same matcher as the job picker, so a number, client or street finds it.
  const jobsToShow = active.filter(j => {
    if (!matchesJob(j, q)) return false
    if (stage === 'all') return true
    const b = billingByJob.get(j.id)
    return !!b && billingStage(b) === stage
  })

  if (!active.length) return (
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
      <div className="flex items-center gap-2 mb-2.5 flex-wrap">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#999]" />
          <input value={q} onChange={e => setQ(e.target.value)}
            placeholder="Search job number, client or address…"
            className="w-72 max-w-full pl-8 pr-7 py-2 text-[13px] bg-white border border-black/20 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500" />
          {q && (
            <button onClick={() => setQ('')} title="Clear"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[#999] hover:text-[#c0392b]">
              <X size={13} />
            </button>
          )}
        </div>
        <div className="flex gap-1 bg-gray-50 p-1 rounded-lg">
          {BILLING_STAGES.map(st => {
            const n = st.id === 'all'
              ? active.length
              : active.filter(j => { const b = billingByJob.get(j.id); return !!b && billingStage(b) === st.id }).length
            return (
              <button key={st.id} onClick={() => setStage(st.id)}
                className={`text-xs px-2.5 py-1.5 rounded-md font-medium whitespace-nowrap ${
                  stage === st.id ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-900'}`}>
                {st.label} <span className="text-[#999]">{n}</span>
              </button>
            )
          })}
        </div>
        <span className="text-[11px] text-[#666]">
          {jobsToShow.length === active.length
            ? `${active.length} job${active.length !== 1 ? 's' : ''}`
            : `${jobsToShow.length} of ${active.length} jobs`}
        </span>
      </div>

      {jobsToShow.length === 0 && (
        <Card className="text-center py-8 text-[#666]">
          {q ? <>No job matches “{q}”{stage !== 'all' ? ' in this filter' : ''}.</>
             : <>No jobs are {BILLING_STAGES.find(x => x.id === stage)?.label.toLowerCase()}.</>}
        </Card>
      )}

      <div className="text-[11px] text-[#666] mb-2.5 flex items-center gap-1">
        <Info size={12} /> Shows all active, accepted, and invoiced jobs. Fixed-price jobs are measured
        against the agreed price plus approved variations; hourly and estimate jobs against the labour
        and materials logged so far. Left to invoice = that figure minus what you have already invoiced.
      </div>
      {jobsToShow.map(j => {
        const b = billingByJob.get(j.id)!
        const invs = b.invoices
        const isEstimate = b.basis === 'actuals'
        const jobValueIncGST = b.billableToDateIncGST
        const totalInvoiced = b.invoicedIncGST
        const totalReceived = b.receivedIncGST
        const cashReceived = b.cashReceivedIncGST
        const totalOwed = b.owedIncGST
        const leftToInvoice = b.leftToInvoiceIncGST
        const invoicePct = b.invoicePct
        const paidPct = b.paidPct
        // The deposit used to have its own tile; it is the first milestone chip now.

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
              <button onClick={() => onNewInvoice(j, b)}
                className="flex items-center gap-1 px-2.5 py-1 text-[11px] bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                <Plus size={11} /> New Invoice
              </button>
            </div>

            <div className="grid gap-2 mb-3" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(130px,1fr))' }}>
              <Tile label={isEstimate ? 'Billable to Date' : 'Job Value'}
                value={jobValueIncGST ? fmtCurrency(jobValueIncGST) : '—'} valueColor="#2563eb" sub="inc GST" />
              <Tile label="Invoiced" value={fmtCurrency(totalInvoiced)} valueColor="#1d4ed8" sub={`${invs.length} invoice${invs.length !== 1 ? 's' : ''}`} />
              <Tile label="Received" value={fmtCurrency(totalReceived)} valueColor="#16a34a"
                sub={cashReceived ? `💵 ${fmtCurrency(cashReceived)} cash` : undefined} subColor="#92400e" />
              <Tile label="Outstanding" value={totalOwed > 0 ? fmtCurrency(totalOwed) : 'Paid ✓'}
                valueColor={totalOwed > 0 ? '#dc2626' : '#16a34a'} sub="left to pay"
                borderColor={totalOwed > 0 ? '#fca5a5' : undefined} />
              {b.hasValue && (
                <Tile label="Left to Invoice"
                  value={leftToInvoice > 0 ? fmtCurrency(leftToInvoice) : 'Done ✓'}
                  valueColor={leftToInvoice > 0 ? '#d97706' : '#16a34a'}
                  sub={`of ${fmtCurrency(jobValueIncGST)}`}
                  borderColor={leftToInvoice > 0 ? '#fde68a' : undefined} />
              )}
              {b.overBilledIncGST > 0 && (
                <Tile label="Over-billed" value={fmtCurrency(b.overBilledIncGST)} valueColor="#dc2626"
                  sub="invoiced beyond billable" subColor="#dc2626" borderColor="#fca5a5" />
              )}
            </div>

            {isEstimate && b.billableToDateExGST > 0 && (
              <div className="text-[10px] text-[#666] mb-2">{billingBreakdown(b)}</div>
            )}

            <div className="text-[10px] mb-2">
              {b.invoicedUpTo
                ? <span className="text-[#666]">Invoiced up to <b>{fmtDate(b.invoicedUpTo)}</b></span>
                : <span className="text-[#999]">No invoice records the period it covers yet</span>}
              {unbilledSummary(b) && (
                <span className="text-[#b45309]"> · {unbilledSummary(b)}</span>
              )}
            </div>

            {b.milestones.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {b.milestones.map(m => (
                  <div key={m.index}
                    className={`flex items-center gap-1.5 text-[10px] rounded-full pl-2 pr-1 py-0.5 border ${
                      m.status === 'paid' ? 'bg-[#dcfce7] border-[#86efac] text-[#166534]'
                      : m.status === 'invoiced' ? 'bg-[#dbeafe] border-[#93c5fd] text-[#1e40af]'
                      : 'bg-[#f5f4f0] border-black/[0.12] text-[#5f5e5a]'}`}>
                    <span className="font-semibold">{m.label}</span>
                    <span className="font-mono">{fmtCurrency(m.amount)}</span>
                    {m.mismatch && (
                      <span className="text-[#b45309]"
                        title="Ticked received on the Payments page, but no settled invoice is linked">check</span>
                    )}
                    {m.status === 'unbilled' && (
                      <button
                        onClick={() => onNewInvoice(j, b, m.index)}
                        className="px-1.5 py-0.5 rounded-full bg-blue-600 text-white hover:bg-blue-700">
                        Invoice
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {jobValueIncGST > 0 && (
              <>
                <div className="mb-2">
                  <div className="flex justify-between text-[10px] text-[#666] mb-1">
                    <span>Invoiced ({invoicePct.toFixed(0)}%)</span>
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

// ── Invoice print HTML — V16 _renderInvPreview() ─────────────
const money0 = (v: any) => '$' + Number(v || 0).toLocaleString('en-AU', { maximumFractionDigits: 0 })
const money2 = (v: any) => '$' + Number(v || 0).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// V16 _buildInvTable()
function buildInvTable(inv: Invoice, collapsed: boolean) {
  const stored = inv.extra?.line_items
  const rawItems = Array.isArray(stored) && stored.length
    ? stored
    : [{ qty: 1, description: inv.notes || 'Painting services', unitPrice: inv.agreed_ex_gst || 0, amount: inv.agreed_ex_gst || 0 }]

  const normItems = rawItems.map((li: any) => ({
    qty: li.qty || 1,
    description: li.description || li.desc || 'Painting services',
    unit: li.unit && isNaN(Number(li.unit)) ? li.unit : 'lot',
    unitPrice: li.unitPrice !== undefined ? li.unitPrice : (isNaN(Number(li.unit)) ? 0 : Number(li.unit) || 0),
    amount: li.amount !== undefined ? li.amount : (li.totalExGST || li.total || 0),
  }))

  const lineItems = collapsed
    ? [{
        qty: 1,
        description: inv.notes || 'Painting services',
        unit: 'lot',
        unitPrice: normItems.reduce((s: number, l: any) => s + l.amount, 0),
        amount: normItems.reduce((s: number, l: any) => s + l.amount, 0),
      }]
    : normItems

  return {
    lineItems,
    emptyRows: Math.max(0, 5 - lineItems.length),
    ex: Number(inv.agreed_ex_gst || 0),
    inc: Number(inv.total_inc_gst || 0),
    owed: calcOwed(inv),
  }
}

function buildInvoiceHTML(inv: Invoice, biz?: any, collapsed = false): string {
  const dateStr = new Date(inv.date || Date.now())
    .toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: '2-digit' })
    .replace(/ /g, '-')
  const { lineItems, emptyRows, ex, inc, owed } = buildInvTable(inv, collapsed)
  const origin = window.location.origin

  const cell = 'border:1.5px solid #111;padding:3px 8px'
  const rowsHtml = lineItems.map((li: any) => `<tr>
    <td style="height:24px;${cell};text-align:center">${esc(li.qty || 1)}</td>
    <td style="height:24px;${cell}">${esc(li.description)}</td>
    <td style="height:24px;${cell};text-align:center;color:#555;font-size:12px">${esc(li.unit)}</td>
    <td style="height:24px;${cell};text-align:right">${money0(li.unitPrice)}</td>
    <td style="height:24px;${cell};text-align:right;background:#efefef">${money0(li.amount)}</td>
  </tr>`).join('')

  const emptyHtml = Array(emptyRows).fill(
    `<tr>${Array(4).fill(`<td style="height:28px;${cell}">&nbsp;</td>`).join('')}<td style="height:28px;${cell};background:#efefef"></td></tr>`
  ).join('')

  const th = 'background:#f0f0f0;border:1.5px solid #111;padding:4px 8px;text-align:center;font-weight:700'
  const tf = 'border:1.5px solid #111;background:#f0f0f0;padding:5px 8px;font-weight:700'
  const totalRow = (label: string, value: string) =>
    `<tr><td colspan="3" style="border:none"></td><td style="${tf};text-align:center">${label}</td><td style="${tf};text-align:right">${value}</td></tr>`

  const bsb = biz?.bsb || '067 873'
  const acc = biz?.account_no || '2252 1951'

  const page = `<div id="inv-prev" class="np-invoice-sample" style="background:#fff;width:794px;min-height:1123px;margin:0 auto;padding:92px 78px 50px;font-family:Arial,Helvetica,sans-serif;color:#111;font-size:14px;line-height:1.25">
  <div style="display:grid;grid-template-columns:1fr 1fr;align-items:end;border-bottom:2px solid #111;padding-bottom:8px">
    <div><img src="${origin}/np-logo.png" alt="Northern Painters" style="width:300px;height:auto;display:block"></div>
    <div style="text-align:right;font-size:54px;font-weight:800;letter-spacing:.5px;line-height:.9;padding-bottom:4px">TAX INVOICE</div>
  </div>
  <div style="display:grid;grid-template-columns:70px 1fr 70px 130px;align-items:center;margin:4px 0 30px;font-size:16px">
    <div style="font-weight:700">To:</div><div>${esc(inv.client)}</div>
    <div style="font-weight:700;text-align:left">Date:</div><div style="text-align:right">${dateStr}</div>
  </div>
  <table style="width:100%;border-collapse:collapse;font-size:15px;margin-bottom:62px;table-layout:fixed">
    <thead><tr>
      <th style="width:60px;${th}">Qty</th>
      <th style="${th}">Description</th>
      <th style="width:70px;${th}">Unit</th>
      <th style="width:140px;${th}">Unit Price</th>
      <th style="width:130px;${th}">Line Total</th>
    </tr></thead>
    <tbody>${rowsHtml}${emptyHtml}</tbody>
    <tfoot>
      ${totalRow('Total (exc GST)', money2(ex))}
      ${totalRow('Total (inc GST)', money2(inc))}
      ${(inv.received || 0) > 0 && owed > 0 ? totalRow('Balance owing', money2(owed)) : ''}
    </tfoot>
  </table>
  <div style="display:grid;grid-template-columns:1fr 260px;align-items:start;margin-top:14px">
    <div style="font-size:16px;line-height:1.7;padding-top:26px">
      <div style="font-size:17px;margin-bottom:8px">Payment Details</div>
      <div style="padding-left:54px;color:#555">BSB&nbsp; ${esc(bsb)}</div>
      <div style="padding-left:54px;color:#555">Acc&nbsp; ${esc(acc)}</div>
    </div>
    <div style="text-align:center"><img src="${origin}/ft-logo.png" alt="NSW Fair Trading Licensed Contractor" style="width:220px;height:auto;display:inline-block"></div>
  </div>
  <div style="text-align:center;font-size:17px;line-height:1.3;margin-top:34px">
    This is a payment claim made under the Building and<br>
    construction Industry Security of Payment Act 1999 NSW
  </div>
</div>`

  const safe = (v: string) => (v || '').replace(/[\/:*?"<>|]/g, '').replace(/\s+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')
  const title = 'Invoice' + (inv.id ? '_' + safe(inv.id) : '') + (inv.client ? '_' + safe(inv.client) : '')

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title><style>
*{box-sizing:border-box;margin:0;padding:0}
@page{size:A4 portrait;margin:0}
body{font-family:Arial,Helvetica,sans-serif;background:#fff;color:#111}
@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}button{display:none}}
</style></head><body>${page}</body></html>`
}
