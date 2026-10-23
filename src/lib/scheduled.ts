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
// One rule decides what belongs here and what does not:
//
//     Invoiced money is the invoice's. Everything else agreed is the
//     schedule's.
//
// So a milestone drops out the moment an invoice covers it, settled or not:
// the invoice is the live claim from then on, and it is already counted as
// money owed. Counting both showed the same dollars twice, and left a
// milestone that had been invoiced AND paid still raising an overdue alert
// until someone remembered to tick it by hand.
//
// Pure — no hooks, no Supabase.

import { parseMilestones, isCashJob, type Milestone } from './utils'

type Row = Record<string, any>

const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0 }

/**
 * Where a milestone stands, among the ones still to be received.
 *
 *   due       agreed and not invoiced — the money this card is for
 *   invoiced  an invoice covers it, so the invoice counts it instead
 *
 * A milestone ticked received is not here at all: it is money that has
 * arrived, not a payment to come.
 */
export type DueStatus = 'due' | 'invoiced'

export interface DuePayment {
  /** The schedule's id, which is the job's id. */
  jobId: string
  status: DueStatus
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
  /** Covered by an invoice, so counted there rather than here. Reported so
   *  the figure can be explained instead of just being smaller. */
  invoicedIncGST: number
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
 * The invoice covering a milestone, if one does.
 *
 * The same link the job's billing uses: an invoice records which milestone
 * it bills. `milestone_job_id` guards it, because index 1 of another job's
 * schedule is not this milestone.
 */
const invoiceFor = (invoices: Row[], jobId: string, index: number): Row | undefined =>
  invoices.find(i =>
    String(i?.job_id ?? '') === jobId &&
    Number(i?.extra?.milestone_index) === index &&
    (i?.extra?.milestone_job_id == null || String(i.extra.milestone_job_id) === jobId))

/**
 * Every milestone across every schedule, each with where it stands.
 *
 * `jobs` is only consulted to tell whether the work is cash. A schedule whose
 * job has been deleted still counts — the money was still agreed.
 */
export function duePayments(
  schedules: Row[], jobs: Row[], todayStr: string, invoices: Row[] = [],
): DuePayment[] {
  const out: DuePayment[] = []
  for (const s of schedules) {
    const job = jobs.find(j => j.id === s.id)
    const cash = isCashJob(job)
    const jobId = String(s.id ?? '')
    let index = -1
    for (const m of parseMilestones(s) as Milestone[]) {
      index++
      const amount = n(m?.amount)
      if (amount <= 0) continue              // an unpriced milestone owes nothing yet

      // A milestone ticked received is money that has arrived. It is not a
      // payment to come and never was one here.
      if (m?.received) continue

      // One that an invoice covers is kept, so the totals can say where it
      // went, but it is not outstanding: the invoice counts it now.
      const invoice = invoiceFor(invoices, jobId, index)
      if (invoice) {
        out.push({
          jobId, status: 'invoiced', client: String(s.worker ?? job?.client ?? ''),
          label: String(m?.label ?? 'Payment'), amount,
          dueDate: String(m?.dueDate ?? '').slice(0, 10),
          overdue: false, daysOverdue: 0, cash,
        })
        continue
      }
      const dueDate = String(m?.dueDate ?? '').slice(0, 10)
      const overdue = !!dueDate && dueDate < todayStr
      out.push({
        jobId, status: 'due',
        client: String(s.worker ?? job?.client ?? ''),
        label: String(m?.label ?? 'Payment'),
        amount, dueDate, overdue,
        daysOverdue: overdue ? dayDiff(dueDate, todayStr) : 0,
        cash,
      })
    }
  }
  // Overdue first, oldest at the top; then the dated ones by date; undated
  // last. Anything an invoice covers sorts below the lot — it is here to be
  // counted, not chased.
  return out.sort((a, b) => {
    if ((a.status === 'due') !== (b.status === 'due')) return a.status === 'due' ? -1 : 1
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1
    if (!a.dueDate !== !b.dueDate) return a.dueDate ? -1 : 1
    return a.dueDate.localeCompare(b.dueDate)
  })
}

export function dueTotals(
  schedules: Row[], jobs: Row[], todayStr: string, invoices: Row[] = [],
): DueTotals {
  const all = duePayments(schedules, jobs, todayStr, invoices)
  const due = all.filter(d => d.status === 'due')
  const t: DueTotals = {
    total: 0, invoicedIncGST: 0, overdue: 0, pending: 0, cash: 0,
    count: due.length, overdueCount: 0, worstDays: 0,
  }
  for (const d of due) {
    t.total += d.amount
    if (d.overdue) { t.overdue += d.amount; t.overdueCount++; t.worstDays = Math.max(t.worstDays, d.daysOverdue) }
    else t.pending += d.amount
    if (d.cash) t.cash += d.amount
  }
  for (const d of all) if (d.status === 'invoiced') t.invoicedIncGST += d.amount

  const r2 = (v: number) => Math.round(v * 100) / 100
  return {
    ...t,
    total: r2(t.total), overdue: r2(t.overdue), pending: r2(t.pending),
    cash: r2(t.cash), invoicedIncGST: r2(t.invoicedIncGST),
  }
}
