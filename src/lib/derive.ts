// Derived fields that were trapped inside their pages.
//
// Each of these was a private function in one page's module, which was fine
// until a second caller needed it. The assistant is that second caller, and
// re-implementing them is exactly how its rows would come to differ from the
// rows the forms write. Moved verbatim — behaviour is unchanged, and the pages
// import them back.

import { isWorkDay, localDate, jobGstRate } from '@/lib/utils'

type Row = Record<string, any>

/** Hours between two HH:MM times, less an optional break in minutes. */
export function hoursBetween(from: string, to: string, breakMins = 0): number {
  if (!from || !to) return 0
  const [fh, fm] = from.split(':').map(Number)
  const [th, tm] = to.split(':').map(Number)
  let mins = (th * 60 + tm) - (fh * 60 + fm)
  // A shift that ends before it starts ran past midnight.
  if (mins < 0) mins += 24 * 60
  return Math.max(0, (mins - breakMins) / 60)
}

/** N working days from a start date, skipping weekends. From JobDayPanel. */
export function workingDatesFrom(start: string, days: number): string[] {
  const out: string[] = []
  const d0 = new Date(start + 'T00:00')
  let wd = 0, cal = 0
  while (wd < days && cal < 365) {
    const dt = new Date(d0)
    dt.setDate(dt.getDate() + cal)
    const key = localDate(dt)
    if (isWorkDay(key)) { out.push(key); wd++ }
    cal++
  }
  return out
}

/**
 * The three money fields for an ex-GST figure, respecting a cash job that
 * carries no GST. From Invoices, where it closed over the jobs list.
 */
export function amountFields(ex: number, job?: Row | null): {
  agreed_ex_gst: number; gst: number; total_inc_gst: number
} {
  const rate = jobGstRate(job)
  return {
    agreed_ex_gst: ex,
    gst: +(ex * rate).toFixed(2),
    total_inc_gst: +(ex * (1 + rate)).toFixed(2),
  }
}

/** The next receipt number, R-0001 upwards. From Receipts. */
export function nextReceiptNo(existing: Row[]): string {
  const nums = existing
    .map(r => parseInt(String(r.id ?? '').replace(/\D/g, ''), 10))
    .filter(n => !isNaN(n))
  const max = nums.length ? Math.max(...nums) : 0
  return `R-${String(max + 1).padStart(4, '0')}`
}
