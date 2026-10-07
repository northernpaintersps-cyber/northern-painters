// AI utilities — calls Anthropic Claude API directly from the browser
// using the key stored in business settings (np_settings key='business')

import {
  TAKEOFF_TOOL, SUBSTRATE_DOC, SUB_KEYS,
  type TakeoffRow, type FinishRow, type RowConfidence,
} from './takeoffSchema'
import { SUB_BY_KEY, type SubUnit } from './substrates'
import { shrinkImage } from './image'
import { pdfPageCount, pdfSubset, pdfChunks, PdfReadError } from './pdfPages'
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

/**
 * A Claude 5 model. The generation is the number straight after the family,
 * so claude-opus-4-5 and claude-haiku-4-5 are NOT this — they end in a five
 * but are the 4.5 generation, and they still take a temperature.
 */
const isGen5 = (model: string) => /^claude-(opus|sonnet|haiku|fable)-5(|-)/.test(model)

export interface CallUsage {
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
}

async function callClaude(
  apiKey: string, messages: any[], system?: string,
  opts?: {
    model?: string; maxTokens?: number; temperature?: number
    /** Forces the reply through a schema, so the result is always valid JSON. */
    tool?: { name: string; description: string; input_schema: any }
    /**
     * Let the model reason before answering. Forcing a tool is rejected
     * alongside extended thinking, so a thinking call declares its tool and
     * leaves the choice automatic — with one tool and a system prompt that
     * demands it, it is called. `toolOptional` covers the case where it is not.
     */
    thinking?: { budgetTokens: number }
    /** Return the text instead of throwing when no tool block comes back. */
    toolOptional?: boolean
    /** Cache the system prompt — worth it when it is long and byte-stable. */
    cacheSystem?: boolean
    onUsage?: (u: CallUsage) => void
  },
): Promise<string> {
  const model = opts?.model ?? 'claude-haiku-4-5-20251001'
  const sysText = system ?? 'You are a helpful assistant for a painting business in Australia.'
  const forceTool = !!opts?.tool && !opts?.thinking
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
      max_tokens: opts?.maxTokens ?? 1024,
      system: opts?.cacheSystem
        ? [{ type: 'text', text: sysText, cache_control: { type: 'ephemeral' } }]
        : sysText,
      messages,
      // Temperature cannot be set alongside extended thinking.
      // temperature is deprecated on the Claude 5 models and sending it is a
      // 400, not a warning. Thinking also rules it out. These are all forced
      // tool calls answering from a schema, so dropping it changes nothing
      // that matters.
      ...(opts?.temperature != null && !opts?.thinking && !isGen5(model)
        ? { temperature: opts.temperature } : {}),
      ...(opts?.thinking
        ? { thinking: { type: 'enabled', budget_tokens: opts.thinking.budgetTokens } }
        : {}),
      ...(opts?.tool
        ? {
            tools: [opts.tool],
            tool_choice: forceTool ? { type: 'tool', name: opts.tool.name } : { type: 'auto' },
          }
        : {}),
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    const detail = (err as any)?.error?.message
    // The status is kept in the message: the takeoff tries a ladder of models
    // and decides whether to step down by reading it, and a 404 whose body
    // does not happen to contain the word "model" would otherwise stop it.
    throw new Error(detail ? `${detail} (HTTP ${res.status}, ${model})` : `API error ${res.status} (${model})`)
  }

  const data = await res.json()

  opts?.onUsage?.({
    model: data.model ?? model,
    inputTokens: data.usage?.input_tokens ?? 0,
    outputTokens: data.usage?.output_tokens ?? 0,
    cacheReadTokens: data.usage?.cache_read_input_tokens ?? 0,
  })

  const text = () =>
    data.content?.find((c: any) => c.type === 'text')?.text ?? data.content?.[0]?.text ?? ''

  if (opts?.tool) {
    const block = data.content?.find((c: any) => c.type === 'tool_use')
    if (block) return JSON.stringify(block.input ?? {})
    if (opts.toolOptional) return text()
    throw new Error('AI did not return structured data. Try again.')
  }
  return text()
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
  /** Products and colours named by the architect's finishes schedule. */
  finishesSchedule?: string
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
## Benchmark Check
${q.finishesSchedule ? `
SPECIFIED FINISHES: this job has an architect's finishes schedule. The products and colours below are contractual — name them in the Scope of Work and in the Paint Materials table, and do not substitute. If a specified product has no trade price above, price it as given and say so under Assumptions rather than quietly swapping it for something we stock.` : ''}`

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
${q.finishesSchedule ? `SPECIFIED FINISHES (from the finishes schedule — contractual):\n${q.finishesSchedule}` : ''}

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
  totalFloorArea?: number | null
  /** One row per substrate, each carrying the arithmetic it came from. */
  quantities: TakeoffRow[]
  finishes: FinishRow[]
  extractionSummary?: string
  scopeNotes?: string
  confidence?: string
  /** Which model actually answered, so a silent fallback is visible. */
  model?: string
  /** Pass-1 result, when the set was large enough to index. */
  sheetIndex?: SheetIndexEntry[]
  usage?: { inputTokens: number; outputTokens: number }
}

const TAKEOFF_SYSTEM = `You are a senior Australian painting estimator and quantity surveyor with 25+ years experience reading architectural drawings, elevations, sections, finishes schedules and scopes of work.

Your job is to measure every paintable surface in the documents you are given and record it with the record_takeoff tool. Missing a surface costs money; inventing one costs trust. Do both carefully.

ESTABLISHING SCALE
- A printed scale bar is the best reference: measure a known feature against it.
- Dimensions labelled on the drawing beat a scale bar.
- Measurements supplied by the estimator beat everything. They are ground truth; where they conflict with your reading of the drawing, the estimator is right and your reading is wrong.
- Imperial drawings convert to metric: 1 foot = 0.305 m, 1 inch = 25.4 mm.
- If there is no scale and nothing labelled, say so in scopeNotes and fall back to conservative room sizes (bedroom 3.0 x 3.5, living 4.0 x 5.0, bathroom 1.8 x 2.4). Mark every row you derived that way as low confidence.

MEASURING
Interior, room by room:
- Walls: perimeter x height, less 1.89 m2 per door opening and the labelled area of each window (1.2 m2 if unlabelled). Do not deduct skirting or architrave.
- Ceilings: length x width; a raked ceiling is the sloped surface, not the plan area.
- Wet areas (bathroom, ensuite, laundry, WC) go in the wet area substrates INSTEAD OF the main wall and ceiling figures, never as well as.
- Cornice and skirting: room perimeters in lineal metres.

Exterior, facade by facade:
- Cladding, weatherboard and render: facade width x wall height, less openings.
- Eaves: overhang depth x the length it runs. Check the section drawing for the overhang.
- Fascia and gutter: the roofline perimeter.

For every row, write the arithmetic into "basis" — the rooms or facades and their dimensions, ending in the total. "Bed1 3.6x3.2 + Bed2 3.0x3.4 + Living 4.2x5.0 = 44.5", not "measured from the floor plan". Put the full room-by-room working in extractionSummary.

THE SUBSTRATE TABLE IS AUTHORITATIVE
Use only these keys. Each row states the unit the number must be in and exactly what the number counts. A quantity in the wrong unit is worse than no quantity at all, because it looks usable. If a surface does not fit any key, describe it in scopeNotes rather than forcing it into the nearest one.

{SUBSTRATE_DOC}

BEFORE YOU ANSWER, CHECK
- Total ceiling area should be close to the total floor area.
- Wall area is normally two to four times ceiling area at a 2.4-2.7 m stud.
- Architrave and door counts should be in the same ballpark as each other.
- Every count is a whole number.
- Anything that fails these checks: fix it, or keep it and explain it in scopeNotes.

List what you could not determine, and why, in scopeNotes. Do not pad the takeoff with guesses to look complete.`

/** The system prompt with the generated substrate table spliced in. */
const takeoffSystem = () => TAKEOFF_SYSTEM.replace('{SUBSTRATE_DOC}', SUBSTRATE_DOC)


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

// ── Pass 1: index the sheets ─────────────────────────────────
// A full architectural set is mostly sheets with no paintable surface on them
// — structural, hydraulic, electrical, drainage. Reading all forty costs the
// whole context window and leaves nothing to reason with, so the set is
// indexed first and only the sheets that carry surfaces are measured.

export interface SheetIndexEntry {
  /** 1-indexed page in the original file. */
  page: number
  sheetNo: string
  title: string
  discipline: string
  kind: string
  relevant: boolean
  why: string
}

/** Above this, index first. Below it, indexing costs more than it saves. */
export const INDEX_THRESHOLD = 20
/** Pages per pass-1 chunk. */
const INDEX_CHUNK = 15
/** Most sheets to put through the takeoff, before dropping the least useful. */
const MAX_TAKEOFF_SHEETS = 25

/** Sheet kinds worth measuring, most valuable first — also the drop order. */
const KIND_PRIORITY = [
  'floor plan', 'elevation', 'finishes schedule', 'section',
  'reflected ceiling plan', 'door/window schedule', 'internal elevation',
  'detail', 'site plan', 'other',
]

const INDEX_TOOL = {
  name: 'index_sheets',
  description: 'List every sheet in this drawing set and say whether it carries paintable surfaces.',
  input_schema: {
    type: 'object' as const,
    additionalProperties: false,
    required: ['sheets'],
    properties: {
      sheets: {
        type: 'array',
        description: 'One entry per page, in order. Every page, including the ones that are not relevant.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['page', 'sheetNo', 'title', 'discipline', 'kind', 'relevant', 'why'],
          properties: {
            page: { type: 'number', description: '1-indexed page number within this document.' },
            sheetNo: { type: 'string', description: 'The sheet number from the title block, e.g. "A-02". "" if none.' },
            title: { type: 'string', description: 'The sheet title from the title block.' },
            discipline: {
              type: 'string',
              enum: ['architectural', 'structural', 'hydraulic', 'electrical', 'mechanical',
                     'landscape', 'survey', 'schedule', 'other'],
            },
            kind: { type: 'string', enum: KIND_PRIORITY.concat(['cover', 'not a drawing']) },
            relevant: {
              type: 'boolean',
              description: 'True only if a painter could measure a surface or read a specified finish from this sheet.',
            },
            why: { type: 'string', description: 'One short clause.' },
          },
        },
      },
    },
  },
}

const INDEX_SYSTEM = `You are reading the title blocks of an architectural drawing set for a painting estimator, to work out which sheets are worth measuring.

For each page, read the title block and record the sheet number, title, discipline and kind.

Mark relevant = true for: floor plans, reflected ceiling plans, elevations (internal and external), sections, finishes schedules, door and window schedules, and details that show a paintable surface.

Mark relevant = false for: structural, hydraulic, drainage, electrical, mechanical, survey, civil and landscape sheets, cover sheets, location plans, notes-only sheets and revision sheets — unless that sheet also carries a finishes note or a paintable surface, in which case say so in "why".

Record every page, including the ones you mark false. Do not skip pages. If a title block is unreadable, record what you can and mark it relevant with why = "title block unreadable".`

/** Models to try, strongest first. */
const TAKEOFF_MODELS = ['claude-opus-5', 'claude-sonnet-5', 'claude-sonnet-4-6']

// ── Photos and a spoken note become a scope ──────────────────
// The repaint path. There are no drawings to measure, so the model is asked
// for what it can actually tell from a photograph — the surfaces present and
// the state they are in — and is told to leave the quantity out rather than
// guess at one from perspective.

export interface PhotoInput {
  /** A data URL or any URL the API can be handed as base64. */
  dataUrl: string
  /** What the estimator said about this photo. */
  note?: string
  tag?: string
}

export interface ScopeObservation {
  key: string
  qty: number | null
  unit: SubUnit
  /** Where the number came from, or why there is none. */
  basis: string
  condition: string
  prep: string
  confidence: RowConfidence
  /** Indexes into the photos passed in, 1-based as the prompt numbers them. */
  photos: number[]
}

export interface PhotoScope {
  jobType: string
  observations: ScopeObservation[]
  scopeNotes: string
  summary: string
  model?: string
}

const PHOTO_SCOPE_SYSTEM = `You are a senior Australian painting estimator looking at photographs of a property that needs repainting, with the estimator's own spoken notes against them.

Your job is to say what has to be painted and what state it is in. Record it with the record_scope tool.

WHAT A PHOTOGRAPH CAN AND CANNOT TELL YOU
- You can identify surfaces, their material, and their condition: chalking, peeling, water damage, mould, previous coating failing, bare timber, new plasterboard.
- You can judge prep: a wall that needs a wash and a light sand is not the same job as one needing stripping and full filling. Say which.
- You CANNOT measure from a photograph. Perspective makes a guess worse than no number at all, and the quote is built on these figures.
- So: give a quantity ONLY when the estimator's note states one, or when the photo contains something of known size you can count — doors, windows, cabinet doors, posts, downpipes. Counting is reliable; estimating area is not.
- When you have no quantity, set qty to null and say in basis what is needed to get one, for example "measure the run" or "count from the floor plan".

THE ESTIMATOR'S NOTES ARE AUTHORITATIVE
A note saying "hallway is about forty square metres" is a measurement; use it and say so in basis. A note contradicting what you think you see is right and you are wrong — these were taken standing in the room.

THE SUBSTRATE TABLE IS AUTHORITATIVE
Use only these keys, with the unit each states. A surface that fits no key goes in scopeNotes rather than being forced into the nearest one.

{SUBSTRATE_DOC}

Also: say what kind of job this looks like, flag anything that will not be obvious from a photograph but will cost money — access, height, lead paint on pre-1970 timber, asbestos-era sheeting, rot needing a carpenter — and list what you could not see and would need before quoting.`

const PHOTO_SCOPE_TOOL = {
  name: 'record_scope',
  description: 'Record the paintable surfaces visible in these photographs and their condition.',
  input_schema: {
    type: 'object' as const,
    additionalProperties: false,
    required: ['jobType', 'observations', 'scopeNotes', 'summary'],
    properties: {
      jobType: { type: 'string', description: 'e.g. "Interior repaint", "Kitchen cabinets".' },
      observations: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['key', 'qty', 'unit', 'basis', 'condition', 'prep', 'confidence', 'photos'],
          properties: {
            key: { type: 'string', enum: SUB_KEYS },
            qty: {
              type: ['number', 'null'],
              description: 'Only from a stated measurement or a reliable count. null otherwise — never estimated from perspective.',
            },
            unit: { type: 'string', enum: ['sqm', 'lm', 'qty'] },
            basis: { type: 'string', description: 'Where the number came from, or what is needed to get one.' },
            condition: { type: 'string', description: 'What the surface looks like now.' },
            prep: { type: 'string', description: 'The preparation this surface needs before coating.' },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
            photos: {
              type: 'array', items: { type: 'number' },
              description: 'Which photo numbers show this surface.',
            },
          },
        },
      },
      scopeNotes: { type: 'string', description: 'Access, hazards, anything not visible, anything needing a measure.' },
      summary: { type: 'string', description: 'The walkthrough in a few lines, as the estimator would describe it.' },
    },
  },
}

/** Read a set of site photos and their notes into a painting scope. */
export async function photosToScope(
  apiKey: string, photos: PhotoInput[], visitNotes = '',
): Promise<PhotoScope> {
  if (!photos.length) throw new Error('No photos to read.')

  const content: any[] = []
  if (visitNotes.trim()) {
    content.push({
      type: 'text',
      text: 'ESTIMATOR NOTES FROM THE VISIT (authoritative):\n' + visitNotes.trim(),
    })
  }

  photos.forEach((p, i) => {
    content.push({
      type: 'text',
      text: `Photo ${i + 1}${p.tag ? ` [${p.tag}]` : ''}${p.note ? ` — ${p.note}` : ''}:`,
    })
    const mime = p.dataUrl.match(/^data:([^;]+);/)?.[1] ?? 'image/jpeg'
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: mime, data: p.dataUrl.replace(/^data:[^;]+;base64,/, '') },
    })
  })

  content.push({
    type: 'text',
    text: 'Record what has to be painted and the state it is in, with the record_scope tool.',
  })

  let usage: CallUsage | undefined
  const call = (model: string) =>
    callClaude(apiKey, [{ role: 'user', content }],
      PHOTO_SCOPE_SYSTEM.replace('{SUBSTRATE_DOC}', SUBSTRATE_DOC), {
        model,
        maxTokens: 8000,
        thinking: { budgetTokens: 4000 },
        tool: PHOTO_SCOPE_TOOL,
        toolOptional: true,
        cacheSystem: true,
        onUsage: u => { usage = u },
      })

  let raw = ''
  let lastErr: any
  for (const model of TAKEOFF_MODELS) {
    try { raw = await call(model); lastErr = undefined; break } catch (e: any) {
      lastErr = e
      if (!/model|not_found|404/i.test(e?.message ?? '')) throw e
    }
  }
  if (lastErr) throw lastErr

  let parsed: any
  try { parsed = JSON.parse(raw) } catch {
    try { parsed = parseExtraction(raw) } catch {
      throw new Error('AI returned unexpected format. Raw response:\n' + raw.slice(0, 400))
    }
  }

  const observations: ScopeObservation[] = (Array.isArray(parsed.observations) ? parsed.observations : [])
    .filter((o: any) => SUB_BY_KEY[o?.key])
    .map((o: any) => ({
      key: String(o.key),
      qty: Number.isFinite(Number(o.qty)) && Number(o.qty) > 0 ? Number(o.qty) : null,
      unit: (o.unit === 'sqm' || o.unit === 'lm' || o.unit === 'qty') ? o.unit : SUB_BY_KEY[o.key].unit,
      basis: String(o.basis ?? ''),
      condition: String(o.condition ?? ''),
      prep: String(o.prep ?? ''),
      confidence: (o.confidence === 'low' || o.confidence === 'medium') ? o.confidence : 'high',
      photos: Array.isArray(o.photos) ? o.photos.map(Number).filter(Number.isFinite) : [],
    }))

  return {
    jobType: String(parsed.jobType ?? ''),
    observations,
    scopeNotes: String(parsed.scopeNotes ?? ''),
    summary: String(parsed.summary ?? ''),
    model: usage?.model,
  }
}

/** Drop rows we cannot use, and flag the ones that are suspect but keep them. */
function cleanRows(raw: any): TakeoffRow[] {
  const seen = new Map<string, TakeoffRow>()
  for (const r of Array.isArray(raw) ? raw : []) {
    const key = String(r?.key ?? '')
    const sub = SUB_BY_KEY[key]
    const qty = Number(r?.qty)
    if (!sub || !Number.isFinite(qty) || qty <= 0) continue
    const row: TakeoffRow = {
      key,
      qty,
      // Keep the unit the model claimed rather than coercing it: a mismatch is
      // the most expensive failure mode here and has to reach the estimator,
      // not be quietly papered over.
      unit: (r?.unit === 'sqm' || r?.unit === 'lm' || r?.unit === 'qty') ? r.unit : sub.unit,
      basis: String(r?.basis ?? ''),
      confidence: (r?.confidence === 'low' || r?.confidence === 'medium') ? r.confidence : 'high',
      sheets: Array.isArray(r?.sheets) ? r.sheets.map(String) : [],
    }
    const prev = seen.get(key)
    if (prev) {
      // The model occasionally splits one substrate over two rows.
      prev.qty += row.qty
      prev.basis = [prev.basis, row.basis].filter(Boolean).join(' + ')
      prev.sheets = [...new Set([...prev.sheets, ...row.sheets])]
      if (row.confidence === 'low') prev.confidence = 'low'
    } else {
      seen.set(key, row)
    }
  }
  return [...seen.values()]
}

function cleanFinishes(raw: any): FinishRow[] {
  return (Array.isArray(raw) ? raw : []).map((f: any) => ({
    area: String(f?.area ?? ''),
    substrate_key: SUB_BY_KEY[f?.substrate_key] ? String(f.substrate_key) : '',
    product: String(f?.product ?? ''),
    colour: String(f?.colour ?? ''),
    sheen: String(f?.sheen ?? ''),
    coats: Number.isFinite(Number(f?.coats)) ? Number(f.coats) : null,
    undercoat: String(f?.undercoat ?? ''),
    notes: String(f?.notes ?? ''),
  })).filter(f => f.area || f.product || f.colour)
}

/**
 * Index one PDF's sheets, chunking when the set is too big to send at once.
 * Returns [] when the file cannot be split, so the caller falls back to
 * sending it whole.
 */
async function indexSheets(
  apiKey: string, file: File, pageCount: number,
  onProgress?: (stage: string) => void,
): Promise<SheetIndexEntry[]> {
  const chunks = await pdfChunks(file, INDEX_CHUNK)
  const out: SheetIndexEntry[] = []

  for (const [i, chunk] of chunks.entries()) {
    onProgress?.(chunks.length > 1
      ? `Indexing sheets ${chunk.firstPage}-${chunk.lastPage} of ${pageCount}…`
      : `Indexing ${pageCount} sheets…`)

    const b64 = await fileToB64(chunk.file)
    // Sent one chunk at a time, not in parallel: these are large requests and
    // the key is the user's own, with their own rate limit.
    const raw = await callClaude(apiKey, [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } },
        { type: 'text', text: `Index these ${chunk.lastPage - chunk.firstPage + 1} sheets with the index_sheets tool.` },
      ],
    }], INDEX_SYSTEM, {
      model: 'claude-sonnet-5',
      maxTokens: 8000,
      tool: INDEX_TOOL,
    })

    let sheets: any[] = []
    try { sheets = JSON.parse(raw)?.sheets ?? [] } catch { sheets = [] }
    sheets.forEach((e: any, n: number) => {
      const local = Number(e?.page)
      out.push({
        // The model numbers pages within the chunk it was given.
        page: chunk.firstPage + (Number.isInteger(local) && local >= 1 ? local - 1 : n),
        sheetNo: String(e?.sheetNo ?? ''),
        title: String(e?.title ?? ''),
        discipline: String(e?.discipline ?? 'other'),
        kind: String(e?.kind ?? 'other'),
        relevant: !!e?.relevant,
        why: String(e?.why ?? ''),
      })
    })
    if (i === chunks.length - 1) onProgress?.('')
  }
  return out
}

/** The sheets to measure, trimmed to what one request can carry. */
export function chooseSheets(index: SheetIndexEntry[]): { pages: number[]; dropped: SheetIndexEntry[] } {
  const relevant = index.filter(e => e.relevant)
  if (relevant.length <= MAX_TAKEOFF_SHEETS) {
    return { pages: relevant.map(e => e.page).sort((a, b) => a - b), dropped: [] }
  }
  // Too many to send: keep the most informative kinds first.
  const rank = (e: SheetIndexEntry) => {
    const i = KIND_PRIORITY.indexOf(e.kind)
    return i === -1 ? KIND_PRIORITY.length : i
  }
  const ordered = [...relevant].sort((a, b) => rank(a) - rank(b) || a.page - b.page)
  return {
    pages: ordered.slice(0, MAX_TAKEOFF_SHEETS).map(e => e.page).sort((a, b) => a - b),
    dropped: ordered.slice(MAX_TAKEOFF_SHEETS),
  }
}

const sheetLine = (e: SheetIndexEntry) =>
  `  p${e.page} ${e.sheetNo || '—'} ${e.title}${e.kind ? ` (${e.kind})` : ''}`


export async function extractQuantities(
  apiKey: string, docs: ExtractDoc[], scopeNotes = '',
  onProgress?: (stage: string) => void,
): Promise<QuantityExtraction> {
  const content: any[] = []
  const index: SheetIndexEntry[] = []
  const indexNotes: string[] = []

  if (scopeNotes.trim()) {
    content.push({
      type: 'text',
      text: 'ESTIMATOR SCOPE NOTES (authoritative — these override or clarify the drawings):\n'
        + scopeNotes.trim(),
    })
  }

  for (const d of docs) {
    const meas = d.measurements?.trim()
    content.push({
      type: 'text',
      text: `[${d.file.name}]${meas ? ` — KNOWN MEASUREMENTS: ${meas}` : ''}`
        + (meas ? '\nThese are measured on site. Use them as the absolute scale reference for this document.' : ''),
    })
    if (d.file.type === 'application/pdf') {
      let send = d.file
      try {
        const pages = await pdfPageCount(d.file)
        if (pages > INDEX_THRESHOLD) {
          const sheets = await indexSheets(apiKey, d.file, pages, onProgress)
          const { pages: chosen, dropped } = chooseSheets(sheets)
          if (chosen.length) {
            index.push(...sheets)
            send = await pdfSubset(d.file, chosen, d.file.name)
            const skipped = sheets.filter(e => !e.relevant)
            indexNotes.push(
              `[${d.file.name}] is a ${pages} sheet set. Measuring the ${chosen.length} sheets below.\n`
              + sheets.filter(e => chosen.includes(e.page)).map(sheetLine).join('\n')
              + (skipped.length
                ? `\nNot shown to you (${skipped.length} sheets, judged to carry no paintable surface): `
                  + skipped.map(e => e.sheetNo || `p${e.page}`).join(', ')
                : '')
              + (dropped.length
                ? `\nAlso withheld to fit the request (${dropped.length}): `
                  + dropped.map(e => e.sheetNo || `p${e.page}`).join(', ')
                : '')
              + '\nIf a quantity needs a sheet you were not given, say which in scopeNotes rather than guessing.',
            )
          }
        }
      } catch (e) {
        // An encrypted or damaged PDF cannot be split. Send it whole and say so.
        if (e instanceof PdfReadError) indexNotes.push(`[${d.file.name}] could not be split, so it is sent whole.`)
        else throw e
      }
      onProgress?.('Reading the drawings…')
      const b64 = await fileToB64(send)
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } })
    } else if (d.file.type.startsWith('image/')) {
      // A phone photo of a plan was being sent full size; the API caps the long
      // edge at 1568px anyway, so this only saves upload and tokens.
      const shrunk = await shrinkImage(d.file)
      const { base64, mediaType } = await fileToBase64(
        shrunk instanceof File ? shrunk : new File([shrunk], d.file.name, { type: 'image/jpeg' }),
      )
      content.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } })
    }
  }

  if (!content.some(c => c.type === 'document' || c.type === 'image')) {
    throw new Error('No readable drawings or photos. Upload a PDF or an image.')
  }

  if (indexNotes.length) {
    content.push({ type: 'text', text: 'SHEET INDEX\n' + indexNotes.join('\n\n') })
  }

  content.push({
    type: 'text',
    text: 'Measure every paintable surface in these documents and record the takeoff with the record_takeoff tool.',
  })

  onProgress?.('Measuring…')

  let usage: CallUsage | undefined
  const call = (model: string) =>
    callClaude(apiKey, [{ role: 'user', content }], takeoffSystem(), {
      model,
      maxTokens: 16000,
      thinking: { budgetTokens: 10000 },
      tool: TAKEOFF_TOOL,
      toolOptional: true,
      cacheSystem: true,
      onUsage: u => { usage = u },
    })

  let raw = ''
  let lastErr: any
  for (const model of TAKEOFF_MODELS) {
    try { raw = await call(model); lastErr = undefined; break } catch (e: any) {
      lastErr = e
      if (!/model|not_found|404/i.test(e?.message ?? '')) throw e
    }
  }
  if (lastErr) throw lastErr

  let parsed: any
  try {
    parsed = JSON.parse(raw)
  } catch {
    // The tool was declared but not called — fall back to reading JSON out of
    // the prose, which is how this worked before it was given a schema.
    try { parsed = parseExtraction(raw) } catch {
      throw new Error('AI returned unexpected format. Raw response:\n' + raw.slice(0, 400))
    }
  }

  return {
    jobType: parsed.jobType ? String(parsed.jobType) : undefined,
    totalFloorArea: Number.isFinite(Number(parsed.totalFloorArea)) ? Number(parsed.totalFloorArea) : null,
    quantities: cleanRows(parsed.quantities),
    finishes: cleanFinishes(parsed.finishes),
    extractionSummary: parsed.extractionSummary ? String(parsed.extractionSummary) : '',
    scopeNotes: parsed.scopeNotes ? String(parsed.scopeNotes) : '',
    confidence: parsed.confidence ? String(parsed.confidence) : '',
    model: usage?.model,
    usage: usage ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens } : undefined,
    sheetIndex: index.length ? index : undefined,
  }
}

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
