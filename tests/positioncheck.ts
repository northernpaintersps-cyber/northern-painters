// Where the business stands: what you own, who owes you, what the ATO is due.
//
// Three things this has to get right, and one it has to refuse to do:
//
//   1. Cash jobs are never receivables. There is no invoice outstanding on a
//      cash job, and counting one would put money in the chase list that
//      nobody is going to pay.
//   2. A cash-bought asset is still owned. The register withholds its
//      depreciation deduction, which is a tax question; it does not stop the
//      thing existing.
//   3. The ageing buckets put the oldest debt where it can be seen, including
//      invoices that never carried a due date.
//
// And the refusal: no tax is set aside against a loss. A loss carries
// forward; it does not come back as a refund.

import {
  position, overdueDays, bucketFor, cashBoughtAssets, AGE_BUCKETS,
} from '@/lib/position'
import { calcOwed } from '@/lib/utils'

let fail = 0
const ok = (c: boolean, m: string) => { if (!c) { fail++; console.log('FAIL', m) } else console.log('ok  ', m) }
const near = (a: number, b: number, tol = 0.005) => Math.abs(a - b) < tol
const eq = (a: number, b: number, m: string) =>
  ok(near(a, b), `${m} — got ${a.toFixed(2)}, want ${b.toFixed(2)}`)

const TODAY = '2026-11-19'
const base = {
  todayStr: TODAY, year: 2027, gstOwed: 0, taxableProfit: 0, taxRate: 0.25,
  invOnBooks: () => true, calcOwed,
}
const run = (o: any = {}) => position({ invoices: [], assets: [], ...base, ...o })

// ── Ageing ──────────────────────────────────────────────────
eq(overdueDays({ due_date: '2026-11-19' }, TODAY), 0, 'due today is not overdue')
eq(overdueDays({ due_date: '2026-11-18' }, TODAY), 1, 'a day late')
eq(overdueDays({ due_date: '2026-12-25' }, TODAY), 0, 'not yet due reads as zero, never negative')
eq(overdueDays({ date: '2026-10-20' }, TODAY), 30, 'no due date falls back to the invoice date')
eq(overdueDays({}, TODAY), 0, 'no date at all is not overdue')

ok(bucketFor(0) === 'current', 'nothing overdue is current')
ok(bucketFor(1) === '1-30' && bucketFor(30) === '1-30', '1 to 30 inclusive')
ok(bucketFor(31) === '31-60' && bucketFor(60) === '31-60', '31 to 60 inclusive')
ok(bucketFor(61) === '61-90' && bucketFor(90) === '61-90', '61 to 90 inclusive')
ok(bucketFor(91) === '90+', 'past 90 is its own bucket')

// An invoice with no terms is not owed forever. Reading it as due on its own
// date is what keeps the oldest debts out of 'current', where nobody looks.
{
  const p = run({ invoices: [{ id: 'A', date: '2026-01-01', total_inc_gst: 1000, received: 0 }] })
  ok(p.invoices[0].bucket === '90+', 'an undated-terms invoice from January is 90+, not current')
  eq(p.longOverdue, 1000, 'and it shows in the figure that needs a decision')
}

// ── Cash jobs are never receivables ─────────────────────────
{
  const invoices = [
    { id: 'ON', date: '2026-10-01', due_date: '2026-10-15', total_inc_gst: 5500, received: 0, job_id: 'NP-1' },
    { id: 'CASH', date: '2026-10-01', due_date: '2026-10-15', total_inc_gst: 9000, received: 0, job_id: 'NP-CASH' },
  ]
  const p = run({ invoices, invOnBooks: (i: any) => i.job_id !== 'NP-CASH' })
  eq(p.receivable, 5500, 'a cash job is not money owed to you')
  eq(p.receivableCount, 1, 'and is not in the count')
  ok(!p.invoices.some(i => i.id === 'CASH'), 'nor in the chase list')
}

// ── Part payments ───────────────────────────────────────────
{
  const p = run({ invoices: [{ id: 'P', date: '2026-10-01', due_date: '2026-10-02', total_inc_gst: 5000, received: 3000 }] })
  eq(p.receivable, 2000, 'only the unpaid part is receivable')
  const paid = run({ invoices: [{ id: 'F', date: '2026-10-01', total_inc_gst: 5000, received: 5000 }] })
  eq(paid.receivable, 0, 'a settled invoice is not receivable')
  eq(paid.receivableCount, 0, 'and not counted')
  const manual = run({ invoices: [{ id: 'M', date: '2026-10-01', total_inc_gst: 5000, received: 0, manual_paid: true }] })
  eq(manual.receivable, 0, 'nor one marked paid by hand')
}

// ── The buckets add up to the total ─────────────────────────
{
  const invoices = [
    { id: 'a', date: '2026-11-20', due_date: '2026-12-20', total_inc_gst: 100, received: 0 },
    { id: 'b', date: '2026-11-01', due_date: '2026-11-05', total_inc_gst: 200, received: 0 },
    { id: 'c', date: '2026-09-01', due_date: '2026-09-20', total_inc_gst: 400, received: 0 },
    { id: 'd', date: '2026-08-01', due_date: '2026-09-10', total_inc_gst: 800, received: 0 },
    { id: 'e', date: '2026-01-01', due_date: '2026-02-01', total_inc_gst: 1600, received: 0 },
  ]
  const p = run({ invoices })
  eq(p.receivable, 3100, 'everything outstanding is in the total')
  eq(AGE_BUCKETS.reduce((s, b) => s + p.aged[b], 0), p.receivable, 'and the buckets add back to it')
  eq(AGE_BUCKETS.reduce((s, b) => s + p.agedCount[b], 0), p.receivableCount, 'as do the counts')
  eq(p.aged.current, 100, 'not yet due')
  eq(p.aged['90+'], 1600, 'and the January one is 90+')
  ok(p.invoices[0].id === 'e', 'the chase list leads with the oldest debt')
}

// ── Assets: owned is not the same as deductible ─────────────
{
  const assets = [
    { id: 'A1', purchase_date: '2025-07-01', cost_ex_gst: 10000, gst: 1000,
      method: 'prime_cost', effective_life_yr: 5, business_use_pct: 100, paid_by: 'Bank' },
    { id: 'A2', purchase_date: '2025-07-01', cost_ex_gst: 4000, gst: 0,
      method: 'prime_cost', effective_life_yr: 5, business_use_pct: 100, paid_by: 'Cash' },
  ]
  const p = run({ assets })
  eq(p.assetsAtCost, 14000, 'a cash-bought asset is still owned')
  eq(p.assetCount, 2, 'and still counted')
  ok(p.assetsWrittenDown > 0 && p.assetsWrittenDown < 14000, 'written down below cost after a year')
  eq(cashBoughtAssets(assets), 4000, 'what was bought with cash is reportable on its own')

  const sold = run({ assets: [{ ...assets[0], disposal_date: '2026-01-01' }] })
  eq(sold.assetsAtCost, 0, 'a disposed asset is no longer owned')
}

// ── The ATO side ────────────────────────────────────────────
{
  const p = run({ gstOwed: 2671.61, taxableProfit: 43005, taxRate: 0.25 })
  eq(p.taxSetAside, 10751.25, 'tax is set aside on the declared profit')
  eq(p.owedToATO, 13422.86, 'with the GST for the quarter')

  // A loss carries forward; it does not come back as a refund.
  const loss = run({ gstOwed: 500, taxableProfit: -10832, taxRate: 0.25 })
  eq(loss.taxSetAside, 0, 'nothing is set aside against a loss')
  eq(loss.owedToATO, 500, 'leaving only the GST')

  // A GST refund is not something you owe.
  const refund = run({ gstOwed: -1200, taxableProfit: 0, taxRate: 0.25 })
  eq(refund.gstOwed, -1200, 'a refund is reported as what it is')
  eq(refund.owedToATO, 0, 'but is not added to what you owe')
}

// ── The net figure ──────────────────────────────────────────
{
  const p = run({
    assets: [{ id: 'A', purchase_date: '2026-07-01', cost_ex_gst: 1000, gst: 100,
               method: 'immediate', business_use_pct: 100, paid_by: 'Bank' }],
    invoices: [{ id: 'i', date: '2026-10-01', due_date: '2026-10-10', total_inc_gst: 5000, received: 0 }],
    gstOwed: 1000, taxableProfit: 4000, taxRate: 0.25,
  })
  eq(p.net, p.assetsWrittenDown + p.receivable - p.owedToATO, 'net is what you have less what the ATO is due')
  eq(p.owedToATO, 2000, 'GST plus tax')
}

// ── Nothing at all ──────────────────────────────────────────
{
  const p = run()
  eq(p.receivable, 0, 'no invoices, nothing receivable')
  eq(p.net, 0, 'and nothing net')
  ok(p.invoices.length === 0, 'with an empty chase list')
}

// ── Junk in the columns ─────────────────────────────────────
{
  const p = run({
    invoices: [{ id: 'j', date: 'not a date', total_inc_gst: 'rubbish', received: null }],
    gstOwed: null, taxableProfit: undefined, taxRate: 0.25,
  })
  ok(!Number.isNaN(p.receivable), 'junk does not produce NaN receivable')
  ok(!Number.isNaN(p.net), 'nor a NaN net position')
}

console.log(fail ? `\n${fail} FAILED` : '\nall passed')
process.exit(fail ? 1 : 0)
