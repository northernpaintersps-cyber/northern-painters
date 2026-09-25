import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase, selectAll } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { fmtCurrency, fmtDate, inYear, grossMargin } from '@/lib/utils'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, Legend, AreaChart, Area,
} from 'recharts'
import { Loader2, TrendingUp, TrendingDown, Download } from 'lucide-react'

// ── Data hooks ─────────────────────────────────────────────────
function useAll() {
  const { user } = useAuth()
  const uid = user?.id

  const jobs      = useQuery<any[]>({ queryKey: ['rep_jobs', uid],      enabled: !!uid, queryFn: async () => { const { data } = await selectAll('np_jobs', uid!); return data ?? [] } })
  const invoices  = useQuery<any[]>({ queryKey: ['rep_inv', uid],       enabled: !!uid, queryFn: async () => { const { data } = await selectAll('np_invoices', uid!); return data ?? [] } })
  const labour    = useQuery<any[]>({ queryKey: ['rep_lab', uid],       enabled: !!uid, queryFn: async () => { const { data } = await selectAll('np_labour', uid!); return data ?? [] } })
  const materials = useQuery<any[]>({ queryKey: ['rep_mat', uid],       enabled: !!uid, queryFn: async () => { const { data } = await selectAll('np_materials', uid!); return data ?? [] } })
  const expenses  = useQuery<any[]>({ queryKey: ['rep_exp', uid],       enabled: !!uid, queryFn: async () => { const { data } = await selectAll('np_expenses', uid!); return data ?? [] } })
  const enquiries = useQuery<any[]>({ queryKey: ['rep_enq', uid],       enabled: !!uid, queryFn: async () => { const { data } = await selectAll('np_enquiries', uid!); return data ?? [] } })
  const assignments = useQuery<any[]>({ queryKey: ['rep_asg', uid],     enabled: !!uid, queryFn: async () => { const { data } = await selectAll('np_assignments', uid!); return data ?? [] } })
  const adsSpend  = useQuery<any[]>({ queryKey: ['rep_ads', uid],       enabled: !!uid, queryFn: async () => { const { data } = await selectAll('np_ads_spend', uid!); return data ?? [] } })

  const loading = [jobs, invoices, labour, materials, expenses, enquiries].some(q => q.isLoading)

  return {
    loading,
    jobs:        jobs.data ?? [],
    invoices:    invoices.data ?? [],
    labour:      labour.data ?? [],
    materials:   materials.data ?? [],
    expenses:    expenses.data ?? [],
    enquiries:   enquiries.data ?? [],
    assignments: assignments.data ?? [],
    adsSpend:    adsSpend.data ?? [],
  }
}

// ── Helpers ────────────────────────────────────────────────────
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function monthKey(dateStr: string | null | undefined) {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return null
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function monthLabel(key: string) {
  const [y, m] = key.split('-')
  return `${MONTH_NAMES[parseInt(m) - 1]} ${y.slice(2)}`
}

const CHART_COLORS = ['#facc15','#60a5fa','#34d399','#f87171','#a78bfa','#fb923c','#2dd4bf']

const TOOLTIP_STYLE = {
  contentStyle: { backgroundColor: '#111827', border: '1px solid #374151', borderRadius: '8px', fontSize: 12 },
  labelStyle: { color: '#9ca3af' },
}

// ── Chart card wrapper ─────────────────────────────────────────
function ChartCard({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white rounded-xl border border-gray-200 p-5 ${className}`}>
      <h3 className="text-sm font-semibold text-gray-900 mb-4">{title}</h3>
      {children}
    </div>
  )
}

// ── KPI tile ───────────────────────────────────────────────────
function KPI({ label, value, sub, trend }: { label: string; value: string; sub?: string; trend?: 'up' | 'down' | null }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className="text-xl font-bold text-gray-900 tabular-nums">{value}</p>
      {sub && (
        <p className={`text-xs mt-1 flex items-center gap-1 ${trend === 'up' ? 'text-green-400' : trend === 'down' ? 'text-red-400' : 'text-gray-500'}`}>
          {trend === 'up' && <TrendingUp size={11} />}
          {trend === 'down' && <TrendingDown size={11} />}
          {sub}
        </p>
      )}
    </div>
  )
}

// ── CSV export helpers ────────────────────────────────────────
function toCSV(rows: any[], cols: { key: string; label: string }[]): string {
  const header = cols.map(c => `"${c.label}"`).join(',')
  const body = rows.map(r => cols.map(c => {
    const v = r[c.key] ?? ''
    return typeof v === 'string' && (v.includes(',') || v.includes('"') || v.includes('\n'))
      ? `"${v.replace(/"/g, '""')}"`
      : v
  }).join(','))
  return [header, ...body].join('\n')
}

function downloadCSV(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

export default function Reports() {
  const { loading, jobs, invoices, labour, materials, expenses, enquiries, adsSpend } = useAll()

  const now = new Date()
  const years = useMemo(() => {
    const set = new Set<number>()
    set.add(now.getFullYear())
    invoices.forEach(i => { if (i.date) set.add(new Date(i.date).getFullYear()) })
    return [...set].sort((a, b) => b - a)
  }, [invoices])

  const [selYear, setSelYear] = useState(now.getFullYear())

  // ── Revenue by month ─────────────────────────────────────────
  const revenueByMonth = useMemo(() => {
    const map: Record<string, { invoiced: number; received: number }> = {}
    invoices.filter(i => i.date && new Date(i.date).getFullYear() === selYear).forEach(i => {
      const k = monthKey(i.date)!
      if (!map[k]) map[k] = { invoiced: 0, received: 0 }
      map[k].invoiced  += i.agreed_ex_gst ?? 0
      map[k].received  += i.received ?? 0
    })
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => ({ name: monthLabel(k), ...v }))
  }, [invoices, selYear])

  // ── Job status breakdown ──────────────────────────────────────
  const jobStatusData = useMemo(() => {
    const map: Record<string, number> = {}
    jobs.forEach(j => { const s = j.status || 'Unknown'; map[s] = (map[s] ?? 0) + 1 })
    return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
  }, [jobs])

  // ── Lead source breakdown ─────────────────────────────────────
  const leadSourceData = useMemo(() => {
    const map: Record<string, number> = {}
    jobs.forEach(j => { const s = j.lead_source || 'Unknown'; map[s] = (map[s] ?? 0) + 1 })
    enquiries.forEach(e => { const s = e.source || 'Unknown'; map[s] = (map[s] ?? 0) + 1 })
    return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 8)
  }, [jobs, enquiries])

  // ── Cost vs revenue by month ──────────────────────────────────
  const profitByMonth = useMemo(() => {
    const rev: Record<string, number>  = {}
    const lab: Record<string, number>  = {}
    const mat: Record<string, number>  = {}
    const exp: Record<string, number>  = {}

    invoices.filter(i => i.date && new Date(i.date).getFullYear() === selYear).forEach(i => {
      const k = monthKey(i.date)!
      rev[k] = (rev[k] ?? 0) + (i.agreed_ex_gst ?? 0)
    })
    labour.filter(l => l.date && new Date(l.date).getFullYear() === selYear).forEach(l => {
      const k = monthKey(l.date)!
      lab[k] = (lab[k] ?? 0) + (l.cost ?? (l.hours ?? 0) * (l.rate ?? 0))
    })
    materials.filter(m => m.date && new Date(m.date).getFullYear() === selYear).forEach(m => {
      const k = monthKey(m.date)!
      mat[k] = (mat[k] ?? 0) + (m.cost_ex_gst ?? 0)
    })
    expenses.filter(e => e.date && new Date(e.date).getFullYear() === selYear).forEach(e => {
      const k = monthKey(e.date)!
      exp[k] = (exp[k] ?? 0) + (e.amount_ex_gst ?? 0)
    })

    const keys = [...new Set([...Object.keys(rev), ...Object.keys(lab), ...Object.keys(mat)])].sort()
    return keys.map(k => ({
      name: monthLabel(k),
      revenue: rev[k] ?? 0,
      labour:  lab[k] ?? 0,
      materials: mat[k] ?? 0,
      expenses: exp[k] ?? 0,
      profit: (rev[k] ?? 0) - (lab[k] ?? 0) - (mat[k] ?? 0) - (exp[k] ?? 0),
    }))
  }, [invoices, labour, materials, expenses, selYear])

  // ── Margin per job (top 10) ───────────────────────────────────
  const jobMarginData = useMemo(() => {
    return jobs
      .filter(j => (j.agreed_ex_gst ?? 0) > 0 && inYear(j.sched_start, selYear))
      .map(j => {
        const labCost = labour.filter(l => l.job_id === j.id).reduce((s, l) => s + (l.cost ?? (l.hours ?? 0) * (l.rate ?? 0)), 0)
        const matCost = materials.filter(m => m.job_id === j.id).reduce((s, m) => s + (m.cost_ex_gst ?? 0), 0)
        const margin  = grossMargin(j.agreed_ex_gst ?? 0, labCost, matCost)
        return { name: `${j.id}`, client: j.client || '', revenue: j.agreed_ex_gst ?? 0, margin: parseFloat(margin.toFixed(1)) }
      })
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10)
  }, [jobs, labour, materials, selYear])

  // ── Enquiry funnel ────────────────────────────────────────────
  const funnelData = useMemo(() => {
    const stages = ['New','Contacted','Quote Sent','Booked']
    return stages.map(s => ({ name: s, value: enquiries.filter(e => e.enq_status === s).length }))
  }, [enquiries])

  // ── Top-level KPIs for selected year ─────────────────────────
  const yearInvoices = invoices.filter(i => i.date && new Date(i.date).getFullYear() === selYear)
  const totalRevenue   = yearInvoices.reduce((s, i) => s + (i.agreed_ex_gst ?? 0), 0)
  const totalReceived  = yearInvoices.reduce((s, i) => s + (i.received ?? 0), 0)
  const totalLabour    = labour.filter(l => l.date && new Date(l.date).getFullYear() === selYear).reduce((s, l) => s + (l.cost ?? (l.hours ?? 0) * (l.rate ?? 0)), 0)
  const totalMaterials = materials.filter(m => m.date && new Date(m.date).getFullYear() === selYear).reduce((s, m) => s + (m.cost_ex_gst ?? 0), 0)
  const totalExpenses  = expenses.filter(e => e.date && new Date(e.date).getFullYear() === selYear).reduce((s, e) => s + (e.amount_ex_gst ?? 0), 0)
  const netProfit      = totalRevenue - totalLabour - totalMaterials - totalExpenses
  const margin         = totalRevenue > 0 ? (netProfit / totalRevenue * 100) : 0
  const convRate       = enquiries.length ? Math.round(enquiries.filter(e => e.enq_status === 'Booked').length / enquiries.length * 100) : 0
  const avgJobValue    = yearInvoices.length ? totalRevenue / yearInvoices.length : 0

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center p-12">
        <Loader2 size={24} className="animate-spin text-blue-600" />
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-lg font-bold text-gray-900">Reports & Insights</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-gray-500">Year</span>
          <select value={selYear} onChange={e => setSelYear(Number(e.target.value))}
            className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500">
            {years.map(y => <option key={y}>{y}</option>)}
          </select>
          {/* CSV exports */}
          <div className="flex gap-1.5">
            {[
              { label: 'Invoices', fn: () => downloadCSV(toCSV(invoices.filter(i => i.date && new Date(i.date).getFullYear() === selYear), [
                { key: 'id', label: 'Invoice #' }, { key: 'date', label: 'Date' }, { key: 'client', label: 'Client' },
                { key: 'job_id', label: 'Job' }, { key: 'agreed_ex_gst', label: 'Ex GST' }, { key: 'gst', label: 'GST' },
                { key: 'total_inc_gst', label: 'Total Inc GST' }, { key: 'received', label: 'Received' }, { key: 'inv_status', label: 'Status' },
              ]), `invoices-${selYear}.csv`) },
              { label: 'Labour', fn: () => downloadCSV(toCSV(labour.filter(l => l.date && new Date(l.date).getFullYear() === selYear), [
                { key: 'date', label: 'Date' }, { key: 'job_id', label: 'Job' }, { key: 'client', label: 'Client' },
                { key: 'sub', label: 'Worker' }, { key: 'hours', label: 'Hours' }, { key: 'rate', label: 'Rate' },
                { key: 'cost', label: 'Cost' }, { key: 'billing_type', label: 'Billing' }, { key: 'paid', label: 'Paid' },
                { key: 'labour_desc', label: 'Description' },
              ]), `labour-${selYear}.csv`) },
              { label: 'Materials', fn: () => downloadCSV(toCSV(materials.filter(m => m.date && new Date(m.date).getFullYear() === selYear), [
                { key: 'date', label: 'Date' }, { key: 'job_id', label: 'Job' }, { key: 'client', label: 'Client' },
                { key: 'supplier', label: 'Supplier' }, { key: 'mat_desc', label: 'Description' }, { key: 'category', label: 'Category' },
                { key: 'cost_ex_gst', label: 'Ex GST' }, { key: 'gst', label: 'GST' }, { key: 'total_inc_gst', label: 'Total Inc GST' },
                { key: 'receipt_no', label: 'Receipt #' },
              ]), `materials-${selYear}.csv`) },
              { label: 'Expenses', fn: () => downloadCSV(toCSV(expenses.filter(e => e.date && new Date(e.date).getFullYear() === selYear), [
                { key: 'date', label: 'Date' }, { key: 'exp_desc', label: 'Description' }, { key: 'category', label: 'Category' },
                { key: 'amount_ex_gst', label: 'Ex GST' }, { key: 'gst', label: 'GST' }, { key: 'job_id', label: 'Job' },
              ]), `expenses-${selYear}.csv`) },
            ].map(({ label, fn }) => (
              <button key={label} onClick={fn} className="flex items-center gap-1 text-xs bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-600 px-2.5 py-1.5 rounded-lg transition-colors">
                <Download size={11} /> {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPI label="Revenue (ex GST)" value={fmtCurrency(totalRevenue)} sub={`${fmtCurrency(totalReceived)} received`} />
        <KPI label="Net profit" value={fmtCurrency(netProfit)} sub={`${margin.toFixed(1)}% margin`} trend={margin >= 30 ? 'up' : margin < 10 ? 'down' : null} />
        <KPI label="Avg job value" value={fmtCurrency(avgJobValue)} sub={`${yearInvoices.length} invoices`} />
        <KPI label="Enquiry conversion" value={`${convRate}%`} sub={`${enquiries.length} total enquiries`} trend={convRate >= 50 ? 'up' : convRate < 25 ? 'down' : null} />
      </div>

      {/* Revenue by month */}
      <ChartCard title={`Revenue vs received — ${selYear}`}>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={revenueByMonth} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false}
              tickFormatter={(v: unknown) => `$${((v as number) / 1000).toFixed(0)}k`} />
            <Tooltip {...TOOLTIP_STYLE} formatter={(v: unknown, n: unknown) => [fmtCurrency(v as number), n === 'invoiced' ? 'Invoiced' : 'Received']} />
            <Legend wrapperStyle={{ fontSize: 11, color: '#9ca3af' }} />
            <Bar dataKey="invoiced" name="Invoiced" fill="#facc15" radius={[3, 3, 0, 0]} />
            <Bar dataKey="received" name="Received" fill="#60a5fa" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Profit chart */}
      <ChartCard title={`Monthly profit — ${selYear}`}>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={profitByMonth} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
            <defs>
              <linearGradient id="profitGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#34d399" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#34d399" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false}
              tickFormatter={(v: unknown) => `$${((v as number) / 1000).toFixed(0)}k`} />
            <Tooltip {...TOOLTIP_STYLE} formatter={(v: unknown) => [fmtCurrency(v as number), 'Profit']} />
            <Area type="monotone" dataKey="profit" stroke="#34d399" fill="url(#profitGrad)" strokeWidth={2} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Two-col row */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* Job status pie */}
        <ChartCard title="Jobs by status">
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={jobStatusData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75} paddingAngle={2}>
                {jobStatusData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
              </Pie>
              <Tooltip {...TOOLTIP_STYLE} />
              <Legend wrapperStyle={{ fontSize: 11, color: '#9ca3af' }} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Lead source pie */}
        <ChartCard title="Lead sources">
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={leadSourceData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75} paddingAngle={2}>
                {leadSourceData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
              </Pie>
              <Tooltip {...TOOLTIP_STYLE} />
              <Legend wrapperStyle={{ fontSize: 11, color: '#9ca3af' }} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Job margins */}
      {jobMarginData.length > 0 && (
        <ChartCard title={`Job margin % — top jobs ${selYear}`}>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={jobMarginData} layout="vertical" margin={{ top: 0, right: 40, left: 10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false}
                tickFormatter={(v: unknown) => `${v}%`} domain={[0, 100]} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} width={60} />
              <Tooltip {...TOOLTIP_STYLE}
                formatter={(v: unknown, _n: unknown, p: any) => [`${v}% — ${fmtCurrency(p.payload.revenue)}`, 'Margin']} />
              <Bar dataKey="margin" radius={[0, 3, 3, 0]}>
                {jobMarginData.map((e, i) => (
                  <Cell key={i} fill={e.margin >= 40 ? '#34d399' : e.margin >= 20 ? '#facc15' : '#f87171'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      {/* Enquiry funnel */}
      <ChartCard title="Enquiry pipeline funnel">
        <div className="space-y-2">
          {funnelData.map((stage, i) => {
            const maxVal = funnelData[0]?.value || 1
            const pct = maxVal > 0 ? (stage.value / maxVal) * 100 : 0
            const colors = ['bg-blue-500', 'bg-purple-500', 'bg-amber-400', 'bg-green-500']
            return (
              <div key={stage.name} className="flex items-center gap-3">
                <span className="text-xs text-gray-500 w-20 shrink-0">{stage.name}</span>
                <div className="flex-1 h-6 bg-gray-50 rounded-full overflow-hidden">
                  <div className={`h-full ${colors[i]} rounded-full transition-all duration-500`}
                    style={{ width: `${pct}%` }} />
                </div>
                <span className="text-sm font-semibold text-gray-900 w-6 text-right">{stage.value}</span>
              </div>
            )
          })}
        </div>
      </ChartCard>

      {/* Cost breakdown */}
      <ChartCard title={`Cost breakdown — ${selYear}`}>
        <div className="grid grid-cols-3 gap-4 text-center">
          {[
            { label: 'Labour',    value: totalLabour,    color: 'text-blue-400',  bg: 'bg-blue-500' },
            { label: 'Materials', value: totalMaterials, color: 'text-amber-400', bg: 'bg-amber-400' },
            { label: 'Expenses',  value: totalExpenses,  color: 'text-red-400',   bg: 'bg-red-500' },
          ].map(({ label, value, color, bg }) => {
            const pct = totalRevenue > 0 ? ((value / totalRevenue) * 100).toFixed(1) : '—'
            return (
              <div key={label} className="space-y-1">
                <div className={`text-lg font-bold ${color}`}>{fmtCurrency(value)}</div>
                <div className="text-xs text-gray-500">{label}</div>
                <div className="text-xs text-gray-500">{pct}% of revenue</div>
                <div className="h-1.5 bg-gray-50 rounded-full overflow-hidden mt-2">
                  <div className={`h-full ${bg} rounded-full`}
                    style={{ width: totalRevenue > 0 ? `${Math.min(100, (value / totalRevenue) * 100)}%` : '0%' }} />
                </div>
              </div>
            )
          })}
        </div>
      </ChartCard>
    </div>
  )
}
