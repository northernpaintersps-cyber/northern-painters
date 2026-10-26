// Pinning a process step's labour to a part.
//
// Masking the interior and masking the exterior are two days and one day of
// different money against different parts, and neither paints a surface. So
// without pinning, the interior price pays for some of the exterior's
// masking — the labour spreads by the surfaces each step happens to list,
// or by direct cost when it lists none.
//
// The property that makes this safe to print: pinning MOVES money between
// parts and never creates or destroys any. Every total below is checked
// against the same quote undivided.

import {
  directCosts, priceGroups, autoLandsOn, stepLabour,
  type PartDef, type SplitProcess,
} from '@/lib/quoteSplit'

let fail = 0
const ok = (c: boolean, m: string) => { if (!c) { fail++; console.log('FAIL', m) } else console.log('ok  ', m) }
const near = (a: number, b: number, tol = 0.02) => Math.abs(a - b) < tol

const RATE = 65
const KEYS = ['walls', 'ceilings', 'weatherboards', 'fascia']
const PARTS: PartDef[] = [
  { id: 'p-int', label: 'Interior', keys: ['walls', 'ceilings'] },
  { id: 'p-ext', label: 'Exterior', keys: ['weatherboards', 'fascia'] },
]
// Equal book weight, so anything that spreads splits evenly and a wrong
// split is obvious rather than hidden in a ratio.
const WEIGHT = { walls: 1, ceilings: 1, weatherboards: 1, fascia: 1 }

// Painting steps, one per side, each squarely inside its own part.
const PAINTING: SplitProcess[] = [
  { name: 'Paint interior', hours: 16, np: 2, covers: ['walls', 'ceilings'] },
  { name: 'Paint exterior', hours: 16, np: 2, covers: ['weatherboards', 'fascia'] },
]
// The masking the user is actually asking about: two days two painters
// inside, one day two painters outside, neither of them painting anything.
const MASK_INT: SplitProcess = { name: 'Masking interior', hours: 16, np: 2 }
const MASK_EXT: SplitProcess = { name: 'Masking exterior', hours: 8, np: 2 }

const run = (processes: SplitProcess[], pricing: any = {}, defs = PARTS) => {
  const direct = directCosts({
    keys: KEYS, processes, avgRate: RATE, weight: WEIGHT, defaultNp: 1,
    materialsByKey: { walls: 400, ceilings: 200, weatherboards: 500, fascia: 100 },
    partIds: defs.map(d => d.id),
  })
  const labourCost = processes.reduce((t, p) => t + stepLabour(p, RATE), 0)
  const parts = priceGroups(defs, direct, {
    adjusted: true, labourCost, adjLab: labourCost,
    materialsTotal: 1200, adjMat: 1200,
    contingency: 0, waste: 0, overheadPct: 0, travelCost: 0,
    consTotal: 0, equipTotal: 0, extraMatTotal: 0,
    ...pricing,
  } as any)
  return { direct, parts, labourCost }
}

const int = (parts: any[]) => parts.find(p => p.id === 'p-int')!
const ext = (parts: any[]) => parts.find(p => p.id === 'p-ext')!

// ── What a step costs ────────────────────────────────────────
ok(stepLabour(MASK_INT, RATE) === 2080, 'two days of masking, two painters, is 16 x 65 x 2')
ok(stepLabour(MASK_EXT, RATE) === 1040, 'and one day is half of it')
ok(stepLabour({ name: 'x', hours: 8, np: 0 }, RATE) === 520, 'no painter count means one')
ok(stepLabour({ name: 'x', hours: 8, np: 0 }, RATE, 3) === 1560,
  'unless a crew size is given — which the quote builder does, so the split distributes '
  + 'the same labour the quote charged for a step that never said')
ok(stepLabour({ name: 'x', hours: 8, np: 2 }, RATE, 3) === 1040,
  "and a step that says its own painters is not overridden by the crew size")
ok(stepLabour({ name: 'x', hours: 0, np: 2 }, RATE) === 0, 'and no hours is no cost')

// ── The problem, unpinned ────────────────────────────────────
const before = run([...PAINTING, MASK_INT, MASK_EXT])
ok(near(before.direct.unattributedLabour, 2080 + 1040),
  'both masking steps land in unattributed labour, since neither names a surface')
ok(near(int(before.parts).labour, ext(before.parts).labour),
  'so the two parts carry the SAME labour — the interior is paying for the exterior masking')

// ── Pinned ───────────────────────────────────────────────────
const after = run([
  ...PAINTING,
  { ...MASK_INT, part: 'p-int' },
  { ...MASK_EXT, part: 'p-ext' },
])
ok(after.direct.unattributedLabour === 0, 'pinned steps leave unattributed labour entirely')
ok(near(after.direct.labourByPart['p-int'], 2080), 'the interior masking belongs to the interior part')
ok(near(after.direct.labourByPart['p-ext'], 1040), 'and the exterior masking to the exterior part')

ok(near(int(after.parts).labour, 2080 + 2080), 'interior labour: its painting plus its own masking')
ok(near(ext(after.parts).labour, 2080 + 1040), 'exterior labour: its painting plus its own, smaller, masking')
ok(int(after.parts).labour > ext(after.parts).labour,
  'the interior now costs more labour than the exterior, which is what the work says')

// ── Money moves, it is never made ────────────────────────────
const sum = (parts: any[]) => parts.reduce((t, p) => t + p.total, 0)
ok(near(sum(before.parts), sum(after.parts)),
  'the quote total is identical pinned or not — pinning moves money, it does not create it')
ok(near(int(after.parts).total - int(before.parts).total,
        -(ext(after.parts).total - ext(before.parts).total)),
  'what one part gains the other loses, to the cent')
ok(near(int(after.parts).labour + ext(after.parts).labour, after.labourCost),
  'and the parts still carry every hour of labour between them')

// ── A pin beats the surfaces it covers ───────────────────────
const crossed = run([
  // A step that paints interior surfaces, pinned to the exterior anyway.
  { name: 'Odd one', hours: 8, np: 1, covers: ['walls', 'ceilings'], part: 'p-ext' },
])
ok(near(crossed.direct.labourByPart['p-ext'], 520), 'a pin wins over the covers the step lists')
ok(crossed.direct.labour.walls === 0 && crossed.direct.labour.ceilings === 0,
  'and none of it is left on the surfaces it listed')

// ── A pin to a part that no longer exists ────────────────────
const stale = run([{ name: 'Prep', hours: 8, np: 1, covers: ['walls'], part: 'p-deleted' }])
ok(!stale.direct.labourByPart['p-deleted'], 'a pin to a deleted part is ignored')
ok(near(stale.direct.labour.walls, 520), 'and the step falls back to the surfaces it covers')
const staleNoCovers = run([{ name: 'Set up', hours: 8, np: 1, part: 'p-deleted' }])
ok(near(staleNoCovers.direct.unattributedLabour, 520),
  'with no covers either, it goes back to being shared — the money is never lost')

// ── The percentages reach pinned labour ──────────────────────
const cont = run([{ ...MASK_INT, part: 'p-int' }], { contingency: 10 })
ok(near(int(cont.parts).labour, 2080 * 1.1), 'contingency applies to pinned labour')

const halved = run([{ ...MASK_INT, part: 'p-int' }, { ...MASK_EXT, part: 'p-ext' }],
  { adjLab: 1560 })   // the 3120 computed, cut by hand to half
ok(near(int(halved.parts).labour, 1040) && near(ext(halved.parts).labour, 520),
  'a hand-set labour total scales pinned labour by the same ratio as any other')

// ── Travel follows labour, so it follows a pin ───────────────
const travel = run([{ ...MASK_INT, part: 'p-int' }, { ...MASK_EXT, part: 'p-ext' }],
  { travelCost: 300 })
const ratio = int(travel.parts).shared / (int(travel.parts).shared + ext(travel.parts).shared)
ok(near(ratio, 2080 / 3120, 0.01),
  'travel splits two-thirds to the part with two-thirds of the hours')

// ── Unpinned work behaves exactly as before ──────────────────
const plain = run(PAINTING)
ok(near(int(plain.parts).labour, 2080) && near(ext(plain.parts).labour, 2080),
  'with nothing pinned, labour lands by covers as it always did')
ok(Object.keys(plain.direct.labourByPart).length === 0, 'and nothing is pinned anywhere')

// ── What auto resolves to ────────────────────────────────────
ok(autoLandsOn(PAINTING[0], PARTS, KEYS).part?.id === 'p-int',
  'a step whose surfaces all sit in one part lands there — nothing to pin')
ok(autoLandsOn(MASK_INT, PARTS, KEYS).spread,
  'a step covering nothing is spread, which is the one worth pinning')
ok(autoLandsOn({ name: 'Both', hours: 1, np: 1, covers: ['walls', 'fascia'] }, PARTS, KEYS).spread,
  'and so is one that straddles two parts')
ok(autoLandsOn({ name: 'Orphan', hours: 1, np: 1, covers: ['gutters'] }, PARTS, KEYS).spread,
  'a step over a surface in no part at all counts as spread, not as settled')

console.log(fail ? `\n${fail} FAILED` : '\nall passed')
process.exit(fail ? 1 : 0)
