// The BAS figures, which get copied onto a government form.
//
// Two faults were found in a real Q1 BAS read against four bank statements,
// and this file exists so neither can come back:
//
//   1. A GST-free purchase — a bank fee, an ASIC lodgement, an overseas
//      subscription — belongs in G11 and claims no credit. It used to be
//      dropped from G11 entirely, understating a lodged field.
//   2. G1, G10 and G11 were grossed up from ex-GST totals at a flat 10%,
//      which invents GST on anything GST-free. Every table stores the GST it
//      carried, so these fields are sums, never products.
//
// The rest pins the behaviour those two fixes had to leave alone: cash
// purchases off the BAS, cash jobs' income named but not declared, the cash
// versus accrual basis, and quarter boundaries on the Australian FY.

import { basTotals, hasGST, expIncGST, recognisedDate } from '@/lib/bas'
import { splitBooks } from '@/lib/cashBooks'
import { inFY } from '@/lib/fy'

let fail = 0
const ok = (c: boolean, m: string) => { if (!c) { fail++; console.log('FAIL', m) } else console.log('ok  ', m) }
const near = (a: number, b: number, tol = 0.005) => Math.abs(a - b) < tol
const eq = (a: number, b: number, m: string) =>
  ok(near(a, b), `${m} — got ${a.toFixed(2)}, want ${b.toFixed(2)}`)

// Q1 of FY2026-27 is July–September 2026. `fy` is the year the financial
// year ENDS in — quarterRange(2027, 1) is Jul–Sep 2026 — which is easy to
// get a year wrong, so it is stated here rather than inferred.
const base = {
  basis: 'accrual' as const, year: 2027, quarter: 1,
  onBooks: () => true,
  invOnBooks: () => true,
  invStatus: () => 'Paid',
}
const run = (o: Partial<Parameters<typeof basTotals>[0]>) =>
  basTotals({ invoices: [], materials: [], expenses: [], assets: [], ...base, ...o })

// ── The two helpers ─────────────────────────────────────────
ok(hasGST({ gst: 10 }), 'hasGST true when GST was charged')
ok(!hasGST({ gst: 0 }), 'hasGST false at zero')
ok(!hasGST({}), 'hasGST false when absent')
eq(expIncGST({ amount_ex_gst: 100, gst: 10 }), 110, 'expIncGST adds the two stored figures')
eq(expIncGST({ amount_ex_gst: 45, gst: 0 }), 45, 'expIncGST of a GST-free purchase is the amount itself')

// ── 1. A GST-free purchase is in G11 and claims no credit ───
{
  const t = run({
    expenses: [
      { date: '2026-07-10', amount_ex_gst: 1000, gst: 100 },
      { date: '2026-07-11', amount_ex_gst: 221.50, gst: 0 },   // bank fees, ASIC
    ],
  })
  eq(t.expsIncGST, 1321.50, 'G11 expenses include the GST-free row')
  eq(t.purchasesIncGST, 1321.50, 'G11 total includes it')
  eq(t.totalGSTCredits, 100, '1B claims nothing for the GST-free row')
  // The specific regression: filtering G11 by hasGST lost exactly this.
  ok(!near(t.purchasesIncGST, 1100), 'the GST-free row is not silently dropped from G11')
}

// ── 2. Nothing is grossed up at 10% ─────────────────────────
{
  // A private sale carries no GST. 1.1 x 1000 would report 1100.
  const t = run({
    assets: [{ purchase_date: '2026-08-01', cost_ex_gst: 1000, gst: 0, total_inc_gst: 1000,
               method: 'immediate', business_use_pct: 100 }],
  })
  eq(t.assetsIncGST, 1000, 'G10 reports a private-sale asset at cost, not cost + 10%')
  eq(t.gstOnAssets, 0, 'and claims no GST credit on it')
  eq(t.purchasesIncGST, 1000, 'G11 carries the same figure')
}
{
  // A GST-free sale: 1.1 x 2000 would report 2200 and overstate G1.
  const t = run({ invoices: [{ date: '2026-07-02', agreed_ex_gst: 2000, gst: 0 }] })
  eq(t.salesIncGST, 2000, 'G1 reports a GST-free sale at its own figure')
  eq(t.gstCollected, 0, '1A collects nothing on it')
}
{
  // And the ordinary case still grosses to the same number the old code got.
  const t = run({ invoices: [{ date: '2026-07-02', agreed_ex_gst: 43663, gst: 4366.30 }] })
  eq(t.salesIncGST, 48029.30, 'G1 of a taxable sale is ex + GST')
  eq(t.totalSales, 43663, 'and the ex-GST total is unchanged')
}

// ── recognisedDate: the whole of the difference between bases ──
//
// The BAS and the P&L both go through this, so a figure that moves on one
// moves on the other. That is the fix: they used to disagree silently.
{
  const paidLater = { date: '2026-06-20', date_paid: '2026-07-31' }
  const st = () => 'Paid'
  ok(recognisedDate(paidLater, 'accrual', st) === '2026-06-20', 'accrual: the invoice date')
  ok(recognisedDate(paidLater, 'cash', st) === '2026-07-31', 'cash: the date paid')

  const noDatePaid = { date: '2026-07-10' }
  ok(recognisedDate(noDatePaid, 'cash', st) === '2026-07-10',
     'cash: a Paid invoice with no date_paid falls back to its own date')
  ok(recognisedDate(noDatePaid, 'cash', () => 'Sent') === null,
     'cash: an unpaid invoice is recognised in no period at all')
  ok(recognisedDate(noDatePaid, 'accrual', () => 'Sent') === '2026-07-10',
     'accrual: an unpaid invoice is still income of the period it was issued in')

  ok(recognisedDate({}, 'accrual', st) === null, 'no date at all, accrual')
  ok(recognisedDate({}, 'cash', st) === null, 'no date at all, cash')
}

// ── The same invoice, both reports, one basis ──────────────
//
// This is the case that produced the false reading: a quarter showing more
// sales than the whole financial year it sits in. The two reports must now
// place the invoice in the same period as each other.
{
  const inv = { date: '2026-06-20', date_paid: '2026-07-31', agreed_ex_gst: 20000, gst: 2000 }
  // Cash: recognised 31 Jul 2026, so Q1 of FY2026-27 and that FY.
  eq(run({ invoices: [inv], basis: 'cash' }).salesIncGST, 22000, 'cash: in Q1 FY2026-27')
  eq(run({ invoices: [inv], basis: 'cash', year: 2026, quarter: 4 }).salesIncGST, 0,
     'cash: and not in Q4 FY2025-26, where the invoice date sits')
  // Accrual: recognised 20 Jun 2026, so Q4 of FY2025-26.
  eq(run({ invoices: [inv], basis: 'accrual' }).salesIncGST, 0, 'accrual: not in Q1 FY2026-27')
  eq(run({ invoices: [inv], basis: 'accrual', year: 2026, quarter: 4 }).salesIncGST, 22000,
     'accrual: in Q4 FY2025-26')
}

// ── The quarter it lands in ─────────────────────────────────
{
  const expenses = [
    { date: '2026-06-30', amount_ex_gst: 100, gst: 10 },  // FY25-26 Q4
    { date: '2026-07-01', amount_ex_gst: 200, gst: 20 },  // FY26-27 Q1, first day
    { date: '2026-09-30', amount_ex_gst: 400, gst: 40 },  // Q1, last day
    { date: '2026-10-01', amount_ex_gst: 800, gst: 80 },  // Q2
  ]
  eq(run({ expenses }).expsIncGST, 660, 'Q1 is 1 Jul to 30 Sep inclusive, and nothing either side')
  eq(run({ expenses, quarter: 2 }).expsIncGST, 880, 'Q2 picks up October')
}

// ── Cash purchases are not on the BAS at all ────────────────
{
  const t = run({
    materials: [
      { date: '2026-07-05', cost_ex_gst: 1000, gst: 100, total_inc_gst: 1100, paid_by: 'Bank' },
      { date: '2026-07-06', cost_ex_gst: 500, gst: 50, total_inc_gst: 550, paid_by: 'Cash' },
    ],
  })
  eq(t.matsIncGST, 1100, 'a cash purchase is out of G11')
  eq(t.totalGSTCredits, 100, 'and claims no credit')
  eq(t.cashPurchases, 1, 'but it is counted, so the omission is visible')
}

// ── Cash jobs: income named, not declared ───────────────────
{
  const invoices = [
    { date: '2026-07-02', agreed_ex_gst: 10000, gst: 1000, job_id: 'NP-1' },
    { date: '2026-07-03', agreed_ex_gst: 5000, gst: 0, job_id: 'NP-CASH' },
  ]
  const t = run({ invoices, invOnBooks: (i: any) => i.job_id !== 'NP-CASH' })
  eq(t.salesIncGST, 11000, 'G1 excludes the cash job')
  eq(t.gstCollected, 1000, '1A likewise')
  eq(t.offBooksSales, 5000, 'but the cash income is reported separately')
  eq(t.offBooksCount, 1, 'with its count')
}

// ── Cash versus accrual basis ───────────────────────────────
{
  // Invoiced in June, paid in July: the case that made Q1 look like $105k.
  const invoices = [{ date: '2026-06-20', date_paid: '2026-07-31', agreed_ex_gst: 20000, gst: 2000 }]
  eq(run({ invoices, basis: 'cash' }).salesIncGST, 22000, 'cash basis counts it when it was paid')
  eq(run({ invoices, basis: 'accrual' }).salesIncGST, 0, 'accrual basis counts it when it was invoiced')
}
{
  // Paid, but with no date recorded: cash basis falls back to the invoice date.
  const invoices = [{ date: '2026-07-10', agreed_ex_gst: 1000, gst: 100 }]
  eq(run({ invoices, basis: 'cash' }).salesIncGST, 1100, 'a Paid invoice with no date_paid falls back to its own date')
  eq(run({ invoices, basis: 'cash', invStatus: () => 'Sent' }).salesIncGST, 0,
     'an unpaid invoice with no date_paid is not on a cash-basis BAS')
}

// ── The net position ────────────────────────────────────────
{
  const t = run({
    invoices: [{ date: '2026-07-02', agreed_ex_gst: 43663, gst: 4366.30 }],
    materials: [{ date: '2026-07-05', cost_ex_gst: 6916, gst: 691.60, total_inc_gst: 7607.60 }],
    expenses: [
      { date: '2026-07-10', amount_ex_gst: 10030.69, gst: 1003.09 },
      { date: '2026-07-11', amount_ex_gst: 221.50, gst: 0 },
    ],
  })
  eq(t.gstCollected, 4366.30, '1A')
  eq(t.totalGSTCredits, 1694.69, '1B')
  eq(t.netGST, 2671.61, 'net GST is 1A less 1B')
  eq(t.purchasesIncGST, 18862.88, 'G11 is the sum of stored inc-GST amounts')
  // What the old code reported for this quarter: the GST-free $221.50 dropped,
  // then the remainder grossed up at 10%.
  ok(!near(t.purchasesIncGST, (6916 + 10030.69) * 1.1, 0.5), 'and not the old grossed-up figure')
}

// ── Nothing at all ──────────────────────────────────────────
{
  const t = run({})
  eq(t.netGST, 0, 'an empty quarter nets to zero')
  eq(t.purchasesIncGST, 0, 'with no purchases')
  eq(t.invCount, 0, 'and no invoices')
}

// ── Junk in the columns ─────────────────────────────────────
{
  const t = run({
    expenses: [
      { date: '2026-07-10', amount_ex_gst: null, gst: undefined },
      { date: '2026-07-11', amount_ex_gst: 'not a number', gst: 'nope' },
      { date: '2026-07-12', amount_ex_gst: '100.50', gst: '10.05' },
    ],
  })
  eq(t.expsIncGST, 110.55, 'nulls and junk read as zero, numeric strings read as numbers')
  ok(!Number.isNaN(t.netGST), 'and no NaN reaches a lodged figure')
}

// ── The P&L recognises income on the same basis ────────────
//
// The Tax page filters the P&L's invoices with inFY(recognisedDate(...)),
// mirrored here. Before the fix it filtered on i.date outright, so the P&L
// sat permanently on an accrual footing while the BAS defaulted to cash, and
// a quarter could show more sales than the whole year containing it.
{
  const inv = { date: '2026-06-20', date_paid: '2026-07-31', agreed_ex_gst: 20000, gst: 2000 }
  const st = () => 'Paid'
  const plIncome = (basis: 'cash' | 'accrual', year: number) => splitBooks({
    invoices: [inv].filter(i => inFY(recognisedDate(i, basis, st), year)),
    materials: [], labour: [], expenses: [],
    cashJobIds: new Set<string>(), taxRate: 0.25,
  }).books.income

  eq(plIncome('cash', 2027), 20000, 'cash: the P&L puts it in the year it was paid')
  eq(plIncome('cash', 2026), 0, 'cash: and not in the year it was invoiced')
  eq(plIncome('accrual', 2026), 20000, 'accrual: the P&L puts it in the year it was invoiced')
  eq(plIncome('accrual', 2027), 0, 'accrual: and not in the year it was paid')

  // The point of the change: on one basis, both reports agree which period
  // the invoice belongs to.
  for (const basis of ['cash', 'accrual'] as const)
    for (const year of [2026, 2027]) {
      const onBAS = [1, 2, 3, 4].reduce((s2, quarter) => s2 + basTotals({
        invoices: [inv], materials: [], expenses: [], assets: [],
        basis, year, quarter, onBooks: () => true, invOnBooks: () => true, invStatus: st,
      }).salesIncGST, 0)
      eq(onBAS, plIncome(basis, year) * 1.1,
         `${basis} FY${year - 1}: the BAS year and the P&L year agree`)
    }
}

console.log(fail ? `\n${fail} FAILED` : '\nall passed')
process.exit(fail ? 1 : 0)
