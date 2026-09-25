import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, selectAll } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Modal } from '@/components/ui/Modal'
import JobDayPanel from '@/components/JobDayPanel'
import { Input } from '@/components/ui/Field'
import { getJobScheduledDates, genId, findCrew, crewLabel } from '@/lib/utils'
import {
  Plus, Loader2, Trash2, Edit2, ChevronLeft, ChevronRight,
  MessageSquare, CalendarDays,
} from 'lucide-react'

type Row = Record<string, any>

const CONFIRMED = ['Scheduled', 'In Progress', 'Hourly Rate Accepted']
const DN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const II = 'border-none bg-transparent text-[12.5px] w-full focus:outline-none focus:bg-blue-50/60 rounded px-0.5'

const localStr = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// Monday of the week, offset by N weeks
function weekStart(offset: number) {
  const d = new Date()
  const day = (d.getDay() + 6) % 7 // Mon = 0
  d.setDate(d.getDate() - day + offset * 7)
  d.setHours(0, 0, 0, 0)
  return d
}

const SLOT = {
  full:      { label: 'Full day',  short: '',   bg: '#eaf3de', fg: '#166534', brd: '#86efac' },
  morning:   { label: 'Morning',   short: 'AM', bg: '#dbeafe', fg: '#1e40af', brd: '#93c5fd' },
  afternoon: { label: 'Afternoon', short: 'PM', bg: '#fef3c7', fg: '#92400e', brd: '#fde68a' },
} as const
type SlotKey = keyof typeof SLOT
const slotOf = (a: Row): SlotKey => (a.time_slot in SLOT ? a.time_slot : 'full')

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

function useUpsert(table: string) {
  const qc = useQueryClient()
  const { user } = useAuth()
  return useMutation({
    mutationFn: async (row: Row) => {
      const { error } = await (supabase.from(table as any) as any)
        .upsert({ ...row, user_id: user!.id, updated_at: new Date().toISOString() })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [table] }),
  })
}

function useDelete(table: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.from(table as any) as any).delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [table] }),
  })
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`bg-white border border-black/[0.12] rounded-xl mb-3.5 ${className}`}>{children}</div>
}

export default function Crew() {
  const nav = useNavigate()
  const { user } = useAuth()
  const { data: crew = [], isLoading } = useTable('np_crew')
  const { data: jobs = [] } = useTable('np_jobs')
  const { data: assignments = [] } = useTable('np_assignments')

  const { data: settings } = useQuery({
    queryKey: ['np_settings', 'business', user?.id],
    queryFn: async () => {
      const { data } = await (supabase.from('np_settings') as any)
        .select('value').eq('user_id', user!.id).eq('key', 'business').maybeSingle()
      return (data?.value ?? {}) as any
    },
    enabled: !!user,
  })
  const rate0 = settings?.rates?.standard ?? 65

  const upsertCrew = useUpsert('np_crew')
  const delCrew = useDelete('np_crew')
  const delAsn = useDelete('np_assignments')

  const [offset, setOffset] = useState(0)
  const [crewModal, setCrewModal] = useState(false)
  const [crewForm, setCrewForm] = useState<Row>({})
  const [panel, setPanel] = useState<{ jobId: string; date: string } | null>(null)

  const ws = weekStart(offset)
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => {
    const d = new Date(ws); d.setDate(d.getDate() + i); return d
  }), [ws.getTime()])
  const weekKeys = days.map(localStr)
  const todayStr = localStr(new Date())

  // V16 conflict map — same crew, same date, overlapping slot, different job
  const conflictIds = useMemo(() => {
    const out = new Set<string>()
    const overlaps = (a: SlotKey, b: SlotKey) => a === b || a === 'full' || b === 'full'
    weekKeys.forEach(date => {
      const onDay = assignments.filter(a => a.date === date)
      const refs = [...new Set(onDay.map(a => crewLabel(crew, a.crew_name)).filter(Boolean))]
      refs.forEach(name => {
        const mine = onDay.filter(a => crewLabel(crew, a.crew_name) === name)
        for (let i = 0; i < mine.length; i++)
          for (let j = i + 1; j < mine.length; j++)
            if (mine[i].job_id !== mine[j].job_id && overlaps(slotOf(mine[i]), slotOf(mine[j]))) {
              out.add(mine[i].id); out.add(mine[j].id)
            }
      })
    })
    return out
  }, [assignments, crew, weekKeys.join()])

  const schedOf = useMemo(() => {
    const m: Record<string, string[]> = {}
    jobs.forEach(j => { m[j.id] = getJobScheduledDates(j) })
    return m
  }, [jobs])

  const weekJobs = jobs.filter(j =>
    CONFIRMED.includes(j.status) && weekKeys.some(k => (schedOf[j.id] ?? []).includes(k))
  )

  // ── Crew CRUD ─────────────────────────────────────────────
  const quickCrew = (c: Row, patch: Row) => upsertCrew.mutate({ ...c, ...patch })

  function openAddCrew() {
    setCrewForm({ payment_type: 'ABN', rate: rate0, role: 'Painter' })
    setCrewModal(true)
  }
  async function saveCrew() {
    if (!crewForm.name?.trim()) { alert('Name required'); return }
    await upsertCrew.mutateAsync({ ...crewForm, id: crewForm.id || genId('c'), created_at: crewForm.created_at || new Date().toISOString() })
    setCrewModal(false)
  }
  async function removeCrew(c: Row) {
    const mine = assignments.filter(a => findCrew(crew, a.crew_name)?.id === c.id)
    const n = mine.length
    let msg = `Delete ${c.name} from the crew list?`
    if (n) msg += `\n\nThis will also remove ${n} calendar assignment${n === 1 ? '' : 's'} for this crew member.`
    if (!confirm(msg)) return
    for (const a of mine) await delAsn.mutateAsync(a.id)
    await delCrew.mutateAsync(c.id)
  }

  // ── Assignment CRUD ───────────────────────────────────────
  function openAssign(jobId: string, date: string) {
    setPanel({ jobId, date })
  }

  // V16 openBriefingMsg
  async function briefing(a: Row) {
    const j = jobs.find(x => x.id === a.job_id)
    const c = findCrew(crew, a.crew_name)
    const msg = `Hi ${crewLabel(crew, a.crew_name).split(' ')[0]},\n\nYou're booked for ${SLOT[slotOf(a)].label.toLowerCase()} on ${a.date}.\n\nJob: ${a.job_id}${j?.client ? ` — ${j.client}` : ''}\nSite: ${j?.address || 'TBC'}\n${j?.job_desc ? `Scope: ${j.job_desc}\n` : ''}${a.notes ? `Notes: ${a.notes}\n` : ''}\nSee you there.\n\nNorthern Painters`
    try {
      await navigator.clipboard.writeText(msg)
      alert(c?.phone ? `Briefing copied — send to ${c.phone}` : 'Briefing message copied!')
    } catch { prompt('Copy this message:', msg) }
  }

  if (isLoading) return (
    <div className="flex items-center justify-center h-64"><Loader2 size={20} className="animate-spin text-blue-600" /></div>
  )

  return (
    <div className="p-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <h2 className="text-[17px] font-semibold text-gray-900">Crew &amp; Calendar</h2>
        <div className="flex gap-2 items-center flex-wrap">
          <button onClick={() => setOffset(o => o - 1)}
            className="px-2 py-1.5 bg-white border border-black/20 rounded-lg hover:bg-[#f5f4f0]"><ChevronLeft size={14} /></button>
          <span className="text-[13px] font-medium">
            {ws.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })} – {days[6].toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
          </span>
          <button onClick={() => setOffset(o => o + 1)}
            className="px-2 py-1.5 bg-white border border-black/20 rounded-lg hover:bg-[#f5f4f0]"><ChevronRight size={14} /></button>
          <button onClick={openAddCrew}
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white font-medium text-[13px] px-3 py-1.5 rounded-lg">
            <Plus size={14} /> Add Crew
          </button>
        </div>
      </div>

      {/* Crew members */}
      <Card className="p-4">
        <div className="flex justify-between items-center mb-2.5 gap-2 flex-wrap">
          <div className="text-[13px] font-bold">Crew Members</div>
          <div className="text-[11px] text-[#666]">Edit inline. Add phone number to enable briefing messages.</div>
        </div>
        <div className="overflow-auto max-h-[40vh]">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr>
                {['Name','Role','Phone','Hourly rate','Assignments',''].map((h, i) => (
                  <th key={i} className="text-left px-2.5 py-[7px] border-b border-black/[0.12] text-[#666] font-medium whitespace-nowrap bg-[#fafaf8] sticky top-0 z-[2]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {crew.map(c => (
                <tr key={c.id} className="border-b border-black/[0.06] hover:bg-[#fafaf8]">
                  <td className="px-2.5 py-[7px]" style={{ minWidth: 130 }}>
                    <input defaultValue={c.name ?? ''} className={II}
                      onBlur={e => { if (e.target.value !== (c.name ?? '')) quickCrew(c, { name: e.target.value }) }} />
                  </td>
                  <td className="px-2.5 py-[7px]" style={{ minWidth: 110 }}>
                    <input defaultValue={c.role ?? ''} className={II}
                      onBlur={e => { if (e.target.value !== (c.role ?? '')) quickCrew(c, { role: e.target.value }) }} />
                  </td>
                  <td className="px-2.5 py-[7px]" style={{ minWidth: 110 }}>
                    <input type="tel" defaultValue={c.phone ?? ''} placeholder="04xx xxx xxx" className={II}
                      onBlur={e => { if (e.target.value !== (c.phone ?? '')) quickCrew(c, { phone: e.target.value }) }} />
                  </td>
                  <td className="px-2.5 py-[7px]">
                    <div className="flex items-center gap-1">
                      <span className="text-[#666]">$</span>
                      <input type="number" step={1} defaultValue={c.rate ?? rate0} className={II} style={{ width: 70 }}
                        onBlur={e => {
                          const v = parseFloat(e.target.value) || rate0
                          if (v !== (c.rate ?? rate0)) quickCrew(c, { rate: v })
                        }} />
                      <span className="text-[#666] text-[11px]">/hr</span>
                    </div>
                  </td>
                  <td className="px-2.5 py-[7px] text-xs text-[#666]">{assignments.filter(a => findCrew(crew, a.crew_name)?.id === c.id).length}</td>
                  <td className="px-2.5 py-[7px] whitespace-nowrap">
                    <button onClick={() => { setCrewForm({ ...c }); setCrewModal(true) }}
                      className="ml-1 px-1.5 py-1 rounded-md bg-white border border-black/20 hover:bg-[#f5f4f0] align-middle"><Edit2 size={12} /></button>
                    <button onClick={() => removeCrew(c)}
                      className="ml-1 px-1.5 py-1 rounded-md bg-white border border-black/20 hover:bg-[#f5f4f0] align-middle text-[#c0392b]"><Trash2 size={12} /></button>
                  </td>
                </tr>
              ))}
              {crew.length === 0 && (
                <tr><td colSpan={6} className="text-center py-5 text-[#666]">No crew members yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Week grid — jobs × days */}
      <Card className="p-3 overflow-x-auto">
        {conflictIds.size > 0 && (
          <div className="bg-[#fee2e2] border border-[#fca5a5] rounded-lg px-3 py-2 mb-2.5 text-xs text-[#991b1b] font-semibold">
            ⚠ Scheduling conflict — one or more crew members are assigned to overlapping shifts on the same day. Tap the cell to fix.
          </div>
        )}
        <div style={{ minWidth: 700 }}>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="px-2.5 py-[7px] text-left border border-black/[0.12] bg-[#fafaf8] text-[11px] sticky left-0 z-[3]" style={{ minWidth: 130 }}>Job</th>
                {days.map((d, i) => {
                  const isToday = localStr(d) === todayStr
                  return (
                    <th key={i} className="text-center px-1 py-[7px] border"
                      style={{
                        minWidth: 95,
                        background: isToday ? '#dbeafe' : '#fafaf8',
                        color: isToday ? '#1e40af' : '#1a1a18',
                        borderColor: isToday ? '#93c5fd' : 'rgba(0,0,0,.12)',
                      }}>
                      <div className="text-[10px] font-semibold tracking-wide" style={{ color: isToday ? '#1e40af' : '#666' }}>{DN[i]}</div>
                      <div className="text-base font-semibold">{d.getDate()}</div>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {weekJobs.map(j => (
                <tr key={j.id}>
                  <td className="px-2.5 py-1.5 border border-black/[0.12] bg-white sticky left-0 z-[2] align-top" style={{ minWidth: 130 }}>
                    <div className="text-[11px] font-bold text-[#2563eb]">{j.id}</div>
                    <div className="text-[11px] font-medium">{j.client}</div>
                    {j.address && <div className="text-[10px] text-[#666] truncate" style={{ maxWidth: 120 }}>{j.address.split(',')[0]}</div>}
                  </td>
                  {weekKeys.map(key => {
                    const isScheduled = (schedOf[j.id] ?? []).includes(key)
                    if (!isScheduled) return <td key={key} className="bg-[#f5f4f0] border border-black/[0.12]" />
                    const asgns = assignments.filter(a => a.job_id === j.id && a.date === key)
                    const hasConflict = asgns.some(a => conflictIds.has(a.id))
                    if (!asgns.length) return (
                      <td key={key} onClick={() => openAssign(j.id, key)}
                        className="cursor-pointer px-1.5 py-1 align-top"
                        style={{ background: '#dbeafe44', border: '1.5px dashed #93c5fd', minWidth: 95 }}>
                        <div className="text-[9px] text-[#1e40af] opacity-70 text-center py-1">+ assign</div>
                      </td>
                    )
                    return (
                      <td key={key} onClick={() => openAssign(j.id, key)}
                        className="cursor-pointer px-1.5 py-1 align-top"
                        style={{
                          background: hasConflict ? '#fff1f2' : '#eaf3de',
                          border: `1.5px solid ${hasConflict ? '#fca5a5' : '#86efac'}`, minWidth: 95,
                        }}>
                        {hasConflict && <div className="text-[8px] text-[#dc2626] font-bold mb-0.5">⚠ Conflict</div>}
                        <div className="flex flex-col gap-px">
                          {asgns.map(a => {
                            const conflict = conflictIds.has(a.id)
                            const s = SLOT[slotOf(a)]
                            return (
                              <div key={a.id}
                                className="flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-lg whitespace-nowrap my-px"
                                style={{ background: conflict ? '#fee2e2' : '#27500a', color: conflict ? '#991b1b' : '#eaf3de' }}>
                                {conflict && <span className="text-[10px]">⚠</span>}
                                {crewLabel(crew, a.crew_name).split(' ')[0]}
                                {s.short && <span className="text-[8px] opacity-80 font-bold ml-0.5">{s.short}</span>}
                              </div>
                            )
                          })}
                        </div>
                      </td>
                    )
                  })}
                </tr>
              ))}
              {weekJobs.length === 0 && (
                <tr><td colSpan={8} className="text-center text-[#666] py-6 text-[13px]">
                  No active jobs scheduled this week.<br />
                  <span className="text-[11px]">Schedule jobs from the Jobs page, or use the Calendar.</span>
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="mt-2 flex gap-3 text-[10px] text-[#666] flex-wrap">
          {(['full', 'morning', 'afternoon'] as SlotKey[]).map(k => (
            <span key={k} className="inline-flex items-center gap-1">
              <span className="rounded px-1.5 py-px font-semibold border"
                style={{ background: SLOT[k].bg, borderColor: SLOT[k].brd, color: SLOT[k].fg }}>
                {SLOT[k].short || 'Full'}
              </span>
              {SLOT[k].label}
            </span>
          ))}
        </div>
      </Card>

      {/* Assignments */}
      <Card className="p-4">
        <div className="flex justify-between items-center mb-2">
          <div className="text-[13px] font-bold">Assignments</div>
          <button onClick={() => nav('/calendar')}
            className="flex items-center gap-1 px-2.5 py-1 text-[11px] bg-white border border-black/20 rounded-lg hover:bg-[#f5f4f0]">
            <CalendarDays size={12} /> Schedule view
          </button>
        </div>
        <div className="overflow-auto max-h-[50vh]">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr>
                {['Crew','Date','Shift','Job','Client','Notes',''].map((h, i) => (
                  <th key={i} className="text-left px-2.5 py-[7px] border-b border-black/[0.12] text-[#666] font-medium whitespace-nowrap bg-[#fafaf8] sticky top-0 z-[2]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...assignments].sort((a, b) => (b.date || '').localeCompare(a.date || '')).map(a => {
                const c = findCrew(crew, a.crew_name)
                const j = jobs.find(x => x.id === a.job_id)
                const conflict = conflictIds.has(a.id)
                const s = SLOT[slotOf(a)]
                return (
                  <tr key={a.id} className="border-b border-black/[0.06]" style={conflict ? { background: '#fff1f2' } : undefined}>
                    <td className="px-2.5 py-[7px]">
                      <div className="font-semibold text-xs">{crewLabel(crew, a.crew_name) || '—'}</div>
                      {c?.phone && <div className="text-[10px] text-[#666]">{c.phone}</div>}
                    </td>
                    <td className="px-2.5 py-[7px] whitespace-nowrap text-xs">{a.date}</td>
                    <td className="px-2.5 py-[7px]">
                      <span className="text-[11px] px-1.5 py-0.5 rounded-lg font-semibold"
                        style={{ background: s.bg, color: s.fg }}>{s.label}</span>
                    </td>
                    <td className="px-2.5 py-[7px] text-[#2563eb] font-semibold text-xs">
                      {a.job_id}{conflict && <span className="text-[10px] text-[#dc2626] ml-1">⚠</span>}
                    </td>
                    <td className="px-2.5 py-[7px] text-xs">{j?.client || '—'}</td>
                    <td className="px-2.5 py-[7px] text-xs text-[#666]">{a.notes || ''}</td>
                    <td className="px-2.5 py-[7px] whitespace-nowrap">
                      <button onClick={() => briefing(a)}
                        title={c?.phone ? 'Send briefing message' : 'Add phone number to crew member to send message'}
                        className="ml-1 px-1.5 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700 align-middle inline-flex items-center gap-1 text-[11px]">
                        <MessageSquare size={11} /> {c?.phone ? 'Send' : 'Msg'}
                      </button>
                      <button onClick={() => { if (confirm('Remove this assignment?')) delAsn.mutate(a.id) }}
                        className="ml-1 px-1.5 py-1 rounded-md bg-white border border-black/20 hover:bg-[#f5f4f0] align-middle text-[#c0392b]"><Trash2 size={12} /></button>
                    </td>
                  </tr>
                )
              })}
              {assignments.length === 0 && (
                <tr><td colSpan={7} className="text-center text-[#666] py-5">No assignments yet. Click a calendar cell to assign.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Crew modal */}
      <Modal open={crewModal} onClose={() => setCrewModal(false)} title={crewForm.id ? 'Edit Crew Member' : 'Add Crew Member'}>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Name" value={crewForm.name || ''} onChange={e => setCrewForm(p => ({ ...p, name: e.target.value }))} wrapperClassName="col-span-2" />
          <Input label="Role" placeholder="Painter, Lead Painter…" value={crewForm.role || ''} onChange={e => setCrewForm(p => ({ ...p, role: e.target.value }))} />
          <Input label="Hourly rate" type="number" value={crewForm.rate ?? rate0} onChange={e => setCrewForm(p => ({ ...p, rate: parseFloat(e.target.value) || rate0 }))} />
          <Input label="Phone (for briefing messages)" type="tel" placeholder="04xx xxx xxx" value={crewForm.phone || ''} onChange={e => setCrewForm(p => ({ ...p, phone: e.target.value }))} />
          <Input label="Charge rate" type="number" value={crewForm.charge_rate ?? ''} onChange={e => setCrewForm(p => ({ ...p, charge_rate: parseFloat(e.target.value) || null }))} />
        </div>
        <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-black/10">
          <button onClick={() => setCrewModal(false)} className="px-4 py-2 text-[13px] rounded-lg bg-[#f5f4f0] text-gray-600 border border-black/10 hover:bg-gray-200">Cancel</button>
          <button onClick={saveCrew} className="px-5 py-2 text-[13px] rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold">Save</button>
        </div>
      </Modal>

      <JobDayPanel
        jobId={panel?.jobId ?? null}
        date={panel?.date ?? null}
        onClose={() => setPanel(null)}
      />
    </div>
  )
}
