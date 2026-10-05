import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, selectAll } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Modal } from '@/components/ui/Modal'
import JobDayPanel from '@/components/JobDayPanel'
import JobPicker from '@/components/JobPicker'
import { Input, Select, TextArea } from '@/components/ui/Field'
import { fmtDate, genId, today, addDays, getJobScheduledDates, localDate, parseLocal } from '@/lib/utils'
import { ChevronLeft, ChevronRight, Plus, Loader2, Trash2, X } from 'lucide-react'
import { invalidateTable } from '@/lib/queryKeys'

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
const EVENT_TYPES = ['Quote Visit','Client Meeting','Builder Meeting','Follow Up','Site Visit','Other']
const EVENT_COLORS: Record<string, string> = {
  'Quote Visit':     'bg-blue-100 text-blue-800 border-l-2 border-blue-500',
  'Client Meeting':  'bg-green-100 text-green-800 border-l-2 border-green-500',
  'Builder Meeting': 'bg-purple-100 text-purple-800 border-l-2 border-purple-500',
  'Follow Up':       'bg-amber-100 text-amber-800 border-l-2 border-amber-500',
  'Site Visit':      'bg-teal-100 text-teal-800 border-l-2 border-teal-500',
  'Other':           'bg-gray-100 text-gray-600 border-l-2 border-gray-400',
}
const JOB_SCHEDULED_COLOR = 'bg-blue-100 text-blue-900 border-l-2 border-blue-500 font-medium'
const JOB_ACTIVE_COLOR    = 'bg-green-100 text-green-900 border-l-2 border-green-500 font-medium'

function useCalendarEvents() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['np_calendar_events', user?.id],
    queryFn: async () => {
      const { data, error } = await selectAll('np_calendar_events', user!.id)
      if (error) throw error
      return (data ?? []) as any[]
    },
    enabled: !!user,
  })
}

function useJobs() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['np_jobs', user?.id],
    queryFn: async () => {
      const { data } = await supabase.from('np_jobs').select('id,client,address,status,sched_start,est_days,scheduled_dates,type').eq('user_id', user!.id)
      return (data ?? []) as any[]
    },
    enabled: !!user,
  })
}

function useUpsertEvent() {
  const qc = useQueryClient()
  const { user } = useAuth()
  return useMutation({
    mutationFn: async (ev: any) => {
      const { error } = await supabase.from('np_calendar_events').upsert({ ...ev, user_id: user!.id, updated_at: new Date().toISOString() } as any)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['np_calendar_events'] }),
  })
}

function useDeleteEvent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('np_calendar_events').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['np_calendar_events'] }),
  })
}

/**
 * Set the days a job is on site.
 *
 * scheduled_dates is the stored list getJobScheduledDates prefers, so writing
 * it is what makes a hand-picked set of days stick. sched_start and est_days
 * are kept in step so the Jobs page agrees with the calendar — and cleared
 * outright when the last day goes, because an empty list falls back to
 * deriving from start + days, which would bring the day straight back.
 */
function useSetJobDates() {
  const qc = useQueryClient()
  const { user } = useAuth()
  return useMutation({
    mutationFn: async ({ jobId, dates }: { jobId: string; dates: string[] }) => {
      const sorted = [...new Set(dates)].filter(Boolean).sort()
      const { error } = await (supabase.from('np_jobs') as any).update({
        scheduled_dates: sorted,
        sched_start: sorted[0] ?? null,
        est_days: sorted.length || null,
        updated_at: new Date().toISOString(),
      }).eq('id', jobId).eq('user_id', user!.id)
      if (error) throw error
    },
    onSuccess: () => invalidateTable(qc, 'np_jobs'),
  })
}

export default function CalendarPage() {
  const { data: events = [] } = useCalendarEvents()
  const { data: jobs = [], isLoading } = useJobs()
  const upsertEvent = useUpsertEvent()
  const deleteEvent = useDeleteEvent()
  const setJobDates = useSetJobDates()

  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())
  const [modalOpen, setModalOpen] = useState(false)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [selectedEvent, setSelectedEvent] = useState<any | null>(null)
  const [form, setForm] = useState<any>({})
  const [saving, setSaving] = useState(false)
  const [panel, setPanel] = useState<{ jobId: string; date: string } | null>(null)
  const [addJobId, setAddJobId] = useState('')

  const todayStr = today()

  // ── Calendar grid ────────────────────────────────────────────
  const { cells } = useMemo(() => {
    const firstDay = new Date(year, month, 1).getDay()
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const daysInPrev = new Date(year, month, 0).getDate()
    const cells: Array<{ date: string; isCurrentMonth: boolean }> = []
    for (let i = firstDay - 1; i >= 0; i--) {
      const d = new Date(year, month - 1, daysInPrev - i)
      cells.push({ date: localDate(d), isCurrentMonth: false })
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const dt = new Date(year, month, d)
      cells.push({ date: localDate(dt), isCurrentMonth: true })
    }
    const remaining = 42 - cells.length
    for (let d = 1; d <= remaining; d++) {
      const dt = new Date(year, month + 1, d)
      cells.push({ date: localDate(dt), isCurrentMonth: false })
    }
    return { cells }
  }, [year, month])

  // ── Items per day ────────────────────────────────────────────
  const CONFIRMED_STATUSES = ['Not Started','Scheduled','In Progress','Hourly Rate Accepted','Booked']
  const itemsByDate = useMemo(() => {
    const map: Record<string, Array<{ type: 'job' | 'event'; label: string; color: string; id: string; data: any }>> = {}
    const add = (date: string, item: any) => {
      if (!map[date]) map[date] = []
      map[date].push(item)
    }
    // Job scheduled dates
    jobs.filter(j => CONFIRMED_STATUSES.includes(j.status)).forEach(j => {
      const dates = getJobScheduledDates(j)
      dates.forEach((d, i) => {
        const isFirst = i === 0, isLast = i === dates.length - 1
        const color = j.status === 'In Progress' ? JOB_ACTIVE_COLOR : JOB_SCHEDULED_COLOR
        const prefix = isFirst ? '▶ ' : isLast ? '⏹ ' : ''
        add(d, { type: 'job', label: `${prefix}${j.id} ${j.client || ''}`, color, id: j.id, data: j })
      })
    })
    // Calendar events
    events.forEach(ev => {
      add(ev.date, { type: 'event', label: ev.title || ev.color || 'Event', color: EVENT_COLORS[ev.color || 'Other'] || EVENT_COLORS['Other'], id: ev.id, data: ev })
    })
    return map
  }, [jobs, events])

  // ── Navigation ────────────────────────────────────────────────
  function prev() { if (month === 0) { setMonth(11); setYear(y => y - 1) } else setMonth(m => m - 1) }
  function next() { if (month === 11) { setMonth(0); setYear(y => y + 1) } else setMonth(m => m + 1) }
  function goToday() { setYear(now.getFullYear()); setMonth(now.getMonth()) }

  // ── Modal ─────────────────────────────────────────────────────
  function addJobDay(jobId: string, date: string) {
    const job = jobs.find(j => j.id === jobId)
    if (!job) return
    const dates = getJobScheduledDates(job)
    if (dates.includes(date)) return
    setJobDates.mutate({ jobId, dates: [...dates, date] })
  }

  function removeJobDay(jobId: string, date: string) {
    const job = jobs.find(j => j.id === jobId)
    if (!job) return
    const dates = getJobScheduledDates(job).filter(d => d !== date)
    const label = `${job.id}${job.client ? ` — ${job.client}` : ''}`
    const ask = dates.length
      ? `Take ${label} off ${fmtDate(date)}?`
      : `${fmtDate(date)} is the only day ${label} is scheduled. Remove it and leave the job unscheduled?`
    if (!confirm(ask)) return
    setJobDates.mutate({ jobId, dates })
  }

  function openCell(date: string) {
    setAddJobId('')
    setSelectedDate(date)
    setSelectedEvent(null)
    setForm({ date, color: 'Other' })
    setModalOpen(true)
  }

  function openEvent(ev: any, e: React.MouseEvent) {
    e.stopPropagation()
    setSelectedEvent(ev)
    setForm({ ...ev })
    setSelectedDate(ev.date)
    setModalOpen(true)
  }

  const ef = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((prev: any) => ({ ...prev, [k]: e.target.value }))

  async function saveEvent() {
    setSaving(true)
    try {
      await upsertEvent.mutateAsync({ ...form, id: selectedEvent?.id || genId('ev'), created_at: form.created_at || new Date().toISOString() })
      setModalOpen(false)
    } finally { setSaving(false) }
  }

  async function handleDeleteEvent() {
    if (!selectedEvent?.id || !confirm('Delete this event?')) return
    await deleteEvent.mutateAsync(selectedEvent.id)
    setModalOpen(false)
  }

  return (
    <div className="min-h-full flex flex-col p-3 sm:p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 shrink-0">
        <h1 className="text-lg font-bold text-gray-900">Calendar</h1>
        <div className="flex items-center gap-2">
          <button onClick={goToday} className="text-xs px-3 py-1.5 rounded-lg bg-gray-50 text-gray-600 hover:text-gray-900 transition-colors">Today</button>
          <button onClick={prev} className="p-1.5 rounded-lg bg-gray-50 text-gray-500 hover:text-gray-900 transition-colors"><ChevronLeft size={16} /></button>
          <span className="text-sm font-semibold text-gray-900 w-36 text-center">{MONTHS[month]} {year}</span>
          <button onClick={next} className="p-1.5 rounded-lg bg-gray-50 text-gray-500 hover:text-gray-900 transition-colors"><ChevronRight size={16} /></button>
          <button onClick={() => { setForm({ date: todayStr, color: 'Other' }); setSelectedEvent(null); setSelectedDate(todayStr); setModalOpen(true) }}
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-gray-900 font-semibold text-sm px-3 py-1.5 rounded-lg transition-colors ml-2">
            <Plus size={14} /> Add event
          </button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex gap-3 mb-3 flex-wrap shrink-0">
        <div className="flex items-center gap-1.5 text-xs text-gray-500"><div className="w-3 h-3 rounded-sm bg-blue-600/50 border-l-2 border-blue-500" />Scheduled job</div>
        <div className="flex items-center gap-1.5 text-xs text-gray-500"><div className="w-3 h-3 rounded-sm bg-green-600/50 border-l-2 border-green-500" />Active job</div>
        {Object.entries(EVENT_COLORS).slice(0, 3).map(([k, v]) => (
          <div key={k} className="flex items-center gap-1.5 text-xs text-gray-500">
            <div className={`w-3 h-3 rounded-sm ${v.split(' ')[0]}`} />{k}
          </div>
        ))}
      </div>

      {/* Grid header */}
      <div className="grid grid-cols-7 gap-1 mb-1 shrink-0">
        {DAYS.map(d => (
          <div key={d} className="text-center text-xs font-semibold text-gray-500 py-1">{d}</div>
        ))}
      </div>

      {/* Grid */}
      {isLoading
        ? <div className="flex-1 flex items-center justify-center"><Loader2 size={20} className="animate-spin text-blue-600" /></div>
        : (
          <div className="grid grid-cols-7 gap-1 auto-rows-[minmax(88px,auto)]">
            {cells.map(({ date, isCurrentMonth }) => {
              const items = itemsByDate[date] || []
              const isToday = date === todayStr
              return (
                <div key={date} onClick={() => openCell(date)}
                  className={`rounded-lg p-1.5 cursor-pointer flex flex-col transition-colors
                    ${isCurrentMonth ? 'bg-white hover:bg-gray-50' : 'bg-white/40 opacity-50 hover:opacity-70'}
                    ${isToday ? 'ring-2 ring-blue-500' : 'border border-gray-200'}`}>
                  <div className={`text-xs font-medium mb-1 ${isToday ? 'text-blue-600' : isCurrentMonth ? 'text-gray-600' : 'text-gray-600'}`}>
                    {parseLocal(date).getDate()}
                  </div>
                  {/* Every item shows: a day with a job and two quote visits was
                      being cut off at three with no way to reach the rest. The
                      row grows to fit, and only a truly packed day scrolls. */}
                  <div className="space-y-0.5 max-h-44 overflow-y-auto">
                    {items.map((item, i) => (
                      <div key={i}
                        className={`group flex items-center gap-1 text-[10px] px-1 py-0.5 rounded leading-tight ${item.color}`}>
                        <span className="flex-1 truncate cursor-pointer"
                          onClick={item.type === 'event'
                            ? (e) => openEvent(item.data, e)
                            : (e) => { e.stopPropagation(); setPanel({ jobId: item.data.id, date }) }}
                          title={item.type === 'event' ? undefined : 'Assign crew for this day'}>
                          {item.label}
                        </span>
                        {item.type === 'job' && (
                          <button
                            onClick={(e) => { e.stopPropagation(); removeJobDay(item.data.id, date) }}
                            title="Take this job off this day"
                            className="shrink-0 opacity-0 group-hover:opacity-70 hover:!opacity-100 focus:opacity-100">
                            <X size={10} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )
      }

      {/* Event modal */}
      <JobDayPanel
        jobId={panel?.jobId ?? null}
        date={panel?.date ?? null}
        onClose={() => setPanel(null)}
      />

      <Modal open={modalOpen} onClose={() => setModalOpen(false)}
        title={selectedEvent ? 'Edit event' : `Add event — ${fmtDate(selectedDate || '')}`}>
        <div className="space-y-3">
          <Input label="Title" value={form.title || ''} onChange={ef('title')} placeholder="e.g. Quote visit — Smith" />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Date" type="date" value={form.date || ''} onChange={ef('date')} />
            <Input label="Time" type="time" value={form.time || ''} onChange={ef('time')} />
          </div>
          <Select label="Event type / colour" value={form.color || ''} onChange={ef('color')} options={EVENT_TYPES} placeholder="—" />
          <Input label="End date (optional)" type="date" value={form.end_date || ''} onChange={ef('end_date')} />
          <TextArea label="Notes" value={form.notes || ''} onChange={ef('notes')} />
        </div>

        {/* Scheduling a job on this day is a different thing from booking an
            event on it, so it sits below the event fields rather than among
            them. Only when adding, not when editing an existing event. */}
        {!selectedEvent && selectedDate && (
          <div className="mt-4 pt-4 border-t border-gray-200">
            <div className="text-[13px] font-bold mb-2">Jobs on this day</div>
            {(itemsByDate[selectedDate] ?? []).filter(i => i.type === 'job').length === 0 ? (
              <div className="text-[11px] text-[#666] mb-2">None scheduled.</div>
            ) : (
              <div className="flex flex-col gap-1 mb-2">
                {(itemsByDate[selectedDate] ?? []).filter(i => i.type === 'job').map(i => (
                  <div key={i.id} className="flex items-center gap-2 bg-[#f5f4f0] rounded-lg px-2.5 py-1.5">
                    <span className="flex-1 text-[12px] truncate">
                      {i.data.id} — {i.data.client || ''}
                    </span>
                    <button onClick={() => removeJobDay(i.data.id, selectedDate)}
                      className="text-[#c0392b] text-[11px] hover:underline">Remove</button>
                  </div>
                ))}
              </div>
            )}
            <JobPicker
              jobs={jobs.filter(j => !getJobScheduledDates(j).includes(selectedDate))}
              value={addJobId}
              label="Add a job to this day"
              allowNone={false}
              onChange={id => { if (id) { addJobDay(id, selectedDate); setAddJobId('') } }}
            />
          </div>
        )}
        <div className="flex justify-between mt-5 pt-4 border-t border-gray-200">
          <div>{selectedEvent && <button onClick={handleDeleteEvent} className="flex items-center gap-1.5 text-sm text-red-400 hover:text-red-300"><Trash2 size={14} /> Delete</button>}</div>
          <div className="flex gap-2">
            <button onClick={() => setModalOpen(false)} className="text-sm px-4 py-2 rounded-lg bg-gray-50 text-gray-500 hover:text-gray-900">Cancel</button>
            <button onClick={saveEvent} disabled={saving} className="flex items-center gap-1.5 text-sm px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-gray-900 font-semibold disabled:opacity-50">
              {saving && <Loader2 size={13} className="animate-spin" />} Save
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
