import { useState, useMemo, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Modal } from '@/components/ui/Modal'
import { Input, Select, TextArea } from '@/components/ui/Field'
import { Badge } from '@/components/ui/Badge'
import { fmtCurrency, fmtDate, genId, today } from '@/lib/utils'
import { Plus, Search, Loader2, Trash2, User, ChevronLeft, ChevronRight } from 'lucide-react'
import { addDays } from '@/lib/utils'

type CrewMember = Record<string, any>
type Assignment = Record<string, any>

const PAYMENT_TYPES = ['ABN', 'Cash']
const ROLES = ['Painter', 'Lead Painter', 'Apprentice', 'Labourer', 'Subcontractor']
const TIME_SLOTS = ['full', 'morning', 'afternoon']

function useCrew() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['np_crew', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('np_crew').select('*').eq('user_id', user!.id).order('name')
      if (error) throw error
      return (data ?? []) as CrewMember[]
    },
    enabled: !!user,
  })
}

function useAssignments() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['np_assignments', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('np_assignments').select('*').eq('user_id', user!.id).order('date', { ascending: false })
      if (error) throw error
      return (data ?? []) as Assignment[]
    },
    enabled: !!user,
  })
}

function useJobs() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['np_jobs_simple', user?.id],
    queryFn: async () => {
      const { data } = await supabase.from('np_jobs').select('id,client,address,status,scheduled_dates').eq('user_id', user!.id).order('created_at', { ascending: false })
      return (data ?? []) as any[]
    },
    enabled: !!user,
  })
}

function useUpsertCrew() {
  const qc = useQueryClient()
  const { user } = useAuth()
  return useMutation({
    mutationFn: async (c: CrewMember) => {
      const { error } = await supabase.from('np_crew').upsert({ ...c, user_id: user!.id, updated_at: new Date().toISOString() } as any)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['np_crew'] }),
  })
}

function useDeleteCrew() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('np_crew').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['np_crew'] }),
  })
}

function useUpsertAssignment() {
  const qc = useQueryClient()
  const { user } = useAuth()
  return useMutation({
    mutationFn: async (a: Assignment) => {
      const { error } = await supabase.from('np_assignments').upsert({ ...a, user_id: user!.id, updated_at: new Date().toISOString() } as any)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['np_assignments'] })
      qc.invalidateQueries({ queryKey: ['np_jobs'] })
    },
  })
}

function useDeleteAssignment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('np_assignments').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['np_assignments'] }),
  })
}

export default function Crew() {
  const { data: crew = [], isLoading } = useCrew()
  const { data: assignments = [] } = useAssignments()
  const { data: jobs = [] } = useJobs()
  const upsertCrew = useUpsertCrew()
  const deleteCrew = useDeleteCrew()
  const upsertAssignment = useUpsertAssignment()
  const deleteAssignment = useDeleteAssignment()

  const [tab, setTab] = useState<'crew' | 'schedule' | 'assignments'>('crew')
  const [weekOffset, setWeekOffset] = useState(0)
  const [search, setSearch] = useState('')
  const [crewForm, setCrewForm] = useState<CrewMember>({})
  const [crewModalOpen, setCrewModalOpen] = useState(false)
  const [selectedCrewId, setSelectedCrewId] = useState<string | null>(null)
  const [asnForm, setAsnForm] = useState<Assignment>({ date: today(), time_slot: 'full' })
  const [asnModalOpen, setAsnModalOpen] = useState(false)
  const [selectedAsnId, setSelectedAsnId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // ── Crew helpers ────────────────────────────────────────────
  function openNewCrew() { setCrewForm({ payment_type: 'ABN', role: 'Painter' }); setSelectedCrewId(null); setCrewModalOpen(true) }
  function openEditCrew(c: CrewMember) { setCrewForm({ ...c }); setSelectedCrewId(c.id); setCrewModalOpen(true) }
  const cf = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setCrewForm(prev => ({ ...prev, [k]: e.target.value }))
  const cn = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setCrewForm(prev => ({ ...prev, [k]: parseFloat(e.target.value) || 0 }))

  async function saveCrew() {
    setSaving(true)
    try {
      await upsertCrew.mutateAsync({ ...crewForm, id: selectedCrewId || genId('c'), created_at: crewForm.created_at || new Date().toISOString() })
      setCrewModalOpen(false)
    } finally { setSaving(false) }
  }

  async function handleDeleteCrew() {
    if (!selectedCrewId || !confirm('Delete crew member?')) return
    await deleteCrew.mutateAsync(selectedCrewId)
    setCrewModalOpen(false)
  }

  // ── Assignment helpers ───────────────────────────────────────
  function openNewAsn(crewMember?: CrewMember) {
    setAsnForm({ date: today(), time_slot: 'full', crew_name: crewMember?.name || '' })
    setSelectedAsnId(null)
    setAsnModalOpen(true)
  }

  function openEditAsn(a: Assignment) {
    setAsnForm({ ...a })
    setSelectedAsnId(a.id)
    setAsnModalOpen(true)
  }

  const af = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setAsnForm(prev => ({ ...prev, [k]: e.target.value }))

  async function saveAsn() {
    setSaving(true)
    try {
      const id = selectedAsnId || genId('a')
      await upsertAssignment.mutateAsync({ ...asnForm, id, created_at: asnForm.created_at || new Date().toISOString() })
      setAsnModalOpen(false)
    } finally { setSaving(false) }
  }

  async function handleDeleteAsn() {
    if (!selectedAsnId || !confirm('Delete assignment?')) return
    await deleteAssignment.mutateAsync(selectedAsnId)
    setAsnModalOpen(false)
  }

  // ── Filtered lists ───────────────────────────────────────────
  const filteredCrew = useMemo(() =>
    crew.filter(c => !search || c.name?.toLowerCase().includes(search.toLowerCase())),
    [crew, search])

  const filteredAsn = useMemo(() =>
    assignments.filter(a => !search || [a.crew_name, a.job_id].some(v => v?.toLowerCase().includes(search.toLowerCase()))),
    [assignments, search])

  // Crew stats
  function crewStats(c: CrewMember) {
    const myAsn = assignments.filter(a => a.crew_name === c.name)
    const upcoming = myAsn.filter(a => a.date >= today()).length
    const recent = myAsn.filter(a => a.date < today()).slice(0, 3)
    return { upcoming, recent, total: myAsn.length }
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-800 space-y-3 shrink-0">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold text-white">Crew & Assignments</h1>
          <button
            onClick={() => tab === 'crew' ? openNewCrew() : openNewAsn()}
            className="flex items-center gap-1.5 bg-yellow-400 hover:bg-yellow-300 text-gray-900 font-semibold text-sm px-3 py-1.5 rounded-lg transition-colors">
            <Plus size={14} /> {tab === 'crew' ? 'Add crew' : 'New assignment'}
          </button>
        </div>
        <div className="flex gap-1 bg-gray-800 p-1 rounded-lg">
          {(['crew', 'schedule', 'assignments'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex-1 text-xs py-1.5 rounded-md font-medium capitalize transition-colors ${tab === t ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}>
              {t === 'crew' ? `Crew (${crew.length})` : t === 'schedule' ? 'Schedule' : `Assignments (${assignments.length})`}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder={`Search ${tab}…`}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-8 pr-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-yellow-400" />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && <div className="flex items-center justify-center py-16"><Loader2 size={20} className="animate-spin text-yellow-400" /></div>}

        {tab === 'crew' && (
          <div className="divide-y divide-gray-800">
            {filteredCrew.length === 0 && !isLoading && <div className="text-center py-16 text-gray-500 text-sm">No crew members yet</div>}
            {filteredCrew.map(c => {
              const stats = crewStats(c)
              return (
                <div key={c.id} className="px-6 py-4 hover:bg-gray-800/30 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-full bg-gray-700 flex items-center justify-center shrink-0">
                        <User size={16} className="text-gray-400" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-white">{c.name}</div>
                        <div className="text-xs text-gray-400">{c.role} · {c.payment_type}</div>
                        <div className="flex items-center gap-3 mt-1">
                          {c.rate && <span className="text-xs text-gray-500">Cost {fmtCurrency(c.rate)}/hr</span>}
                          {c.charge_rate && <span className="text-xs text-gray-500">Charge {fmtCurrency(c.charge_rate)}/hr</span>}
                          {c.phone && <a href={`tel:${c.phone}`} className="text-xs text-blue-400 hover:underline">{c.phone}</a>}
                        </div>
                        <div className="flex items-center gap-3 mt-1.5">
                          <span className="text-xs text-gray-500">{stats.upcoming} upcoming</span>
                          <span className="text-xs text-gray-500">{stats.total} total assignments</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      <button onClick={() => openNewAsn(c)}
                        className="text-xs px-2.5 py-1 rounded-lg bg-gray-700 text-gray-300 hover:text-white hover:bg-gray-600 transition-colors">
                        + Assign
                      </button>
                      <button onClick={() => openEditCrew(c)}
                        className="text-xs px-2.5 py-1 rounded-lg bg-gray-700 text-gray-300 hover:text-white hover:bg-gray-600 transition-colors">
                        Edit
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {tab === 'schedule' && (() => {
          // Build 7-day window starting from Monday of current week + offset
          const now = new Date()
          const dayOfWeek = now.getDay() // 0=Sun
          const monday = new Date(now)
          monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1) + weekOffset * 7)
          monday.setHours(0,0,0,0)
          const days = Array.from({ length: 7 }, (_, i) => {
            const d = new Date(monday)
            d.setDate(monday.getDate() + i)
            return d.toISOString().slice(0, 10)
          })
          const DAY_LABELS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
          const todayStr = today()

          // Map date+crewName → assignments
          const asnMap: Record<string, any[]> = {}
          assignments.forEach(a => {
            const key = `${a.date}__${a.crew_name}`
            if (!asnMap[key]) asnMap[key] = []
            asnMap[key].push(a)
          })

          // Crew sorted alphabetically
          const schedCrew = [...crew].sort((a, b) => (a.name || '').localeCompare(b.name || ''))

          return (
            <div className="p-4 space-y-3 overflow-x-auto">
              {/* Week navigation */}
              <div className="flex items-center gap-3 mb-2">
                <button onClick={() => setWeekOffset(o => o - 1)} className="p-1.5 rounded-lg bg-gray-800 text-gray-400 hover:text-white transition-colors"><ChevronLeft size={14} /></button>
                <span className="text-sm text-white font-medium min-w-[160px] text-center">
                  {new Date(days[0]).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
                  {' – '}
                  {new Date(days[6]).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
                </span>
                <button onClick={() => setWeekOffset(o => o + 1)} className="p-1.5 rounded-lg bg-gray-800 text-gray-400 hover:text-white transition-colors"><ChevronRight size={14} /></button>
                {weekOffset !== 0 && (
                  <button onClick={() => setWeekOffset(0)} className="text-xs text-yellow-400 hover:text-yellow-300 ml-1">Today</button>
                )}
              </div>

              {schedCrew.length === 0
                ? <p className="text-sm text-gray-500 py-8 text-center">No crew members yet</p>
                : (
                  <div className="rounded-xl border border-gray-800 overflow-hidden">
                    <table className="w-full min-w-[700px]">
                      <thead>
                        <tr className="bg-gray-900">
                          <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 w-28 sticky left-0 bg-gray-900 z-10">Crew</th>
                          {days.map((d, i) => (
                            <th key={d} className={`px-2 py-2.5 text-center text-xs font-semibold min-w-[90px] ${d === todayStr ? 'text-yellow-400 bg-yellow-400/5' : 'text-gray-500'}`}>
                              <div>{DAY_LABELS[i]}</div>
                              <div className="font-normal text-gray-600">{new Date(d).getDate()}</div>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {schedCrew.map(c => (
                          <tr key={c.id} className="border-t border-gray-800">
                            <td className="px-3 py-2 text-xs font-medium text-white whitespace-nowrap sticky left-0 bg-gray-950 z-10">
                              {c.name}
                              <div className="text-gray-500 font-normal">{c.role}</div>
                            </td>
                            {days.map(d => {
                              const cell = asnMap[`${d}__${c.name}`] || []
                              const isToday = d === todayStr
                              return (
                                <td key={d} className={`px-1 py-1.5 text-center align-top ${isToday ? 'bg-yellow-400/5' : ''}`}>
                                  {cell.length > 0
                                    ? cell.map(a => {
                                        const job = jobs.find(j => j.id === a.job_id)
                                        return (
                                          <button key={a.id} onClick={() => openEditAsn(a)}
                                            className="block w-full text-left mb-1 bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 rounded px-1.5 py-1 transition-colors">
                                            <div className="text-xs font-medium truncate">{a.job_id || '—'}</div>
                                            {job && <div className="text-xs text-blue-400/70 truncate">{job.client}</div>}
                                            {a.time_slot !== 'full' && <div className="text-xs text-blue-400/50">{a.time_slot}</div>}
                                          </button>
                                        )
                                      })
                                    : (
                                      <button onClick={() => { setAsnForm({ date: d, time_slot: 'full', crew_name: c.name }); setSelectedAsnId(null); setAsnModalOpen(true) }}
                                        className="w-full h-8 rounded border border-dashed border-gray-800 hover:border-gray-600 transition-colors text-gray-700 hover:text-gray-500 text-xs">
                                        +
                                      </button>
                                    )
                                  }
                                </td>
                              )
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              }
            </div>
          )
        })()}

        {tab === 'assignments' && (
          <div className="divide-y divide-gray-800">
            {filteredAsn.length === 0 && !isLoading && <div className="text-center py-16 text-gray-500 text-sm">No assignments yet</div>}
            {filteredAsn.map(a => {
              const job = jobs.find(j => j.id === a.job_id)
              const isPast = a.date < today()
              return (
                <button key={a.id} onClick={() => openEditAsn(a)}
                  className="w-full text-left px-6 py-3.5 hover:bg-gray-800/30 transition-colors">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-white">{a.crew_name}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${a.time_slot === 'full' ? 'bg-blue-500/20 text-blue-400' : 'bg-gray-700 text-gray-300'}`}>
                          {a.time_slot}
                        </span>
                        {isPast && <span className="text-xs text-gray-600">past</span>}
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5">
                        {job ? `${a.job_id} — ${job.client}` : a.job_id}
                      </div>
                      {a.notes && <div className="text-xs text-gray-500 mt-0.5 truncate">{a.notes}</div>}
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-semibold text-white">{fmtDate(a.date)}</div>
                      {a.hours && <div className="text-xs text-gray-400">{a.hours}h</div>}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Crew modal */}
      <Modal open={crewModalOpen} onClose={() => setCrewModalOpen(false)} title={selectedCrewId ? 'Edit crew member' : 'Add crew member'}>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Full name" value={crewForm.name || ''} onChange={cf('name')} wrapperClassName="col-span-2" />
          <Select label="Role" value={crewForm.role || ''} onChange={cf('role')} options={ROLES} placeholder="—" />
          <Select label="Payment type" value={crewForm.payment_type || ''} onChange={cf('payment_type')} options={PAYMENT_TYPES} />
          <Input label="Cost rate ($/hr)" type="number" value={crewForm.rate || ''} onChange={cn('rate')} min={0} />
          <Input label="Charge rate ($/hr)" type="number" value={crewForm.charge_rate || ''} onChange={cn('charge_rate')} min={0} />
          <Input label="Phone" type="tel" value={crewForm.phone || ''} onChange={cf('phone')} />
          <Input label="Email" type="email" value={crewForm.email || ''} onChange={cf('email')} />
          <TextArea label="Notes" value={crewForm.notes || ''} onChange={cf('notes')} wrapperClassName="col-span-2" />
        </div>
        <div className="flex justify-between mt-5 pt-4 border-t border-gray-800">
          <div>{selectedCrewId && <button onClick={handleDeleteCrew} className="flex items-center gap-1.5 text-sm text-red-400 hover:text-red-300"><Trash2 size={14} /> Delete</button>}</div>
          <div className="flex gap-2">
            <button onClick={() => setCrewModalOpen(false)} className="text-sm px-4 py-2 rounded-lg bg-gray-800 text-gray-400 hover:text-white">Cancel</button>
            <button onClick={saveCrew} disabled={saving} className="flex items-center gap-1.5 text-sm px-5 py-2 rounded-lg bg-yellow-400 hover:bg-yellow-300 text-gray-900 font-semibold disabled:opacity-50">
              {saving && <Loader2 size={13} className="animate-spin" />} Save
            </button>
          </div>
        </div>
      </Modal>

      {/* Assignment modal */}
      <Modal open={asnModalOpen} onClose={() => setAsnModalOpen(false)} title={selectedAsnId ? 'Edit assignment' : 'New assignment'}>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-400 mb-1">Crew member</label>
            <select value={asnForm.crew_name || ''} onChange={af('crew_name')}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-yellow-400">
              <option value="">— Select crew —</option>
              {crew.map(c => <option key={c.id} value={c.name}>{c.name} ({c.role})</option>)}
            </select>
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-400 mb-1">Job</label>
            <select value={asnForm.job_id || ''} onChange={af('job_id')}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-yellow-400">
              <option value="">— Select job —</option>
              {jobs.filter(j => ['Not Started','Scheduled','In Progress','Hourly Rate Accepted'].includes(j.status)).map(j => (
                <option key={j.id} value={j.id}>{j.id} — {j.client}</option>
              ))}
            </select>
          </div>
          <Input label="Date" type="date" value={asnForm.date || ''} onChange={af('date')} />
          <Select label="Time slot" value={asnForm.time_slot || ''} onChange={af('time_slot')} options={TIME_SLOTS} />
          <Input label="Hours" type="number" value={asnForm.hours || ''} onChange={e => setAsnForm(prev => ({ ...prev, hours: parseFloat(e.target.value) || null }))} min={0} step={0.5} />
          <TextArea label="Notes" value={asnForm.notes || ''} onChange={af('notes')} wrapperClassName="col-span-2" />
        </div>
        <div className="flex justify-between mt-5 pt-4 border-t border-gray-800">
          <div>{selectedAsnId && <button onClick={handleDeleteAsn} className="flex items-center gap-1.5 text-sm text-red-400 hover:text-red-300"><Trash2 size={14} /> Delete</button>}</div>
          <div className="flex gap-2">
            <button onClick={() => setAsnModalOpen(false)} className="text-sm px-4 py-2 rounded-lg bg-gray-800 text-gray-400 hover:text-white">Cancel</button>
            <button onClick={saveAsn} disabled={saving} className="flex items-center gap-1.5 text-sm px-5 py-2 rounded-lg bg-yellow-400 hover:bg-yellow-300 text-gray-900 font-semibold disabled:opacity-50">
              {saving && <Loader2 size={13} className="animate-spin" />} Save
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
