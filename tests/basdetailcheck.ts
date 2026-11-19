// The detail behind a BAS, as the accountant asked for it.
//
// What has to hold, in the order it matters:
//
//   1. The detail adds up to the summary. An accountant reconciling a figure
//      against the rows beneath it must not find a gap — that is the entire
//      purpose of putting both in one file.
//   2. Cash is absent. A cash purchase claims no GST credit and a cash job
//      makes no sale, so neither is part of the BAS this explains.
//   3. Sales are counted when the money arrived, because "sales received
//      from 1 July to 30 September" is a cash-basis question.
//   4. A description appears where it earns its place and not otherwise.

import {
  describe as desc, salesDetail, purchaseDetail, basDetailCSV,
} from '@/lib/basDetail'

let fail = 0
const ok = (c: boolean, m: string) => { if (!c) { fail++; console.log('FAIL', m) } else console.log('ok  ', m) }
const near = (a: number, b: number, tol = 0.005) => Math.abs(a - b) < tol
const eq = (a: number, b: number, m: string) =>
  ok(near(a, b), `${m} — got ${a.toFixed(2)}, want ${b.toFixed(2)}`)

// Q1 FY2026-27 is July–September 2026; `year` is the year the FY ends in.
const base = {
  invoices: [], materials: [], expenses: [], assets: [],
  basis: 'cash' as const, year: 2027, quarter: 1,
  onBooks: () => true, invOnBooks: () => true, invStatus: () => 'Paid',
}
const run = (o: any = {}) => ({ ...base, ...o })

// ── Descriptions ────────────────────────────────────────────
ok(desc('Bunnings Byron Bay', 'Bunnings') === '',
   'a description that repeats the payee is dropped')
ok(desc('Bunnings Byron Bay', 'drop sheets and rollers') === 'drop sheets and rollers',
   'one that adds something is kept')
ok(desc('Inspirations Paint', '') === '', 'no description means none')
ok(desc('INSPIRATIONS PAINT', 'inspirations  paint!') === '',
   'case and punctuation do not make a description new')

// The real case this was rebuilt for: the app's own auto-generated material
// description is the payee and the reference said twice with scaffolding.
ok(desc('Dulux Paint Byron Bay', 'Dulux Paint Byron Bay — Inv #909874103 (2 items)', '909874103') === '',
   'an auto-generated "payee — Inv #ref (n items)" description is dropped')
ok(desc('Bunnings Byron Bay', 'Bunnings Byron Bay — Inv #004-95213-8170 (1 item)', '004-95213-8170') === '',
   'and the same with a hyphenated receipt number')
ok(desc('Inspiraions', 'Dulux weathershield low sheen 10 lts + aquaenamel 4 lts', 'NP-0101')
   === 'Dulux weathershield low sheen 10 lts + aquaenamel 4 lts',
   'a real description survives, numbers and all')
ok(desc('Painted Earth', 'Pure Wall Flat White base 15L Twine x 2', 'NP-7142')
   === 'Pure Wall Flat White base 15L Twine x 2',
   'as does one whose only extra words are the product')
ok(desc('Dulux', 'Inv 12345', '12345') === '',
   'a bare reference is not a description')

// ── Sales are counted when received ─────────────────────────
{
  // Invoiced in June, paid in July: received in Q1 FY2026-27, invoiced in the
  // year before. The basis decides which.
  const invoices = [{ id: 'A', client: 'JHT Built', date: '2026-06-20',
                      date_paid: '2026-07-31', agreed_ex_gst: 20000, gst: 2000 }]
  const cash = salesDetail(run({ invoices }))
  ok(cash.length === 1 && cash[0].date === '2026-07-31',
     'cash basis lists it on the day the money arrived')
  eq(cash[0].amountIncGST, 22000, 'at the inc-GST figure the accountant asked for')
  eq(cash[0].gst, 2000, 'with the GST actually charged')
  ok(salesDetail(run({ invoices, basis: 'accrual' })).length === 0,
     'accrual basis does not have it in this quarter at all')
}

// ── A GST-free sale is a sale ───────────────────────────────
{
  const s = salesDetail(run({
    invoices: [{ id: 'F', client: 'X', date: '2026-07-02', date_paid: '2026-07-02',
                 agreed_ex_gst: 2000, gst: 0 }],
  }))
  eq(s[0].amountIncGST, 2000, 'reported at its own figure, not grossed up')
  eq(s[0].gst, 0, 'carrying no GST')
}

// ── Cash is absent on both sides ────────────────────────────
{
  const input = run({
    invoices: [
      { id: 'ON', client: 'A', date: '2026-07-02', date_paid: '2026-07-02', agreed_ex_gst: 1000, gst: 100, job_id: 'NP-1' },
      { id: 'CASH', client: 'B', date: '2026-07-03', date_paid: '2026-07-03', agreed_ex_gst: 9000, gst: 0, job_id: 'NP-CASH' },
    ],
    materials: [
      { date: '2026-07-05', supplier: 'Dulux', cost_ex_gst: 500, gst: 50, total_inc_gst: 550, paid_by: 'Bank' },
      { date: '2026-07-06', supplier: 'Dulux', cost_ex_gst: 400, gst: 40, total_inc_gst: 440, paid_by: 'Cash' },
    ],
    invOnBooks: (i: any) => i.job_id !== 'NP-CASH',
  })
  const s = salesDetail(input)
  ok(s.length === 1 && s[0].reference === 'ON', 'a cash job is not a sale')
  const g = purchaseDetail(input)
  eq(g.reduce((t, x) => t + x.amountIncGST, 0), 550, 'a cash purchase is not a purchase here')
}

// ── Grouping, subtotals and the summary ─────────────────────
{
  const input = run({
    invoices: [
      { id: 'i1', client: 'Amplify', date: '2026-07-02', date_paid: '2026-07-02', agreed_ex_gst: 20000, gst: 2000 },
      { id: 'i2', client: 'Basq House', date: '2026-09-07', date_paid: '2026-09-07', agreed_ex_gst: 700, gst: 70 },
    ],
    materials: [
      { date: '2026-07-05', supplier: 'Inspirations Paint', mat_desc: 'ceiling white', cost_ex_gst: 1000, gst: 100, total_inc_gst: 1100 },
      { date: '2026-08-05', supplier: 'Bunnings', mat_desc: 'Bunnings', cost_ex_gst: 100, gst: 10, total_inc_gst: 110 },
    ],
    expenses: [
      { date: '2026-07-10', supplier: 'BP', exp_desc: 'fuel', amount_ex_gst: 200, gst: 20, category: 'Motor Vehicle & Fuel' },
      { date: '2026-07-11', supplier: 'CBA', exp_desc: 'account fee', amount_ex_gst: 11.50, gst: 0, category: 'Bank Charges & Fees' },
    ],
    assets: [
      { id: 'a1', purchase_date: '2026-08-01', supplier: 'Trailer Co', name: 'Work trailer',
        cost_ex_gst: 2000, gst: 200, total_inc_gst: 2200, method: 'immediate', business_use_pct: 100 },
    ],
  })

  const g = purchaseDetail(input)
  const cats = g.map(x => x.category)
  ok(cats.includes('Materials'), 'materials with no category of their own are reported as Materials')
  ok(cats.includes('Capital purchases (assets)'), 'a capital purchase gets its own category')
  ok(cats.includes('Bank Charges & Fees'), 'a GST-free category still appears')
  ok(g[0].amountIncGST >= g[g.length - 1].amountIncGST, 'largest category first')

  // Every subtotal is the sum of its own rows.
  for (const x of g) {
    eq(x.amountIncGST, x.rows.reduce((t, r) => t + r.amountIncGST, 0), `${x.category} subtotal`)
    eq(x.gst, x.rows.reduce((t, r) => t + r.gst, 0), `${x.category} GST subtotal`)
  }

  // And the whole thing reconciles: 1100 + 110 + 220 + 11.50 + 2200.
  eq(g.reduce((t, x) => t + x.amountIncGST, 0), 3641.50, 'purchases inc GST')
  eq(g.reduce((t, x) => t + x.gst, 0), 330, 'GST on purchases')

  const s = salesDetail(input)
  eq(s.reduce((t, r) => t + r.amountIncGST, 0), 22770, 'sales received inc GST')
  eq(s.reduce((t, r) => t + r.gst, 0), 2070, 'GST on sales')
  ok(s[0].date <= s[1].date, 'sales are in date order')

  // The file's summary must equal its own detail — the one thing an
  // accountant will check first.
  const csv = basDetailCSV(input, 'Northern Painters', '46435825953')
  const text = csv.join('\n')
  ok(text.includes('Total sales received (inc GST),22770.00,2070.00'),
     'the summary sales line matches the sales rows')
  ok(text.includes('Total purchases (inc GST),3641.50,330.00'),
     'the summary purchases line matches the purchase rows')
  ok(text.includes('Net GST,,1740.00'), 'net GST is sales GST less purchases GST')
  ok(text.includes('Date,Received from,Description,Invoice,Amount inc GST,GST'),
     'the sales columns are the ones that were asked for')
  ok(text.includes('Date,Paid to,Description,Reference,Amount inc GST,GST'),
     'and the purchase columns likewise')
  ok(text.includes('Cash basis: sales counted when payment was received'),
     'the basis is stated on the face of the report')
  ok(text.includes('46435825953'), 'with the ABN')
  ok(/Bunnings,,/.test(text), 'a self-evident description is left blank in the file')
  ok(text.includes('ceiling white'), 'a useful one is printed')
}

// ── Quarter boundaries ──────────────────────────────────────
{
  const materials = [
    { date: '2026-06-30', supplier: 'S', cost_ex_gst: 100, gst: 10, total_inc_gst: 110 },
    { date: '2026-07-01', supplier: 'S', cost_ex_gst: 200, gst: 20, total_inc_gst: 220 },
    { date: '2026-09-30', supplier: 'S', cost_ex_gst: 400, gst: 40, total_inc_gst: 440 },
    { date: '2026-10-01', supplier: 'S', cost_ex_gst: 800, gst: 80, total_inc_gst: 880 },
  ]
  eq(purchaseDetail(run({ materials })).reduce((t, g) => t + g.amountIncGST, 0), 660,
     '1 July to 30 September inclusive, and nothing either side')
}

// ── Escaping, and empty ─────────────────────────────────────
{
  const csv = basDetailCSV(run({
    materials: [{ date: '2026-07-05', supplier: 'Smith, Jones & Co', mat_desc: 'paint "trade" grade',
                  cost_ex_gst: 1000, gst: 100, total_inc_gst: 1100 }],
  }))
  const text = csv.join('\n')
  ok(text.includes('"Smith, Jones & Co"'), 'a comma in a payee is quoted')
  ok(text.includes('"paint ""trade"" grade"'), 'and a quote is doubled')
}
{
  const text = basDetailCSV(run({})).join('\n')
  ok(text.includes('Total sales received (inc GST),0.00,0.00'), 'an empty quarter still produces a report')
  ok(text.includes('TOTAL PURCHASES'), 'with its headings intact')
}

// ── Junk in the columns ─────────────────────────────────────
{
  const g = purchaseDetail(run({
    materials: [{ date: '2026-07-05', supplier: null, mat_desc: null,
                  cost_ex_gst: 'rubbish', gst: undefined, total_inc_gst: null }],
  }))
  ok(g[0].rows[0].party === 'Unknown', 'a missing payee is named Unknown rather than left blank')
  ok(!Number.isNaN(g[0].amountIncGST), 'and junk does not produce NaN')
}

console.log(fail ? `\n${fail} FAILED` : '\nall passed')
process.exit(fail ? 1 : 0)
