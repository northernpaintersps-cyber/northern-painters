import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, selectAll } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { fmtCurrency, getJobScheduledDates, normaliseDate, crewLabel } from '@/lib/utils'
import { Loader2, CalendarPlus, CalendarDays, Info } from 'lucide-react'
import { invalidateTable } from '../lib/queryKeys'

type Row = Record<string, any>

const JS_OPTS = ['Not Started', 'Scheduled', 'In Progress', 'Hourly Rate Accepted', 'Finished', 'Closed']
const II = 'border-none bg-transparent text-[12.5px] w-full focus:outline-none focus:bg-blue-50/60 rounded px-0.5'
const IS = 'border-none bg-transparent text-xs cursor-pointer focus:outline-none'

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

// V16 qe() — inline edit, recomputing scheduled dates when start/days change
function useQuickEdit() {
  const qc = useQueryClient()
  const { user } = useAuth()
  return useMutation({
    mutationFn: async ({ job, field, value }: { job: Row; field: string; value: any }) => {
      const patch: Row = { [field]: value, updated_at: new Date().toISOString() }
      if (field === 'sched_start' || field === 'est_days') {
        patch.scheduled_dates = getJobScheduledDates({ ...job, ...patch })
      }
      const { error } = await (supabase.from('np_jobs') as any)
        .update(patch).eq('id', job.id).eq('user_id', user!.id)
      if (error) throw error
    },
    onSuccess: () => invalidateTable(qc, 'np_jobs'),
  })
}

export default function Schedule() {
  const nav = useNavigate()
  const { data: jobs = [], isLoading } = useTable('np_jobs')
  const { data: assignments = [] } = useTable('np_assignments')
  const { data: crew = [] } = useTable('np_crew')
  const quickEdit = useQuickEdit()

  const rows = useMemo(() => jobs
    .filter(j => j.sched_start || ['Scheduled', 'In Progress', 'Not Started'].includes(j.status))
    .sort((a, b) => (normaliseDate(a.sched_start) || 'zz').localeCompare(normaliseDate(b.sched_start) || 'zz')),
    [jobs])

  const crewFor = (jobId: string) =>
    [...new Set(assignments.filter(a => a.job_id === jobId).map(a => crewLabel(crew, a.crew_name)).filter(Boolean))]

  if (isLoading) return (
    <div className="flex items-center justify-center h-64"><Loader2 size={20} className="animate-spin text-blue-600" /></div>
  )

  return (
    <div className="p-5">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
        <h2 className="text-[17px] font-semibold text-gray-900">Schedule</h2>
        <button onClick={() => nav('/crew')}
          className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white font-medium text-[13px] px-3 py-1.5 rounded-lg">
          <CalendarDays size={14} /> Crew Calendar
        </button>
      </div>
      <div className="text-[11px] text-[#666] mb-2 flex items-center gap-1">
        <Info size={12} /> Edit status and dates inline. Schedule a job to crew to see it on the crew calendar.
      </div>

      <div className="bg-white border border-black/[0.12] rounded-xl overflow-hidden">
        <div className="overflow-auto max-h-[75vh]">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr>
                {['Job ID','Client','Description','Status','Start date','Days','Crew assigned','Value',''].map((h, i) => (
                  <th key={i} className="text-left px-2.5 py-[7px] border-b border-black/[0.12] text-[#666] font-medium whitespace-nowrap bg-[#fafaf8] sticky top-0 z-[2]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(j => {
                const crewNames = crewFor(j.id)
                return (
                  <tr key={j.id} className="border-b border-black/[0.06] hover:bg-[#fafaf8]">
                    <td className="px-2.5 py-[7px] text-[#2563eb] font-medium">{j.id}</td>
                    <td className="px-2.5 py-[7px]">
                      <input defaultValue={j.client ?? ''} className={II}
                        onBlur={e => { if (e.target.value !== (j.client ?? '')) quickEdit.mutate({ job: j, field: 'client', value: e.target.value }) }} />
                    </td>
                    <td className="px-2.5 py-[7px]">
                      <input defaultValue={j.job_desc ?? ''} className={II} style={{ maxWidth: 160 }}
                        onBlur={e => { if (e.target.value !== (j.job_desc ?? '')) quickEdit.mutate({ job: j, field: 'job_desc', value: e.target.value }) }} />
                    </td>
                    <td className="px-2.5 py-[7px]">
                      <select value={j.status ?? ''} className={IS}
                        onChange={e => quickEdit.mutate({ job: j, field: 'status', value: e.target.value })}>
                        <option value=""></option>
                        {JS_OPTS.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td className="px-2.5 py-[7px]">
                      <input type="date" defaultValue={normaliseDate(j.sched_start) ?? ''} className={II} style={{ width: 118 }}
                        onBlur={e => { if (e.target.value !== (normaliseDate(j.sched_start) ?? '')) quickEdit.mutate({ job: j, field: 'sched_start', value: e.target.value || null }) }} />
                    </td>
                    <td className="px-2.5 py-[7px]">
                      <input type="number" defaultValue={j.est_days ?? ''} placeholder="—" className={II} style={{ width: 45 }}
                        onBlur={e => {
                          const v = e.target.value === '' ? null : parseFloat(e.target.value)
                          if (v !== (j.est_days ?? null)) quickEdit.mutate({ job: j, field: 'est_days', value: v })
                        }} />
                    </td>
                    <td className="px-2.5 py-[7px] text-xs">
                      {crewNames.length ? crewNames.map(n => (
                        <span key={String(n)} className="inline-block bg-[#dbeafe] text-[#2563eb] rounded px-1.5 py-px m-px text-[11px] font-semibold">{n}</span>
                      )) : <span className="text-[#666] text-[11px]">—</span>}
                    </td>
                    <td className="px-2.5 py-[7px]">{fmtCurrency(j.agreed_ex_gst || j.quote_ex_gst)}</td>
                    <td className="px-2.5 py-[7px]">
                      <button onClick={() => nav('/crew')} title="Schedule to crew"
                        className="flex items-center gap-1 px-2 py-1 text-[11px] bg-white border border-black/20 rounded-md hover:bg-[#f5f4f0] whitespace-nowrap">
                        <CalendarPlus size={12} /> Schedule
                      </button>
                    </td>
                  </tr>
                )
              })}
              {rows.length === 0 && (
                <tr><td colSpan={9} className="text-center text-[#666] py-6">
                  No scheduled jobs. Add a start date to a job or set its status to Scheduled.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
