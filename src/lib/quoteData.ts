// V16 quote builder reference data — substrates, production rates, workflows.

export type Sub = { key: string; label: string; unit: 'm2' | 'lm' | 'count'; paint: string; defMethod: string; defFinish: string }

export const INT_SUBS: Sub[] = [
  { key:'ceilings',    label:'Ceilings',              unit:'m2',    paint:'Dulux Ceiling White Flat', defMethod:'Cut & Roll', defFinish:'Flat' },
  { key:'cornice',     label:'Cornice',               unit:'lm',    paint:'Dulux Ceiling White Flat', defMethod:'Brush',      defFinish:'Flat' },
  { key:'walls',       label:'Walls',                 unit:'m2',    paint:'Wash and Wear Low Sheen',  defMethod:'Cut & Roll', defFinish:'Low Sheen' },
  { key:'architraves', label:'Architraves',           unit:'count', paint:'Aquaenamel Semi-Gloss',    defMethod:'Brush',      defFinish:'Semi-Gloss' },
  { key:'skirtings',   label:'Skirting boards',       unit:'lm',    paint:'Aquaenamel Semi-Gloss',    defMethod:'Brush',      defFinish:'Semi-Gloss' },
  { key:'doors_i',     label:'Doors interior',        unit:'count', paint:'Aquaenamel Semi-Gloss',    defMethod:'Cut & Roll', defFinish:'Semi-Gloss' },
  { key:'win_i',       label:'Window frames interior',unit:'count', paint:'Aquaenamel Semi-Gloss',    defMethod:'Brush',      defFinish:'Semi-Gloss' },
  { key:'wardrobes',   label:'Built-in wardrobes',    unit:'count', paint:'Wash and Wear Low Sheen',  defMethod:'Cut & Roll', defFinish:'Low Sheen' },
  { key:'feature',     label:'Feature wall',          unit:'m2',    paint:'Wash and Wear Low Sheen',  defMethod:'Cut & Roll', defFinish:'Low Sheen' },
  { key:'wet_ceil',    label:'Wet area ceilings',     unit:'m2',    paint:'Wash and Wear Low Sheen',  defMethod:'Cut & Roll', defFinish:'Low Sheen (Wet Areas)' },
  { key:'wet_walls',   label:'Wet area walls',        unit:'m2',    paint:'Wash and Wear Low Sheen',  defMethod:'Cut & Roll', defFinish:'Low Sheen (Wet Areas)' },
  { key:'laundry',     label:'Laundry full room',     unit:'m2',    paint:'Wash and Wear Low Sheen',  defMethod:'Cut & Roll', defFinish:'Low Sheen (Wet Areas)' },
]

export const EXT_SUBS: Sub[] = [
  { key:'weatherboards', label:'Weatherboards',              unit:'m2',    paint:'Weathershield Low Sheen',   defMethod:'Brush',           defFinish:'Weathershield Low Sheen' },
  { key:'cladding',      label:'Cladding fibre cement',      unit:'m2',    paint:'Weathershield Low Sheen',   defMethod:'Brush',           defFinish:'Weathershield Low Sheen' },
  { key:'render',        label:'Render and masonry walls',   unit:'m2',    paint:'Weathershield Low Sheen',   defMethod:'Cut & Roll',      defFinish:'Weathershield Low Sheen' },
  { key:'eaves',         label:'Eaves and soffits',          unit:'m2',    paint:'Weathershield Low Sheen',   defMethod:'Cut & Roll',      defFinish:'Weathershield Low Sheen' },
  { key:'fascia',        label:'Fascia boards',              unit:'lm',    paint:'Weathershield Low Sheen',   defMethod:'Brush',           defFinish:'Weathershield Low Sheen' },
  { key:'gutters',       label:'Gutters',                    unit:'lm',    paint:'Weathershield Low Sheen',   defMethod:'Brush',           defFinish:'Weathershield Low Sheen' },
  { key:'downpipes',     label:'Downpipes',                  unit:'count', paint:'Weathershield Low Sheen',   defMethod:'Brush',           defFinish:'Weathershield Low Sheen' },
  { key:'posts',         label:'Posts and columns',          unit:'count', paint:'Weathershield Low Sheen',   defMethod:'Brush',           defFinish:'Weathershield Low Sheen' },
  { key:'balustrades',   label:'Balustrades and handrails',  unit:'lm',    paint:'Weathershield Semi-Gloss',  defMethod:'Brush',           defFinish:'Weathershield Semi-Gloss' },
  { key:'doors_e',       label:'Doors exterior',             unit:'count', paint:'Weathershield Semi-Gloss',  defMethod:'Brush',           defFinish:'Weathershield Semi-Gloss' },
  { key:'garage_e',      label:'Garage doors',               unit:'count', paint:'Weathershield Low Sheen',   defMethod:'Spray',           defFinish:'Weathershield Low Sheen' },
  { key:'fences',        label:'Fences',                     unit:'lm',    paint:'Weathershield Low Sheen',   defMethod:'Brush',           defFinish:'Weathershield Low Sheen' },
  { key:'decks',         label:'Deck/stairs hardwood (oil)', unit:'m2',    paint:'Cutek CD50',                defMethod:'Deck Applicator', defFinish:'Decking Oil' },
  { key:'deck_paint',    label:'Deck/stairs painted',        unit:'m2',    paint:'Taubmans All Weather Deck', defMethod:'Cut & Roll',      defFinish:'Decking Paint Satin (Anti-slip)' },
  { key:'driveway',      label:'Driveway / concrete floors', unit:'m2',    paint:'Super Grip Medium',         defMethod:'Cut & Roll',      defFinish:'Concrete & Paving Satin (Anti-slip)' },
  { key:'roof',          label:'Roof',                       unit:'m2',    paint:'Dulux Roof and Trim',       defMethod:'Spray',           defFinish:'Roof Membrane Satin' },
  { key:'win_e',         label:'Window frames exterior',     unit:'count', paint:'Weathershield Semi-Gloss',  defMethod:'Brush',           defFinish:'Weathershield Semi-Gloss' },
  { key:'architraves_e', label:'Architraves exterior',       unit:'count', paint:'Weathershield Semi-Gloss',  defMethod:'Brush',           defFinish:'Weathershield Semi-Gloss' },
]

export const SPEC_SUBS: Sub[] = [
  { key:'limewash',     label:'Limewash Bauwerk',        unit:'m2',    paint:'Bauwerk Limewash',      defMethod:'Brush',      defFinish:'Special' },
  { key:'cabinets',     label:'Kitchen cabinet doors',   unit:'count', paint:'Aquaenamel Semi-Gloss', defMethod:'Spray',      defFinish:'Semi-Gloss' },
  { key:'timber_stain', label:'Timber stain clear coat', unit:'m2',    paint:'Sikkens Cetol TGL',     defMethod:'Brush',      defFinish:'Special' },
  { key:'firecoat',     label:'Fire-rated BAL areas',    unit:'m2',    paint:'Dulux Firecoat',        defMethod:'Cut & Roll', defFinish:'Special' },
]

export const APP_OPTS = ['Brush', 'Cut & Roll', 'Spray', 'Spray + Backroll', 'Roll', 'Deck Applicator']
export const FINISH_OPTS = [
  'Flat', 'Low Sheen', 'Semi-Gloss', 'Gloss', 'Low Sheen (Wet Areas)',
  'Weathershield Low Sheen', 'Weathershield Semi-Gloss', 'Decking Oil',
  'Decking Paint Satin (Anti-slip)', 'Concrete & Paving Satin (Anti-slip)',
  'Roof Membrane Satin', 'Special',
]

// Hours per unit at medium prep, 2 coats
export const PROD_RATES: Record<string, number> = {
  ceilings: 0.050, cornice: 0.060, walls: 0.060, architraves: 0.50, skirtings: 0.050,
  doors_i: 1.00, win_i: 0.50, wardrobes: 1.50, feature: 0.070, laundry: 0.080,
  wet_ceil: 0.060, wet_walls: 0.070,
  weatherboards: 0.120, cladding: 0.075, render: 0.060, eaves: 0.100, fascia: 0.070,
  gutters: 0.050, downpipes: 0.50, posts: 0.50, balustrades: 0.100, doors_e: 1.50,
  garage_e: 2.00, fences: 0.080, decks: 0.100, deck_paint: 0.100, driveway: 0.060,
  roof: 0.080, win_e: 1.00, architraves_e: 0.50,
  limewash: 0.150, cabinets: 1.00, timber_stain: 0.100, firecoat: 0.080,
}

export const JOB_TYPES = [
  'Interior repaint', 'Exterior repaint', 'Full repaint interior and exterior',
  'New build interior', 'New build exterior', 'New build full',
  'Deck and timber coating', 'Limewash and specialty', 'Kitchen cabinets',
  'Roof coating', 'Concrete and driveway', 'Queenslander restoration',
  'Multi-unit commercial',
]

export const QUOTE_TERMS = ['Labour and materials', 'Labour only', 'Hourly rate', 'Estimate']

export const PREP_OPTS = [
  'Light — good condition, minor prep',
  'Medium — some patching and gapping',
  'Heavy — significant repairs and peeling',
  'Restoration and full strip',
  'New build — priming required',
]
export const HEIGHT_OPTS = ['Standard 2.4m', 'Medium 2.7m', 'High 3m plus', 'Raked and vaulted']
export const ACCESS_OPTS = [
  'Standard — ladders only',
  'Moderate — some trestles and scaffold',
  'High — full scaffold and roof access',
]
export const METHOD_OPTS = [
  { v: 'roll', l: 'Brush & Roll' },
  { v: 'spray', l: 'Spray' },
  { v: 'both', l: 'Spray + Back-roll' },
]
export const CONS_PREP = [
  { v: 'light', l: 'Light — clean and paint only' },
  { v: 'medium', l: 'Medium — sand, fill, spot prime' },
  { v: 'heavy', l: 'Heavy — full strip, major repairs, prime all' },
  { v: 'new_build', l: 'New build — prime and finish only' },
]

// ── Workflow templates ───────────────────────────────────────
// Verbatim from V16 JOB_WORKFLOWS. Every job type opens with a Prep phase whose
// items each carry their own default level; the remaining phases are plain
// steps. "Load process steps" emits one row per non-None prep item plus one per
// later phase, which is what produces the quote's labour breakdown.
export const PREP_LEVELS = ['None', 'Low', 'Medium', 'High', 'Full']

export type PrepItem = { id: string; label: string; def: string }
export type Phase = { id: string; name: string; isPrep?: boolean; items?: PrepItem[] }

export const JOB_WORKFLOWS: Record<string, { phases: Phase[] }> = {
  'Interior repaint': { phases: [
    { id:'prep', name:'Prep', isPrep:true, items:[
      { id:'site_setup', label:'Site set up',                     def:'None' },
      { id:'cleaning',   label:'Cleaning (walls, surfaces)',      def:'None' },
      { id:'furniture',  label:'Moving furniture',                def:'None' },
      { id:'masking',    label:'Covering and masking',            def:'None' },
      { id:'filling',    label:'Filling, sanding and dusting off',def:'None' },
      { id:'gapping',    label:'Gapping',                         def:'None' },
      { id:'spot_prime', label:'Spot priming and stain blocking', def:'None' },
    ]},
    { id:'ceilings', name:'Ceilings' },
    { id:'trims',    name:'Trims and doors (semi-gloss)' },
    { id:'walls',    name:'Walls' },
    { id:'touchups', name:'Touch ups' },
    { id:'cleanup',  name:'Clean up and pack up' },
  ]},
  'Exterior repaint': { phases: [
    { id:'prep', name:'Prep', isPrep:true, items:[
      { id:'site_setup',  label:'Site set up',                     def:'Low' },
      { id:'press_wash',  label:'Pressure washing',                def:'Medium' },
      { id:'mould_treat', label:'Mould treating',                  def:'Low' },
      { id:'masking',     label:'Covering and masking',            def:'Medium' },
      { id:'filling',     label:'Filling, sanding and dusting off',def:'Medium' },
      { id:'gapping',     label:'Gapping',                         def:'Low' },
      { id:'spot_prime',  label:'Spot priming and stain blocking', def:'Low' },
      { id:'rust_treat',  label:'Rust treating',                   def:'None' },
    ]},
    { id:'roof',     name:'Roof' },
    { id:'gutters',  name:'Gutters' },
    { id:'fascia',   name:'Fascia boards' },
    { id:'eaves',    name:'Eaves and soffits' },
    { id:'gables',   name:'Gables' },
    { id:'walls',    name:'Walls (weatherboards, cladding, rendered)' },
    { id:'trims',    name:'Architraves, frames, windows, doors, handrails' },
    { id:'floors',   name:'Floors, decks, hardwood oiling, concrete, driveway, steps' },
    { id:'touchups', name:'Touch ups' },
    { id:'cleanup',  name:'Clean up and pack up' },
  ]},
  'Full repaint interior and exterior': { phases: [
    { id:'prep', name:'Prep', isPrep:true, items:[
      { id:'site_setup',  label:'Site set up',                     def:'Low' },
      { id:'cleaning',    label:'Cleaning (internal surfaces)',    def:'Medium' },
      { id:'furniture',   label:'Moving furniture',                def:'Low' },
      { id:'press_wash',  label:'Pressure washing (exterior)',     def:'Medium' },
      { id:'mould_treat', label:'Mould treating',                  def:'Low' },
      { id:'masking',     label:'Covering and masking',            def:'Medium' },
      { id:'filling',     label:'Filling, sanding and dusting off',def:'Medium' },
      { id:'gapping',     label:'Gapping',                         def:'Low' },
      { id:'spot_prime',  label:'Spot priming and stain blocking', def:'Low' },
      { id:'rust_treat',  label:'Rust treating',                   def:'None' },
    ]},
    { id:'ceilings', name:'Ceilings' },
    { id:'trims_i',  name:'Trims and doors — interior (semi-gloss)' },
    { id:'walls_i',  name:'Walls — interior' },
    { id:'roof',     name:'Roof' },
    { id:'gutters',  name:'Gutters' },
    { id:'fascia',   name:'Fascia boards' },
    { id:'eaves',    name:'Eaves and soffits' },
    { id:'gables',   name:'Gables' },
    { id:'walls_e',  name:'Walls — exterior' },
    { id:'trims_e',  name:'Architraves, frames, windows, doors, handrails (exterior)' },
    { id:'floors',   name:'Floors, decks, hardwood oiling, concrete, driveway, steps' },
    { id:'touchups', name:'Touch ups' },
    { id:'cleanup',  name:'Clean up and pack up' },
  ]},
  'New build interior': { phases: [
    { id:'prep', name:'Prep', isPrep:true, items:[
      { id:'site_setup', label:'Site set up',                     def:'None' },
      { id:'masking',    label:'Covering and masking',            def:'None' },
      { id:'filling',    label:'Filling, sanding and dusting off',def:'None' },
    ]},
    { id:'undercoat', name:'Spray undercoat to all substrates (1 coat Acrylic)' },
    { id:'gapping',   name:'Gapping (after undercoat)' },
    { id:'ceilings',  name:'Ceilings' },
    { id:'trims',     name:'Trims and doors (semi-gloss)' },
    { id:'walls',     name:'Walls' },
    { id:'touchups',  name:'Touch ups' },
    { id:'cleanup',   name:'Clean up and pack up' },
  ]},
  'New build exterior': { phases: [
    { id:'prep', name:'Prep', isPrep:true, items:[
      { id:'site_setup', label:'Site set up',                     def:'None' },
      { id:'masking',    label:'Covering and masking',            def:'None' },
      { id:'filling',    label:'Filling, sanding and dusting off',def:'None' },
    ]},
    { id:'undercoat', name:'Spray/brush undercoat to all substrates (1 coat Acrylic)' },
    { id:'gapping',   name:'Gapping (after undercoat)' },
    { id:'gutters',   name:'Gutters' },
    { id:'fascia',    name:'Fascia boards' },
    { id:'eaves',     name:'Eaves and soffits' },
    { id:'gables',    name:'Gables' },
    { id:'walls',     name:'Walls (weatherboards, cladding, rendered)' },
    { id:'trims',     name:'Architraves, frames, windows, doors, handrails' },
    { id:'floors',    name:'Floors, decks, concrete, driveway, steps' },
    { id:'touchups',  name:'Touch ups' },
    { id:'cleanup',   name:'Clean up and pack up' },
  ]},
  'New build full': { phases: [
    { id:'prep', name:'Prep', isPrep:true, items:[
      { id:'site_setup', label:'Site set up',                     def:'None' },
      { id:'masking',    label:'Covering and masking',            def:'None' },
      { id:'filling',    label:'Filling, sanding and dusting off',def:'None' },
    ]},
    { id:'undercoat', name:'Spray undercoat to all substrates (1 coat Acrylic)' },
    { id:'gapping',   name:'Gapping (after undercoat)' },
    { id:'ceilings',  name:'Ceilings' },
    { id:'trims_i',   name:'Trims and doors — interior (semi-gloss)' },
    { id:'walls_i',   name:'Walls — interior' },
    { id:'gutters',   name:'Gutters' },
    { id:'fascia',    name:'Fascia boards' },
    { id:'eaves',     name:'Eaves and soffits' },
    { id:'gables',    name:'Gables' },
    { id:'walls_e',   name:'Walls — exterior' },
    { id:'trims_e',   name:'Architraves, frames, windows, doors, handrails (exterior)' },
    { id:'floors',    name:'Floors, decks, concrete, driveway, steps' },
    { id:'touchups',  name:'Touch ups' },
    { id:'cleanup',   name:'Clean up and pack up' },
  ]},
  'Deck and timber coating': { phases: [
    { id:'prep', name:'Prep', isPrep:true, items:[
      { id:'cleaning', label:'Cleaning',    def:'High' },
      { id:'sanding',  label:'Sanding',     def:'High' },
      { id:'dusting',  label:'Dusting off', def:'Medium' },
    ]},
    { id:'coating', name:'Coating (oil or paint)' },
    { id:'cleanup', name:'Clean up and pack up' },
  ]},
  'Limewash and specialty': { phases: [
    { id:'prep', name:'Prep', isPrep:true, items:[
      { id:'site_setup', label:'Site set up',         def:'Low' },
      { id:'furniture',  label:'Moving furniture',    def:'Low' },
      { id:'masking',    label:'Masking and covering',def:'Medium' },
      { id:'patching',   label:'Patching and sanding',def:'Medium' },
      { id:'gapping',    label:'Gapping',             def:'Low' },
    ]},
    { id:'undercoat', name:'Acrylic undercoat' },
    { id:'base',      name:'Special base coat' },
    { id:'limewash',  name:'Limewash coating' },
    { id:'cleanup',   name:'Clean up and pack up' },
  ]},
  'Kitchen cabinets': { phases: [
    { id:'prep', name:'Prep', isPrep:true, items:[
      { id:'site_setup', label:'Site set up',                 def:'Low' },
      { id:'furniture',  label:'Moving furniture',            def:'Low' },
      { id:'masking',    label:'Masking and covering',        def:'Medium' },
      { id:'doors_hw',   label:'Removing doors and hardware', def:'Medium' },
      { id:'degreasing', label:'Degreasing',                  def:'High' },
    ]},
    { id:'primer',   name:'Primer coat' },
    { id:'topcoats', name:'Top coats' },
    { id:'cleanup',  name:'Clean up and pack up' },
  ]},
  'Roof coating': { phases: [
    { id:'prep', name:'Prep', isPrep:true, items:[
      { id:'press_wash', label:'Pressure washing',     def:'High' },
      { id:'rust_treat', label:'Rust treating',        def:'Medium' },
      { id:'masking',    label:'Masking and covering', def:'Medium' },
    ]},
    { id:'priming',    name:'Priming' },
    { id:'topcoating', name:'Top coating' },
    { id:'touchups',   name:'Touch ups' },
    { id:'cleanup',    name:'Clean up and pack up' },
  ]},
  'Concrete and driveway': { phases: [
    { id:'prep', name:'Prep', isPrep:true, items:[
      { id:'site_setup', label:'Site set up',                   def:'Low' },
      { id:'moving',     label:'Moving stuff',                  def:'Low' },
      { id:'press_wash', label:'Cleaning and pressure washing', def:'High' },
      { id:'etch_prime', label:'Etch priming',                  def:'Medium' },
      { id:'acid_wash',  label:'Acid washing',                  def:'None' },
      { id:'masking',    label:'Masking and covering',          def:'Medium' },
    ]},
    { id:'sealer',     name:'Sealer coat' },
    { id:'topcoating', name:'Top coating' },
    { id:'touchups',   name:'Touch ups' },
    { id:'cleanup',    name:'Clean up and pack up' },
  ]},
  'Queenslander restoration': { phases: [
    { id:'prep', name:'Prep', isPrep:true, items:[
      { id:'site_setup',    label:'Site set up',                  def:'Low' },
      { id:'moving',        label:'Moving stuff',                 def:'Low' },
      { id:'masking',       label:'Covering and masking',         def:'Medium' },
      { id:'stripping',     label:'Paint stripping and scraping', def:'Full' },
      { id:'oil_prime',     label:'Oil base priming',             def:'Full' },
      { id:'filling',       label:'Filling and sanding',          def:'High' },
      { id:'grain_fill',    label:'Grain filling',                def:'Medium' },
      { id:'acrylic_prime', label:'Acrylic priming',              def:'Full' },
      { id:'gapping',       label:'Gapping',                      def:'Medium' },
    ]},
    { id:'roof',     name:'Roof' },
    { id:'gutters',  name:'Gutters' },
    { id:'fascia',   name:'Fascia boards' },
    { id:'eaves',    name:'Eaves and soffits' },
    { id:'gables',   name:'Gables' },
    { id:'walls',    name:'Walls (weatherboards, cladding)' },
    { id:'trims',    name:'Architraves, frames, windows, doors, handrails' },
    { id:'floors',   name:'Floors, decks, steps' },
    { id:'touchups', name:'Touch ups' },
    { id:'cleanup',  name:'Clean up and pack up' },
  ]},
  'Multi-unit commercial': { phases: [
    { id:'prep', name:'Prep', isPrep:true, items:[
      { id:'site_setup', label:'Site set up',                     def:'Low' },
      { id:'masking',    label:'Covering and masking',            def:'Medium' },
      { id:'filling',    label:'Filling, sanding and dusting off',def:'Medium' },
      { id:'gapping',    label:'Gapping',                         def:'Low' },
      { id:'spot_prime', label:'Spot priming and stain blocking', def:'Low' },
    ]},
    { id:'ceilings', name:'Ceilings' },
    { id:'trims',    name:'Trims and doors (semi-gloss)' },
    { id:'walls',    name:'Walls' },
    { id:'touchups', name:'Touch ups' },
    { id:'cleanup',  name:'Clean up and pack up' },
  ]},
}

/** V16 loadWorkflowSteps() — prep items at their chosen level, then each phase. */
export function workflowStepNames(jobType: string, levels: Record<string, string>): string[] {
  const wf = JOB_WORKFLOWS[jobType]
  if (!wf) return []
  const out: string[] = []
  wf.phases.forEach(ph => {
    if (ph.isPrep) {
      ph.items?.forEach(item => {
        const level = levels[`${ph.id}-${item.id}`] ?? item.def
        if (level === 'None') return
        out.push(`Prep — ${item.label} [${level}]`)
      })
    } else {
      out.push(ph.name)
    }
  })
  return out
}

/** The default prep level for every item of a job type's prep phase. */
export function defaultPrepLevels(jobType: string): Record<string, string> {
  const wf = JOB_WORKFLOWS[jobType]
  const out: Record<string, string> = {}
  wf?.phases.forEach(ph => {
    if (!ph.isPrep) return
    ph.items?.forEach(item => { out[`${ph.id}-${item.id}`] = item.def })
  })
  return out
}

export const BENCHMARKS: [string, string][] = [
  ['Interior small', '$2,400 to $6,700'],
  ['Interior medium', '$7,700 to $16,500'],
  ['Exterior medium', '$13,900 to $21,800'],
  ['Exterior large', '$37,000 plus'],
  ['Full repaint', '$18,800 to $38,000'],
  ['Queenslander', '$38,500'],
  ['New build ext', '$21,400 plus'],
  ['Multi-unit', '$21,400 to $137,000'],
  ['Deck and timber', '$5,100 plus'],
  ['Hourly rate', '$70 to $75 per hr'],
]
