import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { StatCard } from '@/components/ui/StatCard'
import { Badge } from '@/components/ui/Badge'
import { fmtCurrency, fmtDate, calcOwed, invStatus, grossMargin, inYear, today } from '@/lib/utils'
import { DollarSign, Briefcase, AlertCircle, TrendingUp, Users, Phone, Clock, MapPin } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid
} from 'recharts'

function useAllData() {
  const { user } = useAuth()
  const uid = user?.id
  const opts = (table: string) => ({
    queryKey: [table, uid],
    queryFn: async () => {
      const { data, error } = await supabase.from(table as any).select('*').eq('user_id', uid!)
      if (error) throw error
      return data ?? []
    },
    enabled: !!uid,
  })
  const jobs      = useQuery(opts('np_jobs'))
  const invoices  = useQuery(opts('np_invoices'))
  const labour    = useQuery(opts('np_labour'))
  const materials = useQuery(opts('np_materials'))
  const expenses  = useQuery(opts('np_expenses'))
  const enquiries = useQuery(opts('np_enquiries'))
  const crew      = useQuery(opts('np_crew'))
  const assignments = useQuery(opts('np_assignments'))

  return {
    jobs: (jobs.data ?? []) as any[],
    invoices: (invoices.data ?? []) as any[],
    labour: (labour.data ?? []) as any[],
    materials: (materials.data ?? []) as any[],
    expenses: (expenses.data ?? []) as any[],
    enquiries: (enquiries.data ?? []) as any[],
    crew: (crew.data ?? []) as any[],
    assignments: (assignments.data ?? []) as any[],
    loading: jobs.isLoading || invoices.isLoading,
  }
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function getMonthlyData(invoices: any[]) {
  const now = new Date()
  const result = []
  for (let i = 7; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const yr = d.getFullYear(), mo = d.getMonth()
    const label = MONTHS[mo]
    const invs = invoices.filter(inv => {
      const pd = inv.date_paid || inv.date
      if (!pd) return false
      const dt = new Date(pd)
      return dt.getFullYear() === yr && dt.getMonth() === mo
    })
    const invoiced = invs.reduce((s: number, inv: any) => s + (inv.agreed_ex_gst ?? 0), 0)
    const received = invs.filter((inv: any) => invStatus(inv) === 'Paid')
                        .reduce((s: number, inv: any) => s + (inv.agreed_ex_gst ?? 0), 0)
    result.push({ label, invoiced, received })
  }
  return result
}

export default function Dashboard() {
  const { jobs, invoices, labour, materials, expenses, enquiries, assignments, loading } = useAllData()
  const thisYear = new Date().getFullYear()
  const todayStr = today()

  // Finance KPIs
  const outstanding = invoices.reduce((s: number, inv: any) => s + calcOwed(inv), 0)
  const overdue = invoices.filter((inv: any) => calcOwed(inv) > 0 && inv.due_date && inv.due_date < todayStr).length
  const gstQ = (() => {
    const now = new Date(); const q = Math.floor(now.getMonth() / 3) + 1; const yr = now.getFullYear()
    return invoices
      .filter((inv: any) => invStatus(inv) === 'Paid' && inYear(inv.date_paid || inv.date, yr))
      .filter((inv: any) => { const d = new Date(inv.date_paid || inv.date); return Math.floor(d.getMonth() / 3) + 1 === q })
      .reduce((s: number, inv: any) => s + (inv.gst ?? 0), 0)
  })()
  const revenueYear = invoices
    .filter((inv: any) => invStatus(inv) === 'Paid' && inYear(inv.date_paid || inv.date, thisYear))
    .reduce((s: number, inv: any) => s + (inv.agreed_ex_gst ?? 0), 0)
  const labCostYear = labour.filter((l: any) => inYear(l.date, thisYear)).reduce((s: number, l: any) => s + (l.cost != null ? l.cost : (l.hours * l.rate) || 0), 0)
  const matCostYear = materials.filter((m: any) => inYear(m.date, thisYear)).reduce((s: number, m: any) => s + (m.cost_ex_gst ?? 0), 0)
  const expCostYear = expenses.filter((e: any) => inYear(e.date, thisYear)).reduce((s: number, e: any) => s + (e.amount_ex_gst ?? 0), 0)
  const gm = grossMargin(revenueYear, labCostYear + expCostYear, matCostYear)
  const pipeline = jobs.filter((j: any) => j.quote_status === 'Sent').reduce((s: number, j: any) => s + (j.quote_ex_gst ?? 0), 0)

  // Operations KPIs
  const inProgress = jobs.filter((j: any) => j.status === 'In Progress').length
  const scheduled = jobs.filter((j: any) => j.status === 'Scheduled').length
  const newEnquiries = enquiries.filter((e: any) => e.enq_status === 'New').length
  const crewToday = [...new Set(assignments.filter((a: any) => a.date === todayStr).map((a: any) => a.crew_name))].length

  // Alerts
  const alerts: { type: 'warning' | 'info'; msg: string }[] = []
  if (overdue > 0) alerts.push({ type: 'warning', msg: `${overdue} overdue invoice${overdue > 1 ? 's' : ''}` })
  if (newEnquiries > 0) alerts.push({ type: 'info', msg: `${newEnquiries} new enquir${newEnquiries > 1 ? 'ies' : 'y'}` })
  const sentOld = jobs.filter((j: any) => {
    if (j.quote_status !== 'Sent' || !j.quote_sent) return false
    return (Date.now() - new Date(j.quote_sent).getTime()) > 7 * 86400000
  })
  if (sentOld.length) alerts.push({ type: 'warning', msg: `${sentOld.length} quote${sentOld.length > 1 ? 's' : ''} sent 7+ days ago — follow up` })

  // Today's schedule
  const todayJobs = jobs.filter((j: any) => {
    const dates = Array.isArray(j.scheduled_dates) ? j.scheduled_dates : []
    return dates.includes(todayStr) || j.status === 'In Progress'
  }).slice(0, 6)
  const todayAssignments = assignments.filter((a: any) => a.date === todayStr)
  const todayCrewNames = [...new Set(todayAssignments.map((a: any) => a.crew_name))]

  // In-progress cost cards
  const ipJobs = jobs.filter((j: any) => j.status === 'In Progress').slice(0, 4)

  const monthlyData = getMonthlyData(invoices)

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="w-6 h-6 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      <div>
        <h1 className="text-xl font-bold text-white">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-0.5">{new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
      </div>

      {/* Alerts */}
      {alerts.length > 0 && (
        <div className="space-y-2">
          {alerts.map((a, i) => (
            <div key={i} className={`flex items-center gap-2.5 px-4 py-2.5 rounded-lg text-sm ${a.type === 'warning' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'}`}>
              <AlertCircle size={14} />
              {a.msg}
            </div>
          ))}
        </div>
      )}

      {/* Finance KPIs */}
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Finance</p>
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
          <StatCard label="Outstanding" value={fmtCurrency(outstanding)} icon={DollarSign} color={outstanding > 0 ? 'amber' : 'green'} />
          <StatCard label="Overdue invoices" value={overdue} icon={AlertCircle} color={overdue > 0 ? 'red' : 'green'} />
          <StatCard label="GST this quarter" value={fmtCurrency(gstQ)} icon={DollarSign} />
          <StatCard label={`Revenue ${thisYear}`} value={fmtCurrency(revenueYear)} icon={TrendingUp} color="green" />
          <StatCard label="Gross margin" value={`${gm.toFixed(1)}%`} icon={TrendingUp} color={gm >= 30 ? 'green' : gm >= 15 ? 'amber' : 'red'} />
          <StatCard label="Pipeline" value={fmtCurrency(pipeline)} icon={DollarSign} color="blue" />
        </div>
      </div>

      {/* Operations KPIs */}
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Operations</p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="In progress" value={inProgress} icon={Briefcase} color="green" />
          <StatCard label="Scheduled" value={scheduled} icon={Clock} color="blue" />
          <StatCard label="New enquiries" value={newEnquiries} icon={Phone} color={newEnquiries > 0 ? 'amber' : 'gray'} />
          <StatCard label="Crew on site today" value={crewToday} icon={Users} />
        </div>
      </div>

      {/* Today's schedule */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <MapPin size={14} className="text-yellow-400" />
          <p className="text-sm font-semibold text-white">Today's schedule</p>
          <span className="text-xs text-gray-500 ml-1">{new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'short' })}</span>
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          {/* Jobs on today */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Jobs on site</p>
            {todayJobs.length === 0
              ? <p className="text-sm text-gray-500">No jobs scheduled for today</p>
              : (
                <div className="space-y-2">
                  {todayJobs.map((j: any) => (
                    <div key={j.id} className="flex items-start gap-2 bg-gray-800/60 rounded-lg px-3 py-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white truncate">{j.client || '—'}</p>
                        <p className="text-xs text-gray-400 truncate">{j.address || ''}</p>
                      </div>
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium shrink-0 ${
                        j.status === 'In Progress' ? 'bg-green-500/20 text-green-400' :
                        j.status === 'Scheduled' ? 'bg-blue-500/20 text-blue-400' : 'bg-gray-700 text-gray-400'
                      }`}>{j.status}</span>
                    </div>
                  ))}
                </div>
              )
            }
          </div>
          {/* Crew today */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Crew assigned today</p>
            {todayCrewNames.length === 0
              ? <p className="text-sm text-gray-500">No crew assigned for today</p>
              : (
                <div className="space-y-2">
                  {todayCrewNames.map((name: any) => {
                    const myAssignments = todayAssignments.filter((a: any) => a.crew_name === name)
                    return (
                      <div key={String(name)} className="flex items-start gap-2 bg-gray-800/60 rounded-lg px-3 py-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-white">{name}</p>
                          <p className="text-xs text-gray-400 truncate">
                            {myAssignments.map((a: any) => a.job_id || a.job_desc || '').filter(Boolean).join(', ') || 'Assigned'}
                          </p>
                        </div>
                        <span className="text-xs bg-purple-500/20 text-purple-400 px-1.5 py-0.5 rounded font-medium shrink-0">
                          {myAssignments[0]?.time_slot || 'Full day'}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )
            }
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Revenue chart */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <p className="text-sm font-semibold text-white mb-4">Revenue — last 8 months</p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={monthlyData} barGap={2}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} />
              <Tooltip
                contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8 }}
                labelStyle={{ color: '#f9fafb', fontSize: 12 }}
                formatter={(v: unknown) => [fmtCurrency(v as number), '']}
              />
              <Bar dataKey="invoiced" name="Invoiced" fill="#3b82f6" radius={[3,3,0,0]} />
              <Bar dataKey="received" name="Received" fill="#22c55e" radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
          <div className="flex gap-4 mt-2">
            <div className="flex items-center gap-1.5 text-xs text-gray-400"><div className="w-2.5 h-2.5 rounded-sm bg-blue-500" />Invoiced</div>
            <div className="flex items-center gap-1.5 text-xs text-gray-400"><div className="w-2.5 h-2.5 rounded-sm bg-green-500" />Received</div>
          </div>
        </div>

        {/* In-progress jobs */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <p className="text-sm font-semibold text-white mb-4">In-progress cost tracker</p>
          {ipJobs.length === 0 && <p className="text-sm text-gray-500">No jobs in progress</p>}
          <div className="space-y-4">
            {ipJobs.map((j: any) => {
              const jLab = labour.filter((l: any) => l.job_id === j.id).reduce((s: number, l: any) => s + (l.cost != null ? l.cost : (l.hours * l.rate) || 0), 0)
              const jMat = materials.filter((m: any) => m.job_id === j.id).reduce((s: number, m: any) => s + (m.cost_ex_gst ?? 0), 0)
              const total = jLab + jMat
              const agreed = j.agreed_ex_gst ?? 0
              const budget = (j.est_labour_ex ?? 0) + (j.est_materials_ex ?? 0)
              const pct = budget > 0 ? Math.min((total / budget) * 100, 100) : 0
              const profit = agreed - total
              const margin = agreed > 0 ? (profit / agreed) * 100 : 0
              return (
                <div key={j.id}>
                  <div className="flex justify-between items-baseline mb-1">
                    <span className="text-sm font-medium text-white truncate">{j.client} <span className="text-gray-500 font-mono text-xs">{j.id}</span></span>
                    <span className={`text-xs font-semibold ${margin >= 20 ? 'text-green-400' : margin >= 10 ? 'text-amber-400' : 'text-red-400'}`}>{margin.toFixed(0)}% margin</span>
                  </div>
                  <div className="flex justify-between text-xs text-gray-500 mb-1.5">
                    <span>{fmtCurrency(total)} spent of {fmtCurrency(budget)} budget</span>
                    <span>Est. profit {fmtCurrency(profit)}</span>
                  </div>
                  <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${pct >= 100 ? 'bg-red-500' : pct >= 75 ? 'bg-amber-500' : 'bg-green-500'}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Recent activity */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <p className="text-sm font-semibold text-white mb-4">Quotes sent — awaiting response</p>
        {sentOld.length === 0 && jobs.filter((j: any) => j.quote_status === 'Sent').length === 0
          ? <p className="text-sm text-gray-500">No quotes pending</p>
          : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-500 border-b border-gray-800">
                    <th className="text-left pb-2 font-medium">Client</th>
                    <th className="text-left pb-2 font-medium">Job</th>
                    <th className="text-left pb-2 font-medium">Value</th>
                    <th className="text-left pb-2 font-medium">Sent</th>
                    <th className="text-left pb-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {jobs.filter((j: any) => j.quote_status === 'Sent').slice(0, 8).map((j: any) => (
                    <tr key={j.id}>
                      <td className="py-2 text-white">{j.client}</td>
                      <td className="py-2 text-gray-400 font-mono text-xs">{j.id}</td>
                      <td className="py-2 text-white tabular-nums">{fmtCurrency(j.quote_ex_gst)}</td>
                      <td className="py-2 text-gray-400">{fmtDate(j.quote_sent)}</td>
                      <td className="py-2"><Badge label={j.quote_status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </div>
    </div>
  )
}
