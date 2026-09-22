import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Input, Select, TextArea } from '@/components/ui/Field'
import {
  fmtCurrency, fmtDate, nextJobId, genId, normaliseDate,
  getJobScheduledDates, today
} from '@/lib/utils'
import {
  Plus, Search, Loader2,
  Trash2, Calendar, Edit2
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
        <div className="text-sm text-gray-400">
          Approved variations: <span className="text-white font-semibold">{fmtCurrency(totalApproved)}</span>
          <span className="text-gray-600 mx-2">·</span>
          <span className="text-xs text-gray-500">{vars.length} total</span>
        </div>
        <button onClick={() => setVarForm({ date: today(), var_status: 'Pending', job_id: jobId })}
          className="flex items-center gap-1 text-xs bg-yellow-400 hover:bg-yellow-300 text-gray-900 font-semibold px-2.5 py-1.5 rounded-lg">
          <Plus size={12} /> Add
        </button>
      </div>

      {isLoading
        ? <div className="flex justify-center py-8"><Loader2 size={16} className="animate-spin text-yellow-400" /></div>
        : (
          <div className="space-y-2">
            {vars.map(v => (
              <div key={v.id} className="flex items-start gap-3 bg-gray-800 rounded-lg p-3 group">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <Badge label={v.var_status || 'Pending'} />
                    <span className="text-xs text-gray-500">{fmtDate(v.date)}</span>
                  </div>
                  <p className="text-sm text-white">{v.var_desc || '—'}</p>
                  {v.notes && <p className="text-xs text-gray-500 mt-0.5">{v.notes}</p>}
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold text-white">{fmtCurrency(v.amount_ex_gst)}</p>
                  <p className="text-xs text-gray-500">ex GST</p>
                </div>
                <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => setVarForm({ ...v })} className="text-gray-500 hover:text-yellow-400"><Edit2 size={12} /></button>
                  <button onClick={() => { if (confirm('Delete variation?')) del.mutate(v.id) }} className="text-gray-500 hover:text-red-400"><Trash2 size={12} /></button>
                </div>
              </div>
            ))}
            {!vars.length && <p className="text-sm text-gray-500 text-center py-6">No variations yet</p>}
          </div>
        )
      }

      {varForm && (
        <div className="bg-gray-800 rounded-xl border border-gray-700 p-4 space-y-3 mt-2">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{varForm.id ? 'Edit variation' : 'New variation'}</p>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Date" type="date" value={varForm.date || ''} onChange={ef('date')} />
            <Select label="Status" value={varForm.var_status || 'Pending'} onChange={ef('var_status')} options={VAR_STATUSES} />
          </div>
          <Input label="Description" value={varForm.var_desc || ''} onChange={ef('var_desc')} />
          <Input label="Amount ex GST ($)" type="number" value={varForm.amount_ex_gst ?? ''} onChange={ef('amount_ex_gst')} />
          <TextArea label="Notes" value={varForm.notes || ''} onChange={ef('notes')} />
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => setVarForm(null)} className="text-xs px-3 py-1.5 rounded-lg bg-gray-700 text-gray-400 hover:text-white">Cancel</button>
            <button onClick={saveVar} disabled={saving} className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-yellow-400 hover:bg-yellow-300 text-gray-900 font-semibold disabled:opacity-50">
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
      const { data, error } = await supabase.from('np_jobs').select('*').eq('user_id', user!.id).order('created_at', { ascending: false })
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

// ── Main component ────────────────────────────────────────────
export default function Jobs() {
  const { data: jobs = [], isLoading } = useJobs()
  const upsert = useUpsertJob()
  const del = useDeleteJob()
  const { user } = useAuth()

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  const [quoteFilter, setQuoteFilter] = useState('All')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [form, setForm] = useState<Job>(emptyForm())
  const [modalOpen, setModalOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [tab, setTab] = useState<'details'|'schedule'|'financials'|'variations'>('details')

  const filtered = useMemo(() => {
    return jobs.filter(j => {
      const s = search.toLowerCase()
      const matchSearch = !s || [j.client, j.address, j.id, j.type, j.job_desc].some(v => v?.toLowerCase().includes(s))
      const matchStatus = statusFilter === 'All' || j.status === statusFilter
      const matchQuote = quoteFilter === 'All' || j.quote_status === quoteFilter
      return matchSearch && matchStatus && matchQuote
    })
  }, [jobs, search, statusFilter, quoteFilter])

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
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-800 space-y-3 shrink-0">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold text-white">Jobs & Quotes</h1>
          <button onClick={openNew} className="flex items-center gap-1.5 bg-yellow-400 hover:bg-yellow-300 text-gray-900 font-semibold text-sm px-3 py-1.5 rounded-lg transition-colors">
            <Plus size={14} /> New job
          </button>
        </div>
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search client, address, job ID…"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-8 pr-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-yellow-400" />
        </div>
        <div className="flex gap-2 overflow-x-auto pb-0.5">
          <div className="flex gap-1 shrink-0">
            {['All', ...JOB_STATUSES].map(s => (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={`shrink-0 text-xs px-2.5 py-1 rounded-full transition-colors ${statusFilter === s ? 'bg-yellow-400 text-gray-900 font-semibold' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
                {s}
              </button>
            ))}
          </div>
          <div className="w-px bg-gray-700 shrink-0" />
          <div className="flex gap-1 shrink-0">
            {['All', ...QUOTE_STATUSES].map(s => (
              <button key={s} onClick={() => setQuoteFilter(s)}
                className={`shrink-0 text-xs px-2.5 py-1 rounded-full transition-colors ${quoteFilter === s ? 'bg-blue-500 text-white font-semibold' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
                {s}
              </button>
            ))}
          </div>
        </div>
        <p className="text-xs text-gray-500">{filtered.length} of {jobs.length} jobs</p>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto divide-y divide-gray-800">
        {isLoading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={20} className="animate-spin text-yellow-400" />
          </div>
        )}
        {!isLoading && filtered.length === 0 && (
          <div className="text-center py-16 text-gray-500 text-sm">No jobs found</div>
        )}
        {filtered.map(j => {
          const dates = Array.isArray(j.scheduled_dates) ? j.scheduled_dates : []
          return (
            <div key={j.id} className="flex items-center hover:bg-gray-800/40 transition-colors group">
              <button className="flex-1 text-left px-6 py-4 min-w-0" onClick={() => openEdit(j)}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-xs text-gray-500 font-mono">{j.id}</span>
                      {j.quote_status && <Badge label={j.quote_status} />}
                    </div>
                    <div className="text-sm font-semibold text-white truncate">{j.client || '—'}</div>
                    <div className="text-xs text-gray-400 truncate mt-0.5">{j.address || '—'}</div>
                    <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                      {j.type && <span className="text-xs text-gray-500">{j.type}</span>}
                      {dates.length > 0 && (
                        <span className="flex items-center gap-1 text-xs text-gray-500">
                          <Calendar size={10} />
                          {fmtDate(dates[0])}{dates.length > 1 ? ` +${dates.length - 1}d` : ''}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-bold text-white">{fmtCurrency(j.agreed_ex_gst || j.quote_ex_gst)}</div>
                    {j.agreed_ex_gst && j.quote_ex_gst && j.agreed_ex_gst !== j.quote_ex_gst && (
                      <div className="text-xs text-gray-500">quoted {fmtCurrency(j.quote_ex_gst)}</div>
                    )}
                    <div className="text-xs text-gray-500 mt-0.5">{j.quote_no || ''}</div>
                  </div>
                </div>
              </button>
              {/* Quick status selector */}
              <div className="pr-4 shrink-0">
                <select
                  value={j.status || ''}
                  onClick={e => e.stopPropagation()}
                  onChange={async e => {
                    e.stopPropagation()
                    await upsert.mutateAsync({ ...j, status: e.target.value })
                  }}
                  className="text-xs bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-gray-300 focus:outline-none focus:ring-1 focus:ring-yellow-400 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  {JOB_STATUSES.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
            </div>
          )
        })}
      </div>

      {/* Edit/New Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} size="xl"
        title={selectedId ? `Edit ${selectedId}` : 'New Job'}>

        {/* Tabs */}
        <div className="flex gap-1 mb-5 bg-gray-800 p-1 rounded-lg">
          {(['details','schedule','financials','variations'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex-1 text-xs py-1.5 rounded-md font-medium transition-colors capitalize ${tab === t ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}>
              {t}
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
                <div className="bg-gray-800 rounded-lg p-3">
                  <p className="text-xs text-gray-400 mb-2">Calculated working days:</p>
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
            <div className="col-span-2 bg-gray-800 rounded-lg p-3 space-y-1">
              <p className="text-xs text-gray-400">Estimated financials</p>
              <div className="grid grid-cols-3 gap-2 mt-2">
                {[
                  { label: 'Quote inc GST', value: fmtCurrency((form.quote_ex_gst || 0) * 1.1) },
                  { label: 'Agreed inc GST', value: fmtCurrency((form.agreed_ex_gst || 0) * 1.1) },
                  { label: 'Est. cost', value: fmtCurrency((form.est_labour_ex || 0) + (form.est_materials_ex || 0)) },
                  { label: 'Est. profit', value: fmtCurrency((form.agreed_ex_gst || 0) - (form.est_labour_ex || 0) - (form.est_materials_ex || 0)) },
                  { label: 'Est. margin', value: form.agreed_ex_gst ? `${(((form.agreed_ex_gst - (form.est_labour_ex || 0) - (form.est_materials_ex || 0)) / form.agreed_ex_gst) * 100).toFixed(1)}%` : '—' },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-gray-700/50 rounded p-2">
                    <p className="text-xs text-gray-500">{label}</p>
                    <p className="text-sm font-semibold text-white">{value}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === 'variations' && <VariationsTab jobId={selectedId} />}

        <div className="flex items-center justify-between mt-6 pt-4 border-t border-gray-800">
          <div>
            {selectedId && (
              <button onClick={handleDelete} className="flex items-center gap-1.5 text-sm text-red-400 hover:text-red-300 transition-colors">
                <Trash2 size={14} /> Delete job
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={() => setModalOpen(false)} className="text-sm px-4 py-2 rounded-lg bg-gray-800 text-gray-400 hover:text-white transition-colors">
              Cancel
            </button>
            <button onClick={handleSave} disabled={saving}
              className="flex items-center gap-1.5 text-sm px-5 py-2 rounded-lg bg-yellow-400 hover:bg-yellow-300 text-gray-900 font-semibold transition-colors disabled:opacity-50">
              {saving && <Loader2 size={13} className="animate-spin" />}
              Save job
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
