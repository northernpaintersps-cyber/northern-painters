// Where the business stands today.
//
// Not a balance sheet. A balance sheet has to balance, and that needs an
// equity side and a bank balance, neither of which this app records: it holds
// transactions, not account balances, and has no opening capital figure. A
// statement with an invented equity line would be worse than none.
//
// So this answers the narrower question a sole operator actually acts on —
// what do I own, who owes me, and what do I owe the ATO — from figures that
// are already derived and tested elsewhere. Nothing here is a new source of
// truth: assets come from the register, receivables from the invoices, GST
// and tax from the same calculations the BAS and P&L use.
//
// Cash is absent throughout, deliberately and for different reasons in each
// section. A cash-bought asset is owned and so it counts as something you
// have; it simply claims no depreciation deduction, which the register
// already nets off. A cash job's income is not declared, so it owes no GST
// and attracts no tax, and it is never money "owed to you" — on a cash job
// there is no invoice outstanding. See the Dashboard and Profitability for
// the cash side of the business.

import { isCashPaid } from './cashBooks'
import { registerTotals } from './assets'
import { normaliseDate } from './utils'

type Row = Record<string, any>

const n = (v: any): number => {
  const x = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return Number.isFinite(x) ? x : 0
}
const r2 = (x: number) => Math.round(x * 100) / 100

/** The buckets an accountant asks for, and the ones worth chasing on. */
export type AgeBucket = 'current' | '1-30' | '31-60' | '61-90' | '90+'
export const AGE_BUCKETS: AgeBucket[] = ['current', '1-30', '31-60', '61-90', '90+']
export const AGE_LABEL: Record<AgeBucket, string> = {
  current: 'Not yet due',
  '1-30': '1–30 days',
  '31-60': '31–60 days',
  '61-90': '61–90 days',
  '90+': 'Over 90 days',
}

export interface AgedInvoice {
  id: string
  client: string
  date: string
  dueDate: string | null
  owed: number
  daysOverdue: number
  bucket: AgeBucket
}

export interface Position {
  /** Plant and equipment still owned, at written-down value. */
  assetsWrittenDown: number
  assetsAtCost: number
  assetCount: number

  /** Invoiced and not yet paid, inc GST, cash jobs excluded. */
  receivable: number
  receivableCount: number
  /** The same money, split by how late it is. */
  aged: Record<AgeBucket, number>
  agedCount: Record<AgeBucket, number>
  /** Everything outstanding, worst first — the chase list. */
  invoices: AgedInvoice[]
  /** Owed for more than 90 days: the figure that needs a decision. */
  longOverdue: number

  /** Net GST for the quarter being reported. Positive means you owe it. */
  gstOwed: number
  /** Tax on the declared profit so far this year. */
  taxSetAside: number
  taxRate: number

  /** What you would owe if both fell due today. */
  owedToATO: number
  /** Assets plus receivables, less what is owed to the ATO. */
  net: number
}

/**
 * How overdue an invoice is.
 *
 * An invoice with no due date is read as due on its own date: an invoice that
 * never specified terms is not thereby owed forever, and treating it as
 * current would quietly keep the oldest debts out of the 90+ bucket, which is
 * the one worth acting on.
 */
export function overdueDays(inv: Row, todayStr: string): number {
  const due = normaliseDate(inv.due_date) || normaliseDate(inv.date)
  if (!due) return 0
  // Both are YYYY-MM-DD local strings; differencing them at local midnight
  // keeps this out of UTC, as everywhere else in the app does.
  const days = Math.floor(
    (Date.parse(`${todayStr}T00:00:00`) - Date.parse(`${due}T00:00:00`)) / 864e5)
  return Number.isFinite(days) ? Math.max(0, days) : 0
}

export const bucketFor = (days: number): AgeBucket =>
  days <= 0 ? 'current' : days <= 30 ? '1-30' : days <= 60 ? '31-60' : days <= 90 ? '61-90' : '90+'

export interface PositionInput {
  invoices: Row[]
  assets: Row[]
  todayStr: string
  /** The financial year the asset register is valued at. */
  year: number
  /** Net GST for the quarter being reported, from basTotals. */
  gstOwed: number
  /** Declared taxable profit for the year so far, from splitBooks. */
  taxableProfit: number
  taxRate: number
  /** True when the invoice is declared income — cash jobs are not. */
  invOnBooks: (i: Row) => boolean
  /** The app's own owed calculation, passed in rather than re-implemented. */
  calcOwed: (i: Row) => number
}

export function position(input: PositionInput): Position {
  const { invoices, assets, todayStr, year, gstOwed, taxableProfit, taxRate,
          invOnBooks, calcOwed } = input

  const reg = registerTotals(assets, year)

  // A cash-bought asset is still owned, so it is still something you have.
  // The register has already withheld its depreciation deduction; that is a
  // tax question, not a question of what is on the floor of the shed.
  const assetsAtCost = assets
    .filter(a => !a.disposal_date)
    .reduce((s, a) => s + n(a.cost_ex_gst), 0)

  const outstanding: AgedInvoice[] = invoices
    .filter(i => invOnBooks(i) && calcOwed(i) > 0.005)
    .map(i => {
      const days = overdueDays(i, todayStr)
      return {
        id: String(i.id ?? ''),
        client: String(i.client ?? ''),
        date: String(i.date ?? ''),
        dueDate: (i.due_date as string) ?? null,
        owed: r2(calcOwed(i)),
        daysOverdue: days,
        bucket: bucketFor(days),
      }
    })
    .sort((a, b) => b.daysOverdue - a.daysOverdue || b.owed - a.owed)

  const aged = Object.fromEntries(AGE_BUCKETS.map(b => [b, 0])) as Record<AgeBucket, number>
  const agedCount = Object.fromEntries(AGE_BUCKETS.map(b => [b, 0])) as Record<AgeBucket, number>
  for (const i of outstanding) {
    aged[i.bucket] = r2(aged[i.bucket] + i.owed)
    agedCount[i.bucket]++
  }

  const receivable = r2(outstanding.reduce((s, i) => s + i.owed, 0))
  // Tax is owed on profit, not on a loss: a loss carries forward, it does not
  // come back as a refund, so nothing is "set aside" against one.
  const taxSetAside = r2(Math.max(0, n(taxableProfit)) * n(taxRate))
  const owedToATO = r2(Math.max(0, n(gstOwed)) + taxSetAside)

  return {
    assetsWrittenDown: r2(reg.writtenDown),
    assetsAtCost: r2(assetsAtCost),
    assetCount: reg.count,
    receivable,
    receivableCount: outstanding.length,
    aged, agedCount,
    invoices: outstanding,
    longOverdue: aged['90+'],
    gstOwed: r2(n(gstOwed)),
    taxSetAside,
    taxRate: n(taxRate),
    owedToATO,
    net: r2(reg.writtenDown + receivable - owedToATO),
  }
}

/** Assets bought with cash, named so the register's figure can be read. */
export const cashBoughtAssets = (assets: Row[]): number =>
  r2(assets.filter(a => isCashPaid(a) && !a.disposal_date)
    .reduce((s, a) => s + n(a.cost_ex_gst), 0))
