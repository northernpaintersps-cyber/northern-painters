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

/** What a labour row cost, however it is recorded. */
export const labourCost = (l: Row) => n(l.cost) || n(l.hours) * n(l.rate)

export interface Side {
  income: number
  materials: number
  labour: number
  expenses: number
  /** materials + labour + expenses */
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
}

const empty = (): Side =>
  ({ income: 0, materials: 0, labour: 0, expenses: 0, costs: 0, net: 0 })

const close = (s: Side) => {
  s.costs = s.materials + s.labour + s.expenses
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
  const { invoices, materials, labour, expenses, cashJobIds, taxRate } = input
  const offJob = (r: Row) => !!r.job_id && cashJobIds.has(r.job_id)

  const books = empty()
  const offBooks = empty()
  const byCat: Record<string, number> = {}
  let cashCostRows = 0
  let cashIncomeRows = 0
  let gstCollected = 0
  let gstCredits = 0

  for (const i of invoices) {
    // An invoice is income whatever it was paid with; only a cash JOB is off
    // the books, and those are not really invoices so much as records of work.
    const amount = n(i.agreed_ex_gst)
    if (offJob(i)) { offBooks.income += amount; cashIncomeRows++ }
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
    const amount = n(e.amount_ex_gst)
    const cat = e.category || 'Other'
    if (place(e, amount, 'expenses')) {
      gstCredits += n(e.gst)
      byCat[cat] = (byCat[cat] || 0) + amount
    }
  }

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
