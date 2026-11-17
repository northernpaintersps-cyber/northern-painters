// The BAS figures, as lodged.
//
// This used to live in a useMemo inside the Tax page, which meant the one
// piece of arithmetic in the app that gets copied onto a government form had
// no test around it. It had two faults, both found by reading a real BAS
// against the bank statements rather than by reading the code:
//
//   1. G11 was built from the expense rows that carried GST, because the same
//      filtered array fed both the credit and the total. A bank fee and an
//      ASIC lodgement are purchases; they just claim no credit. Dropping them
//      understated G11 by $219 in one quarter.
//
//   2. G1, G10 and G11 were derived by multiplying an ex-GST total by 1.1.
//      Every table here stores the GST the transaction actually carried, so
//      there was never a need to guess at it — and guessing invents GST on
//      anything GST-free: a private-sale trailer, an overseas subscription,
//      a bank fee.
//
// Hence the rule this module keeps: an inc-GST field is the sum of stored
// inc-GST amounts. Nothing is grossed up, ever. 1A, 1B and the net position
// read the stored `gst` columns, which is why they were right all along.
//
// Cash is the other axis and is handled the same way everywhere else in the
// app: a cash purchase claims no credit and is not a BAS purchase at all, and
// a cash job's income is not declared. Both are named in the result rather
// than silently dropped — a BAS that is quietly smaller is worse than one
// that says what it left out.

import { isCashPaid } from './cashBooks'
import { inQuarter } from './fy'
import { registerTotals } from './assets'

type Row = Record<string, any>

const n = (v: any): number => {
  const x = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return Number.isFinite(x) ? x : 0
}

/** np_expenses has no amount_inc_gst column, so inc GST is derived from the
 *  two stored figures — added, not multiplied. */
export const expIncGST = (e: Row): number => n(e.amount_ex_gst) + n(e.gst)

/** A purchase carries GST or it does not. Only the credit depends on it. */
export const hasGST = (e: Row): boolean => n(e.gst) > 0

export interface BASInput {
  invoices: Row[]
  materials: Row[]
  expenses: Row[]
  assets: Row[]
  /** 'cash' reports GST when payment landed, 'accrual' when invoiced. */
  basis: 'cash' | 'accrual'
  year: number
  quarter: number
  /** True when the row is declared income or a deductible cost. */
  onBooks: (r: Row) => boolean
  invOnBooks: (i: Row) => boolean
  /** The app's own 'Paid' test, passed in rather than re-implemented. */
  invStatus: (i: Row) => string
}

export interface BASTotals {
  gstCollected: number
  totalGSTCredits: number
  netGST: number
  gstOnAssets: number
  assetsExGST: number
  assetsIncGST: number
  assetCount: number
  totalSales: number
  salesIncGST: number
  totalPurchases: number
  purchasesIncGST: number
  matsIncGST: number
  expsIncGST: number
  invCount: number
  txnCount: number
  cashPurchases: number
  offBooksSales: number
  offBooksCount: number
}

export function basTotals(input: BASInput): BASTotals {
  const { invoices, materials, expenses, assets, basis, year, quarter,
          onBooks, invOnBooks, invStatus } = input

  const invs = invoices.filter(i => invOnBooks(i) && (basis === 'cash'
    ? (i.date_paid && inQuarter(i.date_paid, year, quarter))
      || (invStatus(i) === 'Paid' && !i.date_paid && inQuarter(i.date, year, quarter))
    : inQuarter(i.date, year, quarter)))

  const mats = materials.filter(m => onBooks(m) && !isCashPaid(m) && inQuarter(m.date, year, quarter))

  // Every purchase on the books is in G11, GST or no GST. Only the credit is
  // restricted to the rows that carried it, so hasGST narrows nothing else.
  const exps = expenses.filter(e => onBooks(e) && !isCashPaid(e) && inQuarter(e.date, year, quarter))
  const expsWithGST = exps.filter(hasGST)

  // An asset bought this quarter is a capital acquisition: its GST is
  // claimable now even though its cost is deducted across years. Cash and
  // private-use shares are already netted off by the register.
  const capital = assets.filter(a => inQuarter(a.purchase_date, year, quarter))
  const onBooksCapital = capital.filter(a => !isCashPaid(a))

  const gstCollected = invs.reduce((s, i) => s + n(i.gst), 0)
  const gstOnMats = mats.reduce((s, m) => s + n(m.gst), 0)
  const gstOnExps = expsWithGST.reduce((s, e) => s + n(e.gst), 0)
  const gstOnAssets = registerTotals(capital, year).purchasedGST
  const credits = gstOnMats + gstOnExps + gstOnAssets

  const matsIncGST = mats.reduce((s, m) => s + n(m.total_inc_gst), 0)
  const expsIncGST = exps.reduce((s, e) => s + expIncGST(e), 0)
  const assetsIncGST = onBooksCapital.reduce((s, a) => s + n(a.total_inc_gst), 0)
  const assetsExGST = onBooksCapital.reduce((s, a) => s + n(a.cost_ex_gst), 0)

  return {
    gstCollected,
    totalGSTCredits: credits,
    netGST: gstCollected - credits,
    gstOnAssets, assetsExGST, assetsIncGST,
    assetCount: capital.length,
    totalSales: invs.reduce((s, i) => s + n(i.agreed_ex_gst), 0),
    salesIncGST: invs.reduce((s, i) => s + n(i.agreed_ex_gst) + n(i.gst), 0),
    totalPurchases: mats.reduce((s, m) => s + n(m.cost_ex_gst), 0)
      + exps.reduce((s, e) => s + n(e.amount_ex_gst), 0) + assetsExGST,
    purchasesIncGST: matsIncGST + expsIncGST + assetsIncGST,
    matsIncGST, expsIncGST,
    invCount: invs.length,
    txnCount: mats.length + exps.length,
    cashPurchases: [...materials, ...expenses]
      .filter(r => isCashPaid(r) && inQuarter(r.date, year, quarter)).length,
    offBooksSales: invoices
      .filter(i => !invOnBooks(i) && inQuarter(i.date_paid || i.date, year, quarter))
      .reduce((s, i) => s + n(i.agreed_ex_gst), 0),
    offBooksCount: invoices
      .filter(i => !invOnBooks(i) && inQuarter(i.date_paid || i.date, year, quarter)).length,
  }
}
