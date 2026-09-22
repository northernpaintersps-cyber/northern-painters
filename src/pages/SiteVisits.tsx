import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Modal } from '@/components/ui/Modal'
import { Input, TextArea } from '@/components/ui/Field'
import { fmtDate, genId, today } from '@/lib/utils'
import { Plus, Loader2, Trash2, Edit2, Search, MapPin, CalendarDays, Calculator } from 'lucide-react'

function useSiteVisits() {
  const { user } = useAuth()
  return useQuery<any[]>({
    queryKey: ['np_site_visits', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('np_site_visits').select('*').eq('user_id', user!.id).order('date', { ascending: false })
      if (error) throw error
      return data ?? []
    },
    enabled: !!user,
  })
}

function useJobs() {
  const { user } = useAuth()
  return useQuery<any[]>({
    queryKey: ['np_jobs_sv', user?.id],
    queryFn: async () => {
      const { data } = await supabase.from('np_jobs').select('id,client,address').eq('user_id', user!.id)
      return data ?? []
    },
    enabled: !!user,
  })
}

function useUpsert() {
  const qc = useQueryClient()
  const { user } = useAuth()
  return useMutation({
    mutationFn: async (row: any) => {
      const { error } = await supabase.from('np_site_visits').upsert({ ...row, user_id: user!.id, updated_at: new Date().toISOString() } as any)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['np_site_visits'] }),
  })
}

function useDelete() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('np_site_visits').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['np_site_visits'] }),
  })
}

export default function SiteVisits() {
  const { data: visits = [], isLoading } = useSiteVisits()
  const { data: jobs = [] } = useJobs()
  const upsert = useUpsert()
  const del = useDelete()
  const navigate = useNavigate()

  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<any>({})
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')

  const ef = (k: string) => (e: React.ChangeEvent<any>) =>
    setForm((p: any) => ({ ...p, [k]: e.target.value }))

  function openNew() { setForm({ date: today() }); setOpen(true) }
  function openEdit(v: any) { setForm({ ...v }); setOpen(true) }

  function buildQuote(v: any) {
    const job = jobs.find(j => j.id === v.job_id)
    try {
      sessionStorage.setItem('np_prefill_quote', JSON.stringify({
        job_id: v.job_id || '',
        client: job?.client || '',
        address: job?.address || v.address || '',
        notes: v.notes || '',
      }))
    } catch {}
    navigate('/quotes')
  }

  async function save() {
    setSaving(true)
    try {
      await upsert.mutateAsync({ ...form, id: form.id || genId('sv') })
      setOpen(false)
    } finally { setSaving(false) }
  }

  const filtered = useMemo(() => {
    if (!search) return visits
    const q = search.toLowerCase()
    return visits.filter(v => [v.job_id, v.notes, jobs.find((j: any) => j.id === v.job_id)?.client].some(f => f?.toLowerCase().includes(q)))
  }, [visits, search, jobs])

  const jobMap = useMemo(() => Object.fromEntries(jobs.map(j => [j.id, j])), [jobs])

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Site Visits</h1>
          <p className="text-xs text-gray-500 mt-0.5">{visits.length} recorded</p>
        </div>
        <button onClick={openNew}
          className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-gray-900 font-semibold text-sm px-3 py-1.5 rounded-lg transition-colors">
          <Plus size={14} /> Log visit
        </button>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by job or notes…"
          className="w-full bg-white border border-gray-200 rounded-lg pl-8 pr-3 py-2 text-sm text-gray-900 placeholder-gray-500 focus:outline-none focus:border-blue-500/50" />
      </div>

      {/* List */}
      {isLoading
        ? <div className="flex justify-center py-16"><Loader2 size={20} className="animate-spin text-blue-600" /></div>
        : (
          <div className="space-y-3">
            {filtered.map(v => {
              const job = jobMap[v.job_id]
              return (
                <div key={v.id} className="bg-white rounded-xl border border-gray-200 p-4 hover:border-gray-200 transition-colors group">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0 space-y-1.5">
                      <div className="flex items-center gap-3 flex-wrap">
                        <div className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
                          <CalendarDays size={14} className="text-blue-600" />
                          {fmtDate(v.date)}
                        </div>
                        {job && (
                          <div className="flex items-center gap-1 text-xs text-gray-500">
                            <span className="font-mono text-gray-500">{v.job_id}</span>
                            <span>·</span>
                            <span>{job.client || '—'}</span>
                          </div>
                        )}
                      </div>
                      {job?.address && (
                        <div className="flex items-center gap-1 text-xs text-gray-500">
                          <MapPin size={10} /> {job.address}
                        </div>
                      )}
                      {v.notes && <p className="text-sm text-gray-600 mt-1">{v.notes}</p>}
                    </div>
                    <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <button onClick={() => buildQuote(v)} title="Build quote from this visit"
                        className="flex items-center gap-1 text-xs text-gray-500 hover:text-blue-600 px-2 py-1 rounded transition-colors">
                        <Calculator size={12} /> Quote
                      </button>
                      <button onClick={() => openEdit(v)} className="text-gray-500 hover:text-blue-600 p-1"><Edit2 size={13} /></button>
                      <button onClick={() => { if (confirm('Delete this visit?')) del.mutate(v.id) }} className="text-gray-500 hover:text-red-400 p-1"><Trash2 size={13} /></button>
                    </div>
                  </div>
                </div>
              )
            })}
            {!filtered.length && (
              <div className="text-center py-12 text-gray-500 text-sm">No site visits found</div>
            )}
          </div>
        )
      }

      {/* Modal */}
      <Modal open={open} onClose={() => setOpen(false)} title={form.id ? 'Edit site visit' : 'Log site visit'}>
        <div className="space-y-3">
          <Input label="Date" type="date" value={form.date || ''} onChange={ef('date')} />
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">Job</label>
            <select value={form.job_id || ''} onChange={ef('job_id')}
              className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer">
              <option value="">— No job —</option>
              {jobs.map(j => <option key={j.id} value={j.id}>{j.id} {j.client || ''} {j.address ? `— ${j.address}` : ''}</option>)}
            </select>
          </div>
          <TextArea label="Notes / observations" value={form.notes || ''} onChange={ef('notes')} rows={4} />
        </div>
        <div className="flex justify-between mt-5 pt-4 border-t border-gray-200">
          <div>
            {form.id && (
              <button onClick={() => { if (confirm('Delete?')) { del.mutate(form.id); setOpen(false) } }}
                className="flex items-center gap-1.5 text-sm text-red-400 hover:text-red-300">
                <Trash2 size={14} /> Delete
              </button>
            )}
          </div>
          <div className="flex gap-2">
            {form.id && (
              <button onClick={() => { setOpen(false); buildQuote(form) }}
                className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 font-medium transition-colors">
                <Calculator size={13} /> Build quote
              </button>
            )}
            <button onClick={() => setOpen(false)} className="text-sm px-4 py-2 rounded-lg bg-gray-50 text-gray-500 hover:text-gray-900">Cancel</button>
            <button onClick={save} disabled={saving} className="flex items-center gap-1.5 text-sm px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-gray-900 font-semibold disabled:opacity-50">
              {saving && <Loader2 size={13} className="animate-spin" />} Save
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
