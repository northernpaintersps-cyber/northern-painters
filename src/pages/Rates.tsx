// What your own jobs cost, per unit.
//
// Replaces a table of ten hardcoded dollar ranges that had no quantity under
// them and so could not be quoted from.

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { selectAll } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { fmtCurrency, fmtDate } from '@/lib/utils'
import {
  buildJobRates, serviceRates, needsQuantities, MIN_SQM_SHARE,
} from '@/lib/jobRates'
import { SUBSTRATES } from '@/lib/substrates'
import { Loader2, Info, TrendingUp } from 'lucide-react'
import { Link } from 'react-router-dom'

type Row = Record<string, any>

function useTable(table: string) {
  const { user } = useAuth()
  return useQuery({
    queryKey: [table, user?.id],
    queryFn: async () => ((await selectAll(table, user!.id)).data ?? []) as Row[],
    enabled: !!user,
  })
}

const CARD = 'bg-white border border-black/[0.12] rounded-xl p-4 mb-3.5'
const CT = 'text-[13px] font-bold mb-2.5'
const TH = 'text-left px-2.5 py-[7px] border-b border-black/[0.12] text-[#666] font-medium whitespace-nowrap'

export default function Rates() {
  const { data: jobs = [], isLoading } = useTable('np_jobs')
  const { data: labour = [] } = useTable('np_labour')
  const { data: materials = [] } = useTable('np_materials')
  const { data: variations = [] } = useTable('np_variations')
  const [showAll, setShowAll] = useState(false)

  const rates = useMemo(
    () => buildJobRates({ jobs, labour, materials, variations }),
    [jobs, labour, materials, variations])
  const services = useMemo(() => serviceRates(rates), [rates])
  const missing = useMemo(() => needsQuantities(rates), [rates])
  const usable = rates.filter(r => !r.excluded)

  if (isLoading) return (
    <div className="flex items-center justify-center h-64"><Loader2 size={20} className="animate-spin text-blue-600" /></div>
  )

  return (
    <div className="p-5">
      <h1 className="text-lg font-bold text-gray-900 mb-1">Rates from your own jobs</h1>
      <div className="text-[12px] text-[#666] mb-4">
        Built from finished jobs that have both a recorded takeoff and logged costs.
        {' '}{usable.length} of {rates.length} finished jobs qualify.
      </div>

      {/* ── Per service ── */}
      <div className={CARD}>
        <div className={CT}>By service</div>
        {services.length === 0 ? (
          <div className="text-[12px] text-[#666]">
            No finished job yet has both a takeoff and logged costs. Quotes built in this tool
            record their quantities on the job, so these fill in as jobs finish — and the list
            below lets you enter the ones already done.
          </div>
        ) : (
          <div className="overflow-auto">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr>{['Service', 'Jobs', 'Cost /m²', 'Charged /m²', 'Hrs /m²', 'Margin', 'vs book rate'].map(h => (
                  <th key={h} className={TH}>{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {services.map(s => (
                  <tr key={s.type} className="border-b border-black/[0.06]">
                    <td className="px-2.5 py-[7px]">
                      {s.type}
                      {s.excludedCount > 0 && (
                        <span className="text-[10px] text-[#999] ml-1">
                          ({s.excludedCount} not counted)
                        </span>
                      )}
                    </td>
                    <td className="px-2.5 py-[7px] font-mono"
                      style={s.samples < 3 ? { color: '#b45309' } : undefined}>
                      {s.samples}
                    </td>
                    <td className="px-2.5 py-[7px] font-mono">{s.costPerSqm != null ? fmtCurrency(s.costPerSqm) : '—'}</td>
                    <td className="px-2.5 py-[7px] font-mono font-semibold">{s.pricePerSqm != null ? fmtCurrency(s.pricePerSqm) : '—'}</td>
                    <td className="px-2.5 py-[7px] font-mono">{s.hoursPerSqm != null ? s.hoursPerSqm.toFixed(3) : '—'}</td>
                    <td className="px-2.5 py-[7px] font-mono"
                      style={{ color: (s.marginPct ?? 0) < 20 ? '#c0392b' : '#0a7c4e' }}>
                      {s.marginPct != null ? `${s.marginPct.toFixed(0)}%` : '—'}
                    </td>
                    <td className="px-2.5 py-[7px] font-mono">
                      {s.calibration != null ? `${s.calibration.toFixed(2)}×` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex items-start gap-1.5 text-[11px] text-[#666] mt-2.5">
          <Info size={12} className="shrink-0 mt-px" />
          <span>
            Medians, not averages — one job with three weeks of scaffold hire would drag an
            average somewhere useless. Fewer than three jobs is an anecdote, shown in amber.
            <b> vs book rate</b> is the hours you actually took over the hours the standard
            production rates predict; it is the one figure that applies to every substrate,
            because a labour entry records hours against a job and not against a surface.
          </span>
        </div>
      </div>

      {/* ── Jobs that need their quantities entered ── */}
      {missing.length > 0 && (
        <div className={CARD} style={{ borderLeft: '4px solid #f59e0b' }}>
          <div className={CT}>{missing.length} finished jobs have no quantities</div>
          <div className="text-[11px] text-[#666] mb-2.5">
            These have costs logged but no takeoff, so they cannot produce a rate. Jobs quoted
            through the quote builder record theirs automatically; these were entered by hand or
            imported. Open the job, go to <b>Cost Tracker</b>, and add what was painted under
            Quantities — roughly right is enough to produce a useful rate.
          </div>
          <div className="overflow-auto max-h-80">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr>{['Job', 'Client', 'Type', 'Finished', 'Agreed', 'Real cost', ''].map(h => (
                  <th key={h} className={TH}>{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {missing.map(r => (
                  <tr key={r.jobId} className="border-b border-black/[0.06]">
                    <td className="px-2.5 py-[7px] font-mono text-[#2563eb]">{r.jobId}</td>
                    <td className="px-2.5 py-[7px]">{r.client}</td>
                    <td className="px-2.5 py-[7px] text-[#666]">{r.type}</td>
                    <td className="px-2.5 py-[7px] whitespace-nowrap">{fmtDate(r.date)}</td>
                    <td className="px-2.5 py-[7px] font-mono">{fmtCurrency(r.revenueExGST)}</td>
                    <td className="px-2.5 py-[7px] font-mono">{fmtCurrency(r.totalCost)}</td>
                    <td className="px-2.5 py-[7px]">
                      <Link to="/jobs" className="text-[11px] text-[#2563eb] hover:underline">Open</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Every job, so a figure can be traced ── */}
      <div className={CARD}>
        <div className="flex justify-between items-center gap-2 flex-wrap mb-2">
          <div className={`${CT} m-0`}>Job by job</div>
          <button onClick={() => setShowAll(v => !v)} className="text-[11px] text-[#2563eb]">
            {showAll ? 'Only the ones counted' : `Show all ${rates.length}`}
          </button>
        </div>
        <div className="overflow-auto max-h-[60vh]">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr>{['Job', 'Type', 'm²', 'Hours', 'Cost', 'Charged', '$/m²', 'vs book', ''].map(h => (
                <th key={h} className={TH}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {(showAll ? rates : usable).map(r => (
                <tr key={r.jobId} className="border-b border-black/[0.06]"
                  style={r.excluded ? { opacity: 0.5 } : undefined}>
                  <td className="px-2.5 py-[7px] font-mono text-[#2563eb]">{r.jobId}</td>
                  <td className="px-2.5 py-[7px] text-[#666] truncate max-w-[140px]">{r.type}</td>
                  <td className="px-2.5 py-[7px] font-mono">{r.sqm || '—'}</td>
                  <td className="px-2.5 py-[7px] font-mono">{r.hours || '—'}</td>
                  <td className="px-2.5 py-[7px] font-mono">{fmtCurrency(r.totalCost)}</td>
                  <td className="px-2.5 py-[7px] font-mono">{fmtCurrency(r.revenueExGST)}</td>
                  <td className="px-2.5 py-[7px] font-mono font-semibold">
                    {r.pricePerSqm != null ? fmtCurrency(r.pricePerSqm) : '—'}
                  </td>
                  <td className="px-2.5 py-[7px] font-mono">{r.calibration != null ? `${r.calibration}×` : '—'}</td>
                  <td className="px-2.5 py-[7px] text-[10px] text-[#92400e]">
                    {r.excluded}
                    {r.hasVariations && !r.excluded && (
                      <span title="Variations add revenue with no quantity, so the rate runs high">
                        has variations
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!usable.length && (
          <div className="text-[12px] text-[#666] mt-2">
            Nothing qualifies yet. A job needs a recorded takeoff, logged labour or materials,
            an agreed price, and at least {Math.round(MIN_SQM_SHARE * 100)}% of its work in
            area substrates.
          </div>
        )}
      </div>

      <div className="text-[11px] text-[#666] flex items-start gap-1.5">
        <TrendingUp size={12} className="shrink-0 mt-px" />
        <span>
          Two things these numbers cannot do. They are blended per job — a labour entry records
          hours against the job, not the surface, so nothing here knows what the ceilings cost
          as against the walls. And the quantities are what was quoted, never reconciled against
          what was painted, so a job with approved variations reads high and is marked.
          {' '}{SUBSTRATES.length} substrates, same keys as the quote builder.
        </span>
      </div>
    </div>
  )
}
