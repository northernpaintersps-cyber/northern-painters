// Finished jobs stay on the calendar.
//
// Marking a job done used to empty every day the crew spent on it. What is
// asserted here is that those days come back, that today counts as past, and
// that a finished job with dates still ahead does not put phantom work on
// the board.

import {
  calendarDates, onCalendar, isDoneJob, isLiveJob,
  CONFIRMED_STATUSES, DONE_STATUSES,
} from '@/lib/calendarJobs'

let fail = 0
const ok = (c: boolean, m: string) => { if (!c) { fail++; console.log('FAIL', m) } else console.log('ok  ', m) }

const TODAY = '2026-10-23'
const job = (status: string, dates: string[]) =>
  ({ id: 'NP-1', status, scheduled_dates: dates })

// A week the crew worked, Monday to Friday, now in the past.
const LAST_WEEK = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16']

// ── The thing that was broken ────────────────────────────────
const finished = job('Finished', LAST_WEEK)
ok(onCalendar(finished), 'a finished job is still on the calendar')
ok(calendarDates(finished, TODAY).length === 5,
  'and keeps all five days the crew spent on it')
ok(calendarDates(finished, TODAY).join() === LAST_WEEK.join(), 'the same days, in order')
ok(calendarDates(job('Closed', LAST_WEEK), TODAY).length === 5, 'a closed job too')

// ── Live work is untouched ───────────────────────────────────
for (const status of CONFIRMED_STATUSES) {
  const live = job(status, ['2026-10-26', '2026-11-02'])
  ok(onCalendar(live) && isLiveJob(live) && !isDoneJob(live), `${status} is live work`)
  ok(calendarDates(live, TODAY).length === 2,
    `and a ${status} job keeps its future days`)
}

// ── Finished work does not reach into the future ─────────────
const overrun = job('Finished', ['2026-10-21', '2026-10-22', TODAY, '2026-10-26', '2026-11-03'])
const kept = calendarDates(overrun, TODAY)
ok(kept.length === 3, 'a finished job keeps only the days up to today')
ok(kept.includes(TODAY), 'today counts as past — a job finished this afternoon still happened today')
ok(!kept.includes('2026-10-26') && !kept.includes('2026-11-03'),
  'and its leftover future days are dropped, so no phantom work sits in front of the crew')

const allAhead = job('Finished', ['2026-12-01'])
ok(calendarDates(allAhead, TODAY).length === 0,
  'a finished job scheduled entirely ahead shows nothing rather than a stray chip')

// ── Everything else stays off ────────────────────────────────
for (const status of ['Quoted', 'Lost', 'Cancelled', '', 'Nonsense']) {
  ok(!onCalendar(job(status, LAST_WEEK)), `${status || '(blank)'} is not on the calendar`)
  ok(calendarDates(job(status, LAST_WEEK), TODAY).length === 0, 'and shows no days')
}
ok(!onCalendar({ id: 'x' }), 'a job with no status at all is not shown')
ok(calendarDates({ id: 'x' } as any, TODAY).length === 0, 'and has no days')

// ── Whitespace and dates derived from a start ────────────────
ok(isDoneJob({ status: ' Finished ' }), 'a padded status still reads as finished')
const derived = { id: 'NP-2', status: 'Finished', sched_start: '2026-10-12', est_days: 3 }
ok(calendarDates(derived, TODAY).length === 3,
  'a finished job whose days come from a start date and a duration keeps them')
const derivedAhead = { id: 'NP-3', status: 'Finished', sched_start: '2026-11-16', est_days: 3 }
ok(calendarDates(derivedAhead, TODAY).length === 0, 'and one derived ahead of today shows nothing')

const noDates = job('Finished', [])
ok(calendarDates(noDates, TODAY).length === 0, 'a finished job with no dates shows nothing')

ok(DONE_STATUSES.length === 2 && CONFIRMED_STATUSES.length === 5,
  'the two lists are what the calendar used to hold, plus the done ones')
ok(!CONFIRMED_STATUSES.some(s => (DONE_STATUSES as readonly string[]).includes(s)),
  'and nothing is in both, so no job is counted twice')

console.log(fail ? `\n${fail} FAILED` : '\nall passed')
process.exit(fail ? 1 : 0)
