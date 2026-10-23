// The asset register's arithmetic.
//
// Depreciation is the kind of thing that looks right and is not: a method
// applied to the wrong base, a first year not pro-rated, an asset that keeps
// deducting after it is written off. Each is asserted against figures worked
// out by hand.
//
// Years here are Australian financial years, named by the year they end in —
// FY2024 is 1 July 2023 to 30 June 2024. Assets bought on 1 July get a whole
// first year, which is what makes the round numbers below round.

import {
  schedule, depreciationFor, writtenDownValue, registerTotals, disposalResult,
  depreciableBase, businessShare, assetMethod, DEFAULT_LIFE, DEP_METHODS,
} from '@/lib/assets'

let fail = 0
const ok = (c: boolean, m: string) => { if (!c) { fail++; console.log('FAIL', m) } else console.log('ok  ', m) }
const near = (a: number, b: number, tol = 0.02) => Math.abs(a - b) < tol

// ── Classification ───────────────────────────────────────────
ok(assetMethod({}) === 'prime_cost', 'an asset with no method set is straight-lined')
ok(assetMethod({ method: 'nonsense' }) === 'prime_cost', 'and so is one with a junk method')
ok(assetMethod({ method: 'diminishing' }) === 'diminishing', 'a real method is kept')
ok(DEP_METHODS.length === 4, 'four treatments')
ok(DEFAULT_LIFE.Vehicle === 8 && DEFAULT_LIFE.Technology === 3, 'lives differ by category')

ok(businessShare({}) === 1, 'no business-use figure means wholly business')
ok(businessShare({ business_use_pct: 80 }) === 0.8, '80% reads as 0.8')
ok(businessShare({ business_use_pct: 0 }) === 0, 'and 0% as nothing')
ok(businessShare({ business_use_pct: 150 }) === 1, 'over 100% is capped, not trusted')
ok(depreciableBase({ cost_ex_gst: 9000, prior_depreciation: 3000 }) === 6000,
  'prior claims come off the base')
ok(depreciableBase({ cost_ex_gst: 1000, prior_depreciation: 5000 }) === 0,
  'and cannot take it below nothing')

// ── Prime cost ───────────────────────────────────────────────
// A $10,000 rig bought 1 July 2023, five year life: $2,000 a year, five years.
const rig = { cost_ex_gst: 10000, purchase_date: '2023-07-01', method: 'prime_cost', effective_life_yr: 5 }
ok(near(depreciationFor(rig, 2024).charge, 2000), 'prime cost year 1: 2000')
ok(near(depreciationFor(rig, 2026).charge, 2000), 'and the same in year 3')
ok(near(writtenDownValue(rig, 2026), 4000), 'written down to 4000 after three years')
ok(near(writtenDownValue(rig, 2028), 0), 'nothing left after five')
ok(depreciationFor(rig, 2029).charge === 0, 'and it stops — no sixth year of deductions')
ok(depreciationFor(rig, 2028).writtenOff, 'the final year says so')

const total = [...schedule(rig, 2035).values()].reduce((s, y) => s + y.charge, 0)
ok(near(total, 10000), 'the whole cost is deducted across the schedule, no more and no less')

// ── The first year is pro-rated ──────────────────────────────
// Bought 1 October 2023: 274 of the 366 days of FY2024.
const late = { ...rig, purchase_date: '2023-10-01' }
ok(near(depreciationFor(late, 2024).charge, 2000 * 274 / 366, 1),
  'a rig bought in October earns three quarters of its first financial year')
ok(near(depreciationFor(late, 2025).charge, 2000), 'then full years after it')

// One bought three weeks before 30 June earns almost nothing.
const june = { ...rig, purchase_date: '2024-06-10' }
ok(depreciationFor(june, 2024).charge < 120,
  'bought 10 June, its first financial year is three weeks long')
ok(near(depreciationFor(june, 2025).charge, 2000), 'and the year after it is whole')
ok(near([...schedule(late, 2040).values()].reduce((s, y) => s + y.charge, 0), 10000),
  'and still totals the cost — the tail just runs a year longer')

// ── Diminishing value ────────────────────────────────────────
// $10,000, five year life, bought 1 July: 40% of what is left each year.
const dv = { ...rig, method: 'diminishing' }
ok(near(depreciationFor(dv, 2024).charge, 4000), 'diminishing year 1: 40% of 10000')
ok(near(depreciationFor(dv, 2025).charge, 2400), 'year 2: 40% of the remaining 6000')
ok(near(depreciationFor(dv, 2026).charge, 1440), 'year 3: 1440')
ok(depreciationFor(dv, 2024).charge > depreciationFor(rig, 2024).charge,
  'it front-loads the deduction, which is the reason to choose it')
ok(near(writtenDownValue(dv, 2026), 2160), 'written down to 2160 after three years')

// ── Immediate write-off ──────────────────────────────────────
const now = { ...rig, method: 'immediate' }
ok(near(depreciationFor(now, 2024).charge, 10000), 'the whole cost in the year of purchase')
ok(depreciationFor(now, 2024).charge === depreciationFor(now, 2024).deduction,
  'and all of it deductible')
ok(depreciationFor(now, 2025).charge === 0, 'nothing in any year after')
ok(writtenDownValue(now, 2024) === 0, 'worth nothing on paper immediately')

// ── Not depreciated ──────────────────────────────────────────
const held = { ...rig, method: 'none' }
ok(depreciationFor(held, 2026).charge === 0, 'none deducts nothing')
ok(near(writtenDownValue(held, 2030), 10000), 'and keeps its value on the books')

// ── Business use ─────────────────────────────────────────────
const ute = { cost_ex_gst: 40000, purchase_date: '2023-07-01', method: 'prime_cost', effective_life_yr: 8, business_use_pct: 80 }
ok(near(depreciationFor(ute, 2025).charge, 5000), 'the charge is the full 5000')
ok(near(depreciationFor(ute, 2025).deduction, 4000), 'but only 80% of it is deductible')
ok(near(writtenDownValue(ute, 2025), 30000), 'the written-down value follows the full charge, not the share')

// ── Cash deducts nothing ─────────────────────────────────────
const cashRig = { ...rig, paid_by: 'Cash' }
ok(near(depreciationFor(cashRig, 2024).charge, 2000), 'a cash-bought asset still depreciates on paper')
ok(depreciationFor(cashRig, 2024).deduction === 0, 'but deducts nothing — the cashBooks rule')
ok(depreciationFor({ ...rig, paid_by: null }, 2024).deduction === 2000,
  'and an asset with no payment method stated deducts in full, as it always did')

// ── Disposal ─────────────────────────────────────────────────
const sold = { ...rig, disposal_date: '2026-06-30', disposal_amount_ex_gst: 5000 }
ok(near(depreciationFor(sold, 2026).charge, 2000), 'it depreciates through the year it is sold')
ok(depreciationFor(sold, 2027).charge === 0, 'and not after')
ok(writtenDownValue(sold, 2027) === 0, 'it is off the books from the next year')
const res = disposalResult(sold)
ok(res !== null && res.year === 2026, 'the disposal is dated')
// Written down to 6000 going into 2026; sold for 5000.
ok(res !== null && near(res.gain, -1000), 'sold for 5000 against a 6000 book value is a 1000 loss')
ok(near(disposalResult({ ...sold, disposal_amount_ex_gst: 7500 })!.gain, 1500),
  'and 7500 would have been a 1500 gain')
ok(disposalResult(rig) === null, 'an asset still owned has no disposal result')

// ── The financial year boundary ──────────────────────────────
ok(depreciationFor({ ...rig, purchase_date: '2024-06-30' }, 2024).charge > 0,
  '30 June is the last day of its own financial year, and still earns a day of it')
ok(depreciationFor({ ...rig, purchase_date: '2024-07-01' }, 2024).charge === 0,
  'while 1 July belongs to the next year, which has not started in FY2024')
ok(near(depreciationFor({ ...rig, purchase_date: '2024-07-01' }, 2025).charge, 2000),
  'and there it earns a full year — three weeks apart, a year apart on the books')

// ── The register as a whole ──────────────────────────────────
const reg = registerTotals([
  rig,                                                              // 10000, 2000/yr
  { ...dv, cost_ex_gst: 5000, purchase_date: '2025-07-01', gst: 500 },  // bought this FY
  cashRig,                                                          // deducts nothing
  { ...rig, disposal_date: '2025-06-01', disposal_amount_ex_gst: 1 },   // gone
  { cost_ex_gst: 999, purchase_date: '2030-07-01' },                // not yet bought
], 2026)
ok(reg.count === 3, 'three assets owned at the end of 2026 — the sold one and the future one are out')
ok(near(reg.purchasedExGST, 5000) && near(reg.purchasedGST, 500),
  'only this year s purchase carries a GST credit')
ok(near(reg.deduction, 2000 + 2000 + 0), 'the deduction excludes the cash asset')
ok(near(reg.nonDeductible, 2000), 'which is reported rather than silently dropped')
ok(near(reg.costExGST, 10000 + 5000 + 10000), 'cost is what was paid for what is still owned')
ok(near(reg.writtenDown, 4000 + 3000 + 4000), 'and the written-down total is what it is worth now')

const none = registerTotals([], 2026)
ok(none.count === 0 && none.deduction === 0, 'an empty register is zero, not NaN')

// ── Junk in, no NaN out ──────────────────────────────────────
const junk = { cost_ex_gst: 'abc', purchase_date: 'soon', effective_life_yr: 0, business_use_pct: 'x' }
ok(depreciationFor(junk, 2026).charge === 0, 'an undated asset depreciates nothing')
ok(!Number.isNaN(registerTotals([junk], 2026).deduction), 'and does not poison the totals')
ok(near(depreciationFor({ cost_ex_gst: 1000, purchase_date: '2023-07-01', effective_life_yr: 0 }, 2024).charge, 200),
  'a zero effective life falls back to five years rather than dividing by nothing')

console.log(fail ? `\n${fail} FAILED` : '\nall passed')
process.exit(fail ? 1 : 0)
