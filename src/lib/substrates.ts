// The single substrate list shared by the site visit and the quote builder.
// Keys, labels and units match across both so a visit hands its takeoff
// straight to a quote. Derived from V16 INT_SUBS/EXT_SUBS/SPEC_SUBS and _SV_SUB_CFG.

export type SubGroup = 'Interior' | 'Exterior' | 'Specialty'
export type SubUnit = 'sqm' | 'lm' | 'qty'

export type Substrate = {
  key: string
  label: string
  unit: SubUnit
  group: SubGroup
  paint: string
  defMethod: string
  defFinish: string
  /** V16 defUCoats / defTopCoats — every substrate ships 0 and 2. */
  defUCoats?: number
  defTopCoats?: number
  /** Preset types for this substrate — e.g. French / solid / panel doors. */
  typeOpts: string[]
}

export const SUBSTRATES: Substrate[] = [
  // ── Interior ──
  { key: "ceilings", label: "Ceilings", unit: "sqm", group: "Interior",
    paint: "Dulux Ceiling White Flat", defMethod: "Cut & Roll", defFinish: "Flat",
    typeOpts: [] },
  { key: "cornice", label: "Cornice", unit: "lm", group: "Interior",
    paint: "Dulux Ceiling White Flat", defMethod: "Brush", defFinish: "Flat",
    typeOpts: [] },
  { key: "walls", label: "Walls", unit: "sqm", group: "Interior",
    paint: "Wash and Wear Low Sheen", defMethod: "Cut & Roll", defFinish: "Low Sheen",
    typeOpts: [] },
  { key: "architraves", label: "Architraves", unit: "qty", group: "Interior",
    paint: "Dulux Aquanamel Semi-Gloss", defMethod: "Brush", defFinish: "Semi-Gloss",
    typeOpts: ["Timber", "MDF", "Colonial", "Bar", "Bullnose", "Pencil Round"] },
  { key: "skirtings", label: "Skirting boards", unit: "lm", group: "Interior",
    paint: "Dulux Aquanamel Semi-Gloss", defMethod: "Brush", defFinish: "Semi-Gloss",
    typeOpts: [] },
  { key: "doors_i", label: "Doors interior", unit: "qty", group: "Interior",
    paint: "Dulux Aquanamel Semi-Gloss", defMethod: "Cut & Roll", defFinish: "Semi-Gloss",
    typeOpts: ["Hollow core", "Solid timber", "Panel", "Glass", "French", "Bi-fold", "Sliding", "Louvre", "Barn", "Pocket"] },
  { key: "win_i", label: "Window frames interior", unit: "qty", group: "Interior",
    paint: "Dulux Aquanamel Semi-Gloss", defMethod: "Brush", defFinish: "Semi-Gloss",
    typeOpts: ["Timber", "Aluminium", "uPVC", "Louvre", "Awning", "Casement", "Double-hung", "Sliding", "Fixed"] },
  { key: "wardrobes", label: "Built-in wardrobes", unit: "qty", group: "Interior",
    paint: "Wash and Wear Low Sheen", defMethod: "Cut & Roll", defFinish: "Low Sheen",
    typeOpts: [] },
  { key: "feature", label: "Feature wall", unit: "sqm", group: "Interior",
    paint: "Wash and Wear Low Sheen", defMethod: "Cut & Roll", defFinish: "Low Sheen",
    typeOpts: [] },
  { key: "wet_ceil", label: "Wet area ceilings", unit: "sqm", group: "Interior",
    paint: "Wash and Wear Low Sheen", defMethod: "Cut & Roll", defFinish: "Low Sheen (Wet Areas)",
    typeOpts: [] },
  { key: "wet_walls", label: "Wet area walls", unit: "sqm", group: "Interior",
    paint: "Wash and Wear Low Sheen", defMethod: "Cut & Roll", defFinish: "Low Sheen (Wet Areas)",
    typeOpts: [] },
  { key: "laundry", label: "Laundry full room", unit: "sqm", group: "Interior",
    paint: "Wash and Wear Low Sheen", defMethod: "Cut & Roll", defFinish: "Low Sheen (Wet Areas)",
    typeOpts: [] },
  // ── Interior, added ──
  { key: "beams", label: "Exposed beams and rafters", unit: "lm", group: "Interior",
    paint: "Wash and Wear Low Sheen", defMethod: "Brush", defFinish: "Low Sheen",
    typeOpts: ["Timber", "Steel", "Dressed", "Rough sawn", "Stained"] },
  { key: "lining", label: "Lining boards and VJ panelling", unit: "sqm", group: "Interior",
    paint: "Wash and Wear Low Sheen", defMethod: "Cut & Roll", defFinish: "Low Sheen",
    typeOpts: ["VJ", "T&G", "Shiplap", "Beadboard", "Plywood"] },
  { key: "stairs_i", label: "Stairs interior", unit: "qty", group: "Interior",
    paint: "Dulux Aquanamel Semi-Gloss", defMethod: "Brush", defFinish: "Semi-Gloss",
    typeOpts: ["Timber", "Closed riser", "Open riser", "Carpeted treads", "Painted stringer only"] },
  { key: "balustrades_i", label: "Balustrades and handrails interior", unit: "lm", group: "Interior",
    paint: "Dulux Aquanamel Semi-Gloss", defMethod: "Brush", defFinish: "Semi-Gloss",
    typeOpts: ["Timber", "Steel", "Wire", "Glass with timber rail"] },
  { key: "rails", label: "Picture and dado rails", unit: "lm", group: "Interior",
    paint: "Dulux Aquanamel Semi-Gloss", defMethod: "Brush", defFinish: "Semi-Gloss",
    typeOpts: [] },
  { key: "bulkheads", label: "Bulkheads", unit: "lm", group: "Interior",
    paint: "Wash and Wear Low Sheen", defMethod: "Cut & Roll", defFinish: "Low Sheen",
    typeOpts: [] },
  { key: "brick_i", label: "Exposed brick interior", unit: "sqm", group: "Interior",
    paint: "Wash and Wear Low Sheen", defMethod: "Cut & Roll", defFinish: "Low Sheen",
    typeOpts: ["Painted previously", "Bare brick", "Besser block"] },
  { key: "garage_i", label: "Garage interior walls and ceiling", unit: "sqm", group: "Interior",
    paint: "Wash and Wear Low Sheen", defMethod: "Cut & Roll", defFinish: "Low Sheen",
    typeOpts: [] },
  { key: "sills", label: "Window sills and reveals", unit: "qty", group: "Interior",
    paint: "Dulux Aquanamel Semi-Gloss", defMethod: "Brush", defFinish: "Semi-Gloss",
    typeOpts: [] },
  { key: "shelving", label: "Shelving and linen cupboards", unit: "qty", group: "Interior",
    paint: "Dulux Aquanamel Semi-Gloss", defMethod: "Brush", defFinish: "Semi-Gloss",
    typeOpts: [] },
  // ── Exterior ──
  { key: "weatherboards", label: "Weatherboards", unit: "sqm", group: "Exterior",
    paint: "Weathershield Low Sheen", defMethod: "Brush", defFinish: "Weathershield Low Sheen",
    typeOpts: ["Timber", "Fibre cement", "T&G", "Shiplap", "Chamfer"] },
  { key: "cladding", label: "Cladding fibre cement", unit: "sqm", group: "Exterior",
    paint: "Weathershield Low Sheen", defMethod: "Brush", defFinish: "Weathershield Low Sheen",
    typeOpts: ["Colorbond", "Timber", "Composite", "Fibre cement", "Hardiplank"] },
  { key: "render", label: "Render and masonry walls", unit: "sqm", group: "Exterior",
    paint: "Weathershield Low Sheen", defMethod: "Cut & Roll", defFinish: "Weathershield Low Sheen",
    typeOpts: [] },
  { key: "eaves", label: "Eaves and soffits", unit: "sqm", group: "Exterior",
    paint: "Weathershield Low Sheen", defMethod: "Cut & Roll", defFinish: "Weathershield Low Sheen",
    typeOpts: [] },
  { key: "fascia", label: "Fascia boards", unit: "lm", group: "Exterior",
    paint: "Weathershield Low Sheen", defMethod: "Brush", defFinish: "Weathershield Low Sheen",
    typeOpts: [] },
  { key: "gutters", label: "Gutters", unit: "lm", group: "Exterior",
    paint: "Weathershield Low Sheen", defMethod: "Brush", defFinish: "Weathershield Low Sheen",
    typeOpts: [] },
  { key: "downpipes", label: "Downpipes", unit: "qty", group: "Exterior",
    paint: "Weathershield Low Sheen", defMethod: "Brush", defFinish: "Weathershield Low Sheen",
    typeOpts: [] },
  { key: "posts", label: "Posts and columns", unit: "qty", group: "Exterior",
    paint: "Weathershield Low Sheen", defMethod: "Brush", defFinish: "Weathershield Low Sheen",
    typeOpts: [] },
  { key: "balustrades", label: "Balustrades and handrails", unit: "lm", group: "Exterior",
    paint: "Weathershield Semi-Gloss", defMethod: "Brush", defFinish: "Weathershield Semi-Gloss",
    typeOpts: [] },
  { key: "doors_e", label: "Doors exterior", unit: "qty", group: "Exterior",
    paint: "Weathershield Semi-Gloss", defMethod: "Brush", defFinish: "Weathershield Semi-Gloss",
    typeOpts: ["Solid timber", "Panel", "Screen", "French", "Bi-fold", "Sliding", "Security", "Louvre"] },
  { key: "garage_e", label: "Garage doors", unit: "qty", group: "Exterior",
    paint: "Weathershield Low Sheen", defMethod: "Spray", defFinish: "Weathershield Low Sheen",
    typeOpts: ["Panel lift", "Roller", "Tilt", "Timber", "Sectional"] },
  { key: "fences", label: "Fences", unit: "lm", group: "Exterior",
    paint: "Weathershield Low Sheen", defMethod: "Brush", defFinish: "Weathershield Low Sheen",
    typeOpts: [] },
  { key: "decks", label: "Deck/stairs hardwood (oil)", unit: "sqm", group: "Exterior",
    paint: "Cutek CD50", defMethod: "Deck Applicator", defFinish: "Decking Oil",
    typeOpts: [] },
  { key: "deck_paint", label: "Deck/stairs painted", unit: "sqm", group: "Exterior",
    paint: "Taubmans All Weather Deck", defMethod: "Cut & Roll", defFinish: "Decking Paint Satin (Anti-slip)",
    typeOpts: [] },
  { key: "driveway", label: "Driveway / concrete floors", unit: "sqm", group: "Exterior",
    paint: "Super Grip Medium", defMethod: "Cut & Roll", defFinish: "Concrete & Paving Satin (Anti-slip)",
    typeOpts: [] },
  { key: "roof", label: "Roof", unit: "sqm", group: "Exterior",
    paint: "Dulux Roof and Trim", defMethod: "Spray", defFinish: "Roof Membrane Satin",
    typeOpts: ["Colorbond / Tin", "Terracotta tile", "Concrete tile", "Zincalume", "Corrugated iron"] },
  { key: "win_e", label: "Window frames exterior", unit: "qty", group: "Exterior",
    paint: "Weathershield Semi-Gloss", defMethod: "Brush", defFinish: "Weathershield Semi-Gloss",
    typeOpts: ["Timber", "Aluminium", "uPVC", "Awning", "Casement", "Louvre", "Double-hung", "Sliding", "Fixed"] },
  { key: "architraves_e", label: "Architraves exterior", unit: "qty", group: "Exterior",
    paint: "Weathershield Semi-Gloss", defMethod: "Brush", defFinish: "Weathershield Semi-Gloss",
    typeOpts: ["Timber", "MDF", "Colonial", "Bar", "Bullnose", "Pencil Round"] },
  // ── Exterior, added ──
  { key: "pergola", label: "Pergolas, patios and carports", unit: "sqm", group: "Exterior",
    paint: "Weathershield Low Sheen", defMethod: "Brush", defFinish: "Weathershield Low Sheen",
    typeOpts: ["Timber", "Steel", "Colorbond", "Aluminium"] },
  { key: "verandah_ceil", label: "Verandah and porch ceilings", unit: "sqm", group: "Exterior",
    paint: "Weathershield Low Sheen", defMethod: "Cut & Roll", defFinish: "Weathershield Low Sheen",
    typeOpts: ["Lining boards", "Fibre cement", "Plywood", "Exposed rafters"] },
  { key: "screens", label: "Privacy screens and battens", unit: "sqm", group: "Exterior",
    paint: "Weathershield Low Sheen", defMethod: "Brush", defFinish: "Weathershield Low Sheen",
    typeOpts: ["Timber batten", "Aluminium", "Steel", "Laser cut"] },
  { key: "lattice", label: "Lattice", unit: "sqm", group: "Exterior",
    paint: "Weathershield Low Sheen", defMethod: "Spray", defFinish: "Weathershield Low Sheen",
    typeOpts: ["Timber", "PVC"] },
  { key: "gates", label: "Gates", unit: "qty", group: "Exterior",
    paint: "Weathershield Semi-Gloss", defMethod: "Brush", defFinish: "Weathershield Semi-Gloss",
    typeOpts: ["Timber", "Steel", "Colorbond", "Aluminium", "Double"] },
  { key: "shutters", label: "Shutters and awnings", unit: "qty", group: "Exterior",
    paint: "Weathershield Semi-Gloss", defMethod: "Brush", defFinish: "Weathershield Semi-Gloss",
    typeOpts: ["Timber shutter", "Aluminium shutter", "Canvas awning frame", "Bahama"] },
  { key: "retaining", label: "Retaining walls and blockwork", unit: "sqm", group: "Exterior",
    paint: "Weathershield Low Sheen", defMethod: "Cut & Roll", defFinish: "Weathershield Low Sheen",
    typeOpts: ["Besser block", "Brick", "Concrete", "Render", "Timber sleeper"] },
  { key: "stumps", label: "Stumps, bearers and subfloor", unit: "qty", group: "Exterior",
    paint: "Weathershield Low Sheen", defMethod: "Brush", defFinish: "Weathershield Low Sheen",
    typeOpts: ["Timber stump", "Steel stump", "Concrete", "Bearer and joist"] },
  { key: "sheds", label: "Sheds and outbuildings", unit: "sqm", group: "Exterior",
    paint: "Weathershield Low Sheen", defMethod: "Spray", defFinish: "Weathershield Low Sheen",
    typeOpts: ["Colorbond", "Timber", "Fibre cement", "Besser block"] },
  { key: "steel_e", label: "Steel posts, beams and metalwork", unit: "lm", group: "Exterior",
    paint: "Weathershield Semi-Gloss", defMethod: "Brush", defFinish: "Weathershield Semi-Gloss",
    typeOpts: ["Painted previously", "Galvanised", "Rusted", "Bare steel"] },
  // ── Specialty ──
  { key: "limewash", label: "Limewash Bauwerk", unit: "sqm", group: "Specialty",
    paint: "Bauwerk Limewash", defMethod: "Brush", defFinish: "Special",
    typeOpts: [] },
  { key: "cabinets", label: "Kitchen cabinet doors", unit: "qty", group: "Specialty",
    paint: "Dulux Aquanamel Semi-Gloss", defMethod: "Spray", defFinish: "Semi-Gloss",
    typeOpts: ["Kitchen", "Bathroom", "Laundry", "Built-ins", "All cabinets"] },
  { key: "timber_stain", label: "Timber stain clear coat", unit: "sqm", group: "Specialty",
    paint: "Sikkens Cetol TGL", defMethod: "Brush", defFinish: "Special",
    typeOpts: [] },
  { key: "firecoat", label: "Fire-rated BAL areas", unit: "sqm", group: "Specialty",
    paint: "Dulux Firecoat", defMethod: "Cut & Roll", defFinish: "Special",
    typeOpts: [] },
  // ── Specialty, added ──
  { key: "epoxy", label: "Epoxy floor coating", unit: "sqm", group: "Specialty",
    paint: "Dulux Luxafloor Epoxy", defMethod: "Cut & Roll", defFinish: "Special",
    typeOpts: ["Clear", "Solid colour", "Flake"] },
  { key: "texture", label: "Texture coating", unit: "sqm", group: "Specialty",
    paint: "Dulux Acratex", defMethod: "Spray", defFinish: "Special",
    typeOpts: ["Fine", "Medium", "Coarse", "Roll-on"] },
  { key: "waterproof", label: "Waterproofing membrane", unit: "sqm", group: "Specialty",
    paint: "Dulux Construction Wet Area Membrane", defMethod: "Cut & Roll", defFinish: "Special",
    typeOpts: ["Balcony", "Wet area", "Planter box", "Retaining wall"] },
  { key: "rust", label: "Rust treatment and metal primer", unit: "sqm", group: "Specialty",
    paint: "Dulux Metalshield Zinc Primer", defMethod: "Brush", defFinish: "Special",
    typeOpts: ["Spot treatment", "Full prime", "Converter"] },
  { key: "venetian", label: "Venetian plaster and microcement", unit: "sqm", group: "Specialty",
    paint: "Venetian Plaster", defMethod: "Brush", defFinish: "Special",
    typeOpts: ["Venetian", "Microcement", "Tadelakt", "Polished"] },
  { key: "antigraffiti", label: "Anti-graffiti coating", unit: "sqm", group: "Specialty",
    paint: "Dulux Anti-Graffiti Clear", defMethod: "Cut & Roll", defFinish: "Special",
    typeOpts: [] },
  { key: "linemark", label: "Line marking", unit: "lm", group: "Specialty",
    paint: "Dulux Line Marking Paint", defMethod: "Brush", defFinish: "Special",
    typeOpts: ["Car park bay", "Kerb", "Hatching", "Disabled bay"] },
  { key: "leadpaint", label: "Lead paint encapsulation", unit: "sqm", group: "Specialty",
    paint: "Dulux Sealer Binder", defMethod: "Cut & Roll", defFinish: "Special",
    typeOpts: [] },
]

/**
 * The list as shipped. SUBSTRATES itself is mutated when your own substrates
 * are registered from Settings, so this is what it is rebuilt from — otherwise
 * registering twice would append the customs twice.
 */
export const BUILTIN_SUBSTRATES: readonly Substrate[] = Object.freeze([...SUBSTRATES])

export const SUB_BY_KEY: Record<string, Substrate> =
  Object.fromEntries(SUBSTRATES.map(s => [s.key, s]))

/**
 * Bumped whenever the catalogue changes, as a dependency for anything that
 * memoises over it. Exported as `let`, which ES modules bind live, so an
 * importer sees the new value.
 */
export let substrateVersion = 0

/** Put SUBSTRATES and SUB_BY_KEY back in step after the list is rebuilt. */
export function reindexSubstrates(list: Substrate[]): void {
  SUBSTRATES.length = 0
  SUBSTRATES.push(...list)
  for (const k of Object.keys(SUB_BY_KEY)) delete SUB_BY_KEY[k]
  for (const sub of SUBSTRATES) SUB_BY_KEY[sub.key] = sub
  substrateVersion++
}

export const unitLabel = (u: SubUnit) => (u === 'sqm' ? 'm²' : u === 'lm' ? 'lin.m' : 'items')

export const GROUPS: SubGroup[] = ['Interior', 'Exterior', 'Specialty']

export const GROUP_HDR: Record<SubGroup, string> = {
  Interior: '#dbeafe', Exterior: '#fed7aa', Specialty: '#e9d5ff',
}
export const GROUP_BG: Record<SubGroup, string> = {
  Interior: '#eef5ff', Exterior: '#fff8ee', Specialty: '#f5eeff',
}
// ── Shared line model ────────────────────────────────────────
// A substrate can be broken into typed lines — e.g. Doors interior as
// French / solid / panel, each with its own quantity. Both the site visit
// and the quote builder use this shape, so a visit's takeoff transfers 1:1.

export type SubLine = { id: string; type: string; qty: number; notes: string }
export type SubEntry = { inc: boolean; lines: SubLine[]; coat?: CoatSettings }

// ── Per-substrate coating settings (V16 qapp/quc/qucapp/qfin/qucc/qtop/qcol) ──
export const UC_OPTS = ['None', 'Acrylic', 'Oil-based', 'Shellac', 'Special']
export const COLOUR_OPTS = ['Same/Similar', 'Moderate change', 'Dramatic change', 'Special colour']

export type CoatSettings = {
  app: string       // application method for the top coats
  uc: string        // undercoat type, 'None' when there is no undercoat
  ucApp: string     // application method for the undercoat
  fin: string       // finish / sheen
  ucCoats: number
  topCoats: number
  colour: string
}

/** V16 defaults: undercoat None, UC application Brush, 0 undercoat and 2 top
 *  coats, application and finish from the substrate's own defaults. */
export const defaultCoat = (s: Substrate | undefined): CoatSettings => ({
  app: s?.defMethod ?? 'Brush',
  uc: 'None',
  ucApp: 'Brush',
  fin: s?.defFinish ?? 'Low Sheen',
  ucCoats: s?.defUCoats ?? 0,
  topCoats: s?.defTopCoats ?? 2,
  colour: 'Same/Similar',
})

/** The settings for a substrate, falling back to its defaults. */
export const coatOf = (subs: Record<string, SubEntry>, key: string): CoatSettings =>
  subs?.[key]?.coat ?? defaultCoat(SUB_BY_KEY[key])

let lineSeq = 0
export const newSubLine = (): SubLine =>
  ({ id: `ln${Date.now().toString(36)}${lineSeq++}`, type: '', qty: 0, notes: '' })

export const emptySubstrates = (): Record<string, SubEntry> =>
  Object.fromEntries(SUBSTRATES.map(s => [s.key, { inc: false, lines: [newSubLine()], coat: defaultCoat(s) }]))

export const subTotal = (e: SubEntry | undefined) =>
  (e?.lines ?? []).reduce((t, l) => t + (Number(l.qty) || 0), 0)

/** Totals per substrate key, for substrates that are ticked and have quantity. */
export function substrateTotals(subs: Record<string, SubEntry>): Record<string, number> {
  const out: Record<string, number> = {}
  Object.entries(subs ?? {}).forEach(([k, e]) => {
    if (!e?.inc) return
    const t = subTotal(e)
    if (t > 0) out[k] = t
  })
  return out
}

/**
 * Accept older shapes: a plain {key: number} map, or per-line sqm/lm/qty
 * fields from the first site visit editor.
 */
export function normaliseSubstrates(raw: any): Record<string, SubEntry> {
  const base = emptySubstrates()
  if (!raw || typeof raw !== 'object') return base
  Object.entries(raw).forEach(([k, v]: [string, any]) => {
    if (!(k in base)) return
    if (typeof v === 'number') {
      base[k] = v > 0 ? { inc: true, lines: [{ ...newSubLine(), qty: v }] } : base[k]
      return
    }
    if (!v) return
    const lines: SubLine[] = Array.isArray(v.lines) && v.lines.length
      ? v.lines.map((l: any) => ({
          ...newSubLine(),
          type: l.type ?? '',
          notes: l.notes ?? '',
          // older lines split the number across sqm / lm / qty
          qty: Number(l.qty ?? 0) || Number(l.sqm ?? 0) || Number(l.lm ?? 0) || 0,
        }))
      : [newSubLine()]
    // Quotes saved before per-substrate coating settings existed get the defaults.
    base[k] = { inc: !!v.inc, lines, coat: { ...defaultCoat(SUB_BY_KEY[k]), ...(v.coat ?? {}) } }
  })
  return base
}

/** One "Label (type): qty unit" line per typed entry, for AI prompts and scope text. */
/** A product and colour named by an architect's finishes schedule. */
export type FinishSpec = { product?: string; colour?: string }

export function substrateLines(
  subs: Record<string, SubEntry>,
  /** Overrides the substrate's default paint where a schedule specified one. */
  specs?: Record<string, FinishSpec>,
): string[] {
  const out: string[] = []
  SUBSTRATES.forEach(s => {
    const e = subs?.[s.key]
    if (!e?.inc) return
    e.lines.forEach(l => {
      const qty = Number(l.qty) || 0
      if (qty <= 0) return
      const name = l.type ? `${s.label} — ${l.type}` : s.label
      // Describe what was actually specified, not the substrate's defaults
      const c = coatOf(subs, s.key)
      const uc = c.uc !== 'None' ? `${c.ucCoats} x ${c.uc} undercoat (${c.ucApp}) + ` : ''
      const spec = specs?.[s.key]
      const paint = spec?.product || s.paint
      const colour = spec?.colour ? ` in ${spec.colour}` : ''
      out.push(`${name}: ${qty} ${unitLabel(s.unit)} — ${paint}${colour}, ${c.app}, ${uc}${c.topCoats} x ${c.fin}${l.notes ? ` (${l.notes})` : ''}`)
    })
  })
  return out
}

/**
 * Square metres of paintable surface per unit — the girth allowances a
 * painter uses to turn a count or a length into an area for paint volume.
 *
 * The quote builder used one blanket rule for all of them: a lineal metre was
 * 0.3 m2 and anything counted was 2 m2. Those are the trim substrates, and
 * trim is what gets semi-gloss, so the error landed almost entirely on one
 * product. A 90mm skirting is 0.11 m2 a metre, not 0.3, and an architraved
 * opening is about half a square metre, not two — so a typical interior asked
 * for roughly three times the semi-gloss it needed.
 *
 * An area substrate is 1.0 by definition and is listed so the guard below can
 * check every key is accounted for. Two break that: a privacy screen and a
 * lattice panel are measured as the face area you can see, but painted on both
 * faces and around every batten or slat edge, so a square metre of lattice
 * really does take a bit over two square metres of paint.
 */
export const AREA_PER_UNIT: Record<string, number> = {
  // ── Interior ──
  ceilings: 1, walls: 1, feature: 1, wet_ceil: 1, wet_walls: 1, laundry: 1,
  cornice: 0.15,        // 90mm cove, girth
  skirtings: 0.11,      // 90mm board: face plus the top edge
  architraves: 0.5,     // per opening — two legs and a head, roughly 5 lineal metres
  doors_i: 3.8,         // per leaf, both faces and the edges
  win_i: 1.3,           // per unit, frame and reveal
  wardrobes: 4.5,       // per unit, doors and the visible frame

  // ── Exterior ──
  weatherboards: 1, cladding: 1, render: 1, eaves: 1, roof: 1,
  decks: 1, deck_paint: 1, driveway: 1,
  fascia: 0.25,
  gutters: 0.2,         // the face only; the inside is not coated
  downpipes: 0.9,       // per pipe, a 100mm round over a storey
  posts: 1.0,           // per post, 90x90 over a storey
  balustrades: 1.0,     // per lineal metre, rails and balusters both sides
  doors_e: 4.0,
  garage_e: 8.0,        // a double panel; halve it for a single
  fences: 1.8,          // per lineal metre, one side of a 1.8m fence
  win_e: 1.5,
  architraves_e: 0.5,

  // ── Specialty ──
  limewash: 1, timber_stain: 1, firecoat: 1,
  cabinets: 0.9,        // per door or drawer front, both faces

  // ── Interior, added ──
  lining: 1, brick_i: 1, garage_i: 1,
  beams: 0.55,          // per lineal metre: a 190x45 dressed beam, three faces
  balustrades_i: 1.0,   // per lineal metre, rails and balusters both sides
  rails: 0.1,           // a 65mm moulding, face and edges
  bulkheads: 0.4,       // per lineal metre: a 300mm face plus its soffit
  stairs_i: 12,         // per flight: treads, risers, stringers and the underside
  sills: 0.4,           // per sill, face, nose and reveal
  shelving: 2.0,        // per cupboard or shelf run

  // ── Exterior, added ──
  pergola: 1, verandah_ceil: 1, retaining: 1, sheds: 1,
  screens: 1.8,         // per m2 of screen face: both sides and every batten edge
  lattice: 2.2,         // per m2 of lattice: both sides, and all four edges of every slat
  gates: 3.0,           // per gate, both faces and the frame
  shutters: 2.0,        // per shutter or awning frame, both faces
  stumps: 1.2,          // per stump, four faces of a 100x100 above ground
  steel_e: 0.6,         // per lineal metre of post or beam, all faces

  // ── Specialty, added ──
  epoxy: 1, texture: 1, waterproof: 1, rust: 1, venetian: 1, antigraffiti: 1, leadpaint: 1,
  linemark: 0.15,       // per lineal metre of a 100mm line
}

const AREA_MISSING = SUBSTRATES.filter(s => AREA_PER_UNIT[s.key] == null).map(s => s.key)
if (AREA_MISSING.length) {
  throw new Error(`substrates: AREA_PER_UNIT has no entry for ${AREA_MISSING.join(', ')}`)
}

/** The painted area a quantity represents, for working out paint volume. */
export const paintedArea = (key: string, qty: number): number =>
  (Number(qty) || 0) * (AREA_PER_UNIT[key] ?? 1)
