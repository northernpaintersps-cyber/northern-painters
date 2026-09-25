import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase, selectAll } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { fmtCurrency, invExGST } from '@/lib/utils'
import { Loader2, X } from 'lucide-react'

const JS_OPTS = ['Not Started','Scheduled','In Progress','Hourly Rate Accepted','Finished','Closed']

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

const marginColor = (m: number | null) =>
  m === null ? '#666' : m >= 30 ? '#16a34a' : m >= 15 ? '#d97706' : '#dc2626'

const R = 'px-2.5 py-[7px] text-right'

export default function Profitability() {
  const nav = useNavigate()
  const { data: jobs = [], isLoading } = useTable('np_jobs')
  const { data: invoices = [] } = useTable('np_invoices')
  const { data: labour = [] } = useTable('np_labour')
  const { data: materials = [] } = useTable('np_materials')
  const { data: variations = [] } = useTable('np_variations')

  const [q, setQ] = useState('')
  const [jobStatus, setJobStatus] = useState('')
  const [sortBy, setSortBy] = useState<'margin' | 'revenue' | 'profit'>('margin')
  const anyFilter = !!(q || jobStatus)

  const rows = useMemo(() => {
    let base = jobs
    if (q) {
      const s = q.toLowerCase()
      base = base.filter(j => `${j.client ?? ''}${j.id ?? ''}${j.address ?? ''}${j.job_desc ?? ''}`.toLowerCase().includes(s))
    }
    if (jobStatus) base = base.filter(j => j.status === jobStatus)

    const mapped = base.map(j => {
      const quoted = j.quote_ex_gst || 0
      const agreed = j.agreed_ex_gst || 0
      const vars = variations.filter(v => v.job_id === j.id && v.var_status === 'Approved')
        .reduce((s, v) => s + (v.amount_ex_gst || 0), 0)
      // invExGST falls back to deriving from total_inc_gst — summing agreed_ex_gst
      // alone counted imported invoices that never had it set as zero revenue.
      const invoicedExGST = invoices.filter(i => i.job_id === j.id).reduce((s, i) => s + invExGST(i), 0)
      const totalRevenue = (invoicedExGST || agreed) + vars
      const labourCost = labour.filter(l => l.job_id === j.id).reduce((s, l) => s + (l.cost || (l.hours || 0) * (l.rate || 0)), 0)
      const matCost = materials.filter(m => m.job_id === j.id).reduce((s, m) => s + (m.cost_ex_gst || 0), 0)
      const totalCost = labourCost + matCost
      const grossProfit = totalRevenue - totalCost
      const margin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : null
      const estLab = j.est_labour_ex || 0
      const estMat = j.est_materials_ex || 0
      return { j, quoted, agreed, vars, totalRevenue, labourCost, matCost, totalCost, grossProfit, margin, estLab, estMat }
    }).filter(r => r.agreed > 0 || r.labourCost > 0 || r.matCost > 0)

    if (sortBy === 'revenue') mapped.sort((a, b) => b.totalRevenue - a.totalRevenue)
    else if (sortBy === 'profit') mapped.sort((a, b) => b.grossProfit - a.grossProfit)
    else mapped.sort((a, b) => (a.margin ?? 999) - (b.margin ?? 999))
    return mapped
  }, [jobs, invoices, labour, materials, variations, q, jobStatus, sortBy])

  const totRevenue = rows.reduce((s, r) => s + r.totalRevenue, 0)
  const totCost = rows.reduce((s, r) => s + r.totalCost, 0)
  const totProfit = totRevenue - totCost
  const totMargin = totRevenue > 0 ? (totProfit / totRevenue) * 100 : 0
  const totVars = rows.reduce((s, r) => s + r.vars, 0)

  if (isLoading) return (
    <div className="flex items-center justify-center h-64"><Loader2 size={20} className="animate-spin text-blue-600" /></div>
  )

  return (
    <div className="p-5">
      <h2 className="text-[17px] font-semibold text-gray-900 mb-4">Job Profitability</h2>

      <div className="grid gap-2.5 mb-3.5" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))' }}>
        {[
          { l: 'Total revenue (agreed + vars)', v: fmtCurrency(totRevenue), c: '#16a34a' },
          { l: 'Total costs (labour + materials)', v: fmtCurrency(totCost) },
          { l: 'Gross profit', v: fmtCurrency(totProfit), c: totProfit >= 0 ? '#0a7c4e' : '#dc2626' },
          { l: 'Overall margin', v: `${totMargin.toFixed(1)}%`, c: marginColor(totMargin) },
          { l: 'Approved variations', v: fmtCurrency(totVars), c: '#2563eb' },
        ].map(m => (
          <div key={m.l} className="bg-[#f5f4f0] rounded-lg px-4 py-3.5">
            <div className="text-[11px] text-[#666] mb-1">{m.l}</div>
            <div className="text-xl font-semibold" style={m.c ? { color: m.c } : undefined}>{m.v}</div>
          </div>
        ))}
      </div>

      <div className="bg-white border border-black/[0.12] rounded-xl px-3.5 py-3 mb-2.5">
        <div className="flex gap-2 flex-wrap items-center">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="🔍 Search client, job ID…"
            className="flex-[2] min-w-[160px] px-2.5 py-2 text-[13px] bg-white border border-black/20 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500" />
          <select value={jobStatus} onChange={e => setJobStatus(e.target.value)}
            className="flex-1 min-w-[140px] px-2.5 py-2 text-[13px] bg-white border border-black/20 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500">
            <option value="">All job statuses</option>
            {JS_OPTS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={sortBy} onChange={e => setSortBy(e.target.value as any)}
            className="flex-1 min-w-[130px] px-2.5 py-2 text-[13px] bg-white border border-black/20 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500">
            <option value="margin">Sort: Margin ↑</option>
            <option value="revenue">Sort: Revenue ↓</option>
            <option value="profit">Sort: Profit ↓</option>
          </select>
          {anyFilter && (
            <button onClick={() => { setQ(''); setJobStatus('') }}
              className="flex items-center gap-1 px-2.5 py-2 text-[13px] bg-white border border-black/20 rounded-lg hover:bg-[#f5f4f0] text-[#c0392b]">
              <X size={13} /> Clear
            </button>
          )}
        </div>
      </div>

      <div className="bg-white border border-black/[0.12] rounded-xl overflow-hidden">
        <div className="overflow-auto max-h-[70vh]">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr>
                {[
                  { h: 'Job' }, { h: 'Client' }, { h: 'Type' },
                  { h: 'Agreed', r: true }, { h: 'Variations', r: true },
                  { h: 'Est. Labour', r: true, y: true }, { h: 'Actual Labour', r: true },
                  { h: 'Est. Materials', r: true, y: true }, { h: 'Actual Materials', r: true },
                  { h: 'Total cost', r: true }, { h: 'Gross profit', r: true }, { h: 'Margin', r: true },
                ].map((c, i) => (
                  <th key={i}
                    className={`px-2.5 py-[7px] border-b border-black/[0.12] text-[#666] font-medium whitespace-nowrap sticky top-0 z-[2] ${c.r ? 'text-right' : 'text-left'}`}
                    style={{ background: c.y ? '#fefce8' : '#fafaf8' }}>{c.h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const labOver = r.estLab > 0 && r.labourCost > r.estLab
                const matOver = r.estMat > 0 && r.matCost > r.estMat
                const labWarn = r.estLab > 0 && r.labourCost / r.estLab >= 0.9 && !labOver
                const matWarn = r.estMat > 0 && r.matCost / r.estMat >= 0.9 && !matOver
                return (
                  <tr key={r.j.id} className="border-b border-black/[0.06] hover:bg-[#fafaf8] cursor-pointer" onClick={() => nav('/jobs')}>
                    <td className="px-2.5 py-[7px] text-[#2563eb] font-medium">{r.j.id}</td>
                    <td className="px-2.5 py-[7px]">{r.j.client}</td>
                    <td className="px-2.5 py-[7px] text-[11px] text-[#666]">{r.j.type || ''}</td>
                    <td className={`${R} font-medium`}>{r.agreed ? fmtCurrency(r.agreed) : '—'}</td>
                    <td className={R} style={{ color: r.vars > 0 ? '#0a7c4e' : '#666' }}>{r.vars > 0 ? fmtCurrency(r.vars) : '—'}</td>
                    <td className={R} style={{ background: '#fefce8', color: '#666' }}>{r.estLab ? fmtCurrency(r.estLab) : '—'}</td>
                    <td className={R} style={{ color: labOver ? '#dc2626' : labWarn ? '#d97706' : undefined, fontWeight: labOver || labWarn ? 600 : 400 }}>
                      {r.labourCost ? fmtCurrency(r.labourCost) : '—'}{labOver ? '▲' : ''}
                    </td>
                    <td className={R} style={{ background: '#fefce8', color: '#666' }}>{r.estMat ? fmtCurrency(r.estMat) : '—'}</td>
                    <td className={R} style={{ color: matOver ? '#dc2626' : matWarn ? '#d97706' : undefined, fontWeight: matOver || matWarn ? 600 : 400 }}>
                      {r.matCost ? fmtCurrency(r.matCost) : '—'}{matOver ? '▲' : ''}
                    </td>
                    <td className={`${R} font-semibold`}>{r.totalCost ? fmtCurrency(r.totalCost) : '—'}</td>
                    <td className={`${R} font-bold`} style={{ color: r.grossProfit >= 0 ? '#0a7c4e' : '#dc2626' }}>
                      {r.totalRevenue ? fmtCurrency(r.grossProfit) : '—'}
                    </td>
                    <td className={R}>
                      {r.margin === null ? '—' : <span className="font-bold" style={{ color: marginColor(r.margin) }}>{r.margin.toFixed(1)}%</span>}
                    </td>
                  </tr>
                )
              })}
              {rows.length === 0 && (
                <tr><td colSpan={12} className="text-center py-6 text-[#666]">
                  No jobs with cost data yet. Log labour and materials against jobs to see profitability.
                </td></tr>
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr className="bg-[#fafaf8] font-bold">
                  <td colSpan={3} className="px-2.5 py-2 text-right">Totals</td>
                  <td className="px-2.5 py-2 text-right">{fmtCurrency(rows.reduce((s, r) => s + r.agreed, 0))}</td>
                  <td className="px-2.5 py-2 text-right text-[#0a7c4e]">{fmtCurrency(totVars)}</td>
                  <td className="px-2.5 py-2 text-right" style={{ background: '#fefce8' }}>{fmtCurrency(rows.reduce((s, r) => s + r.estLab, 0))}</td>
                  <td className="px-2.5 py-2 text-right">{fmtCurrency(rows.reduce((s, r) => s + r.labourCost, 0))}</td>
                  <td className="px-2.5 py-2 text-right" style={{ background: '#fefce8' }}>{fmtCurrency(rows.reduce((s, r) => s + r.estMat, 0))}</td>
                  <td className="px-2.5 py-2 text-right">{fmtCurrency(rows.reduce((s, r) => s + r.matCost, 0))}</td>
                  <td className="px-2.5 py-2 text-right">{fmtCurrency(totCost)}</td>
                  <td className="px-2.5 py-2 text-right" style={{ color: totProfit >= 0 ? '#0a7c4e' : '#dc2626' }}>{fmtCurrency(totProfit)}</td>
                  <td className="px-2.5 py-2 text-right" style={{ color: marginColor(totMargin) }}>{totMargin.toFixed(1)}%</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  )
}
