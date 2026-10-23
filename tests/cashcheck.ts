// Cash: non-deductible out, off-the-books in.
//
// The two rules in one partition. What is asserted here is the thing that
// matters: that cash never moves the tax, and always moves what is left.

import { splitBooks, isCashPaid, labourCost, PAID_BY } from '@/lib/cashBooks'

let fail = 0
const ok = (c: boolean, m: string) => { if (!c) { fail++; console.log('FAIL', m) } else console.log('ok  ', m) }
const near = (a: number, b: number) => Math.abs(a - b) < 0.005

const run = (o: any) => splitBooks({
  invoices: o.invoices ?? [], materials: o.materials ?? [],
  labour: o.labour ?? [], expenses: o.expenses ?? [],
  cashJobIds: new Set<string>(o.cashJobIds ?? []), taxRate: o.taxRate ?? 0.25,
  depreciation: o.depreciation, depreciationNonDeductible: o.depreciationNonDeductible,
})

// ── What counts as cash ──────────────────────────────────────
ok(isCashPaid({ paid_by: 'Cash' }), "'Cash' is cash")
ok(isCashPaid({ paid_by: ' cash ' }), 'whitespace and case tolerated')
ok(!isCashPaid({ paid_by: null }), 'not stated is NOT cash — the conservative read')
ok(!isCashPaid({}), 'absent is not cash')
ok(!isCashPaid({ paid_by: 'Bank' }) && !isCashPaid({ paid_by: 'Card' }), 'bank and card are not cash')
ok(PAID_BY.join('|') === 'Bank|Card|Cash', 'the three methods')

// ── Baseline: nothing is cash, so nothing changes ────────────
const plain = run({
  invoices: [{ agreed_ex_gst: 10000, gst: 1000 }],
  materials: [{ cost_ex_gst: 2000, gst: 200 }],
  labour: [{ cost: 3000 }],
  expenses: [{ amount_ex_gst: 1000, gst: 100, category: 'Fuel' }],
})
ok(near(plain.books.income, 10000) && near(plain.books.costs, 6000), 'baseline splits nothing off')
ok(near(plain.taxableProfit, 4000), 'taxable profit 10000 − 6000')
ok(near(plain.tax, 1000), 'tax 25% of 4000')
ok(near(plain.afterTax, 3000), 'after tax 3000')
ok(near(plain.netGST, 1000 - 300), 'GST 1000 collected − 300 credits')
ok(plain.offBooks.net === 0, 'nothing off the books')

// ── Rule 1: a cash cost is not deductible ────────────────────
const cashCost = run({
  invoices: [{ agreed_ex_gst: 10000, gst: 1000 }],
  materials: [{ cost_ex_gst: 2000, gst: 200, paid_by: 'Cash' }],
  labour: [{ cost: 3000 }],
  expenses: [{ amount_ex_gst: 1000, gst: 100, category: 'Fuel' }],
})
ok(near(cashCost.books.materials, 0), 'cash materials are out of the deductible side')
ok(near(cashCost.offBooks.materials, 2000), 'and on the off-books side at full value')
ok(near(cashCost.taxableProfit, 6000), 'taxable profit RISES by the non-deductible 2000')
ok(near(cashCost.tax, 1500), 'so the tax rises too — 1500, not 1000')
ok(near(cashCost.gstCredits, 100), 'no GST credit on the cash purchase: 100, not 300')
ok(near(cashCost.afterTax, 6000 - 1500 - 2000), 'but the 2000 still leaves: after tax 2500')
ok(cashCost.afterTax < plain.afterTax, 'paying that cost in cash leaves you worse off, as it should')
ok(cashCost.counts.cashCostRows === 1, 'one cash cost row counted')

// ── Rule 2: cash income is off the books ─────────────────────
const cashIncome = run({
  invoices: [{ agreed_ex_gst: 10000, gst: 1000 }, { job_id: 'J1', agreed_ex_gst: 5000, gst: 0 }],
  materials: [{ cost_ex_gst: 2000, gst: 200 }],
  labour: [{ cost: 3000 }],
  expenses: [{ amount_ex_gst: 1000, gst: 100, category: 'Fuel' }],
  cashJobIds: ['J1'],
})
ok(near(cashIncome.books.income, 10000), 'the cash job is not declared income')
ok(near(cashIncome.offBooks.income, 5000), 'it is off-books income instead')
ok(near(cashIncome.taxableProfit, 4000) && near(cashIncome.tax, 1000), 'tax is untouched by it')
ok(near(cashIncome.gstCollected, 1000), 'and no GST is collected on it')
ok(near(cashIncome.afterTax, 3000 + 5000), 'but it lands on the after-tax profit in full: 8000')
ok(cashIncome.counts.cashIncomeRows === 1, 'one cash income row counted')

// ── A cash job's costs go with its income ────────────────────
const cashJobBoth = run({
  invoices: [{ job_id: 'J1', agreed_ex_gst: 5000, gst: 0 }],
  materials: [{ job_id: 'J1', cost_ex_gst: 800, gst: 80 }],
  labour: [{ job_id: 'J1', hours: 10, rate: 65 }],
  cashJobIds: ['J1'],
})
ok(near(cashJobBoth.books.income, 0) && near(cashJobBoth.books.costs, 0), 'a cash job is entirely off the books')
ok(near(cashJobBoth.tax, 0), 'it generates no tax')
ok(near(cashJobBoth.gstCredits, 0), 'and no GST credit on its materials, however they were paid')
ok(near(cashJobBoth.afterTax, 5000 - 800 - 650), 'after tax is simply what it made: 3550')

// ── The identity, on awkward figures ─────────────────────────
const messy = run({
  invoices: [{ agreed_ex_gst: 7331.17, gst: 733.12 }, { job_id: 'J9', agreed_ex_gst: 2450.55 }],
  materials: [{ cost_ex_gst: 1234.56, gst: 123.46 }, { cost_ex_gst: 99.99, paid_by: 'Cash' }],
  labour: [{ hours: 37.5, rate: 65 }, { hours: 8, rate: 55, paid_by: 'Cash' }],
  expenses: [{ amount_ex_gst: 410.1, gst: 41.01, category: 'Fuel', paid_by: 'Card' },
             { amount_ex_gst: 60, category: 'Other', paid_by: 'Cash' }],
  cashJobIds: ['J9'],
  taxRate: 0.27,
})
ok(near(messy.books.labour, 37.5 * 65), 'cash-paid labour is out of the deductible labour')
ok(near(messy.offBooks.labour, 8 * 55), 'and off the books at cost')
ok(near(messy.taxableProfit, messy.books.income - messy.books.costs), 'taxable profit is the books side')
ok(near(messy.tax, messy.taxableProfit * 0.27), 'the rate is the one given, not a hardcoded 25%')
ok(near(messy.afterTax, messy.taxableProfit - messy.tax + messy.offBooks.net),
  'after tax = taxable − tax + off-books net')
ok(near(messy.books.income + messy.offBooks.income, 7331.17 + 2450.55),
  'no income is lost between the two sides')
ok(near(messy.books.costs + messy.offBooks.costs,
  1234.56 + 99.99 + 37.5 * 65 + 8 * 55 + 410.1 + 60), 'and no cost is lost either')
ok(near(messy.byCat.Fuel, 410.1) && messy.byCat.Other === undefined,
  'the category breakdown holds the deductible overheads only')

// ── A loss is not a tax refund ───────────────────────────────
const loss = run({
  invoices: [{ agreed_ex_gst: 1000, gst: 100 }],
  materials: [{ cost_ex_gst: 4000, gst: 400 }],
})
ok(near(loss.taxableProfit, -3000) && loss.tax === 0, 'a loss is reported, and taxed at nothing')
ok(near(loss.afterTax, -3000), 'the loss carries through to after tax unreduced')

// ── Null paid_by never moves a figure ────────────────────────
const nulls = run({
  invoices: [{ agreed_ex_gst: 10000, gst: 1000 }],
  materials: [{ cost_ex_gst: 2000, gst: 200, paid_by: null }],
  labour: [{ cost: 3000, paid_by: '' }],
  expenses: [{ amount_ex_gst: 1000, gst: 100, category: 'Fuel' }],
})
ok(near(nulls.afterTax, plain.afterTax) && near(nulls.tax, plain.tax),
  'rows logged before paid_by existed produce exactly the old numbers')

// ── Depreciation from the asset register ─────────────────────
// It is a deduction with no payment behind it, and it must reach the tax.
const dep = run({
  invoices: [{ agreed_ex_gst: 10000, gst: 1000 }],
  materials: [{ cost_ex_gst: 2000, gst: 200 }],
  depreciation: 1500,
})
ok(near(dep.books.depreciation, 1500), "the register's deduction lands on the books side")
ok(near(dep.books.costs, 2000 + 1500), 'and inside total costs')
ok(near(dep.taxableProfit, 10000 - 3500), 'so it reduces taxable profit')
ok(near(dep.tax, 1625), 'and the tax with it')
ok(near(dep.afterTax, 6500 - 1625), 'after tax follows the same line')

const noDep = run({
  invoices: [{ agreed_ex_gst: 10000, gst: 1000 }],
  materials: [{ cost_ex_gst: 2000, gst: 200 }],
})
ok(noDep.books.depreciation === 0 && near(noDep.taxableProfit, 8000),
  'an empty register changes nothing — the field is optional')

const depCash = run({
  invoices: [{ agreed_ex_gst: 10000, gst: 1000 }],
  depreciation: 0, depreciationNonDeductible: 1500,
})
ok(near(depCash.taxableProfit, 10000) && near(depCash.tax, 2500),
  'depreciation on a cash-bought asset does not reduce the tax')
ok(near(depCash.afterTax, 7500 - 1500),
  'but the asset was still paid for, so it comes off what is left')

// ── labourCost ───────────────────────────────────────────────
ok(near(labourCost({ cost: 500, hours: 10, rate: 65 }), 500), 'a stored cost wins')
ok(near(labourCost({ hours: 10, rate: 65 }), 650), 'otherwise hours × rate')
ok(labourCost({}) === 0, 'and an empty row costs nothing')
ok(labourCost({ cost: 'x', hours: '4', rate: '50' } as any) === 200, 'strings coerce, junk does not become NaN')

console.log(fail ? `\n${fail} FAILED` : '\nall passed')
process.exit(fail ? 1 : 0)
