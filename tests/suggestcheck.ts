// What the invoice modal offers for a job.
//
// The failure that matters is double-counting a deposit: a booking deposit
// is itself an invoice, so subtracting it as well as the invoices would
// under-bill the client by that amount, every time, quietly.

import { invoiceSuggestion } from '@/lib/jobBilling'

let fail = 0
const ok = (c: boolean, m: string) => { if (!c) { fail++; console.log('FAIL', m) } else console.log('ok  ', m) }
const near = (a: number, b: number) => Math.abs(a - b) < 0.015

const JOB = { id: 'NP-1', client: 'Smith', agreed_ex_gst: 10000, terms: 'Fixed Quote' }
const inv = (o: any) => ({ job_id: 'NP-1', received: 0, ...o })

// ── Nothing invoiced yet ─────────────────────────────────────
const fresh = invoiceSuggestion({ job: JOB, invoices: [] })
ok(fresh.basis === 'fixed', 'a fixed-price job measures against its agreed price')
ok(fresh.baseExGST === 10000, 'the agreed price is the base')
ok(fresh.jobTotalExGST === 10000 && near(fresh.jobTotalIncGST, 11000), 'the job total, ex and inc GST')
ok(fresh.invoicedIncGST === 0 && fresh.invoiceCount === 0, 'nothing invoiced')
ok(near(fresh.leftToInvoiceIncGST, 11000), 'so the whole thing is left to invoice')
ok(near(fresh.leftToInvoiceExGST, 10000), 'and the ex-GST figure is what the amount box takes')
ok(fresh.hasValue, 'the job has a value to measure against')

// ── Add-ons raise the total ──────────────────────────────────
const withAddOns = invoiceSuggestion({
  job: JOB, invoices: [],
  variations: [
    { job_id: 'NP-1', amount_ex_gst: 600, var_status: 'Approved' },
    { job_id: 'NP-1', amount_ex_gst: 950, var_status: 'Pending' },
  ],
})
ok(withAddOns.addOnsExGST === 600, 'only approved add-ons count — pending is not agreed money')
ok(withAddOns.jobTotalExGST === 10600, 'and they raise the job total')
ok(near(withAddOns.leftToInvoiceIncGST, 11660), 'so there is more left to invoice')

// ── A deposit is not deducted twice ──────────────────────────
// A 20% deposit, invoiced and paid: $2,200 inc GST.
const afterDeposit = invoiceSuggestion({
  job: JOB,
  invoices: [inv({
    id: 'INV-1', agreed_ex_gst: 2000, gst: 200, total_inc_gst: 2200,
    received: 2200, extra: { booking_deposit: true },
  })],
})
ok(afterDeposit.invoiceCount === 1, 'the deposit invoice counts as an invoice')
ok(near(afterDeposit.invoicedIncGST, 2200), 'and as money invoiced')
ok(near(afterDeposit.depositIncGST, 2200), 'it is reported as a deposit')
ok(near(afterDeposit.depositReceivedIncGST, 2200), 'and as a paid one')
ok(near(afterDeposit.leftToInvoiceIncGST, 8800),
  'left to invoice is 11000 less the 2200 deposit — ONCE, not twice')
ok(near(afterDeposit.leftToInvoiceExGST, 8000), 'which is 8000 ex GST')
ok(near(afterDeposit.receivedIncGST, 2200), 'and the deposit shows as received')

// An unpaid deposit still reduces what is left to invoice: it is billed.
const unpaidDeposit = invoiceSuggestion({
  job: JOB,
  invoices: [inv({ id: 'INV-1', agreed_ex_gst: 2000, gst: 200, total_inc_gst: 2200, extra: { booking_deposit: true } })],
})
ok(near(unpaidDeposit.leftToInvoiceIncGST, 8800), 'an unpaid deposit is still invoiced')
ok(unpaidDeposit.depositReceivedIncGST === 0, 'but is not reported as received')
ok(unpaidDeposit.receivedIncGST === 0, 'and nothing has come in')

// ── Progress invoices ────────────────────────────────────────
const partWay = invoiceSuggestion({
  job: JOB,
  invoices: [
    inv({ id: 'A', agreed_ex_gst: 2000, gst: 200, total_inc_gst: 2200, received: 2200, extra: { booking_deposit: true } }),
    inv({ id: 'B', agreed_ex_gst: 4000, gst: 400, total_inc_gst: 4400, received: 0 }),
  ],
})
ok(partWay.invoiceCount === 2 && near(partWay.invoicedIncGST, 6600), 'two invoices, 6600 billed')
ok(near(partWay.depositIncGST, 2200), 'the deposit is still named among them')
ok(near(partWay.leftToInvoiceIncGST, 4400), 'leaving 4400')
ok(near(partWay.receivedIncGST, 2200), 'of which only the deposit is in')

// ── Editing an existing invoice ──────────────────────────────
// Its own amount must not count as already billed.
const editing = invoiceSuggestion({
  job: JOB,
  invoices: [
    inv({ id: 'A', agreed_ex_gst: 2000, gst: 200, total_inc_gst: 2200, received: 2200, extra: { booking_deposit: true } }),
    inv({ id: 'B', agreed_ex_gst: 4000, gst: 400, total_inc_gst: 4400 }),
  ],
  exceptInvoiceId: 'B',
})
ok(editing.invoiceCount === 1, 'the invoice being edited is left out of the count')
ok(near(editing.invoicedIncGST, 2200), 'and out of what is already billed')
ok(near(editing.leftToInvoiceIncGST, 8800),
  'so reopening a 4400 invoice offers 8800, not 4400 — the bug this guards')

// ── Over-billed ──────────────────────────────────────────────
const over = invoiceSuggestion({
  job: JOB,
  invoices: [inv({ id: 'A', agreed_ex_gst: 11000, gst: 1100, total_inc_gst: 12100 })],
})
ok(over.leftToInvoiceIncGST === 0, 'nothing left to invoice when the job is over-billed')
ok(near(over.overBilledIncGST, 1100), 'the excess is reported rather than shown as negative')

// ── A cash job carries no GST ────────────────────────────────
const cash = invoiceSuggestion({ job: { ...JOB, on_books: 'Cash' }, invoices: [] })
ok(cash.gstRate === 0, 'a cash job has no GST rate')
ok(cash.jobTotalIncGST === 10000 && cash.leftToInvoiceExGST === 10000,
  'so its total and its remainder are the same figure')

// ── An hourly job measures what is logged ────────────────────
const hourly = invoiceSuggestion({
  job: { id: 'NP-2', terms: 'Hourly', agreed_ex_gst: 0 },
  invoices: [],
  labour: [{ job_id: 'NP-2', hours: 10, charge_rate: 95, billing_type: 'Hourly' }],
  materials: [{ job_id: 'NP-2', cost_ex_gst: 500, billing_type: 'Hourly' }],
  markupPct: 20,
})
ok(hourly.basis === 'actuals', 'an hourly job measures against what has been logged')
ok(hourly.baseExGST > 0, `and has something to bill (${hourly.baseExGST})`)
ok(near(hourly.leftToInvoiceExGST, hourly.baseExGST), 'all of it, with nothing invoiced yet')

// ── Nothing to go on ─────────────────────────────────────────
const bare = invoiceSuggestion({ job: { id: 'NP-9', terms: 'Fixed Quote' }, invoices: [] })
ok(!bare.hasValue, 'a job with no price has no figure to offer')
ok(bare.jobTotalIncGST === 0 && bare.leftToInvoiceIncGST === 0, 'and offers zero rather than NaN')

// Another job's invoices never count against this one.
const elsewhere = invoiceSuggestion({
  job: JOB,
  invoices: [{ job_id: 'NP-OTHER', agreed_ex_gst: 5000, gst: 500, total_inc_gst: 5500 }],
})
ok(elsewhere.invoiceCount === 0 && near(elsewhere.leftToInvoiceIncGST, 11000),
  "another job's invoices are not this job's")

console.log(fail ? `\n${fail} FAILED` : '\nall passed')
process.exit(fail ? 1 : 0)
