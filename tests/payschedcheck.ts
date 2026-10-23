// Building a payment schedule.
//
// The milestone arithmetic moved out of Payments.tsx so the invoice modal
// could offer a schedule without a second copy of it. These pin what it
// produced before the move: the percentages, the deposit, the dates off the
// start, and the GST-free flag on cash work.

import { STRUCTURES, buildMS, scheduleRowFor, hasSchedule, scheduleFor } from '@/lib/paySchedule'
import { parseMilestones } from '@/lib/utils'

let fail = 0
const ok = (c: boolean, m: string) => { if (!c) { fail++; console.log('FAIL', m) } else console.log('ok  ', m) }
const near = (a: number, b: number) => Math.abs(a - b) < 1.01   // milestones round to the dollar

ok(STRUCTURES.length === 4, 'four structures')
ok(STRUCTURES.map(s => s.id).join() === 'df,dpf,d2pf,wk', 'and their ids are unchanged')

// ── Deposit + final, $10,000 ex GST at 20% ──────────────────
const df = buildMS(10000, 'df', 20, '2026-11-02')
ok(df.length === 2, 'deposit and final')
ok(df[0].label === 'Deposit' && df[0].pct === 20, 'the deposit is the percentage given')
ok(near(df[0].amount, 2200), 'and 20% of 11000 inc GST is 2200')
ok(near(df[1].amount, 8800), 'the final is the other 80%')
ok(near(df[0].amount + df[1].amount, 11000), 'together they are the whole job inc GST')
ok(df[0].dueDate === '2026-11-02', 'the deposit is due on the start date')
ok(df[1].dueDate === '', 'and the final has no date until there is one to agree')
ok(df.every(m => !m.received), 'nothing is received yet')

// ── The new 10% default ─────────────────────────────────────
const tenth = buildMS(10000, 'df', 10, '2026-11-02')
ok(near(tenth[0].amount, 1100), 'a 10% deposit on the same job is 1100')
ok(near(tenth[1].amount, 9900), 'leaving 9900')

// ── Progress claims, and their dates ────────────────────────
const dpf = buildMS(10000, 'dpf', 20, '2026-11-02')
ok(dpf.length === 3, 'deposit, progress, final')
ok(dpf[1].dueDate === '2026-11-09', 'the progress claim falls a week after the start')
ok(near(dpf[0].amount + dpf[1].amount + dpf[2].amount, 11000), 'and the three still total the job')

const d2pf = buildMS(10000, 'd2pf', 20, '2026-11-02')
ok(d2pf.length === 4, 'deposit, two progress claims, final')
ok(d2pf[1].dueDate === '2026-11-09' && d2pf[2].dueDate === '2026-11-16',
  'a week and a fortnight after the start')
ok(near(d2pf.reduce((s, m) => s + m.amount, 0), 11000), 'and they total the job')

const wk = buildMS(10000, 'wk', 20, '2026-11-02')
ok(wk.length === 4 && wk[1].label.startsWith('Week'), 'weekly claims are labelled by week')
ok(near(wk.reduce((s, m) => s + m.amount, 0), 11000), 'and total the job too')

// ── Cash work carries no GST ────────────────────────────────
const cash = buildMS(10000, 'df', 20, '2026-11-02', true)
ok(near(cash[0].amount, 2000), 'a cash deposit is 20% of 10000, not of 11000')
ok(near(cash.reduce((s, m) => s + m.amount, 0), 10000), 'and the schedule totals the agreed figure')
ok((cash[0] as any).gstFree === true, 'each milestone carries the flag, since a schedule can outlive its job')
ok((df[0] as any).gstFree === undefined, 'while an invoiced job sets nothing')

// ── No start date ───────────────────────────────────────────
const undated = buildMS(10000, 'd2pf', 20, '')
ok(undated.every(m => m.dueDate === ''), 'with no start date, nothing is given one')
ok(near(undated.reduce((s, m) => s + m.amount, 0), 11000), 'but the amounts are still right')

// ── A 100% deposit, and a 0% one ────────────────────────────
const all = buildMS(10000, 'df', 100, '2026-11-02')
ok(near(all[0].amount, 11000) && all[1].amount === 0, 'the whole job up front leaves nothing after')
const none = buildMS(10000, 'df', 0, '2026-11-02')
ok(none[0].amount === 0 && near(none[1].amount, 11000), 'and no deposit puts it all in the final')

// ── The row that gets saved ─────────────────────────────────
const JOB = { id: 'NP-1', client: 'Smith' }
const row = scheduleRowFor(JOB, { value: 10000, struct: 'df', depositPct: 10, start: '2026-11-02' })
ok(row.id === 'NP-1', "the schedule's id is the job's — that is what makes one per job")
ok(row.worker === 'Smith', 'the client is on it')
ok(row.amount === 10000, 'with the agreed value ex GST')
ok(row.paid === false, 'and nothing paid')
ok(row.period_start === '2026-11-02', 'the period starts at the first milestone')
ok(row.period_end === null, 'and has no end while the final payment has no date')

const stored = parseMilestones(row)
ok(stored.length === 2, 'the milestones are stored as JSON in notes, as the app reads them')
ok(near(stored[0].amount, 1100), 'at the figures they were built with')

const noJob = scheduleRowFor(undefined, { value: 5000, struct: 'df', depositPct: 10, start: '' })
ok(noJob.id.startsWith('ps'), 'a schedule with no job behind it gets its own id')
ok(noJob.worker === 'Unknown', 'and says so rather than being blank')

// ── Finding one ─────────────────────────────────────────────
const SCHEDULES = [{ id: 'NP-1', worker: 'Smith' }, { id: 'NP-2', worker: 'Jones' }]
ok(hasSchedule(SCHEDULES, 'NP-1'), 'a job with a schedule has one')
ok(!hasSchedule(SCHEDULES, 'NP-9'), 'a job without one does not')
ok(!hasSchedule(SCHEDULES, '') && !hasSchedule(SCHEDULES, null), 'and no job has none')
ok(scheduleFor(SCHEDULES, 'NP-2')?.worker === 'Jones', 'the right one is found')
ok(scheduleFor(SCHEDULES, 'NP-9') === undefined, 'and a missing one is undefined, not a throw')

console.log(fail ? `\n${fail} FAILED` : '\nall passed')
process.exit(fail ? 1 : 0)
