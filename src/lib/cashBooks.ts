// Cash, and what it does to tax.
//
// Two rules, both of which are about a PAYMENT rather than about a job:
//
//   · A cost paid in cash is not deductible. No GST credit, no reduction of
//     taxable income — but the money has still left, so it comes off the
//     profit after tax.
//   · Cash income is off the books. No GST, not taxable — but the money has
//     still arrived, so it goes onto the profit after tax in full.
//
// Both reduce to one partition. Every row is either on the books, where it
// affects tax, or off them, where it only affects what is actually left:
//
//   taxable profit = on-books income − on-books costs
//   tax            = taxable profit × rate   (never negative)
//   after tax      = taxable profit − tax + off-books income − off-books costs
//
// A row is off the books when it was paid in cash, or when it belongs to a
// job marked Cash. `paid_by` is null on everything logged before this existed
// and on anything not stated since, and null reads as on the books — the
// conservative answer, and the one that leaves every historical figure where
// it was. Only an explicit 'Cash' moves a number.
//
// One deliberate exception: an invoice on an on-books job stays taxable
// however it was paid. An issued invoice is a declared sale; the cash button
// on it records how the money arrived, not that the sale went away. Off-book
// income means work invoiced to nobody, which is what a Cash job is.
//
// Pure — no hooks, no Supabase.

export const PAID_BY = ['Bank', 'Card', 'Cash'] as const
export type PaidBy = typeof PAID_BY[number]

type Row = Record<string, any>

const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0 }

/** Paid in cash. Only an explicit 'Cash' counts; not stated is on the books. */
export const isCashPaid = (row: { paid_by?: string | null } | null | undefined) =>
  String(row?.paid_by ?? '').trim().toLowerCase() === 'cash'

/**
 * The business share of a cost, 0–1.
 *
 * A ute, a phone and a trailer are all bought once and used for both work and
 * life, and only the work share is deductible. The full amount is what was
 * paid and what the bank statement says, so that is what gets stored; this is
 * the fraction of it the return may claim.
 *
 * Absent means wholly business, which is the norm and which leaves every row
 * recorded before this column existed exactly where it was.
 *
 * Lives here rather than with the asset register because it is a rule about
 * what is deductible, the same kind of rule as `isCashPaid`, and it applies to
 * expenses and assets alike.
 */
export const businessShare = (row: { business_use_pct?: number | string | null } | null | undefined): number => {
  const raw = row?.business_use_pct
  if (raw === null || raw === undefined || raw === '') return 1
  return Math.min(1, Math.max(0, n(raw) / 100))
}

/**
 * An invoice declared cash, and so off the books.
 *
 * Set by hand, per invoice, and never inferred from a payment: somebody
 * paying $500 cash towards a $5,000 invoice must not quietly take the whole
 * $5,000 out of the BAS. Declaring it is a decision, so it is a tick.
 *
 * A cash JOB's invoices are off the books too — see offBooksInvoice, which
 * is the test every figure should use.
 */
export const isOffBooksInvoice = (inv: { extra?: any } | null | undefined): boolean =>
  inv?.extra?.off_books === true

/**
 * Off the books: either the invoice says so, or its job does.
 *
 * One test, because an invoice that is off the books for one figure and on
 * them for another is how the BAS and the P&L come to disagree.
 */
export const offBooksInvoice = (
  inv: { job_id?: string | null; extra?: any } | null | undefined,
  cashJobIds?: Set<string> | null,
): boolean =>
  isOffBooksInvoice(inv) ||
  (!!inv?.job_id && !!cashJobIds && cashJobIds.has(inv.job_id))

/** What a labour row cost, however it is recorded. */
export const labourCost = (l: Row) => n(l.cost) || n(l.hours) * n(l.rate)

export interface Side {
  income: number
  materials: number
  labour: number
  expenses: number
  /** This year's depreciation from the asset register — a deduction with no
   *  payment behind it, which is why it is its own line rather than a cost. */
  depreciation: number
  /** materials + labour + expenses + depreciation */
  costs: number
  /** income − costs */
  net: number
}

export interface PLResult {
  /** The figures tax is worked out on. */
  books: Side
  /** Cash: real money, invisible to the ATO. */
  offBooks: Side
  /** books.net, floored at nothing for the tax calculation only. */
  taxableProfit: number
  taxRate: number
  tax: number
  /** taxableProfit − tax + offBooks.net */
  afterTax: number

  /** Overheads by category, on-books only — these are the deductible ones. */
  byCat: Record<string, number>

  gstCollected: number
  gstCredits: number
  netGST: number

  /** How many rows each side was built from, for the explanatory line. */
  counts: { cashCostRows: number; cashIncomeRows: number }
}

export interface PLInput {
  invoices: Row[]
  materials: Row[]
  labour: Row[]
  expenses: Row[]
  /** The jobs marked Cash — their work was never invoiced to anybody. */
  cashJobIds: Set<string>
  taxRate: number
  /** This year's depreciation from the asset register, already net of
   *  business use. Optional: a register with nothing in it changes nothing. */
  depreciation?: number
  /** Depreciation forgone because the asset was bought with cash — a real
   *  cost of owning it, deductible nowhere. */
  depreciationNonDeductible?: number
}

const empty = (): Side =>
  ({ income: 0, materials: 0, labour: 0, expenses: 0, depreciation: 0, costs: 0, net: 0 })

const close = (s: Side) => {
  s.costs = s.materials + s.labour + s.expenses + s.depreciation
  s.net = s.income - s.costs
  return s
}

/**
 * Split a year's rows into what the ATO sees and what it does not, and work
 * the tax out of the first.
 *
 * Caller filters by date — this takes the rows that belong to the period and
 * says nothing about which period that is.
 */
export function splitBooks(input: PLInput): PLResult {
  const {
    invoices, materials, labour, expenses, cashJobIds, taxRate,
    depreciation = 0, depreciationNonDeductible = 0,
  } = input
  const offJob = (r: Row) => !!r.job_id && cashJobIds.has(r.job_id)

  const books = empty()
  const offBooks = empty()
  const byCat: Record<string, number> = {}
  let cashCostRows = 0
  let cashIncomeRows = 0
  let gstCollected = 0
  let gstCredits = 0

  for (const i of invoices) {
    // Off the books because the invoice says so, or because its job does.
    // Either way it is not declared income and collects no GST — but the
    // money arrived, so it lands on the after-tax line.
    const amount = n(i.agreed_ex_gst)
    if (offBooksInvoice(i, cashJobIds)) { offBooks.income += amount; cashIncomeRows++ }
    else { books.income += amount; gstCollected += n(i.gst) }
  }

  // A cost is off the books if it was paid in cash OR belongs to a cash job.
  // Either way it is not deductible and claims no GST credit.
  const place = (r: Row, amount: number, field: 'materials' | 'labour' | 'expenses') => {
    const cash = isCashPaid(r)
    if (cash || offJob(r)) {
      offBooks[field] += amount
      if (cash) cashCostRows++
      return false
    }
    books[field] += amount
    return true
  }

  for (const m of materials) {
    if (place(m, n(m.cost_ex_gst), 'materials')) gstCredits += n(m.gst)
  }
  for (const l of labour) {
    place(l, labourCost(l), 'labour')
  }
  for (const e of expenses) {
    // Only the business share is deductible, and only that share of the GST
    // may be claimed back. The stored figure stays the whole amount paid, so
    // it still ties to the bank statement; the share is applied here, where
    // the tax question is being answered.
    const share = businessShare(e)
    const amount = n(e.amount_ex_gst) * share
    const cat = e.category || 'Other'
    if (place(e, amount, 'expenses')) {
      gstCredits += n(e.gst) * share
      byCat[cat] = (byCat[cat] || 0) + amount
    }
  }

  books.depreciation = depreciation
  offBooks.depreciation = depreciationNonDeductible
  close(books); close(offBooks)

  const taxableProfit = books.net
  const tax = Math.max(0, taxableProfit) * taxRate

  return {
    books, offBooks,
    taxableProfit, taxRate, tax,
    afterTax: taxableProfit - tax + offBooks.net,
    byCat,
    gstCollected, gstCredits, netGST: gstCollected - gstCredits,
    counts: { cashCostRows, cashIncomeRows },
  }
}
