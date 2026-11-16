// The private-use share on an expense.
//
// The rule being protected: the WHOLE amount paid is what gets stored, so the
// row still ties to the line on the bank statement, and only the work share
// is deducted or claimed back. Get this backwards and either the deduction is
// overstated or the row reconciles to nothing.
//
// Figures here are the real ones from reconciling four CommBank statements in
// November 2026: fuel, insurance and phone came to $7,841.45 ex GST across
// FY2025-26 against $6,273.16 actually claimable at 80%.

import { splitBooks, businessShare, isCashPaid } from '@/lib/cashBooks'
import { businessShare as assetShare } from '@/lib/assets'
import { readFileSync } from 'node:fs'

let fail = 0
const ok = (c: boolean, m: string) => { if (!c) { fail++; console.log('FAIL', m) } else console.log('ok  ', m) }
const near = (a: number, b: number, tol = 0.02) => Math.abs(a - b) < tol

// ── The share itself ─────────────────────────────────────────
ok(businessShare({}) === 1, 'nothing set means wholly business')
ok(businessShare(null) === 1, 'and so does a missing row')
ok(businessShare(undefined) === 1, 'and an undefined one')
ok(businessShare({ business_use_pct: null }) === 1, 'null is wholly business, not nothing')
ok(businessShare({ business_use_pct: '' }) === 1, 'and so is a blank field')
ok(businessShare({ business_use_pct: 80 }) === 0.8, '80 reads as 0.8')
ok(businessShare({ business_use_pct: '80' }) === 0.8, 'and so does the string the input gives')
ok(businessShare({ business_use_pct: 0 }) === 0, '0% claims nothing — not treated as absent')
ok(businessShare({ business_use_pct: 100 }) === 1, '100% is the whole thing')

// Out-of-range values are clamped rather than allowed to inflate a deduction.
ok(businessShare({ business_use_pct: 500 }) === 1, '500% cannot claim five times the cost')
ok(businessShare({ business_use_pct: -20 }) === 0, 'and a negative share claims nothing')
ok(businessShare({ business_use_pct: 'rubbish' }) === 0, 'junk claims nothing rather than NaN')
ok(!Number.isNaN(businessShare({ business_use_pct: 'rubbish' })), 'and really is not NaN')

// One implementation, not two that can drift.
ok(assetShare === businessShare, 'assets and expenses share one helper')

// ── What it does to the books ────────────────────────────────
const one = (pct: number | null, amount = 1000, gst = 100) => splitBooks({
  invoices: [], materials: [], labour: [],
  expenses: [{ amount_ex_gst: amount, gst, business_use_pct: pct, category: 'Motor Vehicle & Fuel' }],
})

ok(near(one(null).books.expenses, 1000), 'no share set deducts the whole cost')
ok(near(one(null).gstCredits, 100), 'and claims the whole GST credit')
ok(near(one(80).books.expenses, 800), '80% deducts $800 of a $1,000 cost')
ok(near(one(80).gstCredits, 80), 'and claims $80 of the $100 GST')
ok(near(one(0).books.expenses, 0), '0% deducts nothing')
ok(near(one(0).gstCredits, 0), 'and claims no GST')

// The private share is not a business cost at all, so it must not reappear on
// the off-books side either — that would make it reduce profit after tax.
const shared = one(80)
ok(near(shared.offBooks.expenses, 0), 'the private 20% is not an off-books cost')
ok(near(shared.books.net, -800), 'it simply never enters the business books')

// Cash still wins: a cash-paid cost is not deductible whatever its share.
const cashShared = splitBooks({
  invoices: [], materials: [], labour: [],
  expenses: [{ amount_ex_gst: 1000, gst: 100, business_use_pct: 80, paid_by: 'Cash' }],
})
ok(near(cashShared.books.expenses, 0), 'cash is not deductible even at 80% business')
ok(near(cashShared.gstCredits, 0), 'and claims no GST credit')
ok(near(cashShared.offBooks.expenses, 800), 'the work share lands off the books')
ok(isCashPaid({ paid_by: 'Cash' }), 'and it is still recognised as cash')

// ── The figures from the real reconciliation ─────────────────
const bank = [
  { amount_ex_gst: 7841.45 - 784.15, gst: 784.15, business_use_pct: 80 },
]
const r = splitBooks({ invoices: [], materials: [], labour: [], expenses: bank })
ok(near(r.books.expenses, (7841.45 - 784.15) * 0.8, 0.05),
   'the FY26 vehicle/phone cluster deducts its 80%, not its whole')
ok(near(r.gstCredits, 627.32, 0.05), 'and claims $627 of GST, not $784')

// ── The screens must offer both ──────────────────────────────
const exp = readFileSync('src/pages/Expenses.tsx', 'utf8')
ok(/'Materials'/.test(exp), "Materials is an expense category")
ok(/business_use_pct/.test(exp), 'and the form can set a business-use share')
ok(/min="0"\s+max="100"/.test(exp), 'with the input bounded to 0-100')
// The whole point is that the stored amount matches the bank, so the form
// must not quietly scale what it saves.
ok(!/amount_ex_gst:\s*ex\s*\*/.test(exp), 'and the saved amount is never pre-scaled by the share')

// Reconciliation views money that MOVED, so they take the full amount.
const recon = readFileSync('src/lib/bankRecon.ts', 'utf8')
ok(!/businessShare/.test(recon),
   'bank reconciliation uses the full amount — the private share still left the account')

console.log(fail ? `\n${fail} failed` : '\nall passed')
process.exit(fail ? 1 : 0)
