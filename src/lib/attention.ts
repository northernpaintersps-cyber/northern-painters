// What needs attention, computed once.
//
// These four rules were written twice — in Dashboard.tsx as alerts and, for
// the quote follow-up, again in Jobs.tsx. The two follow-up copies had already
// drifted: the Dashboard one ignored `extra.follow_up_snoozed_until`, so
// snoozing a chase on the Jobs page did not quiet the Dashboard. This is the
// Jobs version, snooze included, and both pages plus the assistant read it.
//
// Deliberately arithmetic. The assistant gets these as a tool result rather
// than working them out from raw rows, because a model re-deriving "overdue"
// each time is slower, costs money and will eventually disagree with the
// screen.

import { calcOwed, normaliseDate, today } from '@/lib/utils'

type Row = Record<string, any>

/** Days a quote waits before it is worth chasing. */
export const FOLLOW_UP_DAYS = 7
/** How far ahead an unstaffed job starts before it is urgent. */
export const CREW_WARN_DAYS = 3

export type AttentionKind =
  | 'invoice_overdue' | 'new_enquiry' | 'quote_follow_up' | 'no_crew'

export interface AttentionItem {
  kind: AttentionKind
  /** One line, as the Dashboard shows it. */
  label: string
  /** The record behind it, so the assistant can name and open it. */
  id: string
  jobId?: string
  client?: string
  /** Dollars at stake, where the item has an amount. Drives the ranking. */
  amount?: number
  /** Days late, or days until it starts. */
  days?: number
  route: string
}

const daysSince = (date: string | null | undefined, from: string): number | null => {
  const d = normaliseDate(date)
  if (!d) return null
  // Both are YYYY-MM-DD local strings; differencing them as dates at local
  // midnight keeps this out of UTC, as everywhere else in the app.
  return Math.floor((Date.parse(`${from}T00:00:00`) - Date.parse(`${d}T00:00:00`)) / 864e5)
}

export const snoozedUntil = (j: Row): string | undefined =>
  j?.extra?.follow_up_snoozed_until

/** A quote sent and not heard about, not currently snoozed. */
export function needsFollowUp(jobs: Row[], todayStr = today()): Row[] {
  return jobs.filter(j => {
    if (j.quote_status !== 'Sent' || !j.quote_sent) return false
    const snz = snoozedUntil(j)
    if (snz && snz > todayStr) return false
    const d = daysSince(j.quote_sent, todayStr)
    return d != null && d >= FOLLOW_UP_DAYS
  })
}

export const overdueInvoices = (invoices: Row[], todayStr = today()): Row[] =>
  invoices.filter(i => calcOwed(i) > 0 && i.due_date && normaliseDate(i.due_date)! < todayStr)

/** Starting within CREW_WARN_DAYS with nobody booked on it. */
export function unstaffedJobs(jobs: Row[], assignments: Row[], todayStr = today()): Row[] {
  return jobs.filter(j => {
    if (!['Scheduled', 'Not Started'].includes(j.status)) return false
    const d = daysSince(j.sched_start, todayStr)
    if (d == null) return false
    const until = -d                      // negative days-since is days-until
    if (until < 0 || until > CREW_WARN_DAYS) return false
    return !assignments.some(a => a.job_id === j.id)
  })
}

/**
 * Everything wanting attention, worst first.
 *
 * Ranked by money and then by lateness, rather than by the hardcoded category
 * order the Dashboard used — an overdue $80 invoice does not outrank a $14,000
 * job starting tomorrow with no crew on it.
 */
export function attentionList(d: {
  jobs: Row[]; invoices: Row[]; enquiries: Row[]; assignments: Row[]
}, todayStr = today()): AttentionItem[] {
  const out: AttentionItem[] = []

  for (const i of overdueInvoices(d.invoices, todayStr)) {
    const owed = calcOwed(i)
    out.push({
      kind: 'invoice_overdue', id: String(i.id ?? ''), jobId: i.job_id, client: i.client,
      amount: owed, days: daysSince(i.due_date, todayStr) ?? undefined,
      label: `Invoice overdue — ${i.client || 'client'} (${i.id || i.job_id}) · ${owed.toFixed(2)} owed`,
      route: '/invoices',
    })
  }

  for (const j of needsFollowUp(d.jobs, todayStr)) {
    out.push({
      kind: 'quote_follow_up', id: String(j.id ?? ''), jobId: j.id, client: j.client,
      amount: Number(j.quote_ex_gst) || 0, days: daysSince(j.quote_sent, todayStr) ?? undefined,
      label: `Follow up quote — ${j.client || 'client'} (${j.id}) sent ${j.quote_sent}`,
      route: '/jobs',
    })
  }

  for (const j of unstaffedJobs(d.jobs, d.assignments, todayStr)) {
    out.push({
      kind: 'no_crew', id: String(j.id ?? ''), jobId: j.id, client: j.client,
      amount: Number(j.agreed_ex_gst || j.quote_ex_gst) || 0,
      days: -(daysSince(j.sched_start, todayStr) ?? 0),
      label: `No crew assigned — ${j.client || 'client'} starts ${j.sched_start}`,
      route: '/crew',
    })
  }

  for (const e of d.enquiries.filter(x => x.enq_status === 'New')) {
    out.push({
      kind: 'new_enquiry', id: String(e.id ?? ''), client: e.client,
      days: daysSince(e.date ?? e.created_at, todayStr) ?? undefined,
      label: `New enquiry — ${e.client || 'Unknown'}${e.source ? ` · ${e.source}` : ''}`,
      route: '/enquiries',
    })
  }

  return out.sort((a, b) =>
    (b.amount ?? 0) - (a.amount ?? 0) || (b.days ?? 0) - (a.days ?? 0))
}
