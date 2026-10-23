// Reading a message into logged hours.
//
// Hours arrive as messages. Someone retypes them into the form one entry at
// a time, and a week from one painter across three jobs is a dozen fields
// typed by hand — so the entries that never get typed are the ones that
// quietly stop a job's hours matching what it cost.
//
// This reads the shape below with no API call: free, instant, and it fails
// visibly rather than inventing an entry. A worker named on their own line
// applies to every line beneath until another worker is named, because one
// message routinely covers several jobs for one person:
//
//     Francisco
//     23/10  NP-0083  8h  second coat
//     23/10  Kipling St  4h
//     24/10  Esmonde St  6.5h  prep
//     25/10  NP-0083  7:30-16:00 -30min
//
//     Jake
//     23/10  NP-0083  8h
//
// Anything it cannot read in full is handed back as `unparsed` for the AI to
// try. Nothing here guesses: an ambiguous job name comes back as candidates
// for a person to choose between, because a confident wrong match is worse
// than an obvious gap.
//
// Pure — no hooks, no Supabase, no network.

import { normaliseDate } from './utils'
import { hoursBetween } from './derive'
import type { LabourRequest } from './writes'

type Row = Record<string, any>

export interface ReadContext {
  jobs: Row[]
  crew: Row[]
  /** 'YYYY-MM-DD'. Passed in so the parser is testable on a fixed day. */
  todayStr: string
}

export interface DraftEntry extends LabourRequest {
  /** Local key for the review table. */
  key: string
  /** The line it was read from, so a wrong row can be checked against it. */
  source: string
  /** How it was read. The table says which, so an AI reading is never taken
   *  for a literal one. */
  via: 'format' | 'ai'
  /** Jobs that fit the text when more than one did — nothing is chosen. */
  jobCandidates?: Row[]
  /** The worker name was matched against the crew rather than taken as typed. */
  workerMatched: boolean
}

export interface ReadResult {
  entries: DraftEntry[]
  /** Lines with something on them that could not be read. Never dropped. */
  unparsed: string[]
}

let seq = 0
const key = () => `h${Date.now().toString(36)}${seq++}`
const r2 = (v: number) => Math.round(v * 100) / 100
const norm = (s: unknown) => String(s ?? '').trim().toLowerCase()

// ── Dates ────────────────────────────────────────────────────

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

/** Days back from `todayStr` as a local date string. Never through UTC. */
function daysBefore(todayStr: string, back: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(todayStr)
  if (!m) return todayStr
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) - back)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const weekdayOf = (iso: string): number => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay() : -1
}

/**
 * A date as a painter writes it.
 *
 * `23/10` with no year means this year, unless that would be in the future —
 * a message in January about `28/12` is about last month, not next December.
 */
export function parseDate(text: string, todayStr: string): string | null {
  const t = norm(text).replace(/[.,]$/, '')
  if (!t) return null
  if (t === 'today') return todayStr
  if (t === 'yesterday') return daysBefore(todayStr, 1)

  const wd = WEEKDAYS.findIndex(d => d === t || d.slice(0, 3) === t)
  if (wd >= 0) {
    // The most recent one, today included.
    const back = (weekdayOf(todayStr) - wd + 7) % 7
    return daysBefore(todayStr, back)
  }

  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(t)) {
    const [y, m, d] = t.split('-')
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }

  // Day first, as Australia writes it.
  const dm = /^(\d{1,2})[-\/](\d{1,2})(?:[-\/](\d{2,4}))?$/.exec(t)
  if (!dm) return null
  const [, dd, mm, yy] = dm
  if (Number(mm) < 1 || Number(mm) > 12 || Number(dd) < 1 || Number(dd) > 31) return null
  if (yy) return normaliseDate(`${dd}/${mm}/${yy}`)

  const thisYear = todayStr.slice(0, 4)
  const guess = `${thisYear}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`
  return guess <= todayStr ? guess : `${Number(thisYear) - 1}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`
}

// ── Hours ────────────────────────────────────────────────────

const TIME = /^(\d{1,2})(?::(\d{2}))?$/

/** A time as written — `7`, `7:30`, `16:00` — as HH:MM, or null. */
function asTime(text: string): string | null {
  const m = TIME.exec(text.trim())
  if (!m) return null
  const h = Number(m[1]), min = Number(m[2] ?? 0)
  if (h > 23 || min > 59) return null
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

/**
 * Hours from however they were written: `8`, `8h`, `7.5`, `7h30`, or a span
 * `7:30-16:00` with an optional `-30min` break.
 *
 * A bare number is only hours when it cannot be a span, which is why the
 * span is tried first.
 */
export function parseHours(text: string): number | null {
  const t = norm(text).replace(/\s+/g, '')
  if (!t) return null

  // A span, with the break anywhere after it: 7:30-16:00 -30min
  const span = /^(\d{1,2}(?::\d{2})?)(?:am|pm)?(?:-|to|–)(\d{1,2}(?::\d{2})?)(?:am|pm)?(?:-?(\d{1,3})(?:min|m|mins)?)?$/.exec(t)
  if (span) {
    const from = asTime(span[1]), to = asTime(span[2])
    if (from && to) {
      const breakMins = Number(span[3] ?? 0) || 0
      const h = hoursBetween(from, to, breakMins)
      return h > 0 ? r2(h) : null
    }
  }

  // 7h30 — hours and minutes.
  const hm = /^(\d{1,2})h(\d{1,2})m?(?:in)?$/.exec(t)
  if (hm) return r2(Number(hm[1]) + Number(hm[2]) / 60)

  // 8, 8h, 7.5, 7.5hrs
  const plain = /^(\d{1,2}(?:[.,]\d{1,2})?)\s*(?:h|hr|hrs|hour|hours)?$/.exec(t)
  if (plain) {
    const v = Number(plain[1].replace(',', '.'))
    return Number.isFinite(v) && v > 0 && v <= 24 ? r2(v) : null
  }
  return null
}

/** Does this fragment look like hours at all? Used to split a multi-job line. */
const looksLikeHours = (t: string) => parseHours(t) !== null

// ── Jobs ─────────────────────────────────────────────────────

export interface JobMatch {
  job: Row | null
  /** More than one fitted. Nothing is chosen — the table asks. */
  candidates: Row[]
}

const streetOf = (job: Row) => String(job?.address ?? '').split(',')[0].trim()

/**
 * A job from what the message called it.
 *
 * Precedence is exact id, then exact client, then exact street, then a
 * contains-match across all three — the same shape as matchPhase, because
 * matching confidently on a partial is the failure that writes hours onto
 * somebody else's job.
 */
export function matchJob(text: string, jobs: Row[]): JobMatch {
  const t = norm(text)
  if (!t) return { job: null, candidates: [] }

  const exact = (pick: (j: Row) => string) => jobs.filter(j => norm(pick(j)) === t)
  for (const pick of [(j: Row) => j.id, (j: Row) => j.client, streetOf]) {
    const hit = exact(pick as (j: Row) => string)
    if (hit.length === 1) return { job: hit[0], candidates: [] }
    if (hit.length > 1) return { job: null, candidates: hit }
  }

  const loose = jobs.filter(j =>
    norm(j.id).includes(t) || norm(j.client).includes(t) ||
    norm(j.address).includes(t) || t.includes(norm(streetOf(j))) && !!streetOf(j))
  if (loose.length === 1) return { job: loose[0], candidates: [] }
  return { job: null, candidates: loose }
}

/** A crew member from a first name or a full one, returning their real name. */
export function matchWorker(text: string, crew: Row[]): { name: string; matched: boolean } {
  const raw = String(text ?? '').trim()
  const t = norm(raw)
  if (!t) return { name: '', matched: false }
  const exact = crew.find(c => norm(c.name) === t)
  if (exact) return { name: String(exact.name), matched: true }
  // "Francisco" for "Francisco Rojas", but only when one person answers to it.
  const partial = crew.filter(c => norm(c.name).split(/\s+/).includes(t) || norm(c.name).startsWith(t))
  if (partial.length === 1) return { name: String(partial[0].name), matched: true }
  return { name: raw, matched: false }
}

// ── The message ──────────────────────────────────────────────

/** The words of a line. Commas, pipes and tabs are separators like spaces —
 *  a phone keyboard is not a form, and `NP-0083 4h, NP-0091 4h` has to split
 *  the same way `NP-0083  4h  NP-0091  4h` does. */
const words = (line: string) =>
  line.split(/[\s,;|\t]+/).map(w => w.trim()).filter(Boolean)

const isNoise = (line: string) =>
  !line || /^[-=_*~\s]+$/.test(line) ||
  // A timestamp line from a chat export, or a forwarded header.
  /^\[?\d{1,2}:\d{2}(\s?[ap]m)?\]?$/i.test(line)

/**
 * Read a whole message.
 *
 * Every line is either a worker heading, one or more entries, or unparsed —
 * and unparsed lines are handed back rather than dropped, because a line
 * silently ignored is the failure that loses somebody a day's pay.
 */
export function parseHoursMessage(text: string, ctx: ReadContext): ReadResult {
  const entries: DraftEntry[] = []
  const unparsed: string[] = []
  let worker = ''
  let workerMatched = false
  let lastDate = ''

  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim()
    if (isNoise(line)) continue

    const w = words(line)
    const hasHours = w.some(f => parseHours(f) !== null)
    const hasDate = w.some(f => parseDate(f, ctx.todayStr) !== null)

    // No hours and no date on a short line: it names who the rest is about.
    if (!hasHours && !hasDate && w.length <= 3) {
      const m = matchWorker(line.replace(/[:\-]+$/, '').trim(), ctx.crew)
      if (m.name) { worker = m.name; workerMatched = m.matched; continue }
    }

    const got = readEntryLine(line, { worker, workerMatched, lastDate }, ctx)
    if (!got.length) { unparsed.push(line); continue }
    entries.push(...got)
    lastDate = got[got.length - 1].date ?? lastDate
  }

  return { entries, unparsed }
}

/**
 * `7:30-16:00 -30min` is one figure written with a space in it.
 *
 * The break is its own word once the line is split, and on its own it means
 * nothing — so it is joined back onto the span in front of it, which
 * parseHours already reads whole.
 */
const BREAK = /^-\s*(\d{1,3})\s*(?:min|mins|m)?$/
function mergeBreaks(w: string[]): string[] {
  const out: string[] = []
  for (const token of w) {
    const prev = out[out.length - 1]
    if (BREAK.test(token) && prev && parseHours(prev) !== null) {
      out[out.length - 1] = prev + token.replace(/\s+/g, '')
      continue
    }
    out.push(token)
  }
  return out
}

/**
 * The job named by a run of words, and whatever is left over as the note.
 *
 * Longest first: "NP-0083 second coat" tries the whole phrase, then
 * "NP-0083", and stops at the first thing that names a job. Trying one word
 * at a time instead would match "St" against three different streets.
 */
function pickJob(w: string[], jobs: Row[]): { match: JobMatch; note: string } {
  for (let len = w.length; len > 0; len--) {
    const m = matchJob(w.slice(0, len).join(' '), jobs)
    if (m.job || m.candidates.length) return { match: m, note: w.slice(len).join(' ') }
  }
  return { match: { job: null, candidates: [] }, note: w.join(' ') }
}

/**
 * One line, which may hold more than one job.
 *
 * The line is cut at each hours figure: the words before one name the job
 * (and sometimes the worker), and whatever trails the last one is the note.
 * `23/10 Esmonde 4h Kipling 4h` is two entries; `23/10 NP-0083 8h second
 * coat` is one with a note.
 */
function readEntryLine(
  line: string,
  state: { worker: string; workerMatched: boolean; lastDate: string },
  ctx: ReadContext,
): DraftEntry[] {
  const all = mergeBreaks(words(line))
  if (!all.length) return []

  // The date, wherever it sits, read once for the whole line.
  let date = ''
  const rest: string[] = []
  for (const f of all) {
    const d = !date ? parseDate(f, ctx.todayStr) : null
    if (d) { date = d; continue }
    rest.push(f)
  }
  if (!date) date = state.lastDate
  if (!date) return []

  const out: DraftEntry[] = []
  let bucket: string[] = []
  for (const f of rest) {
    const h = parseHours(f)
    if (h === null) { bucket.push(f); continue }

    // A worker named on the line itself wins over the heading above it.
    let lineWorker: { name: string; matched: boolean } | null = null
    const forJob: string[] = []
    for (const b of bucket) {
      const m = matchWorker(b, ctx.crew)
      if (!lineWorker && m.matched) { lineWorker = m; continue }
      forJob.push(b)
    }

    const { match, note } = pickJob(forJob, ctx.jobs)
    out.push({
      key: key(),
      source: line,
      via: 'format',
      worker: lineWorker?.name || state.worker,
      workerMatched: lineWorker ? lineWorker.matched : state.workerMatched,
      hours: h,
      date,
      job_id: match.job?.id ?? null,
      jobCandidates: match.candidates.length ? match.candidates : undefined,
      description: note || undefined,
    })
    bucket = []
  }

  // Words trailing the last hours figure are its note: "8h second coat".
  if (out.length && bucket.length) {
    const last = out[out.length - 1]
    last.description = [last.description, bucket.join(' ')].filter(Boolean).join(' ')
  }

  // Hours with no worker and no job is not an entry anyone can use.
  return out.filter(e => e.hours > 0 && (e.worker || e.job_id || e.jobCandidates?.length))
}

/**
 * What the AI read, put through the same matchers as a typed line.
 *
 * Its answer gets no more trust than the format parser's: the worker and the
 * job are resolved against the real records here, so a name it invented
 * arrives flagged rather than written to a row.
 */
export function draftsFromAI(
  aiEntries: Array<{ worker: string; job?: string; date?: string; hours: number; note?: string }>,
  ctx: ReadContext,
): DraftEntry[] {
  return aiEntries.map(e => {
    const w = matchWorker(e.worker, ctx.crew)
    const m = e.job ? matchJob(e.job, ctx.jobs) : { job: null, candidates: [] }
    const date = e.date ? parseDate(e.date, ctx.todayStr) : null
    return {
      key: key(),
      source: [e.date, e.worker, e.job, `${e.hours}h`, e.note].filter(Boolean).join('  '),
      via: 'ai' as const,
      worker: w.name,
      workerMatched: w.matched,
      hours: r2(Number(e.hours) || 0),
      date: date ?? ctx.todayStr,
      job_id: m.job?.id ?? null,
      jobCandidates: m.candidates.length ? m.candidates : undefined,
      description: e.note || undefined,
    }
  }).filter(d => d.hours > 0)
}

/**
 * An entry that already exists, matched on worker, job, date and hours.
 *
 * The same message gets pasted twice. This is a warning rather than a block,
 * because two four-hour stints on one job in one day is also a real day.
 */
export function findDuplicateEntry(entry: DraftEntry, labour: Row[]): Row | null {
  return labour.find(l =>
    norm(l.sub) === norm(entry.worker) &&
    String(l.job_id ?? '') === String(entry.job_id ?? '') &&
    String(l.date ?? '') === String(entry.date ?? '') &&
    Math.abs(Number(l.hours ?? 0) - entry.hours) < 0.01) ?? null
}

/** The format, as it is shown in the modal and sent to the crew. */
export const FORMAT_HINT = [
  'Francisco',
  '23/10  NP-0083  8h  second coat',
  '23/10  Kipling St  4h',
  '24/10  Esmonde St  6.5h  prep',
  '25/10  NP-0083  7:30-16:00 -30min',
].join('\n')
