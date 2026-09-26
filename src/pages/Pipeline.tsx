import { useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, selectAll } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { fmtCurrency } from '@/lib/utils'
import { Loader2, List } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { invalidateTable } from '../lib/queryKeys'

const QS_OPTS = ['','Info Collected','Site Visit','Quote Created','Sent','Negotiating','Accepted','Booked','Not Accepted','Lost']
const JS_OPTS  = ['','Not Started','Scheduled','In Progress','Hourly Rate Accepted','Finished','Closed']

const COLS = [
  { id:'enquiry',   label:'Enquiry',          color:'#8b5cf6', bg:'#f5f3ff', border:'#ddd6fe', filterQS:'Info Collected' },
  { id:'sitevisit', label:'Site Visit',        color:'#7c3aed', bg:'#f5f3ff', border:'#c4b5fd', filterQS:'Site Visit' },
  { id:'quoted',    label:'Quote Created',     color:'#d97706', bg:'#fffbeb', border:'#fde68a', filterQS:'Quote Created' },
  { id:'sent',      label:'Sent',              color:'#2563eb', bg:'#eff6ff', border:'#bfdbfe', filterQS:'Sent' },
  { id:'negot',     label:'Negotiating',       color:'#ea580c', bg:'#fff7ed', border:'#fed7aa', filterQS:'Negotiating' },
  { id:'accepted',  label:'Accepted / Booked', color:'#16a34a', bg:'#f0fdf4', border:'#86efac', filterQS:['Accepted','Booked'], filterJS:['Not Started','',''] },
  { id:'hourly',    label:'Hourly Rate',        color:'#0891b2', bg:'#ecfeff', border:'#a5f3fc', filterJS:'Hourly Rate Accepted' },
  { id:'scheduled', label:'Scheduled',         color:'#1d4ed8', bg:'#eff6ff', border:'#93c5fd', filterJS:'Scheduled' },
  { id:'inprog',    label:'In Progress',       color:'#0369a1', bg:'#f0f9ff', border:'#7dd3fc', filterJS:'In Progress' },
  { id:'finished',  label:'Finished',          color:'#15803d', bg:'#f0fdf4', border:'#4ade80', filterJS:'Finished' },
  { id:'closed',    label:'Closed',            color:'#374151', bg:'#f9fafb', border:'#d1d5db', filterJS:'Closed' },
  { id:'lost',      label:'Not Accepted / Lost',color:'#dc2626', bg:'#fef2f2', border:'#fca5a5', filterQS:['Not Accepted','Lost'] },
]

function matchesCol(col: typeof COLS[0], j: any) {
  const qs = j.quote_status || ''
  const js = j.status || ''
  if (col.id === 'accepted') {
    return ['Accepted','Booked'].includes(qs) && (!js || js === 'Not Started')
  }
  if (col.filterJS) {
    return Array.isArray(col.filterJS) ? col.filterJS.includes(js) : js === col.filterJS
  }
  if (col.filterQS) {
    return Array.isArray(col.filterQS) ? col.filterQS.includes(qs) : qs === col.filterQS
  }
  return false
}

function useJobs() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['np_jobs', user?.id],
    queryFn: async () => {
      const { data } = await selectAll('np_jobs', user!.id, { orderBy: 'created_at' })
      return (data ?? []) as any[]
    },
    enabled: !!user,
  })
}

function useUpdateJob() {
  const qc = useQueryClient()
  const { user } = useAuth()
  return useMutation({
    mutationFn: async ({ id, field, value }: { id: string; field: string; value: string }) => {
      const db = supabase as any
      const { error } = await db.from('np_jobs').update({ [field]: value, updated_at: new Date().toISOString() }).eq('id', id).eq('user_id', user!.id)
      if (error) throw error
    },
    onSuccess: () => invalidateTable(qc, 'np_jobs'),
  })
}

export default function Pipeline() {
  const { data: jobs = [], isLoading } = useJobs()
  const updateJob = useUpdateJob()
  const navigate = useNavigate()

  const colsWithJobs = useMemo(() => {
    const placed = new Set<string>()
    const result = COLS.map(col => {
      const colJobs = jobs.filter(j => {
        const m = matchesCol(col, j)
        if (m) placed.add(j.id)
        return m
      })
      return { ...col, jobs: colJobs }
    })
    const unplaced = jobs.filter(j => !placed.has(j.id))
    return { cols: result, unplaced }
  }, [jobs])

  if (isLoading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 size={20} className="animate-spin text-blue-600" />
    </div>
  )

  return (
    <div className="p-5">
      <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
        <div>
          <h2 className="text-[17px] font-semibold text-gray-900">Pipeline</h2>
          <div className="text-[11px] text-gray-500 mt-0.5">{jobs.length} total jobs · Change status inline via the dropdowns on each card</div>
        </div>
        <button onClick={() => navigate('/jobs')} className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] bg-white border border-black/20 rounded-lg text-gray-700 hover:bg-[#f5f4f0] transition-colors">
          <List size={14} /> All Jobs
        </button>
      </div>

      {colsWithJobs.unplaced.length > 0 && (
        <div className="mb-3 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg text-[12px] text-amber-800">
          ⚠️ {colsWithJobs.unplaced.length} job{colsWithJobs.unplaced.length > 1 ? 's have' : ' has'} an unrecognised status: {colsWithJobs.unplaced.map(j => j.id).join(', ')}. Open each job and set its statuses.
        </div>
      )}

      <div className="flex gap-2.5 overflow-x-auto pb-3 items-start">
        {colsWithJobs.cols.map(col => {
          const total = col.jobs.length
          const isAlwaysVisible = ['enquiry','sitevisit','quoted','sent','negot','accepted','scheduled','inprog'].includes(col.id)
          if (total === 0 && !isAlwaysVisible) return null
          return (
            <div key={col.id} className="flex-shrink-0 w-[200px]">
              {/* Column header */}
              <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg mb-2"
                style={{ background: col.bg, border: `1px solid ${col.border}` }}>
                <span className="text-[11px] font-bold" style={{ color: col.color }}>{col.label}</span>
                {total > 0 && (
                  <span className="text-[11px] font-bold text-white rounded-full px-2 py-0.5 leading-none" style={{ background: col.color }}>{total}</span>
                )}
              </div>
              {/* Cards */}
              <div className="space-y-1.5">
                {col.jobs.map(j => (
                  <div key={j.id} className="bg-white border border-black/10 rounded-lg p-2.5 cursor-pointer hover:shadow-sm transition-shadow"
                    onClick={() => navigate('/jobs')}>
                    <div className="flex justify-between items-start gap-1 mb-1">
                      <span className="text-[10px] text-gray-500 font-mono font-semibold">{j.id}</span>
                      {(j.agreed_ex_gst || j.quote_ex_gst) && (
                        <span className="text-[11px] font-bold text-green-700 whitespace-nowrap">
                          {fmtCurrency(j.agreed_ex_gst || j.quote_ex_gst)}
                        </span>
                      )}
                    </div>
                    <div className="text-[13px] font-bold mb-0.5 leading-tight">{j.client || '—'}</div>
                    {j.address && (
                      <div className="text-[11px] text-gray-500 mb-1 truncate">📍 {j.address.split(',')[0]}</div>
                    )}
                    {j.sched_start && (
                      <div className="text-[10px] text-blue-700 mb-1">📅 {j.sched_start}{j.est_days ? ` · ${j.est_days}d` : ''}</div>
                    )}
                    {/* Inline status selects */}
                    <div className="flex gap-1 flex-wrap mt-1.5" onClick={e => e.stopPropagation()}>
                      <select
                        value={j.quote_status || ''}
                        onChange={e => updateJob.mutate({ id: j.id, field: 'quote_status', value: e.target.value })}
                        className="text-[10px] px-1 py-0.5 border border-black/15 rounded bg-[#f5f4f0] text-gray-600 max-w-[110px]">
                        {QS_OPTS.map(s => <option key={s} value={s}>{s || '— quote status'}</option>)}
                      </select>
                      <select
                        value={j.status || ''}
                        onChange={e => updateJob.mutate({ id: j.id, field: 'status', value: e.target.value })}
                        className="text-[10px] px-1 py-0.5 border border-black/15 rounded bg-[#f5f4f0] text-gray-600 max-w-[100px]">
                        {JS_OPTS.map(s => <option key={s} value={s}>{s || '— job status'}</option>)}
                      </select>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
