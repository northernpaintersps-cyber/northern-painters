import { useState, useMemo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, selectAll } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Input, Select, TextArea } from '@/components/ui/Field'
import JobBillingTab from '@/components/JobBillingTab'
import {
  fmtCurrency, fmtDate, nextJobId, genId, normaliseDate,
  getJobScheduledDates, today
} from '@/lib/utils'
import {
  Plus, Loader2, Trash2, Edit2,
  Bell, Copy, Check, CalendarPlus, Camera, ArrowUpDown, X, Info,
} from 'lucide-react'

const VAR_STATUSES = ['Pending','Approved','Rejected']

function useVariations(jobId: string | null) {
  const { user } = useAuth()
  return useQuery<any[]>({
    queryKey: ['np_variations', jobId, user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('np_variations').select('*')
        .eq('user_id', user!.id).eq('job_id', jobId!).order('date', { ascending: false })
      if (error) throw error
      return data ?? []
    },
    enabled: !!user && !!jobId,
  })
}

function useUpsertVariation() {
  const qc = useQueryClient()
  const { user } = useAuth()
  return useMutation({
    mutationFn: async (row: any) => {
      const { error } = await supabase.from('np_variations').upsert({ ...row, user_id: user!.id, updated_at: new Date().toISOString() } as any)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['np_variations'] }),
  })
}

function useDeleteVariation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('np_variations').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['np_variations'] }),
  })
}

function VariationsTab({ jobId }: { jobId: string | null }) {
  const { data: vars = [], isLoading } = useVariations(jobId)
  const upsert = useUpsertVariation()
  const del = useDeleteVariation()
  const [varForm, setVarForm] = useState<any | null>(null)
  const [saving, setSaving] = useState(false)

  const ef = (k: string) => (e: React.ChangeEvent<any>) =>
    setVarForm((p: any) => ({ ...p, [k]: e.target.value }))

  async function saveVar() {
    if (!varForm || !jobId) return
    setSaving(true)
    try {
      await upsert.mutateAsync({ ...varForm, job_id: jobId, id: varForm.id || genId('var') })
      setVarForm(null)
    } finally { setSaving(false) }
  }

  const totalApproved = vars.filter(v => v.var_status === 'Approved').reduce((s, v) => s + (v.amount_ex_gst ?? 0), 0)

  if (!jobId) return <p className="text-sm text-gray-500 py-4">Save the job first to add variations.</p>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-500">
          Approved variations: <span className="text-gray-900 font-semibold">{fmtCurrency(totalApproved)}</span>
          <span className="text-gray-600 mx-2">·</span>
          <span className="text-xs text-gray-500">{vars.length} total</span>
        </div>
        <button onClick={() => setVarForm({ date: today(), var_status: 'Pending', job_id: jobId })}
          className="flex items-center gap-1 text-xs bg-blue-600 hover:bg-blue-700 text-gray-900 font-semibold px-2.5 py-1.5 rounded-lg">
          <Plus size={12} /> Add
        </button>
      </div>

      {isLoading
        ? <div className="flex justify-center py-8"><Loader2 size={16} className="animate-spin text-blue-600" /></div>
        : (
          <div className="space-y-2">
            {vars.map(v => (
              <div key={v.id} className="flex items-start gap-3 bg-gray-50 rounded-lg p-3 group">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <Badge label={v.var_status || 'Pending'} />
                    <span className="text-xs text-gray-500">{fmtDate(v.date)}</span>
                  </div>
                  <p className="text-sm text-gray-900">{v.var_desc || '—'}</p>
                  {v.notes && <p className="text-xs text-gray-500 mt-0.5">{v.notes}</p>}
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold text-gray-900">{fmtCurrency(v.amount_ex_gst)}</p>
                  <p className="text-xs text-gray-500">ex GST</p>
                </div>
                <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => setVarForm({ ...v })} className="text-gray-500 hover:text-blue-600"><Edit2 size={12} /></button>
                  <button onClick={() => { if (confirm('Delete variation?')) del.mutate(v.id) }} className="text-gray-500 hover:text-red-400"><Trash2 size={12} /></button>
                </div>
              </div>
            ))}
            {!vars.length && <p className="text-sm text-gray-500 text-center py-6">No variations yet</p>}
          </div>
        )
      }

      {varForm && (
        <div className="bg-gray-50 rounded-xl border border-gray-200 p-4 space-y-3 mt-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{varForm.id ? 'Edit variation' : 'New variation'}</p>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Date" type="date" value={varForm.date || ''} onChange={ef('date')} />
            <Select label="Status" value={varForm.var_status || 'Pending'} onChange={ef('var_status')} options={VAR_STATUSES} />
          </div>
          <Input label="Description" value={varForm.var_desc || ''} onChange={ef('var_desc')} />
          <Input label="Amount ex GST ($)" type="number" value={varForm.amount_ex_gst ?? ''} onChange={ef('amount_ex_gst')} />
          <TextArea label="Notes" value={varForm.notes || ''} onChange={ef('notes')} />
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => setVarForm(null)} className="text-xs px-3 py-1.5 rounded-lg bg-gray-200 text-gray-500 hover:text-gray-900">Cancel</button>
            <button onClick={saveVar} disabled={saving} className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-gray-900 font-semibold disabled:opacity-50">
              {saving && <Loader2 size={11} className="animate-spin" />} Save
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Types ────────────────────────────────────────────────────
type Job = Record<string, any>

const JOB_TYPES = [
  'Interior repaint','Exterior repaint','Full repaint','Deck/timber coating',
  'Hourly rate','New build - exterior','New build - interior','Limewash / specialty','Other'
]
// V16 .ii / .is — borderless inline table inputs
const II = 'border-none bg-transparent text-[12.5px] font-inherit text-inherit w-full focus:outline-none focus:bg-blue-50/60 rounded px-0.5'
const IS = 'border-none bg-transparent text-xs font-inherit text-inherit cursor-pointer focus:outline-none'
const BTN = 'ml-1 px-1.5 py-1 rounded-md bg-white border border-black/20 hover:bg-[#f5f4f0] align-middle'

const JOB_STATUSES = ['Not Started','Scheduled','In Progress','Hourly Rate Accepted','Finished','Closed']
const QUOTE_STATUSES = [
  'Info Collected','Site Visit','Quote Created','Sent','Negotiating',
  'Accepted','Booked','Not Accepted','Lost'
]
const TERMS = ['Labour only','Labour and materials','Hourly rate','Estimate']
const LEAD_SOURCES = ['Website/Google','Facebook/Instagram','Builder/Trade','Referral','Existing Client','Other']
const ON_BOOKS = ['Invoiced','Cash']
const WEATHER = ['None','High - exterior']

// ── Hooks ────────────────────────────────────────────────────
function useJobs() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['np_jobs', user?.id],
    queryFn: async () => {
      const { data, error } = await selectAll('np_jobs', user!.id, { orderBy: 'created_at' })
      if (error) throw error
      return (data ?? []) as Job[]
    },
    enabled: !!user,
  })
}

function useUpsertJob() {
  const qc = useQueryClient()
  const { user } = useAuth()
  return useMutation({
    mutationFn: async (job: Job) => {
      const { error } = await supabase.from('np_jobs').upsert({ ...job, user_id: user!.id, updated_at: new Date().toISOString() } as any)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['np_jobs'] }),
  })
}

function useDeleteJob() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('np_jobs').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['np_jobs'] }),
  })
}

// ── Quote number generation ──────────────────────────────────
function genQuoteNo(existingNos: string[]): string {
  const d = new Date()
  const base = `${String(d.getDate()).padStart(2,'0')}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getFullYear()).slice(-2)}`
  if (!existingNos.includes(base)) return base
  for (let i = 2; i < 20; i++) {
    const candidate = base + i
    if (!existingNos.includes(candidate)) return candidate
  }
  return base + Date.now()
}

// ── Empty form ────────────────────────────────────────────────
function emptyForm(): Job {
  return {
    status: 'Not Started', quote_status: 'Info Collected',
    type: 'Interior repaint', terms: 'Labour and materials',
    on_books: 'Invoiced', weather: 'None', lead_source: '',
  }
}

// ── Cost Tracker Tab ─────────────────────────────────────────
function CostTrackerTab({ job, jobId }: { job: any; jobId: string | null }) {
  const { user } = useAuth()

  const { data: labourEntries = [] } = useQuery<any[]>({
    queryKey: ['np_labour_job', jobId, user?.id],
    queryFn: async () => {
      const { data } = await supabase.from('np_labour').select('*').eq('user_id', user!.id).eq('job_id', jobId!)
      return data ?? []
    },
    enabled: !!user && !!jobId,
  })

  const { data: materialEntries = [] } = useQuery<any[]>({
    queryKey: ['np_materials_job', jobId, user?.id],
    queryFn: async () => {
      const { data } = await (supabase.from('np_materials') as any).select('*').eq('user_id', user!.id).eq('job_id', jobId!)
      return data ?? []
    },
    enabled: !!user && !!jobId,
  })

  const { data: variations = [] } = useQuery<any[]>({
    queryKey: ['np_variations', jobId, user?.id],
    queryFn: async () => {
      const { data } = await supabase.from('np_variations').select('*').eq('user_id', user!.id).eq('job_id', jobId!).eq('var_status', 'Approved')
      return data ?? []
    },
    enabled: !!user && !!jobId,
  })

  const quotedLabour   = job.est_labour_ex ?? 0
  const quotedMaterials = job.est_materials_ex ?? 0
  const agreedValue    = job.agreed_ex_gst ?? job.quote_ex_gst ?? 0

  const actualLabour   = labourEntries.reduce((s, e) => s + (e.cost ?? (e.hours ?? 0) * (e.rate ?? 0)), 0)
  const actualMaterials = materialEntries.reduce((s, m) => s + (m.cost_ex_gst ?? 0), 0)
  const approvedVarValue = variations.reduce((s, v) => s + (v.amount_ex_gst ?? 0), 0)
  const totalRevenue   = agreedValue + approvedVarValue

  const actualTotal    = actualLabour + actualMaterials
  const quotedTotal    = quotedLabour + quotedMaterials
  const grossProfit    = totalRevenue - actualTotal
  const margin         = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0

  function pct(actual: number, quoted: number) {
    if (!quoted) return null
    return ((actual / quoted) * 100).toFixed(0) + '%'
  }
  function bar(actual: number, quoted: number) {
    if (!quoted) return 0
    return Math.min((actual / quoted) * 100, 100)
  }
  function barColor(actual: number, quoted: number) {
    if (!quoted) return 'bg-gray-600'
    const ratio = actual / quoted
    if (ratio < 0.8) return 'bg-green-500'
    if (ratio < 1.0) return 'bg-blue-600'
    return 'bg-red-500'
  }

  if (!jobId) return <p className="text-sm text-gray-500 py-4">Save the job first to track costs.</p>

  return (
    <div className="space-y-5">
      {/* Summary tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Revenue (agreed + vars)', value: fmtCurrency(totalRevenue), color: 'text-blue-500' },
          { label: 'Total actual cost', value: fmtCurrency(actualTotal), color: actualTotal > quotedTotal ? 'text-red-400' : 'text-gray-200' },
          { label: 'Gross profit', value: fmtCurrency(grossProfit), color: grossProfit >= 0 ? 'text-green-400' : 'text-red-400' },
          { label: 'Margin', value: margin.toFixed(1) + '%', color: margin >= 30 ? 'text-green-400' : margin >= 15 ? 'text-blue-600' : 'text-red-400' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-gray-500 mb-1">{label}</p>
            <p className={`text-base font-bold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Labour */}
      <div className="bg-gray-50 rounded-lg p-4 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-gray-900">Labour</p>
          <div className="flex gap-4 text-xs text-gray-500">
            <span>Quoted: <span className="text-gray-200 font-medium">{fmtCurrency(quotedLabour)}</span></span>
            <span>Actual: <span className={`font-medium ${actualLabour > quotedLabour && quotedLabour > 0 ? 'text-red-400' : 'text-gray-200'}`}>{fmtCurrency(actualLabour)}</span></span>
            {pct(actualLabour, quotedLabour) && <span className="text-gray-500">{pct(actualLabour, quotedLabour)} of quote</span>}
          </div>
        </div>
        {quotedLabour > 0 && (
          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all ${barColor(actualLabour, quotedLabour)}`} style={{ width: `${bar(actualLabour, quotedLabour)}%` }} />
          </div>
        )}
        {labourEntries.length > 0 && (
          <div className="space-y-1 pt-1 max-h-40 overflow-y-auto">
            {labourEntries.map(e => (
              <div key={e.id} className="flex justify-between text-xs text-gray-500">
                <span>{e.date} — {e.sub || 'Worker'}{e.labour_desc ? ` · ${e.labour_desc}` : ''}</span>
                <span className="font-mono text-gray-600">{e.cost ? fmtCurrency(e.cost) : `${e.hours}h @ $${e.rate}/hr = ${fmtCurrency((e.hours ?? 0) * (e.rate ?? 0))}`}</span>
              </div>
            ))}
          </div>
        )}
        {labourEntries.length === 0 && <p className="text-xs text-gray-600">No labour entries logged yet.</p>}
      </div>

      {/* Materials */}
      <div className="bg-gray-50 rounded-lg p-4 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-gray-900">Materials</p>
          <div className="flex gap-4 text-xs text-gray-500">
            <span>Quoted: <span className="text-gray-200 font-medium">{fmtCurrency(quotedMaterials)}</span></span>
            <span>Actual: <span className={`font-medium ${actualMaterials > quotedMaterials && quotedMaterials > 0 ? 'text-red-400' : 'text-gray-200'}`}>{fmtCurrency(actualMaterials)}</span></span>
            {pct(actualMaterials, quotedMaterials) && <span className="text-gray-500">{pct(actualMaterials, quotedMaterials)} of quote</span>}
          </div>
        </div>
        {quotedMaterials > 0 && (
          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all ${barColor(actualMaterials, quotedMaterials)}`} style={{ width: `${bar(actualMaterials, quotedMaterials)}%` }} />
          </div>
        )}
        {materialEntries.length > 0 && (
          <div className="space-y-1 pt-1 max-h-40 overflow-y-auto">
            {materialEntries.map(m => (
              <div key={m.id} className="flex justify-between text-xs text-gray-500">
                <span>{m.date} — {m.mat_desc || m.supplier || 'Material'}</span>
                <span className="font-mono text-gray-600">{fmtCurrency(m.cost_ex_gst ?? 0)}</span>
              </div>
            ))}
          </div>
        )}
        {materialEntries.length === 0 && <p className="text-xs text-gray-600">No material purchases logged yet.</p>}
      </div>

      {/* Variations */}
      {approvedVarValue > 0 && (
        <div className="bg-gray-50 rounded-lg p-4">
          <div className="flex justify-between text-sm">
            <span className="font-semibold text-gray-900">Approved variations</span>
            <span className="text-green-400 font-medium">{fmtCurrency(approvedVarValue)}</span>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────
// All variations (for the "N var" badge on each row)
function useAllVariations() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['np_variations', user?.id],
    queryFn: async () => {
      const { data } = await supabase.from('np_variations').select('job_id').eq('user_id', user!.id)
      return (data ?? []) as any[]
    },
    enabled: !!user,
  })
}

// V16 qe() — inline field edit, saves instantly
function useQuickEdit() {
  const qc = useQueryClient()
  const { user } = useAuth()
  return useMutation({
    mutationFn: async ({ job, field, value }: { job: any; field: string; value: any }) => {
      const patch: Record<string, any> = { [field]: value, updated_at: new Date().toISOString() }
      // V16 recomputes scheduled dates when start/days change
      if (field === 'sched_start' || field === 'est_days') {
        patch.scheduled_dates = getJobScheduledDates({ ...job, ...patch })
      }
      const { error } = await (supabase.from('np_jobs') as any)
        .update(patch).eq('id', job.id).eq('user_id', user!.id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['np_jobs'] }),
  })
}

const snoozedUntil = (j: any) => j?.extra?.follow_up_snoozed_until ?? null

// V16 copyFollowUpMsg()
function followUpMessage(j: any) {
  return `Hi ${j.client},\n\nJust following up on the quote we sent for ${j.job_desc || j.type || 'your painting project'} at ${j.address}.\n\nQuote: ${fmtCurrency(j.quote_ex_gst)} ex GST (${fmtCurrency((j.quote_ex_gst || 0) * 1.1)} inc GST)\n\nHappy to answer any questions or adjust the scope if needed.\n\nLooking forward to hearing from you!\n\nNorthern Painters`
}

export default function Jobs() {
  const { data: jobs = [], isLoading } = useJobs()
  const { data: allVariations = [] } = useAllVariations()
  const upsert = useUpsertJob()
  const del = useDeleteJob()
  const quickEdit = useQuickEdit()
  const { user } = useAuth()
  const nav = useNavigate()

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  const [quoteFilter, setQuoteFilter] = useState('All')
  const [asc, setAsc] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [form, setForm] = useState<Job>(emptyForm())
  const [modalOpen, setModalOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [tab, setTab] = useState<'details'|'schedule'|'financials'|'costs'|'billing'|'variations'>('details')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('new') !== '1') return
    try {
      const raw = sessionStorage.getItem('np_prefill_job')
      if (raw) {
        const prefill = JSON.parse(raw)
        sessionStorage.removeItem('np_prefill_job')
        setForm(f => ({ ...f, ...prefill }))
      }
    } catch {}
    setSelectedId(null)
    setTab('details')
    setModalOpen(true)
    // remove ?new=1 from URL without reload
    window.history.replaceState({}, '', window.location.pathname)
  }, [])

  const filtered = useMemo(() => {
    const rows = jobs.filter(j => {
      const s = search.toLowerCase()
      const matchSearch = !s || [j.client, j.address, j.id, j.type, j.job_desc].some(v => v?.toLowerCase().includes(s))
      const matchStatus = statusFilter === 'All' || j.status === statusFilter
      const matchQuote = quoteFilter === 'All' || j.quote_status === quoteFilter
      return matchSearch && matchStatus && matchQuote
    })
    // V16 sorts by created date / id
    return rows.sort((a, b) => {
      const da = a.created_at || a.id || '', db = b.created_at || b.id || ''
      return asc ? (da < db ? -1 : da > db ? 1 : 0) : (da > db ? -1 : da < db ? 1 : 0)
    })
  }, [jobs, search, statusFilter, quoteFilter, asc])

  // V16 needFollowUp — quotes sent 7+ days ago, not snoozed
  const todayStr = today()
  const needFollowUp = useMemo(() => jobs.filter(j => {
    if (j.quote_status !== 'Sent' || !j.quote_sent) return false
    const snz = snoozedUntil(j)
    if (snz && snz > todayStr) return false
    const sent = normaliseDate(j.quote_sent)
    if (!sent) return false
    return Math.floor((Date.now() - new Date(sent).getTime()) / 864e5) >= 7
  }), [jobs, todayStr])

  const varCount = useMemo(() => {
    const m: Record<string, number> = {}
    allVariations.forEach(v => { if (v.job_id) m[v.job_id] = (m[v.job_id] || 0) + 1 })
    return m
  }, [allVariations])

  async function copyFollowUp(j: any) {
    const msg = followUpMessage(j)
    try {
      await navigator.clipboard.writeText(msg)
      alert('Follow-up message copied!')
    } catch {
      prompt('Copy this message:', msg)
    }
  }

  async function markFollowedUp(j: any) {
    const until = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10)
    await quickEdit.mutateAsync({
      job: j, field: 'extra',
      value: { ...(j.extra ?? {}), follow_up_snoozed_until: until, last_follow_up: todayStr },
    })
  }

  async function quickDelete(j: any) {
    if (!confirm('Delete this job?')) return
    await del.mutateAsync(j.id)
  }

  function openNew() {
    setForm(emptyForm())
    setSelectedId(null)
    setTab('details')
    setModalOpen(true)
  }

  function openEdit(j: Job) {
    setForm({ ...j })
    setSelectedId(j.id)
    setTab('details')
    setModalOpen(true)
  }

  function set(k: string, v: any) { setForm(prev => ({ ...prev, [k]: v })) }
  const fld = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => set(k, e.target.value)
  const num = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => set(k, e.target.value === '' ? null : parseFloat(e.target.value))

  async function handleSave() {
    setSaving(true)
    try {
      const existingNos = jobs.map((j: Job) => j.quote_no).filter(Boolean)
      const id = selectedId || nextJobId(jobs.map((j: Job) => j.id))
      const quoteNo = form.quote_no || genQuoteNo(existingNos)
      // Recalculate scheduled dates if start/days changed
      const schedDates = getJobScheduledDates(form)
      await upsert.mutateAsync({
        ...form,
        id,
        quote_no: quoteNo,
        scheduled_dates: schedDates.length ? schedDates : (form.scheduled_dates ?? []),
        created_at: form.created_at || new Date().toISOString(),
      })
      setModalOpen(false)
    } catch (e: any) {
      alert('Save failed: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!selectedId || !confirm(`Delete job ${selectedId}? This cannot be undone.`)) return
    await del.mutateAsync(selectedId)
    setModalOpen(false)
  }

  const selected = jobs.find(j => j.id === selectedId)

  return (
    <div className="p-5">
      {/* Header */}
      <div>
        <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
          <h2 className="text-[17px] font-semibold text-gray-900">Jobs &amp; Quotes</h2>
          <button onClick={openNew}
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white font-medium text-[13px] px-3 py-1.5 rounded-lg transition-colors">
            <Plus size={14} /> New Job
          </button>
        </div>
        <div className="text-[11px] text-[#666] mb-2 flex items-center gap-1">
          <Info size={12} /> Edit inline — dropdowns save instantly. Click pencil for full edit.
        </div>

        {/* V16 filter bar */}
        <div className="flex gap-2 mb-3 flex-wrap items-center">
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..."
            className="w-[200px] px-2.5 py-1.5 text-[12.5px] bg-white border border-black/20 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500" />
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="px-2.5 py-1.5 text-[12.5px] bg-white border border-black/20 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500">
            <option value="All">All job statuses</option>
            {JOB_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={quoteFilter} onChange={e => setQuoteFilter(e.target.value)}
            className="px-2.5 py-1.5 text-[12.5px] bg-white border border-black/20 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500">
            <option value="All">All quote statuses</option>
            {QUOTE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <button onClick={() => setAsc(a => !a)}
            className="flex items-center gap-1 px-2.5 py-1.5 text-[12.5px] bg-white border border-black/20 rounded-lg hover:bg-[#f5f4f0] whitespace-nowrap">
            <ArrowUpDown size={13} /> {asc ? 'Oldest first' : 'Newest first'}
          </button>
          <button onClick={() => { setSearch(''); setStatusFilter('All'); setQuoteFilter('All'); setAsc(false) }}
            title="Clear filters"
            className="flex items-center gap-1 px-2.5 py-1.5 text-[12.5px] bg-white border border-black/20 rounded-lg hover:bg-[#f5f4f0] text-[#666]">
            <X size={13} /> Clear
          </button>
        </div>

        {/* Quote follow-up card */}
        {needFollowUp.length > 0 && (
          <div className="bg-white border border-black/[0.12] rounded-xl px-4 py-3.5 mb-3" style={{ borderLeft: '4px solid #f59e0b' }}>
            <div className="mb-2.5">
              <span className="text-[13px] font-bold text-[#92400e] inline-flex items-center gap-1.5">
                <Bell size={14} /> Quote follow-up needed
              </span>
              <span className="text-[11px] text-[#666] ml-2">
                {needFollowUp.length} quote{needFollowUp.length === 1 ? '' : 's'} sent 7+ days ago with no response
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              {needFollowUp.map(j => {
                const sent = normaliseDate(j.quote_sent)!
                const days = Math.floor((Date.now() - new Date(sent).getTime()) / 864e5)
                return (
                  <div key={j.id} className="flex items-center justify-between bg-[#fffbeb] rounded-lg px-3 py-2 flex-wrap gap-2">
                    <div>
                      <span className="font-semibold text-[13px]">{j.client}</span>
                      <span className="text-[11px] text-[#666] ml-2">
                        {j.id} · {j.type || ''} · {fmtCurrency(j.quote_ex_gst)} ex GST
                      </span>
                      <span className="text-[11px] text-[#92400e] ml-2 font-semibold">{days} days ago</span>
                    </div>
                    <div className="flex gap-1.5">
                      <button onClick={() => copyFollowUp(j)}
                        className="flex items-center gap-1 px-2 py-1 text-[11px] rounded-md bg-[#fef3c7] border border-[#fcd34d] text-[#92400e] hover:brightness-95">
                        <Copy size={11} /> Copy message
                      </button>
                      <button onClick={() => markFollowedUp(j)}
                        className="flex items-center gap-1 px-2 py-1 text-[11px] rounded-md bg-[#dcfce7] border border-[#86efac] text-[#166534] hover:brightness-95">
                        <Check size={11} /> Mark followed up
                      </button>
                      <button onClick={() => openEdit(j)}
                        className="flex items-center gap-1 px-2 py-1 text-[11px] rounded-md bg-blue-600 text-white hover:bg-blue-700">
                        <Edit2 size={11} /> Open job
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* V16 inline-editable table */}
      <div>
        <div className="bg-white border border-black/[0.12] rounded-xl overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={20} className="animate-spin text-blue-600" />
            </div>
          ) : (
            <div className="overflow-auto max-h-[70vh]">
              <table className="w-full border-collapse text-[12.5px]">
                <thead>
                  <tr>
                    {['ID','Client','Address','Agreed ex GST','Quote status','Job status','Start','Days',''].map((h, i) => (
                      <th key={i} className="text-left px-2.5 py-[7px] border-b border-black/[0.12] text-[#666] font-medium whitespace-nowrap bg-[#fafaf8] sticky top-0 z-[2]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(j => {
                    const vc = varCount[j.id] || 0
                    const scheduled = ['Scheduled','In Progress','Hourly Rate Accepted'].includes(j.status || '')
                    return (
                      <tr key={j.id} className="border-b border-black/[0.06] hover:bg-[#fafaf8]">
                        <td className="px-2.5 py-[7px] text-[#2563eb] font-medium whitespace-nowrap">{j.id}</td>
                        <td className="px-2.5 py-[7px]">
                          <input defaultValue={j.client ?? ''} className={II}
                            onBlur={e => { if (e.target.value !== (j.client ?? '')) quickEdit.mutate({ job: j, field: 'client', value: e.target.value }) }} />
                        </td>
                        <td className="px-2.5 py-[7px]">
                          <input defaultValue={j.address ?? ''} className={II} style={{ maxWidth: 130 }}
                            onBlur={e => { if (e.target.value !== (j.address ?? '')) quickEdit.mutate({ job: j, field: 'address', value: e.target.value }) }} />
                        </td>
                        <td className="px-2.5 py-[7px]">
                          <input type="number" defaultValue={j.agreed_ex_gst ?? ''} placeholder="—" className={II} style={{ width: 90 }}
                            onBlur={e => {
                              const v = e.target.value === '' ? null : parseFloat(e.target.value)
                              if (v !== (j.agreed_ex_gst ?? null)) quickEdit.mutate({ job: j, field: 'agreed_ex_gst', value: v })
                            }} />
                        </td>
                        <td className="px-2.5 py-[7px] whitespace-nowrap">
                          <select value={j.quote_status ?? ''} className={IS}
                            onChange={e => quickEdit.mutate({ job: j, field: 'quote_status', value: e.target.value })}>
                            <option value=""></option>
                            {QUOTE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                          {vc > 0 && (
                            <span className="ml-1 inline-block px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#fef3c7] text-[#92400e]">{vc} var</span>
                          )}
                        </td>
                        <td className="px-2.5 py-[7px]">
                          <select value={j.status ?? ''} className={IS}
                            onChange={e => quickEdit.mutate({ job: j, field: 'status', value: e.target.value })}>
                            <option value=""></option>
                            {JOB_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </td>
                        <td className="px-2.5 py-[7px]">
                          <input type="date" defaultValue={normaliseDate(j.sched_start) ?? ''} className={II} style={{ width: 118 }}
                            onBlur={e => { if (e.target.value !== (normaliseDate(j.sched_start) ?? '')) quickEdit.mutate({ job: j, field: 'sched_start', value: e.target.value || null }) }} />
                        </td>
                        <td className="px-2.5 py-[7px]">
                          <input type="number" defaultValue={j.est_days ?? ''} placeholder="—" className={II} style={{ width: 44 }}
                            onBlur={e => {
                              const v = e.target.value === '' ? null : parseFloat(e.target.value)
                              if (v !== (j.est_days ?? null)) quickEdit.mutate({ job: j, field: 'est_days', value: v })
                            }} />
                        </td>
                        <td className="px-2.5 py-[7px] whitespace-nowrap">
                          <button onClick={() => nav('/visits')} title="New site visit" className={BTN}><Camera size={13} /></button>
                          <button onClick={() => nav('/crew')} title="Schedule to crew calendar"
                            className={BTN} style={scheduled ? { color: '#059669' } : undefined}><CalendarPlus size={13} /></button>
                          <button onClick={() => openEdit(j)} title="Edit"
                            className="ml-1 px-1.5 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700 align-middle"><Edit2 size={13} /></button>
                          <button onClick={() => quickDelete(j)} title="Delete"
                            className={BTN} style={{ color: '#c0392b' }}><Trash2 size={13} /></button>
                        </td>
                      </tr>
                    )
                  })}
                  {filtered.length === 0 && (
                    <tr><td colSpan={9} className="text-center py-16 text-[#666]">No jobs found</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Edit/New Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} size="xl"
        title={selectedId ? `Edit ${selectedId}` : 'New Job'}>

        {/* Tabs */}
        <div className="flex gap-1 mb-5 bg-gray-50 p-1 rounded-lg">
          {(['details','schedule','financials','costs','billing','variations'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex-1 text-xs py-1.5 rounded-md font-medium transition-colors capitalize ${tab === t ? 'bg-gray-200 text-gray-900' : 'text-gray-500 hover:text-gray-900'}`}>
              {t === 'costs' ? 'Cost Tracker' : t}
            </button>
          ))}
        </div>

        {tab === 'details' && (
          <div className="grid grid-cols-2 gap-3">
            <Input label="Client name" value={form.client || ''} onChange={fld('client')} wrapperClassName="col-span-2" />
            <Input label="Site address" value={form.address || ''} onChange={fld('address')} wrapperClassName="col-span-2" />
            <Select label="Job type" value={form.type || ''} onChange={fld('type')} options={JOB_TYPES} />
            <Select label="Terms" value={form.terms || ''} onChange={fld('terms')} options={TERMS} />
            <Select label="Job status" value={form.status || ''} onChange={fld('status')} options={JOB_STATUSES} placeholder="—" />
            <Select label="Quote status" value={form.quote_status || ''} onChange={fld('quote_status')} options={QUOTE_STATUSES} placeholder="—" />
            <Select label="Lead source" value={form.lead_source || ''} onChange={fld('lead_source')} options={LEAD_SOURCES} placeholder="—" />
            <Select label="On books" value={form.on_books || ''} onChange={fld('on_books')} options={ON_BOOKS} />
            <Select label="Weather" value={form.weather || ''} onChange={fld('weather')} options={WEATHER} />
            <Input label="Quote number" value={form.quote_no || ''} onChange={fld('quote_no')} placeholder="Auto-generated" />
            <Input label="Drive link" value={form.drive_link || ''} onChange={fld('drive_link')} wrapperClassName="col-span-2" />
            <TextArea label="Description" value={form.job_desc || ''} onChange={fld('job_desc')} wrapperClassName="col-span-2" />
            <TextArea label="Notes" value={form.notes || ''} onChange={fld('notes')} wrapperClassName="col-span-2" />
          </div>
        )}

        {tab === 'schedule' && (
          <div className="grid grid-cols-2 gap-3">
            <Input label="Scheduled start" type="date" value={form.sched_start || ''} onChange={fld('sched_start')} />
            <Input label="Est. days" type="number" value={form.est_days || ''} onChange={num('est_days')} min={0} step={0.5} />
            <Input label="Quote sent date" type="date" value={form.quote_sent || ''} onChange={fld('quote_sent')} />
            <div className="col-span-2">
              {form.sched_start && form.est_days ? (
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-xs text-gray-500 mb-2">Calculated working days:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {getJobScheduledDates(form).map(d => (
                      <span key={d} className="text-xs bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded">{fmtDate(d)}</span>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-gray-500">Enter start date and estimated days to see scheduled dates.</p>
              )}
            </div>
          </div>
        )}

        {tab === 'financials' && (
          <div className="grid grid-cols-2 gap-3">
            <Input label="Quote ex GST ($)" type="number" value={form.quote_ex_gst || ''} onChange={num('quote_ex_gst')} min={0} />
            <Input label="Agreed ex GST ($)" type="number" value={form.agreed_ex_gst || ''} onChange={num('agreed_ex_gst')} min={0} />
            <Input label="Est. labour ex GST ($)" type="number" value={form.est_labour_ex || ''} onChange={num('est_labour_ex')} min={0} />
            <Input label="Est. materials ex GST ($)" type="number" value={form.est_materials_ex || ''} onChange={num('est_materials_ex')} min={0} />
            <Input label="Labour rate ($/hr)" type="number" value={form.labour_rate || ''} onChange={num('labour_rate')} min={0} />
            <div className="col-span-2 bg-gray-50 rounded-lg p-3 space-y-1">
              <p className="text-xs text-gray-500">Estimated financials</p>
              <div className="grid grid-cols-3 gap-2 mt-2">
                {[
                  { label: 'Quote inc GST', value: fmtCurrency((form.quote_ex_gst || 0) * 1.1) },
                  { label: 'Agreed inc GST', value: fmtCurrency((form.agreed_ex_gst || 0) * 1.1) },
                  { label: 'Est. cost', value: fmtCurrency((form.est_labour_ex || 0) + (form.est_materials_ex || 0)) },
                  { label: 'Est. profit', value: fmtCurrency((form.agreed_ex_gst || 0) - (form.est_labour_ex || 0) - (form.est_materials_ex || 0)) },
                  { label: 'Est. margin', value: form.agreed_ex_gst ? `${(((form.agreed_ex_gst - (form.est_labour_ex || 0) - (form.est_materials_ex || 0)) / form.agreed_ex_gst) * 100).toFixed(1)}%` : '—' },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-gray-200/50 rounded p-2">
                    <p className="text-xs text-gray-500">{label}</p>
                    <p className="text-sm font-semibold text-gray-900">{value}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === 'costs' && <CostTrackerTab job={form} jobId={selectedId} />}
        {tab === 'billing' && <JobBillingTab job={form} jobId={selectedId} />}
        {tab === 'variations' && <VariationsTab jobId={selectedId} />}

        <div className="flex items-center justify-between mt-6 pt-4 border-t border-gray-200">
          <div>
            {selectedId && (
              <button onClick={handleDelete} className="flex items-center gap-1.5 text-sm text-red-400 hover:text-red-300 transition-colors">
                <Trash2 size={14} /> Delete job
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={() => setModalOpen(false)} className="text-sm px-4 py-2 rounded-lg bg-gray-50 text-gray-500 hover:text-gray-900 transition-colors">
              Cancel
            </button>
            <button onClick={handleSave} disabled={saving}
              className="flex items-center gap-1.5 text-sm px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-gray-900 font-semibold transition-colors disabled:opacity-50">
              {saving && <Loader2 size={13} className="animate-spin" />}
              Save job
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
