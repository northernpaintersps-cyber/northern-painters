import { useState } from 'react'
import { useJobs, useUpsertJob, useDeleteJob } from '@/hooks/useJobs'
import { Plus, Search, ChevronRight, Loader2 } from 'lucide-react'
import type { Job } from '@/hooks/useJobs'
import { useAuth } from '@/lib/auth'

const STATUS_COLORS: Record<string, string> = {
  'Active':     'bg-green-500/20 text-green-400',
  'Quoting':    'bg-yellow-500/20 text-yellow-400',
  'Completed':  'bg-blue-500/20 text-blue-400',
  'Invoiced':   'bg-purple-500/20 text-purple-400',
  'On Hold':    'bg-gray-500/20 text-gray-400',
  'Cancelled':  'bg-red-500/20 text-red-400',
}

const JOB_TYPES = [
  'Interior repaint','Exterior repaint','Full repaint','Deck/timber coating',
  'Hourly rate','New build - exterior','New build - interior','Limewash / specialty','Other'
]
const JOB_STATUSES = ['Quoting','Active','On Hold','Completed','Invoiced','Cancelled']

function fmtCurrency(n: number | null) {
  if (!n) return '—'
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(n)
}

function genId() {
  return 'NP-' + Date.now().toString(36).toUpperCase()
}

export default function Jobs() {
  const { data: jobs = [], isLoading } = useJobs()
  const upsert = useUpsertJob()
  const del = useDeleteJob()
  const { user } = useAuth()

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  const [selected, setSelected] = useState<Job | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<Partial<Job>>({})
  const [saving, setSaving] = useState(false)

  const filtered = jobs.filter(j => {
    const matchSearch = !search || [j.client, j.address, j.id, j.type].some(v =>
      v?.toLowerCase().includes(search.toLowerCase())
    )
    const matchStatus = statusFilter === 'All' || j.status === statusFilter
    return matchSearch && matchStatus
  })

  function openNew() {
    setForm({ status: 'Quoting', type: 'Interior repaint' })
    setSelected(null)
    setShowForm(true)
  }

  function openEdit(j: Job) {
    setForm(j)
    setSelected(j)
    setShowForm(true)
  }

  async function handleSave() {
    setSaving(true)
    try {
      await upsert.mutateAsync({
        id: form.id || genId(),
        ...form,
      } as Job)
      setShowForm(false)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!selected || !confirm(`Delete job ${selected.id}?`)) return
    await del.mutateAsync(selected.id)
    setShowForm(false)
    setSelected(null)
  }

  const f = (k: keyof Job) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }))

  return (
    <div className="flex h-full">
      {/* List panel */}
      <div className="w-full max-w-md border-r border-gray-800 flex flex-col h-full">
        <div className="px-4 py-4 border-b border-gray-800 space-y-3">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-bold text-white">Jobs</h1>
            <button onClick={openNew} className="flex items-center gap-1.5 bg-yellow-400 hover:bg-yellow-300 text-gray-900 font-semibold text-sm px-3 py-1.5 rounded-lg transition-colors">
              <Plus size={14} /> New job
            </button>
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search jobs…"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-8 pr-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-yellow-400"
            />
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-0.5">
            {['All', ...JOB_STATUSES].map(s => (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={`shrink-0 text-xs px-2.5 py-1 rounded-full transition-colors ${statusFilter === s ? 'bg-yellow-400 text-gray-900 font-semibold' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
                {s}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-gray-800">
          {isLoading && (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={20} className="animate-spin text-yellow-400" />
            </div>
          )}
          {!isLoading && filtered.length === 0 && (
            <div className="text-center py-16 text-gray-500 text-sm">No jobs found</div>
          )}
          {filtered.map(j => (
            <button key={j.id} onClick={() => openEdit(j)}
              className={`w-full text-left px-4 py-3.5 hover:bg-gray-800/50 transition-colors ${selected?.id === j.id ? 'bg-gray-800' : ''}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs text-gray-500 font-mono">{j.id}</span>
                    {j.status && (
                      <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${STATUS_COLORS[j.status] || 'bg-gray-700 text-gray-300'}`}>
                        {j.status}
                      </span>
                    )}
                  </div>
                  <div className="text-sm font-medium text-white truncate">{j.client || '—'}</div>
                  <div className="text-xs text-gray-400 truncate">{j.address || '—'}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-semibold text-white">{fmtCurrency(j.agreed_ex_gst)}</div>
                  <div className="text-xs text-gray-500">{j.type}</div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Detail / form panel */}
      {showForm && (
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-2xl">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-white">{selected ? `Edit ${selected.id}` : 'New Job'}</h2>
              <div className="flex gap-2">
                {selected && (
                  <button onClick={handleDelete} className="text-sm px-3 py-1.5 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors">
                    Delete
                  </button>
                )}
                <button onClick={() => setShowForm(false)} className="text-sm px-3 py-1.5 rounded-lg bg-gray-800 text-gray-400 hover:text-white transition-colors">
                  Cancel
                </button>
                <button onClick={handleSave} disabled={saving}
                  className="flex items-center gap-1.5 text-sm px-4 py-1.5 rounded-lg bg-yellow-400 hover:bg-yellow-300 text-gray-900 font-semibold transition-colors disabled:opacity-50">
                  {saving && <Loader2 size={13} className="animate-spin" />}
                  Save
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Client" value={form.client || ''} onChange={f('client')} />
              <Field label="Address" value={form.address || ''} onChange={f('address')} />
              <SelectField label="Type" value={form.type || ''} onChange={f('type')} options={JOB_TYPES} />
              <SelectField label="Status" value={form.status || ''} onChange={f('status')} options={JOB_STATUSES} />
              <Field label="Quote (ex GST)" value={form.quote_ex_gst?.toString() || ''} onChange={f('quote_ex_gst')} type="number" />
              <Field label="Agreed (ex GST)" value={form.agreed_ex_gst?.toString() || ''} onChange={f('agreed_ex_gst')} type="number" />
              <Field label="Est. Labour (ex GST)" value={form.est_labour_ex?.toString() || ''} onChange={f('est_labour_ex')} type="number" />
              <Field label="Est. Materials (ex GST)" value={form.est_materials_ex?.toString() || ''} onChange={f('est_materials_ex')} type="number" />
              <Field label="Labour Rate ($/hr)" value={form.labour_rate?.toString() || ''} onChange={f('labour_rate')} type="number" />
              <Field label="Sched. Start" value={form.sched_start || ''} onChange={f('sched_start')} type="date" />
              <Field label="Est. Days" value={form.est_days?.toString() || ''} onChange={f('est_days')} type="number" />
              <Field label="Quote No." value={form.quote_no || ''} onChange={f('quote_no')} />
              <SelectField label="Lead Source" value={form.lead_source || ''} onChange={f('lead_source')}
                options={['Google Ads','Word of mouth','Referral','Facebook','Instagram','Walk-in','Other']} />
              <Field label="Drive Link" value={form.drive_link || ''} onChange={f('drive_link')} />
              <div className="col-span-2">
                <TextArea label="Description" value={form.job_desc || ''} onChange={f('job_desc')} />
              </div>
              <div className="col-span-2">
                <TextArea label="Notes" value={form.notes || ''} onChange={f('notes')} />
              </div>
            </div>
          </div>
        </div>
      )}

      {!showForm && (
        <div className="flex-1 flex items-center justify-center text-gray-600">
          <div className="text-center">
            <ChevronRight size={32} className="mx-auto mb-2 opacity-30" />
            <p className="text-sm">Select a job or create a new one</p>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, value, onChange, type = 'text' }: {
  label: string; value: string; onChange: React.ChangeEventHandler<HTMLInputElement>; type?: string
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-400 mb-1">{label}</label>
      <input type={type} value={value} onChange={onChange}
        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-yellow-400" />
    </div>
  )
}

function SelectField({ label, value, onChange, options }: {
  label: string; value: string; onChange: React.ChangeEventHandler<HTMLSelectElement>; options: string[]
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-400 mb-1">{label}</label>
      <select value={value} onChange={onChange}
        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-yellow-400">
        <option value="">—</option>
        {options.map(o => <option key={o}>{o}</option>)}
      </select>
    </div>
  )
}

function TextArea({ label, value, onChange }: {
  label: string; value: string; onChange: React.ChangeEventHandler<HTMLTextAreaElement>
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-400 mb-1">{label}</label>
      <textarea value={value} onChange={onChange} rows={3}
        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-yellow-400 resize-none" />
    </div>
  )
}
