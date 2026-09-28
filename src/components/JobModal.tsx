// The whole of one job in one place: its details, schedule, crew, money and
// history. Lifted out of the Jobs page so the Pipeline board can open the same
// modal instead of navigating away and losing the board's position.
import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, selectAll } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Input, Select, TextArea } from '@/components/ui/Field'
import JobBillingTab from '@/components/JobBillingTab'
import {
  fmtCurrency, fmtDate, nextJobId, genId,
  deriveScheduledDates, crewLabel, today,
} from '@/lib/utils'
import { Plus, Loader2, Trash2, Edit2, Users, Clock } from 'lucide-react'
import { invalidateTable } from '@/lib/queryKeys'

const TABS = ['details','schedule','crew','financials','costs','billing','variations','activity'] as const
type Tab = typeof TABS[number]
export type Job = Record<string, any>
const TAB_LABELS: Partial<Record<Tab, string>> = { costs: 'Cost Tracker', activity: 'History' }

// V16 .ii / .is — borderless inline table inputs
const II = 'border-none bg-transparent text-[12.5px] font-inherit text-inherit w-full focus:outline-none focus:bg-blue-50/60 rounded px-0.5'
const IS = 'border-none bg-transparent text-xs font-inherit text-inherit cursor-pointer focus:outline-none'
const BTN = 'ml-1 px-1.5 py-1 rounded-md bg-white border border-black/20 hover:bg-[#f5f4f0] align-middle'

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
    onSuccess: () => invalidateTable(qc, 'np_variations'),
  })
}

function useDeleteVariation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('np_variations').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => invalidateTable(qc, 'np_variations'),
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
export const JOB_TYPES = [
  'Interior repaint','Exterior repaint','Full repaint','Deck/timber coating',
  'Hourly rate','New build - exterior','New build - interior','Limewash / specialty','Other'
]

export const JOB_STATUSES = ['Not Started','Scheduled','In Progress','Hourly Rate Accepted','Finished','Closed']
export const QUOTE_STATUSES = [
  'Info Collected','Site Visit','Quote Created','Sent','Negotiating',
  'Accepted','Booked','Not Accepted','Lost'
]
export const TERMS = ['Labour only','Labour and materials','Hourly rate','Estimate']
export const LEAD_SOURCES = ['Website/Google','Facebook/Instagram','Builder/Trade','Referral','Existing Client','Other']
export const ON_BOOKS = ['Invoiced','Cash']
export const WEATHER = ['None','High - exterior']

function useJobsList() {
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

export function useUpsertJob() {
  const qc = useQueryClient()
  const { user } = useAuth()
  return useMutation({
    mutationFn: async (job: Job) => {
      const { error } = await supabase.from('np_jobs').upsert({ ...job, user_id: user!.id, updated_at: new Date().toISOString() } as any)
      if (error) throw error
    },
    onSuccess: () => invalidateTable(qc, 'np_jobs'),
  })
}

export function useDeleteJob() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('np_jobs').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => invalidateTable(qc, 'np_jobs'),
  })
}

// ── Quote number generation ──────────────────────────────────
export function genQuoteNo(existingNos: string[]): string {
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
export function emptyForm(): Job {
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

// ── Crew tab ─────────────────────────────────────────────────
// Read-only: crew are booked per day from the calendar, so this reports what
// those bookings add up to rather than offering a second way to make them.
function CrewTab({ job, jobId }: { job: any; jobId: string | null }) {
  const { user } = useAuth()
  const on = !!user && !!jobId
  const assignments = useQuery<any[]>({
    queryKey: ['np_assignments', jobId, user?.id],
    queryFn: async () => (await (supabase.from('np_assignments') as any)
      .select('*').eq('user_id', user!.id).eq('job_id', jobId!)).data ?? [],
    enabled: on,
  })
  const crew = useQuery<any[]>({
    queryKey: ['np_crew', user?.id],
    queryFn: async () => (await selectAll('np_crew', user!.id)).data ?? [],
    enabled: !!user,
  })

  if (!jobId) {
    return <div className="text-sm text-gray-500 py-6 text-center">Save the job first to book crew on it.</div>
  }

  const rows = (assignments.data ?? []).slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''))
  const planned = deriveScheduledDates(job)
  // One person booked for one day is one day of labour, so the count worth
  // showing is crew-days, not rows and not distinct dates.
  const byPerson = new Map<string, number>()
  rows.forEach(a => {
    const name = crewLabel(crew.data ?? [], a.crew_name) || 'Unnamed'
    byPerson.set(name, (byPerson.get(name) ?? 0) + 1)
  })
  const dates = [...new Set(rows.map(a => a.date).filter(Boolean))].sort()
  const unstaffed = planned.filter(d => !dates.includes(d))

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: 'Crew on the job', value: String(byPerson.size) },
          { label: 'Days booked', value: String(dates.length) },
          { label: 'Crew-days', value: String(rows.length) },
        ].map(t => (
          <div key={t.label} className="bg-gray-50 rounded-lg p-2.5">
            <p className="text-[11px] text-gray-500">{t.label}</p>
            <p className="text-base font-semibold text-gray-900">{t.value}</p>
          </div>
        ))}
      </div>

      {unstaffed.length > 0 && (
        <div className="text-[11px] text-[#92400e] bg-[#fffbeb] border border-[#fcd34d] rounded-lg px-3 py-2">
          <b>{unstaffed.length}</b> scheduled day{unstaffed.length === 1 ? '' : 's'} with nobody booked:{' '}
          {unstaffed.map(d => fmtDate(d)).join(', ')}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="text-[12px] text-gray-500 flex items-center gap-1.5">
          <Users size={14} /> No crew booked yet. Book them from the calendar.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            {[...byPerson.entries()].map(([name, n]) => (
              <span key={name} className="text-[11px] bg-[#dbeafe] text-[#1e40af] rounded-full px-2.5 py-1">
                {name} · {n} day{n === 1 ? '' : 's'}
              </span>
            ))}
          </div>
          <div className="border border-black/[0.12] rounded-lg overflow-hidden">
            {dates.map(d => (
              <div key={d} className="flex gap-2 px-3 py-2 text-[12px] border-t border-black/[0.06] first:border-t-0">
                <span className="text-[#666] w-24 shrink-0">{fmtDate(d)}</span>
                <span className="flex-1">
                  {rows.filter(a => a.date === d)
                    .map(a => crewLabel(crew.data ?? [], a.crew_name) || 'Unnamed').join(', ')}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ── History tab ──────────────────────────────────────────────
// There is no audit log, so the history is assembled from the records the job
// already has: what was quoted, scheduled, logged, invoiced and paid.
function ActivityTab({ job, jobId }: { job: any; jobId: string | null }) {
  const { user } = useAuth()
  const on = !!user && !!jobId
  const forJob = (table: string) => useQuery<any[]>({
    queryKey: [table, 'hist', jobId, user?.id],
    queryFn: async () => (await (supabase.from(table) as any)
      .select('*').eq('user_id', user!.id).eq('job_id', jobId!)).data ?? [],
    enabled: on,
  })
  const labour = forJob('np_labour')
  const materials = forJob('np_materials')
  const invoices = forJob('np_invoices')
  const variations = forJob('np_variations')

  if (!jobId) {
    return <div className="text-sm text-gray-500 py-6 text-center">Save the job first to build its history.</div>
  }

  type Ev = { date: string; label: string; detail: string; tone: string }
  const evs: Ev[] = []
  const push = (date: any, label: string, detail: string, tone: string) => {
    if (date) evs.push({ date: String(date).slice(0, 10), label, detail, tone })
  }

  push(job.created_at, 'Job created', job.client || '', 'bg-gray-100 text-gray-700')
  push(job.quote_sent, 'Quote sent', `${fmtCurrency(job.quote_ex_gst)} ex GST`, 'bg-[#fef3c7] text-[#92400e]')
  push(job.sched_start, 'Scheduled to start',
    `${job.est_days || 1} day${(job.est_days || 1) === 1 ? '' : 's'}`, 'bg-[#dbeafe] text-[#1e40af]')
  ;(variations.data ?? []).forEach(v =>
    push(v.date ?? v.created_at, `Variation — ${v.var_status || 'Pending'}`,
      `${v.var_desc || ''} ${fmtCurrency(v.amount_ex_gst)}`.trim(), 'bg-[#f3e8ff] text-[#6b21a8]'))
  ;(labour.data ?? []).forEach(l =>
    push(l.date, 'Labour logged', `${l.hours ?? 0} hrs · ${l.sub || ''}`.trim(), 'bg-[#dcfce7] text-[#166534]'))
  ;(materials.data ?? []).forEach(m =>
    push(m.date, 'Materials logged',
      `${m.supplier || ''} ${fmtCurrency(m.cost_ex_gst)}`.trim(), 'bg-[#ffedd5] text-[#9a3412]'))
  ;(invoices.data ?? []).forEach(i => {
    push(i.date, `Invoice ${i.id}`, `${fmtCurrency(i.total_inc_gst)} inc GST`, 'bg-[#e0e7ff] text-[#3730a3]')
    if (Number(i.received) > 0) {
      push(i.paid_date ?? i.date, 'Payment received', fmtCurrency(i.received), 'bg-[#d1fae5] text-[#065f46]')
    }
  })

  evs.sort((a, b) => b.date.localeCompare(a.date))
  const loading = [labour, materials, invoices, variations].some(x => x.isLoading)

  if (loading) {
    return <div className="flex justify-center py-10"><Loader2 size={18} className="animate-spin text-blue-600" /></div>
  }
  if (!evs.length) {
    return <div className="text-[12px] text-gray-500 flex items-center gap-1.5"><Clock size={14} /> Nothing recorded against this job yet.</div>
  }

  return (
    <div className="max-h-[52vh] overflow-y-auto pr-1">
      {evs.map((e, i) => (
        <div key={i} className="flex gap-3 items-start py-1.5 border-t border-black/[0.06] first:border-t-0">
          <span className="text-[11px] text-[#666] w-20 shrink-0 pt-0.5">{fmtDate(e.date)}</span>
          <span className={`text-[10px] font-semibold rounded-full px-2 py-0.5 shrink-0 ${e.tone}`}>{e.label}</span>
          <span className="text-[12px] text-gray-700 flex-1 break-words">{e.detail}</span>
        </div>
      ))}
    </div>
  )
}


// ── The modal ────────────────────────────────────────────────
export default function JobModal({ open, jobId, initial, onClose }: {
  open: boolean
  /** null opens a blank New Job form. */
  jobId: string | null
  /** Prefill for a new job, or an override for an existing one. */
  initial?: Job
  onClose: () => void
}) {
  const { data: jobs = [] } = useJobsList()
  const upsert = useUpsertJob()
  const del = useDeleteJob()

  const [form, setForm] = useState<Job>(emptyForm())
  const [tab, setTab] = useState<Tab>('details')
  const [saving, setSaving] = useState(false)
  const selectedId = jobId

  // Reload the form whenever the modal opens on a different job, and whenever
  // the stored row changes underneath it — a quick edit on the list behind.
  const stored = jobs.find(j => j.id === jobId)
  useEffect(() => {
    if (!open) return
    setTab('details')
    setForm({ ...emptyForm(), ...(stored ?? {}), ...(initial ?? {}) })
    // `initial` is a fresh object on every render, so it is deliberately not a
    // dependency — it is read once, as the modal opens on this job.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, jobId, stored?.updated_at])

  function set(k: string, v: any) { setForm(prev => ({ ...prev, [k]: v })) }
  const fld = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => set(k, e.target.value)
  const num = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => set(k, e.target.value === '' ? null : parseFloat(e.target.value))

  async function handleSave() {
    setSaving(true)
    try {
      const existingNos = jobs.map(j => j.quote_no).filter(Boolean)
      const id = selectedId || nextJobId(jobs.map(j => j.id))
      const quoteNo = form.quote_no || genQuoteNo(existingNos)
      // Recalculate scheduled dates if start/days changed
      const schedDates = deriveScheduledDates(form)
      await upsert.mutateAsync({
        ...form,
        id,
        quote_no: quoteNo,
        scheduled_dates: schedDates.length ? schedDates : (form.scheduled_dates ?? []),
        created_at: form.created_at || new Date().toISOString(),
      })
      onClose()
    } catch (e: any) {
      alert('Save failed: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!selectedId || !confirm(`Delete job ${selectedId}? This cannot be undone.`)) return
    await del.mutateAsync(selectedId)
    onClose()
  }

  return (
      <Modal open={open} onClose={onClose} size="xl"
        title={selectedId ? `Edit ${selectedId}` : 'New Job'}>

        {/* Tabs */}
        <div className="flex flex-wrap gap-1 mb-5 bg-gray-50 p-1 rounded-lg">
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex-1 min-w-[84px] text-xs py-1.5 rounded-md font-medium transition-colors capitalize ${tab === t ? 'bg-gray-200 text-gray-900' : 'text-gray-500 hover:text-gray-900'}`}>
              {TAB_LABELS[t] ?? t}
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
                    {deriveScheduledDates(form).map(d => (
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
        {tab === 'crew' && <CrewTab job={form} jobId={selectedId} />}
        {tab === 'activity' && <ActivityTab job={form} jobId={selectedId} />}

        <div className="flex items-center justify-between mt-6 pt-4 border-t border-gray-200">
          <div>
            {selectedId && (
              <button onClick={handleDelete} className="flex items-center gap-1.5 text-sm text-red-400 hover:text-red-300 transition-colors">
                <Trash2 size={14} /> Delete job
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="text-sm px-4 py-2 rounded-lg bg-gray-50 text-gray-500 hover:text-gray-900 transition-colors">
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
  )
}
