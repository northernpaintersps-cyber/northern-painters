// Paste a message, check what it found, log it.
//
// Nothing is written until the last tap. Everything between the paste and
// that tap exists to make a wrong row obvious: the line each entry came
// from, the job it matched or the two it could not choose between, the
// errors buildLabour raises, and a flag on anything that looks like the same
// message pasted twice.
//
// The format parser runs first and costs nothing. The AI is offered for what
// is left over rather than called automatically, so a tidy message never
// spends anything.

import { useState, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Modal } from '@/components/ui/Modal'
import { useAuth } from '@/lib/auth'
import { fmtCurrency, today, jobBillingType, findCrew, BILLING_TYPES } from '@/lib/utils'
import { buildLabour, applyChange, emptyContext } from '@/lib/writes'
import {
  parseHoursMessage, draftsFromAI, findDuplicateEntry, FORMAT_HINT,
  type DraftEntry,
} from '@/lib/readHours'
import { readHoursMessage } from '@/lib/ai'
import { jobPhases, findPhaseByName } from '@/lib/phases'
import { Loader2, Sparkles, Trash2, Copy, Check, AlertTriangle } from 'lucide-react'

type Row = Record<string, any>

const INL = 'w-full px-1.5 py-1 bg-transparent border border-transparent hover:border-black/10 focus:border-blue-500 rounded outline-none text-[12px]'

export default function ReadHoursModal({
  open, onClose, jobs, crew, labour, biz, apiKey,
}: {
  open: boolean
  onClose: () => void
  jobs: Row[]
  crew: Row[]
  labour: Row[]
  biz: Row | undefined
  apiKey?: string
}) {
  const { user } = useAuth()
  const qc = useQueryClient()

  const [text, setText] = useState('')
  const [drafts, setDrafts] = useState<DraftEntry[]>([])
  const [dropped, setDropped] = useState<Set<string>>(new Set())
  const [unparsed, setUnparsed] = useState<string[]>([])
  const [readYet, setReadYet] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState(false)

  const todayStr = today()
  const ctx = useMemo(
    () => ({ jobs, crew, todayStr, labour }),
    [jobs, crew, todayStr, labour])

  function reset() {
    setText(''); setDrafts([]); setDropped(new Set()); setUnparsed([])
    setReadYet(false); setErr(''); setCopied(false)
  }

  function read() {
    setErr('')
    const got = parseHoursMessage(text, ctx)
    setDrafts(got.entries)
    setUnparsed(got.unparsed)
    setDropped(new Set())
    setReadYet(true)
  }

  /**
   * Ask the AI to read the message.
   *
   * `all` throws away what the plain parser found and takes the AI's reading
   * of the whole thing instead — for when the format was close enough to
   * parse but the jobs came out wrong, which no amount of re-reading the
   * leftovers would fix.
   */
  async function readWithAI(all = false) {
    if (!apiKey) { setErr('No AI API key set. Add your Anthropic key in Settings.'); return }
    setAiBusy(true); setErr('')
    try {
      // The whole message, with the lines already read listed separately.
      // Sending only the leftovers stripped the worker heading off the top,
      // so the AI could not tell whose hours it was reading — which is most
      // of what made it inaccurate.
      const got = await readHoursMessage(apiKey, text, {
        crew: crew.map(c => String(c.name ?? '')).filter(Boolean),
        jobs: jobs.map(j => ({
          id: String(j.id), client: j.client, address: j.address, status: j.status,
        })),
        todayStr,
        alreadyRead: all ? [] : drafts.filter(d => d.via === 'format').map(d => d.source),
      })
      const more = draftsFromAI(got.entries, ctx)
      setDrafts(d => all ? more : [...d, ...more])
      setDropped(new Set())
      setUnparsed(got.unreadable)
    } catch (e: any) {
      setErr(e?.message ?? 'The AI could not read it.')
    } finally { setAiBusy(false) }
  }

  const patch = (key: string, p: Partial<DraftEntry>) =>
    setDrafts(d => d.map(e => e.key === key ? { ...e, ...p } : e))

  const writeCtx = useMemo(
    () => ({ ...emptyContext(), jobs, crew, biz: biz ?? {} }),
    [jobs, crew, biz])

  /**
   * What a row's billing type, charge rate and payment type default to.
   *
   * The job's terms and the worker's own arrangement — the same places the
   * Labour form takes them from. Recomputed as the row's job or worker
   * changes, so correcting the job corrects these too, unless they have
   * been set by hand on that row.
   */
  function defaultsFor(d: DraftEntry) {
    const job = jobs.find(j => j.id === d.job_id)
    const member = findCrew(crew, d.worker)
    return {
      billing_type: jobBillingType(job),
      charge_rate: Number(member?.charge_rate) || Number(member?.rate) || 0,
      worker_payment_type: String(member?.payment_type ?? 'ABN') === 'Cash' ? 'Cash' : 'ABN',
    }
  }

  /** Each draft as the row it would write, with its own checks run. */
  const rows = useMemo(() => drafts.map(d => {
    // The note becomes a phase tag only when it actually names one of the
    // job's quoted phases. buildLabour keeps an unmatched phase name as
    // typed, which is right when a person typed it and wrong here — it would
    // file "dropped the ladder off" as a phase of the work.
    const job = jobs.find(j => j.id === d.job_id)
    const phase = d.description ? findPhaseByName(jobPhases(job), d.description) : null
    const fallback = defaultsFor(d)
    const change = buildLabour(writeCtx as any, {
      worker: d.worker, hours: d.hours, date: d.date, job_id: d.job_id,
      description: d.description, phase: phase?.name,
      charge_rate: d.charge_rate ?? (fallback.charge_rate || undefined),
      billing_type: d.billing_type ?? fallback.billing_type,
      worker_payment_type: d.worker_payment_type ?? fallback.worker_payment_type,
    })
    return { draft: d, change, duplicate: findDuplicateEntry(d, labour) }
  }), [drafts, writeCtx, labour, jobs])

  const live = rows.filter(r => !dropped.has(r.draft.key))
  const badCount = live.filter(r => r.change.errors.length).length
  const totalHours = live.reduce((s, r) => s + (r.draft.hours || 0), 0)
  const totalCost = live.reduce((s, r) => s + (Number(r.change.row.cost) || 0), 0)
  const totalBillable = live.reduce((s, r) => s + (Number(r.change.row.billable) || 0), 0)
  const cashRows = live.filter(r => String(r.change.row.worker_payment_type) === 'Cash').length

  async function logAll() {
    if (!user) return
    setSaving(true); setErr('')
    try {
      for (const r of live) {
        if (r.change.errors.length) continue
        await applyChange(r.change, user.id, qc)
      }
      reset()
      onClose()
    } catch (e: any) {
      setErr(e?.message ?? 'Could not save.')
    } finally { setSaving(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title="Read a message into hours"
      size={readYet ? 'wide' : 'lg'}>
      {!readYet ? (
        <>
          <textarea
            value={text} onChange={e => setText(e.target.value)} rows={9} autoFocus
            placeholder="Paste the message from the painter…"
            className="w-full bg-white border border-black/20 rounded-lg px-3 py-2 text-[13px] font-mono focus:outline-none focus:ring-1 focus:ring-blue-500" />

          <div className="mt-3 rounded-lg bg-[#f5f4f0] px-3 py-2.5">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-bold text-[#666] uppercase tracking-wide">
                The format it reads for free
              </span>
              <button type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(FORMAT_HINT).then(() => {
                    setCopied(true); setTimeout(() => setCopied(false), 1500)
                  }).catch(() => {})
                }}
                className="flex items-center gap-1 text-[11px] text-[#2563eb] hover:underline">
                {copied ? <><Check size={11} /> Copied</> : <><Copy size={11} /> Copy to send the crew</>}
              </button>
            </div>
            <pre className="text-[11px] leading-[1.5] text-[#444] whitespace-pre-wrap font-mono">{FORMAT_HINT}</pre>
            <div className="text-[10px] text-[#666] mt-1.5">
              A name on its own line covers every line under it. Dates can be 23/10, today, yesterday or
              Monday. Hours can be 8, 7.5, 7h30 or a span. Anything else, the AI can have a go.
            </div>
          </div>

          <div className="flex justify-end gap-2 mt-4">
            <button onClick={onClose} className="px-3 py-1.5 text-[13px] rounded-lg border border-black/20 hover:bg-[#f5f4f0]">Cancel</button>
            <button onClick={read} disabled={!text.trim()}
              className="px-4 py-1.5 text-[13px] rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold disabled:opacity-50">
              Read it
            </button>
          </div>
        </>
      ) : (
        <>
          {drafts.length === 0 ? (
            <div className="rounded-lg bg-[#fffbeb] border border-[#fde68a] px-3 py-2.5 text-[12px] text-[#92400e]">
              Nothing in that message looked like hours.
              {apiKey && <> The AI can try it — that costs an API call.</>}
            </div>
          ) : (
            <div className="border border-black/[0.12] rounded-lg overflow-hidden">
              <div className="overflow-auto max-h-[46vh]">
                <table className="w-full border-collapse text-[12px]">
                  <thead>
                    <tr>
                      {['', 'Date', 'Worker', 'Job', 'Hrs', 'Cost/hr', 'Charge/hr', 'Billing', 'Paid', 'Cost', 'Note', 'Read from'].map((h, i) => (
                        <th key={h} className={`px-2 py-1.5 bg-[#f5f4f0] border-b border-black/[0.12] text-[11px] text-[#666] font-medium whitespace-nowrap sticky top-0 ${[4, 5, 6, 9].includes(i) ? 'text-right' : 'text-left'}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(({ draft: d, change, duplicate }) => {
                      const off = dropped.has(d.key)
                      const bad = change.errors.length > 0
                      return (
                        <tr key={d.key} title={d.source}
                          className={`border-b border-black/[0.06] ${
                            off ? 'opacity-40' : bad ? 'bg-[#fff1f2]' : duplicate ? 'bg-[#fffbeb]' : ''}`}>
                          <td className="px-1.5 py-1 w-[26px]">
                            <input type="checkbox" checked={!off} className="w-4 h-4 accent-blue-600"
                              onChange={() => setDropped(s => {
                                const n = new Set(s); n.has(d.key) ? n.delete(d.key) : n.add(d.key); return n
                              })} />
                          </td>
                          <td className="px-1.5 py-1 w-[120px]">
                            <input type="date" value={d.date ?? ''} className={INL}
                              onChange={e => patch(d.key, { date: e.target.value })} />
                          </td>
                          <td className="px-1.5 py-1 w-[130px]">
                            <input value={d.worker} className={INL} list="rh-crew"
                              onChange={e => patch(d.key, { worker: e.target.value })} />
                            {!d.workerMatched && <div className="text-[9px] text-[#92400e] px-1.5">not on the crew</div>}
                          </td>
                          <td className="px-1.5 py-1 w-[260px]">
                            <select value={d.job_id ?? ''} className={`${INL} cursor-pointer`}
                              onChange={e => patch(d.key, { job_id: e.target.value || null, jobCandidates: undefined })}>
                              <option value="">— no job —</option>
                              {(d.jobCandidates ?? jobs).map(j => (
                                <option key={j.id} value={j.id}>
                                  {j.id} — {j.client}{j.address ? ` · ${String(j.address).split(',')[0]}` : ''}
                                </option>
                              ))}
                            </select>
                            {!d.job_id && (d.jobCandidates?.length
                              ? <div className="text-[9px] text-[#92400e] px-1.5">{d.jobCandidates.length} jobs fit &ldquo;{d.saidJob}&rdquo; — pick one</div>
                              : d.saidJob
                                ? <div className="text-[9px] text-[#92400e] px-1.5">no job matches &ldquo;{d.saidJob}&rdquo;</div>
                                : null)}
                          </td>
                          <td className="px-1.5 py-1 w-[62px]">
                            <input type="number" step="0.25" value={d.hours} className={`${INL} text-right tabular-nums`}
                              onChange={e => patch(d.key, { hours: parseFloat(e.target.value) || 0 })} />
                          </td>
                          <td className="px-2 py-1 w-[70px] text-right tabular-nums text-[#666]">
                            {Number(change.row.rate) ? fmtCurrency(Number(change.row.rate)) : '—'}
                          </td>
                          <td className="px-1.5 py-1 w-[78px]">
                            <input type="number" step="0.01" placeholder={String(Number(change.row.charge_rate) || '')}
                              value={d.charge_rate ?? ''} className={`${INL} text-right tabular-nums`}
                              onChange={e => patch(d.key, {
                                charge_rate: e.target.value === '' ? undefined : parseFloat(e.target.value) || 0,
                              })} />
                          </td>
                          <td className="px-1.5 py-1 w-[112px]">
                            <select value={d.billing_type ?? String(change.row.billing_type ?? '')}
                              className={`${INL} cursor-pointer`}
                              onChange={e => patch(d.key, { billing_type: e.target.value })}>
                              {BILLING_TYPES.map(b => <option key={b} value={b}>{b}</option>)}
                            </select>
                          </td>
                          <td className="px-1.5 py-1 w-[74px]">
                            <select value={d.worker_payment_type ?? String(change.row.worker_payment_type ?? 'ABN')}
                              className={`${INL} cursor-pointer ${
                                String(change.row.worker_payment_type) === 'Cash' ? 'text-[#92400e] font-semibold' : ''}`}
                              title={String(change.row.worker_payment_type) === 'Cash'
                                ? 'Cash — not deductible, and claims no GST credit'
                                : 'Paid against an ABN, so deductible as usual'}
                              onChange={e => patch(d.key, { worker_payment_type: e.target.value })}>
                              {['ABN', 'Cash'].map(v => <option key={v} value={v}>{v}</option>)}
                            </select>
                          </td>
                          <td className="px-2 py-1 w-[86px] text-right tabular-nums text-[#666]">
                            {fmtCurrency(Number(change.row.cost) || 0)}
                          </td>
                          <td className="px-1.5 py-1 min-w-[160px]">
                            <input value={d.description ?? ''} className={INL} placeholder="—"
                              onChange={e => patch(d.key, { description: e.target.value })} />
                            {bad && <div className="text-[9px] text-[#c0392b] px-1.5">{change.errors[0]}</div>}
                            {!bad && duplicate && (
                              <div className="text-[9px] text-[#92400e] px-1.5">
                                already logged — same worker, job, day and hours
                              </div>
                            )}
                          </td>
                          <td className="px-2 py-1 max-w-[220px]">
                            <div className="text-[10px] text-[#666] truncate" title={d.source}>{d.source}</div>
                            <div className="flex gap-1 flex-wrap mt-0.5">
                              {d.via === 'ai' && (
                                <span className="text-[9px] text-[#6b21a8] bg-[#f3e8ff] px-1.5 rounded-full">AI</span>
                              )}
                              {d.inferredFrom && (
                                <span className="text-[9px] text-[#1e40af] bg-[#dbeafe] px-1.5 rounded-full"
                                  title="The message did not name a job. This came from what the app already knew.">
                                  job from {d.inferredFrom === 'scheduled' ? "that day's schedule"
                                    : d.inferredFrom === 'in_progress' ? 'the job in progress'
                                    : 'recent hours'}
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <datalist id="rh-crew">{crew.map(c => <option key={c.id} value={c.name} />)}</datalist>
              <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 bg-[#f5f4f0] border-t border-black/[0.12] text-[11px]">
                <span className="text-[#666]">
                  {live.length} of {rows.length} to log
                  {badCount > 0 && <span className="text-[#c0392b] font-semibold"> · {badCount} cannot be saved</span>}
                </span>
                <span className="font-semibold">
                  {totalHours.toFixed(2)} hrs · {fmtCurrency(totalCost)} cost
                  {' · '}<span className="text-[#2563eb]">{fmtCurrency(totalBillable)}</span> billable
                  {cashRows > 0 && (
                    <span className="text-[#92400e] font-normal"> · {cashRows} paid cash, not deductible</span>
                  )}
                </span>
              </div>
            </div>
          )}

          {unparsed.length > 0 && (
            <div className="mt-3 rounded-lg bg-[#fffbeb] border border-[#fde68a] px-3 py-2.5">
              <div className="flex items-start gap-1.5 text-[11px] font-semibold text-[#92400e] mb-1">
                <AlertTriangle size={12} className="mt-px shrink-0" />
                {unparsed.length} line{unparsed.length !== 1 ? 's' : ''} not read
              </div>
              <pre className="text-[11px] text-[#92400e] whitespace-pre-wrap font-mono">{unparsed.join('\n')}</pre>
              <button onClick={() => readWithAI()} disabled={aiBusy || !apiKey}
                className="mt-2 flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded-lg bg-white border border-[#c4b5fd] text-[#6b21a8] hover:bg-[#f3e8ff] disabled:opacity-50">
                {aiBusy ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                {aiBusy ? 'Reading…' : apiKey ? 'Read the rest with AI (uses an API call)' : 'No AI key set'}
              </button>
            </div>
          )}

          {err && <div className="mt-3 text-[12px] text-[#c0392b]">{err}</div>}

          <div className="flex justify-between items-center mt-4 pt-3 border-t border-black/10">
            <div className="flex items-center gap-3">
              <button onClick={reset}
                className="flex items-center gap-1.5 text-[12px] text-[#666] hover:text-gray-900">
                <Trash2 size={13} /> Start again
              </button>
              {apiKey && drafts.length > 0 && (
                <button onClick={() => readWithAI(true)} disabled={aiBusy}
                  title="Replaces what is in the table with the AI's reading of the whole message"
                  className="flex items-center gap-1.5 text-[12px] text-[#6b21a8] hover:underline disabled:opacity-50">
                  {aiBusy ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                  Jobs wrong? Re-read it all with AI
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={onClose} className="px-3 py-1.5 text-[13px] rounded-lg border border-black/20 hover:bg-[#f5f4f0]">Cancel</button>
              <button onClick={logAll} disabled={saving || live.filter(r => !r.change.errors.length).length === 0}
                className="flex items-center gap-1.5 px-4 py-1.5 text-[13px] rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold disabled:opacity-50">
                {saving && <Loader2 size={13} className="animate-spin" />}
                Log {live.filter(r => !r.change.errors.length).length} entr
                {live.filter(r => !r.change.errors.length).length === 1 ? 'y' : 'ies'}
              </button>
            </div>
          </div>
        </>
      )}
    </Modal>
  )
}
