// The attention list, and the overdue scheduled payments now in it.
//
// This list is read by the Dashboard and by the assistant, so a rule that
// fires here fires in both. What matters is that an overdue milestone shows
// up exactly once, ranked with everything else by money, and that a caller
// that passes no schedules still gets the other four rules.

import { attentionList, type AttentionItem } from '@/lib/attention'

let fail = 0
const ok = (c: boolean, m: string) => { if (!c) { fail++; console.log('FAIL', m) } else console.log('ok  ', m) }

const TODAY = '2026-10-20'
const ms = (...rows: any[]) => JSON.stringify(rows)
const mk = (label: string, amount: number, dueDate = '', received = false) =>
  ({ label, amount, dueDate, received, pct: 0, receivedDate: '' })

const JOBS = [
  { id: 'NP-1', client: 'Smith', on_books: 'Invoiced', status: 'In Progress' },
  { id: 'NP-2', client: 'Jones', on_books: 'Cash', status: 'In Progress' },
]
const SCHEDULES = [
  { id: 'NP-1', worker: 'Smith', notes: ms(
      mk('Deposit', 2000, '2026-09-01', true),     // paid, must not appear
      mk('Progress claim', 4000, '2026-10-01'),    // overdue 19 days
      mk('Final payment', 9000, '2026-12-01'),     // not due yet
      mk('Extra', 500, ''),                        // no date
    ) },
  { id: 'NP-2', worker: 'Jones', notes: ms(mk('Final', 6000, '2026-10-10')) },  // overdue, cash
]

const base = { jobs: JOBS, invoices: [], enquiries: [], assignments: [] }
const list = attentionList({ ...base, schedules: SCHEDULES }, TODAY)
const pay = list.filter(i => i.kind === 'payment_overdue')

ok(pay.length === 2, `only the two overdue milestones raise an alert (${pay.length})`)
ok(!pay.some(p => p.label.includes('Deposit')), 'a received milestone raises none')
ok(!pay.some(p => p.label.includes('Final payment')), 'and nor does one not yet due')
ok(!pay.some(p => p.label.includes('Extra')), 'an undated milestone is pending, not an alert')

ok(pay[0].amount === 6000, 'the biggest overdue payment ranks first')
ok(list[0].kind === 'payment_overdue' && list[0].amount === 6000,
  'and ranks against every other kind by money, not by category')

const cash = pay.find(p => p.jobId === 'NP-2')!
ok(cash.label.includes('cash job'), 'a cash job says so — that money is in no invoice')
ok(cash.days === 10, 'and carries how many days late it is')
ok(cash.route === '/payments', 'it opens the Pay Schedules page')
ok(cash.client === 'Jones' && cash.jobId === 'NP-2', 'with the client and job named')

// Two milestones on one job must not collide into one entry.
const ids = new Set(pay.map(p => p.id))
ok(ids.size === pay.length, 'each milestone has its own id, so none overwrites another')

// ── Ranking against the other rules ──────────────────────────
const withInvoice = attentionList({
  ...base, schedules: SCHEDULES,
  invoices: [{ id: 'INV-9', job_id: 'NP-1', client: 'Smith', due_date: '2026-01-01', total_inc_gst: 99, received: 0 }],
}, TODAY)
ok(withInvoice[0].amount === 6000, 'a $6,000 overdue payment outranks a $99 overdue invoice')
ok(withInvoice.some(i => i.kind === 'invoice_overdue'), 'and the invoice is still there, below it')

// ── A caller with no schedules ───────────────────────────────
const without = attentionList(base, TODAY)
ok(!without.some(i => i.kind === 'payment_overdue'), 'no schedules means no payment alerts')
ok(Array.isArray(without), 'and the call still works — the field is optional')

const empties: AttentionItem[] = attentionList({ ...base, schedules: [{ id: 'X', notes: 'junk' }] }, TODAY)
ok(empties.length === 0, 'an unparseable schedule raises nothing rather than throwing')

// ── The boundary ─────────────────────────────────────────────
const today = attentionList({ ...base, schedules: [{ id: 'NP-1', worker: 'S', notes: ms(mk('Due today', 100, TODAY)) }] }, TODAY)
ok(today.length === 0, 'a payment due today is not yet overdue')
const ydayList = attentionList({ ...base, schedules: [{ id: 'NP-1', worker: 'S', notes: ms(mk('Yesterday', 100, '2026-10-19')) }] }, TODAY)
ok(ydayList.length === 1 && ydayList[0].days === 1, 'one day later it is, by a day')

console.log(fail ? `\n${fail} FAILED` : '\nall passed')
process.exit(fail ? 1 : 0)
