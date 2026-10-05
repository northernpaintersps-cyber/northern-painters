import { useState, useMemo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, selectAll } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Badge } from '@/components/ui/Badge'
import JobModal, { useDeleteJob, JOB_STATUSES, QUOTE_STATUSES } from '@/components/JobModal'
import JobDayPanel from '@/components/JobDayPanel'
import { handOff } from '@/lib/handoff'
import {
  fmtCurrency, fmtDate, normaliseDate, deriveScheduledDates, today, addDays,
} from '@/lib/utils'
import {
  Plus, Loader2, Trash2, Edit2,
  Bell, Copy, Check, CalendarPlus, Camera, ArrowUpDown, X, Info, ChevronDown,
  Receipt, BookmarkCheck,
} from 'lucide-react'
import { invalidateTable } from '../lib/queryKeys'
import { SyncedInput } from '@/components/ui/SyncedInput'


// ── Types ────────────────────────────────────────────────────
type Job = Record<string, any>

const II = 'border-none bg-transparent text-[12.5px] font-inherit text-inherit w-full focus:outline-none focus:bg-blue-50/60 rounded px-0.5'
const IS = 'border-none bg-transparent text-xs font-inherit text-inherit cursor-pointer focus:outline-none'
/** Default booking deposit, matching the Payments page's own default. */
const DEPOSIT_PCT = 20

const BTN = 'ml-1 px-1.5 py-1 rounded-md bg-white border border-black/20 hover:bg-[#f5f4f0] align-middle'


// ── Hooks ────────────────────────────────────────────────────
function useJobs() {
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


// ── Main component ────────────────────────────────────────────
// All variations (for the "N var" badge on each row)
function useAllVariations() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['np_variations', user?.id],
    queryFn: async () => {
      const { data } = await supabase.from('np_variations').select('job_id').eq('user_id', user!.id)
      return (data ?? []) as any[]
    },
    enabled: !!user,
  })
}

// V16 qe() — inline field edit, saves instantly
function useQuickEdit() {
  const qc = useQueryClient()
  const { user } = useAuth()
  return useMutation({
    mutationFn: async ({ job, field, value }: { job: any; field: string; value: any }) => {
      const patch: Record<string, any> = { [field]: value, updated_at: new Date().toISOString() }
      // V16 recomputes scheduled dates when start/days change
      if (field === 'sched_start' || field === 'est_days') {
        patch.scheduled_dates = deriveScheduledDates({ ...job, ...patch })
      }
      const { error } = await (supabase.from('np_jobs') as any)
        .update(patch).eq('id', job.id).eq('user_id', user!.id)
      if (error) throw error
    },
    onSuccess: () => invalidateTable(qc, 'np_jobs'),
  })
}

const snoozedUntil = (j: any) => j?.extra?.follow_up_snoozed_until ?? null

// V16 copyFollowUpMsg()
function followUpMessage(j: any) {
  return `Hi ${j.client},\n\nJust following up on the quote we sent for ${j.job_desc || j.type || 'your painting project'} at ${j.address}.\n\nQuote: ${fmtCurrency(j.quote_ex_gst)} ex GST (${fmtCurrency((j.quote_ex_gst || 0) * 1.1)} inc GST)\n\nHappy to answer any questions or adjust the scope if needed.\n\nLooking forward to hearing from you!\n\nNorthern Painters`
}

export default function Jobs() {
  const { data: jobs = [], isLoading } = useJobs()
  const { data: allVariations = [] } = useAllVariations()
  const del = useDeleteJob()
  const quickEdit = useQuickEdit()
  const { user } = useAuth()
  const nav = useNavigate()

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  const [quoteFilter, setQuoteFilter] = useState('All')
  // Collapsed on every visit. Deliberately not remembered: the point of the
  // card is to be opened when you are chasing quotes, not to greet you.
  const [showFollowUp, setShowFollowUp] = useState(false)
  const [asc, setAsc] = useState(false)
  // The job modal is its own component; the page only says which job it is on.
  const [openJob, setOpenJob] = useState<{ id: string | null; initial?: Job } | null>(null)
  // Booking crew happens right here rather than on another page, so the row
  // you were working through stays where it was.
  const [crewDay, setCrewDay] = useState<{ jobId: string; date: string } | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('new') !== '1') return
    let prefill: Job | undefined
    try {
      const raw = sessionStorage.getItem('np_prefill_job')
      if (raw) {
        prefill = JSON.parse(raw)
        sessionStorage.removeItem('np_prefill_job')
      }
    } catch {}
    setOpenJob({ id: null, initial: prefill })
    // remove ?new=1 from URL without reload
    window.history.replaceState({}, '', window.location.pathname)
  }, [])

  const filtered = useMemo(() => {
    const rows = jobs.filter(j => {
      const s = search.toLowerCase()
      const matchSearch = !s || [j.client, j.address, j.id, j.type, j.job_desc].some(v => v?.toLowerCase().includes(s))
      const matchStatus = statusFilter === 'All' || j.status === statusFilter
      const matchQuote = quoteFilter === 'All' || j.quote_status === quoteFilter
      return matchSearch && matchStatus && matchQuote
    })
    // V16 sorts by created date / id
    return rows.sort((a, b) => {
      const da = a.created_at || a.id || '', db = b.created_at || b.id || ''
      return asc ? (da < db ? -1 : da > db ? 1 : 0) : (da > db ? -1 : da < db ? 1 : 0)
    })
  }, [jobs, search, statusFilter, quoteFilter, asc])

  // V16 needFollowUp — quotes sent 7+ days ago, not snoozed
  const todayStr = today()
  const needFollowUp = useMemo(() => jobs.filter(j => {
    if (j.quote_status !== 'Sent' || !j.quote_sent) return false
    const snz = snoozedUntil(j)
    if (snz && snz > todayStr) return false
    const sent = normaliseDate(j.quote_sent)
    if (!sent) return false
    return Math.floor((Date.now() - new Date(sent).getTime()) / 864e5) >= 7
  }), [jobs, todayStr])

  const varCount = useMemo(() => {
    const m: Record<string, number> = {}
    allVariations.forEach(v => { if (v.job_id) m[v.job_id] = (m[v.job_id] || 0) + 1 })
    return m
  }, [allVariations])

  async function copyFollowUp(j: any) {
    const msg = followUpMessage(j)
    try {
      await navigator.clipboard.writeText(msg)
      alert('Follow-up message copied!')
    } catch {
      prompt('Copy this message:', msg)
    }
  }

  async function markFollowedUp(j: any) {
    const until = addDays(today(), 7)
    await quickEdit.mutateAsync({
      job: j, field: 'extra',
      value: { ...(j.extra ?? {}), follow_up_snoozed_until: until, last_follow_up: todayStr },
    })
  }

  async function quickDelete(j: any) {
    if (!confirm('Delete this job?')) return
    await del.mutateAsync(j.id)
  }

  const openNew = () => setOpenJob({ id: null })
  const openEdit = (j: Job) => setOpenJob({ id: j.id })

  /** Value of the job ex GST — what is agreed if it is, else what was quoted. */
  const jobValueEx = (j: Job) => Number(j.agreed_ex_gst || j.quote_ex_gst) || 0

  function newSiteVisit(j: Job) {
    nav('/visits' + handOff('np_prefill_visit', {
      jobId: j.id, client: j.client ?? '', address: j.address ?? '', date: today(),
    }))
  }

  function newInvoice(j: Job) {
    nav('/invoices' + handOff('np_prefill_invoice', {
      job_id: j.id, client: j.client ?? '', date: today(),
    }))
  }

  /**
   * Raise the booking deposit. The job is not marked Booked here — it becomes
   * Booked when the deposit is actually paid, which the Invoices page does on
   * the unpaid to paid transition. Until then it is quoted work like any other.
   */
  function bookJob(j: Job) {
    const value = jobValueEx(j)
    if (!value) {
      alert(`${j.id} has no quoted or agreed amount yet, so there is nothing to take a deposit on.`)
      return
    }
    const raw = prompt(`Booking deposit for ${j.id} — percentage of ${fmtCurrency(value)} ex GST:`, String(DEPOSIT_PCT))
    if (raw === null) return
    const pct = parseFloat(raw)
    if (!(pct > 0 && pct <= 100)) { alert('Enter a percentage between 0 and 100.'); return }
    nav('/invoices' + handOff('np_prefill_invoice', {
      job_id: j.id,
      client: j.client ?? '',
      date: today(),
      notes: 'Booking deposit',
      depositExGST: Math.round(value * pct) / 100,
      bookingDeposit: true,
    }))
  }

  return (
    <div className="p-5">
      {/* Header */}
      <div>
        <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
          <h2 className="text-[17px] font-semibold text-gray-900">Jobs &amp; Quotes</h2>
          <button onClick={openNew}
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white font-medium text-[13px] px-3 py-1.5 rounded-lg transition-colors">
            <Plus size={14} /> New Job
          </button>
        </div>
        <div className="text-[11px] text-[#666] mb-2 flex items-center gap-1">
          <Info size={12} /> Edit inline — dropdowns save instantly. Click pencil for full edit.
        </div>

        {/* V16 filter bar */}
        <div className="flex gap-2 mb-3 flex-wrap items-center">
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..."
            className="w-[200px] px-2.5 py-1.5 text-[12.5px] bg-white border border-black/20 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500" />
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="px-2.5 py-1.5 text-[12.5px] bg-white border border-black/20 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500">
            <option value="All">All job statuses</option>
            {JOB_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={quoteFilter} onChange={e => setQuoteFilter(e.target.value)}
            className="px-2.5 py-1.5 text-[12.5px] bg-white border border-black/20 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500">
            <option value="All">All quote statuses</option>
            {QUOTE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <button onClick={() => setAsc(a => !a)}
            className="flex items-center gap-1 px-2.5 py-1.5 text-[12.5px] bg-white border border-black/20 rounded-lg hover:bg-[#f5f4f0] whitespace-nowrap">
            <ArrowUpDown size={13} /> {asc ? 'Oldest first' : 'Newest first'}
          </button>
          <button onClick={() => { setSearch(''); setStatusFilter('All'); setQuoteFilter('All'); setAsc(false) }}
            title="Clear filters"
            className="flex items-center gap-1 px-2.5 py-1.5 text-[12.5px] bg-white border border-black/20 rounded-lg hover:bg-[#f5f4f0] text-[#666]">
            <X size={13} /> Clear
          </button>
        </div>

        {/* Quote follow-up card */}
        {needFollowUp.length > 0 && (
          <div className="bg-white border border-black/[0.12] rounded-xl px-4 py-2.5 mb-3" style={{ borderLeft: '4px solid #f59e0b' }}>
            <button type="button" onClick={() => setShowFollowUp(v => !v)}
              aria-expanded={showFollowUp}
              className={`flex items-center w-full text-left gap-1.5 ${showFollowUp ? 'mb-2.5' : ''}`}>
              <ChevronDown size={14} className={`text-[#92400e] shrink-0 transition-transform ${showFollowUp ? '' : '-rotate-90'}`} />
              <span className="text-[13px] font-bold text-[#92400e] inline-flex items-center gap-1.5">
                <Bell size={14} /> Quote follow-up needed
              </span>
              <span className="text-[11px] text-[#666]">
                {needFollowUp.length} quote{needFollowUp.length === 1 ? '' : 's'} sent 7+ days ago with no response
              </span>
            </button>
            <div className={`flex-col gap-1.5 ${showFollowUp ? 'flex' : 'hidden'}`}>
              {needFollowUp.map(j => {
                const sent = normaliseDate(j.quote_sent)!
                const days = Math.floor((Date.now() - new Date(sent).getTime()) / 864e5)
                return (
                  <div key={j.id} className="flex items-center justify-between bg-[#fffbeb] rounded-lg px-3 py-2 flex-wrap gap-2">
                    <div>
                      <span className="font-semibold text-[13px]">{j.client}</span>
                      <span className="text-[11px] text-[#666] ml-2">
                        {j.id} · {j.type || ''} · {fmtCurrency(j.quote_ex_gst)} ex GST
                      </span>
                      <span className="text-[11px] text-[#92400e] ml-2 font-semibold">{days} days ago</span>
                    </div>
                    <div className="flex gap-1.5">
                      <button onClick={() => copyFollowUp(j)}
                        className="flex items-center gap-1 px-2 py-1 text-[11px] rounded-md bg-[#fef3c7] border border-[#fcd34d] text-[#92400e] hover:brightness-95">
                        <Copy size={11} /> Copy message
                      </button>
                      <button onClick={() => markFollowedUp(j)}
                        className="flex items-center gap-1 px-2 py-1 text-[11px] rounded-md bg-[#dcfce7] border border-[#86efac] text-[#166534] hover:brightness-95">
                        <Check size={11} /> Mark followed up
                      </button>
                      <button onClick={() => openEdit(j)}
                        className="flex items-center gap-1 px-2 py-1 text-[11px] rounded-md bg-blue-600 text-white hover:bg-blue-700">
                        <Edit2 size={11} /> Open job
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* V16 inline-editable table */}
      <div>
        <div className="bg-white border border-black/[0.12] rounded-xl overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={20} className="animate-spin text-blue-600" />
            </div>
          ) : (
            <div className="overflow-auto max-h-[70vh]">
              <table className="w-full border-collapse text-[12.5px]">
                <thead>
                  <tr>
                    {['ID','Client','Address','Agreed ex GST','Quote status','Job status','Start','Days',''].map((h, i) => (
                      <th key={i} className="text-left px-2.5 py-[7px] border-b border-black/[0.12] text-[#666] font-medium whitespace-nowrap bg-[#fafaf8] sticky top-0 z-[2]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(j => {
                    const vc = varCount[j.id] || 0
                    const scheduled = ['Scheduled','In Progress','Hourly Rate Accepted'].includes(j.status || '')
                    return (
                      <tr key={j.id} className="border-b border-black/[0.06] hover:bg-[#fafaf8]">
                        <td className="px-2.5 py-[7px] text-[#2563eb] font-medium whitespace-nowrap">{j.id}</td>
                        <td className="px-2.5 py-[7px]">
                          <SyncedInput value={j.client ?? ''} className={II}
                            onBlur={e => { if (e.target.value !== (j.client ?? '')) quickEdit.mutate({ job: j, field: 'client', value: e.target.value }) }} />
                        </td>
                        <td className="px-2.5 py-[7px]">
                          <SyncedInput value={j.address ?? ''} className={II} style={{ maxWidth: 130 }}
                            onBlur={e => { if (e.target.value !== (j.address ?? '')) quickEdit.mutate({ job: j, field: 'address', value: e.target.value }) }} />
                        </td>
                        <td className="px-2.5 py-[7px]">
                          <SyncedInput type="number" value={j.agreed_ex_gst ?? ''} placeholder="—" className={II} style={{ width: 90 }}
                            onBlur={e => {
                              const v = e.target.value === '' ? null : parseFloat(e.target.value)
                              if (v !== (j.agreed_ex_gst ?? null)) quickEdit.mutate({ job: j, field: 'agreed_ex_gst', value: v })
                            }} />
                        </td>
                        <td className="px-2.5 py-[7px] whitespace-nowrap">
                          <select value={j.quote_status ?? ''} className={IS}
                            onChange={e => quickEdit.mutate({ job: j, field: 'quote_status', value: e.target.value })}>
                            <option value=""></option>
                            {QUOTE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                          {vc > 0 && (
                            <span className="ml-1 inline-block px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#fef3c7] text-[#92400e]">{vc} var</span>
                          )}
                        </td>
                        <td className="px-2.5 py-[7px]">
                          <select value={j.status ?? ''} className={IS}
                            onChange={e => quickEdit.mutate({ job: j, field: 'status', value: e.target.value })}>
                            <option value=""></option>
                            {JOB_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </td>
                        <td className="px-2.5 py-[7px]">
                          <SyncedInput type="date" value={normaliseDate(j.sched_start) ?? ''} className={II} style={{ width: 118 }}
                            onBlur={e => { if (e.target.value !== (normaliseDate(j.sched_start) ?? '')) quickEdit.mutate({ job: j, field: 'sched_start', value: e.target.value || null }) }} />
                        </td>
                        <td className="px-2.5 py-[7px]">
                          <SyncedInput type="number" value={j.est_days ?? ''} placeholder="—" className={II} style={{ width: 44 }}
                            onBlur={e => {
                              const v = e.target.value === '' ? null : parseFloat(e.target.value)
                              if (v !== (j.est_days ?? null)) quickEdit.mutate({ job: j, field: 'est_days', value: v })
                            }} />
                        </td>
                        <td className="px-2.5 py-[7px] whitespace-nowrap">
                          <button onClick={() => newSiteVisit(j)} title="New site visit for this job" className={BTN}><Camera size={13} /></button>
                          <button onClick={() => setCrewDay({ jobId: j.id, date: normaliseDate(j.sched_start) || today() })}
                            title="Book crew on this job"
                            className={BTN} style={scheduled ? { color: '#059669' } : undefined}><CalendarPlus size={13} /></button>
                          <button onClick={() => newInvoice(j)} title="New invoice for this job" className={BTN}><Receipt size={13} /></button>
                          <button onClick={() => bookJob(j)} title="Book job — raise the deposit invoice"
                            className={BTN} style={j.quote_status === 'Booked' ? { color: '#059669' } : undefined}>
                            <BookmarkCheck size={13} />
                          </button>
                          <button onClick={() => openEdit(j)} title="Edit"
                            className="ml-1 px-1.5 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700 align-middle"><Edit2 size={13} /></button>
                          <button onClick={() => quickDelete(j)} title="Delete"
                            className={BTN} style={{ color: '#c0392b' }}><Trash2 size={13} /></button>
                        </td>
                      </tr>
                    )
                  })}
                  {filtered.length === 0 && (
                    <tr><td colSpan={9} className="text-center py-16 text-[#666]">No jobs found</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Edit/New Modal */}

      <JobDayPanel
        jobId={crewDay?.jobId ?? null}
        date={crewDay?.date ?? null}
        onClose={() => setCrewDay(null)}
      />

      <JobModal
        open={!!openJob}
        jobId={openJob?.id ?? null}
        initial={openJob?.initial}
        onClose={() => setOpenJob(null)}
      />
    </div>
  )
}
