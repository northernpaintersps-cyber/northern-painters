// Read the proposed rates, then accept them or don't.
//
// Nothing here prices a quote until it has been accepted, and the accepted
// card carries the date and the job ids behind every line — so a figure can
// always be traced back to the work it came from.

import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Sparkles, Loader2, Check, X, AlertTriangle, Info, History, Pencil,
} from 'lucide-react'
import { useBusinessSettings } from '@/pages/SettingsPage'
import { analyseRates, type RateProposal } from '@/lib/ai'
import { buildRateDataset, datasetForAI, type RateDataset } from '@/lib/rateDataset'
import {
  useRateCard, useAcceptRateCard, toCard, cardSummary, type RateCard,
} from '@/lib/rateCard'
import { SUB_BY_KEY, unitLabel } from '@/lib/substrates'
import { fmtCurrency } from '@/lib/utils'

type Row = Record<string, any>

const CONF: Record<string, { bg: string; fg: string }> = {
  high: { bg: '#dcfce7', fg: '#166534' },
  medium: { bg: '#fef3c7', fg: '#92400e' },
  low: { bg: '#fee2e2', fg: '#991b1b' },
}

function Conf({ c }: { c: string }) {
  const s = CONF[c] ?? CONF.low
  return (
    <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded"
      style={{ background: s.bg, color: s.fg }}>{c}</span>
  )
}

export default function RateCardPanel({ jobs, labour, materials, variations }: {
  jobs: Row[]; labour: Row[]; materials: Row[]; variations: Row[]
}) {
  const { data: biz } = useBusinessSettings()
  const apiKey = biz?.ai_api_key?.trim() ?? ''
  const { data: store } = useRateCard()
  const accept = useAcceptRateCard()

  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [proposal, setProposal] = useState<RateProposal | null>(null)
  const [edits, setEdits] = useState<Record<string, number>>({})
  const [showHistory, setShowHistory] = useState(false)
  const [dataset, setDataset] = useState<RateDataset | null>(null)

  const current = store?.current ?? null

  async function run() {
    if (!apiKey) { setErr('Add your Anthropic API key in Settings first.'); return }
    setErr(''); setBusy(true); setProposal(null); setEdits({})
    try {
      const d = buildRateDataset({ jobs, labour, materials, variations })
      setDataset(d)
      if (!d.jobs.length) {
        setErr('No finished jobs yet, so there is nothing to read.')
        return
      }
      setProposal(await analyseRates(apiKey, datasetForAI(d)))
    } catch (e: any) {
      setErr(e?.message ?? 'Could not work out the rates.')
    } finally { setBusy(false) }
  }

  function acceptProposal() {
    if (!proposal) return
    const edited = Object.keys(edits).length > 0
    const card = toCard({
      ...proposal,
      substrates: proposal.substrates.map(s =>
        edits[s.key] != null ? { ...s, hoursPerUnit: edits[s.key] } : s),
    }, edited)
    accept.mutate(card, { onSuccess: () => { setProposal(null); setEdits({}) } })
  }

  const coverage = dataset?.coverage

  return (
    <div className="bg-white border border-black/[0.12] rounded-xl p-4 mb-3.5">
      <div className="flex items-start justify-between gap-2 flex-wrap mb-2">
        <div>
          <div className="text-[13px] font-bold">Rate card</div>
          <div className="text-[11px] text-[#666]">
            {current
              ? cardSummary(current)
              : 'Nothing accepted yet, so quotes use the standard production rates.'}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!!store?.history.length && (
            <button onClick={() => setShowHistory(v => !v)}
              className="flex items-center gap-1 text-[11px] text-[#666] hover:text-[#1a1a18]">
              <History size={12} /> {store.history.length} older
            </button>
          )}
          <button onClick={run} disabled={busy}
            className="flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50">
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
            {busy ? 'Reading your jobs…' : current ? 'Work them out again' : 'Work out my rates'}
          </button>
        </div>
      </div>

      {err && (
        <div className="text-[11px] text-[#991b1b] bg-[#fee2e2] border border-[#fca5a5] rounded px-2 py-1.5 mb-2">
          {err}
        </div>
      )}

      {/* What the analysis had to work with. Worth seeing before the figures. */}
      {coverage && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[#666] mb-2 px-2.5 py-2 bg-[#f5f4f0] rounded-lg">
          <span>{coverage.finishedJobs} finished</span>
          <span>{coverage.withTakeoff} with quantities</span>
          <span>{coverage.withActualTakeoff} with what was <b>actually</b> painted</span>
          <span>{coverage.withLoggedHours} with hours</span>
          <span style={coverage.withAnyPhaseTag === 0 ? { color: '#92400e' } : undefined}>
            {coverage.withAnyPhaseTag} with phase-tagged hours
          </span>
        </div>
      )}

      {coverage?.withAnyPhaseTag === 0 && proposal && (
        <div className="flex items-start gap-1.5 text-[11px] text-[#92400e] bg-[#fffbeb] border border-[#fbbf24] rounded px-2 py-1.5 mb-2">
          <Info size={12} className="shrink-0 mt-px" />
          <span>
            No job has phase-tagged hours yet, so there is nothing to build a per-surface rate
            from and the substrate list below should be empty. Tag the phase on labour entries
            from now on and this fills in. <Link to="/labour" className="underline">Labour</Link>
          </span>
        </div>
      )}

      {/* ── The proposal ── */}
      {proposal && (
        <div className="border-2 border-blue-300 rounded-xl p-3 mb-2">
          <div className="text-[12px] font-bold mb-2">
            Proposed — nothing is used until you accept it
          </div>

          {proposal.services.length > 0 ? (
            <table className="w-full border-collapse text-[12px] mb-2.5">
              <thead>
                <tr>{['Service', 'Cost /m²', 'Charged /m²', 'Hrs /m²', 'Margin', 'Jobs', ''].map(h => (
                  <th key={h} className="text-left px-2 py-1 border-b border-black/[0.12] text-[#666] font-medium whitespace-nowrap">{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {proposal.services.map(s => (
                  <tr key={s.service} className="border-b border-black/[0.06]">
                    <td className="px-2 py-1">{s.service}</td>
                    <td className="px-2 py-1 font-mono">{s.costPerSqm != null ? fmtCurrency(s.costPerSqm) : '—'}</td>
                    <td className="px-2 py-1 font-mono">{s.pricePerSqm != null ? fmtCurrency(s.pricePerSqm) : '—'}</td>
                    <td className="px-2 py-1 font-mono">{s.hoursPerSqm != null ? s.hoursPerSqm.toFixed(3) : '—'}</td>
                    <td className="px-2 py-1 font-mono">{s.marginPct != null ? `${s.marginPct.toFixed(0)}%` : '—'}</td>
                    <td className="px-2 py-1 text-[10px] text-[#666]" title={s.jobs.join(', ')}>
                      {s.jobs.length}
                    </td>
                    <td className="px-2 py-1"><Conf c={s.confidence} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="text-[11px] text-[#666] mb-2.5">
              Not enough behind any single service to put a rate on it yet.
            </div>
          )}

          {proposal.services.some(s => s.basis) && (
            <div className="flex flex-col gap-0.5 mb-2.5">
              {proposal.services.filter(s => s.basis).map(s => (
                <div key={s.service} className="text-[10.5px] text-[#666]">
                  <b>{s.service}:</b> {s.basis}
                </div>
              ))}
            </div>
          )}

          {proposal.substrates.length > 0 && (
            <>
              <div className="text-[11px] font-bold mb-1">
                Per surface — these are what a quote would price from
              </div>
              <table className="w-full border-collapse text-[12px] mb-2.5">
                <thead>
                  <tr>{['Substrate', 'Service', 'Hrs per unit', 'Jobs', ''].map(h => (
                    <th key={h} className="text-left px-2 py-1 border-b border-black/[0.12] text-[#666] font-medium">{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {proposal.substrates.map(s => (
                    <tr key={`${s.key}:${s.service ?? ''}`} className="border-b border-black/[0.06]">
                      <td className="px-2 py-1">
                        {SUB_BY_KEY[s.key]?.label ?? s.key}
                        <span className="text-[#999]"> /{unitLabel(SUB_BY_KEY[s.key]?.unit ?? 'sqm')}</span>
                      </td>
                      <td className="px-2 py-1 text-[#666]">{s.service ?? 'any'}</td>
                      <td className="px-2 py-1">
                        <input type="number" step="0.001" min={0}
                          value={edits[s.key] ?? s.hoursPerUnit}
                          onChange={e => setEdits(p => ({ ...p, [s.key]: parseFloat(e.target.value) || 0 }))}
                          className="w-20 px-1 py-0.5 border border-black/15 rounded text-right font-mono text-[11.5px]" />
                        {edits[s.key] != null && edits[s.key] !== s.hoursPerUnit && (
                          <Pencil size={9} className="inline ml-1 text-[#2563eb]" />
                        )}
                      </td>
                      <td className="px-2 py-1 text-[10px] text-[#666]" title={s.jobs.join(', ')}>{s.jobs.length}</td>
                      <td className="px-2 py-1"><Conf c={s.confidence} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {proposal.cannotDetermine.length > 0 && (
            <div className="mb-2.5">
              <div className="text-[11px] font-bold mb-1">What it could not work out</div>
              {proposal.cannotDetermine.map((c, i) => (
                <div key={i} className="flex items-start gap-1.5 text-[11px] text-[#666] mb-0.5">
                  <AlertTriangle size={11} className="shrink-0 mt-px text-[#d97706]" />
                  <span><b>{c.what}</b> — {c.why}</span>
                </div>
              ))}
            </div>
          )}

          {proposal.notes && (
            <div className="text-[11px] text-[#666] mb-2.5 italic">{proposal.notes}</div>
          )}

          <div className="flex gap-2">
            <button onClick={acceptProposal} disabled={accept.isPending}
              className="flex items-center gap-1.5 text-[12.5px] font-semibold px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50">
              {accept.isPending ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
              Accept{Object.keys(edits).length ? ' with my edits' : ''}
            </button>
            <button onClick={() => { setProposal(null); setEdits({}) }}
              className="flex items-center gap-1.5 text-[12.5px] px-3 py-1.5 rounded-lg bg-white border border-black/[0.15] hover:bg-[#f5f4f0]">
              <X size={13} /> Discard
            </button>
          </div>
        </div>
      )}

      {/* ── What is accepted ── */}
      {current && !proposal && (
        <div className="text-[11px]">
          {current.substrates.length > 0 ? (
            <div className="flex flex-wrap gap-1 mb-1.5">
              {current.substrates.map(s => (
                <span key={`${s.key}:${s.service ?? ''}`}
                  className="px-1.5 py-0.5 rounded bg-[#eef5ff] text-[#1e40af]"
                  title={s.basis}>
                  {SUB_BY_KEY[s.key]?.label ?? s.key} <b>{s.hoursPerUnit}</b> hrs/
                  {unitLabel(SUB_BY_KEY[s.key]?.unit ?? 'sqm')}
                </span>
              ))}
            </div>
          ) : (
            <div className="text-[#666] mb-1.5">
              The accepted card carries no per-surface rates, so quotes still use the standard
              ones. That is expected until phase-tagged hours build up.
            </div>
          )}
          {current.cannotDetermine.length > 0 && (
            <div className="text-[#666]">
              Still unanswerable: {current.cannotDetermine.map(c => c.what).join('; ')}.
            </div>
          )}
          <button onClick={() => accept.mutate(null)}
            className="text-[11px] text-[#c0392b] hover:underline mt-1">
            Stop using this card
          </button>
        </div>
      )}

      {showHistory && !!store?.history.length && (
        <div className="mt-2 pt-2 border-t border-black/[0.08]">
          {store.history.map((c: RateCard, i) => (
            <div key={i} className="text-[11px] text-[#666] py-0.5">
              Accepted {c.acceptedAt} · {c.substrates.length} surface rates
              {c.edited && ' · edited'}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
