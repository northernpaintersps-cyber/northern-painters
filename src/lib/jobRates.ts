// What jobs actually cost, per unit, from what was logged against them.
//
// BENCHMARKS was ten hardcoded dollar ranges — "Interior medium, $7,700 to
// $16,500" — with no quantity underneath. There is no way to quote from that:
// you cannot divide it by anything.
//
// The numbers to do it properly are already there and nothing reads them.
// np_jobs.extra.substrates holds the measured takeoff for every job created
// through the quoting tool, and np_labour and np_materials hold what the job
// then cost. Joining the two gives real dollars and real hours per square
// metre, in the same substrate keys the quote builder uses.
//
// Two honest limits, stated here because they decide how the output may be
// used:
//
//  1. A labour entry records hours against a job, not against a surface. So
//     these are BLENDED per-job rates. Nothing here claims to know what the
//     ceilings cost as against the walls.
//  2. The quantities are what was quoted, never reconciled against what was
//     painted. A variation adds dollars with no quantity, which inflates the
//     rate — so jobs with approved variations are flagged, not silently mixed
//     in.

import { PROD_RATES } from './quoteData'
import { SUB_BY_KEY, substrateTotals } from './substrates'
import { labCost, matCost } from './utils'

type Row = Record<string, any>

export interface JobRate {
  jobId: string
  client: string
  type: string
  date: string

  /** What it was sold for, ex GST, variations included. */
  revenueExGST: number
  labourCost: number
  materialCost: number
  totalCost: number
  /** Hours actually logged. */
  hours: number

  quantities: Record<string, number>
  /** Square metres of painted surface — the denominator for an area rate. */
  sqm: number
  lm: number
  counts: number

  /**
   * How much of the work this job is, by the book, in area substrates. A job
   * that is mostly doors and downpipes has a meaningless cost per m2, so a
   * low share here disqualifies it from the area rate rather than poisoning
   * the average.
   */
  sqmShare: number

  /** Hours the production rates predict for these quantities. */
  bookHours: number
  /**
   * Actual hours over book hours. This is the useful number: it says what
   * your crew really does against the standard rates, and it applies to
   * every substrate without pretending to have measured any of them.
   */
  calibration: number | null

  costPerSqm: number | null
  hoursPerSqm: number | null
  pricePerSqm: number | null
  marginPct: number | null

  hasVariations: boolean
  /** Why this job cannot be used, '' when it can. */
  excluded: string
}

/** A job is only usable for an area rate when area is most of the work. */
export const MIN_SQM_SHARE = 0.6
/** Below this there is not enough measured area for the rate to mean much. */
export const MIN_SQM = 20
/** A calibration outside this is a data problem, not a slow crew. */
export const CALIBRATION_BOUNDS: [number, number] = [0.3, 4]

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

export function median(xs: number[]): number | null {
  const v = xs.filter(Number.isFinite).sort((a, b) => a - b)
  if (!v.length) return null
  const mid = Math.floor(v.length / 2)
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2
}

/** The takeoff stored on a job, in whatever shape it was written. */
export function quantitiesOf(job: Row): Record<string, number> {
  const raw = job?.extra?.substrates
  if (!raw || typeof raw !== 'object') return {}
  try {
    // Written as the full entry record; substrateTotals handles both that and
    // the flat {key: number} shape older rows may carry.
    const totals = substrateTotals(raw as any)
    if (Object.keys(totals).length) return totals
  } catch { /* fall through */ }
  const flat: Record<string, number> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (SUB_BY_KEY[k] && Number(v) > 0) flat[k] = Number(v)
  }
  return flat
}

export function buildJobRates(input: {
  jobs: Row[]
  labour: Row[]
  materials: Row[]
  variations?: Row[]
}): JobRate[] {
  const { jobs, labour, materials, variations = [] } = input

  const by = <T extends Row>(rows: T[]) => {
    const m = new Map<string, T[]>()
    rows.forEach(r => {
      if (!r.job_id) return
      const list = m.get(r.job_id)
      if (list) list.push(r); else m.set(r.job_id, [r])
    })
    return m
  }
  const labByJob = by(labour)
  const matByJob = by(materials)
  const varByJob = by(variations)

  return jobs
    .filter(j => j.status === 'Finished')
    .map<JobRate>(j => {
      const quantities = quantitiesOf(j)
      const labs = labByJob.get(j.id) ?? []
      const mats = matByJob.get(j.id) ?? []
      const vars = (varByJob.get(j.id) ?? []).filter(v => v.var_status === 'Approved')

      // Every logged row, not just the billable ones: labBillable excludes
      // fixed-price jobs, and those are most of them.
      const labourCost = sum(labs.map(labCost))
      const materialCost = sum(mats.map(matCost))
      const hours = sum(labs.map(l => Number(l.hours) || 0))
      const revenueExGST = (Number(j.agreed_ex_gst) || Number(j.quote_ex_gst) || 0)
        + sum(vars.map(v => Number(v.amount_ex_gst) || 0))

      let sqm = 0, lm = 0, counts = 0, bookHours = 0, sqmBookHours = 0
      for (const [key, qty] of Object.entries(quantities)) {
        const sub = SUB_BY_KEY[key]
        if (!sub) continue
        const bh = qty * (PROD_RATES[key] ?? 0)
        bookHours += bh
        if (sub.unit === 'sqm') { sqm += qty; sqmBookHours += bh }
        else if (sub.unit === 'lm') lm += qty
        else counts += qty
      }

      const sqmShare = bookHours > 0 ? sqmBookHours / bookHours : 0
      const totalCost = labourCost + materialCost
      const calibration = bookHours > 0 && hours > 0 ? hours / bookHours : null

      const r1 = (n: number) => Math.round(n * 100) / 100
      const usableArea = sqm >= MIN_SQM && sqmShare >= MIN_SQM_SHARE

      let excluded = ''
      if (!Object.keys(quantities).length) excluded = 'no quantities recorded'
      else if (!labs.length && !mats.length) excluded = 'nothing logged against it'
      else if (!revenueExGST) excluded = 'no agreed price'
      else if (!usableArea) {
        // Share first: a cabinets job has no area at all, and calling that
        // "too little measured area" hides the real reason.
        excluded = sqmShare < MIN_SQM_SHARE
          ? 'mostly counted and lineal work, so an area rate would mislead'
          : 'too little measured area'
      }

      return {
        jobId: j.id,
        client: j.client ?? '',
        type: j.type ?? '',
        date: j.sched_start ?? j.created_at?.slice(0, 10) ?? '',
        revenueExGST,
        labourCost: r1(labourCost),
        materialCost: r1(materialCost),
        totalCost: r1(totalCost),
        hours: r1(hours),
        quantities,
        sqm: r1(sqm), lm: r1(lm), counts: r1(counts),
        sqmShare: Math.round(sqmShare * 100) / 100,
        bookHours: r1(bookHours),
        calibration: calibration != null ? Math.round(calibration * 100) / 100 : null,
        costPerSqm: usableArea && totalCost > 0 ? r1(totalCost / sqm) : null,
        hoursPerSqm: usableArea && hours > 0 ? Math.round((hours / sqm) * 1000) / 1000 : null,
        pricePerSqm: usableArea && revenueExGST > 0 ? r1(revenueExGST / sqm) : null,
        marginPct: revenueExGST > 0
          ? Math.round(((revenueExGST - totalCost) / revenueExGST) * 1000) / 10
          : null,
        hasVariations: vars.length > 0,
        excluded,
      }
    })
}

export interface ServiceRate {
  type: string
  /** Jobs behind the figures. Below three, treat them as an anecdote. */
  samples: number
  costPerSqm: number | null
  pricePerSqm: number | null
  hoursPerSqm: number | null
  marginPct: number | null
  /** Actual hours over book hours, median. Multiplies the standard rates. */
  calibration: number | null
  /** Jobs with quantities but excluded from the area rate, and why. */
  excludedCount: number
}

/**
 * Rates per service. Medians rather than means — one Queenslander with a
 * three-week scaffold hire would drag a mean somewhere useless.
 */
export function serviceRates(rates: JobRate[]): ServiceRate[] {
  const byType = new Map<string, JobRate[]>()
  rates.forEach(r => {
    if (!r.type) return
    const list = byType.get(r.type)
    if (list) list.push(r); else byType.set(r.type, [r])
  })

  return [...byType.entries()].map(([type, all]) => {
    const usable = all.filter(r => !r.excluded)
    const calibrations = all
      .map(r => r.calibration)
      .filter((c): c is number => c != null && c >= CALIBRATION_BOUNDS[0] && c <= CALIBRATION_BOUNDS[1])
    return {
      type,
      samples: usable.length,
      costPerSqm: median(usable.map(r => r.costPerSqm!).filter(Number.isFinite)),
      pricePerSqm: median(usable.map(r => r.pricePerSqm!).filter(Number.isFinite)),
      hoursPerSqm: median(usable.map(r => r.hoursPerSqm!).filter(Number.isFinite)),
      marginPct: median(usable.map(r => r.marginPct!).filter(Number.isFinite)),
      calibration: median(calibrations),
      excludedCount: all.length - usable.length,
    }
  }).sort((a, b) => b.samples - a.samples)
}

/** Finished jobs with no takeoff recorded — the back-fill list. */
export function needsQuantities(rates: JobRate[]): JobRate[] {
  return rates
    .filter(r => r.excluded === 'no quantities recorded' && r.revenueExGST > 0)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
}
