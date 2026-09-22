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

// Workflow templates per job type — the phase list AI then estimates hours for
export const WORKFLOWS: Record<string, string[]> = {
  'Interior repaint': ['Setup and protection', 'Prep — sand, fill, gap', 'Spot prime', 'Ceilings — 2 coats', 'Walls — 2 coats', 'Trims, doors and architraves', 'Detail and touch-ups', 'Clean up and handover'],
  'Exterior repaint': ['Setup and access', 'Pressure wash', 'Scrape, sand and prep', 'Prime bare areas', 'Fascia, gutters and eaves', 'Walls/cladding — 2 coats', 'Doors, windows and trims', 'Detail and clean up'],
  'Full repaint interior and exterior': ['Setup and protection', 'Exterior wash and prep', 'Exterior prime and coat', 'Interior prep', 'Ceilings and walls', 'Trims and doors', 'Detail and touch-ups', 'Clean up and handover'],
  'New build interior': ['Setup and protection', 'Fill and sand', 'Seal/prime all surfaces', 'Ceilings — 2 coats', 'Walls — 2 coats', 'Trims, doors and architraves', 'Final detail', 'Clean up and handover'],
  'New build exterior': ['Setup and access', 'Prime all surfaces', 'Cladding — 2 coats', 'Fascia, eaves and gutters', 'Doors, windows and trims', 'Detail and clean up'],
  'New build full': ['Setup and protection', 'Exterior prime and coat', 'Interior seal and prime', 'Ceilings and walls', 'Trims and doors', 'Final detail', 'Clean up and handover'],
  'Deck and timber coating': ['Setup and protection', 'Clean and strip', 'Sand and prep', 'Apply oil/coating — coat 1', 'Apply oil/coating — coat 2', 'Detail and clean up'],
  'Limewash and specialty': ['Setup and protection', 'Surface prep', 'Base/primer coat', 'Limewash application', 'Finish and detail', 'Clean up'],
  'Kitchen cabinets': ['Setup and masking', 'Remove and label doors', 'Degrease, sand and prep', 'Prime', 'Spray finish coats', 'Reinstall and detail'],
  'Roof coating': ['Setup and roof access', 'Pressure clean', 'Repairs and primer', 'Membrane — coat 1', 'Membrane — coat 2', 'Detail and clean up'],
  'Concrete and driveway': ['Setup and protection', 'Degrease and pressure clean', 'Etch and prep', 'Primer coat', 'Top coats', 'Clean up'],
  'Queenslander restoration': ['Setup and full access', 'Pressure wash', 'Strip and scrape', 'Timber repairs and filling', 'Prime all bare timber', 'Weatherboards — 2 coats', 'Trims, lattice and detail', 'Clean up and handover'],
  'Multi-unit commercial': ['Setup, access and staging', 'Prep and make good', 'Prime', 'Ceilings and walls', 'Trims and doors', 'Common areas', 'Detail and defects', 'Clean up and handover'],
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
