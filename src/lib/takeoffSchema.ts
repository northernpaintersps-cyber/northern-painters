// The contract the AI takeoff is held to, generated from SUBSTRATES.
//
// The old prompt hand-wrote its own key list, and it had drifted: it asked for
// deck_oil, deck_tinted, deck_stain, stone, timber and concrete — none of which
// exist — so every deck, driveway and stained surface the model measured was
// dropped on the way in. It also described architraves in lineal metres against
// a field that counts openings, roughly a 5x overstatement on every quote.
//
// Nothing here is hand-maintained twice. The tool's key enum is built from
// SUBSTRATES, the unit for each key is read from the substrate, and COUNT_DEFS
// is coverage-checked at module load, so adding a substrate without saying what
// its number means fails immediately rather than quietly going unquoted.

import { SUBSTRATES, unitLabel, type Substrate, type SubUnit } from './substrates'

/**
 * What the number actually counts, per substrate.
 *
 * These exist because a unit alone is ambiguous in the ways that cost money:
 * "architraves: 14" is meaningless unless the model knows whether 14 is
 * openings, sides or metres.
 */
export const COUNT_DEFS: Record<string, string> = {
  // ── Interior ──
  ceilings: 'Square metres of ceiling. Flat area for a flat ceiling; the actual sloped surface area for a raked or vaulted one.',
  cornice: 'Lineal metres of cornice — the sum of the room perimeters where cornice runs.',
  walls: 'Square metres of wall. Perimeter x height, less door and window openings. Do not deduct skirting or architrave.',
  architraves: 'Number of door and window OPENINGS that have architraves. One opening counts 1, whatever its lineal metres and however many sides are painted. Never return lineal metres here.',
  skirtings: 'Lineal metres of skirting — room perimeters less door openings.',
  doors_i: 'Number of interior door LEAVES — the physical slab. Not faces and not openings: a door painted both sides is still 1, a pair of French doors is 2.',
  win_i: 'Number of window UNITS, counting interior frames. One opening is one unit however many panes it has.',
  wardrobes: 'Number of built-in wardrobe UNITS, one per opening or run. Not square metres.',
  feature: 'Square metres of feature wall, where one is called out in the finishes schedule or the notes.',
  wet_ceil: 'Square metres of ceiling in wet areas — bathroom, ensuite, laundry, WC. Counted here instead of in ceilings, not as well as.',
  wet_walls: 'Square metres of wall in wet areas. Counted here instead of in walls, not as well as.',
  laundry: 'Square metres for a laundry priced as a whole room, where it is not already split across wet_walls and wet_ceil.',

  // ── Exterior ──
  weatherboards: 'Square metres of weatherboard cladding, less openings.',
  cladding: 'Square metres of fibre cement or sheet cladding, less openings.',
  render: 'Square metres of rendered or masonry wall, less openings.',
  eaves: 'Square metres of eave and soffit — overhang depth x the length it runs.',
  fascia: 'Lineal metres of fascia, following the roofline.',
  gutters: 'Lineal metres of gutter. Usually the same run as the fascia unless the drawings differ.',
  downpipes: 'Number of downpipes.',
  posts: 'Number of posts and columns.',
  balustrades: 'Lineal metres of balustrade and handrail.',
  doors_e: 'Number of exterior door LEAVES. Not faces and not openings.',
  garage_e: 'Number of garage door UNITS. A double garage with a single door is 1. Not square metres.',
  fences: 'Lineal metres of fence to be painted.',
  decks: 'Square metres of hardwood deck and stairs finished with oil.',
  deck_paint: 'Square metres of deck and stairs that are painted rather than oiled.',
  driveway: 'Square metres of driveway, path or concrete floor coating.',
  roof: 'Square metres of roof — ridge-to-eave x length, both slopes where both are coated.',
  win_e: 'Number of window UNITS, counting exterior frames.',
  architraves_e: 'Number of exterior door and window OPENINGS with architraves. Openings, not lineal metres.',

  // ── Specialty ──
  limewash: 'Square metres finished in Bauwerk limewash or a comparable mineral finish.',
  cabinets: 'Number of cabinet DOORS and drawer fronts, counted individually. Not carcasses and not square metres.',
  timber_stain: 'Square metres of timber finished with stain or clear coat rather than paint.',
  firecoat: 'Square metres requiring a fire-rated coating in a BAL-rated area.',
}

// Coverage guard: a substrate with no definition would be quoted blind.
const MISSING = SUBSTRATES.filter(s => !COUNT_DEFS[s.key]).map(s => s.key)
if (MISSING.length) {
  throw new Error(`takeoffSchema: COUNT_DEFS has no entry for ${MISSING.join(', ')}`)
}

export const SUB_KEYS: string[] = SUBSTRATES.map(s => s.key)

export const subLineDoc = (s: Substrate) =>
  `${s.key} | ${s.label} | ${s.group} | unit: ${s.unit} (${unitLabel(s.unit)}) | ${COUNT_DEFS[s.key]}`

/** The authoritative substrate table, pasted into the system prompt. */
export const SUBSTRATE_DOC = [
  'key | label | group | unit | what the number counts',
  ...SUBSTRATES.map(subLineDoc),
].join('\n')

// ── The returned shape ───────────────────────────────────────

export type RowConfidence = 'high' | 'medium' | 'low'

export interface TakeoffRow {
  key: string
  qty: number
  unit: SubUnit
  /** The arithmetic behind the number, so a disagreement is diagnosable. */
  basis: string
  confidence: RowConfidence
  /** Sheet numbers the quantity was read from. */
  sheets: string[]
}

export interface FinishRow {
  area: string
  /** The model's own guess at the substrate, '' when it is unsure. */
  substrate_key: string
  product: string
  colour: string
  sheen: string
  coats: number | null
  undercoat: string
  notes: string
}

export const TAKEOFF_TOOL = {
  name: 'record_takeoff',
  description: 'Record the measured painting quantities, one row per substrate.',
  input_schema: {
    type: 'object' as const,
    additionalProperties: false,
    required: ['quantities', 'finishes', 'extractionSummary', 'scopeNotes', 'confidence'],
    properties: {
      jobType: {
        type: 'string',
        description: 'The kind of job the documents describe, e.g. "New build — interior".',
      },
      totalFloorArea: {
        type: ['number', 'null'],
        description: 'Total internal floor area in m². null when it cannot be determined.',
      },
      quantities: {
        type: 'array',
        description:
          'One row per substrate that is present. Omit a substrate entirely rather than '
          + 'returning a zero row. Never invent a key that is not in the enum.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['key', 'qty', 'unit', 'basis', 'confidence', 'sheets'],
          properties: {
            key: { type: 'string', enum: SUB_KEYS },
            qty: { type: 'number', description: 'The measured quantity in the unit for this key.' },
            unit: {
              type: 'string',
              enum: ['sqm', 'lm', 'qty'],
              description:
                'Must equal the unit listed against this key in the substrate table. '
                + 'Returning a different unit is an error — convert to the listed unit instead.',
            },
            basis: {
              type: 'string',
              description:
                'The arithmetic, not prose: "Bed1 3.6x3.2 + Bed2 3.0x3.4 + Living 4.2x5.0 = 44.5". '
                + 'State any assumed dimension explicitly.',
            },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
            sheets: {
              type: 'array',
              items: { type: 'string' },
              description: 'Sheet numbers this came from, e.g. ["A-02","A-03"]. Empty when unknown.',
            },
          },
        },
      },
      finishes: {
        type: 'array',
        description: 'Rows from the finishes schedule, when one is supplied. Empty array when there is none.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['area', 'substrate_key', 'product', 'colour', 'sheen', 'coats', 'undercoat', 'notes'],
          properties: {
            area: { type: 'string', description: 'The room or surface as the schedule names it.' },
            substrate_key: {
              type: 'string',
              enum: [...SUB_KEYS, ''],
              description: 'The substrate this row applies to, or "" when it is not clear.',
            },
            product: { type: 'string', description: 'Brand and product as specified, verbatim.' },
            colour: { type: 'string', description: 'Colour name or code as specified, verbatim.' },
            sheen: { type: 'string', description: 'Flat, matt, low sheen, satin, semi-gloss, gloss.' },
            coats: { type: ['number', 'null'] },
            undercoat: { type: 'string', description: 'Undercoat or primer as specified, "" when not stated.' },
            notes: { type: 'string' },
          },
        },
      },
      extractionSummary: {
        type: 'string',
        description:
          'The room-by-room working, newline separated: every room with its dimensions and '
          + 'the areas derived from them. This is what the estimator checks the totals against.',
      },
      scopeNotes: {
        type: 'string',
        description:
          'Assumptions made, surfaces excluded, anything unreadable, and any sheet you '
          + 'expected but were not given.',
      },
      confidence: { type: 'string', description: 'high, medium, or "low — <specific reason>".' },
    },
  },
}
