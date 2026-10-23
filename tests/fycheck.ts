// The Australian financial year, and the BAS quarters inside it.
//
// The boundaries are the whole point: 30 June and 1 July, and a quarter that
// starts in July being Q1 rather than Q3. Every one is asserted on both sides.

import {
  fyOf, fyRange, fyLabel, currentFY, quarterRange, quarterOf, quarterLabel,
  inFY, inQuarter, fyOptions, QUARTER_MONTHS,
} from '@/lib/fy'

let fail = 0
const ok = (c: boolean, m: string) => { if (!c) { fail++; console.log('FAIL', m) } else console.log('ok  ', m) }

// ── Which year a date belongs to ─────────────────────────────
ok(fyOf('2025-07-01') === 2026, '1 July 2025 opens FY2026')
ok(fyOf('2025-06-30') === 2025, 'and 30 June 2025 closes FY2025 — the two sides of the boundary')
ok(fyOf('2025-12-31') === 2026, 'December sits in the FY that started that July')
ok(fyOf('2026-01-01') === 2026, 'and so does the January after it — the same year, not a new one')
ok(fyOf('2026-06-30') === 2026, '30 June is the last day of its own FY')
ok(fyOf('2026-07-01') === 2027, 'and the next day is a new one')
ok(fyOf(null) === null && fyOf('') === null && fyOf('soon') === null, 'junk has no financial year')
ok(fyOf('2026-06-30T23:59:00') === 2026, 'a timestamp works as well as a date')

// ── The year itself ──────────────────────────────────────────
ok(fyRange(2026)[0] === '2025-07-01' && fyRange(2026)[1] === '2026-06-30',
  'FY2026 runs 1 July 2025 to 30 June 2026')
ok(fyLabel(2026) === '2025–26', 'and is written 2025–26')
ok(fyLabel(2030) === '2029–30', 'the label rolls over a decade properly')
ok(currentFY('2026-10-19') === 2027, 'October 2026 is in FY2027')
ok(currentFY('2026-03-19') === 2026, 'March 2026 is in FY2026')

ok(inFY('2025-07-01', 2026) && inFY('2026-06-30', 2026), 'both ends of the year are inside it')
ok(!inFY('2025-06-30', 2026) && !inFY('2026-07-01', 2026), 'and the days either side are not')
ok(!inFY(null, 2026) && !inFY('', 2026), 'an undated row is in no year')

// ── BAS quarters ─────────────────────────────────────────────
ok(quarterRange(2026, 1)[0] === '2025-07-01' && quarterRange(2026, 1)[1] === '2025-09-30',
  'Q1 is July to September — the quarter the old calendar version called Q3')
ok(quarterRange(2026, 2)[0] === '2025-10-01' && quarterRange(2026, 2)[1] === '2025-12-31', 'Q2 Oct–Dec')
ok(quarterRange(2026, 3)[0] === '2026-01-01' && quarterRange(2026, 3)[1] === '2026-03-31', 'Q3 Jan–Mar')
ok(quarterRange(2026, 4)[0] === '2026-04-01' && quarterRange(2026, 4)[1] === '2026-06-30', 'Q4 Apr–Jun')

// The four quarters tile the year exactly: no gap, no overlap, no day twice.
const days: string[] = []
for (let q = 1; q <= 4; q++) {
  const [from, to] = quarterRange(2026, q)
  days.push(from, to)
  ok(inFY(from, 2026) && inFY(to, 2026), `Q${q} sits inside the financial year`)
}
ok(days[0] === fyRange(2026)[0], 'Q1 starts when the year does')
ok(days[7] === fyRange(2026)[1], 'Q4 ends when the year does')
for (let i = 1; i < 4; i++) {
  const prevEnd = days[i * 2 - 1], nextStart = days[i * 2]
  const d = new Date(prevEnd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)
  ok(d.toISOString().slice(0, 10) === nextStart,
    `Q${i + 1} starts the day after Q${i} ends — no day falls between them`)
}

ok(quarterOf('2025-07-01') === 1 && quarterOf('2025-09-30') === 1, 'July and September are Q1')
ok(quarterOf('2025-12-15') === 2, 'December is Q2')
ok(quarterOf('2026-02-02') === 3, 'February is Q3')
ok(quarterOf('2026-05-30') === 4, 'May is Q4')
ok(quarterOf('rubbish') === null, 'and junk is no quarter at all')

for (let q = 1; q <= 4; q++) {
  const [from, to] = quarterRange(2026, q)
  ok(quarterOf(from) === q && quarterOf(to) === q && inQuarter(from, 2026, q) && inQuarter(to, 2026, q),
    `Q${q}'s own dates land back in Q${q}`)
}
ok(!inQuarter('2025-09-30', 2026, 2) && !inQuarter('2025-10-01', 2026, 1),
  'a date one day out lands in the other quarter, not both')

ok(quarterLabel(2026, 2) === 'Q2 2025–26 (Oct–Dec)', 'the heading names the months')
ok(QUARTER_MONTHS.length === 4 && QUARTER_MONTHS[0] === 'Jul–Sep', 'and Q1 is Jul–Sep')

// ── The picker ───────────────────────────────────────────────
const opts = fyOptions(['2024-08-01', '2026-02-01', null, 'junk'], '2026-10-19')
ok(opts[0] === 2027, 'the current financial year is offered first')
ok(opts[opts.length - 1] === 2025, 'back to the earliest one with data in it')
ok(opts.join() === '2027,2026,2025', 'with no gaps between them: ' + opts.join(' '))
ok(fyOptions([], '2026-03-01').join() === '2026', 'an empty app still offers the year it is in')

console.log(fail ? `\n${fail} FAILED` : '\nall passed')
process.exit(fail ? 1 : 0)
