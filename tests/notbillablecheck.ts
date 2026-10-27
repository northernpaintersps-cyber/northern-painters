// Work the client is never charged for.
//
// Coming back to fix a defect costs real labour and real paint. That cost
// belongs on the job — it is exactly what you want to see when you ask
// whether the job made money. What it must not do is sit in "left to
// invoice", waiting to be billed to somebody who will never pay it.
//
// So: cost yes, margin yes, revenue no, invoice never.

import {
  NOT_BILLABLE, ENTRY_BILLING_TYPES, BILLING_TYPES, isNotBillable,
  isBillableLabour, isBillableMaterial, labCost, matCost,
} from '@/lib/utils'
import { computeJobBilling, invoiceableLines, jobProfit } from '@/lib/jobBilling'

let fail = 0
const ok = (c: boolean, m: string) => { if (!c) { fail++; console.log('FAIL', m) } else console.log('ok  ', m) }
const near = (a: number | null, b: number) => a !== null && Math.abs(a - b) < 0.02

const MARKUP = 20
const JOB = { id: 'J', client: 'Smith', terms: 'Hourly rate', agreed_ex_gst: 0 }

const BILLED = { id: 'l1', job_id: 'J', date: '2026-10-19', sub: 'Francisco', hours: 8,
  rate: 65, charge_rate: 95, cost: 520, billable: 760, billing_type: 'Hourly' }
// The defect: a day going back to make good, at your expense.
const DEFECT = { id: 'l2', job_id: 'J', date: '2026-10-26', sub: 'Francisco', hours: 8,
  rate: 65, charge_rate: 95, cost: 520, billable: 760, billing_type: NOT_BILLABLE }
const PAINT = { id: 'm1', job_id: 'J', date: '2026-10-19', cost_ex_gst: 400, billing_type: 'Hourly' }
const REDO_PAINT = { id: 'm2', job_id: 'J', date: '2026-10-26', cost_ex_gst: 150, billing_type: NOT_BILLABLE }

const LABOUR = [BILLED, DEFECT]
const MATERIALS = [PAINT, REDO_PAINT]

// ── The value ────────────────────────────────────────────────
ok(ENTRY_BILLING_TYPES.includes(NOT_BILLABLE as any), 'an entry can be marked not billable')
ok(!(BILLING_TYPES as readonly string[]).includes(NOT_BILLABLE),
  'but a JOB cannot be — it is a way of not charging, not a way of charging')
ok(isNotBillable(DEFECT) && !isNotBillable(BILLED), 'the test reads the entry')
ok(!isBillableLabour(DEFECT), 'so the existing billable test excludes it')
ok(!isBillableMaterial(REDO_PAINT), 'and the same for materials — no new rule threaded anywhere')

// ── The cost still counts ────────────────────────────────────
ok(labCost(DEFECT) === 520, 'the defect day cost what it cost')
ok(matCost(REDO_PAINT) === 150, 'and so did the paint')

const money = jobProfit({ job: JOB, labour: LABOUR, materials: MATERIALS, markupPct: MARKUP })
ok(near(money.costExGST, 520 + 520 + 400 + 150), 'every dollar spent is in the cost: 1590')
ok(near(money.revenueExGST, 760 + 480), 'but only the billable work is in the revenue: 1240')
ok(money.grossProfit < 0, 'which on this job means it is losing money, and says so')
ok(near(money.margin, ((1240 - 1590) / 1240) * 100), 'with the margin to match')

// Without the defect it is a healthy job — the comparison the flag is for.
const clean = jobProfit({ job: JOB, labour: [BILLED], materials: [PAINT], markupPct: MARKUP })
ok(clean.grossProfit > 0 && money.grossProfit < clean.grossProfit,
  'the defect is what turned a profitable job into a loss, which is the point of logging it')
ok(near(clean.grossProfit - money.grossProfit, 670), 'and it cost exactly the 670 it cost')

// ── It is never waiting to be invoiced ───────────────────────
const b = computeJobBilling({ job: JOB, invoices: [], labour: LABOUR, materials: MATERIALS, markupPct: MARKUP })
ok(near(b.billableToDateExGST, 1240), 'the job is worth only what can be charged')
ok(b.unbilled.labourCount === 1 && b.unbilled.materialCount === 1,
  'one labour line and one material are waiting to be billed — not the defect')
ok(near(b.unbilled.valueExGST, 1240), 'and the left-to-invoice figure holds none of it')

// ── The invoice picker must not offer it ─────────────────────
const pickable = invoiceableLines({ job: JOB, invoices: [], labour: LABOUR, materials: MATERIALS, markupPct: MARKUP })
ok(pickable.length === 2, 'the picker shows two lines, not four')
ok(!pickable.some(l => l.id === 'l2' || l.id === 'm2'),
  'a line you cannot charge for has no business being tickable')

// ── The job page must still show it ──────────────────────────
const all = invoiceableLines({
  job: JOB, invoices: [], labour: LABOUR, materials: MATERIALS, markupPct: MARKUP,
  includeUnbillable: true,
})
ok(all.length === 4, 'asked for everything, the page gets all four')
const defectLine = all.find(l => l.id === 'l2')!
ok(defectLine.notBillable === true, 'the defect is flagged')
ok(defectLine.amountExGST === 0, 'with nothing in the charge column')
ok(defectLine.hours === 8, 'but its hours intact, because they were worked')
ok(all.filter(l => !l.notBillable).reduce((s, l) => s + l.amountExGST, 0) === 1240,
  'and the chargeable lines still total what the job is worth')

// On a fixed job everything is unbillable, and asking for the lot shows it.
const FIXED = { id: 'J', client: 'Smith', terms: 'Fixed Quote', agreed_ex_gst: 9000 }
const fixedLines = invoiceableLines({
  job: FIXED, invoices: [],
  labour: LABOUR.map(l => ({ ...l, billing_type: 'Fixed Quote' })),
  materials: MATERIALS.map(m => ({ ...m, billing_type: 'Fixed Quote' })),
  includeUnbillable: true,
})
ok(fixedLines.length === 4 && fixedLines.every(l => l.notBillable),
  'a fixed job shows its work too, all of it covered by the agreed price')
ok(invoiceableLines({
  job: FIXED, invoices: [],
  labour: LABOUR.map(l => ({ ...l, billing_type: 'Fixed Quote' })),
  materials: MATERIALS.map(m => ({ ...m, billing_type: 'Fixed Quote' })),
}).length === 0, 'while the picker on a fixed job offers nothing, as before')
// An entry marked Hourly ON a fixed job is still billable, which is how
// extra work outside the contract gets charged. Not billable is the way to
// say the other thing.
ok(invoiceableLines({ job: FIXED, invoices: [], labour: [BILLED], materials: [] }).length === 1,
  'an hourly entry on a fixed job is chargeable, as it always was')
ok(invoiceableLines({ job: FIXED, invoices: [], labour: [DEFECT], materials: [] }).length === 0,
  'and marking one not billable is how you say it is not')

console.log(fail ? `\n${fail} FAILED` : '\nall passed')
process.exit(fail ? 1 : 0)
