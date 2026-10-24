// Reading a message into logged hours.
//
// Two ways this hurts. A line read wrong puts someone's hours on the wrong
// job, and a line dropped silently loses a day's pay. So: every date and
// hours form is pinned, an ambiguous job is never chosen, and anything
// unreadable comes back named rather than vanishing.

import {
  parseDate, parseHours, matchJob, matchWorker, parseHoursMessage,
  findDuplicateEntry, draftsFromAI, inferJob, FORMAT_HINT,
} from '@/lib/readHours'
import { buildLabour, emptyContext } from '@/lib/writes'

let fail = 0
const ok = (c: boolean, m: string) => { if (!c) { fail++; console.log('FAIL', m) } else console.log('ok  ', m) }
const near = (a: number, b: number) => Math.abs(a - b) < 0.005

// Friday 23 October 2026.
const TODAY = '2026-10-23'

const JOBS = [
  { id: 'NP-0083', client: 'Smith', address: '81 Esmonde St, Lismore' },
  { id: 'NP-0091', client: 'Jones', address: '15 Kipling St, Byron Bay' },
  { id: 'NP-0100', client: 'Smithers', address: '2 Esmonde St, Lismore' },
]
const CREW = [
  { id: 'c1', name: 'Francisco Rojas', rate: 65, charge_rate: 95 },
  { id: 'c2', name: 'Jake Miller', rate: 55, charge_rate: 85 },
]
const CTX = { jobs: JOBS, crew: CREW, todayStr: TODAY }

// ── Dates ────────────────────────────────────────────────────
ok(parseDate('23/10', TODAY) === '2026-10-23', '23/10 with no year is this year')
ok(parseDate('23/10/26', TODAY) === '2026-10-23', 'a two-digit year works')
ok(parseDate('23/10/2026', TODAY) === '2026-10-23', 'and a four-digit one')
ok(parseDate('2026-10-23', TODAY) === '2026-10-23', 'an ISO date passes through')
ok(parseDate('today', TODAY) === '2026-10-23', 'today')
ok(parseDate('yesterday', TODAY) === '2026-10-22', 'yesterday')
ok(parseDate('Monday', TODAY) === '2026-10-19', 'Monday means the most recent Monday')
ok(parseDate('mon', TODAY) === '2026-10-19', 'and so does its short form')
ok(parseDate('Friday', TODAY) === TODAY, 'today named by its own weekday is today, not last week')
ok(parseDate('1/10', TODAY) === '2026-10-01', 'a single-digit day pads')
// A message in January about 28/12 is about last month.
ok(parseDate('28/12', '2027-01-05') === '2026-12-28',
  'a date that would be in the future is read as last year')
ok(parseDate('', TODAY) === null && parseDate('rubbish', TODAY) === null, 'junk is no date')
ok(parseDate('32/10', TODAY) === null && parseDate('10/13', TODAY) === null,
  'and an impossible day or month is refused rather than rolled over')

// ── Hours ────────────────────────────────────────────────────
ok(parseHours('8') === 8, 'a bare 8')
ok(parseHours('8h') === 8 && parseHours('8hrs') === 8, 'with or without the h')
ok(parseHours('7.5') === 7.5 && parseHours('7,5') === 7.5, 'a decimal, point or comma')
ok(near(parseHours('7h30')!, 7.5), '7h30 is seven and a half')
ok(parseHours('7:30-16:00') === 8.5, 'a span is its length')
ok(parseHours('7:30-16:00 -30min') === 8, 'less the break')
ok(parseHours('7-16') === 9, 'a span without minutes')
ok(parseHours('8-16 -30') === 7.5, 'and a bare break figure')
ok(parseHours('0') === null, 'zero hours is not an entry')
ok(parseHours('25') === null, 'and neither is 25 — that is a typo, not a day')
ok(parseHours('') === null && parseHours('second coat') === null, 'words are not hours')
ok(!Number.isNaN(parseHours('8h') as number), 'nothing comes back NaN')

// ── Matching a job ───────────────────────────────────────────
ok(matchJob('NP-0083', JOBS).job?.id === 'NP-0083', 'a job number matches exactly')
ok(matchJob('np-0083', JOBS).job?.id === 'NP-0083', 'case does not matter')
ok(matchJob('Jones', JOBS).job?.id === 'NP-0091', 'a client name matches')
ok(matchJob('15 Kipling St', JOBS).job?.id === 'NP-0091', 'and a street')
ok(matchJob('Kipling', JOBS).job?.id === 'NP-0091', 'a partial street, when only one fits')
// Two jobs on Esmonde St: nothing is chosen.
const amb = matchJob('Esmonde', JOBS)
ok(amb.job === null, 'an ambiguous street picks NOTHING — a confident wrong match is the worst outcome')
ok(amb.candidates.length === 2, 'it hands back both for a person to choose between')
ok(matchJob('Nowhere Rd', JOBS).job === null, 'an unknown place matches nothing')
ok(matchJob('', JOBS).job === null, 'and so does an empty string')

// ── A job number as a person writes it ───────────────────────
// Nobody types NP-0083. This is most of why hours were landing on no job.
ok(matchJob('NP-83', JOBS).job?.id === 'NP-0083', 'NP-83 finds NP-0083')
ok(matchJob('np83', JOBS).job?.id === 'NP-0083', 'np83 too')
ok(matchJob('#83', JOBS).job?.id === 'NP-0083', 'and #83')
ok(matchJob('83', JOBS).job?.id === 'NP-0083', 'and a bare 83')
ok(matchJob('NP 0083', JOBS).job?.id === 'NP-0083', 'a space instead of the dash')
ok(matchJob('np-0091', JOBS).job?.id === 'NP-0091', 'and the exact thing still works')
ok(matchJob('NP-0999', JOBS).job === null, 'a number that is no job matches nothing')

// A street number must not be read as a job number. 15 Kipling St is NP-0091;
// taking the 15 as an id would have found nothing, or worse, job 15.
ok(matchJob('15 Kipling St', JOBS).job?.id === 'NP-0091',
  'a street with a number in it is matched as a street')
const NUMBERED = [...JOBS, { id: 'NP-0015', client: 'Walsh', address: '9 Other Rd, Casino' }]
ok(matchJob('15 Kipling St', NUMBERED).job?.id === 'NP-0091',
  'even when a job numbered 15 exists — the street is tried before the bare number')
ok(matchJob('15', NUMBERED).job?.id === 'NP-0015',
  'while a bare 15 on its own is the job number')

// ── A phrase, not a name ─────────────────────────────────────
// What the AI hands back when the message says "the Byron job".
ok(matchJob('the Byron job', JOBS).job?.id === 'NP-0091',
  'a suburb inside a phrase finds the job')
ok(matchJob("Smithy's place", JOBS).job?.id === undefined
  || matchJob("Smith's place", JOBS).job?.id === 'NP-0083',
  'a surname inside a phrase does too')
ok(matchJob('the Lismore one', JOBS).candidates.length === 2,
  'a phrase matching two jobs picks neither — both Lismore jobs come back')
ok(matchJob('the job', JOBS).job === null && matchJob('the job', JOBS).candidates.length === 0,
  'a phrase of nothing but filler matches nothing, rather than everything')
ok(matchJob('that site out there', JOBS).job === null,
  'and neither does vague prose')

// ── Matching a worker ────────────────────────────────────────
ok(matchWorker('Francisco Rojas', CREW).name === 'Francisco Rojas', 'a full name')
const first = matchWorker('Francisco', CREW)
ok(first.name === 'Francisco Rojas' && first.matched, 'a first name resolves to the crew record')
ok(matchWorker('francisco', CREW).matched, 'case does not matter')
const unknown = matchWorker('Dave', CREW)
ok(unknown.name === 'Dave' && !unknown.matched,
  'someone not on the crew is kept as typed and flagged, not dropped')

// ── A whole message, one worker across several jobs ──────────
const MSG = `Francisco
23/10  NP-0083  8h  second coat
23/10  Kipling St  4h
22/10  NP-0091  6.5h  prep
21/10  NP-0083  7:30-16:00 -30min

Jake
23/10  NP-0083  8h`

const read = parseHoursMessage(MSG, CTX)
ok(read.unparsed.length === 0, `every line read (${read.unparsed.join(' | ')})`)
ok(read.entries.length === 5, `five entries (${read.entries.length})`)

const fran = read.entries.filter(e => e.worker === 'Francisco Rojas')
ok(fran.length === 4, 'the worker named once applies to all four lines under him')
ok(read.entries[4].worker === 'Jake Miller', 'and the second worker takes over')
ok(fran.every(e => e.workerMatched), 'both names matched the crew')

ok(fran[0].job_id === 'NP-0083' && fran[0].hours === 8, 'first line: job and hours')
ok(fran[0].date === '2026-10-23', 'and its date')
ok(fran[0].description === 'second coat', 'the rest of the line is the note')
ok(fran[1].job_id === 'NP-0091', 'a street on the next line is a different job')
ok(fran[1].date === '2026-10-23', 'same day, two jobs — which is the case this is for')
ok(fran[2].hours === 6.5 && fran[2].date === '2026-10-22', 'a second day')
ok(fran[3].hours === 8, 'and a span with a break comes through as hours')

// ── Several jobs on one line ─────────────────────────────────
const oneLine = parseHoursMessage('Francisco\n23/10  NP-0083 4h, NP-0091 4h', CTX)
ok(oneLine.entries.length === 2, 'two jobs on one line split into two entries')
ok(oneLine.entries[0].job_id === 'NP-0083' && oneLine.entries[1].job_id === 'NP-0091', 'in order')
ok(oneLine.entries.every(e => e.hours === 4 && e.date === '2026-10-23'), 'each with its own hours, same day')

// ── A date carried down ──────────────────────────────────────
const carried = parseHoursMessage('Francisco\n23/10 NP-0083 4h\nNP-0091 4h', CTX)
ok(carried.entries.length === 2, 'a line with no date is still read')
ok(carried.entries[1].date === '2026-10-23', 'inheriting the date above it')

// ── The worker on the line itself ────────────────────────────
const inline = parseHoursMessage('23/10  Jake  NP-0083  8h', CTX)
ok(inline.entries.length === 1 && inline.entries[0].worker === 'Jake Miller',
  'a worker named on the entry line works too')
ok(inline.entries[0].job_id === 'NP-0083', 'and the job is still found beside them')

// ── Ambiguity survives to the table ──────────────────────────
const vague = parseHoursMessage('Francisco\n23/10  Esmonde  8h', CTX)
ok(vague.entries.length === 1, 'an ambiguous job still produces an entry')
ok(vague.entries[0].job_id == null, 'with no job chosen')
ok((vague.entries[0].jobCandidates ?? []).length === 2, 'and both candidates attached for the table')

const noJob = parseHoursMessage('Francisco\n23/10  Nowhere  8h', CTX)
ok(noJob.entries.length === 1 && noJob.entries[0].job_id == null,
  'an unmatched job gives an entry with no job rather than a dropped line')
ok(noJob.entries[0].hours === 8, 'the hours are still there to be assigned')

// ── Nothing readable ─────────────────────────────────────────
const prose = parseHoursMessage('hey mate all good for tomorrow 👍', CTX)
ok(prose.entries.length === 0, 'a chatty message produces no entries')
ok(prose.unparsed.length === 1, 'and the line comes back named, for the AI or for you')

const empty = parseHoursMessage('', CTX)
ok(empty.entries.length === 0 && empty.unparsed.length === 0, 'an empty message is empty, not an error')
ok(parseHoursMessage('\n\n---\n\n', CTX).unparsed.length === 0, 'separators are not reported as unread')
ok(parseHoursMessage('😀🎉', CTX).entries.length === 0, 'emoji produce nothing')
ok(parseHoursMessage('[10:04]', CTX).unparsed.length === 0, 'a chat timestamp line is noise, not a failure')

const half = parseHoursMessage('Francisco\n23/10 NP-0083', CTX)
ok(half.entries.length === 0 && half.unparsed.length === 1,
  'a line with no hours is reported rather than logged as zero')

// ── Into a real labour row ───────────────────────────────────
const ctxW = { ...emptyContext(), jobs: JOBS, crew: CREW, biz: { rates: { standard: 65 } } }
const change = buildLabour(ctxW as any, {
  worker: fran[0].worker, hours: fran[0].hours, date: fran[0].date,
  job_id: fran[0].job_id, description: fran[0].description,
})
ok(change.errors.length === 0, `the entry builds a clean row (${change.errors.join('; ')})`)
ok(change.row.sub === 'Francisco Rojas', 'against the crew record')
ok(change.row.hours === 8 && change.row.rate === 65 && change.row.cost === 520,
  'with his own cost rate and the cost derived: 8 x 65')
ok(change.row.charge_rate === 95 && change.row.billable === 760, 'and his charge rate')
ok(change.row.job_id === 'NP-0083' && change.row.client === 'Smith', 'linked to the job and its client')
ok(change.row.date === '2026-10-23', 'on the right day')

const bad = buildLabour(ctxW as any, { worker: 'Dave', hours: 0, date: TODAY })
ok(bad.errors.length > 0, 'and a nonsense entry still fails its checks rather than saving')

// ── Duplicates ───────────────────────────────────────────────
const existing = [{ id: 'l1', sub: 'Francisco Rojas', job_id: 'NP-0083', date: '2026-10-23', hours: 8 }]
ok(findDuplicateEntry(fran[0], existing) !== null, 'pasting the same message twice is spotted')
ok(findDuplicateEntry(fran[1], existing) === null, 'a different job on the same day is not a duplicate')
ok(findDuplicateEntry(fran[0], []) === null, 'nothing logged, nothing duplicated')

// ── What the AI gives back ───────────────────────────────────
// Its answer is put through the same matchers as a typed line, and an id it
// invented must never reach a row.
const fromAI = draftsFromAI([
  { worker: 'Francisco', job: 'NP-0083', jobSaid: 'the Esmonde job', date: '2026-10-22', hours: 8, note: 'cutting in' },
  { worker: 'Jake', job: 'NP-9999', jobSaid: 'Kipling St', date: '2026-10-22', hours: 6 },
  { worker: 'Jake', jobSaid: 'the Byron job', date: '2026-10-21', hours: 4 },
  { worker: 'Dave', jobSaid: 'somewhere', date: '2026-10-20', hours: 5 },
], CTX)

ok(fromAI.length === 4, 'every entry comes through')
ok(fromAI.every(d => d.via === 'ai'), 'marked as read by AI, so the table can say so')
ok(fromAI[0].job_id === 'NP-0083' && fromAI[0].worker === 'Francisco Rojas',
  'a good id and a first name both resolve')
ok(fromAI[1].job_id === 'NP-0091',
  'an id that does not exist falls back to what the message said — Kipling St')
ok(fromAI[2].job_id === 'NP-0091', 'and a description with no id at all still finds the job')
ok(fromAI[3].job_id == null && fromAI[3].saidJob === 'somewhere',
  'an unmatchable one keeps what it tried, so the gap explains itself')
ok(!fromAI[3].workerMatched, 'and a worker who is not on the crew is flagged')
ok(fromAI[0].hours === 8 && fromAI[0].date === '2026-10-22', 'hours and dates survive')
ok(draftsFromAI([{ worker: 'Francisco', hours: 0 }], CTX).length === 0,
  'an entry with no hours is not an entry')

ok(FORMAT_HINT.split('\n').length >= 4 && parseHoursMessage(FORMAT_HINT, CTX).unparsed.length === 0,
  'the format shown to the crew is one the parser can actually read')

// ── What is on the go settles what the message leaves open ──
//
// A painter writing up their week often names no job at all. There are only
// ever a few jobs running, and the app knows which — so it fills the gap,
// and says that it did.

// The same three jobs, now with the statuses that decide this.
const LIVEJOBS = [
  { id: 'NP-0083', client: 'Smith', address: '81 Esmonde St, Lismore', status: 'In Progress' },
  { id: 'NP-0091', client: 'Jones', address: '15 Kipling St, Byron Bay', status: 'Scheduled',
    sched_start: '2026-10-26', est_days: 3 },
  { id: 'NP-0100', client: 'Smithers', address: '2 Esmonde St, Lismore', status: 'Finished' },
]
const LIVE = { jobs: LIVEJOBS, crew: CREW, todayStr: TODAY }

// ── The only job on the tools ────────────────────────────────
const onTools = inferJob({ worker: 'Francisco Rojas', date: '2026-10-22' }, LIVE)
ok(onTools?.job.id === 'NP-0083', 'with one job in progress, that is the job')
ok(onTools?.from === 'in_progress', 'and it says so')

const noJobLine = parseHoursMessage('Francisco\n22/10  8h', LIVE)
ok(noJobLine.entries.length === 1, 'a line naming no job is still read')
ok(noJobLine.entries[0].job_id === 'NP-0083', 'and the job in progress fills it in')
ok(noJobLine.entries[0].inferredFrom === 'in_progress', 'flagged as inferred, not as written down')

// ── Finished work is never inferred ──────────────────────────
const allDone = inferJob({ worker: 'Francisco Rojas', date: '2026-10-22' },
  { ...LIVE, jobs: LIVEJOBS.map(j => ({ ...j, status: 'Finished' })) })
ok(allDone === null, 'nothing live means no guess — a finished job is never inferred')

// ── Scheduled dates beat a job merely in progress ────────────
const TWO_RUNNING = {
  ...LIVE,
  jobs: [
    { ...LIVEJOBS[0], status: 'In Progress' },
    { ...LIVEJOBS[1], status: 'In Progress', sched_start: '2026-10-26', est_days: 3 },
  ],
}
ok(inferJob({ worker: 'Francisco Rojas', date: '2026-10-22' }, TWO_RUNNING) === null,
  'two jobs in progress and nothing else to go on settles nothing')
const onThatDay = inferJob({ worker: 'Francisco Rojas', date: '2026-10-27' }, TWO_RUNNING)
ok(onThatDay?.job.id === 'NP-0091' && onThatDay?.from === 'scheduled',
  'but one of them scheduled for that very day does')

// ── Recent hours, when they clearly point one way ────────────
const BUSY = {
  ...TWO_RUNNING,
  labour: [
    { sub: 'Francisco Rojas', job_id: 'NP-0091', date: '2026-10-19', hours: 24 },
    { sub: 'Francisco Rojas', job_id: 'NP-0083', date: '2026-10-19', hours: 2 },
  ],
}
const lately = inferJob({ worker: 'Francisco Rojas', date: '2026-10-22' }, BUSY)
ok(lately?.job.id === 'NP-0091' && lately?.from === 'recent',
  'the job his hours have been going into')
const EVEN = {
  ...TWO_RUNNING,
  labour: [
    { sub: 'Francisco Rojas', job_id: 'NP-0091', date: '2026-10-19', hours: 10 },
    { sub: 'Francisco Rojas', job_id: 'NP-0083', date: '2026-10-19', hours: 9 },
  ],
}
ok(inferJob({ worker: 'Francisco Rojas', date: '2026-10-22' }, EVEN) === null,
  'two jobs he has split his week across settle nothing — a close second is no answer')
ok(inferJob({ worker: 'Jake Miller', date: '2026-10-22' }, BUSY) === null,
  "and another painter's hours are not evidence about this one")

// ── Settling a tie the words could not ───────────────────────
// Two Esmonde St jobs; only one of them is live.
const esmonde = parseHoursMessage('Francisco\n22/10  Esmonde  8h', LIVE)
ok(esmonde.entries[0].job_id === 'NP-0083',
  'two jobs fit "Esmonde", and only one is live — that is the one')
ok(esmonde.entries[0].inferredFrom === 'in_progress', 'and it says where that came from')

// ── Never over what was written down ─────────────────────────
const named = parseHoursMessage('Francisco\n22/10  NP-0091  8h', LIVE)
ok(named.entries[0].job_id === 'NP-0091',
  'a job written down beats whatever is in progress')
ok(named.entries[0].inferredFrom === undefined, 'and is not flagged as inferred')

// ── The AI's entries get the same help ───────────────────────
const aiNoJob = draftsFromAI([{ worker: 'Francisco', date: '2026-10-22', hours: 8 }], LIVE)
ok(aiNoJob[0].job_id === 'NP-0083' && aiNoJob[0].inferredFrom === 'in_progress',
  'an AI entry with no job is settled the same way')

// ── With nothing to go on ────────────────────────────────────
ok(inferJob({ worker: 'Francisco Rojas', date: '2026-10-22' }, CTX) === null,
  'jobs with no status at all are not treated as live, so nothing is guessed')
const bare = parseHoursMessage('Francisco\n22/10  8h', CTX)
ok(bare.entries.length === 1 && bare.entries[0].job_id == null,
  'a line with no job and nothing to infer from is still an entry, waiting for one')
ok(bare.entries[0].hours === 8 && !bare.entries[0].inferredFrom,
  'with its hours kept and nothing pretended about the job')

// ── The fields the review table lets you set ─────────────────
//
// Charge rate, billing type and ABN/Cash all default from what is already
// recorded and can be overridden per entry. The last of them decides
// whether the cost is deductible, so it has to reach paid_by.

const CREW2 = [
  { id: 'c1', name: 'Francisco Rojas', rate: 65, charge_rate: 95, payment_type: 'ABN' },
  { id: 'c2', name: 'Danny Cash', rate: 50, charge_rate: 80, payment_type: 'Cash' },
]
const FIXED = { id: 'NP-0083', client: 'Smith', terms: 'Fixed Quote' }
const HOURLY = { id: 'NP-0091', client: 'Jones', terms: 'Hourly rate' }
const ctxF = { ...emptyContext(), jobs: [FIXED, HOURLY], crew: CREW2, biz: { rates: { standard: 65 } } }

const plain = buildLabour(ctxF as any, { worker: 'Francisco Rojas', hours: 8, date: TODAY, job_id: 'NP-0083' })
ok(plain.row.charge_rate === 95, "the charge rate defaults to the worker's own")
ok(plain.row.billable === 760, 'and the billable figure follows it')
ok(plain.row.billing_type === 'Fixed Quote', "the billing type defaults to the job's terms")
ok(plain.row.worker_payment_type === 'ABN', 'and ABN is the default arrangement')
ok(plain.row.paid_by === 'Bank', 'which records as paid by bank, so it is deductible')

const onHourly = buildLabour(ctxF as any, { worker: 'Francisco Rojas', hours: 8, date: TODAY, job_id: 'NP-0091' })
ok(onHourly.row.billing_type === 'Hourly', 'an hourly job defaults the other way')

const overridden = buildLabour(ctxF as any, {
  worker: 'Francisco Rojas', hours: 8, date: TODAY, job_id: 'NP-0083',
  charge_rate: 110, billing_type: 'Hourly', worker_payment_type: 'Cash',
})
ok(overridden.row.charge_rate === 110 && overridden.row.billable === 880,
  'a charge rate set by hand wins, and the billable follows')
ok(overridden.row.billing_type === 'Hourly', 'so does a billing type set by hand')
ok(overridden.row.worker_payment_type === 'Cash', 'and so does paying cash')
ok(overridden.row.paid_by === 'Cash',
  'which reaches paid_by — the field the tax side reads, where cash is not deductible')
ok(overridden.row.rate === 65 && overridden.row.cost === 520,
  'none of it touches what the hour actually cost')

const cashWorker = buildLabour(ctxF as any, { worker: 'Danny Cash', hours: 8, date: TODAY, job_id: 'NP-0083' })
ok(cashWorker.row.worker_payment_type === 'Cash' && cashWorker.row.paid_by === 'Cash',
  'someone whose crew record says cash defaults to cash')
ok(cashWorker.row.charge_rate === 80, 'with their own charge rate')

const junkBilling = buildLabour(ctxF as any, {
  worker: 'Francisco Rojas', hours: 8, date: TODAY, job_id: 'NP-0083', billing_type: 'Nonsense',
})
ok(junkBilling.row.billing_type === 'Fixed Quote',
  'a billing type that is not one of the three falls back to the job rather than being stored')

console.log(fail ? `\n${fail} FAILED` : '\nall passed')
process.exit(fail ? 1 : 0)
