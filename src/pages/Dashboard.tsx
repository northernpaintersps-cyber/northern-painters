import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { fmtCurrency, calcOwed, invStatus, normaliseDate, genId, crewLabel } from '@/lib/utils'
import {
  AlertCircle, UserPlus, Clock, Users, ExternalLink, Plus,
  CalendarDays, BarChart3, CheckSquare, CalendarPlus,
} from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'

// ── Local YYYY-MM-DD (no UTC shift) ──────────────────────────
function localStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function useAllData() {
  const { user } = useAuth()
  const uid = user?.id
  const opts = (table: string) => ({
    queryKey: [table, uid],
    queryFn: async () => {
      const { data, error } = await supabase.from(table as any).select('*').eq('user_id', uid!)
      if (error) throw error
      return (data ?? []) as any[]
    },
    enabled: !!uid,
  })
  const jobs        = useQuery(opts('np_jobs'))
  const invoices    = useQuery(opts('np_invoices'))
  const labour      = useQuery(opts('np_labour'))
  const materials   = useQuery(opts('np_materials'))
  const expenses    = useQuery(opts('np_expenses'))
  const enquiries   = useQuery(opts('np_enquiries'))
  const crew        = useQuery(opts('np_crew'))
  const assignments = useQuery(opts('np_assignments'))
  const variations  = useQuery(opts('np_variations'))
  const calEvents   = useQuery(opts('np_calendar_events'))
  const todos       = useQuery(opts('np_todos'))

  const settings = useQuery({
    queryKey: ['np_settings', 'business', uid],
    queryFn: async () => {
      const { data } = await (supabase.from('np_settings') as any)
        .select('value').eq('user_id', uid!).eq('key', 'business').maybeSingle()
      return (data?.value ?? {}) as any
    },
    enabled: !!uid,
  })

  return {
    jobs: jobs.data ?? [], invoices: invoices.data ?? [], labour: labour.data ?? [],
    materials: materials.data ?? [], expenses: expenses.data ?? [], enquiries: enquiries.data ?? [],
    crew: crew.data ?? [], assignments: assignments.data ?? [], variations: variations.data ?? [],
    calEvents: calEvents.data ?? [], todos: todos.data ?? [],
    settings: settings.data ?? {},
    loading: jobs.isLoading || invoices.isLoading,
  }
}

// V16 sbadge()
const STATUS_BADGE: Record<string, string> = {
  'Finished':    'bg-[#dcfce7] text-[#166534]',
  'In Progress': 'bg-[#dbeafe] text-[#1e40af]',
  'Scheduled':   'bg-[#ede9fe] text-[#5b21b6]',
  'Not Started': 'bg-[#f1f0e8] text-[#5f5e5a]',
  'Closed':      'bg-[#f1f0e8] text-[#5f5e5a]',
}
function SBadge({ s }: { s?: string | null }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap ${STATUS_BADGE[s || ''] || 'bg-[#f1f0e8] text-[#5f5e5a]'}`}>
      {s || '—'}
    </span>
  )
}

// V16 .metric
function Metric({ label, badge, value, valueColor, sub, borderColor, onClick }: {
  label: string; badge?: string; value: React.ReactNode; valueColor?: string
  sub?: React.ReactNode; borderColor?: string; onClick?: () => void
}) {
  return (
    <div
      onClick={onClick}
      style={borderColor ? { borderLeft: `3px solid ${borderColor}` } : undefined}
      className={`bg-[#f5f4f0] rounded-lg px-4 py-3.5 ${onClick ? 'cursor-pointer' : ''}`}
    >
      <div className="text-[11px] text-[#666] mb-1">
        {label}
        {badge && <span className="text-[9px] bg-[#e0f2fe] text-[#0369a1] rounded-[3px] px-1 py-px ml-1">{badge}</span>}
      </div>
      <div className="text-xl font-semibold" style={valueColor ? { color: valueColor } : undefined}>{value}</div>
      {sub && <div className="text-[10px] text-[#666] mt-0.5">{sub}</div>}
    </div>
  )
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`bg-white border border-black/[0.12] rounded-xl ${className}`}>{children}</div>
}

const pctW = (p: number | null) => Math.min((p ?? 0) * 100, 100).toFixed(1) + '%'
const barClr = (pct: number | null, type: 'lab' | 'mat' | 'tot') => {
  if (pct === null) return 'rgba(0,0,0,.1)'
  if (pct > 1) return 'linear-gradient(90deg,#dc2626,#f87171)'
  if (type === 'lab') return 'linear-gradient(90deg,#2563eb,#60a5fa)'
  if (type === 'mat') return 'linear-gradient(90deg,#7c3aed,#a78bfa)'
  return 'linear-gradient(90deg,#0f766e,#14b8a6)'
}

export default function Dashboard() {
  const nav = useNavigate()
  const qc = useQueryClient()
  const { user } = useAuth()
  const {
    jobs, invoices, labour, materials, expenses, enquiries, crew,
    assignments, variations, calEvents, todos, settings, loading,
  } = useAllData()
  const [newTodo, setNewTodo] = useState('')

  const addTodo = useMutation({
    mutationFn: async (text: string) => {
      const { error } = await (supabase.from('np_todos') as any).insert({
        id: genId('t'), user_id: user!.id, todo_text: text, done: false,
        priority: 'Normal', created_at: new Date().toISOString(),
      })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['np_todos'] }),
  })
  const completeTodo = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.from('np_todos') as any)
        .update({ done: true, updated_at: new Date().toISOString() }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['np_todos'] }),
  })

  const now = new Date()
  const todayStr = localStr(now)
  const yr = now.getFullYear()
  const rate0 = settings?.rates?.standard ?? 65

  // ── Finance KPIs ──────────────────────────────────────────
  const owed = invoices.reduce((a, b) => a + calcOwed(b), 0)
  const overdueInvs = invoices.filter(i => calcOwed(i) > 0 && i.due_date && i.due_date < todayStr)

  const qMonth = now.getMonth()
  const qStart = new Date(yr, Math.floor(qMonth / 3) * 3, 1)
  const qStartStr = localStr(qStart)
  const qEndStr = localStr(new Date(qStart.getFullYear(), qStart.getMonth() + 3, 0))
  const qLabel = `Q${Math.floor(qMonth / 3) + 1} ${yr}`
  const gstQ = invoices.filter(i => {
    const dp = i.date_paid || ''
    return invStatus(i) === 'Paid' && dp >= qStartStr && dp <= qEndStr
  }).reduce((a, b) => a + (b.gst || 0), 0)
  const gstQNoDate = invoices.filter(i =>
    invStatus(i) === 'Paid' && !i.date_paid && (i.date || '') >= qStartStr && (i.date || '') <= qEndStr
  ).reduce((a, b) => a + (b.gst || 0), 0)
  const gstThisQ = gstQ + gstQNoDate

  const fyStart = `${yr}-01-01`, fyEnd = `${yr}-12-31`
  const fyPaidInvs = invoices.filter(i =>
    (i.date_paid || i.date || '') >= fyStart && (i.date_paid || i.date || '') <= fyEnd && invStatus(i) === 'Paid'
  )
  const fyPaidJobIds = new Set(fyPaidInvs.map(i => i.job_id).filter(Boolean))
  const fyVarRevenue = variations
    .filter(v => v.var_status === 'Approved' && fyPaidJobIds.has(v.job_id))
    .reduce((a, b) => a + (b.amount_ex_gst || 0), 0)
  const fyRevenue = fyPaidInvs.reduce((a, b) => a + (b.agreed_ex_gst || 0), 0) + fyVarRevenue
  const fyInvoiced = invoices
    .filter(i => (i.date || '') >= fyStart && (i.date || '') <= fyEnd)
    .reduce((a, b) => a + (b.agreed_ex_gst || 0), 0)
  const fyMatCost = materials.filter(m => (m.date || '') >= fyStart && (m.date || '') <= fyEnd)
    .reduce((a, b) => a + (b.cost_ex_gst || 0), 0)
  const fyLabCost = labour.filter(l => (l.date || '') >= fyStart && (l.date || '') <= fyEnd)
    .reduce((a, b) => a + (b.cost || (b.hours || 0) * (b.rate || 0)), 0)
  const fyExpCost = expenses.filter(e => (e.date || '') >= fyStart && (e.date || '') <= fyEnd)
    .reduce((a, b) => a + (b.amount_ex_gst || 0), 0)
  const fyTotalCost = fyMatCost + fyLabCost + fyExpCost
  const fyMargin = fyRevenue > 0 ? Math.round(((fyRevenue - fyTotalCost) / fyRevenue) * 100) : 0
  const mgColor = fyMargin >= 40 ? '#16a34a' : fyMargin >= 25 ? '#d97706' : '#dc2626'

  const pipelineV = jobs.filter(j => j.quote_status === 'Sent').reduce((a, b) => a + (b.quote_ex_gst || 0), 0)
  const pipelineCount = jobs.filter(j => j.quote_status === 'Sent').length

  // ── Operations ────────────────────────────────────────────
  const jobsInProgress = jobs.filter(j => j.status === 'In Progress')
  const jobsScheduled = jobs.filter(j => j.status === 'Scheduled')
  const newEnquiries = enquiries.filter(e => e.enq_status === 'New')
  const crewTodayCount = [...new Set(assignments.filter(a => a.date === todayStr).map(a => crewLabel(crew, a.crew_name)))].length

  const in14 = new Date(now); in14.setDate(in14.getDate() + 14)
  const in14Str = localStr(in14)
  const upcomingJobs = jobs.filter(j => {
    if (!['Scheduled', 'In Progress', 'Hourly Rate Accepted', 'Not Started'].includes(j.status)) return false
    const sd = normaliseDate(j.sched_start)
    return sd && sd >= todayStr && sd <= in14Str
  }).sort((a, b) => (normaliseDate(a.sched_start) || '').localeCompare(normaliseDate(b.sched_start) || ''))

  const todayEvs = calEvents.filter(e => e.date === todayStr)

  // Quote follow-ups: sent 7+ days ago
  const followUps = jobs.filter(j => {
    if (j.quote_status !== 'Sent' || !j.quote_sent) return false
    const sent = normaliseDate(j.quote_sent)
    if (!sent) return false
    return Math.floor((now.getTime() - new Date(sent).getTime()) / 864e5) >= 7
  })

  // ── Smart alerts ──────────────────────────────────────────
  type Alert = { label: string; color: string; icon: React.ReactNode; onClick: () => void }
  const alerts: Alert[] = []
  overdueInvs.forEach(i => alerts.push({
    label: `Invoice overdue — ${i.client} (${i.id || i.job_id}) · ${fmtCurrency(calcOwed(i))} owed`,
    color: '#dc2626', icon: <AlertCircle size={13} />, onClick: () => nav('/invoices'),
  }))
  newEnquiries.slice(0, 3).forEach(e => alerts.push({
    label: `New enquiry — ${e.client || 'Unknown'}${e.source ? ' · ' + e.source : ''}`,
    color: '#d97706', icon: <UserPlus size={13} />, onClick: () => nav('/enquiries'),
  }))
  followUps.slice(0, 2).forEach(j => alerts.push({
    label: `Follow up quote — ${j.client} (${j.id}) sent ${j.quote_sent}`,
    color: '#7c3aed', icon: <Clock size={13} />, onClick: () => nav('/jobs'),
  }))
  jobs.filter(j => {
    const sd = normaliseDate(j.sched_start); if (!sd) return false
    const days = Math.ceil((new Date(sd).getTime() - now.getTime()) / 864e5)
    if (days < 0 || days > 3) return false
    if (!['Scheduled', 'Not Started'].includes(j.status)) return false
    return !assignments.some(a => a.job_id === j.id)
  }).slice(0, 2).forEach(j => alerts.push({
    label: `No crew assigned — ${j.client} starts ${j.sched_start}`,
    color: '#0369a1', icon: <Users size={13} />, onClick: () => nav('/crew'),
  }))

  // ── Monthly revenue chart (last 8 months) ─────────────────
  const chartData = []
  for (let i = 7; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const mStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const mInvs = invoices.filter(inv => (inv.date || '').startsWith(mStr))
    chartData.push({
      label: d.toLocaleDateString('en-AU', { month: 'short', year: '2-digit' }),
      invoiced: mInvs.reduce((s, inv) => s + (inv.agreed_ex_gst || 0), 0),
      received: mInvs.filter(inv => invStatus(inv) === 'Paid')
        .reduce((s, inv) => s + (inv.received || inv.agreed_ex_gst || 0), 0),
    })
  }

  const PRIO: Record<string, number> = { High: 0, Normal: 1, Low: 2 }
  const pendingTodos = todos.filter(t => !t.done)
    .sort((a, b) => (PRIO[a.priority] ?? 1) - (PRIO[b.priority] ?? 1))

  function submitTodo() {
    const v = newTodo.trim()
    if (!v) return
    addTodo.mutate(v)
    setNewTodo('')
  }

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="p-5">
      {/* Header */}
      <div className="mb-4">
        <h2 className="text-[17px] font-semibold text-gray-900 mb-0.5">Dashboard</h2>
        <div className="text-xs text-[#666]">
          {now.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </div>
      </div>

      {/* KPI row 1 — Finance */}
      <div className="grid gap-2.5 mb-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))' }}>
        <Metric
          label="Outstanding payments" borderColor="#dc2626" onClick={() => nav('/invoices')}
          value={owed > 0 ? fmtCurrency(owed) : 'All clear ✓'}
          valueColor={owed > 0 ? '#dc2626' : '#16a34a'}
          sub={overdueInvs.length ? <span className="text-[#dc2626]">{overdueInvs.length} overdue</span> : undefined}
        />
        <Metric
          label="GST this quarter" badge={qLabel} borderColor="#0369a1" onClick={() => nav('/reports')}
          value={fmtCurrency(gstThisQ)} valueColor="#0369a1"
          sub="Cash basis · click for BAS"
        />
        <Metric
          label={`Revenue received ${yr}`} borderColor="#16a34a"
          value={fmtCurrency(fyRevenue)} valueColor="#16a34a"
          sub={`Invoiced: ${fmtCurrency(fyInvoiced)}`}
        />
        <Metric
          label={`Gross margin ${yr}`} borderColor={mgColor}
          value={`${fyMargin}%`} valueColor={mgColor}
          sub="After mat. & labour costs"
        />
        <Metric
          label="Pipeline (quotes out)" borderColor="#7c3aed" onClick={() => nav('/quotes')}
          value={fmtCurrency(pipelineV)} valueColor="#7c3aed"
          sub={`${pipelineCount} quote${pipelineCount !== 1 ? 's' : ''} pending`}
        />
      </div>

      {/* KPI row 2 — Operations */}
      <div className="grid gap-2.5 mb-4" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(130px,1fr))' }}>
        <Metric
          label="In progress" value={jobsInProgress.length} valueColor="#2563eb" onClick={() => nav('/jobs')}
          sub={jobsInProgress.map(j => (j.client || '').split(' ')[0]).slice(0, 2).join(', ') + (jobsInProgress.length > 2 ? ' +more' : '')}
        />
        <Metric
          label="Scheduled" value={jobsScheduled.length} valueColor="#5b21b6" onClick={() => nav('/calendar')}
          sub="confirmed jobs"
        />
        <Metric
          label="New enquiries" value={newEnquiries.length || '—'} valueColor={newEnquiries.length ? '#d97706' : undefined}
          onClick={() => nav('/enquiries')} sub="need response"
        />
        <Metric
          label="Crew on jobs" value={crewTodayCount || '—'} valueColor="#2563eb" onClick={() => nav('/crew')}
          sub="assigned today"
        />
      </div>

      {/* Chart + Priority Tasks */}
      <div className="grid gap-3.5 mb-3.5 items-start" style={{ gridTemplateColumns: '1.5fr 1fr' }}>
        <Card className="px-4 py-3.5">
          <div className="flex justify-between items-center mb-3">
            <div className="text-[13px] font-bold text-gray-900">Monthly Revenue (ex GST)</div>
            <div className="flex gap-2.5 text-[10px] text-[#666]">
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-[#3b82f6]" />Invoiced</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-[#16a34a]" />Received</span>
            </div>
          </div>
          <div style={{ height: 190 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} barGap={2}>
                <CartesianGrid stroke="rgba(0,0,0,.06)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#666' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#666' }} axisLine={false} tickLine={false}
                  tickFormatter={v => '$' + Math.round(v / 1000) + 'k'} />
                <Tooltip
                  contentStyle={{ background: '#fff', border: '1px solid rgba(0,0,0,.12)', borderRadius: 8, fontSize: 12 }}
                  formatter={(v: any, n: any) => [`$${Math.round(v).toLocaleString()}`, n]}
                />
                <Bar dataKey="invoiced" name="Invoiced" fill="rgba(59,130,246,0.7)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="received" name="Received" fill="rgba(22,163,74,0.85)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="px-4 py-3.5">
          <div className="flex justify-between items-center mb-2.5">
            <div className="text-[13px] font-bold text-gray-900 flex items-center gap-1.5">
              <CheckSquare size={14} className="text-[#2563eb]" /> Priority Tasks
            </div>
            <button onClick={() => nav('/todos')}
              className="flex items-center gap-1 px-2.5 py-1 text-[11px] bg-blue-600 text-white rounded-lg hover:bg-blue-700">
              <ExternalLink size={11} /> All tasks
            </button>
          </div>

          {alerts.length > 0 && (
            <div className="mb-2">
              {alerts.slice(0, 4).map((a, i) => (
                <div key={i} onClick={a.onClick}
                  style={{ background: a.color + '11', borderLeft: `3px solid ${a.color}` }}
                  className="flex items-start gap-2 px-2.5 py-1.5 rounded-r-md mb-1.5 cursor-pointer">
                  <span style={{ color: a.color }} className="mt-px shrink-0">{a.icon}</span>
                  <span className="text-xs leading-snug">{a.label}</span>
                </div>
              ))}
            </div>
          )}

          {pendingTodos.length > 0 ? pendingTodos.slice(0, 5).map(t => (
            <div key={t.id} className="flex items-center gap-2 px-1 py-1.5 border-b border-black/[0.05]">
              <input type="checkbox" className="w-[15px] h-[15px] cursor-pointer shrink-0"
                onChange={() => completeTodo.mutate(t.id)} />
              <span className="flex-1 text-xs">{t.todo_text}</span>
              {t.priority === 'High' && (
                <span className="text-[9px] bg-[#fee2e2] text-[#dc2626] rounded-[3px] px-1.5 py-px font-bold">HIGH</span>
              )}
            </div>
          )) : (
            <div className="text-xs text-[#666] text-center py-2.5">
              {alerts.length ? 'No manual tasks pending' : 'No tasks or alerts — all good!'}
            </div>
          )}

          <div className="flex gap-1.5 mt-2.5">
            <input
              value={newTodo} onChange={e => setNewTodo(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submitTodo() }}
              placeholder="Add a task…"
              className="flex-1 px-2.5 py-1.5 border border-black/[0.12] rounded-md text-xs bg-[#f5f4f0] focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <button onClick={submitTodo} className="px-2.5 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700">
              <Plus size={13} />
            </button>
          </div>
        </Card>
      </div>

      {/* Next 14 Days */}
      {(upcomingJobs.length > 0 || todayEvs.length > 0) && (
        <Card className="px-4 py-3.5 mb-3.5">
          <div className="flex justify-between items-center mb-3">
            <div className="text-[13px] font-bold text-gray-900 flex items-center gap-1.5">
              <CalendarDays size={14} className="text-[#059669]" /> Next 14 Days
            </div>
            <button onClick={() => nav('/crew')}
              className="flex items-center gap-1 px-2.5 py-1 text-[11px] bg-white border border-black/20 rounded-lg hover:bg-[#f5f4f0]">
              <Users size={11} /> Crew Calendar
            </button>
          </div>

          {todayEvs.length > 0 && (
            <div className="mb-2 pb-2 border-b border-black/[0.07]">
              <div className="text-[10px] font-bold uppercase tracking-wider text-[#666] mb-1.5">Today's calendar</div>
              {todayEvs.map(e => (
                <div key={e.id} className="flex items-center gap-2 py-1 text-xs">
                  <span className="text-[#666] min-w-[38px] font-mono">{e.time || '—'}</span>
                  <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${
                    /Site|Quote/.test(e.color || '') ? 'bg-[#dbeafe] text-[#1e40af]'
                    : /Meet/.test(e.color || '') ? 'bg-[#fef3c7] text-[#92400e]'
                    : 'bg-[#f1f0e8] text-[#5f5e5a]'}`}>{e.color || ''}</span>
                  <span className="flex-1">{e.title || ''}</span>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            {upcomingJobs.map(j => {
              const sd = normaliseDate(j.sched_start)!
              const isToday = sd === todayStr
              const dateLabel = new Date(sd + 'T00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
              const jobCrew = assignments.filter(a => a.job_id === j.id && a.date >= todayStr && a.date <= in14Str)
              const crewNames = [...new Set(jobCrew.map(a => crewLabel(crew, a.crew_name)).filter(Boolean))]
              const noCrewAlert = !crewNames.length && ['Scheduled', 'Not Started'].includes(j.status)
              return (
                <div key={j.id} onClick={() => nav('/jobs')}
                  style={{ background: isToday ? '#f0fdf4' : '#f5f4f0', border: `1px solid ${isToday ? '#86efac' : 'rgba(0,0,0,.12)'}` }}
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg cursor-pointer flex-wrap">
                  <div style={{ background: isToday ? '#059669' : '#64748b' }}
                    className="text-white rounded-md px-2.5 py-1 text-[11px] font-bold whitespace-nowrap shrink-0">
                    {isToday ? 'TODAY' : dateLabel}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold">
                      {j.client} <span className="font-normal text-[#666] text-xs">· {j.id}</span>
                    </div>
                    <div className="text-[11px] text-[#666] truncate">
                      {j.address || ''}{j.est_days ? ` · ${j.est_days}d` : ''}{crewNames.length ? ` · 👷 ${crewNames.join(', ')}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <SBadge s={j.status} />
                    {noCrewAlert && (
                      <span className="text-[10px] bg-[#fee2e2] text-[#dc2626] rounded px-1.5 py-0.5 font-bold">No crew</span>
                    )}
                    <button onClick={e => { e.stopPropagation(); nav('/crew') }} title="Assign crew"
                      className="px-1.5 py-1 bg-white border border-black/20 rounded hover:bg-[#f5f4f0]">
                      <CalendarPlus size={12} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {/* In-Progress Cost Tracker */}
      {jobsInProgress.length > 0 && (
        <Card className="px-4 py-3.5 mb-3.5">
          <div className="flex justify-between items-center mb-3">
            <div className="text-[13px] font-bold text-gray-900 flex items-center gap-1.5">
              <BarChart3 size={14} className="text-[#0f766e]" /> In-Progress — Cost Tracker
            </div>
            <button onClick={() => nav('/costs')}
              className="flex items-center gap-1 px-2.5 py-1 text-[11px] bg-white border border-black/20 rounded-lg hover:bg-[#f5f4f0]">
              <ExternalLink size={11} /> Full view
            </button>
          </div>
          <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))' }}>
            {jobsInProgress.map(j => {
              const rate = j.labour_rate || rate0
              const labSpent = labour.filter(l => l.job_id === j.id).reduce((a, l) => a + (l.cost || (l.hours || 0) * (l.rate || 0)), 0)
              const matSpent = materials.filter(m => m.job_id === j.id).reduce((a, m) => a + (m.cost_ex_gst || 0), 0)
              const hrsLogged = labour.filter(l => l.job_id === j.id).reduce((a, l) => a + (l.hours || 0), 0)
              const agreed = j.agreed_ex_gst || 0
              const labBudget = j.est_labour_ex || 0
              const matBudget = j.est_materials_ex || 0
              const hasBd = labBudget > 0 || matBudget > 0
              const costBudget = hasBd ? labBudget + matBudget : agreed
              const totalSpent = labSpent + matSpent
              const estGP = agreed - totalSpent
              const estMg = agreed > 0 ? (estGP / agreed) * 100 : null
              const hrsBudgeted = labBudget > 0 ? labBudget / rate : null
              const hrsRem = hrsBudgeted !== null ? hrsBudgeted - hrsLogged : null
              const labPct = labBudget > 0 ? labSpent / labBudget : agreed > 0 ? labSpent / agreed : null
              const matPct = matBudget > 0 ? matSpent / matBudget : agreed > 0 ? matSpent / agreed : null
              const totPct = costBudget > 0 ? totalSpent / costBudget : null
              const over = totPct !== null && totPct > 1
              const near = totPct !== null && totPct >= 0.75 && !over
              const mgCol = estMg === null ? '#666' : estMg >= 30 ? '#16a34a' : estMg >= 15 ? '#d97706' : '#dc2626'
              const hrCol = hrsRem === null ? '#666' : hrsRem < 0 ? '#dc2626' : hrsRem < (hrsBudgeted || 1) * 0.25 ? '#d97706' : '#16a34a'
              const hrsLabel = hrsRem === null ? hrsLogged.toFixed(1) + 'h' : hrsRem < 0 ? hrsRem.toFixed(1) + 'h over' : '+' + hrsRem.toFixed(1) + 'h left'

              const Bar2 = ({ title, pct, type, overColor }: { title: React.ReactNode; pct: number | null; type: 'lab' | 'mat' | 'tot'; overColor: string }) => (
                <div>
                  <div className="flex justify-between text-[10px] font-semibold text-[#666] mb-1">
                    <span>{title}</span>
                    {pct !== null && (
                      <span style={{ color: pct > 1 ? '#dc2626' : pct >= 0.75 ? '#d97706' : overColor }}>
                        {(pct * 100).toFixed(0)}%
                      </span>
                    )}
                  </div>
                  <div className="h-[7px] rounded-md bg-black/[0.07] overflow-hidden">
                    <div className="h-full rounded-md" style={{ width: pctW(pct), background: barClr(pct, type) }} />
                  </div>
                </div>
              )

              return (
                <div key={j.id} onClick={() => nav('/costs')}
                  style={{
                    background: over ? '#fff1f2' : near ? '#fffbeb' : '#fff',
                    border: `1.5px solid ${over ? '#fca5a5' : near ? '#fde68a' : 'rgba(0,0,0,.12)'}`,
                  }}
                  className="rounded-xl px-3.5 py-3 cursor-pointer flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-extrabold text-[#2563eb] bg-[#dbeafe] px-1.5 py-0.5 rounded-xl">{j.id}</span>
                        {over && <span className="text-[9px] font-bold text-[#dc2626] bg-[#fee2e2] px-1.5 py-px rounded-md">Over budget</span>}
                        {near && <span className="text-[9px] font-bold text-[#d97706] bg-[#fef3c7] px-1.5 py-px rounded-md">Near limit</span>}
                      </div>
                      <div className="text-[13px] font-bold text-[#1a1a18] mt-0.5">{j.client}</div>
                      {j.address && <div className="text-[10px] text-[#666]">{j.address.split(',')[0]}</div>}
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-base font-extrabold tabular-nums" style={{ color: estGP >= 0 ? '#16a34a' : '#dc2626' }}>
                        {fmtCurrency(estGP)}
                      </div>
                      <div className="text-[9px] font-bold text-[#666] uppercase tracking-wide">Est. profit</div>
                      {estMg !== null && <div className="text-[10px] font-bold" style={{ color: mgCol }}>{estMg.toFixed(1)}% margin</div>}
                    </div>
                  </div>

                  <Bar2 type="lab" pct={labPct} overColor="#16a34a"
                    title={`Labour ${labBudget ? `(${fmtCurrency(labSpent)} / ${fmtCurrency(labBudget)})` : fmtCurrency(labSpent)}`} />
                  <Bar2 type="mat" pct={matPct} overColor="#7c3aed"
                    title={`Materials ${matBudget ? `(${fmtCurrency(matSpent)} / ${fmtCurrency(matBudget)})` : fmtCurrency(matSpent)}`} />
                  <Bar2 type="tot" pct={totPct} overColor="#0f766e"
                    title={`Total (${fmtCurrency(totalSpent)} / ${fmtCurrency(costBudget)}${!hasBd ? ' agreed' : ''})`} />

                  <div className="flex gap-3 pt-1.5 border-t border-black/[0.07] flex-wrap">
                    <div className="flex flex-col gap-px">
                      <span className="text-[13px] font-extrabold tabular-nums" style={{ color: hrCol }}>{hrsLabel}</span>
                      <span className="text-[9px] font-bold text-[#666] uppercase tracking-wide">{hrsRem === null ? 'Hrs logged' : 'Labour hrs'}</span>
                    </div>
                    <div className="flex flex-col gap-px">
                      <span className="text-[13px] font-extrabold tabular-nums text-[#1a1a18]">${rate}/hr</span>
                      <span className="text-[9px] font-bold text-[#666] uppercase tracking-wide">Rate</span>
                    </div>
                    {hrsLogged > 0 && (
                      <div className="flex flex-col gap-px">
                        <span className="text-[13px] font-extrabold tabular-nums text-[#1a1a18]">{hrsLogged.toFixed(1)}h</span>
                        <span className="text-[9px] font-bold text-[#666] uppercase tracking-wide">Logged</span>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {/* Bottom row */}
      <div className="grid grid-cols-2 gap-3.5">
        {newEnquiries.length > 0 && (
          <Card className="px-4 py-3.5">
            <div className="flex justify-between items-center mb-2.5">
              <div className="text-[13px] font-bold text-gray-900 flex items-center gap-1.5">
                <UserPlus size={14} className="text-[#d97706]" /> New Enquiries
              </div>
              <button onClick={() => nav('/enquiries')}
                className="px-2.5 py-1 text-[11px] bg-white border border-black/20 rounded-lg hover:bg-[#f5f4f0]">View all</button>
            </div>
            {newEnquiries.slice(0, 4).map(e => (
              <div key={e.id} className="py-1.5 border-b border-black/[0.06] text-xs">
                <div className="font-semibold">
                  {e.client || '—'} <span className="font-normal text-[#666]">{e.source ? '· ' + e.source : ''}</span>
                </div>
                <div className="text-[#666] text-[11px]">{e.address || ''}{e.date ? ' · ' + e.date : ''}</div>
              </div>
            ))}
          </Card>
        )}

        {followUps.length > 0 && (
          <Card className="px-4 py-3.5">
            <div className="flex justify-between items-center mb-2.5">
              <div className="text-[13px] font-bold text-gray-900 flex items-center gap-1.5">
                <Clock size={14} className="text-[#7c3aed]" /> Quotes — Follow Up
              </div>
              <button onClick={() => nav('/quotes')}
                className="px-2.5 py-1 text-[11px] bg-white border border-black/20 rounded-lg hover:bg-[#f5f4f0]">View all</button>
            </div>
            {followUps.slice(0, 4).map(j => (
              <div key={j.id} onClick={() => nav('/jobs')} className="py-1.5 border-b border-black/[0.06] text-xs cursor-pointer">
                <div className="font-semibold">{j.client} <span className="font-normal text-[#666]">· {j.id}</span></div>
                <div className="text-[#666] text-[11px]">{fmtCurrency(j.quote_ex_gst)} ex GST · sent {j.quote_sent}</div>
              </div>
            ))}
          </Card>
        )}
      </div>
    </div>
  )
}
