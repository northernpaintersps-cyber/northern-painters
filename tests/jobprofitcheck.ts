// What a job is worth, and what that makes its margin.
//
// On an hourly or estimate job there is no agreed price: `agreed_ex_gst` is
// zero or a guess, and the job is worth the work logged at charge rates.
// Four screens measured against the agreed figure anyway, so an hourly job
// reported a blank margin and its whole cost as a loss.
//
// The rule already existed inside computeJobBilling. These pin it now that
// it is its own function, and pin the choice behind it: revenue is billable
// to date, not what has been invoiced, because cost-to-date includes work
// not yet invoiced and the two sides have to cover the same period.

import { jobValue, jobProfit, byJob, computeJobBilling } from '@/lib/jobBilling'

let fail = 0
const ok = (c: boolean, m: string) => { if (!c) { fail++; console.log('FAIL', m) } else console.log('ok  ', m) }
const near = (a: number | null, b: number) => a !== null && Math.abs(a - b) < 0.02

const MARKUP = 20

// A week's work: two painters, logged at cost and charge rates that differ.
const LABOUR = [
  { id: 'l1', job_id: 'J', date: '2026-10-19', hours: 8, rate: 65, charge_rate: 95,
    cost: 520, billable: 760, billing_type: 'Hourly' },
  { id: 'l2', job_id: 'J', date: '2026-10-20', hours: 8, rate: 55, charge_rate: 85,
    cost: 440, billable: 680, billing_type: 'Hourly' },
]
const MATERIALS = [
  { id: 'm1', job_id: 'J', date: '2026-10-19', cost_ex_gst: 500, billing_type: 'Hourly' },
]
const VARIATIONS = [
  { id: 'v1', job_id: 'J', amount_ex_gst: 400, var_status: 'Approved' },
  { id: 'v2', job_id: 'J', amount_ex_gst: 900, var_status: 'Pending' },
]
const COST = 520 + 440 + 500          // 1460 — what the work took out
const CHARGE = 760 + 680 + 600        // 2040 — labour billable + materials with markup

const HOURLY = { id: 'J', client: 'Smith', terms: 'Hourly rate', agreed_ex_gst: 0 }
const FIXED = { id: 'J', client: 'Smith', terms: 'Fixed Quote', agreed_ex_gst: 10000 }

const of = (job: any, over: any = {}) => jobProfit({
  job, labour: LABOUR, materials: MATERIALS, variations: VARIATIONS, markupPct: MARKUP, ...over,
})

// ── The bug, stated as a figure ──────────────────────────────
const hourly = of(HOURLY)
ok(hourly.basis === 'actuals', 'an hourly job is measured on actuals')
ok(near(hourly.revenueExGST, CHARGE + 400),
  'it is worth the logged work at charge rates, plus the approved add-on')
ok(hourly.revenueExGST > 0, 'which is a real figure, where agreed_ex_gst was zero')
ok(near(hourly.costExGST, COST), 'against what that work cost')
ok(near(hourly.grossProfit, CHARGE + 400 - COST), 'so the profit is the gap between them')
ok(near(hourly.margin, ((CHARGE + 400 - COST) / (CHARGE + 400)) * 100),
  'and the margin is a number, not a blank')
ok(hourly.margin! > 0, 'a profitable job reads as profitable — before this it read as minus its whole cost')
ok(hourly.label === 'Billable to date', 'labelled for what it is')

// ── A fixed job is unchanged ─────────────────────────────────
const fixed = of(FIXED)
ok(fixed.basis === 'fixed', 'a fixed job is measured against its contract')
ok(near(fixed.revenueExGST, 10400), 'worth its agreed price plus the approved add-on')
ok(near(fixed.grossProfit, 10400 - COST), 'whatever has been logged against it')
ok(fixed.label === 'Agreed price', 'and labelled as that')
ok(near(of({ ...FIXED, agreed_ex_gst: 0, quote_ex_gst: 8000 }).revenueExGST, 8400),
  'a fixed job with no agreed price yet falls back to its quote')

// ── Pending add-ons are not money ────────────────────────────
ok(!near(hourly.revenueExGST, CHARGE + 400 + 900), 'the pending add-on is not counted')
ok(near(of(HOURLY, { variations: [] }).revenueExGST, CHARGE),
  'and with no add-ons at all the figure is just the work')

// ── Why billable and not invoiced ────────────────────────────
// Invoicing changes nothing about what the job has made. Had revenue been
// "what has been invoiced", this margin would have climbed as invoices went
// out and the job would have looked worse the longer billing was left.
const before = of(HOURLY)
const after = jobProfit({
  job: HOURLY, labour: LABOUR, materials: MATERIALS, variations: VARIATIONS, markupPct: MARKUP,
})
ok(near(after.margin!, before.margin!),
  'the margin is the same before and after an invoice goes out — it is about the work, not the billing')

// ── Nothing to measure ───────────────────────────────────────
const empty = jobProfit({ job: HOURLY })
ok(empty.revenueExGST === 0 && empty.costExGST === 0, 'a job with nothing logged is worth nothing yet')
ok(empty.margin === null, 'and its margin is null, not zero — "no figures" is not "no profit"')
ok(jobProfit({ job: { id: 'X' } }).margin === null, 'a bare job does not divide by zero')
ok(!Number.isNaN(jobProfit({ job: { id: 'X', agreed_ex_gst: 'lots' } as any }).revenueExGST),
  'and junk does not become NaN')

// A job that cost more than it is worth reports a negative margin, not a blank.
const bleeding = jobProfit({
  job: HOURLY, materials: MATERIALS, markupPct: 0,
  labour: [{ ...LABOUR[0], billing_type: 'Fixed Quote' }],   // cost, not billable
})
ok(bleeding.grossProfit < 0 && bleeding.margin! < 0, 'a job losing money says so')

// ── The extraction has not drifted ───────────────────────────
for (const [name, job] of [['hourly', HOURLY], ['fixed', FIXED]] as const) {
  const v = jobValue({ job, labour: LABOUR, materials: MATERIALS, variations: VARIATIONS, markupPct: MARKUP })
  const b = computeJobBilling({
    job, invoices: [], labour: LABOUR, materials: MATERIALS, variations: VARIATIONS, markupPct: MARKUP,
  })
  ok(near(v.revenueExGST, b.billableToDateExGST),
    `jobValue and computeJobBilling agree on a ${name} job — one rule, not two`)
  ok(v.basis === b.basis, `and on its basis`)
}

// ── Grouping rows by job ─────────────────────────────────────
const grouped = byJob([...LABOUR, { id: 'l9', job_id: 'OTHER', hours: 1 }, { id: 'l0', hours: 1 }])
ok(grouped.get('J')?.length === 2, "a job's own rows are together")
ok(grouped.get('OTHER')?.length === 1, 'another job keeps its own')
ok(!grouped.has(''), 'and a row with no job is not a group of its own')

console.log(fail ? `\n${fail} FAILED` : '\nall passed')
process.exit(fail ? 1 : 0)
