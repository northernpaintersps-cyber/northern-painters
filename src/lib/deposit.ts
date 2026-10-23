// Raising a booking deposit on a job.
//
// One definition, because this starts from two places now — the Jobs list and
// the job's Billing tab — and a second copy of the percentage or the payload
// shape is how the two would quietly disagree about what a deposit is.
//
// Marking the invoice matters beyond bookkeeping: Invoices.tsx watches for a
// paid invoice carrying extra.booking_deposit and moves the job to Booked.

import { handOff } from '@/lib/handoff'
import { today } from '@/lib/utils'

/**
 * The default deposit, as a percentage of the job value ex GST.
 *
 * A fallback, not a rule: Settings → Defaults holds the real figure, and
 * every screen that offers a deposit reads it through depositPct() so one
 * change moves them all. This is what applies before anything is set.
 */
export const DEPOSIT_PCT = 10

/**
 * The deposit percentage to offer, from the business settings.
 *
 * Anything outside 1-100 is not a percentage of anything, so it falls back
 * rather than quietly raising an invoice for nothing or for double.
 */
export function depositPct(biz?: { deposit_pct?: unknown } | null): number {
  const n = Number(biz?.deposit_pct)
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : DEPOSIT_PCT
}

/** Every field optional, so the app's own `Record<string, any>` job rows are
 *  assignable: a bare index signature does not satisfy a required property. */
type JobLike = {
  id?: string | null
  client?: string | null
  agreed_ex_gst?: number | null
  quote_ex_gst?: number | null
}

/** What a deposit is taken on: the agreed price, else the quote. */
export const jobValueEx = (j: JobLike): number =>
  Number(j.agreed_ex_gst || j.quote_ex_gst) || 0

export const depositAmount = (j: JobLike, pct: number): number =>
  Math.round(jobValueEx(j) * pct) / 100

/** The path to send the user to, with the invoice prefill waiting for it. */
export function depositPath(j: JobLike, pct: number): string {
  return '/invoices' + handOff('np_prefill_invoice', {
    job_id: j.id ?? '',
    client: j.client ?? '',
    date: today(),
    notes: 'Booking deposit',
    depositExGST: depositAmount(j, pct),
    bookingDeposit: true,
  })
}

/** True when this job already has a deposit invoice, so one is not raised twice. */
export const hasDepositInvoice = (invoices: Array<{ extra?: any; notes?: string | null }>): boolean =>
  invoices.some(i => i.extra?.booking_deposit === true)
