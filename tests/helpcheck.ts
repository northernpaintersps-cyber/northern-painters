// Every Dashboard KPI explains itself.
//
// A figure with no explanation is the thing this fixes, so the thing to guard
// is a new one arriving without one. Reads the source, because that is where
// a missing tip would be.

import * as fs from 'fs'

let fail = 0
const ok = (c: boolean, m: string) => { if (!c) { fail++; console.log('FAIL', m) } else console.log('ok  ', m) }

const src = fs.readFileSync('src/pages/Dashboard.tsx', 'utf8')

// Each <Metric ... /> in the page, with its props.
// Split on the opening tags rather than matching through to a closing `/>`:
// a tip ending in a fragment `</>` contains one, and the block would stop
// there, cutting the tip in half.
const blocks = src.split(/<Metric\b/).slice(1)
ok(blocks.length >= 9, `${blocks.length} KPI cards on the Dashboard`)

const labelOf = (b: string) =>
  (/label=\{?["`]([^"`]*)/.exec(b)?.[1] ?? '(unlabelled)').trim()

const missing = blocks.filter(b => !/\bhelp=\{/.test(b)).map(labelOf)
ok(missing.length === 0, missing.length
  ? `every KPI has a help tip — these do not: ${missing.join(', ')}`
  : 'every KPI has a help tip')

// A tip that only restates the label teaches nothing. Each one says how the
// figure is worked out.
const noCalc = blocks.filter(b => /\bhelp=\{/.test(b) && !/<TipCalc>/.test(b)).map(labelOf)
ok(noCalc.length === 0, noCalc.length
  ? `every tip says how it is calculated — these do not: ${noCalc.join(', ')}`
  : 'every tip carries a TipCalc saying how the figure is worked out')

const short = blocks
  .map(b => [labelOf(b), /help=\{<>([\s\S]*?)<\/>\}/.exec(b)?.[1] ?? ''] as const)
  .filter(([, t]) => t.replace(/<[^>]*>/g, '').trim().length < 80)
  .map(([l]) => l)
ok(short.length === 0, short.length ? `tips too thin to be useful: ${short.join(', ')}` : 'no tip is a one-liner')

// The component it leans on, and the two behaviours that make it usable on a
// phone and with a keyboard.
const tip = fs.readFileSync('src/components/InfoTip.tsx', 'utf8')
ok(/onClick=/.test(tip) && /onMouseEnter=/.test(tip), 'InfoTip opens on tap as well as hover')
ok(/Escape/.test(tip), 'and closes on Escape')
ok(/e\.stopPropagation\(\)/.test(tip), 'asking about a number does not trigger the card underneath')
ok(/role="tooltip"/.test(tip) && /aria-label=/.test(tip), 'the mark and its bubble are labelled for a screen reader')

console.log(fail ? `\n${fail} FAILED` : '\nall passed')
process.exit(fail ? 1 : 0)
