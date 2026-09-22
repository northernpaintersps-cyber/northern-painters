// V16 _SV_SUB_CFG — the site visit substrate checklist.
// Labels and units match the quote builder's substrate lists so a visit
// can be carried straight into a quote.
export type SVSub = {
  key: string; label: string
  unit: 'sqm' | 'lm' | 'qty'
  group: 'Interior' | 'Exterior' | 'Specialty'
  typeOpts?: string[]
}

export const SV_SUBS: SVSub[] = [
  { key: "ceilings", label: "Ceilings", unit: "sqm", group: "Interior" },
  { key: "cornice", label: "Cornice", unit: "lm", group: "Interior" },
  { key: "walls", label: "Walls", unit: "sqm", group: "Interior" },
  { key: "architraves", label: "Architraves", unit: "qty", group: "Interior", typeOpts: ["Timber", "MDF", "Colonial", "Bar", "Bullnose", "Pencil Round"] },
  { key: "skirtings", label: "Skirting boards", unit: "lm", group: "Interior" },
  { key: "doors_i", label: "Doors interior", unit: "qty", group: "Interior", typeOpts: ["Hollow core", "Solid timber", "Panel", "Glass", "French", "Bi-fold", "Sliding", "Louvre", "Barn", "Pocket"] },
  { key: "win_i", label: "Window frames interior", unit: "qty", group: "Interior", typeOpts: ["Timber", "Aluminium", "uPVC", "Louvre", "Awning", "Casement", "Double-hung", "Sliding", "Fixed"] },
  { key: "wardrobes", label: "Built-in wardrobes", unit: "qty", group: "Interior" },
  { key: "feature", label: "Feature wall", unit: "sqm", group: "Interior" },
  { key: "wet_ceil", label: "Wet area ceilings", unit: "sqm", group: "Interior" },
  { key: "wet_walls", label: "Wet area walls", unit: "sqm", group: "Interior" },
  { key: "laundry", label: "Laundry full room", unit: "sqm", group: "Interior" },
  { key: "weatherboards", label: "Weatherboards", unit: "sqm", group: "Exterior", typeOpts: ["Timber", "Fibre cement", "T&G", "Shiplap", "Chamfer"] },
  { key: "cladding", label: "Cladding fibre cement", unit: "sqm", group: "Exterior", typeOpts: ["Colorbond", "Timber", "Composite", "Fibre cement", "Hardiplank"] },
  { key: "render", label: "Render and masonry walls", unit: "sqm", group: "Exterior" },
  { key: "eaves", label: "Eaves and soffits", unit: "sqm", group: "Exterior" },
  { key: "fascia", label: "Fascia boards", unit: "lm", group: "Exterior" },
  { key: "gutters", label: "Gutters", unit: "lm", group: "Exterior" },
  { key: "downpipes", label: "Downpipes", unit: "qty", group: "Exterior" },
  { key: "posts", label: "Posts and columns", unit: "qty", group: "Exterior" },
  { key: "balustrades", label: "Balustrades and handrails", unit: "lm", group: "Exterior" },
  { key: "doors_e", label: "Doors exterior", unit: "qty", group: "Exterior", typeOpts: ["Solid timber", "Panel", "Screen", "French", "Bi-fold", "Sliding", "Security", "Louvre"] },
  { key: "garage_e", label: "Garage doors", unit: "qty", group: "Exterior", typeOpts: ["Panel lift", "Roller", "Tilt", "Timber", "Sectional"] },
  { key: "fences", label: "Fences", unit: "lm", group: "Exterior" },
  { key: "decks", label: "Deck/stairs hardwood (oil)", unit: "sqm", group: "Exterior" },
  { key: "deck_paint", label: "Deck/stairs painted", unit: "sqm", group: "Exterior" },
  { key: "driveway", label: "Driveway / concrete floors", unit: "sqm", group: "Exterior" },
  { key: "roof", label: "Roof", unit: "sqm", group: "Exterior", typeOpts: ["Colorbond / Tin", "Terracotta tile", "Concrete tile", "Zincalume", "Corrugated iron"] },
  { key: "win_e", label: "Window frames exterior", unit: "qty", group: "Exterior", typeOpts: ["Timber", "Aluminium", "uPVC", "Awning", "Casement", "Louvre", "Double-hung", "Sliding", "Fixed"] },
  { key: "limewash", label: "Limewash", unit: "sqm", group: "Specialty" },
  { key: "cabinets", label: "Kitchen cabinet doors", unit: "qty", group: "Specialty", typeOpts: ["Kitchen", "Bathroom", "Laundry", "Built-ins", "All cabinets"] },
  { key: "timber_stain", label: "Timber stain clear coat", unit: "sqm", group: "Specialty" },
  { key: "firecoat", label: "Fire-rated BAL areas", unit: "sqm", group: "Specialty" },
]

export const SV_GROUP_HDR: Record<string, string> = {
  Interior: '#dbeafe', Exterior: '#fed7aa', Specialty: '#e9d5ff',
}
export const SV_GROUP_BG: Record<string, string> = {
  Interior: '#eef5ff', Exterior: '#fff8ee', Specialty: '#f5eeff',
}

export const SV_CONDITIONS = ['Good', 'Fair', 'Poor', 'New']
export const SV_PHOTO_TAGS = ['before', 'after', 'reference', 'detail'] as const
export const SV_TAG_BG: Record<string, string> = {
  before: '#dbeafe', after: '#dcfce7', reference: '#fef3c7', detail: '#f3e8ff',
}
export const SV_TAG_FG: Record<string, string> = {
  before: '#1e40af', after: '#166534', reference: '#92400e', detail: '#5b21b6',
}
