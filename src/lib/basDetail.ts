// The detail behind a BAS, in the shape an accountant asks for.
//
//   Date | Who paid to / received from | Description | Amount | GST
//
// The app already had a Xero import CSV, which is a different thing for a
// different reader: it carries *AccountCode and *TaxType and no GST column at
// all, because Xero derives the GST itself. Handing that to a person to read
// means handing them something to rebuild by hand.
//
// Three rules this follows, each of them someone else's requirement rather
// than a preference:
//
//   1. The period and the basis are the ones chosen on the BAS tab. "Sales
//      received from 1 July to 30 September" is a cash-basis question, and
//      answering it from invoice dates would list sales that have not been
//      received.
//   2. Cash is absent. A cash purchase claims no GST credit and a cash job
//      makes no sale, so neither is part of the BAS this detail explains.
//   3. A description appears only where the heading is not self-evident, or
//      where the amount is large. That is what was asked for, and it is also
//      what makes the report readable: "Bunnings — Bunnings" on forty rows
//      buries the one line that needed explaining.

import { isCashPaid } from './cashBooks'
import { inQuarter, quarterRange, quarterLabel } from './fy'
import { recognisedDate, expIncGST } from './bas'

type Row = Record<string, any>

const n = (v: any): number => {
  const x = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return Number.isFinite(x) ? x : 0
}
const r2 = (x: number) => Math.round(x * 100) / 100

/**
 * Words that are never information: the app's own auto-generated material
 * descriptions read "Dulux Paint Byron Bay — Inv #909874103 (2 items)", which
 * is the payee and the reference said twice with scaffolding around them. Left
 * in, the description column is noise on four rows in five and the one line
 * that needed explaining is buried — which is the opposite of what it is for.
 */
const BOILERPLATE = new Set([
  'inv', 'invoice', 'invoiced', 'item', 'items', 'receipt', 'ref', 'reference',
  'no', 'num', 'number', 'order', 'purchase', 'qty', 'x', 'and', 'the', 'for',
])

const words = (s: unknown): string[] =>
  String(s ?? '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean)

/**
 * The description to print, or '' for none — "if the heading isn't
 * self-evident", as it was asked for.
 *
 * A description earns its place by saying something the rest of the row does
 * not. So the payee's own words come out of it, the reference's come out, pure
 * numbers come out, and so does the scaffolding above. If anything is left,
 * that is the part worth reading and the whole description is printed. If
 * nothing is left, the column stays blank.
 *
 * There is deliberately no large-amount override. A $4,000 line whose only
 * description repeats its payee has nothing to tell anybody; printing it
 * would just put the noise back on the rows that matter most.
 */
export function describe(party: unknown, desc: unknown, reference: unknown = ''): string {
  const d = String(desc ?? '').trim()
  if (!d) return ''
  const known = new Set([...words(party), ...words(reference)])
  const extra = words(d).filter(w =>
    !known.has(w) && !BOILERPLATE.has(w) && !/^\d+$/.test(w))
  return extra.length ? d : ''
}

export interface DetailRow {
  date: string
  party: string
  description: string
  amountIncGST: number
  gst: number
  /** Blank on a sale; the expense or material category on a purchase. */
  category: string
  /** Invoice number, receipt number or job — something to look it up by. */
  reference: string
}

export interface CategoryGroup {
  category: string
  rows: DetailRow[]
  amountIncGST: number
  gst: number
}

export interface BASDetailInput {
  invoices: Row[]
  materials: Row[]
  expenses: Row[]
  assets: Row[]
  basis: 'cash' | 'accrual'
  year: number
  quarter: number
  onBooks: (r: Row) => boolean
  invOnBooks: (i: Row) => boolean
  invStatus: (i: Row) => string
}

/** Sales, by the date the money was received on a cash basis. */
export function salesDetail(input: BASDetailInput): DetailRow[] {
  const { invoices, basis, year, quarter, invOnBooks, invStatus } = input
  return invoices
    .map(i => ({ i, when: recognisedDate(i, basis, invStatus) }))
    .filter(({ i, when }) => invOnBooks(i) && inQuarter(when, year, quarter))
    .map(({ i, when }) => ({
      date: String(when ?? ''),
      party: String(i.client ?? '').trim() || 'Unknown',
      // A sale needs no description: the client is the heading and the
      // invoice number is the lookup. Anything more is the job file's job.
      description: '',
      amountIncGST: r2(n(i.agreed_ex_gst) + n(i.gst)),
      gst: r2(n(i.gst)),
      category: '',
      reference: String(i.id ?? ''),
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * Purchases, grouped by category.
 *
 * Materials and expenses come out as one list, because the question is what
 * was bought and what GST it carried, not which table it happens to live in.
 * A material with no category of its own is reported as Materials, which is
 * what it is — an earlier import left 148 of them null.
 */
export function purchaseDetail(input: BASDetailInput): CategoryGroup[] {
  const { materials, expenses, assets, year, quarter, onBooks } = input
  const rows: DetailRow[] = []

  for (const m of materials) {
    if (!onBooks(m) || isCashPaid(m) || !inQuarter(m.date, year, quarter)) continue
    const party = String(m.supplier ?? '').trim() || 'Unknown'
    const amount = r2(n(m.total_inc_gst) || n(m.cost_ex_gst) + n(m.gst))
    rows.push({
      date: String(m.date ?? ''), party,
      description: describe(party, m.mat_desc, m.receipt_no),
      amountIncGST: amount, gst: r2(n(m.gst)),
      category: String(m.category ?? '').trim() || 'Materials',
      reference: String(m.receipt_no ?? '').trim() || String(m.job_id ?? ''),
    })
  }

  for (const e of expenses) {
    if (!onBooks(e) || isCashPaid(e) || !inQuarter(e.date, year, quarter)) continue
    const party = String(e.supplier ?? '').trim() || String(e.exp_desc ?? '').trim() || 'Unknown'
    const amount = r2(expIncGST(e))
    rows.push({
      date: String(e.date ?? ''), party,
      description: describe(party, e.exp_desc, ''),
      amountIncGST: amount, gst: r2(n(e.gst)),
      category: String(e.category ?? '').trim() || 'Other',
      reference: String(e.job_id ?? ''),
    })
  }

  // A capital purchase is still a purchase on the BAS, and its GST is
  // claimable in the quarter it was bought even though the cost is deducted
  // over years. It gets its own category so it is not mistaken for a
  // consumable.
  for (const a of assets) {
    if (isCashPaid(a) || !inQuarter(a.purchase_date, year, quarter)) continue
    const party = String(a.supplier ?? '').trim() || 'Unknown'
    const amount = r2(n(a.total_inc_gst) || n(a.cost_ex_gst) + n(a.gst))
    rows.push({
      date: String(a.purchase_date ?? ''), party,
      description: String(a.name ?? '').trim() || describe(party, a.notes, a.invoice_no),
      amountIncGST: amount, gst: r2(n(a.gst)),
      category: 'Capital purchases (assets)',
      reference: String(a.invoice_no ?? '').trim() || String(a.id ?? ''),
    })
  }

  const byCat = new Map<string, DetailRow[]>()
  for (const r of rows) {
    if (!byCat.has(r.category)) byCat.set(r.category, [])
    byCat.get(r.category)!.push(r)
  }

  return [...byCat.entries()]
    .map(([category, rs]) => ({
      category,
      rows: rs.sort((a, b) => a.date.localeCompare(b.date)),
      amountIncGST: r2(rs.reduce((s, r) => s + r.amountIncGST, 0)),
      gst: r2(rs.reduce((s, r) => s + r.gst, 0)),
    }))
    // Largest category first: that is the order the questions get asked in.
    .sort((a, b) => b.amountIncGST - a.amountIncGST)
}

const esc = (v: unknown): string => {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const line = (cells: unknown[]): string => cells.map(esc).join(',')
const money = (x: number): string => x.toFixed(2)

/**
 * One CSV with the three things that were asked for: the totals, the sales
 * behind them, and the purchases behind them.
 *
 * Three sections in one file rather than three files, because the totals are
 * only checkable against the detail that produced them, and an accountant
 * reconciling a figure should not have to open two attachments to do it.
 */
export function basDetailCSV(input: BASDetailInput, companyName = '', abn = ''): string[] {
  const { year, quarter } = input
  const [from, to] = quarterRange(year, quarter)
  const sales = salesDetail(input)
  const groups = purchaseDetail(input)

  const salesInc = r2(sales.reduce((s, r) => s + r.amountIncGST, 0))
  const salesGST = r2(sales.reduce((s, r) => s + r.gst, 0))
  const purchInc = r2(groups.reduce((s, g) => s + g.amountIncGST, 0))
  const purchGST = r2(groups.reduce((s, g) => s + g.gst, 0))

  const out: string[] = []
  out.push(line([`BAS detail — ${quarterLabel(year, quarter)}`]))
  out.push(line([`${from} to ${to}`, '', companyName, abn ? `ABN ${abn}` : '']))
  out.push(line([input.basis === 'cash'
    ? 'Cash basis: sales counted when payment was received'
    : 'Accrual basis: sales counted when the invoice was issued']))
  out.push(line(['Cash-paid purchases and cash jobs are excluded — no GST is claimed or collected on either']))
  out.push('')

  out.push(line(['SUMMARY']))
  out.push(line(['', '', 'Total sales received (inc GST)', money(salesInc), money(salesGST)]))
  out.push(line(['', '', 'Total purchases (inc GST)', money(purchInc), money(purchGST)]))
  out.push(line(['', '', 'Net GST', '', money(r2(salesGST - purchGST))]))
  out.push('')

  out.push(line(['SALES RECEIVED']))
  out.push(line(['Date', 'Received from', 'Description', 'Invoice', 'Amount inc GST', 'GST']))
  for (const r of sales)
    out.push(line([r.date, r.party, r.description, r.reference, money(r.amountIncGST), money(r.gst)]))
  out.push(line(['', '', `Total — ${sales.length} invoice${sales.length !== 1 ? 's' : ''}`, '',
    money(salesInc), money(salesGST)]))
  out.push('')

  out.push(line(['PURCHASES AND EXPENSES, BY CATEGORY']))
  for (const g of groups) {
    out.push('')
    out.push(line([g.category.toUpperCase()]))
    out.push(line(['Date', 'Paid to', 'Description', 'Reference', 'Amount inc GST', 'GST']))
    for (const r of g.rows)
      out.push(line([r.date, r.party, r.description, r.reference, money(r.amountIncGST), money(r.gst)]))
    out.push(line(['', '', `Subtotal — ${g.category} (${g.rows.length})`, '',
      money(g.amountIncGST), money(g.gst)]))
  }
  out.push('')
  out.push(line(['', '', 'TOTAL PURCHASES', '', money(purchInc), money(purchGST)]))

  return out
}
