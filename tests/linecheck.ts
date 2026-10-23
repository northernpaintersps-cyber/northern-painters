// Invoice lines written by hand, and add-ons becoming lines.
//
// Two failures matter. One: the stored line and the invoice total disagree,
// which prints a document whose rows do not add up to its own total. Two: an
// add-on gets billed twice because nothing recorded that it was billed once.

import {
  blankLine, lineTotal, linesTotal, toStored, fromStored, isBlank,
  billedVariationIds, jobAddOns, addOnLine, variationIdsOf, addOnsValue,
} from '@/lib/invoiceLines'

let fail = 0
const ok = (c: boolean, m: string) => { if (!c) { fail++; console.log('FAIL', m) } else console.log('ok  ', m) }
const near = (a: number, b: number) => Math.abs(a - b) < 0.005

// ── One line ─────────────────────────────────────────────────
ok(lineTotal({ qty: 1, unitPrice: 4200 }) === 4200, 'one lot at 4200 is 4200')
ok(lineTotal({ qty: 3, unitPrice: 250 }) === 750, 'three at 250 is 750')
// 2.5 x 33.33 is 83.325, and binary floating point holds it a hair under, so
// it rounds down. Asserted as it behaves rather than as it reads: a half cent
// either way on a line is not worth a different rounding rule from the rest
// of the app.
ok(lineTotal({ qty: 2.5, unitPrice: 33.33 }) === 83.32, 'and it rounds to the cent')
ok(lineTotal({ qty: 3, unitPrice: 0.1 }) === 0.3, 'without leaving 0.30000000000000004 on an invoice')
ok(lineTotal({ unitPrice: 100 }) === 100, 'no quantity means one')
ok(lineTotal({}) === 0, 'an empty line is worth nothing')
ok(lineTotal({ qty: 'x', unitPrice: 'y' } as any) === 0, 'and junk is not NaN')

const ids = new Set([blankLine().id, blankLine().id, blankLine().id])
ok(ids.size === 3, 'every new line gets its own id, even made in the same millisecond')

// ── A split invoice ──────────────────────────────────────────
const split = [
  blankLine({ description: 'Interior — ground floor', unitPrice: 4200 }),
  blankLine({ description: 'Deck restoration', unitPrice: 1800 }),
  blankLine({ description: 'Add-on: third coat to hallway', unitPrice: 600, variationId: 'v1' }),
]
ok(linesTotal(split) === 6600, 'three areas priced separately total 6600')

const stored = toStored(split)
ok(stored.length === 3, 'all three are stored')
ok(near(stored.reduce((s, l: any) => s + l.amount, 0), linesTotal(split)),
  'and the stored amounts sum to the invoice total — the document adds up')
ok(stored.every((l: any) => l.amount === l.total_ex_gst),
  'both spellings of the amount agree, since the printed invoice reads one and the total the other')
ok((stored[2] as any).variation_id === 'v1', 'a line from an add-on remembers which one')
ok((stored[0] as any).unit === 'lot', 'a unit defaults rather than printing blank')

// ── Blank lines are dropped, not saved as zeroes ─────────────
const withBlanks = [...split, blankLine(), blankLine({ description: '   ' })]
ok(linesTotal(withBlanks) === 6600, 'an empty row adds nothing to the total')
ok(toStored(withBlanks).length === 3, 'and is not stored')
ok(isBlank(blankLine()) && !isBlank(split[0]), 'blank is no description and no money')
ok(!isBlank(blankLine({ description: '', unitPrice: 50 })), 'a priced row with no description is NOT blank — it would lose money')

// ── Round trip ───────────────────────────────────────────────
const back = fromStored(stored)
ok(back.length === 3 && linesTotal(back) === 6600, 'reopening an invoice restores the same total')
ok(back[0].description === 'Interior — ground floor', 'and the descriptions')
ok(back[2].variationId === 'v1', 'and which line was an add-on')

// Older data: only a total, under any of the spellings the app has used.
ok(near(linesTotal(fromStored([{ description: 'x', total_ex_gst: 500 }])), 500), 'total_ex_gst alone works')
ok(near(linesTotal(fromStored([{ desc: 'x', totalExGST: 500 }])), 500), 'the V16 spellings work')
ok(near(fromStored([{ description: 'x', qty: 4, amount: 400 }])[0].unitPrice, 100),
  'a line with a quantity and a total gets its unit price derived back')
ok(fromStored(null).length === 0 && fromStored('nope' as any).length === 0, 'junk gives no lines')

// ── Add-ons ──────────────────────────────────────────────────
const VARS = [
  { id: 'v1', job_id: 'NP-1', var_desc: 'Third coat to hallway', amount_ex_gst: 600, var_status: 'Approved', date: '2026-10-02' },
  { id: 'v2', job_id: 'NP-1', var_desc: 'Paint the laundry', amount_ex_gst: 950, var_status: 'Pending', date: '2026-10-09' },
  { id: 'v3', job_id: 'NP-1', var_desc: 'Gate', amount_ex_gst: 300, var_status: 'Approved', date: '2026-10-01' },
  { id: 'v9', job_id: 'NP-2', var_desc: 'Other job', amount_ex_gst: 100, var_status: 'Approved', date: '2026-10-01' },
]
const INVS = [
  { id: 'INV-1', extra: { billed_variations: ['v3'] } },
  { id: 'INV-2', extra: {} },
]

const list = jobAddOns(VARS, 'NP-1', INVS)
ok(list.length === 3, "only this job's add-ons")
ok(list[0].id === 'v3', 'oldest first')
ok(list.find(a => a.id === 'v3')!.billed, 'the one already on an invoice is flagged billed')
ok(!list.find(a => a.id === 'v1')!.billed, 'and the others are not')
ok(list.find(a => a.id === 'v2')!.approved === false, 'a pending add-on is listed and flagged, not hidden')
ok(addOnsValue(list) === 900, 'approved add-ons come to 900 — the pending one is not agreed money')

// Editing the invoice that billed it must not call it billed elsewhere.
const whileEditing = jobAddOns(VARS, 'NP-1', INVS, 'INV-1')
ok(!whileEditing.find(a => a.id === 'v3')!.billed,
  'reopening the invoice that charged it does not report it as billed on another')

ok(billedVariationIds([{ extra: { line_items: [{ variation_id: 'v7' }] } }]).has('v7'),
  'a line carrying its origin is enough, even if the id list is lost')
ok(billedVariationIds([]).size === 0, 'no invoices, nothing billed')
ok(billedVariationIds([{ extra: null }, {}, { extra: { billed_variations: 'nope' } }]).size === 0,
  'and malformed invoices do not throw')

// ── An add-on onto an invoice ────────────────────────────────
const line = addOnLine(list.find(a => a.id === 'v1')!)
ok(line.description === 'Third coat to hallway' && line.unitPrice === 600 && line.qty === 1,
  'it arrives as a one-lot line at its own price')
ok(line.variationId === 'v1', 'tagged with where it came from')
ok(variationIdsOf([line, blankLine({ description: 'Interior', unitPrice: 10 })]).join() === 'v1',
  'and only the add-on lines are recorded against the invoice')
ok(variationIdsOf([line, { ...line, id: 'other' }]).length === 1,
  'the same add-on twice is recorded once')
ok(variationIdsOf([{ ...blankLine(), variationId: 'v5' }]).length === 0,
  'an add-on line emptied out is not recorded as billed')

const unnamed = jobAddOns([{ id: 'v', job_id: 'J', amount_ex_gst: 50 }], 'J', [])
ok(unnamed[0].description === 'Additional work', 'an add-on with no description still prints as something')
ok(unnamed[0].approved === false, 'and with no status is not approved')

console.log(fail ? `\n${fail} FAILED` : '\nall passed')
process.exit(fail ? 1 : 0)
