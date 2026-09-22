import { useState, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Modal } from '@/components/ui/Modal'
import { genId, findCrew, isWorkDay } from '@/lib/utils'
import { Check, Loader2, MessageSquare } from 'lucide-react'

type Row = Record<string, any>

const SLOTS = [
  { v: 'full',      l: 'Full day',     bg: '#eaf3de', fg: '#166534', brd: '#86efac' },
  { v: 'morning',   l: 'Morning AM',   bg: '#dbeafe', fg: '#1e40af', brd: '#93c5fd' },
  { v: 'afternoon', l: 'Afternoon PM', bg: '#fef3c7', fg: '#92400e', brd: '#fde68a' },
] as const

const localStr = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// V16 _saveJobDayPanel — N working days from the start date
function workingDatesFrom(start: string, days: number): string[] {
  const out: string[] = []
  const d0 = new Date(start + 'T00:00')
  let wd = 0, cal = 0
  while (wd < days && cal < 365) {
    const dt = new Date(d0)
    dt.setDate(dt.getDate() + cal)
    const key = localStr(dt)
    if (isWorkDay(key)) { out.push(key); wd++ }
    cal++
  }
  return out
}

function useTable(table: string) {
  const { user } = useAuth()
  return useQuery({
    queryKey: [table, user?.id],
    queryFn: async () => {
      const { data } = await (supabase.from(table as any) as any).select('*').eq('user_id', user!.id)
      return (data ?? []) as Row[]
    },
    enabled: !!user,
  })
}

export default function JobDayPanel({ jobId, date, onClose }: {
  jobId: string | null
  date: string | null
  onClose: () => void
}) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const { data: crew = [] } = useTable('np_crew')
  const { data: jobs = [] } = useTable('np_jobs')
  const { data: assignments = [] } = useTable('np_assignments')

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [slot, setSlot] = useState<string>('full')
  const [startDate, setStartDate] = useState('')
  const [days, setDays] = useState(1)
  const [notes, setNotes] = useState('')

  const job = jobs.find(j => j.id === jobId)
  const open = !!jobId && !!date

  const assignedOnDay = useMemo(
    () => assignments.filter(a => a.job_id === jobId && a.date === date),
    [assignments, jobId, date],
  )

  // Seed the panel from what is already booked that day
  useEffect(() => {
    if (!open) return
    const ids = new Set<string>()
    assignedOnDay.forEach(a => {
      const c = findCrew(crew, a.crew_name)
      if (c?.id) ids.add(c.id)
    })
    setSelected(ids)
    setSlot(assignedOnDay[0]?.time_slot ?? 'full')
    setStartDate(date!)
    setDays(1)
    setNotes(assignedOnDay[0]?.notes ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, jobId, date, assignments.length, crew.length])

  const save = useMutation({
    mutationFn: async () => {
      const dates = workingDatesFrom(startDate || date!, Math.max(1, days))
      const ticked = [...selected]
      const unticked = crew.map(c => c.id).filter(id => !selected.has(id))

      // Remove unticked crew from every date in range
      const toDelete: string[] = []
      unticked.forEach(crewId => {
        dates.forEach(d => {
          const hit = assignments.find(a =>
            a.job_id === jobId && a.date === d && findCrew(crew, a.crew_name)?.id === crewId)
          if (hit) toDelete.push(hit.id)
        })
      })
      if (toDelete.length) {
        const { error } = await (supabase.from('np_assignments') as any).delete().in('id', toDelete)
        if (error) throw error
      }

      // Add or update ticked crew across the range
      const rows: Row[] = []
      ticked.forEach(crewId => {
        const member = crew.find(c => c.id === crewId)
        if (!member) return
        dates.forEach(d => {
          const existing = assignments.find(a =>
            a.job_id === jobId && a.date === d && findCrew(crew, a.crew_name)?.id === crewId)
          rows.push({
            id: existing?.id ?? genId('a'),
            user_id: user!.id,
            job_id: jobId,
            crew_name: member.name,
            date: d,
            time_slot: slot,
            notes: notes || existing?.notes || null,
            client: job?.client ?? null,
            created_at: existing?.created_at ?? new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
        })
      })
      if (rows.length) {
        const { error } = await (supabase.from('np_assignments') as any).upsert(rows)
        if (error) throw error
      }

      // V16 syncs the job's scheduled dates from its assignments
      if (job) {
        const existingDates = Array.isArray(job.scheduled_dates) ? job.scheduled_dates as string[] : []
        const assignDates = assignments.filter(a => a.job_id === jobId).map(a => a.date)
        const all = [...new Set([...existingDates, ...assignDates, ...(rows.length ? dates : [])])].filter(Boolean).sort()
        if (all.length) {
          const { error } = await (supabase.from('np_jobs') as any).update({
            scheduled_dates: all,
            sched_start: all[0],
            est_days: all.length,
            updated_at: new Date().toISOString(),
          }).eq('id', jobId).eq('user_id', user!.id)
          if (error) throw error
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['np_assignments'] })
      qc.invalidateQueries({ queryKey: ['np_jobs'] })
      onClose()
    },
    onError: (e: any) => alert('Save failed: ' + e.message),
  })

  async function briefing(crewId: string) {
    const member = crew.find(c => c.id === crewId)
    const a = assignedOnDay.find(x => findCrew(crew, x.crew_name)?.id === crewId)
    const slotLabel = SLOTS.find(s => s.v === (a?.time_slot ?? slot))?.l ?? 'Full day'
    const msg = `Hi ${(member?.name ?? '').split(' ')[0]},\n\nYou're booked for ${slotLabel.toLowerCase()} on ${date}.\n\nJob: ${jobId}${job?.client ? ` — ${job.client}` : ''}\nSite: ${job?.address || 'TBC'}\n${job?.job_desc ? `Scope: ${job.job_desc}\n` : ''}${a?.notes ? `Notes: ${a.notes}\n` : ''}\nSee you there.\n\nNorthern Painters`
    try {
      await navigator.clipboard.writeText(msg)
      alert(member?.phone ? `Briefing copied — send to ${member.phone}` : 'Briefing message copied!')
    } catch { prompt('Copy this message:', msg) }
  }

  if (!open) return null

  const prettyDate = new Date(date! + 'T00:00').toLocaleDateString('en-AU', {
    weekday: 'short', day: 'numeric', month: 'short',
  })

  return (
    <Modal open onClose={onClose} title={`Crew — ${prettyDate}`}>
      <div className="bg-[#f0fdf4] border border-[#86efac] rounded-lg px-3.5 py-2.5 mb-3.5 text-xs">
        <strong>{job?.id}</strong> — {job?.client}<br />
        <span className="text-[#666]">{job?.address || ''}{job?.type ? ` · ${job.type}` : ''}</span>
      </div>

      <label className="block text-xs font-medium text-gray-500 mb-1.5">
        Tap to assign · tap again to remove · Msg copies a briefing message
      </label>

      {crew.length === 0 ? (
        <div className="text-xs text-[#666] py-2">No crew members yet. Add crew in Crew &amp; Calendar first.</div>
      ) : (
        <div className="flex flex-col gap-1.5 mb-3">
          {crew.map(c => {
            const on = selected.has(c.id)
            const wasAssigned = assignedOnDay.some(a => findCrew(crew, a.crew_name)?.id === c.id)
            return (
              <div key={c.id}
                onClick={() => setSelected(s => {
                  const n = new Set(s)
                  n.has(c.id) ? n.delete(c.id) : n.add(c.id)
                  return n
                })}
                className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg cursor-pointer select-none transition-all"
                style={{
                  border: `2px solid ${on ? '#16a34a' : 'rgba(0,0,0,.12)'}`,
                  background: on ? '#f0fdf4' : undefined,
                }}>
                <div className="w-5 h-5 rounded-full shrink-0 flex items-center justify-center text-white"
                  style={{ border: `2px solid ${on ? '#16a34a' : '#ccc'}`, background: on ? '#16a34a' : undefined }}>
                  {on && <Check size={12} />}
                </div>
                <span className="flex-1 text-[13px]">
                  <strong>{c.name}</strong> <span className="text-[#666] text-[11px]">— {c.role || 'Painter'}</span>
                </span>
                {wasAssigned && (
                  <button onClick={e => { e.stopPropagation(); briefing(c.id) }}
                    className="flex items-center gap-1 px-2 py-1 text-[11px] bg-white border border-black/20 rounded-md hover:bg-[#f5f4f0] shrink-0">
                    <MessageSquare size={11} /> Msg
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div className="flex gap-2.5 mb-2.5">
        <div className="flex-1">
          <label className="block text-xs font-medium text-gray-500 mb-1">Apply from date</label>
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
            className="w-full px-2.5 py-2 text-[13px] bg-white border border-black/20 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500" />
        </div>
        <div className="flex-1">
          <label className="block text-xs font-medium text-gray-500 mb-1">Days on site</label>
          <input type="number" min={1} value={days} onChange={e => setDays(Math.max(1, parseInt(e.target.value) || 1))}
            className="w-full px-2.5 py-2 text-[13px] bg-white border border-black/20 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500" />
        </div>
      </div>
      {days > 1 && (
        <div className="text-[11px] text-[#666] mb-2.5">
          Applies to {workingDatesFrom(startDate || date!, days).length} working days
          {' '}({workingDatesFrom(startDate || date!, days).slice(0, 4).join(', ')}
          {days > 4 ? '…' : ''}) — weekends are skipped.
        </div>
      )}

      <div className="mb-2.5">
        <label className="block text-xs font-medium text-gray-500 mb-1">Shift / Time slot</label>
        <div className="flex gap-1.5">
          {SLOTS.map(s => (
            <button key={s.v} onClick={() => setSlot(s.v)}
              className="flex-1 px-2 py-1.5 text-xs rounded-lg border font-semibold"
              style={slot === s.v
                ? { background: '#2563eb', color: '#fff', borderColor: '#2563eb' }
                : { background: s.bg, color: s.fg, borderColor: s.brd }}>
              {s.l}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-1">
        <label className="block text-xs font-medium text-gray-500 mb-1">Notes</label>
        <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. bring extension ladders…"
          className="w-full px-2.5 py-2 text-[13px] bg-white border border-black/20 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500" />
      </div>

      <div className="flex gap-2 mt-4 pt-4 border-t border-black/10">
        <button onClick={() => save.mutate()} disabled={save.isPending || !crew.length}
          className="flex-1 flex items-center justify-center gap-1.5 px-5 py-2 text-[13px] rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold disabled:opacity-50">
          {save.isPending ? <Loader2 size={13} className="animate-spin" /> : <Check size={14} />} Save Changes
        </button>
        <button onClick={onClose}
          className="px-4 py-2 text-[13px] rounded-lg bg-[#f5f4f0] text-gray-600 border border-black/10 hover:bg-gray-200">Cancel</button>
      </div>
    </Modal>
  )
}
