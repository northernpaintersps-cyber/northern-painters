// Turning an architect's finishes schedule into coating settings.
//
// The extractor has always read the schedule and the app has always thrown it
// away. On a new build the schedule is the one document that says what the
// client actually contracted for, so it belongs in both the coating settings
// and the quote.
//
// Two destinations, because CoatSettings has nowhere to put "Dulux Lexicon
// Quarter": its `colour` field is the magnitude of colour change, which drives
// coat counts, not the colour itself. The named product and colour go in a
// FinishSpec alongside.

import { SUB_BY_KEY, UC_OPTS, type CoatSettings, type FinishSpec, type Substrate } from './substrates'
import { FINISH_OPTS } from './quoteData'
import type { FinishRow } from './takeoffSchema'

/**
 * Schedule wording for a surface, in the order it should be tested.
 *
 * Note the `s?\b` endings: a bare `\bdoor\b` does not match "doors", which is
 * how a schedule actually writes it.
 */
const AREA_PATTERNS: Array<[RegExp, string]> = [
  // Wet areas first: "bathroom ceiling" must not match the plain ceiling rule.
  [/\b(bath|ensuite|shower|wc|toilet|powder\s*room|wet\s*area)\w*\b.*\bceilings?\b/i, 'wet_ceil'],
  [/\b(bath|ensuite|shower|wc|toilet|powder\s*room|wet\s*area)\w*\b.*\bwalls?\b/i, 'wet_walls'],
  [/\blaundry\b/i, 'laundry'],
  [/\b(ceilings?|rcp|soffit\s*linings?)\b/i, 'ceilings'],
  [/\bcornices?\b/i, 'cornice'],
  [/\bskirtings?\b|\bskirts?\b/i, 'skirtings'],
  [/\barchitraves?\b/i, 'architraves'],
  [/\b(feature|accent)\s*walls?\b/i, 'feature'],
  [/\b(wardrobes?|robes?|built.?ins?)\b/i, 'wardrobes'],
  [/\b(cabinets?|cabinetry|joinery|cupboards?|drawers?)\b/i, 'cabinets'],
  [/\b(weatherboards?|w\/?boards?)\b/i, 'weatherboards'],
  [/\b(cladding|fc\s*sheets?|fibre\s*cement)\b/i, 'cladding'],
  [/\b(render|rendered|masonry|blockwork)\b/i, 'render'],
  [/\b(eaves?|soffits?)\b/i, 'eaves'],
  [/\bfascias?\b/i, 'fascia'],
  [/\b(gutters?|downpipes?)\b/i, 'gutters'],
  [/\b(balustrades?|handrails?)\b/i, 'balustrades'],
  [/\b(posts?|columns?)\b/i, 'posts'],
  [/\bgarage\s*doors?\b/i, 'garage_e'],
  [/\bfences?\b|\bfencing\b/i, 'fences'],
  [/\bdeck(ing)?s?\b/i, 'decks'],
  [/\b(driveways?|paths?|concrete\s*floors?|paving)\b/i, 'driveway'],
  [/\broofs?\b|\broofing\b/i, 'roof'],
  [/\blimewash\b/i, 'limewash'],
  [/\b(bal|fire.?rated|fire.?retardant)\b/i, 'firecoat'],
  [/\b(stains?|stained|clear\s*coats?|decking\s*oil)\b/i, 'timber_stain'],
  // Exterior before interior for doors and windows, since the word is shared.
  [/\b(external|exterior|front|entry)\b.*\bdoors?\b/i, 'doors_e'],
  [/\b(external|exterior)\b.*\bwindows?\b/i, 'win_e'],
  [/\bdoors?\b/i, 'doors_i'],
  [/\bwindows?\b/i, 'win_i'],
  [/\bwalls?\b/i, 'walls'],
]

/**
 * The substrate a schedule row applies to, or null when it is not clear.
 * Only used when the model did not name one itself.
 */
export function matchFinishKey(area: string, notes = ''): string | null {
  const text = `${area} ${notes}`.trim()
  if (!text) return null
  for (const [re, key] of AREA_PATTERNS) if (re.test(text)) return key
  return null
}

/** Schedule sheen wording to one of our finish options. */
export function matchFinish(sheen: string, fallback: string): string {
  const t = (sheen || '').toLowerCase().trim()
  if (!t) return fallback
  // An exact option wins outright — "Weathershield Low Sheen" must not be
  // caught by the plain low-sheen rule below.
  const exact = FINISH_OPTS.find(o => o.toLowerCase() === t)
  if (exact) return exact
  if (/\b(matt?|flat)\b/.test(t)) return 'Flat'
  if (/low\s*sheen|eggshell|velvet/.test(t)) return 'Low Sheen'
  if (/semi.?gloss|satin/.test(t)) return 'Semi-Gloss'
  if (/\bgloss\b/.test(t)) return 'Gloss'
  if (/oil/.test(t)) return 'Decking Oil'
  return fallback
}

/** Schedule undercoat wording to one of UC_OPTS. '' when none is specified. */
export function matchUndercoat(undercoat: string): string {
  const t = (undercoat || '').toLowerCase().trim()
  if (!t || /\bnone\b|^-+$|^n\/?a$/.test(t)) return ''
  if (/shellac|stain\s*block|b.?i\.?n\b/.test(t)) return 'Shellac'
  if (/\boil\b|alkyd/.test(t)) return 'Oil-based'
  if (/acrylic|water|sealer|primer|undercoat/.test(t)) return 'Acrylic'
  return 'Special'
}

/**
 * The coating fields the schedule actually determines. Application method is
 * deliberately absent: a finishes schedule specifies the product, not how it
 * goes on the wall.
 */
export function finishToCoat(f: FinishRow, s: Substrate | undefined): Partial<CoatSettings> {
  const out: Partial<CoatSettings> = {}

  const fin = matchFinish(f.sheen, '')
  if (fin) out.fin = fin

  if (typeof f.coats === 'number' && f.coats >= 1 && f.coats <= 4) {
    out.topCoats = Math.round(f.coats)
  }

  const uc = matchUndercoat(f.undercoat)
  if (uc && UC_OPTS.includes(uc)) {
    out.uc = uc
    out.ucCoats = 1
  }

  // A named colour is a colour change we have to cover, which is what the
  // colour field is for. The name itself goes to the FinishSpec.
  if (f.colour.trim()) out.colour = 'Special colour'

  void s
  return out
}

export interface AppliedFinishes {
  coats: Record<string, Partial<CoatSettings>>
  specs: Record<string, FinishSpec>
  /** Rows we could not place against a substrate. */
  unmatched: FinishRow[]
}

/** Fold the schedule into per-substrate coating changes and named products. */
export function applyFinishRows(rows: FinishRow[]): AppliedFinishes {
  const coats: Record<string, Partial<CoatSettings>> = {}
  const specs: Record<string, FinishSpec> = {}
  const unmatched: FinishRow[] = []

  for (const f of rows) {
    const key = (f.substrate_key && SUB_BY_KEY[f.substrate_key])
      ? f.substrate_key
      : matchFinishKey(f.area, f.notes)
    if (!key || !SUB_BY_KEY[key]) { unmatched.push(f); continue }

    // Later rows for the same substrate fill gaps rather than overwrite: the
    // schedule often names the product once and the sheen on another line.
    coats[key] = { ...finishToCoat(f, SUB_BY_KEY[key]), ...(coats[key] ?? {}) }
    const spec = specs[key] ?? {}
    if (f.product.trim() && !spec.product) spec.product = f.product.trim()
    if (f.colour.trim() && !spec.colour) spec.colour = f.colour.trim()
    if (spec.product || spec.colour) specs[key] = spec
  }

  return { coats, specs, unmatched }
}

/** The schedule as lines for the quote document. */
export function finishScheduleText(
  specs: Record<string, FinishSpec>, coats: Record<string, CoatSettings>,
): string {
  return Object.entries(specs).map(([key, spec]) => {
    const s = SUB_BY_KEY[key]
    const c = coats[key]
    const bits = [spec.product, spec.colour && `colour ${spec.colour}`,
      c && `${c.topCoats} x ${c.fin}`].filter(Boolean)
    return `${s?.label ?? key}: ${bits.join(', ')}`
  }).join('\n')
}
