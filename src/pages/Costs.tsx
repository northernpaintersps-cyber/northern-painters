import { useState, useMemo } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, selectAll } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { fmtCurrency } from '@/lib/utils'
import { Loader2, X, BarChart3, Edit2, Info, ChevronDown, ChevronRight } from 'lucide-react'
import { invalidateTable } from '../lib/queryKeys'
import { SyncedInput } from '@/components/ui/SyncedInput'
import InfoTip, { TipCalc } from '@/components/InfoTip'
import { jobHours, hoursSummary, hoursColour, hoursLabel } from '@/lib/hours'

const JS_OPTS = ['Not Started','Scheduled','In Progress','Hourly Rate Accepted','Finished','Closed']
const QS_OPTS = ['Info Collected','Site Visit','Quote Created','Sent','Negotiating','Accepted','Booked','Not Accepted','Lost']

const STATUS_BADGE: Record<string, string> = {
  'Finished':    'bg-[#dcfce7] text-[#166534]',
  'In Progress': 'bg-[#dbeafe] text-[#1e40af]',
  'Scheduled':   'bg-[#ede9fe] text-[#5b21b6]',
  'Not Started': 'bg-[#f1f0e8] text-[#5f5e5a]',
  'Closed':      'bg-[#f1f0e8] text-[#5f5e5a]',
}

function useTable(table: string) {
  const { user } = useAuth()
  return useQuery({
    queryKey: [table, user?.id],
    queryFn: async () => {
      const { data } = await selectAll(table, user!.id)
      return (data ?? []) as any[]
    },
    enabled: !!user,
  })
}

function useSetRate() {
  const qc = useQueryClient()
  const { user } = useAuth()
  return useMutation({
    mutationFn: async ({ jobId, rate }: { jobId: string; rate: number }) => {
      const { error } = await (supabase.from('np_jobs') as any)
        .update({ labour_rate: rate, updated_at: new Date().toISOString() })
        .eq('id', jobId).eq('user_id', user!.id)
      if (error) throw error
    },
    onSuccess: () => invalidateTable(qc, 'np_jobs'),
  })
}

// V16 _costBar()
function CostBar({ pct, type }: { pct: number | null; type: 'labour' | 'materials' | 'total' }) {
  const over = pct !== null && pct > 1
  const w = Math.min((pct ?? 0) * 100, 100).toFixed(1)
  const bg = over ? 'linear-gradient(90deg,#dc2626,#f87171)'
    : type === 'labour' ? 'linear-gradient(90deg,#2563eb,#60a5fa)'
    : type === 'materials' ? 'linear-gradient(90deg,#7c3aed,#a78bfa)'
    : 'linear-gradient(90deg,#0f766e,#14b8a6)'
  return (
    <div className="h-2.5 rounded-lg overflow-hidden" style={{ background: over ? 'rgba(220,38,38,.15)' : 'rgba(0,0,0,.07)' }}>
      <div className="h-full rounded-lg" style={{ width: `${w}%`, background: bg }} />
    </div>
  )
}

// V16 _costPct()
function CostPct({ pct }: { pct: number }) {
  const bg = pct > 1 ? '#fee2e2' : pct >= 0.75 ? '#fef3c7' : '#dcfce7'
  const col = pct > 1 ? '#dc2626' : pct >= 0.75 ? '#d97706' : '#16a34a'
  return <span className="text-[11px] font-extrabold px-2 py-0.5 rounded-xl" style={{ background: bg, color: col }}>{(pct * 100).toFixed(1)}%</span>
}

function Stat({ value, label, color }: { value: string; label: string; color?: string }) {
  return (
    <div className="flex flex-col gap-px">
      <div className="text-[13px] font-bold" style={{ color: color ?? '#1a1a18' }}>{value}</div>
      <div className="text-[10px] font-semibold text-[#666] uppercase tracking-wide">{label}</div>
    </div>
  )
}

export default function Costs() {
  const nav = useNavigate()
  const { data: jobs = [], isLoading } = useTable('np_jobs')
  const { data: labour = [] } = useTable('np_labour')
  const { data: materials = [] } = useTable('np_materials')
  const setRate = useSetRate()
  const { user } = useAuth()

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

  const [q, setQ] = useState('')
  const [jobStatus, setJobStatus] = useState('')
  const [quoteStatus, setQuoteStatus] = useState('')
  const [showHours, setShowHours] = useState(true)
  const anyFilter = !!(q || jobStatus || quoteStatus)

  const labourOf = (id: string) => labour.filter(l => l.job_id === id)
  const matOf = (id: string) => materials.filter(m => m.job_id === id)
  const labSpentOf = (id: string) => labourOf(id).reduce((a, l) => a + (l.cost || (l.hours || 0) * (l.rate || 0)), 0)
  const matSpentOf = (id: string) => matOf(id).reduce((a, m) => a + (m.cost_ex_gst || 0), 0)
  const hrsOf = (id: string) => labourOf(id).reduce((a, l) => a + (l.hours || 0), 0)

  const costJobs = useMemo(() => {
    let list = jobs.filter(j =>
      (j.agreed_ex_gst || 0) > 0 || (j.quote_ex_gst || 0) > 0 ||
      labour.some(l => l.job_id === j.id) || materials.some(m => m.job_id === j.id)
    )
    if (q) {
      const s = q.toLowerCase()
      list = list.filter(j => `${j.client ?? ''}${j.id ?? ''}${j.job_desc ?? ''}${j.address ?? ''}`.toLowerCase().includes(s))
    }
    if (jobStatus) list = list.filter(j => j.status === jobStatus)
    if (quoteStatus) list = list.filter(j => j.quote_status === quoteStatus)
    return list
  }, [jobs, labour, materials, q, jobStatus, quoteStatus])

  // Totals
  const totAgreed = costJobs.reduce((s, j) => s + (j.agreed_ex_gst || 0), 0)
  const totLabSpent = costJobs.reduce((s, j) => s + labSpentOf(j.id), 0)
  const totMatSpent = costJobs.reduce((s, j) => s + matSpentOf(j.id), 0)
  const totSpent = totLabSpent + totMatSpent
  const totGP = totAgreed - totSpent
  // One derivation of the hours budget, shared with the per-job table below
  // and with each job card, so the three cannot disagree about the rate.
  const hours = useMemo(() => hoursSummary(costJobs, labour, rate0), [costJobs, labour, rate0])
  const totHrsRemaining = hours.totalRemaining
  const spentRatio = totAgreed > 0 ? totSpent / totAgreed : 0

  if (isLoading) return (
    <div className="flex items-center justify-center h-64"><Loader2 size={20} className="animate-spin text-blue-600" /></div>
  )

  return (
    <div className="p-5">
      <h2 className="text-[17px] font-semibold text-gray-900 mb-4">Project Costs</h2>

      {/* KPI metrics */}
      <div className="grid gap-2.5 mb-3.5" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))' }}>
        {[
          { l: 'Total agreed', v: fmtCurrency(totAgreed), c: '#16a34a' },
          { l: 'Labour spent', v: fmtCurrency(totLabSpent) },
          { l: 'Materials spent', v: fmtCurrency(totMatSpent) },
          { l: 'Total spent', v: fmtCurrency(totSpent), c: spentRatio > 0.9 ? '#dc2626' : spentRatio > 0.7 ? '#d97706' : undefined },
          {
            l: 'Hours remaining', v: `${totHrsRemaining > 0 ? '+' : ''}${totHrsRemaining.toFixed(0)} hrs`, c: '#2563eb',
            help: <>Hours left across every job with a labour estimate. A single figure, so a job
              forty hours over cancels out two with twenty to spare — the table below is where
              that shows.
              <TipCalc>Each job&rsquo;s labour estimate divided by its quoted rate, less the hours
              logged against it. Jobs with no labour estimate are not in it.</TipCalc></>,
          },
          { l: 'Est. gross profit', v: fmtCurrency(totGP), c: totGP >= 0 ? '#16a34a' : '#dc2626' },
        ].map(m => (
          <div key={m.l} className="bg-[#f5f4f0] rounded-lg px-4 py-3.5">
            <div className="text-[11px] text-[#666] mb-1 flex items-center gap-1">
              {m.l}{(m as any).help && <InfoTip title={m.l}>{(m as any).help}</InfoTip>}
            </div>
            <div className="text-xl font-semibold" style={m.c ? { color: m.c } : undefined}>{m.v}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white border border-black/[0.12] rounded-xl px-3.5 py-3 mb-3">
        <div className="flex gap-2 flex-wrap items-center">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="🔍 Search client, job ID…"
            className="flex-[2] min-w-[160px] px-2.5 py-2 text-[13px] bg-white border border-black/20 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500" />
          <select value={jobStatus} onChange={e => setJobStatus(e.target.value)}
            className="flex-1 min-w-[140px] px-2.5 py-2 text-[13px] bg-white border border-black/20 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500">
            <option value="">All job statuses</option>
            {JS_OPTS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={quoteStatus} onChange={e => setQuoteStatus(e.target.value)}
            className="flex-1 min-w-[140px] px-2.5 py-2 text-[13px] bg-white border border-black/20 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500">
            <option value="">All quote statuses</option>
            {QS_OPTS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          {anyFilter && (
            <button onClick={() => { setQ(''); setJobStatus(''); setQuoteStatus('') }}
              className="flex items-center gap-1 px-2.5 py-2 text-[13px] bg-white border border-black/20 rounded-lg hover:bg-[#f5f4f0] text-[#c0392b]">
              <X size={13} /> Clear
            </button>
          )}
        </div>
      </div>

      {/* ── Labour hours by job ─────────────────────────────
          The same figure each job card carries, gathered into one place: the
          cards are tall, so comparing them meant scrolling past everything
          else. Worst position first — that is the row worth reading. */}
      {hours.rows.length > 0 && (
        <div className="bg-white border border-black/[0.12] rounded-xl mb-3 overflow-hidden">
          <button onClick={() => setShowHours(v => !v)}
            className="w-full flex items-center justify-between gap-2 px-3.5 py-2.5 hover:bg-[#fafaf8] text-left">
            <div className="flex items-center gap-1.5 text-[13px] font-bold text-gray-900">
              {showHours ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              Labour hours by job
              <InfoTip title="Labour hours by job">
                Where the hours are going, job by job, worst first. A job over its hours is
                losing money on every hour after it, whatever the dollars say.
                <TipCalc>Budget is the job&rsquo;s labour estimate divided by its quoted rate.
                Remaining is that less the hours logged against it. Amber inside the last
                quarter of the budget, red once it is past.</TipCalc>
              </InfoTip>
            </div>
            <div className="flex items-center gap-2 text-[11px]">
              {hours.overCount > 0 && (
                <span className="font-semibold text-[#dc2626] bg-[#fee2e2] px-2 py-0.5 rounded-full">
                  {hours.overCount} over budget
                </span>
              )}
              {hours.tightCount > 0 && (
                <span className="font-semibold text-[#92400e] bg-[#fef3c7] px-2 py-0.5 rounded-full">
                  {hours.tightCount} running tight
                </span>
              )}
              <span className="text-[#666]">
                {hours.totalLogged.toFixed(0)} of {hours.totalBudgeted.toFixed(0)} hrs logged
              </span>
            </div>
          </button>

          {showHours && (
            <div className="overflow-auto max-h-[45vh] border-t border-black/[0.12]">
              <table className="w-full border-collapse text-[12.5px]">
                <thead>
                  <tr>
                    {['Job', 'Budget', 'Logged', 'Remaining', 'Used', ''].map((h, i) => (
                      <th key={h} className={`px-2.5 py-[7px] border-b border-black/[0.12] text-[#666] font-medium whitespace-nowrap bg-[#fafaf8] sticky top-0 z-[2] ${[1, 2, 3].includes(i) ? 'text-right' : 'text-left'}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {hours.rows.map(({ job, hours: h }) => (
                    <tr key={job.id} className="border-b border-black/[0.06] hover:bg-[#fafaf8]">
                      <td className="px-2.5 py-[7px]">
                        <Link to={`/jobs/${job.id}`} title="Open this job"
                          className="text-[10px] font-extrabold text-[#2563eb] bg-[#dbeafe] px-1.5 py-0.5 rounded-full mr-1.5 hover:bg-[#bfdbfe]">{job.id}</Link>
                        <span className="font-medium">{job.client}</span>
                        <span className="text-[11px] text-[#666]"> · {job.status || '—'} · ${h.rate}/hr</span>
                      </td>
                      <td className="px-2.5 py-[7px] text-right tabular-nums text-[#666]">{h.budgeted!.toFixed(1)}</td>
                      <td className="px-2.5 py-[7px] text-right tabular-nums">{h.logged.toFixed(1)}</td>
                      <td className="px-2.5 py-[7px] text-right tabular-nums font-bold" style={{ color: hoursColour(h) }}>
                        {hoursLabel(h)}
                        <span className="text-[10px] font-normal"> {h.over ? 'over' : 'left'}</span>
                      </td>
                      <td className="px-2.5 py-[7px] text-right tabular-nums" style={{ color: hoursColour(h) }}>
                        {h.used !== null ? Math.round(h.used * 100) + '%' : '—'}
                      </td>
                      <td className="px-2.5 py-[7px] w-[110px]">
                        <div className="h-1.5 rounded-full bg-black/[0.07] overflow-hidden">
                          <div className="h-full rounded-full" style={{
                            width: Math.min(100, (h.used ?? 0) * 100) + '%',
                            background: hoursColour(h),
                          }} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {hours.unbudgeted.length > 0 && (
                <div className="px-3.5 py-2 text-[11px] text-[#666] border-t border-black/[0.06] bg-[#fafaf8]">
                  {hours.unbudgeted.length} job{hours.unbudgeted.length !== 1 ? 's have' : ' has'} hours
                  logged with no labour estimate to judge them against
                  {' '}({hours.unbudgeted.map(u => u.job.id).join(', ')}) — set one on the job to see it here.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {costJobs.length === 0 ? (
        <div className="bg-white border border-black/[0.12] rounded-xl text-center py-8 text-[#666]">
          <BarChart3 size={32} className="mx-auto mb-2 text-gray-300" />
          No jobs with cost data yet.<br />
          <span className="text-xs">Add agreed amounts and log labour/materials against jobs to see costs here.</span>
        </div>
      ) : costJobs.map(j => {
        const rate = j.labour_rate || rate0
        const labSpent = labSpentOf(j.id)
        const matSpent = matSpentOf(j.id)
        const hrsLogged = hrsOf(j.id)
        const agreed = j.agreed_ex_gst || 0
        const labBudget = j.est_labour_ex || 0
        const matBudget = j.est_materials_ex || 0
        const hasBreakdown = labBudget > 0 || matBudget > 0
        const costBudget = labBudget + matBudget
        const totalSpent = labSpent + matSpent
        const estGP = agreed - totalSpent
        const estMg = agreed > 0 ? (estGP / agreed) * 100 : null
        const jh = jobHours(j, labour, rate0)
        const hrsBudgeted = jh.budgeted
        const hrsRemaining = jh.remaining
        const mgCol = estMg === null ? '#666' : estMg >= 30 ? '#16a34a' : estMg >= 15 ? '#d97706' : '#dc2626'
        const hrRemCol = hoursColour(jh)

        const labPct = labBudget > 0 ? labSpent / labBudget : null
        const labOver = labPct !== null && labPct > 1
        const labWarn = labPct !== null && labPct >= 0.75 && !labOver
        const labRemaining = labBudget > 0 ? labBudget - labSpent : null

        const matPct = matBudget > 0 ? matSpent / matBudget : null
        const matOver = matPct !== null && matPct > 1
        const matWarn = matPct !== null && matPct >= 0.75 && !matOver
        const matRemaining = matBudget > 0 ? matBudget - matSpent : null

        const totBudget = hasBreakdown ? costBudget : agreed
        const totPct = totBudget > 0 ? totalSpent / totBudget : null
        const totOver = totPct !== null && totPct > 1
        const totWarn = totPct !== null && totPct >= 0.75 && !totOver
        const totRemaining = totBudget > 0 ? totBudget - totalSpent : null

        return (
          <div key={j.id} className="bg-white border border-black/[0.12] rounded-xl overflow-hidden mb-3">
            {/* Header */}
            <div className="flex items-start gap-3 px-4.5 pt-3.5 pb-3 border-b border-black/[0.12] bg-[#fafaf8] flex-wrap" style={{ paddingLeft: 18, paddingRight: 18 }}>
              <Link to={`/jobs/${j.id}`} title="Open this job"
                className="text-xs font-extrabold text-[#2563eb] bg-[#dbeafe] px-2.5 py-1 rounded-full whitespace-nowrap shrink-0 hover:bg-[#bfdbfe]">{j.id}</Link>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-[#1a1a18]">{j.client}</div>
                {j.address && <div className="text-[11px] text-[#666] mt-px truncate">{j.address}</div>}
                <div className="mt-1.5 flex gap-1.5 flex-wrap">
                  <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${STATUS_BADGE[j.status || ''] || 'bg-[#f1f0e8] text-[#5f5e5a]'}`}>
                    {j.status || '—'}
                  </span>
                  {j.terms && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-xl bg-[#ede9fe] text-[#5b21b6]">{j.terms}</span>}
                </div>
              </div>
              <div className="flex flex-col items-end gap-0.5 shrink-0">
                <div className="text-[10px] font-bold text-[#666] uppercase tracking-wide">Agreed ex GST</div>
                <div className="text-xl font-extrabold text-[#1a1a18] tabular-nums">{fmtCurrency(agreed)}</div>
                <button onClick={() => nav('/jobs')}
                  className="flex items-center gap-1 text-[10px] px-2 py-0.5 mt-0.5 bg-white border border-black/20 rounded-md hover:bg-[#f5f4f0]">
                  <Edit2 size={10} /> Edit
                </button>
              </div>
            </div>

            {/* Bars */}
            <div className="flex flex-col gap-3" style={{ padding: '16px 18px' }}>
              {!hasBreakdown && (
                <div className="inline-flex items-center gap-1.5 text-[11px] text-[#666] bg-[#fafaf8] border border-dashed border-black/[0.12] rounded-md px-2.5 py-1 w-fit">
                  <Info size={12} /> No labour/materials cost breakdown set — showing agreed total vs spent.
                  <button onClick={() => nav('/jobs')} className="ml-1 px-2 py-0.5 text-[10px] bg-white border border-black/20 rounded hover:bg-[#f5f4f0]">Edit job</button>
                </div>
              )}

              {/* Labour */}
              <div className="rounded-[10px] flex flex-col gap-2" style={{
                padding: '12px 14px',
                background: labOver ? '#fff1f2' : labWarn ? '#fffbeb' : '#f0fdf4',
                border: `1px solid ${labOver ? '#fca5a5' : labWarn ? '#fde68a' : '#86efac'}`,
              }}>
                <div className="flex items-center justify-between flex-wrap gap-1.5">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-[#1a1a18]">
                    <span className="w-[9px] h-[9px] rounded-full bg-[#2563eb] shrink-0 inline-block" /> Labour
                    {labOver && <span className="text-[10px] font-bold text-[#dc2626] bg-[#fee2e2] px-1.5 py-0.5 rounded-lg">⚠ Over budget</span>}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {labBudget > 0 && <span className="text-[11px] text-[#666]">Budget {fmtCurrency(labBudget)}</span>}
                    <span className="text-sm font-extrabold tabular-nums" style={{ color: labOver ? '#dc2626' : labWarn ? '#d97706' : '#16a34a' }}>{fmtCurrency(labSpent)}</span>
                    {labPct !== null && <CostPct pct={labPct} />}
                  </div>
                </div>
                <CostBar pct={labBudget > 0 ? labPct : (agreed > 0 ? labSpent / agreed : 0)} type="labour" />
                {labBudget > 0 && (
                  <div className="text-[10px] font-semibold text-right" style={{ color: labOver ? '#dc2626' : labWarn ? '#d97706' : '#16a34a' }}>
                    {labOver ? `⚠ ${fmtCurrency(Math.abs(labRemaining!))} over labour budget` : `${fmtCurrency(labRemaining!)} remaining in labour budget`}
                  </div>
                )}
                {/* Hours panel */}
                <div className="grid grid-cols-4 gap-2 pt-2.5" style={{ borderTop: `1px solid ${labOver ? '#fca5a5' : labWarn ? '#fde68a' : '#86efac'}` }}>
                  <div className="text-center">
                    <div className="text-lg font-extrabold text-[#666] tabular-nums">{hrsBudgeted !== null ? hrsBudgeted.toFixed(1) : '—'}</div>
                    <div className="text-[9px] font-bold text-[#666] uppercase tracking-wide mt-0.5">Hrs budgeted</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-extrabold text-[#1a1a18] tabular-nums">{hrsLogged.toFixed(1)}</div>
                    <div className="text-[9px] font-bold text-[#666] uppercase tracking-wide mt-0.5">Hrs logged</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-extrabold tabular-nums" style={{ color: hrRemCol }}>
                      {hoursLabel(jh)}
                    </div>
                    <div className="text-[9px] font-bold text-[#666] uppercase tracking-wide mt-0.5">
                      {hrsRemaining !== null && hrsRemaining < 0 ? 'Hrs over' : 'Hrs remaining'}
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="flex items-center justify-center gap-0.5 bg-white border border-black/[0.12] rounded-[7px] px-2 py-1"
                      title="Edit rate — recalculates hours">
                      <span className="text-[11px] font-semibold text-[#666]">$</span>
                      <SyncedInput type="number" min={1} step={1} value={rate}
                        onBlur={e => {
                          const v = parseFloat(e.target.value) || 0
                          if (v !== rate) setRate.mutate({ jobId: j.id, rate: v })
                        }}
                        className="w-11 border-none bg-transparent text-xs font-bold text-[#1a1a18] tabular-nums text-right outline-none p-0" />
                      <span className="text-[11px] font-semibold text-[#666]">/hr</span>
                    </div>
                    <div className="text-[9px] font-bold text-[#666] uppercase tracking-wide mt-1 text-center">Quoted rate</div>
                  </div>
                </div>
              </div>

              {/* Materials */}
              <div className="rounded-[10px] flex flex-col gap-2" style={{
                padding: '12px 14px',
                background: matOver ? '#fff1f2' : matWarn ? '#fffbeb' : '#f5f3ff',
                border: `1px solid ${matOver ? '#fca5a5' : matWarn ? '#fde68a' : '#c4b5fd'}`,
              }}>
                <div className="flex items-center justify-between flex-wrap gap-1.5">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-[#1a1a18]">
                    <span className="w-[9px] h-[9px] rounded-full bg-[#7c3aed] shrink-0 inline-block" /> Materials
                    {matOver && <span className="text-[10px] font-bold text-[#dc2626] bg-[#fee2e2] px-1.5 py-0.5 rounded-lg">⚠ Over budget</span>}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {matBudget > 0 && <span className="text-[11px] text-[#666]">Budget {fmtCurrency(matBudget)}</span>}
                    <span className="text-sm font-extrabold tabular-nums" style={{ color: matOver ? '#dc2626' : matWarn ? '#d97706' : '#7c3aed' }}>{fmtCurrency(matSpent)}</span>
                    {matPct !== null && <CostPct pct={matPct} />}
                  </div>
                </div>
                <CostBar pct={matBudget > 0 ? matPct : (agreed > 0 ? matSpent / agreed : 0)} type="materials" />
                {matBudget > 0 && (
                  <div className="text-[10px] font-semibold text-right" style={{ color: matOver ? '#dc2626' : matWarn ? '#d97706' : '#7c3aed' }}>
                    {matOver ? `⚠ ${fmtCurrency(Math.abs(matRemaining!))} over materials budget` : `${fmtCurrency(matRemaining!)} remaining in materials budget`}
                  </div>
                )}
              </div>

              {/* Divider */}
              <div className="text-[10px] font-bold text-[#666] uppercase tracking-wider flex items-center gap-2">
                <span className="flex-1 h-px bg-black/[0.12]" />
                Total vs {hasBreakdown ? 'cost budget' : 'agreed'}
                <span className="flex-1 h-px bg-black/[0.12]" />
              </div>

              {/* Total */}
              <div className="rounded-[10px] flex flex-col gap-2" style={{
                padding: '12px 14px',
                background: totOver ? '#fff1f2' : totWarn ? '#fffbeb' : '#f0fdfa',
                border: `1px solid ${totOver ? '#fca5a5' : totWarn ? '#fde68a' : '#5eead4'}`,
              }}>
                <div className="flex items-center justify-between flex-wrap gap-1.5">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-[#1a1a18]">
                    <span className="w-[9px] h-[9px] rounded-full bg-[#0f766e] shrink-0 inline-block" />
                    Total cost spent {!hasBreakdown && <span className="text-[10px] font-normal text-[#666]">(vs agreed)</span>}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] text-[#666]">{hasBreakdown ? 'Cost budget' : 'Agreed'} {fmtCurrency(totBudget)}</span>
                    <span className="text-sm font-extrabold tabular-nums" style={{ color: totOver ? '#dc2626' : totWarn ? '#d97706' : '#0f766e' }}>{fmtCurrency(totalSpent)}</span>
                    {totPct !== null ? <CostPct pct={totPct} /> : <span className="text-[11px] text-[#666]">no target</span>}
                  </div>
                </div>
                {totBudget > 0 && <CostBar pct={totPct} type="total" />}
                <div className="text-[10px] font-semibold text-right" style={{ color: totOver ? '#dc2626' : totWarn ? '#d97706' : '#0f766e' }}>
                  {totOver ? `⚠ ${fmtCurrency(Math.abs(totRemaining!))} over budget` : totRemaining !== null ? `${fmtCurrency(totRemaining)} remaining` : ''}
                  {' · Est. gross profit '}
                  <span style={{ color: estGP >= 0 ? '#16a34a' : '#dc2626', fontWeight: 700 }}>{fmtCurrency(estGP)}</span>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center gap-4 flex-wrap px-4.5 py-2.5 border-t border-black/[0.12] bg-[#fafaf8]" style={{ paddingLeft: 18, paddingRight: 18 }}>
              <Stat value={estMg !== null ? estMg.toFixed(1) + '%' : '—'} label="Est. margin" color={mgCol} />
              <div className="w-px h-7 bg-black/[0.12] shrink-0" />
              <Stat value={fmtCurrency(estGP)} label="Est. gross profit" color={estGP >= 0 ? '#16a34a' : '#dc2626'} />
              <div className="w-px h-7 bg-black/[0.12] shrink-0" />
              <Stat
                value={jh.remaining === null ? '—' : jh.over ? `${jh.remaining.toFixed(1)} hrs over` : `+${jh.remaining.toFixed(1)} hrs left`}
                label="Labour hrs" color={hrRemCol} />
              <div className="w-px h-7 bg-black/[0.12] shrink-0" />
              <Stat value={fmtCurrency(labSpent)} label="Labour spent" />
              <div className="w-px h-7 bg-black/[0.12] shrink-0" />
              <Stat value={fmtCurrency(matSpent)} label="Materials spent" />
            </div>
          </div>
        )
      })}
    </div>
  )
}
