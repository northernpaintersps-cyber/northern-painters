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

import { normaliseDate, getJobScheduledDates } from './utils'
import { hoursBetween } from './derive'
import type { LabourRequest } from './writes'

type Row = Record<string, any>

export interface ReadContext {
  jobs: Row[]
  crew: Row[]
  /** 'YYYY-MM-DD'. Passed in so the parser is testable on a fixed day. */
  todayStr: string
  /** Hours already logged, for "the job he has been on all week". */
  labour?: Row[]
  /** What a day means in hours, from Settings. "2 days" is not a number of
   *  hours until somebody says how long a day is. */
  hoursPerDay?: number
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
  /** What the message called the job. Shown when nothing matched, so the
   *  gap says "it tried 'the Byron job'" rather than just being empty. */
  saidJob?: string
  /** The job came from the diary rather than the message. Shown, because a
   *  figure the app worked out deserves a different kind of glance from one
   *  that was written down. */
  inferredFrom?: 'scheduled' | 'in_progress' | 'recent'
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

/**
 * Weekday names, in the languages these messages actually arrive in.
 *
 * A painting crew is not all English-speaking, and a message that says
 * "lunes 8 horas" is a timesheet as much as "Monday 8h" is. Each row is the
 * names for that day, Sunday first, longest-form first so a prefix match
 * cannot shadow a longer name.
 */
const WEEKDAYS: string[][] = [
  ['sunday', 'domingo', 'dom'],
  ['monday', 'lunes', 'segunda', 'lun'],
  ['tuesday', 'martes', 'terca', 'terça', 'mar'],
  ['wednesday', 'wednes', 'miercoles', 'miércoles', 'quarta', 'mie', 'mié'],
  ['thursday', 'thurs', 'jueves', 'quinta', 'jue'],
  ['friday', 'viernes', 'sexta', 'vie'],
  ['saturday', 'sabado', 'sábado', 'sab', 'sáb'],
]

/** Today and yesterday, in the same languages. */
const TODAY_WORDS = ['today', 'hoy', 'hoje']
const YESTERDAY_WORDS = ['yesterday', 'ayer', 'ontem']

/** "week of 20/10", "w/c 20/10", "semana del 20/10" — anchors the weekdays
 *  under it to that week rather than to the most recent one. */
const WEEK_ANCHOR = /^(?:week\s*(?:of|beginning|starting|commencing)?|w\/c|wc|semana\s*(?:del|de)?)\s*:?\s*(.+)$/i

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
/** The day of the week a name refers to, or -1. */
export function weekdayIndex(text: string): number {
  const t = norm(text).replace(/[.,:]+$/, '')
  if (!t) return -1
  return WEEKDAYS.findIndex(names => names.some(n => n === t || (t.length >= 3 && n.startsWith(t))))
}

/**
 * A date as a painter writes it.
 *
 * `weekOf` is a date inside a week named earlier in the message, so a
 * weekday under "week of 20/10" lands in that week instead of the most
 * recent one — which is how a message written up on Sunday about last week
 * used to file every day seven days late.
 */
export function parseDate(text: string, todayStr: string, weekOf?: string): string | null {
  const t = norm(text).replace(/[.,]$/, '')
  if (!t) return null
  if (TODAY_WORDS.includes(t)) return todayStr
  if (YESTERDAY_WORDS.includes(t)) return daysBefore(todayStr, 1)

  const wd = weekdayIndex(t)
  if (wd >= 0) {
    if (weekOf) {
      // That day within the anchored week, counting the anchor's own week as
      // Monday to Sunday.
      const anchorDow = weekdayOf(weekOf)
      const mondayBack = (anchorDow + 6) % 7
      const monday = daysBefore(weekOf, mondayBack)
      const offset = (wd + 6) % 7          // Monday is 0
      return daysBefore(monday, -offset)
    }
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
export function parseHours(text: string, hoursPerDay = 8): number | null {
  const t = norm(text).replace(/\s+/g, '')
  if (!t) return null

  const hpd = Number(hoursPerDay) > 0 ? Number(hoursPerDay) : 8

  // Days, because that is how the work is actually described: "2 days",
  // "1d", "medio dia". A day is only a number of hours once Settings says
  // how long one is.
  if (/^(half|medio|media)(day|dia|día|jornada)?$/.test(t)) return r2(hpd / 2)
  const days = /^(\d{1,2}(?:[.,]\d{1,2})?)(d|day|days|dia|dias|día|días|jornada|jornadas)$/.exec(t)
  if (days) {
    const v = Number(days[1].replace(',', '.'))
    return Number.isFinite(v) && v > 0 && v <= 7 ? r2(v * hpd) : null
  }

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

  // 8, 8h, 7.5, 7.5hrs, 8 horas
  const plain = /^(\d{1,2}(?:[.,]\d{1,2})?)\s*(?:h|hs|hr|hrs|hour|hours|hora|horas)?$/.exec(t)
  if (plain) {
    const v = Number(plain[1].replace(',', '.'))
    return Number.isFinite(v) && v > 0 && v <= 24 ? r2(v) : null
  }
  return null
}



// ── Jobs ─────────────────────────────────────────────────────

export interface JobMatch {
  job: Row | null
  /** More than one fitted. Nothing is chosen — the table asks. */
  candidates: Row[]
}

const streetOf = (job: Row) => String(job?.address ?? '').split(',')[0].trim()

/** Words that carry no job in them, so a phrase can be matched on the rest. */
const FILLER = new Set([
  'the', 'job', 'jobs', 'site', 'place', 'house', 'one', 'and', 'for', 'with',
  'that', 'this', 'out', 'rd', 'road', 'st', 'street', 'ave', 'avenue', 'lane',
  'court', 'drive', 'way', 'nsw', 'unit',
])

/**
 * The number inside a job reference, or null.
 *
 * Nobody writes NP-0083. They write NP-83, np83, #83 or just 83, and an
 * exact-string match finds none of those — which is most of why the reader
 * was putting hours on no job at all.
 *
 * `loose` allows a bare number. That is only safe once the exact passes have
 * run, because "15" is also a street number, and matching it as a job id
 * before trying 15 Kipling St would be confidently wrong.
 */
function jobNumber(text: string, loose = false): string | null {
  const t = norm(text).replace(/[#\s]/g, '')
  const m = loose
    ? /^[a-z]{0,4}-?(\d{1,6})$/.exec(t)
    : /^[a-z]{1,4}-?(\d{1,6})$/.exec(t)
  return m ? String(Number(m[1])) : null   // "0083" and "83" are the same job
}

/**
 * A job from what the message called it.
 *
 * Precedence, strictest first, because matching confidently on a partial is
 * what writes somebody's hours onto the wrong job:
 *
 *   1. the id, exactly
 *   2. the id written loosely — NP-83 for NP-0083
 *   3. the client, exactly
 *   4. the street, exactly
 *   5. a bare number as an id, now that street numbers have had their turn
 *   6. a contains-match across all three
 *
 * A tie at any level returns the candidates and chooses nothing.
 */
export function matchJob(text: string, jobs: Row[]): JobMatch {
  const t = norm(text)
  if (!t) return { job: null, candidates: [] }

  const resolve = (hits: Row[]): JobMatch | null => {
    if (hits.length === 1) return { job: hits[0], candidates: [] }
    if (hits.length > 1) return { job: null, candidates: hits }
    return null
  }

  const num = jobNumber(t)
  const passes: Array<() => Row[]> = [
    () => jobs.filter(j => norm(j.id) === t),
    () => num ? jobs.filter(j => jobNumber(String(j.id ?? ''), true) === num) : [],
    () => jobs.filter(j => norm(j.client) === t),
    () => jobs.filter(j => norm(streetOf(j)) === t),
    () => {
      const bare = jobNumber(t, true)
      return bare ? jobs.filter(j => jobNumber(String(j.id ?? ''), true) === bare) : []
    },
    () => jobs.filter(j =>
      norm(j.id).includes(t) || norm(j.client).includes(t) ||
      norm(j.address).includes(t) || (!!streetOf(j) && t.includes(norm(streetOf(j))))),
    // "the Byron job", "Smithy's place" — a phrase rather than a name. Match
    // on the words that carry meaning: the suburb, the surname, the street.
    // Last, so a real name never loses to a word that merely appears in one.
    () => {
      const words = t.split(/[^a-z0-9]+/).filter(w => w.length >= 3 && !FILLER.has(w))
      if (!words.length) return []
      return jobs.filter(j => {
        const hay = `${norm(j.id)} ${norm(j.client)} ${norm(j.address)}`
        return words.some(w => hay.includes(w))
      })
    },
  ]

  for (const pass of passes) {
    const got = resolve(pass())
    if (got) return got
  }
  return { job: null, candidates: [] }
}

/** Work that could plausibly have had hours put into it this week. */
const LIVE = ['In Progress', 'Scheduled', 'Hourly Rate Accepted', 'Booked', 'Not Started']

export const isLive = (job: Row): boolean =>
  LIVE.includes(String(job?.status ?? '').trim())

const isRunning = (job: Row): boolean =>
  String(job?.status ?? '').trim() === 'In Progress'

/** A local date shifted by days. Never through UTC parsing of a string. */
function shiftDays(iso: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return iso
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * The job the app thinks this is, when the message does not say.
 *
 * A painter writing up their week often names no job at all — "Monday 8h,
 * Tuesday 8h" — and no amount of reading the words will fix that. But there
 * are only ever a few jobs on the go, and the app knows which:
 *
 *   scheduled    the only live job whose dates cover that day
 *   in_progress  the only job actually being painted
 *   recent       the job they have been logging hours against, when one
 *                clearly dominates — a close second means two jobs and no
 *                way to tell which this entry belongs to
 *
 * Finished and lost work is never inferred: it is only ever a live job.
 *
 * Used to settle what the message left open — a blank job, or a tie between
 * candidates that all fitted the words. Never to override a job the message
 * identified, because a guess does not outrank what somebody wrote down.
 */
export function inferJob(
  entry: { worker?: string; date?: string },
  ctx: ReadContext,
  within: Row[] | null = null,
): { job: Row; from: 'scheduled' | 'in_progress' | 'recent' } | null {
  const worker = norm(entry?.worker)
  const date = String(entry?.date ?? '').slice(0, 10)

  // Only live work, and only from the candidates when the words narrowed it.
  const pool = (within && within.length ? within : ctx.jobs).filter(isLive)
  if (!pool.length) return null
  if (pool.length === 1) {
    return { job: pool[0], from: isRunning(pool[0]) ? 'in_progress' : 'scheduled' }
  }

  // 1. Scheduled to run that day. The calendar said so before the work did.
  if (date) {
    const running = pool.filter(j => getJobScheduledDates(j).includes(date))
    if (running.length === 1) return { job: running[0], from: 'scheduled' }
    // Several scheduled that day, but only one of them actually under way.
    const started = running.filter(isRunning)
    if (started.length === 1) return { job: started[0], from: 'in_progress' }
  }

  // 2. The only job on the tools.
  const live = pool.filter(isRunning)
  if (live.length === 1) return { job: live[0], from: 'in_progress' }

  // 3. The job their hours have been going into. Narrowed to the ones under
  //    way where there are any, since that is where the work is.
  const consider = live.length ? live : pool
  if (worker && date) {
    const from = shiftDays(date, -14), to = shiftDays(date, 14)
    const hours = new Map<string, number>()
    for (const l of ctx.labour ?? []) {
      const d = String(l.date ?? '').slice(0, 10)
      if (!l.job_id || d < from || d > to) continue
      if (norm(l.sub) !== worker) continue
      if (!consider.some(j => String(j.id) === String(l.job_id))) continue
      const id = String(l.job_id)
      hours.set(id, (hours.get(id) ?? 0) + (Number(l.hours) || 0))
    }
    const ranked = [...hours.entries()].sort((a, b) => b[1] - a[1])
    if (ranked.length === 1 || (ranked.length > 1 && ranked[0][1] >= ranked[1][1] * 2)) {
      const job = consider.find(j => String(j.id) === ranked[0][0])
      if (job) return { job, from: 'recent' }
    }
  }

  return null
}

/**
 * Settle a draft's job with what the app knows, where the message left it
 * open. Three cases: nothing matched, several matched, or one did — and only
 * the first two are touched.
 */
export function settleJob(entry: DraftEntry, ctx: ReadContext): DraftEntry {
  if (entry.job_id) return entry                       // the message named it

  const guess = inferJob(entry, ctx, entry.jobCandidates ?? null)
  if (!guess) return entry
  return {
    ...entry,
    job_id: String(guess.job.id),
    jobCandidates: entry.jobCandidates,
    inferredFrom: guess.from,
  }
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
  const hpd = Number(ctx.hoursPerDay) > 0 ? Number(ctx.hoursPerDay) : 8
  let worker = ''
  let workerMatched = false
  let lastDate = ''
  // Set by a "week of 20/10" line, so the weekdays under it land in that
  // week. Without it, a message written up on Sunday about last week filed
  // every day of it seven days late.
  let weekOf = ''

  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim()
    if (isNoise(line)) continue

    // A week heading, in any of the forms people write it.
    const anchor = WEEK_ANCHOR.exec(line)
    if (anchor) {
      const d = parseDate(anchor[1].trim(), ctx.todayStr)
      if (d) { weekOf = d; lastDate = ''; continue }
    }

    const w = words(line)
    const hasHours = w.some(f => parseHours(f, hpd) !== null)
    const hasDate = w.some(f => parseDate(f, ctx.todayStr, weekOf) !== null)

    // No hours and no date on a short line: it names who the rest is about.
    if (!hasHours && !hasDate && w.length <= 3) {
      const m = matchWorker(line.replace(/[:\-]+$/, '').trim(), ctx.crew)
      if (m.name) { worker = m.name; workerMatched = m.matched; continue }
    }

    const got = readEntryLine(line, { worker, workerMatched, lastDate, weekOf }, ctx)
    if (!got.length) { unparsed.push(line); continue }
    entries.push(...got.map(e => settleJob(e, ctx)))
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
function mergeBreaks(w: string[], hoursPerDay = 8): string[] {
  const out: string[] = []
  for (const token of w) {
    const prev = out[out.length - 1]
    if (BREAK.test(token) && prev && parseHours(prev, hoursPerDay) !== null) {
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
 * The fields of a line, where the writer has separated them.
 *
 *     23/10 - 81 Esmonde St - 8 - masking and first coat
 *
 * A spaced dash, a tab, two or more spaces, a pipe or a semicolon all mean
 * "next field". A TIGHT dash does not: 7:30-16:00 is one figure and 23-10-26
 * is one date, which is why the spaces are part of the pattern.
 */
const FIELD_SEP = /\s+[-\u2013\u2014]\s+|\t+|\s{2,}|\s*[|;]\s*|\s*,\s*/

const fields = (line: string): string[] =>
  line.split(FIELD_SEP)
    // A trailing or leading dash survives when a field is empty between two
    // separators, and it is not part of anybody's address.
    .map(f => f.replace(/^[-\u2013\u2014\s]+|[-\u2013\u2014\s]+$/g, '').trim())
    .filter(Boolean)

/**
 * A line whose writer separated its fields for us.
 *
 * This is the shape a crew actually sends — date, where, how long, what —
 * and reading it field-wise rather than word-wise fixes two things that
 * guessing could not. The address is matched whole, so "81 Esmonde St" hits
 * the street exactly; and a street NUMBER can no longer be read as the
 * hours, which turned "15 Kipling St - 6" into fifteen hours on whichever
 * job was in progress plus a second entry of six.
 *
 * Returns null when the line is not in that shape, and the word-wise reader
 * takes it instead. The test is one field that is nothing but hours: two of
 * them means two jobs on the line, which words handle better.
 */
function readFieldLine(
  line: string,
  state: { worker: string; workerMatched: boolean; lastDate: string; weekOf?: string },
  ctx: ReadContext,
): DraftEntry[] | null {
  const hpd = Number(ctx.hoursPerDay) > 0 ? Number(ctx.hoursPerDay) : 8
  const fs = fields(line)
  if (fs.length < 2) return null

  const hourAt = fs.map((f, i) => (parseHours(f, hpd) !== null ? i : -1)).filter(i => i >= 0)
  if (hourAt.length !== 1) return null
  const hi = hourAt[0]
  const hours = parseHours(fs[hi], hpd)!

  // The date, from wherever it sits before the hours.
  let date = ''
  const before: string[] = []
  for (let i = 0; i < hi; i++) {
    const d = !date ? parseDate(fs[i], ctx.todayStr, state.weekOf) : null
    if (d) { date = d; continue }
    before.push(fs[i])
  }
  if (!date) date = state.lastDate
  if (!date) return null

  // A worker named on the line itself beats the heading above it.
  let lineWorker: { name: string; matched: boolean } | null = null
  const forJob: string[] = []
  for (const f of before) {
    const m = matchWorker(f, ctx.crew)
    if (!lineWorker && m.matched) { lineWorker = m; continue }
    forJob.push(f)
  }

  // Each remaining field tried whole, longest first — an address is one
  // field and matching it entire is the point of reading this way.
  let match: JobMatch = { job: null, candidates: [] }
  let used = -1
  for (let i = 0; i < forJob.length; i++) {
    const m = matchJob(forJob[i], ctx.jobs)
    if (m.job || m.candidates.length) { match = m; used = i; break }
  }

  const said = forJob.join(' ')
  const task = [
    ...forJob.filter((_f, i) => i !== used && used >= 0),
    ...fs.slice(hi + 1),
  ].join(' ').trim()

  const entry: DraftEntry = {
    key: key(),
    source: line,
    via: 'format',
    worker: lineWorker?.name || state.worker,
    workerMatched: lineWorker ? lineWorker.matched : state.workerMatched,
    hours,
    date,
    job_id: match.job?.id ?? null,
    jobCandidates: match.candidates.length ? match.candidates : undefined,
    saidJob: said || undefined,
    description: task || undefined,
  }
  // Hours with nobody and nothing to put them against is not an entry.
  return entry.hours > 0 && (entry.worker || entry.job_id || entry.jobCandidates?.length)
    ? [entry]
    : []
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
  state: { worker: string; workerMatched: boolean; lastDate: string; weekOf?: string },
  ctx: ReadContext,
): DraftEntry[] {
  // The writer's own fields where there are any; words where there are not.
  const byField = readFieldLine(line, state, ctx)
  if (byField && byField.length) return byField

  const hpd = Number(ctx.hoursPerDay) > 0 ? Number(ctx.hoursPerDay) : 8
  const all = mergeBreaks(words(line), hpd)
  if (!all.length) return []

  // The date, wherever it sits, read once for the whole line.
  let date = ''
  const rest: string[] = []
  for (const f of all) {
    const d = !date ? parseDate(f, ctx.todayStr, state.weekOf) : null
    if (d) { date = d; continue }
    rest.push(f)
  }
  if (!date) date = state.lastDate
  if (!date) return []

  const out: DraftEntry[] = []
  let bucket: string[] = []
  for (const f of rest) {
    const h = parseHours(f, hpd)
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
      saidJob: forJob.join(' ') || undefined,
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
  aiEntries: Array<{
    worker: string; job?: string; jobSaid?: string
    date?: string; hours: number; note?: string
  }>,
  ctx: ReadContext,
): DraftEntry[] {
  return aiEntries.map(e => {
    const w = matchWorker(e.worker, ctx.crew)
    // The id it named, checked against the real jobs — then, failing that,
    // whatever the message itself called the place. Two chances at the job,
    // and neither of them trusted on the model's say-so.
    const byId = e.job ? matchJob(e.job, ctx.jobs) : { job: null, candidates: [] }
    const m = byId.job || byId.candidates.length
      ? byId
      : e.jobSaid ? matchJob(e.jobSaid, ctx.jobs) : byId
    const date = e.date ? parseDate(e.date, ctx.todayStr) : null
    return {
      key: key(),
      source: [e.date, e.worker, e.jobSaid || e.job, `${e.hours}h`, e.note].filter(Boolean).join('  '),
      via: 'ai' as const,
      worker: w.name,
      workerMatched: w.matched,
      hours: r2(Number(e.hours) || 0),
      date: date ?? ctx.todayStr,
      job_id: m.job?.id ?? null,
      jobCandidates: m.candidates.length ? m.candidates : undefined,
      saidJob: e.jobSaid || e.job || undefined,
      description: e.note || undefined,
    }
  }).map(d => settleJob(d, ctx)).filter(d => d.hours > 0)
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
  '',
  '23/10 - 81 Esmonde St - 8 - masking and first coat',
  '24/10 - 15 Kipling St - 6 - sanding and prep',
  '25/10 - 81 Esmonde St - 1 day - second coat',
].join('\n')
