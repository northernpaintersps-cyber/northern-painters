// Every movement of money, in one list, to tick off against a statement.
//
// Reconciling meant opening four screens and adding things up by eye. The
// exports that existed were shaped for Xero — sales in one file, bills in
// another, both ex GST — which is the wrong shape for sitting next to a
// bank statement.
//
// A statement has one column of dates and one of amounts, and every amount
// is what actually left or entered the account: INC GST, on the day it
// moved. So that is what this produces, money in and money out together,
// oldest first.
//
// Two things matter more than completeness here:
//
//   Cash is marked, not hidden. Cash never appears on a statement, and the
//   first question when a figure does not match is "was that the cash job?"
//   Leaving cash out would answer it; marking it answers it better, because
//   the row is still there to be accounted for.
//
//   Undated rows are listed, not dropped. A material with no date cannot be
//   matched to anything, and the only useful thing to do is say so.
//
// Pure — no hooks, no Supabase.

import { isCashPaid, offBooksInvoice } from './cashBooks'
import { labourCost } from './cashBooks'
import { isCashJob } from './utils'

type Row = Record<string, any>

const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0 }
const r2 = (v: number) => Math.round(v * 100) / 100
const d10 = (v: unknown) => String(v ?? '').slice(0, 10)

export interface MoneyMove {
  /** 'YYYY-MM-DD', or '' when the record carries no date. */
  date: string
  direction: 'In' | 'Out'
  /** What hit the account, inc GST. Always positive; `direction` carries the sign. */
  amount: number
  description: string
  /** Invoice number, receipt number, whatever you would find on a statement. */
  reference: string
  /** Which part of the app it came from. */
  source: 'Invoice' | 'Material' | 'Expense' | 'Labour' | 'Asset'
  /** 'Bank' | 'Card' | 'Cash' | '' */
  paidBy: string
  /**
   * Whether to expect this on the statement — whether it went through the
   * account. Cash did not.
   *
   * A different question from whether it was DECLARED. An undeclared sale
   * paid by transfer is still on the statement, and conflating the two put
   * a cash job's money in the bank column.
   */
  onStatement: boolean
  /** On the BAS and in taxable income. False for a cash job, an invoice
   *  declared cash, or anything paid in cash. */
  declared: boolean
  job: string
  client: string
  /** Why a row cannot be matched: no date, no amount. */
  note: string
}

export interface ReconInput {
  invoices?: Row[]
  materials?: Row[]
  expenses?: Row[]
  labour?: Row[]
  assets?: Row[]
  jobs?: Row[]
  /** Inclusive 'YYYY-MM-DD' bounds. Omit for everything. */
  from?: string
  to?: string
}

/**
 * Money in: what was received against an invoice, on the day it was received.
 *
 * Not what was invoiced — an invoice is a claim, and a claim is not a bank
 * entry. `received` is the figure that moved, and `date_paid` is when.
 */
function invoiceMoves(input: ReconInput): MoneyMove[] {
  const cashJobIds = new Set((input.jobs ?? []).filter(isCashJob).map(j => String(j.id)))
  const out: MoneyMove[] = []
  for (const i of input.invoices ?? []) {
    const received = n(i.received)
    const cash = n(i.extra?.cash_received)
    const offBooks = offBooksInvoice(i, cashJobIds)
    if (received <= 0 && cash <= 0) continue

    // What arrived by bank, as against what arrived as notes. An invoice can
    // carry both, and they are two entries: one is on the statement and one
    // is not.
    const common = {
      date: d10(i.date_paid || i.date),
      direction: 'In' as const,
      description: `Invoice ${i.id ?? ''} — ${i.client ?? ''}`.trim(),
      reference: String(i.id ?? ''),
      source: 'Invoice' as const,
      job: String(i.job_id ?? ''),
      client: String(i.client ?? ''),
      declared: !offBooks,
      note: d10(i.date_paid) ? '' : 'no payment date — using the invoice date',
    }
    const withNote = (extra: string) => [common.note, extra].filter(Boolean).join('; ')

    if (offBooks) {
      // Off the books and nothing says how it arrived: it arrived as cash,
      // which is the point of a cash job. Said out loud rather than assumed
      // quietly, because the alternative — undeclared money paid by
      // transfer — WOULD be on the statement and is worth noticing.
      out.push({
        ...common, amount: r2(Math.max(received, cash)), paidBy: 'Cash', onStatement: false,
        note: withNote('off the books — taken as cash, so not on the statement'),
      })
      continue
    }

    const banked = r2(Math.max(0, received - cash))
    if (banked > 0) out.push({ ...common, amount: banked, paidBy: 'Bank', onStatement: true })
    if (cash > 0) {
      out.push({
        ...common, amount: r2(cash), paidBy: 'Cash', onStatement: false,
        note: withNote('cash — not on the statement'),
      })
    }
  }
  return out
}

/** Money out: what was paid for materials, overheads, hours and assets. */
function costMoves(input: ReconInput): MoneyMove[] {
  const out: MoneyMove[] = []

  for (const m of input.materials ?? []) {
    const amount = r2(n(m.total_inc_gst) || n(m.cost_ex_gst) + n(m.gst))
    if (amount <= 0) continue
    out.push({
      date: d10(m.date), direction: 'Out', amount,
      description: [m.supplier, m.mat_desc].filter(Boolean).join(' — ') || 'Materials',
      reference: String(m.receipt_no ?? ''),
      source: 'Material', declared: !isCashPaid(m),
      paidBy: isCashPaid(m) ? 'Cash' : String(m.paid_by ?? ''),
      onStatement: !isCashPaid(m),
      job: String(m.job_id ?? ''), client: String(m.client ?? ''),
      note: d10(m.date) ? (isCashPaid(m) ? 'cash — not on the statement' : '') : 'no date',
    })
  }

  for (const e of input.expenses ?? []) {
    const amount = r2(n(e.amount_ex_gst) + n(e.gst))
    if (amount <= 0) continue
    out.push({
      date: d10(e.date), direction: 'Out', amount,
      description: [e.supplier, e.exp_desc].filter(Boolean).join(' — ') || 'Expense',
      reference: '', source: 'Expense', declared: !isCashPaid(e),
      paidBy: isCashPaid(e) ? 'Cash' : String(e.paid_by ?? ''),
      onStatement: !isCashPaid(e),
      job: String(e.job_id ?? ''), client: '',
      note: d10(e.date) ? (isCashPaid(e) ? 'cash — not on the statement' : '') : 'no date',
    })
  }

  // Hours are money out on the day they were logged, which is near enough:
  // a wage run lands as one bank entry covering several of these, so they
  // are there to be added up against it rather than matched one to one.
  for (const l of input.labour ?? []) {
    const amount = r2(labourCost(l))
    if (amount <= 0) continue
    const cash = isCashPaid(l) || String(l.worker_payment_type ?? '') === 'Cash'
    out.push({
      date: d10(l.date), direction: 'Out', amount,
      description: `${l.sub ?? 'Labour'}${l.hours ? ` — ${l.hours} hrs` : ''}`,
      reference: '', source: 'Labour', declared: !cash,
      paidBy: cash ? 'Cash' : String(l.paid_by ?? ''),
      onStatement: !cash,
      job: String(l.job_id ?? ''), client: String(l.client ?? ''),
      note: [
        d10(l.date) ? '' : 'no date',
        cash ? 'cash — not on the statement' : '',
        l.paid === false ? 'not marked paid yet' : '',
      ].filter(Boolean).join('; '),
    })
  }

  for (const a of input.assets ?? []) {
    const amount = r2(n(a.total_inc_gst) || n(a.cost_ex_gst) + n(a.gst))
    if (amount <= 0) continue
    out.push({
      date: d10(a.purchase_date), direction: 'Out', amount,
      description: [a.supplier, a.name].filter(Boolean).join(' — ') || 'Asset',
      reference: String(a.invoice_no ?? ''),
      source: 'Asset', declared: !isCashPaid(a),
      paidBy: isCashPaid(a) ? 'Cash' : String(a.paid_by ?? ''),
      onStatement: !isCashPaid(a),
      job: '', client: '',
      note: d10(a.purchase_date) ? (isCashPaid(a) ? 'cash — not on the statement' : '') : 'no date',
    })
  }

  return out
}

/**
 * Every movement, oldest first, with undated rows at the end.
 *
 * Undated last because they cannot be matched to a statement line and would
 * otherwise sort to the top, where the matching starts.
 */
export function moneyMoves(input: ReconInput): MoneyMove[] {
  const all = [...invoiceMoves(input), ...costMoves(input)]
  const inRange = (d: string) =>
    !d || ((!input.from || d >= input.from) && (!input.to || d <= input.to))

  return all
    .filter(m => inRange(m.date))
    .sort((a, b) => {
      if (!a.date !== !b.date) return a.date ? -1 : 1
      return a.date.localeCompare(b.date) || a.direction.localeCompare(b.direction)
    })
}

export interface ReconTotals {
  inOnStatement: number
  outOnStatement: number
  /** What the statement should show as the net movement over the period. */
  netOnStatement: number
  inCash: number
  outCash: number
  undatedCount: number
  count: number
}

export function reconTotals(moves: MoneyMove[]): ReconTotals {
  const t: ReconTotals = {
    inOnStatement: 0, outOnStatement: 0, netOnStatement: 0,
    inCash: 0, outCash: 0, undatedCount: 0, count: moves.length,
  }
  for (const m of moves) {
    if (!m.date) t.undatedCount++
    const bucket = m.onStatement
      ? (m.direction === 'In' ? 'inOnStatement' : 'outOnStatement')
      : (m.direction === 'In' ? 'inCash' : 'outCash')
    t[bucket] += m.amount
  }
  t.inOnStatement = r2(t.inOnStatement)
  t.outOnStatement = r2(t.outOnStatement)
  t.inCash = r2(t.inCash)
  t.outCash = r2(t.outCash)
  t.netOnStatement = r2(t.inOnStatement - t.outOnStatement)
  return t
}

/** The header row, and one row per movement. Money out is negative, because
 *  that is how a statement reads and how a spreadsheet sums it. */
export function reconRows(moves: MoneyMove[]): (string | number)[][] {
  return [
    ['Date', 'In/Out', 'Amount inc GST', 'Signed amount', 'Description', 'Reference',
      'Source', 'Paid by', 'On bank statement', 'Declared', 'Job', 'Client', 'Note', 'Matched'],
    ...moves.map(m => [
      m.date, m.direction, m.amount,
      m.direction === 'Out' ? -m.amount : m.amount,
      m.description, m.reference, m.source, m.paidBy,
      m.onStatement ? 'yes' : 'no',
      m.declared ? 'yes' : 'no',
      m.job, m.client, m.note, '',
    ]),
  ]
}

// ── A backup of everything ──────────────────────────────────

/** The tables a backup holds, and the key each goes under. */
export const BACKUP_TABLES: Array<[table: string, key: string]> = [
  ['np_jobs', 'jobs'],
  ['np_labour', 'labour'],
  ['np_materials', 'materials'],
  ['np_receipts', 'receipts'],
  ['np_expenses', 'expenses'],
  ['np_invoices', 'invoices'],
  ['np_crew', 'crew'],
  ['np_assignments', 'assignments'],
  ['np_enquiries', 'enquiries'],
  ['np_variations', 'variations'],
  ['np_todos', 'todos'],
  ['np_calendar_events', 'calendarEvents'],
  ['np_pay_schedules', 'paySchedules'],
  ['np_ads_spend', 'adsSpend'],
  ['np_assets', 'assets'],
  ['np_site_visits', 'siteVisits'],
]

/**
 * The backup file's shape.
 *
 * The keys are the ones importBackup already reads, so a file taken out of
 * this app can be put back into it. np_settings is deliberately absent: it
 * holds the Anthropic API key, and a backup is a file that gets emailed to
 * an accountant.
 */
export function backupFile(
  data: Record<string, Row[]>, meta: { app?: string } = {},
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    exportedAt: new Date().toISOString(),
    app: meta.app ?? 'northern-painters',
    note: 'Settings are not included: they hold an API key.',
  }
  for (const [, key] of BACKUP_TABLES) out[key] = data[key] ?? []
  return out
}
