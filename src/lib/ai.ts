// AI utilities — calls Anthropic Claude API directly from the browser
// using the key stored in business settings (np_settings key='business')

import { normaliseLineItems, reconcileGst, type InvoiceLineItem } from './utils'

export type { InvoiceLineItem }

export interface InvoiceExtraction {
  supplier: string
  description: string
  date: string
  receipt_no: string
  cost_ex_gst: number | null
  gst: number | null
  total_inc_gst: number | null
  category: string
  notes: string
  /** Delivery or site address printed on the invoice, used to auto-match a job. */
  job_address: string
  items: InvoiceLineItem[]
}

async function callClaude(
  apiKey: string, messages: any[], system?: string,
  opts?: {
    model?: string; maxTokens?: number; temperature?: number
    /** Forces the reply through a schema, so the result is always valid JSON. */
    tool?: { name: string; description: string; input_schema: any }
  },
): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: opts?.model ?? 'claude-haiku-4-5-20251001',
      max_tokens: opts?.maxTokens ?? 1024,
      system: system ?? 'You are a helpful assistant for a painting business in Australia.',
      messages,
      ...(opts?.temperature != null ? { temperature: opts.temperature } : {}),
      ...(opts?.tool ? { tools: [opts.tool], tool_choice: { type: 'tool', name: opts.tool.name } } : {}),
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as any)?.error?.message ?? `API error ${res.status}`)
  }

  const data = await res.json()
  if (opts?.tool) {
    const block = data.content?.find((c: any) => c.type === 'tool_use')
    if (!block) throw new Error('AI did not return structured data. Try again.')
    return JSON.stringify(block.input ?? {})
  }
  return data.content?.find((c: any) => c.type === 'text')?.text ?? data.content?.[0]?.text ?? ''
}

/** Shrink a large photo before sending. A phone shot can be 10MB+, which makes
 *  the request slow and can push it past the API's size limit; the service
 *  downscales past ~1568px anyway, so nothing legible is lost. */
async function shrinkImage(file: File, maxEdge = 1568): Promise<Blob> {
  if (!file.type.startsWith('image/')) return file
  const bitmap = await createImageBitmap(file).catch(() => null)
  if (!bitmap) return file
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
  if (scale === 1 && file.size < 4_000_000) { bitmap.close?.(); return file }
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) { bitmap.close?.(); return file }
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close?.()
  const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/jpeg', 0.92))
  return blob && blob.size < file.size ? blob : file
}

// Convert a File (image or PDF first-page) to base64 data URL parts
async function fileToBase64(file: File): Promise<{ base64: string; mediaType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const [header, base64] = result.split(',')
      const mediaType = header.replace('data:', '').replace(';base64', '')
      resolve({ base64, mediaType })
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// ── Business chat (V16 askInsights) ──────────────────────────
export type ChatTurn = { role: 'user' | 'assistant'; content: string }

export async function askBusiness(apiKey: string, history: ChatTurn[], context: string): Promise<string> {
  const system = `You are an expert business analyst and painting industry consultant for Northern Painters, a painting company based in Byron Bay, NSW, Australia. You have access to all their real business data below.

Answer questions about their jobs, costs, margins, profitability, and business performance. Be specific — use real numbers from the data. Calculate averages, rates per m², best/worst performers, trends. Format answers clearly with numbers highlighted. If you spot anything worth flagging (e.g. low-margin jobs, high material spend) mention it.

When calculating rate per m², note that substrate areas aren't always logged — work with what's available (agreed price ÷ estimated days as a proxy if needed).

${context}`

  return callClaude(apiKey, history, system, { model: 'claude-sonnet-4-6', maxTokens: 1500 })
}

// ── Quote builder AI (V16 runQuote / suggestProcesses / runConsAI) ──
export interface QuoteInput {
  client: string
  address: string
  jobType: string
  terms: string
  method: string
  coats: string
  prep: string
  ceilingHeight: string
  access: string
  travelKm: string
  equipText: string
  equipTotal: number
  substrates: string          // "Ceilings: 120 m2" lines
  labourBreakdown: string     // "Prep: 12.0 hrs ($960)" lines
  totalHours: number
  labourCost: number
  days: number
  consumables: number
  materialsBreakdown: string
  materialsTotal: number
  painterDesc: string         // "2 painters @ $65, $75/hr"
  overheadPct: number
  hoursPerDay: number
  tradePrices: string
  benchmarks: string
  siteNotes: string
  logisticsNotes: string
  photos?: Array<{ dataUrl: string; tag?: string; caption?: string }>
}

const money = (v: number) => '$' + Math.round(v).toLocaleString('en-AU')

export async function generateQuote(apiKey: string, q: QuoteInput): Promise<string> {
  const system = `You are a quoting assistant for Northern Painters, Byron Bay NSW. Dulux accredited.
IMPORTANT: Labour hours AND materials costs have been PRE-CALCULATED by the estimator. Do NOT recalculate or change either. Present them exactly as given.
PAINTERS: ${q.painterDesc}. Overhead: ${q.overheadPct}%. Hrs/day: ${q.hoursPerDay}.
TRADE PRICES: ${q.tradePrices}
${q.benchmarks}
RESPOND WITH THESE SECTIONS ONLY:
## Scope of Work
Write 2–4 sentences describing what will be done. Then list the exact phases from the PRE-CALCULATED LABOUR BREAKDOWN below, in order, as a numbered list. Do not add, remove or rename any phase — use the exact phase names as given.
## Job Plan
Reproduce the PRE-CALCULATED LABOUR BREAKDOWN as a table, exactly as given:
[table: Phase / Process | Hours | Cost ex GST]
Total: ${q.totalHours.toFixed(1)} hrs = ${money(q.labourCost)} ex GST over ~${q.days.toFixed(1)} days
## Paint Materials (pre-calculated — do not change)
[table: Product | Litres needed | Tins | Trade cost]
${q.materialsTotal ? `Total materials: ${money(q.materialsTotal)} ex GST` : ''}
## Quote Summary
[table showing: Labour ex GST | Materials ex GST | Consumables ex GST | Equipment hire ex GST | Subtotal ex GST | GST 10% | TOTAL inc GST]
## Suggested Price Range
Low / Mid / High ex GST (±10% variance)
## Assumptions and Exclusions
## Benchmark Check`

  const user = `Quote for: ${q.client || 'Unknown'} at ${q.address || 'TBC'}
Job type: ${q.jobType}
Terms: ${q.terms}
Application: ${q.method}, ${q.coats} coats
Prep: ${q.prep}
Ceiling height: ${q.ceilingHeight}
Access: ${q.access}
Travel: ${q.travelKm || '?'}km one way
Equipment hire: ${q.equipText}${q.equipTotal > 0 ? ` — ${money(q.equipTotal)} ex GST` : ''}

SUBSTRATES:
${q.substrates}

PRE-CALCULATED LABOUR BREAKDOWN (use exactly — do not recalculate):
${q.labourBreakdown || 'No breakdown available'}
TOTAL LABOUR: ${q.totalHours.toFixed(1)} hours = ${money(q.labourCost)} ex GST

CONSUMABLES (pre-estimated): ${money(q.consumables)} ex GST
${q.equipTotal > 0 ? `EQUIPMENT HIRE: ${money(q.equipTotal)} ex GST` : ''}
${q.siteNotes ? 'SITE/SCOPE NOTES: ' + q.siteNotes : ''}
${q.logisticsNotes ? 'LOGISTICS NOTES: ' + q.logisticsNotes : ''}

PRE-CALCULATED MATERIALS BREAKDOWN (present in ## Paint Materials exactly — do not recalculate):
${q.materialsBreakdown}`

  // Site visit photos give the model surface condition and access context
  let content: any = user
  if (q.photos?.length) {
    const blocks: any[] = [{
      type: 'text',
      text: `${user}\n\nSITE PHOTOS (${q.photos.length} taken during site visit — use these to assess surface condition, prep requirements, access, and scope):`,
    }]
    q.photos.forEach((p, i) => {
      blocks.push({ type: 'text', text: `Photo ${i + 1}${p.tag ? ` [${p.tag}]` : ''}${p.caption ? ` — ${p.caption}` : ''}:` })
      const mime = p.dataUrl.match(/^data:([^;]+);/)?.[1] ?? 'image/jpeg'
      blocks.push({
        type: 'image',
        source: { type: 'base64', media_type: mime, data: p.dataUrl.replace(/^data:[^;]+;base64,/, '') },
      })
    })
    content = blocks
  }

  return callClaude(apiKey, [{ role: 'user', content }], system,
    { model: 'claude-sonnet-4-6', maxTokens: 2000 })
}

// V16 suggestProcesses — estimate hours per workflow phase
export async function suggestProcessHours(
  apiKey: string,
  opts: { jobType: string; prep: string; method: string; coats: string; access: string; ceilingHeight: string; substrates: string; processes: string[]; painters: number },
): Promise<Record<string, number>> {
  const prompt = `You are a senior Australian painting estimator. Estimate CREW hours for each process phase below.

Job type: ${opts.jobType}
Prep level: ${opts.prep}
Application: ${opts.method}, ${opts.coats} coats
Access: ${opts.access}
Ceiling height: ${opts.ceilingHeight}
Crew size: ${opts.painters} painter(s) working together

SUBSTRATES AND QUANTITIES:
${opts.substrates || '(none entered)'}

PHASES TO ESTIMATE:
${opts.processes.map((p, i) => `${i + 1}. ${p}`).join('\n')}

Return ONLY a JSON object mapping each phase name exactly as given to its estimated hours as a number. No markdown, no prose.
Example: {"Setup and protection": 4, "Prep and sanding": 12}`

  const raw = await callClaude(apiKey, [{ role: 'user', content: prompt }],
    'You estimate painting labour hours. Return ONLY valid JSON, no markdown fences.',
    { model: 'claude-sonnet-4-6', maxTokens: 1000 })

  const cleaned = raw.replace(/```(?:json)?/gi, '').trim()
  const start = cleaned.indexOf('{')
  const parsed = JSON.parse(start > 0 ? cleaned.slice(start) : cleaned)
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(parsed)) {
    const n = Number(v)
    if (!isNaN(n)) out[k] = n
  }
  return out
}

// V16 runConsAI — estimate consumables spend
export async function estimateConsumables(
  apiKey: string,
  opts: { jobType: string; prepLevel: string; substrates: string; method: string },
): Promise<{ total: number; notes: string }> {
  const prompt = `You are an Australian painting estimator. Estimate the CONSUMABLES cost (ex GST) for this job — masking tape, plastic drop sheets, sandpaper, caulk/gap filler, filler, rags, thinners, roller sleeves, brushes, tack cloths.

Job type: ${opts.jobType}
Prep level: ${opts.prepLevel}
Application: ${opts.method}

SUBSTRATES AND QUANTITIES:
${opts.substrates || '(none entered)'}

Return ONLY JSON: {"total": <number, ex GST AUD>, "notes": "<one or two sentences listing the main items and quantities>"}`

  const raw = await callClaude(apiKey, [{ role: 'user', content: prompt }],
    'You estimate painting consumables. Return ONLY valid JSON, no markdown fences.',
    { model: 'claude-sonnet-4-6', maxTokens: 600 })

  const cleaned = raw.replace(/```(?:json)?/gi, '').trim()
  const start = cleaned.indexOf('{')
  const parsed = JSON.parse(start > 0 ? cleaned.slice(start) : cleaned)
  return { total: Number(parsed.total) || 0, notes: String(parsed.notes ?? '') }
}

// ── Bank statement reconciliation (V16 analyzeBankStatement) ──
export interface ReconContext {
  invoices: Array<Record<string, any>>
  materials: Array<Record<string, any>>
  expenses: Array<Record<string, any>>
  companyName?: string
  abn?: string
}

export async function reconcileBankStatement(
  apiKey: string, statementText: string, ctx: ReconContext,
): Promise<string> {
  const money = (v: any) => Number(v || 0).toFixed(2)

  const invSummary = ctx.invoices
    .filter(i => (i.agreed_ex_gst || 0) > 0)
    .map(i => `Invoice ${i.id || '?'} — ${i.client} — $${money(i.total_inc_gst || (i.agreed_ex_gst || 0) * 1.1)} inc GST (received: $${money(i.received)})`)
    .join('\n')

  const matSummary = ctx.materials
    .map(m => `Material: ${m.supplier} — ${m.mat_desc} — $${money(m.total_inc_gst)} inc GST — ${m.date || '?'}`)
    .join('\n')

  const expSummary = ctx.expenses
    .map(e => `Expense: ${e.supplier} — ${e.exp_desc} — $${money((e.amount_ex_gst || 0) + (e.gst || 0))} inc GST — ${e.date || '?'}`)
    .join('\n')

  const company = ctx.companyName || 'Northern Painters'
  const abnPart = ctx.abn ? ` (ABN ${ctx.abn})` : ''

  const system = `You are an Australian bookkeeper reconciling a bank statement for ${company}${abnPart}, a painting business in NSW. Analyse the bank CSV against the provided invoices, materials and expenses. Identify: matched credits (invoice payments received), matched debits (materials/expense purchases), unmatched credits, unmatched debits. Calculate GST position. Use Australian dollar formatting. Be concise and practical.`

  const user = `BANK STATEMENT CSV:\n${statementText.slice(0, 8000)}\n\nINVOICES ON FILE:\n${invSummary || 'None'}\n\nMATERIALS/PURCHASES ON FILE:\n${matSummary || 'None'}\n\nEXPENSES ON FILE:\n${expSummary || 'None'}\n\nProvide: 1) Matched income vs invoices 2) Matched expenses vs materials/purchases 3) Unmatched transactions (flag for review) 4) GST collected vs paid reconciliation 5) Any discrepancies to investigate.`

  return callClaude(apiKey, [{ role: 'user', content: user }], system,
    { model: 'claude-sonnet-4-6', maxTokens: 4000 })
}

// ── Drawing / document quantity takeoff (V16 paint-calc extractor) ──
export interface ExtractDoc {
  file: File
  /** Known dimensions the estimator supplies — treated as absolute scale truth. */
  measurements?: string
}

export interface QuantityExtraction {
  jobType?: string
  interior?: Record<string, number>
  exterior?: Record<string, number>
  specialty?: Record<string, number>
  finishes?: Array<{ area: string; product: string; colour: string; coats: number; notes: string }>
  scopeNotes?: string
  totalFloorArea?: number
  extractionSummary?: string
  confidence?: string
}

const TAKEOFF_PROMPT = `You are a senior Australian painting estimator and quantity surveyor with 25+ years experience. You specialise in reading architectural drawings, floor plans, elevations, sections, finishes schedules, specification documents, and scope-of-works for residential and commercial painting projects.

MISSION: Extract EVERY paintable surface quantity from the uploaded documents with maximum precision. Be thorough — missing a surface costs money. Every surface visible in a drawing that can be painted must be quantified.

STEP 1 — DOCUMENT TYPE IDENTIFICATION
For each document, identify:
- Type: floor plan / elevation drawing / section / finishes schedule / specification / site photo / sketch / scope of works / quote / other
- Scale: explicit scale bar, stated scale (1:100, 1:50 etc.), or NTS with labelled dimensions
- Orientation: north point, floor levels, grid lines if present
- Coverage: which rooms / levels / facades are shown

STEP 2 — ESTABLISH SCALE AND REFERENCE DIMENSIONS
- If a scale bar is printed: measure a known feature against it to confirm the ratio
- If dimensions are labelled directly on the drawing: use those as primary reference
- If it is a photo of a hand sketch: read every written number and dimension note
- If multiple drawings are uploaded: cross-reference room names between floor plan and elevations to validate dimensions
- If drawings are in imperial: convert to metric (1 foot = 0.305m, 1 inch = 25.4mm)
- If NTS with no labels: state "cannot determine scale — used industry average room size as fallback" and apply conservative estimates (bedroom 3x3.5m, living 4x5m, bathroom 1.8x2.4m)
- Known measurements provided by the estimator override all other scale references — use them as absolute ground truth

STEP 3 — ROOM-BY-ROOM INTERIOR QUANTITY TAKEOFF
WALLS:
  - Perimeter: (L*2 + W*2) * H = gross wall area
  - Deduct standard door opening: 0.9m x 2.1m = 1.89m2 per door leaf
  - Deduct window openings: use labelled dims or assume 1.2m x 1.0m = 1.2m2 per window
  - Do NOT deduct architraves or skirtings from wall area — measured separately
  - Round up to nearest 0.5m2
CEILINGS:
  - L x W = ceiling area; for raked/vaulted measure actual sloped surface area
  - Wet area ceilings (bathrooms, laundry, ensuite) listed separately
CORNICES: L+W*2 linear metres (room perimeter)
SKIRTINGS: L+W*2 linear metres per room
ARCHITRAVES: count door openings x 2 (each side) x typical 2.5 lm each (~5lm per door), or read schedule
DOORS: count each painted face (interior doors typically painted both sides = 2 faces per door)
WINDOWS: count total window units (interior frames only)
BUILT-IN WARDROBES: count each unit, or measure internal surface area
FEATURE WALLS: if called out in finishes schedule or notes, extract m2

STEP 4 — EXTERIOR QUANTITY TAKEOFF
For each facade (front, rear, left side, right side):
  - Weatherboards / cladding: facade width x wall height, deduct door/window openings
  - Eaves: overhang depth x facade length (check eave width from section drawings)
  - Fascia: perimeter of roofline in linear metres
  - Gutters: perimeter of roofline in linear metres (same as fascia unless different on drawings)
  - Downpipes: count each downpipe
  - Windows (exterior frames): count each window unit
  - Exterior doors: count each painted door face
  - Balustrades / handrails: linear metres from drawings or stair schedule
  - Posts and columns: count each
  - Garage doors: count each (typically 2.4m x 2.1m = 5m2 per single panel)
  - Roof: ridge-to-eave x length x both slopes if applicable
  - Concrete / paving: L x W from site plan

STEP 5 — SPECIALTY / FEATURE SURFACES
  - Decks: L x W in m2; identify if timber, composite, or concrete
  - Limewash or decorative finishes: extract area from finishes schedule or notes
  - Timber staining (internal/external): doors, joinery, feature timbers — note product if specified
  - Stone finishes, render, texture coatings: extract m2

STEP 6 — FINISHES SCHEDULE EXTRACTION
If a finishes schedule is present, for each room/area extract surface, paint product and brand, colour reference or code, number of coats, and any special instructions.

STEP 7 — CROSS-CHECKS AND SANITY
- Total wall area / number of rooms should average 30-60m2 for typical rooms
- Total ceiling area should approximately equal total floor area
- Exterior wall area should make sense for the building footprint
- If a value seems impossible, flag it in scopeNotes with your reasoning
- List every surface you COULD NOT determine and why

STEP 8 — OUTPUT FORMAT
Output ONLY a single valid JSON object — no markdown fences, no prose before or after.
Put your detailed room-by-room breakdown in "extractionSummary" (newline-separated).
Put product/colour/finish information in "finishes" array.
Put uncertainties and exclusions in "scopeNotes".
Set "confidence" to "high", "medium", or "low — [specific reason]".

JSON format:
{"jobType":"detected type","interior":{"walls":0,"ceilings":0,"cornice":0,"skirtings":0,"architraves":0,"doors_i":0,"win_i":0,"wardrobes":0,"feature":0,"wet_walls":0,"wet_ceil":0},"exterior":{"weatherboards":0,"cladding":0,"render":0,"eaves":0,"fascia":0,"gutters":0,"downpipes":0,"fences":0,"balustrades":0,"posts":0,"doors_e":0,"win_e":0,"architraves_e":0,"garage_e":0,"roof":0,"concrete":0},"specialty":{"deck_oil":0,"deck_tinted":0,"deck_stain":0,"limewash":0,"stone":0,"timber":0},"finishes":[{"area":"room or surface","product":"paint product","colour":"colour name or code","coats":2,"notes":"any special instructions"}],"scopeNotes":"surfaces excluded, assumptions made, or unclear items","totalFloorArea":0,"extractionSummary":"detailed room-by-room breakdown with all dimensions and calculations","confidence":"high"}

Only include keys with non-zero values. Use real extracted values — never invent numbers.

Now analyse the following documents:`

async function fileToB64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve((r.result as string).split(',')[1])
    r.onerror = reject
    r.readAsDataURL(file)
  })
}

// V16 _pcApplyExtractResult — strip fences, then take the first balanced object
function parseExtraction(raw: string): QuantityExtraction {
  let text = raw.replace(/```(?:json)?/gi, '').trim()
  const fb = text.indexOf('{')
  if (fb > 0) text = text.slice(fb)
  let depth = 0, end = -1
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}') { depth--; if (depth === 0) { end = i + 1; break } }
  }
  if (end > 0) text = text.slice(0, end)
  return JSON.parse(text)
}

export async function extractQuantities(
  apiKey: string, docs: ExtractDoc[], scopeNotes = '',
): Promise<QuantityExtraction> {
  const content: any[] = [{ type: 'text', text: TAKEOFF_PROMPT }]

  if (scopeNotes.trim()) {
    content.push({
      type: 'text',
      text: 'ESTIMATOR SCOPE NOTES (authoritative — these override or clarify the drawings):\n' + scopeNotes.trim(),
    })
  }

  for (const d of docs) {
    const b64 = await fileToB64(d.file)
    const meas = d.measurements?.trim()
    content.push({
      type: 'text',
      text: `[${d.file.name}]${meas ? ` — KNOWN MEASUREMENTS: ${meas}` : ''}${meas ? '\nUse these measurements as absolute scale reference for this document.' : ''}`,
    })
    if (d.file.type === 'application/pdf') {
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } })
    } else if (d.file.type.startsWith('image/')) {
      content.push({ type: 'image', source: { type: 'base64', media_type: d.file.type, data: b64 } })
    }
  }

  const call = async (model: string) => {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 16000,
        thinking: { type: 'enabled', budget_tokens: 10000 },
        messages: [{ role: 'user', content }],
      }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data?.error?.message ?? `API error ${res.status}`)
    const text = (data.content ?? []).find((b: any) => b.type === 'text')?.text ?? '{}'
    return text as string
  }

  // V16 tries the strongest model, then falls back if it is unavailable on the key
  let raw: string
  try {
    raw = await call('claude-opus-4-5')
  } catch (e: any) {
    if (/model|not_found/i.test(e?.message ?? '')) raw = await call('claude-sonnet-4-6')
    else throw e
  }

  try {
    return parseExtraction(raw)
  } catch {
    throw new Error('AI returned unexpected format. Raw response:\n' + raw.slice(0, 400))
  }
}

// ── Invoice / receipt OCR ─────────────────────────────────────
const INVOICE_TOOL = {
  name: 'record_invoice',
  description: 'Record the fields read off a supplier invoice or receipt.',
  input_schema: {
    type: 'object',
    required: ['supplier', 'description', 'date', 'receipt_no', 'job_address', 'items',
               'cost_ex_gst', 'gst', 'total_inc_gst', 'category', 'notes'],
    properties: {
      supplier: { type: 'string', description: 'Trading name of the supplier. Empty string if not printed.' },
      description: { type: 'string', description: 'Short summary of the purchase, e.g. "Dulux Weathershield 15L x2, masking tape, rollers".' },
      date: { type: 'string', description: 'Invoice date as YYYY-MM-DD. Australian invoices print dd/mm/yyyy, so 03/09/2026 is 3 September. Empty string if absent.' },
      receipt_no: { type: 'string', description: 'Invoice, receipt, docket or order number exactly as printed. Empty string if absent.' },
      job_address: { type: 'string', description: 'Delivery or site address. Not the address of the supplier, and not the billing address. Empty string if absent.' },
      items: {
        type: 'array',
        description: 'One entry per line item actually printed. Empty array if the invoice shows no itemised lines.',
        items: {
          type: 'object',
          required: ['description', 'qty', 'total_ex_gst'],
          properties: {
            description: { type: 'string' },
            qty: { type: 'number' },
            total_ex_gst: { type: 'number', description: 'Line total excluding GST, not the unit price.' },
          },
        },
      },
      cost_ex_gst: { type: ['number', 'null'], description: 'Invoice subtotal excluding GST.' },
      gst: { type: ['number', 'null'], description: 'GST amount.' },
      total_inc_gst: { type: ['number', 'null'], description: 'Grand total including GST — the amount payable.' },
      category: {
        type: 'string',
        enum: ['Paint', 'Primer/Undercoat', 'Filler/Putty', 'Tape/Masking', 'Brushes/Rollers',
               'Sandpaper/Prep', 'Caulk/Sealant', 'Solvent/Cleaner', 'Hardware', 'Other'],
        description: 'Best fit for the bulk of the spend.',
      },
      notes: { type: 'string', description: 'Anything useful that has no other field — account number, PO reference, whether it is a credit note. Empty string if nothing.' },
    },
  },
}

const INVOICE_SYSTEM = `You read supplier invoices and receipts for an Australian painting business and record exactly what is printed.

Rules:
- Transcribe. Never guess, never round, never invent a value. If something is not printed, leave it empty or null.
- Dates are Australian: dd/mm/yyyy. 03/09/2026 is 3 September 2026, not 9 March. Return YYYY-MM-DD.
- Money: ignore thousands separators. "1.234,56" and "1,234.56" are both 1234.56.
- Prefer totals printed on the invoice over anything you calculate. Only derive a missing figure:
  * total but no GST line -> gst = total / 11, cost_ex_gst = total - gst
  * ex-GST only -> gst = ex * 0.1, total = ex * 1.1
- Some suppliers print prices inc GST per line. Line totals must be EXCLUDING GST; divide by 1.1 if the invoice says prices include GST.
- Line items should add up to cost_ex_gst. If they do not, trust the printed subtotal and still record the lines as printed.
- A credit note or refund has negative amounts. Keep the sign and say so in notes.
- The job address is the delivery or site address. A supplier's own address, or the account holder's billing address, is not it — leave job_address empty rather than using those.
- Ignore anything already-paid, account balances, or previous-statement figures. Only this invoice.`

export async function extractInvoice(apiKey: string, file: File): Promise<InvoiceExtraction> {
  const prepared = await shrinkImage(file)
  const { base64, mediaType } = await fileToBase64(
    prepared instanceof File ? prepared : new File([prepared], file.name, { type: 'image/jpeg' }),
  )

  const imageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
  const isImage = imageTypes.includes(mediaType)
  const isPdf = mediaType === 'application/pdf'

  if (!isImage && !isPdf) {
    throw new Error(`Cannot read ${mediaType || 'that file type'}. Use a photo (JPG or PNG) or a PDF.`)
  }

  const messages = [{
    role: 'user',
    content: [
      isPdf
        // PDFs are sent as documents, so multi-page supplier invoices read
        // properly instead of being refused.
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
        : { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
      { type: 'text', text: 'Read this invoice and record its fields with the record_invoice tool.' },
    ],
  }]

  const raw = await callClaude(apiKey, messages, INVOICE_SYSTEM, {
    // Every other call in this file uses Sonnet; this one was falling through
    // to the Haiku default, which is why the scans were unreliable.
    model: 'claude-sonnet-4-6',
    maxTokens: 4096,
    temperature: 0,
    tool: INVOICE_TOOL,
  })

  let parsed: any
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('AI returned unexpected format. Try again, or use a clearer photo.')
  }

  const num = (v: any) => (v == null || v === '' ? null : (Number(v) || 0))
  // A scan can return three figures that cannot all be true — most often an
  // ex-GST value that is really the till total. Trust the amount paid.
  const money = reconcileGst(num(parsed.cost_ex_gst), num(parsed.gst), num(parsed.total_inc_gst))
  return {
    supplier:       String(parsed.supplier ?? ''),
    description:    String(parsed.description ?? ''),
    date:           String(parsed.date ?? ''),
    receipt_no:     String(parsed.receipt_no ?? ''),
    cost_ex_gst:    money.cost_ex_gst,
    gst:            money.gst,
    total_inc_gst:  money.total_inc_gst,
    category:       String(parsed.category ?? 'Other'),
    notes:          String(parsed.notes ?? ''),
    job_address:    String(parsed.job_address ?? ''),
    items: normaliseLineItems(parsed.items),
  }
}

// ── Quote scope writer ────────────────────────────────────────
export interface QuoteScopeInput {
  client: string
  address: string
  jobType: string
  items: Array<{
    area_name: string
    surface_type: string
    sqm: number
    coats: number
    prep_level: string
    notes: string
  }>
  totalExGST: number
}

export async function generateQuoteScope(apiKey: string, input: QuoteScopeInput): Promise<string> {
  const itemsSummary = input.items.map(it =>
    `- ${it.area_name || it.surface_type}: ${it.surface_type}, ${it.sqm.toFixed(1)} m², ${it.coats} coats, ${it.prep_level} prep${it.notes ? `, ${it.notes}` : ''}`
  ).join('\n')

  const prompt = `You are writing a professional scope of works for a painting quote in Australia.

Client: ${input.client || 'Client'}
Address: ${input.address || 'Site address'}
Job type: ${input.jobType || 'Painting'}
Total quote value: $${input.totalExGST.toFixed(2)} ex GST

Areas to be painted:
${itemsSummary}

Write a clear, professional scope of works for this quote. Use plain language.
Include:
- What surfaces will be prepared and how
- Paint system (coats, finish type where relevant)
- Any important inclusions or exclusions
- A brief professional closing line

Keep it concise — around 100–150 words. No bullet points, use short paragraphs. No pricing in the scope text.`

  const text = await callClaude(apiKey, [{ role: 'user', content: prompt }],
    'You write professional painting quote scope of works text for an Australian painting contractor. Be clear and professional.')

  return text.trim()
}
