// Typing a price either way round.
//
// Every money column stores ex GST. A client conversation happens in inc
// GST. So the conversion has to be exact where it can be, honest where it
// cannot, and incapable of putting a NaN in a money column — which would
// poison every total that figure reaches.

import {
  parseMoney, toInc, toEx, storedEx, echoOf, fieldValue, type GstMode,
} from '@/lib/gstEntry'
import * as fs from 'fs'

let fail = 0
const ok = (c: boolean, m: string) => { if (!c) { fail++; console.log('FAIL', m) } else console.log('ok  ', m) }

// ── Reading what was typed ───────────────────────────────────
ok(parseMoney('500') === 500, 'a plain figure')
ok(parseMoney('$1,250.50') === 1250.5, 'with the dollar sign and comma a person types')
ok(parseMoney(' 500 ') === 500, 'and whitespace around it')
ok(parseMoney('') === null && parseMoney(null) === null && parseMoney(undefined) === null,
  'nothing typed is nothing, not zero — an empty field has no figure in it')
ok(parseMoney('abc') === null && parseMoney('$') === null, 'and junk is nothing either')
ok(parseMoney('-50') === -50, 'a negative reads, for the form to refuse if it wants to')

// ── The conversion ───────────────────────────────────────────
ok(toInc(500) === 550, '500 ex is 550 inc')
ok(toEx(550) === 500, 'and 550 inc is 500 ex')
ok(toInc(0) === 0 && toEx(0) === 0, 'nothing converts to nothing')
ok(toInc(500, 0) === 500 && toEx(500, 0) === 500,
  'at a zero rate the two are the same figure — the cash job case')

// Figures where 1.1 does not divide cleanly.
ok(toEx(551) === 500.91, '551 inc is 500.91 ex, to the cent')
ok(toEx(100) === 90.91, '100 inc is 90.91 ex')
ok(toInc(90.91) === 100, 'which echoes back as 100 inc')
ok(toEx(1) === 0.91 && toInc(0.91) === 1, 'and a single dollar round-trips')

// ── What gets stored ─────────────────────────────────────────
ok(storedEx('550', 'inc') === 500, 'typing 550 in inc mode stores 500')
ok(storedEx('500', 'ex') === 500, 'typing 500 in ex mode stores 500')
ok(storedEx('551', 'inc') === 500.91, 'an awkward inc figure stores to the cent')
ok(storedEx('500.456', 'ex') === 500.46, 'and more cents than exist are rounded, not stored')
ok(storedEx('', 'inc') === null, 'an empty field stores nothing')
ok(storedEx('abc', 'ex') === null, 'and junk stores nothing')
ok(!Number.isNaN(storedEx('abc', 'ex') as any), 'never a NaN, which is the point')
ok(storedEx('550', 'inc', 0) === 550, 'at a zero rate inc mode stores what was typed')

// ── The echo agrees with what is stored ──────────────────────
// The figure shown beside the box is computed FROM the stored figure, so it
// can never promise something different from what will be saved.
for (const typed of ['550', '551', '100', '1', '12345.67', '0.05']) {
  const ex = storedEx(typed, 'inc')!
  ok(echoOf(typed, 'inc') === ex,
    `typing ${typed} inc echoes the ${ex} that is actually stored`)
}
for (const typed of ['500', '500.91', '7333.33']) {
  const ex = storedEx(typed, 'ex')!
  ok(echoOf(typed, 'ex') === toInc(ex),
    `typing ${typed} ex echoes ${toInc(ex)} inc, computed from the stored figure`)
}
ok(echoOf('550', 'inc', 0) === null, 'a cash job has no second figure to echo')
ok(echoOf('', 'ex') === null, 'and an empty field echoes nothing')

// ── Reopening a saved add-on does not drift it ───────────────
// Open, look, save again: the stored cents must not move. This is the one
// that matters, because it happens every time a record is edited.
for (const ex of [500, 500.91, 90.91, 1234.56, 0.05, 99999.99]) {
  for (const mode of ['ex', 'inc'] as GstMode[]) {
    const shown = fieldValue(ex, mode)
    ok(storedEx(shown, mode) === ex,
      `${ex} shown in ${mode} mode saves back as ${ex} — no drift on a round trip`)
  }
}

ok(fieldValue(null, 'ex') === '' && fieldValue(undefined, 'inc') === '',
  'an empty amount shows an empty box, not a zero')
ok(fieldValue(500, 'inc') === '550', 'a stored 500 shows as 550 in inc mode')
ok(fieldValue(500, 'ex') === '500', 'and as 500 in ex mode')
ok(fieldValue(500, 'inc', 0) === '500', 'with no GST it shows the one figure')

// ── Reachable on a touch screen ──────────────────────────────
// The reason a saved add-on looked unchangeable: its controls were behind
// group-hover, which does not exist on the phone the list is read on.
const modal = fs.readFileSync('src/components/JobModal.tsx', 'utf8')
const addOnBlock = modal.slice(modal.indexOf('function VariationsTab'), modal.indexOf('export const JOB_TYPES'))
ok(!/opacity-0 group-hover/.test(addOnBlock),
  "the add-on list's edit and delete are not hidden behind hover")
ok(/Edit this add-on/.test(addOnBlock), 'and the edit control says what it does')
ok(/MoneyInput/.test(modal), 'the amount is entered through the ex/inc field')

const page = fs.readFileSync('src/pages/JobDashboard.tsx', 'utf8')
ok(/setEditing\('variations'\)/.test(page), 'the job page can open the Add-ons tab directly')
ok(/tab=\{editing/.test(page), 'passing the tab to the modal rather than hoping it is on the right one')

console.log(fail ? `\n${fail} FAILED` : '\nall passed')
process.exit(fail ? 1 : 0)
