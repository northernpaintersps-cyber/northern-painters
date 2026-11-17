// The breakdown you hand a client.
//
// Three things must hold, and the first is the reason this file exists:
//
//   1. No cost figure reaches the document. Cost beside charge is the margin,
//      and the margin is not the client's to read.
//   2. No subcontractor is named unless the full log was asked for. Who you
//      engage is commercially yours, and invoiceableLines puts `sub` in the
//      description, so the scrub has to be deliberate in both directions.
//   3. The totals multiply out. A client who divides the total by the hours
//      and gets a different rate to the one printed will ring back about it.

import {
  clientLines, selected, breakdownTotals, groupLabourByPhase, groupUnchargedByPhase,
  ratePerHour,
  labourDescription, materialDescription, buildBreakdownText, buildBreakdownHTML,
} from '@/lib/clientBreakdown'
import { invoiceableLines } from '@/lib/jobBilling'
import * as fs from 'fs'

let fail = 0
const ok = (c: boolean, m: string) => { if (!c) { fail++; console.log('FAIL', m) } else console.log('ok  ', m) }
const near = (a: number, b: number, tol = 0.02) => Math.abs(a - b) < tol

// A job with a subcontractor on it, a defect made good for nothing, and
// materials bought at cost and charged with markup.
const job = { id: 'NP-0093', client: 'JHT Built', address: '12 Bay St', on_books: 'Yes' }
const labour = [
  { id: 'L1', job_id: 'NP-0093', date: '2026-03-02', sub: 'Francisco Rojas', billing_type: 'Hourly',
    labour_desc: 'cutting in', phase_name: 'Preparation', hours: 8, cost: 400, billable: 520 },
  { id: 'L2', job_id: 'NP-0093', date: '2026-03-03', sub: 'Francisco Rojas', billing_type: 'Hourly',
    labour_desc: '', phase_name: 'Preparation', hours: 6, cost: 300, billable: 390 },
  { id: 'L3', job_id: 'NP-0093', date: '2026-03-05', sub: 'Juan Cabe', billing_type: 'Hourly',
    labour_desc: 'rolling', phase_name: 'First coat', hours: 10, cost: 500, billable: 650 },
  // Came back to fix a run. Cost you; charged to nobody.
  { id: 'L4', job_id: 'NP-0093', date: '2026-03-09', sub: 'Juan Cabe',
    labour_desc: 'make good', phase_name: 'Second coat', hours: 4, cost: 200,
    billing_type: 'Not billable' },
]
const materials = [
  { id: 'M1', job_id: 'NP-0093', date: '2026-03-01', supplier: 'Dulux Trade Ballina',
    billing_type: 'Hourly', mat_desc: 'Weathershield low sheen 15L x2', cost_ex_gst: 400 },
  { id: 'M2', job_id: 'NP-0093', date: '2026-03-04', supplier: 'Bunnings',
    billing_type: 'Hourly', mat_desc: 'Masking and drop sheets', cost_ex_gst: 100 },
]
const lines = invoiceableLines({
  job, invoices: [], labour, materials, markupPct: 20, includeUnbillable: true,
})

// ── 1. The cost never gets out ───────────────────────────────
// Comments are stripped first: this file's own prose names the forbidden
// helpers in order to explain why they are forbidden.
const src = fs.readFileSync('src/lib/clientBreakdown.ts', 'utf8')
  .replace(/^\s*\/\/.*$/gm, '')
ok(!/\blabCost\b/.test(src), 'the breakdown never reaches for labCost')
ok(!/\bmatCost\b/.test(src), 'nor for matCost')
ok(!/\blineCost\b/.test(src), 'nor for lineCost')
ok(!/cost_ex_gst/.test(src), 'and never reads a cost column off a row')
ok(!/\bcost\b\s*[:.]/.test(src), 'and no code path reads a `cost` field')

const rows = clientLines({ lines, labour, materials })
const amounts = rows.map(r => r.chargeExGST)
// The charges are 520 / 390 / 650 and 480 / 120. The costs are 400 / 300 /
// 500 / 200 and 400 / 100. Not one cost figure may appear.
for (const cost of [400, 300, 500, 200, 100]) {
  ok(!amounts.includes(cost), `no line is charged at the cost figure ${cost}`)
}
ok(amounts.includes(520) && amounts.includes(650), 'the charge figures are the ones carried')
ok(amounts.includes(480), 'materials carry cost plus markup, 400 + 20% = 480')

const text = buildBreakdownText(rows, { gstRate: 0.1 })
const html = buildBreakdownHTML(rows, { gstRate: 0.1 })
for (const doc of [['text', text], ['HTML', html]] as [string, string][]) {
  ok(!/\$400\.00/.test(doc[1]), `the ${doc[0]} never prints the $400 cost of the paint`)
  ok(!/markup/i.test(doc[1]), `the ${doc[0]} never mentions markup`)
  ok(!/\bcost\b/i.test(doc[1]), `the ${doc[0]} never uses the word cost`)
}

// ── 2. Nobody is named unless you ask ────────────────────────
ok(labourDescription(labour[0]) === 'Preparation — cutting in',
  'labour reads as its phase and what was done')
ok(!labourDescription(labour[0]).includes('Francisco'),
  'and by default does not name the subcontractor who did it')
ok(labourDescription(labour[1]) === 'Preparation',
  'a row with no note reads as the phase alone')
ok(labourDescription({ phase_name: 'Prep', labour_desc: 'prep' }) === 'Prep',
  'a note repeating the phase is not printed twice')
ok(labourDescription({}) === 'Painting labour', 'and an untagged hour still describes itself')

for (const name of ['Francisco', 'Rojas', 'Juan', 'Cabe']) {
  ok(!text.includes(name), `the text names no ${name}`)
  ok(!html.includes(name), `the HTML names no ${name}`)
  ok(!rows.some(r => r.description.includes(name)), `no row description names ${name}`)
}
// invoiceableLines really does carry the name, so the scrub is doing work
// rather than passing by luck.
ok(lines.some(l => l.description.includes('Francisco')),
  'the internal line really does carry the subcontractor — the scrub is load-bearing')

// ── The full log, when the client asks for it ───────────────
ok(labourDescription(labour[0], 'full') === 'Francisco Rojas — Preparation — cutting in',
  'the full log leads with who did the work')
ok(labourDescription(labour[0], 'entries') === 'Preparation — cutting in',
  'every-entry still describes the task without the name')
ok(labourDescription({ phase_name: 'Prep' }, 'full') === 'Prep',
  'and a row with nobody logged against it does not grow a dash')

const full = clientLines({ lines, labour, materials, labourDetail: 'full' })
ok(full.filter(r => r.kind === 'labour').every(r => /Rojas|Cabe/.test(r.description)),
  'every labour line in the full log names its worker')
const fullText = buildBreakdownText(full, { labourDetail: 'full', gstRate: 0.1 })
ok(fullText.includes('Francisco Rojas — Preparation — cutting in'),
  'the full log prints the name, the phase and the task')
ok(/02\/03\/2026/.test(fullText), 'with the date it was logged')
ok(fullText.includes('Juan Cabe'), 'and every worker on the job')
ok(!fullText.includes('make good'),
  'the full log is still the full CHARGEABLE log — the defect fixed for nothing stays out')
// The full log is per entry by definition: grouping would throw the names away.
ok(!/Preparation — 14 hrs/.test(fullText), 'and it is never collapsed to one row per phase')
ok((fullText.match(/Rojas/g) ?? []).length === 2, 'both of Francisco\'s days are listed')

// Cost still never gets out, however much detail was asked for.
const fullHtml = buildBreakdownHTML(full, { labourDetail: 'full', gstRate: 0.1 })
ok(!/\bcost\b/i.test(fullHtml), 'the full log still prints no cost')
ok(!/\$400\.00/.test(fullHtml), 'nor the figure the paint cost')
ok(!/\$500\.00/.test(fullHtml), 'nor what the labour cost')
ok(near(breakdownTotals(full, 0.1).exGST, 2160), 'and it comes to the same money as the summary')

// Suppliers are yours too, until you say otherwise.
ok(materialDescription(materials[0]) === 'Weathershield low sheen 15L x2',
  'materials read as the product')
ok(materialDescription(materials[0], true) === 'Dulux Trade Ballina — Weathershield low sheen 15L x2',
  'and name the supplier only when asked to')
ok(!text.includes('Bunnings'), 'so the default document names no supplier')

// ── 3. Work nobody is charged for is left out ────────────────
ok(rows.length === 5, 'five chargeable entries of the six logged')
ok(!rows.some(r => r.id === 'L4'), 'the defect made good is not in the client list')
ok(!text.includes('make good'), 'nor in the text')
ok(lines.some(l => l.id === 'L4'), 'though it is still on the job page, where it belongs')

// ── The figures ──────────────────────────────────────────────
const t = breakdownTotals(rows, 0.1)
ok(near(t.labourHours, 24), '24 chargeable hours — the 4 not billable are not counted')
ok(near(t.labourExGST, 1560), 'labour 520 + 390 + 650 = 1,560')
ok(near(t.materialsExGST, 600), 'materials 480 + 120 = 600')
ok(near(t.exGST, 2160), 'and 2,160 ex GST between them')
ok(near(t.gst, 216), 'GST at 10%')
ok(near(t.incGST, 2376), 'and 2,376 inc')

// A cash job has no GST to print.
const cash = breakdownTotals(rows, 0)
ok(near(cash.gst, 0) && near(cash.incGST, cash.exGST), 'at a zero rate there is no GST line')
// Matched at the start of a line, because "Total ex GST:" contains "GST:".
ok(!/^GST: /m.test(buildBreakdownText(rows, { gstRate: 0 })),
  'and the cash document does not print one')
ok(/^GST: /m.test(buildBreakdownText(rows, { gstRate: 0.1 })),
  'while the GST one does')
ok(!/inc GST/.test(buildBreakdownText(rows, { gstRate: 0 })),
  'nor an inc-GST total on a job that has no GST')

// ── Picking entries ─────────────────────────────────────────
ok(selected(rows, new Set()).length === 5, 'nothing ticked means the whole list')
ok(selected(rows, null).length === 5, 'and so does no selection at all')
const two = selected(rows, new Set(['L1', 'M1']))
ok(two.length === 2, 'two ticked gives two')
ok(near(breakdownTotals(two, 0.1).exGST, 1000), 'and totals just those: 520 + 480')

ok(clientLines({ lines, labour, materials, kind: 'labour' }).every(r => r.kind === 'labour'),
  'labour only means labour only')
ok(clientLines({ lines, labour, materials, kind: 'labour' }).length === 3, 'three labour entries')
ok(clientLines({ lines, labour, materials, kind: 'materials' }).length === 2, 'and two material ones')
ok(clientLines({ lines, labour, materials, kind: 'materials' })
  .every(r => r.kind === 'material'), 'materials only means materials only')
// A materials-only breakdown must not print a labour heading or an hours total.
const matOnly = buildBreakdownText(clientLines({ lines, labour, materials, kind: 'materials' }), {})
ok(!matOnly.includes('LABOUR'), 'a materials-only list has no labour section')
ok(matOnly.includes('MATERIALS'), 'and does have a materials one')

// ── Grouping by phase ───────────────────────────────────────
const g = groupLabourByPhase(rows)
ok(g.length === 2, 'two phases worked, not three — the unbilled one is gone')
ok(g[0].name === 'Preparation' && near(g[0].hours, 14) && near(g[0].chargeExGST, 910),
  'preparation gathers 8 + 6 hours and 520 + 390')
ok(g[1].name === 'First coat' && near(g[1].hours, 10), 'first coat keeps its own 10')
ok(near(g.reduce((s, x) => s + x.chargeExGST, 0), t.labourExGST),
  'and the phases still add to the labour total')
// Grouping must not change the money, only how it reads.
ok(buildBreakdownText(rows, { labourDetail: 'phase' }).includes('Preparation — 14 hrs'),
  'by phase reads one row per phase')
ok(buildBreakdownText(rows, { labourDetail: 'entries' }).includes('Preparation — cutting in'),
  'and every-entry keeps each day')
ok(buildBreakdownText(rows, {}).includes('Preparation — 14 hrs'),
  'by phase is the default when nothing is said')

// ── The rate, when you choose to show it ────────────────────
ok(ratePerHour(910, 14) === 65, '910 over 14 hours is $65/hr')
ok(ratePerHour(520, 0) === null, 'no hours means no rate rather than a divide by zero')
ok(ratePerHour(520, undefined) === null, 'and so does a missing figure')
ok(!buildBreakdownText(rows, { showRate: false }).includes('/hr'),
  'the rate is off by default — it is your rate card, in writing, in their hands')
ok(buildBreakdownText(rows, { showRate: true }).includes('$65.00/hr'),
  'and on when you ask for it')
// The rate shown must be the one that multiplies out, not the logged rate.
const override = invoiceableLines({ job, invoices: [], labour, materials, rateOverride: 80 })
const oRows = clientLines({ lines: override, labour, materials, kind: 'labour' })
ok(ratePerHour(oRows[0].chargeExGST, oRows[0].hours) === 80,
  'billed at an agreed rate, the breakdown shows that rate, not what was logged')

// ── Work that carries no charge, when you want it shown ─────
const withFree = clientLines({ lines, labour, materials, includeUncharged: true })
ok(withFree.length === 6, 'all six entries appear once uncharged work is included')
const free = withFree.find(r => r.id === 'L4')!
ok(!!free, 'the defect made good is one of them')
ok(free.basis === 'no-charge', 'and is marked as carrying no charge')
ok(free.chargeExGST === 0, 'with nothing charged for it')
ok(withFree.filter(r => r.basis === 'charged').length === 5, 'the other five are charged')
ok(rows.every(r => r.basis === 'charged'), 'while the default list is charged work only')

// The money must not move, and nor must the rate.
const tf = breakdownTotals(withFree, 0.1)
ok(near(tf.exGST, 2160), 'including free work changes no figure')
ok(near(tf.labourHours, 24), 'the chargeable hours are still 24, not 28')
ok(near(tf.unchargedHours, 4), 'the 4 unpaid hours are counted separately')
ok(tf.uncharged === 1 && !tf.allUncharged, 'one entry carries no charge, and not all of them')
// This is the whole reason the hours are kept apart: 2177.50/33.5 would read
// as $65, but 910/18 would read as $50.55 — a rate you do not charge.
const gf = groupLabourByPhase(withFree)
ok(gf.length === 2, 'the unpaid phase does not become a phase group of its own')
ok(near(gf[0].hours, 14) && ratePerHour(gf[0].chargeExGST, gf[0].hours) === 65,
  'and preparation still works out at $65/hr, not a diluted rate')

const freeText = buildBreakdownText(withFree, { gstRate: 0.1, labourDetail: 'entries' })
ok(freeText.includes('make good'), 'the free work is listed')
ok(/make good.*no charge/.test(freeText), 'and reads "no charge"')
ok(!/make good.*\$0\.00/.test(freeText),
  'never $0.00 — that says the work was worthless, not that it was free')
ok(/Total ex GST: \$2,160\.00/.test(freeText), 'and the total is unchanged')
ok(/carries no charge/.test(freeText), 'with a line saying an entry carried no charge')

const freeHtml = buildBreakdownHTML(withFree, { gstRate: 0.1, labourDetail: 'entries' })
ok(/No charge/.test(freeHtml), 'the page says No charge')
ok(/no cost to you/.test(freeHtml), 'and explains what that means')
ok(!/\bcost\b/i.test(freeHtml.replace(/no cost to you/g, '')),
  'and still prints no cost of yours anywhere else')

// ── A fixed-quote job ───────────────────────────────────────
// Every line is covered by the agreed price, so every line is 'included'.
const fixedJob = { id: 'NP-0101', client: 'Private', terms: 'Fixed Quote', on_books: 'Yes' }
const fixedLabour = labour.slice(0, 3).map(l => ({ ...l, job_id: 'NP-0101', billing_type: 'Fixed Quote' }))
const fixedMats = materials.map(m => ({ ...m, job_id: 'NP-0101', billing_type: 'Fixed Quote' }))
const fixedLines = invoiceableLines({
  job: fixedJob, invoices: [], labour: fixedLabour, materials: fixedMats,
  markupPct: 20, includeUnbillable: true,
})
const fx = clientLines({
  lines: fixedLines, labour: fixedLabour, materials: fixedMats, includeUncharged: true,
})
ok(fx.length === 5, 'the fixed job still lists all its work')
ok(fx.every(r => r.basis === 'included'), 'and every line is covered by the price')
const tx = breakdownTotals(fx, 0.1)
ok(tx.allUncharged, 'nothing is charged line by line')
ok(near(tx.exGST, 0) && near(tx.labourHours, 0), 'so there is no line-by-line money')
ok(near(tx.unchargedHours, 24), 'though the hours are all still there to show')

// Uncharged work groups by phase too, or a fixed job reads "Preparation"
// once per day logged instead of once per phase.
const fg = groupUnchargedByPhase(fx)
ok(fg.length === 2, 'the fixed job groups its three labour days into two phases')
ok(fg[0].name === 'Preparation' && near(fg[0].hours, 14), 'preparation gathers both its days')
ok(fg.every(g => g.basis === 'included'), 'and every group is labelled as included')

const fxText = buildBreakdownText(fx, { gstRate: 0.1, agreedExGST: 20000 })
ok((fxText.match(/Preparation/g) ?? []).length === 1,
  'so Preparation appears once, not once per day')

// A phase that is part charged and part not must not become one mislabelled
// row — it splits, so each half carries a label that is true of it.
const mixed = clientLines({ lines, labour, materials, includeUncharged: true })
const mg = [...groupLabourByPhase(mixed), ...groupUnchargedByPhase(mixed)]
ok(mg.every(g => mixed.filter(r => (r.phase || r.description) === g.name && r.basis === g.basis)
  .length > 0), 'every group matches rows that really do share its basis')
ok(groupUnchargedByPhase(mixed).every(g => g.chargeExGST === 0),
  'and an uncharged group carries no money')
ok(fxText.includes('Agreed price ex GST: $20,000.00'), 'the document prints the agreed price')
ok(fxText.includes('Agreed price inc GST: $22,000.00'), 'and what that is with GST')
ok(!/Total ex GST/.test(fxText),
  'and never a total of nil — adding nothing to nothing is not the answer')
ok(fxText.includes('included'), 'each line reads as included in the price')
ok(!fxText.includes('$0.00'), 'and no line is priced at nothing')
ok(buildBreakdownText(fx, {}).includes('covered by the agreed price'),
  'with no price to hand, it says so in words rather than printing nil')

const fxHtml = buildBreakdownHTML(fx, { gstRate: 0.1, agreedExGST: 20000 })
ok(/Agreed price inc GST/.test(fxHtml), 'the page prints the agreed price too')
ok(!/Total inc GST/.test(fxHtml), 'and not a total of nil')
ok(/Included/.test(fxHtml), 'with each line marked Included')
ok(/33\.5|24 hours/.test(fxHtml), 'and the hours still reported')
ok(!/\$400\.00/.test(fxHtml) && !/\bcost\b/i.test(fxHtml),
  'and no cost of yours on a fixed job either')

// ── The subtotal row has to span the table it sits in ───────
// A colspan that disagrees with the header count puts the subtotal figure
// under the wrong heading, which on a document about money is not cosmetic.
function columnsAgree(doc: string): boolean {
  const tables = doc.match(/<table>[\s\S]*?<\/table>/g) ?? []
  if (!tables.length) return false
  return tables.every(tbl => {
    const heads = (tbl.match(/<th\b/g) ?? []).length
    const sub = /<tr class="sub"><td colspan="(\d+)"/.exec(tbl)
    // colspan covers every column but the amount, which is its own cell.
    return !!sub && Number(sub[1]) + 1 === heads
  })
}
for (const o of [
  { labourDetail: 'phase' as const, showRate: true, showDates: true },
  { labourDetail: 'phase' as const, showRate: false, showDates: true },
  { labourDetail: 'entries' as const, showRate: true, showDates: true },
  { labourDetail: 'entries' as const, showRate: false, showDates: false },
  { labourDetail: 'full' as const, showRate: true, showDates: false },
  { labourDetail: 'full' as const, showRate: false, showDates: true },
]) {
  ok(columnsAgree(buildBreakdownHTML(rows, o)),
    `subtotal spans the table — ${o.labourDetail} rate:${o.showRate} dates:${o.showDates}`)
}

// ── The document says what it is ────────────────────────────
ok(/not a tax invoice/i.test(html),
  'the page says it is not a tax invoice, so nobody tries to pay it')
ok(/Breakdown of Works/i.test(html), 'and is headed as a breakdown')
ok(buildBreakdownText([], {}) === 'Nothing selected.', 'an empty list says so plainly')
ok(/Nothing selected/.test(buildBreakdownHTML([], {})), 'and so does the page')

// Escaping, because a client name or a product can carry an angle bracket.
const nastyHtml = buildBreakdownHTML(
  clientLines({ lines, labour: [{ ...labour[0], phase_name: '<script>x</script>' }], materials }),
  { client: 'A & B <Builders>' })
ok(!/<script>/.test(nastyHtml), 'a description cannot inject script into the page')
ok(nastyHtml.includes('A &amp; B &lt;Builders&gt;'), 'and the client name is escaped')

// ── The panel offers what was asked for ─────────────────────
const panel = fs.readFileSync('src/components/ClientBreakdownPanel.tsx', 'utf8')
ok(/type="checkbox"/.test(panel), 'the panel has tick boxes')
ok(/BREAKDOWN_KINDS/.test(panel), 'and the labour / materials / both filter')
ok(/showRate/.test(panel), 'and the rate toggle')
ok(/LABOUR_DETAIL/.test(panel), 'and the by-phase / every-entry / full-log choice')
ok(!/labCost|lineCost|cost_ex_gst/.test(panel), 'and reads no cost figure either')

console.log(fail ? `\n${fail} failed` : '\nall passed')
process.exit(fail ? 1 : 0)
