// The labour hours budget, and what is left of it.
//
// The figure that matters is "remaining", and the way it goes wrong is a job
// with no estimate reading as a hundred hours over rather than as unknown.
// That, the rate it divides by, and the ranking are what is asserted.

import { jobHours, hoursSummary, hoursLogged, hoursColour, hoursLabel } from '@/lib/hours'

let fail = 0
const ok = (c: boolean, m: string) => { if (!c) { fail++; console.log('FAIL', m) } else console.log('ok  ', m) }
const near = (a: number, b: number) => Math.abs(a - b) < 0.015

const LAB = [
  { job_id: 'A', hours: 20 }, { job_id: 'A', hours: 12.5 },
  { job_id: 'B', hours: 120 },
  { job_id: 'C', hours: 8 },
  { job_id: 'D', hours: 5 },
]

ok(near(hoursLogged(LAB, 'A'), 32.5), 'hours on a job add up across its entries')
ok(hoursLogged(LAB, 'ZZ') === 0, 'a job with no entries has logged nothing')

// ── The budget is the estimate divided by the rate ───────────
// $6,500 of labour at $65/hr is 100 hours.
const a = jobHours({ id: 'A', est_labour_ex: 6500, labour_rate: 65 }, LAB, 50)
ok(a.budgeted === 100, 'a $6,500 labour estimate at $65/hr budgets 100 hours')
ok(a.rate === 65, "the job's own rate is used, not the business default")
ok(near(a.logged, 32.5) && near(a.remaining!, 67.5), '32.5 logged leaves 67.5')
ok(near(a.used!, 0.325), 'a third of the budget used')
ok(!a.over && !a.tight, 'and it is neither over nor tight')

const noRate = jobHours({ id: 'A', est_labour_ex: 6500 }, LAB, 65)
ok(noRate.budgeted === 100, 'a job with no rate of its own falls back to the business rate')
ok(noRate.rate === 65, 'which it reports, so the table can show it')

// ── Over, and tight ──────────────────────────────────────────
const b = jobHours({ id: 'B', est_labour_ex: 6500, labour_rate: 65 }, LAB, 65)
ok(b.over && near(b.remaining!, -20), '120 hours against a 100 hour budget is 20 over')
ok(hoursColour(b) === '#dc2626' && hoursLabel(b) === '-20.0', 'shown red and signed')
ok(!b.tight, 'over is not also tight — it is past that')

const tight = jobHours({ id: 'C', est_labour_ex: 650, labour_rate: 65 }, LAB, 65)
ok(tight.budgeted === 10 && near(tight.remaining!, 2), '8 of 10 hours leaves 2')
ok(tight.tight && !tight.over, 'inside the last quarter of the budget is tight')
ok(hoursColour(tight) === '#d97706', 'shown amber')

const fine = jobHours({ id: 'D', est_labour_ex: 6500, labour_rate: 65 }, LAB, 65)
ok(!fine.tight && !fine.over && hoursColour(fine) === '#16a34a', 'plenty of room is green')
ok(hoursLabel(fine) === '+95.0', 'and the remaining figure carries its plus')

// ── No estimate is unknown, not zero ─────────────────────────
const none = jobHours({ id: 'A' }, LAB, 65)
ok(none.budgeted === null, 'a job with no labour estimate has no budget')
ok(none.remaining === null && none.used === null, 'so nothing remains and nothing is used')
ok(!none.over, 'and it is NOT reported as over — 32.5 hours against no budget is unknown')
ok(near(none.logged, 32.5), 'though the hours logged are still counted')
ok(hoursLabel(none) === '—', 'and it prints as a dash')

const zeroRate = jobHours({ id: 'A', est_labour_ex: 6500, labour_rate: 0 }, LAB, 0)
ok(zeroRate.budgeted === null, 'no rate anywhere means no budget rather than a division by zero')
ok(!Number.isNaN(zeroRate.logged), 'and no NaN')

const junk = jobHours({ id: 'A', est_labour_ex: 'lots', labour_rate: 'heaps' } as any, LAB, 65)
ok(junk.budgeted === null && !Number.isNaN(junk.logged), 'junk in the job does not become NaN')

// ── The summary, and its ranking ─────────────────────────────
const JOBS = [
  { id: 'A', client: 'Able', est_labour_ex: 6500, labour_rate: 65 },   // 67.5 left
  { id: 'B', client: 'Baker', est_labour_ex: 6500, labour_rate: 65 },  // 20 over
  { id: 'C', client: 'Carr', est_labour_ex: 650, labour_rate: 65 },    // 2 left, tight
  { id: 'D', client: 'Dunn', est_labour_ex: 65000, labour_rate: 65 },  // 995 left
  { id: 'E', client: 'East' },                                         // no estimate, no hours
  { id: 'F', client: 'Ford' },                                         // no estimate
]
const LAB2 = [...LAB, { job_id: 'F', hours: 3 }]
const sum = hoursSummary(JOBS, LAB2, 65)

ok(sum.rows.length === 4, 'four jobs have an hours budget')
ok(sum.rows[0].job.id === 'B', 'the job over budget ranks first')
ok(sum.rows[1].job.id === 'C', 'then the tightest of the rest')
ok(sum.rows[sum.rows.length - 1].job.id === 'D', 'and the one with most room last')

ok(sum.overCount === 1 && sum.tightCount === 1, 'the counts are right')
ok(near(sum.totalBudgeted, 100 + 100 + 10 + 1000), 'budgets total across the jobs that have one')
ok(near(sum.totalRemaining, 67.5 - 20 + 2 + 995), 'and so does what is left, overruns netting off')
ok(near(sum.totalLogged, 32.5 + 120 + 8 + 5 + 3),
  'hours logged counts every job, including ones with no budget')

ok(sum.unbudgeted.length === 1 && sum.unbudgeted[0].job.id === 'F',
  'a job with hours and no estimate is listed separately, not hidden')
ok(!sum.unbudgeted.some(u => u.job.id === 'E'),
  'and one with neither is not mentioned at all')

// Two jobs equally over sort by the worse overrun.
const worse = hoursSummary([
  { id: 'X', est_labour_ex: 650, labour_rate: 65 },
  { id: 'Y', est_labour_ex: 650, labour_rate: 65 },
], [{ job_id: 'X', hours: 12 }, { job_id: 'Y', hours: 50 }], 65)
ok(worse.rows[0].job.id === 'Y', '40 hours over outranks 2 hours over')

const empty = hoursSummary([], [], 65)
ok(empty.rows.length === 0 && empty.totalRemaining === 0, 'no jobs is zero, not NaN')

console.log(fail ? `\n${fail} FAILED` : '\nall passed')
process.exit(fail ? 1 : 0)
