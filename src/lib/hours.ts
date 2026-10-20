// The labour hours budget on a job, and what is left of it.
//
// A job is quoted in dollars, not hours, so the hours budget is derived: the
// labour estimate divided by the rate that estimate was built at. That is
// the only honest reading — a job quoted at $6,500 of labour at $65/hr is a
// hundred hours, and logging the hundred and first is the moment to know.
//
// Worked out in one place because the Costs page shows it three times over
// and the Dashboard shows it again; four copies of a division is three
// chances for them to disagree about which rate to use.
//
// Pure — no hooks, no Supabase.

type Row = Record<string, any>

const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0 }

export interface JobHours {
  /** The rate the budget is worked out at. */
  rate: number
  /** Hours the labour estimate buys, or null when the job has no estimate. */
  budgeted: number | null
  logged: number
  /** budgeted − logged. Negative is over. Null when there is no budget. */
  remaining: number | null
  /** logged ÷ budgeted, null when there is no budget. */
  used: number | null
  over: boolean
  /** Inside the last quarter of the budget, but not yet past it. */
  tight: boolean
}

/** Hours logged against a job. */
export const hoursLogged = (labour: Row[], jobId: string): number =>
  labour.reduce((s, l) => l.job_id === jobId ? s + n(l.hours) : s, 0)

/**
 * The hours position on one job.
 *
 * `fallbackRate` is the business default, used when the job carries no rate
 * of its own — a job quoted before rates were recorded still has to produce
 * a number rather than a blank.
 */
export function jobHours(job: Row, labour: Row[], fallbackRate: number): JobHours {
  const rate = n(job?.labour_rate) || n(fallbackRate) || 0
  const estimate = n(job?.est_labour_ex)
  const logged = Math.round(hoursLogged(labour, job?.id) * 100) / 100
  // No estimate, or no rate to divide it by, means no budget — not zero
  // hours, which would read as "you are a hundred hours over".
  const budgeted = estimate > 0 && rate > 0 ? Math.round((estimate / rate) * 100) / 100 : null
  if (budgeted === null) {
    return { rate, budgeted: null, logged, remaining: null, used: null, over: false, tight: false }
  }
  const remaining = Math.round((budgeted - logged) * 100) / 100
  const used = budgeted > 0 ? logged / budgeted : null
  return {
    rate, budgeted, logged, remaining, used,
    over: remaining < 0,
    tight: remaining >= 0 && remaining < budgeted * 0.25,
  }
}

/** The colour the remaining figure is shown in: over, tight, or fine. */
export const hoursColour = (h: JobHours): string =>
  h.remaining === null ? '#666' : h.over ? '#dc2626' : h.tight ? '#d97706' : '#16a34a'

/** "+12.5" / "−3.0" / "—", as the figure is printed. */
export const hoursLabel = (h: JobHours): string =>
  h.remaining === null ? '—'
    : h.remaining < 0 ? h.remaining.toFixed(1)
    : '+' + h.remaining.toFixed(1)

export interface HoursSummary {
  /** Jobs that have an hours budget, worst position first. */
  rows: { job: Row; hours: JobHours }[]
  /** Jobs with hours logged but no budget to judge them against. */
  unbudgeted: { job: Row; hours: JobHours }[]
  totalBudgeted: number
  totalLogged: number
  totalRemaining: number
  overCount: number
  tightCount: number
}

/**
 * Every job's hours position, ranked by how much trouble it is in.
 *
 * Over budget first and the worst overrun at the top, then the tight ones,
 * then everything with room — so the list answers "where am I losing hours"
 * from its first row rather than from a scroll.
 */
export function hoursSummary(jobs: Row[], labour: Row[], fallbackRate: number): HoursSummary {
  const all = jobs.map(job => ({ job, hours: jobHours(job, labour, fallbackRate) }))
  const rows = all.filter(r => r.hours.budgeted !== null)
  const unbudgeted = all.filter(r => r.hours.budgeted === null && r.hours.logged > 0)

  rows.sort((a, b) => {
    // Most over first; among those with room, the tightest first.
    const ra = a.hours.remaining ?? 0, rb = b.hours.remaining ?? 0
    if (a.hours.over !== b.hours.over) return a.hours.over ? -1 : 1
    if (a.hours.over) return ra - rb                     // −40 before −2
    return (a.hours.used ?? 0) > (b.hours.used ?? 0) ? -1 : 1
  })

  const r2 = (v: number) => Math.round(v * 100) / 100
  return {
    rows, unbudgeted,
    totalBudgeted: r2(rows.reduce((s, r) => s + (r.hours.budgeted ?? 0), 0)),
    totalLogged: r2(all.reduce((s, r) => s + r.hours.logged, 0)),
    totalRemaining: r2(rows.reduce((s, r) => s + (r.hours.remaining ?? 0), 0)),
    overCount: rows.filter(r => r.hours.over).length,
    tightCount: rows.filter(r => r.hours.tight).length,
  }
}
