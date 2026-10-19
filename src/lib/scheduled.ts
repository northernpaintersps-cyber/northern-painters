// Money the client has agreed to pay and has not paid yet.
//
// An invoice is not the only promise of payment. A pay schedule breaks a job
// into milestones with their own due dates, and on a cash job it is the ONLY
// record there is — cash work is never invoiced, so the Dashboard's
// outstanding figure, which counts invoices, could not see a dollar of it.
//
// A milestone is outstanding until it is ticked received. It is overdue once
// its due date has passed. A milestone with no due date is real money still
// to come — a final payment usually has none until the job is near finished
// — so it is pending rather than quietly dropped.
//
// Pure — no hooks, no Supabase.

import { parseMilestones, isCashJob, type Milestone } from './utils'

type Row = Record<string, any>

const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0 }

export interface DuePayment {
  /** The schedule's id, which is the job's id. */
  jobId: string
  client: string
  label: string
  amount: number
  /** 'YYYY-MM-DD', or '' for a milestone with no date set yet. */
  dueDate: string
  overdue: boolean
  /** Days past due, 0 when it is not. */
  daysOverdue: number
  /** The job is off the books, so this money appears nowhere else. */
  cash: boolean
}

export interface DueTotals {
  /** Everything still to be received: pending plus overdue. */
  total: number
  /** Past its due date. */
  overdue: number
  /** Not yet due, or with no date set. */
  pending: number
  /** The share of the total that belongs to cash jobs. */
  cash: number
  count: number
  overdueCount: number
  /** The oldest overdue milestone, in days. 0 when none is overdue. */
  worstDays: number
}

const dayDiff = (from: string, to: string): number => {
  const a = Date.parse(from + 'T00:00:00Z'), b = Date.parse(to + 'T00:00:00Z')
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 86400000) : 0
}

/**
 * Every milestone still to be received, across every schedule.
 *
 * `jobs` is only consulted to tell whether the work is cash. A schedule whose
 * job has been deleted still counts — the money was still agreed.
 */
export function duePayments(schedules: Row[], jobs: Row[], todayStr: string): DuePayment[] {
  const out: DuePayment[] = []
  for (const s of schedules) {
    const job = jobs.find(j => j.id === s.id)
    const cash = isCashJob(job)
    for (const m of parseMilestones(s) as Milestone[]) {
      if (m?.received) continue
      const amount = n(m?.amount)
      if (amount <= 0) continue              // an unpriced milestone owes nothing yet
      const dueDate = String(m?.dueDate ?? '').slice(0, 10)
      const overdue = !!dueDate && dueDate < todayStr
      out.push({
        jobId: String(s.id ?? ''),
        client: String(s.worker ?? job?.client ?? ''),
        label: String(m?.label ?? 'Payment'),
        amount, dueDate, overdue,
        daysOverdue: overdue ? dayDiff(dueDate, todayStr) : 0,
        cash,
      })
    }
  }
  // Overdue first, oldest at the top; then the dated ones by date; undated last.
  return out.sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1
    if (!a.dueDate !== !b.dueDate) return a.dueDate ? -1 : 1
    return a.dueDate.localeCompare(b.dueDate)
  })
}

export function dueTotals(schedules: Row[], jobs: Row[], todayStr: string): DueTotals {
  const due = duePayments(schedules, jobs, todayStr)
  const t: DueTotals = {
    total: 0, overdue: 0, pending: 0, cash: 0,
    count: due.length, overdueCount: 0, worstDays: 0,
  }
  for (const d of due) {
    t.total += d.amount
    if (d.overdue) { t.overdue += d.amount; t.overdueCount++; t.worstDays = Math.max(t.worstDays, d.daysOverdue) }
    else t.pending += d.amount
    if (d.cash) t.cash += d.amount
  }
  const r2 = (v: number) => Math.round(v * 100) / 100
  return { ...t, total: r2(t.total), overdue: r2(t.overdue), pending: r2(t.pending), cash: r2(t.cash) }
}
