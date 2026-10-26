// What the Labour page's tiles count.
//
// A fixed-quote job is paid the agreed price however many hours it takes.
// Its entries carry a charge rate — it records what the hour would be worth
// billed out — but nobody is ever invoiced for it, and summing it as money
// owed made the Billable tile disagree with the two beside it, which were
// filtered to hourly work all along.
//
// The arithmetic lives in lib/utils and is shared with the billing, so this
// pins the rule rather than the page.

import { labCost, labBillable, isBillableLabour } from '@/lib/utils'
import * as fs from 'fs'

let fail = 0
const ok = (c: boolean, m: string) => { if (!c) { fail++; console.log('FAIL', m) } else console.log('ok  ', m) }
const near = (a: number, b: number) => Math.abs(a - b) < 0.005

// Three days on a fixed job, two on an hourly one, at the same rates.
const ROWS = [
  { id: 'a', hours: 8, rate: 65, charge_rate: 95, cost: 520, billable: 760, billing_type: 'Fixed Quote' },
  { id: 'b', hours: 8, rate: 65, charge_rate: 95, cost: 520, billable: 760, billing_type: 'Fixed Quote' },
  { id: 'c', hours: 4, rate: 65, charge_rate: 95, cost: 260, billable: 380, billing_type: 'Fixed Quote' },
  { id: 'd', hours: 8, rate: 65, charge_rate: 95, cost: 520, billable: 760, billing_type: 'Hourly' },
  { id: 'e', hours: 6, rate: 55, charge_rate: 85, cost: 330, billable: 510, billing_type: 'Hourly/Estimate' },
]

// ── Which work is billed by the hour ─────────────────────────
ok(isBillableLabour(ROWS[3]) && isBillableLabour(ROWS[4]),
  'hourly and estimate work is billed by the hour')
ok(!isBillableLabour(ROWS[0]), 'fixed-quote work is not')
ok(!isBillableLabour({ billing_type: undefined } as any),
  'and neither is an entry with no billing type — the conservative read')

// ── The tiles ────────────────────────────────────────────────
const hourly = ROWS.filter(isBillableLabour)
const totCost = ROWS.reduce((s, l) => s + labCost(l), 0)
const hBill = hourly.reduce((s, l) => s + labBillable(l), 0)
const hCost = hourly.reduce((s, l) => s + labCost(l), 0)
const margin = hBill > 0 ? ((hBill - hCost) / hBill) * 100 : 0

ok(near(totCost, 2150), 'total cost counts every hour worked, fixed and hourly alike')
ok(near(hBill, 1270), 'billable counts the hourly work only: 760 + 510')
ok(near(hBill, 760 + 510) && hBill < ROWS.reduce((s, l) => s + labBillable(l), 0),
  'and is less than the column total, which is the point')
ok(near(hCost, 850), 'against the cost of that same hourly work')
ok(near(margin, ((1270 - 850) / 1270) * 100), 'the margin is those two, and nothing else')
ok(near(hBill - hCost, 420), 'as is the gross profit')

// The three hourly figures agree with each other, which they did not before.
ok(near(hBill - hCost, hBill * (margin / 100)),
  'billable, margin and gross profit are three views of one pair of numbers')

// ── A fixed-quote entry cannot move the hourly figures ───────
const withMoreFixed = [...ROWS, { id: 'f', hours: 8, rate: 65, charge_rate: 200, cost: 520, billable: 1600, billing_type: 'Fixed Quote' }]
const hBill2 = withMoreFixed.filter(isBillableLabour).reduce((s, l) => s + labBillable(l), 0)
ok(near(hBill2, hBill), 'a fixed-quote entry at any charge rate leaves billable alone')
ok(near(withMoreFixed.reduce((s, l) => s + labCost(l), 0), totCost + 520),
  'while its cost still counts, because it was still paid')

// ── Falling back ─────────────────────────────────────────────
ok(near(labBillable({ cost: 300 } as any), 300),
  'an entry with no billable figure falls back to its cost, not to zero')
ok(labCost({ hours: 8, rate: 65 } as any) === 520, 'and cost is derived when it was not stored')
ok(labCost({} as any) === 0 && !Number.isNaN(labCost({} as any)), 'an empty row costs nothing')

// ── The page reads it this way ───────────────────────────────
const page = fs.readFileSync('src/pages/Labour.tsx', 'utf8')
ok(/const hourly = labs\.filter\(isBill\)/.test(page), 'the page filters before it totals')
ok(/Billable \(hourly work\)/.test(page), 'and the tile says which work it counts')
ok(!/l: 'Total billable \(to clients\)'/.test(page),
  'the old unfiltered tile is gone, not just relabelled')

console.log(fail ? `\n${fail} FAILED` : '\nall passed')
process.exit(fail ? 1 : 0)
