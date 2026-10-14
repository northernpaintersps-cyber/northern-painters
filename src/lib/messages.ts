// The messages you send clients and crew.
//
// Lifted out of Jobs.tsx and Payments.tsx so the pages and the assistant all
// offer the same wording. Two copies of a chase message is two voices for the
// same business.
//
// These compose text and nothing else. Nothing here sends: the app has no
// outbound channel, so a message is copied to the clipboard and you send it
// from wherever you normally would.

import { fmtCurrency } from '@/lib/utils'
import type { Milestone } from '@/lib/utils'

type JobLike = Record<string, any>
type BizLike = Record<string, any> | null | undefined

const sign = (biz: BizLike): string => biz?.company_name || 'Northern Painters'

/** Chasing a quote that has gone quiet. */
export function quoteFollowUp(j: JobLike): string {
  const ex = Number(j.quote_ex_gst) || 0
  return [
    `Hi ${j.client || 'there'},`,
    '',
    `Just following up on the quote we sent for ${j.job_desc || j.type || 'your painting project'}`
      + `${j.address ? ` at ${j.address}` : ''}.`,
    '',
    `Quote: ${fmtCurrency(ex)} ex GST (${fmtCurrency(ex * 1.1)} inc GST)`,
    '',
    'Happy to answer any questions or adjust the scope if needed.',
    '',
    'Looking forward to hearing from you!',
    '',
    'Northern Painters',
  ].join('\n')
}

/** Asking a client for money that is owed on an invoice. */
export function invoiceReminder(inv: JobLike, owed: number, biz?: BizLike): string {
  return [
    `Hi ${inv.client || 'there'},`,
    '',
    `A reminder about invoice ${inv.id || ''}${inv.date ? ` dated ${inv.date}` : ''}.`,
    '',
    `Outstanding: ${fmtCurrency(owed)} inc GST`,
    ...(inv.due_date ? [`Due: ${inv.due_date}`] : []),
    '',
    ...(biz?.bsb ? [`BSB: ${biz.bsb}`] : []),
    ...(biz?.account_no ? [`Acc: ${biz.account_no}`] : []),
    ...(inv.id ? [`Ref: ${inv.id}`] : []),
    '',
    'If it has already gone out, please ignore this — and let me know so I can',
    'check it against our records.',
    '',
    'Thanks,',
    sign(biz),
  ].join('\n')
}

/** Telling crew what they are owed on a payment schedule. */
export function crewPaymentReminder(
  schedule: JobLike, next: Milestone, biz?: BizLike,
): string {
  return [
    `Hi ${schedule.worker || 'there'},`,
    '',
    'Payment reminder:',
    `${next.label}: ${fmtCurrency(next.amount)} inc GST`
      + `${next.dueDate ? `\nDue: ${next.dueDate}` : ''}`,
    '',
    ...(biz?.bsb ? [`BSB: ${biz.bsb}`] : []),
    ...(biz?.account_no ? [`Acc: ${biz.account_no}`] : []),
    `Ref: ${schedule.id}`,
    '',
    'Thanks,',
    sign(biz)
      + (biz?.licence ? `\nLic ${biz.licence}` : '')
      + (biz?.abn ? ` | ABN ${biz.abn}` : ''),
  ].join('\n')
}

/** Confirming with a client which day the crew is coming. */
export function bookingConfirmation(j: JobLike, date: string): string {
  return [
    `Hi ${j.client || 'there'},`,
    '',
    `Confirming we are booked in for ${j.job_desc || j.type || 'your painting'}`
      + `${j.address ? ` at ${j.address}` : ''} starting ${date}.`,
    '',
    'We will need clear access on the day. Anything you would rather move',
    'yourself, please do before we arrive.',
    '',
    'Any questions, just ask.',
    '',
    'Northern Painters',
  ].join('\n')
}

export const MESSAGE_KINDS = [
  'quote_follow_up', 'invoice_reminder', 'booking_confirmation',
] as const
export type MessageKind = typeof MESSAGE_KINDS[number]
