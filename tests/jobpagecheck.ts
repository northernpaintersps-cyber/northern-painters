// The job page: what is billed, what is left, and cost never read as charge.
//
// The page shows "left to invoice" twice — once as a headline figure from
// computeJobBilling, once as the footer of a table built from
// invoiceableLines. Two routes to one number is two chances to disagree,
// and a page that contradicts itself is worse than one that says nothing.
//
// The other half is the distinction the page exists to make: what a line
// COST you and what the client is CHARGED for it are different numbers that
// must never be summed together.

import {
  computeJobBilling, invoiceableLines, unbilledSummary, billingBreakdown,
} from '@/lib/jobBilling'
import { labCost } from '@/lib/utils'
import * as fs from 'fs'

let fail = 0
const ok = (c: boolean, m: string) => { if (!c) { fail++; console.log('FAIL', m) } else console.log('ok  ', m) }
const near = (a: number, b: number) => Math.abs(a - b) < 0.02

const MARKUP = 20

// An hourly job: two days logged, one of them already invoiced.
const JOB = { id: 'NP-1', client: 'Smith', terms: 'Hourly rate', agreed_ex_gst: 0 }
const LABOUR = [
  { id: 'l1', job_id: 'NP-1', date: '2026-10-19', sub: 'Francisco', hours: 8,
    rate: 65, charge_rate: 95, cost: 520, billable: 760, billing_type: 'Hourly' },
  { id: 'l2', job_id: 'NP-1', date: '2026-10-20', sub: 'Jake', hours: 8,
    rate: 55, charge_rate: 85, cost: 440, billable: 680, billing_type: 'Hourly' },
]
const MATERIALS = [
  { id: 'm1', job_id: 'NP-1', date: '2026-10-19', supplier: 'Inspirations',
    cost_ex_gst: 300, billing_type: 'Hourly' },
]
// The first day's labour is on an invoice; nothing else is.
const INVOICES = [
  { id: 'INV-1', job_id: 'NP-1', date: '2026-10-21', agreed_ex_gst: 760, gst: 76,
    total_inc_gst: 836, received: 836,
    extra: { billed_labour: ['l1'], billed_materials: [] } },
]

const b = computeJobBilling({ job: JOB, invoices: INVOICES, labour: LABOUR, materials: MATERIALS, markupPct: MARKUP })
const lines = invoiceableLines({ job: JOB, invoices: INVOICES, labour: LABOUR, materials: MATERIALS, markupPct: MARKUP })

// ── Every logged line is accounted for ───────────────────────
ok(lines.length === 3, 'every logged line appears — two labour, one material')
ok(lines.filter(l => l.billed).length === 1, 'one of them is already invoiced')
ok(lines.find(l => l.id === 'l1')?.billedOn === 'INV-1',
  'and it names the invoice that took it, so you can go and look')
ok(lines.filter(l => !l.billed).length === 2, 'two are still to bill')

// ── The headline and the table footer must agree ─────────────
const leftFromTable = lines.filter(l => !l.billed).reduce((s, l) => s + l.amountExGST, 0)
ok(near(leftFromTable, b.unbilled.valueExGST),
  'the table footer and the headline "left to invoice" are the same number')
ok(near(leftFromTable, 680 + 360),
  'which is the uninvoiced labour at its charge rate plus the material with markup')
ok(b.unbilled.labourCount === 1 && b.unbilled.materialCount === 1,
  'and the counts match what the table shows')

// ── Cost is not charge ───────────────────────────────────────
const l2 = lines.find(l => l.id === 'l2')!
const l2cost = labCost(LABOUR[1])
ok(l2cost === 440 && near(l2.amountExGST, 680),
  'a labour line costs 440 and is charged at 680 — two numbers, not one')
ok(l2cost < l2.amountExGST, 'and the charge is the larger, which is the whole business model')

const m1 = lines.find(l => l.kind === 'material')!
ok(near(m1.amountExGST, 360), 'a material at 300 is charged at 360 with 20% markup')
ok(m1.amountExGST !== MATERIALS[0].cost_ex_gst, 'so its cost and its charge differ too')

const totalCost = LABOUR.reduce((s, l) => s + labCost(l), 0)
  + MATERIALS.reduce((s, m) => s + (m.cost_ex_gst || 0), 0)
const totalCharge = lines.reduce((s, l) => s + l.amountExGST, 0)
ok(near(totalCost, 1260), 'total cost of the job so far')
ok(near(totalCharge, 1800), 'total charge for the same work')
ok(near(totalCharge - totalCost, 540),
  'and the gap between them is the gross profit the page shows — never a sum of the two')

// ── A fixed-price job values itself differently ──────────────
const FIXED = { id: 'NP-2', client: 'Jones', terms: 'Fixed Quote', agreed_ex_gst: 10000 }
const fb = computeJobBilling({
  job: FIXED, invoices: [], markupPct: MARKUP,
  labour: LABOUR.map(l => ({ ...l, job_id: 'NP-2', billing_type: 'Fixed Quote' })),
  materials: MATERIALS.map(m => ({ ...m, job_id: 'NP-2', billing_type: 'Fixed Quote' })),
})
ok(fb.basis === 'fixed' && near(fb.billableToDateExGST, 10000),
  'a fixed job is worth its agreed price, whatever has been logged')
ok(fb.unbilled.labourCount === 0 && fb.unbilled.valueExGST === 0,
  'and none of its logged work is "left to invoice" — the price covers it')
ok(billingBreakdown(fb) === '', 'the actuals breakdown is empty on a fixed job')
ok(unbilledSummary(fb) === '', 'and so is the unbilled note')

// ── The page reads from those, rather than working it out ────
const page = fs.readFileSync('src/pages/JobDashboard.tsx', 'utf8')
ok(/computeJobBilling/.test(page) && /invoiceableLines/.test(page),
  'the page uses the shared billing, so it cannot drift from the invoice screen')
ok(/labCost/.test(page), 'and the shared cost helper')
ok(/const COST = /.test(page) && /const CHARGE = /.test(page),
  'cost and charge have their own colours, defined once')
ok(/Cost<\/b> is what you paid/.test(page), 'and the table says which is which in words')
ok(!/billable \+ cost|cost \+ billable/i.test(page),
  'nowhere does it add a cost to a charge')

const routes = fs.readFileSync('src/App.tsx', 'utf8')
ok(/path="\/jobs\/:id"/.test(routes), 'the page is routed at /jobs/:id')

console.log(fail ? `\n${fail} FAILED` : '\nall passed')
process.exit(fail ? 1 : 0)
