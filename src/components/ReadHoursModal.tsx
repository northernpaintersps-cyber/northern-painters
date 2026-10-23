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
import { fmtCurrency, today } from '@/lib/utils'
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
  const ctx = { jobs, crew, todayStr }

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

  async function readRest() {
    if (!apiKey) { setErr('No AI API key set. Add your Anthropic key in Settings.'); return }
    setAiBusy(true); setErr('')
    try {
      // Only what the format parser could not read, so a tidy message is
      // never sent anywhere and a mixed one only sends its loose ends.
      const got = await readHoursMessage(apiKey, unparsed.join('\n'), {
        crew: crew.map(c => String(c.name ?? '')).filter(Boolean),
        jobs: jobs.map(j => ({ id: String(j.id), client: j.client, address: j.address })),
        todayStr,
      })
      const more = draftsFromAI(got.entries, ctx)
      setDrafts(d => [...d, ...more])
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

  /** Each draft as the row it would write, with its own checks run. */
  const rows = useMemo(() => drafts.map(d => {
    // The note becomes a phase tag only when it actually names one of the
    // job's quoted phases. buildLabour keeps an unmatched phase name as
    // typed, which is right when a person typed it and wrong here — it would
    // file "dropped the ladder off" as a phase of the work.
    const job = jobs.find(j => j.id === d.job_id)
    const phase = d.description ? findPhaseByName(jobPhases(job), d.description) : null
    const change = buildLabour(writeCtx as any, {
      worker: d.worker, hours: d.hours, date: d.date, job_id: d.job_id,
      description: d.description, phase: phase?.name,
    })
    return { draft: d, change, duplicate: findDuplicateEntry(d, labour) }
  }), [drafts, writeCtx, labour, jobs])

  const live = rows.filter(r => !dropped.has(r.draft.key))
  const badCount = live.filter(r => r.change.errors.length).length
  const totalHours = live.reduce((s, r) => s + (r.draft.hours || 0), 0)
  const totalCost = live.reduce((s, r) => s + (Number(r.change.row.cost) || 0), 0)

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
    <Modal open={open} onClose={onClose} title="Read a message into hours">
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
                      {['', 'Date', 'Worker', 'Job', 'Hrs', 'Cost', 'Note'].map((h, i) => (
                        <th key={h} className={`px-2 py-1.5 bg-[#f5f4f0] border-b border-black/[0.12] text-[11px] text-[#666] font-medium sticky top-0 ${[4, 5].includes(i) ? 'text-right' : 'text-left'}`}>{h}</th>
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
                          <td className="px-1.5 py-1 w-[190px]">
                            <select value={d.job_id ?? ''} className={`${INL} cursor-pointer`}
                              onChange={e => patch(d.key, { job_id: e.target.value || null, jobCandidates: undefined })}>
                              <option value="">— no job —</option>
                              {(d.jobCandidates ?? jobs).map(j => (
                                <option key={j.id} value={j.id}>
                                  {j.id} — {j.client}{j.address ? ` · ${String(j.address).split(',')[0]}` : ''}
                                </option>
                              ))}
                            </select>
                            {d.jobCandidates?.length && !d.job_id
                              ? <div className="text-[9px] text-[#92400e] px-1.5">{d.jobCandidates.length} jobs fit — pick one</div>
                              : null}
                          </td>
                          <td className="px-1.5 py-1 w-[62px]">
                            <input type="number" step="0.25" value={d.hours} className={`${INL} text-right tabular-nums`}
                              onChange={e => patch(d.key, { hours: parseFloat(e.target.value) || 0 })} />
                          </td>
                          <td className="px-2 py-1 w-[76px] text-right tabular-nums text-[#666]">
                            {fmtCurrency(Number(change.row.cost) || 0)}
                          </td>
                          <td className="px-1.5 py-1">
                            <input value={d.description ?? ''} className={INL} placeholder="—"
                              onChange={e => patch(d.key, { description: e.target.value })} />
                            {bad && <div className="text-[9px] text-[#c0392b] px-1.5">{change.errors[0]}</div>}
                            {!bad && duplicate && (
                              <div className="text-[9px] text-[#92400e] px-1.5">
                                already logged — same worker, job, day and hours
                              </div>
                            )}
                            {d.via === 'ai' && <span className="text-[9px] text-[#6b21a8]">read by AI</span>}
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
                  {totalHours.toFixed(2)} hrs · <span className="text-[#2563eb]">{fmtCurrency(totalCost)}</span> cost
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
              <button onClick={readRest} disabled={aiBusy || !apiKey}
                className="mt-2 flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded-lg bg-white border border-[#c4b5fd] text-[#6b21a8] hover:bg-[#f3e8ff] disabled:opacity-50">
                {aiBusy ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                {aiBusy ? 'Reading…' : apiKey ? 'Read the rest with AI (uses an API call)' : 'No AI key set'}
              </button>
            </div>
          )}

          {err && <div className="mt-3 text-[12px] text-[#c0392b]">{err}</div>}

          <div className="flex justify-between items-center mt-4 pt-3 border-t border-black/10">
            <button onClick={reset}
              className="flex items-center gap-1.5 text-[12px] text-[#666] hover:text-gray-900">
              <Trash2 size={13} /> Start again
            </button>
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
