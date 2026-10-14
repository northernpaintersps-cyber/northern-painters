// The join that nothing performed: quote ↔ logged labour ↔ logged materials.
//
// Every number in here is computed in code. What goes to the model is this,
// already added up, and its job is judgement — which jobs are comparable,
// which are outliers and why, how much confidence a figure deserves, and what
// cannot be established at all. The same division that keeps the assistant
// honest: arithmetic here, interpretation there.
//
// Read the per-job rows and you can see exactly what any rate rests on, which
// is the point. A rate you cannot trace is a rate you cannot defend to a
// client.

import { SUB_BY_KEY, unitLabel } from '@/lib/substrates'
import { PROD_RATES } from '@/lib/quoteData'
import { labCost, matCost } from '@/lib/utils'
import { quotedQuantities, actualQuantities, takeoffFor, type TakeoffKind } from '@/lib/jobRates'
import { jobPhases, splitHours, type JobPhase } from '@/lib/phases'

type Row = Record<string, any>

const r2 = (n: number) => Math.round(n * 100) / 100
const r3 = (n: number) => Math.round(n * 1000) / 1000
const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0)

export interface PhaseRecord {
  name: string
  covers: string[]
  /** Hours put against it when quoting. 0 where the estimator left it blank. */
  quotedHours: number
  /** Hours actually logged against it. */
  actualHours: number
}

export interface SubstrateRecord {
  key: string
  label: string
  unit: string
  quoted: number
  actual: number | null
  /** Book hours for the quoted figure, from PROD_RATES. */
  bookHours: number
  /**
   * Logged hours attributed here through the phases that cover it. Null when
   * no phase-tagged hours reach it — which is the normal state until tagging
   * has been in use for a while, and must read as "unknown" and not as zero.
   */
  loggedHours: number | null
}

export interface JobRecord {
  jobId: string
  client: string
  type: string
  date: string
  status: string

  revenueExGST: number
  approvedVariations: number
  hasVariations: boolean

  labourCost: number
  materialCost: number
  materialsByCategory: Record<string, number>

  hours: number
  /** Hours on entries carrying no phase. Part of the total. */
  untaggedHours: number
  taggedShare: number

  bookHours: number
  takeoffKind: TakeoffKind
  substrates: SubstrateRecord[]
  phases: PhaseRecord[]

  /** Why this job cannot carry an area rate, if it cannot. */
  excluded: string
}

export interface RateDataset {
  generatedAt: string
  jobs: JobRecord[]
  /** Counts the model should not have to work out for itself. */
  coverage: {
    finishedJobs: number
    withTakeoff: number
    withActualTakeoff: number
    withLoggedHours: number
    withAnyPhaseTag: number
    byService: Record<string, number>
  }
}

const byJob = <T extends Row>(rows: T[]): Map<string, T[]> => {
  const m = new Map<string, T[]>()
  for (const r of rows) {
    if (!r.job_id) continue
    const list = m.get(String(r.job_id))
    if (list) list.push(r); else m.set(String(r.job_id), [r])
  }
  return m
}

/** Book hours per substrate, which is also how a phase's hours get weighted. */
const bookHoursPer = (q: Record<string, number>): Record<string, number> =>
  Object.fromEntries(Object.entries(q)
    .filter(([k]) => SUB_BY_KEY[k])
    .map(([k, qty]) => [k, qty * (PROD_RATES[k] ?? 0)]))

export function buildRateDataset(input: {
  jobs: Row[]
  labour: Row[]
  materials: Row[]
  variations?: Row[]
}): RateDataset {
  const { jobs, labour, materials, variations = [] } = input
  const labByJob = byJob(labour)
  const matByJob = byJob(materials)
  const varByJob = byJob(variations)

  const finished = jobs.filter(j => j.status === 'Finished')

  const rows: JobRecord[] = finished.map(j => {
    const id = String(j.id)
    const labs = labByJob.get(id) ?? []
    const mats = matByJob.get(id) ?? []
    const vars = (varByJob.get(id) ?? []).filter(v => v.var_status === 'Approved')

    const quoted = quotedQuantities(j)
    const actual = actualQuantities(j)
    const hasActual = Object.keys(actual).length > 0
    const { kind: takeoffKind } = takeoffFor(j)

    const book = bookHoursPer(quoted)
    const phases = jobPhases(j)
    const split = splitHours(phases, labs, book)

    const varTotal = sum(vars.map(v => Number(v.amount_ex_gst) || 0))

    const matsByCat: Record<string, number> = {}
    for (const m of mats) {
      const cat = String(m.category ?? '').trim() || 'Uncategorised'
      matsByCat[cat] = r2((matsByCat[cat] ?? 0) + matCost(m))
    }

    const keys = [...new Set([...Object.keys(quoted), ...Object.keys(actual)])]
      .filter(k => SUB_BY_KEY[k])
    const substrates: SubstrateRecord[] = keys.map(k => ({
      key: k,
      label: SUB_BY_KEY[k].label,
      unit: unitLabel(SUB_BY_KEY[k].unit),
      quoted: r2(quoted[k] ?? 0),
      actual: hasActual ? r2(actual[k] ?? 0) : null,
      bookHours: r2((quoted[k] ?? 0) * (PROD_RATES[k] ?? 0)),
      // Null, not zero: no tagged hours reaching a surface means unknown.
      loggedHours: split.bySubstrate[k] != null ? r2(split.bySubstrate[k]) : null,
    }))

    const phaseRecords: PhaseRecord[] = phases.map((p: JobPhase) => ({
      name: p.name,
      covers: p.covers,
      quotedHours: r2(p.estHours ?? 0),
      actualHours: r2(split.byPhase[p.name] ?? 0),
    }))

    const hours = split.total
    let excluded = ''
    if (!keys.length) excluded = 'no quantities recorded'
    else if (!labs.length && !mats.length) excluded = 'nothing logged against it'
    else if (!(Number(j.agreed_ex_gst) || Number(j.quote_ex_gst))) excluded = 'no agreed price'

    return {
      jobId: id,
      client: j.client ?? '',
      type: j.type ?? '',
      date: j.sched_start ?? j.created_at?.slice(0, 10) ?? '',
      status: j.status ?? '',
      revenueExGST: r2((Number(j.agreed_ex_gst) || Number(j.quote_ex_gst) || 0) + varTotal),
      approvedVariations: r2(varTotal),
      hasVariations: vars.length > 0,
      labourCost: r2(sum(labs.map(labCost))),
      materialCost: r2(sum(mats.map(matCost))),
      materialsByCategory: matsByCat,
      hours,
      untaggedHours: split.untagged,
      taggedShare: hours > 0 ? r3((hours - split.untagged) / hours) : 0,
      bookHours: r2(sum(Object.values(book))),
      takeoffKind,
      substrates,
      phases: phaseRecords,
      excluded,
    }
  })

  const byService: Record<string, number> = {}
  for (const r of rows) {
    if (!r.type) continue
    byService[r.type] = (byService[r.type] ?? 0) + 1
  }

  return {
    generatedAt: new Date().toISOString().slice(0, 10),
    jobs: rows,
    coverage: {
      finishedJobs: rows.length,
      withTakeoff: rows.filter(r => r.substrates.length > 0).length,
      withActualTakeoff: rows.filter(r => r.takeoffKind === 'actual').length,
      withLoggedHours: rows.filter(r => r.hours > 0).length,
      withAnyPhaseTag: rows.filter(r => r.taggedShare > 0).length,
      byService,
    },
  }
}

// ── What the model is sent ──────────────────────────────────

/**
 * Trimmed for the prompt. A full dataset carries client names and job
 * descriptions that add nothing to a rate, and the long tail of jobs with no
 * quantities only crowds out the ones that can answer the question.
 */
export function datasetForAI(d: RateDataset, service?: string) {
  const jobs = d.jobs
    .filter(j => !j.excluded)
    .filter(j => !service || j.type === service)
    .map(j => ({
      job: j.jobId,
      type: j.type,
      date: j.date,
      revenue_ex_gst: j.revenueExGST,
      variations_ex_gst: j.approvedVariations || undefined,
      labour_cost: j.labourCost,
      material_cost: j.materialCost,
      materials_by_category: j.materialsByCategory,
      hours: j.hours,
      untagged_hours: j.untaggedHours,
      book_hours: j.bookHours,
      quantities_are: j.takeoffKind,
      substrates: j.substrates.map(s => ({
        key: s.key, unit: s.unit,
        qty: s.actual ?? s.quoted,
        book_hours: s.bookHours,
        logged_hours: s.loggedHours,
      })),
      phases: j.phases.length
        ? j.phases.map(p => ({ name: p.name, covers: p.covers, hours: p.actualHours }))
        : undefined,
    }))

  return {
    generated: d.generatedAt,
    coverage: d.coverage,
    excluded: d.jobs.filter(j => j.excluded)
      .map(j => ({ job: j.jobId, type: j.type, why: j.excluded })),
    jobs,
  }
}
