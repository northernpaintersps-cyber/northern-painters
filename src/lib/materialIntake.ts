// A week of supplier invoices, reviewed in one sitting.
//
// The Materials page already scans one invoice at a time: pick a file, the
// extractor fills the form, you check it and save. That is the right shape for
// a receipt photographed at the counter and the wrong one for the twelve PDFs
// that arrived by email since Monday — twelve round trips through a modal,
// with the duplicate warning and the job match re-read from scratch each time.
//
// So: drop the lot, let each one extract, then review a list where every row
// already carries its suggested job and its duplicate warning, and approve the
// ones that are right. Nothing reaches np_materials until it is approved.
//
// Two things this has to get right, both of them learned the hard way on this
// data rather than guessed at:
//
//   1. Duplicates are caught before they are written, not after. A fortnight
//      was spent unpicking duplicated material rows from an earlier import;
//      the check that exists (findDuplicateMaterial) is run against the saved
//      table AND against the rest of the batch, because the same invoice
//      arriving twice in one email folder is exactly how this happens.
//   2. A job is suggested, never assumed. The extractor reads a delivery
//      address off the invoice and that is a guess about which job it belongs
//      to — a good one, worth showing, and still a guess. The whole point of
//      reviewing is to catch the one it puts on the wrong house.

import { findDuplicateMaterial, genId } from './utils'

type Row = Record<string, any>

const n = (v: any): number => {
  const x = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return Number.isFinite(x) ? x : 0
}
const r2 = (x: number) => Math.round(x * 100) / 100

/** Words in an address that match everything and so distinguish nothing. */
const NOISE = new Set([
  'street', 'st', 'road', 'rd', 'avenue', 'ave', 'drive', 'dr', 'lane', 'ln',
  'court', 'ct', 'close', 'cl', 'place', 'pl', 'way', 'crescent', 'cres',
  'parade', 'pde', 'terrace', 'tce', 'highway', 'hwy', 'unit', 'lot',
  'nsw', 'qld', 'vic', 'australia', 'au', 'and', 'the',
])

const tokens = (s: unknown): string[] =>
  String(s ?? '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/)
    .filter(w => w && !NOISE.has(w))

/** How many days either side of an invoice count as "this job was running". */
export const ACTIVE_DAYS = 14

const dayOf = (s: unknown): number | null => {
  const t = Date.parse(`${String(s ?? '').slice(0, 10)}T00:00:00`)
  return Number.isFinite(t) ? Math.floor(t / 864e5) : null
}

/**
 * The jobs being worked on around a date.
 *
 * Measured on this data before it was built: of 126 material purchases that
 * already carry a job, the right job had labour or materials logged within a
 * week 96% of the time — but a median of 6 jobs qualified. So this is an
 * excellent filter and a hopeless picker, and it is only ever used as the
 * former. A job is never suggested because it was active; an address match is
 * only believed, or disbelieved, in the light of whether it was.
 */
export function activeJobs(
  rows: Row[], onDate: unknown, days = ACTIVE_DAYS,
): Set<string> {
  const d = dayOf(onDate)
  const out = new Set<string>()
  if (d === null) return out
  for (const r of rows) {
    if (!r.job_id) continue
    const rd = dayOf(r.date)
    if (rd !== null && Math.abs(rd - d) <= days) out.add(String(r.job_id))
  }
  return out
}

export interface JobMatch {
  jobId: string | null
  /** 0–1. Below CONFIDENT the suggestion is shown but not pre-selected. */
  score: number
  /** What matched, for the reviewer: "12 Bay St" rather than a number. */
  on: string
  /** True when work was logged on this job around the invoice date. */
  active?: boolean
  /** Set when the address alone could not decide and activity did. */
  decidedByActivity?: boolean
}

/** At or above this a suggestion is good enough to fill in for you. */
export const CONFIDENT = 0.6

/**
 * Which job an invoice's delivery address points at.
 *
 * The page did this inline with `a.includes(addr.split(',')[0])`, which
 * matches "12" against "12 Bay St" and "120 Bay St" alike, and matches
 * nothing at all when the invoice writes "Unit 2/12 Bay". Scoring on shared
 * words, with street types and states dropped as noise, is both stricter
 * about numbers and looser about formatting.
 *
 * A street number must match if both sides have one. "12 Bay St" and "14 Bay
 * St" are different houses and often different clients, and a wrong job here
 * is the error the whole review step exists to prevent.
 *
 * `active` is the set of jobs being worked around the invoice date. It never
 * creates a match — see activeJobs — but it decides between two addresses
 * that score the same, and it rescues the case the address cannot answer at
 * all. Ten of this business's ninety jobs have an address with no street
 * number ("Billinudgel", "Newrybar", "Wategos Beach") and five pairs are
 * indistinguishable from one another; those are the twenty where the string
 * has run out of information and something else has to supply it.
 */
export function matchJob(
  jobs: Row[], address: unknown, client?: unknown, active?: Set<string> | null,
): JobMatch {
  const want = tokens(address)
  if (!want.length && !String(client ?? '').trim()) return { jobId: null, score: 0, on: '' }

  const wantNums = want.filter(w => /^\d+$/.test(w))
  const scored: { id: string; score: number; on: string }[] = []

  for (const j of jobs) {
    const have = tokens(j.address)
    const haveNums = have.filter(w => /^\d+$/.test(w))

    let score = 0
    if (have.length && want.length) {
      // A street number on both sides that disagrees rules the job out.
      if (wantNums.length && haveNums.length && !wantNums.some(w => haveNums.includes(w))) continue
      const shared = want.filter(w => have.includes(w)).length
      score = shared / Math.max(1, Math.min(want.length, have.length))
      // A matching number is worth more than a matching street name.
      if (wantNums.length && haveNums.some(h => wantNums.includes(h))) score = Math.min(1, score + 0.2)
    }

    // The client name is weaker evidence than the address — two jobs for the
    // same builder are common — so it only lifts a score, never makes one.
    const c = tokens(client)
    if (c.length && score > 0) {
      const jc = tokens(j.client)
      if (c.some(w => jc.includes(w))) score = Math.min(1, score + 0.15)
    }

    if (score > 0) scored.push({ id: String(j.id), score, on: String(j.address ?? '') })
  }

  if (!scored.length) return { jobId: null, score: 0, on: '' }
  scored.sort((a, b) => b.score - a.score)

  const top = scored[0].score
  // Everything the address cannot separate from the leader.
  const tied = scored.filter(s => top - s.score < 0.1)
  const live = active ? tied.filter(s => active.has(s.id)) : []

  // Activity decides, but only when it decides cleanly: exactly one of the
  // tied jobs was being worked. Two active candidates is still a question for
  // a person, and so is none.
  const decided = live.length === 1 ? live[0] : null
  const pick = decided ?? scored[0]
  const wasActive = !!active?.has(pick.id)

  let score = pick.score
  let decidedByActivity = false

  if (decided && tied.length > 1) {
    // The address was ambiguous and the work log was not. That is a real
    // answer, so it is allowed to be filled in — but it is marked, because
    // the reviewer should know the address alone did not pick this job.
    score = Math.max(score, CONFIDENT)
    decidedByActivity = true
  } else {
    // An address with no street number cannot identify a house. "Byron Bay"
    // shares every word with "12 Bay St, Byron Bay" and scored a perfect
    // match — on both Bay St jobs equally, so it took whichever came first.
    // It is still worth offering; it is not worth filling in.
    if (!wantNums.length) score = Math.min(score, CONFIDENT - 0.2)
    // And an unresolved near-tie is nobody's to break but the reviewer's.
    if (tied.length > 1) score = Math.min(score, CONFIDENT - 0.1)
  }

  // A job nobody has touched for a fortnight is not where today's paint went,
  // whatever its address says. Not ruled out — a delivery can precede the
  // first day on site, and the work log can simply be behind — but not filled
  // in either, which leaves it as a one-click suggestion.
  if (active && active.size > 0 && !wasActive) score = Math.min(score, CONFIDENT - 0.1)

  return {
    jobId: pick.id,
    score: r2(score),
    on: pick.on,
    active: wasActive,
    ...(decidedByActivity ? { decidedByActivity: true } : {}),
  }
}

export type IntakeStatus = 'pending' | 'approved' | 'rejected' | 'failed'

export interface IntakeRow {
  /** Stable for the life of the batch, so edits survive a re-render. */
  key: string
  fileName: string
  status: IntakeStatus
  /** Set when extraction itself failed — the row is kept so it is not lost. */
  error?: string

  supplier: string
  mat_desc: string
  date: string
  receipt_no: string
  cost_ex_gst: number
  gst: number
  total_inc_gst: number
  category: string
  notes: string
  job_id: string
  line_items: any[]

  /** The address the extractor read, kept so a wrong match can be understood. */
  invoiceAddress: string
  suggestion: JobMatch
  /** Set when this looks like something already in np_materials, or earlier
   *  in this same batch. */
  duplicateOf?: { id: string; basis: string; sameSupplier: boolean; inBatch: boolean }
}

/** One extracted invoice, before anybody has looked at it. */
export function intakeRow(
  extraction: Row, fileName: string, jobs: Row[], key?: string,
  /** Jobs worked around this invoice's date — see activeJobs. */
  active?: Set<string> | null,
): IntakeRow {
  const suggestion = matchJob(jobs, extraction.job_address, extraction.supplier, active)
  const ex = n(extraction.cost_ex_gst)
  const gst = n(extraction.gst)
  return {
    key: key ?? genId('intake'),
    fileName,
    status: 'pending',
    supplier: String(extraction.supplier ?? '').trim(),
    mat_desc: String(extraction.description ?? '').trim(),
    date: String(extraction.date ?? '').trim(),
    receipt_no: String(extraction.receipt_no ?? '').trim(),
    cost_ex_gst: r2(ex),
    gst: r2(gst),
    total_inc_gst: r2(n(extraction.total_inc_gst) || ex + gst),
    category: String(extraction.category ?? '').trim(),
    notes: String(extraction.notes ?? '').trim(),
    // Only a confident match is filled in. A weak one is still shown, so the
    // reviewer can accept it with one click, but it is not pre-selected: a
    // wrong job that nobody had to choose is the one that gets approved by
    // accident.
    job_id: suggestion.score >= CONFIDENT ? (suggestion.jobId ?? '') : '',
    line_items: Array.isArray(extraction.items) ? extraction.items : [],
    invoiceAddress: String(extraction.job_address ?? '').trim(),
    suggestion,
  }
}

/** A row that could not be read, kept in the list rather than dropped. */
export function failedRow(fileName: string, error: string, key?: string): IntakeRow {
  return {
    ...intakeRow({}, fileName, [], key),
    status: 'failed',
    error,
  }
}

/**
 * Mark anything that is already on file, or that is in this batch twice.
 *
 * Run over the whole batch rather than per row, because the second copy of an
 * invoice is only a duplicate of the first — whichever order they were read
 * in. The earlier row keeps its place and the later one carries the warning.
 */
export function flagDuplicates(rows: IntakeRow[], materials: Row[]): IntakeRow[] {
  const seen: IntakeRow[] = []
  return rows.map(r => {
    if (r.status === 'failed') return r

    const candidate = {
      receipt_no: r.receipt_no, supplier: r.supplier,
      date: r.date, cost_ex_gst: r.cost_ex_gst,
    }
    const onFile = findDuplicateMaterial(materials, candidate)
    const inBatch = !onFile ? findDuplicateMaterial(
      seen.map(s => ({ ...s, id: s.key })), candidate) : null

    seen.push(r)
    const hit = onFile ?? inBatch
    if (!hit) {
      const { duplicateOf, ...rest } = r
      return rest as IntakeRow
    }
    return {
      ...r,
      duplicateOf: {
        id: String((hit.row as Row).id ?? ''),
        basis: hit.basis,
        sameSupplier: hit.sameSupplier,
        inBatch: !onFile,
      },
    }
  })
}

/** What np_materials wants, from a row somebody has approved. */
export function toMaterial(r: IntakeRow, userId: string): Row {
  return {
    id: genId('mat'),
    user_id: userId,
    job_id: r.job_id || null,
    date: r.date || null,
    supplier: r.supplier || null,
    mat_desc: r.mat_desc || null,
    cost_ex_gst: r2(r.cost_ex_gst),
    gst: r2(r.gst),
    total_inc_gst: r2(r.total_inc_gst || r.cost_ex_gst + r.gst),
    category: r.category || null,
    receipt_no: r.receipt_no || null,
    // Every row says where it came from. A material that turns up in a BAS
    // detail six months from now should be traceable to the file it was read
    // out of without anybody having to remember this feature existed.
    notes: [r.notes, `[imported ${new Date().toISOString().slice(0, 10)} from ${r.fileName}]`]
      .filter(Boolean).join(' '),
    paid_by: 'Bank',
    line_items: r.line_items.length ? r.line_items : null,
  }
}

export interface IntakeCounts {
  total: number
  pending: number
  approved: number
  rejected: number
  failed: number
  duplicates: number
  /** Pending, no job chosen — the ones that still need a decision. */
  needJob: number
  /** What the pending rows come to, so the batch can be sanity-checked
   *  against the supplier statement before any of it is saved. */
  pendingExGST: number
  pendingGST: number
}

export function counts(rows: IntakeRow[]): IntakeCounts {
  const pending = rows.filter(r => r.status === 'pending')
  return {
    total: rows.length,
    pending: pending.length,
    approved: rows.filter(r => r.status === 'approved').length,
    rejected: rows.filter(r => r.status === 'rejected').length,
    failed: rows.filter(r => r.status === 'failed').length,
    duplicates: pending.filter(r => r.duplicateOf).length,
    needJob: pending.filter(r => !r.job_id).length,
    pendingExGST: r2(pending.reduce((s, r) => s + r.cost_ex_gst, 0)),
    pendingGST: r2(pending.reduce((s, r) => s + r.gst, 0)),
  }
}

/**
 * Is this row safe to save?
 *
 * A date and an amount are required because a material without either is
 * useless to every report that reads the table. A job is not required — a
 * general stock purchase legitimately belongs to no job — but a duplicate
 * must be dismissed deliberately rather than approved in a sweep.
 */
export function problemWith(r: IntakeRow): string | null {
  if (r.status === 'failed') return 'Could not be read'
  if (!r.date) return 'No date'
  if (!r.supplier) return 'No supplier'
  if (!r.cost_ex_gst && !r.total_inc_gst) return 'No amount'
  return null
}

/** The rows an Approve all would take: everything clean and unambiguous. */
export const readyToApprove = (rows: IntakeRow[]): IntakeRow[] =>
  rows.filter(r => r.status === 'pending' && !r.duplicateOf && !problemWith(r) && !!r.job_id)

/**
 * The job list, ordered for somebody choosing by hand.
 *
 * Every case the matcher cannot answer ends here, and that is not a small
 * set: ten of ninety jobs have an address with no street number, so they will
 * be chosen by hand every time no matter how good the matching gets. Putting
 * the jobs that were being worked that fortnight at the top turns a search
 * into a glance.
 */
export function jobsForPicker(jobs: Row[], active: Set<string>): Row[] {
  if (!active.size) return jobs
  const live: Row[] = []
  const rest: Row[] = []
  for (const j of jobs) (active.has(String(j.id)) ? live : rest).push(j)
  return [...live, ...rest]
}
