// Scheduled payments still to come.
//
// The point of this figure is the money the invoice-based one cannot see:
// cash work, which is never invoiced. So the assertions are about what gets
// counted, what gets left out, and where the line between pending and
// overdue falls.

import { duePayments, dueTotals } from '@/lib/scheduled'

let fail = 0
const ok = (c: boolean, m: string) => { if (!c) { fail++; console.log('FAIL', m) } else console.log('ok  ', m) }
const near = (a: number, b: number) => Math.abs(a - b) < 0.005

const TODAY = '2026-10-19'
const ms = (...rows: any[]) => JSON.stringify(rows)
const mk = (label: string, amount: number, dueDate = '', received = false) =>
  ({ label, amount, dueDate, received, pct: 0, receivedDate: '' })

const JOBS = [
  { id: 'NP-1', client: 'Smith', on_books: 'Invoiced' },
  { id: 'NP-2', client: 'Jones', on_books: 'Cash' },
]

const SCHEDULES = [
  {
    id: 'NP-1', worker: 'Smith', amount: 10000,
    notes: ms(
      mk('Deposit', 2000, '2026-09-01', true),      // paid
      mk('Progress claim', 4000, '2026-10-01'),     // overdue by 18 days
      mk('Final payment', 5000, ''),                // no date yet
    ),
  },
  {
    id: 'NP-2', worker: 'Jones', amount: 6000,
    notes: ms(
      mk('Deposit', 1500, '2026-10-25'),            // not due yet
      mk('Final payment', 4500, '2026-11-30'),
    ),
  },
]

const due = duePayments(SCHEDULES, JOBS, TODAY)
ok(due.length === 4, `four milestones still to come — the paid deposit is out (${due.length})`)
ok(!due.some(d => d.label === 'Deposit' && d.jobId === 'NP-1'), 'a received milestone never appears')

const overdue = due.filter(d => d.overdue)
ok(overdue.length === 1 && overdue[0].amount === 4000, 'one milestone is overdue')
ok(overdue[0].daysOverdue === 18, 'by 18 days, counted from its due date')
ok(due[0].overdue, 'and it sorts to the top')

const undated = due.find(d => d.dueDate === '')
ok(!!undated && !undated.overdue, 'a milestone with no due date is pending, not overdue')
ok(!!undated && undated.amount === 5000, 'and it is still counted — that is real money')
ok(due[due.length - 1].dueDate === '', 'undated milestones sort last')

ok(due.filter(d => d.cash).length === 2, 'both of the cash job s milestones are marked cash')
ok(due.every(d => d.client), 'every one carries the client name for the list')

// ── Totals ───────────────────────────────────────────────────
const t = dueTotals(SCHEDULES, JOBS, TODAY)
ok(near(t.total, 4000 + 5000 + 1500 + 4500), 'the total is every unpaid milestone: 15000')
ok(near(t.overdue, 4000), 'overdue is 4000')
ok(near(t.pending, 5000 + 1500 + 4500), 'pending is the other 11000')
ok(near(t.overdue + t.pending, t.total), 'and the two halves make the whole')
ok(near(t.cash, 6000), 'the cash job accounts for 6000 of it — money no invoice records')
ok(t.count === 4 && t.overdueCount === 1, 'the counts match the list')
ok(t.worstDays === 18, 'the oldest overdue milestone sets the worst-case age')

// ── The boundary ─────────────────────────────────────────────
const boundary = [{ id: 'B', worker: 'X', notes: ms(mk('Due today', 100, TODAY), mk('Due tomorrow', 100, '2026-10-20')) }]
const bt = dueTotals(boundary, [], TODAY)
ok(bt.overdue === 0, 'a payment due today is not yet overdue')
ok(near(bt.pending, 200), 'both are pending')
const yday = dueTotals([{ id: 'B', worker: 'X', notes: ms(mk('Yesterday', 100, '2026-10-18')) }], [], TODAY)
ok(near(yday.overdue, 100) && yday.worstDays === 1, 'and one day later it is overdue by a day')

// ── Nothing, and nonsense ────────────────────────────────────
const empty = dueTotals([], [], TODAY)
ok(empty.total === 0 && empty.count === 0 && empty.worstDays === 0, 'no schedules is zero, not NaN')
ok(dueTotals([{ id: 'X', notes: 'not json' }], [], TODAY).total === 0, 'an unparseable schedule is skipped')
ok(dueTotals([{ id: 'X', notes: null }], [], TODAY).total === 0, 'and so is one with no milestones')
ok(dueTotals([{ id: 'X', notes: ms(mk('Unpriced', 0, '2020-01-01')) }], [], TODAY).total === 0,
  'a milestone with no amount owes nothing, however old it is')
ok(!Number.isNaN(dueTotals([{ id: 'X', notes: ms({ label: 'junk', amount: 'abc', dueDate: 5 }) }], [], TODAY).total),
  'junk in a milestone does not become NaN')

// A schedule whose job has been deleted still owes what it owes.
const orphan = dueTotals([{ id: 'GONE', worker: 'Nobody', notes: ms(mk('Final', 800, '2026-01-01')) }], JOBS, TODAY)
ok(near(orphan.overdue, 800), 'a schedule with no job behind it is still counted')
ok(orphan.cash === 0, 'and is treated as on the books, which is the conservative read')

console.log(fail ? `\n${fail} FAILED` : '\nall passed')
process.exit(fail ? 1 : 0)
