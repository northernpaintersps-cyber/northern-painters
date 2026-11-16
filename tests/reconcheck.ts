// Every movement of money, to tick off against a statement.
//
// A statement has one column of dates and one of amounts, and each amount is
// what actually moved: inc GST, on the day it moved. Two things decide
// whether this file is usable beside one:
//
//   An amount must be what hit the account. Not what was invoiced — an
//   invoice is a claim, and a claim is not a bank entry.
//
//   Cash must be present and marked. Cash never appears on a statement, and
//   "was that the cash job?" is the first question when a figure does not
//   match. A row that says "not on the statement" answers it; a row that is
//   absent leaves you counting.

import { moneyMoves, reconTotals, reconRows, backupFile, BACKUP_TABLES } from '@/lib/bankRecon'

let fail = 0
const ok = (c: boolean, m: string) => { if (!c) { fail++; console.log('FAIL', m) } else console.log('ok  ', m) }
const near = (a: number, b: number) => Math.abs(a - b) < 0.02

const JOBS = [
  { id: 'NP-1', client: 'Smith', on_books: 'Invoiced' },
  { id: 'NP-2', client: 'Jones', on_books: 'Cash' },
]

const INVOICES = [
  // Paid in full by bank, a fortnight after it was raised.
  { id: 'INV-1', job_id: 'NP-1', client: 'Smith', date: '2026-10-01', date_paid: '2026-10-15',
    agreed_ex_gst: 2000, gst: 200, total_inc_gst: 2200, received: 2200 },
  // Part paid, and part of that in cash: two entries, one bankable.
  { id: 'INV-2', job_id: 'NP-1', client: 'Smith', date: '2026-10-05', date_paid: '2026-10-20',
    agreed_ex_gst: 1000, gst: 100, total_inc_gst: 1100, received: 800,
    extra: { cash_received: 300 } },
  // Raised and never paid: no money moved, so it is not a bank entry at all.
  { id: 'INV-3', job_id: 'NP-1', client: 'Smith', date: '2026-10-08',
    agreed_ex_gst: 5000, gst: 500, total_inc_gst: 5500, received: 0 },
  // A cash job's record: real money, never on a statement.
  { id: 'INV-4', job_id: 'NP-2', client: 'Jones', date: '2026-10-10', date_paid: '2026-10-10',
    agreed_ex_gst: 900, gst: 0, total_inc_gst: 900, received: 900 },
]

const MATERIALS = [
  { id: 'm1', job_id: 'NP-1', date: '2026-10-02', supplier: 'Inspirations', receipt_no: 'R-77',
    cost_ex_gst: 400, gst: 40, total_inc_gst: 440, paid_by: 'Bank' },
  { id: 'm2', job_id: 'NP-1', date: '2026-10-03', supplier: 'Mitre 10',
    cost_ex_gst: 100, gst: 10, total_inc_gst: 110, paid_by: 'Cash' },
  { id: 'm3', job_id: 'NP-1', supplier: 'No date', cost_ex_gst: 50, gst: 5, total_inc_gst: 55 },
]
const EXPENSES = [
  { id: 'e1', date: '2026-10-04', supplier: 'Shell', exp_desc: 'Fuel',
    amount_ex_gst: 90, gst: 9, paid_by: 'Card' },
]
const LABOUR = [
  { id: 'l1', job_id: 'NP-1', date: '2026-10-06', sub: 'Francisco', hours: 8, rate: 65, cost: 520, paid_by: 'Bank' },
  { id: 'l2', job_id: 'NP-1', date: '2026-10-07', sub: 'Danny', hours: 8, rate: 50, cost: 400,
    worker_payment_type: 'Cash' },
]
const ASSETS = [
  { id: 'a1', purchase_date: '2026-10-09', supplier: 'Sydney Tools', name: 'Compressor',
    cost_ex_gst: 1000, gst: 100, total_inc_gst: 1100, paid_by: 'Card' },
]

const all = { invoices: INVOICES, materials: MATERIALS, expenses: EXPENSES, labour: LABOUR, assets: ASSETS, jobs: JOBS }
const moves = moneyMoves(all)

// ── Only money that moved ────────────────────────────────────
ok(!moves.some(m => m.reference === 'INV-3'),
  'an invoice raised and never paid is not a bank entry — a claim is not money')
const in1 = moves.find(m => m.reference === 'INV-1')!
ok(in1.amount === 2200 && in1.direction === 'In', 'a paid invoice is money in at its inc-GST total')
ok(in1.date === '2026-10-15', 'dated when it was PAID, not when it was raised')

// ── An invoice part paid in cash is two entries ──────────────
const two = moves.filter(m => m.reference === 'INV-2')
ok(two.length === 2, 'one invoice paid part by bank and part in cash is two movements')
ok(near(two.reduce((s, m) => s + m.amount, 0), 800), 'together they are what was received')
const banked = two.find(m => m.paidBy === 'Bank')!
const noted = two.find(m => m.paidBy === 'Cash')!
ok(banked.amount === 500 && banked.onStatement, 'the 500 that was banked is on the statement')
ok(noted.amount === 300 && !noted.onStatement, 'the 300 in notes is not')
ok(/cash/i.test(noted.note), 'and the row says so')

// ── Cash is present and marked ───────────────────────────────
const cashJob = moves.find(m => m.reference === 'INV-4')!
ok(!!cashJob, "a cash job's money is in the file")
ok(!cashJob.onStatement, 'marked as not on the statement')
ok(moves.filter(m => m.paidBy === 'Cash').length === 4,
  'four cash movements in all: the part payment, the cash job, the Mitre 10 run and Danny')
ok(moves.filter(m => !m.onStatement).every(m => m.paidBy === 'Cash' || /cash/i.test(m.note)),
  'everything off the statement says why')

// ── Money out, at what left the account ─────────────────────
const mat = moves.find(m => m.reference === 'R-77')!
ok(mat.direction === 'Out' && mat.amount === 440, 'a material is money out at its inc-GST total')
ok(mat.reference === 'R-77', 'carrying the receipt number you would match it by')
ok(moves.find(m => m.source === 'Expense')!.amount === 99, 'an expense is ex GST plus its GST')
ok(moves.find(m => m.source === 'Asset')!.amount === 1100, 'and an asset purchase is money out too')
ok(moves.find(m => m.description.includes('Francisco'))!.amount === 520, 'hours are money out at cost')
ok(moves.find(m => m.description.includes('Danny'))!.onStatement === false,
  'a worker paid cash is not on the statement')

// ── Oldest first, undated last ───────────────────────────────
const dated = moves.filter(m => m.date).map(m => m.date)
ok(dated.join() === [...dated].sort().join(), 'dated rows are oldest first, as a statement reads')
ok(!moves[moves.length - 1].date, 'and an undated row sorts last, where it cannot interrupt matching')
ok(moves.some(m => m.note === 'no date'), 'with its problem named')

// ── The totals the statement should show ─────────────────────
const t = reconTotals(moves)
ok(near(t.inOnStatement, 2200 + 500), 'money in on the statement: 2700')
ok(near(t.outOnStatement, 440 + 99 + 520 + 1100 + 55), 'money out on it: 2214')
ok(near(t.netOnStatement, t.inOnStatement - t.outOnStatement), 'and the net is the difference')
ok(near(t.inCash, 300 + 900), 'cash in, held apart: 1200')
ok(near(t.outCash, 110 + 400), 'and cash out: 510')
ok(t.undatedCount === 1, 'one row cannot be matched')
ok(t.count === moves.length, 'and the count is every row in the file')
ok(near(t.inOnStatement + t.inCash + t.outOnStatement + t.outCash,
  moves.reduce((s, m) => s + m.amount, 0)),
  'every dollar is in exactly one bucket — nothing double counted, nothing lost')

// ── A period ─────────────────────────────────────────────────
const week = moneyMoves({ ...all, from: '2026-10-05', to: '2026-10-09' })
ok(week.every(m => !m.date || (m.date >= '2026-10-05' && m.date <= '2026-10-09')),
  'a range keeps only what falls inside it')
ok(week.some(m => !m.date), 'and keeps undated rows, which no range can exclude fairly')
ok(!week.some(m => m.reference === 'INV-1'), 'a payment outside the range is left out')

// ── The spreadsheet ──────────────────────────────────────────
const rows = reconRows(moves)
ok(rows.length === moves.length + 1, 'a header and one row per movement')
ok(String(rows[0][0]) === 'Date' && rows[0].includes('Matched'),
  'with a Matched column to tick as you go')
const outRow = rows.find(r => r[5] === 'R-77')!
ok(outRow[3] === -440, 'money out is negative in the signed column, so a spreadsheet sums it')
ok(outRow[2] === 440, 'while the plain amount stays positive, as a statement prints it')
ok(rows.every(r => r.length === rows[0].length), 'every row has every column')

// ── Nothing to reconcile ─────────────────────────────────────
const none = reconTotals(moneyMoves({}))
ok(none.count === 0 && none.netOnStatement === 0, 'no data is zero, not NaN')
ok(moneyMoves({ invoices: [{ id: 'x' }], materials: [{ id: 'y' }] }).length === 0,
  'rows with no money in them are not movements')

// ── The backup ───────────────────────────────────────────────
const file = backupFile({ jobs: JOBS, invoices: INVOICES }) as any
ok(Array.isArray(file.jobs) && file.jobs.length === 2, 'a backup holds the tables it was given')
ok(Array.isArray(file.labour) && file.labour.length === 0,
  'and an empty array for the ones it was not, so the shape is always the same')
ok(typeof file.exportedAt === 'string', 'stamped with when it was taken')
ok(!('settings' in file) && !JSON.stringify(file).includes('ai_api_key'),
  'and NEVER the settings, because they hold the API key and a backup gets emailed')
ok(BACKUP_TABLES.length >= 15, `${BACKUP_TABLES.length} tables in a backup`)
ok(!BACKUP_TABLES.some(([t]) => t === 'np_settings'), 'np_settings is not one of them')
ok(BACKUP_TABLES.some(([, k]) => k === 'jobs') && BACKUP_TABLES.some(([, k]) => k === 'paySchedules'),
  'and the keys are the ones the importer already reads, so a backup can be put back')

console.log(fail ? `\n${fail} FAILED` : '\nall passed')
process.exit(fail ? 1 : 0)
