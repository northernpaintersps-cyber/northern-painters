// Splitting one quote into separately priced parts.
//
// A client asking for the house in parts wants to see what each costs. The
// parts are allocated OUT OF the quote price rather than priced independently
// and hoped to agree, because the one thing that must not go wrong is the
// column adding up: a client reads three lines and totals them, and a document
// whose parts come to $24,897 against a stated $24,900 is a document you have
// to explain.
//
// That is also why shared costs are carried pro-rata and never itemised. By
// the time a quote prints, its price is labour plus contingency, materials
// plus waste, consumables, equipment, overhead on the subtotal and travel on
// top — and a client should not see a line for your overhead.

import { SUB_BY_KEY, substrateTotals, type SubEntry, type SubGroup } from '@/lib/substrates'
import { serviceFor, SERVICES } from '@/lib/quoteData'
import { genId } from '@/lib/utils'

export type SplitBy = 'group' | 'service' | 'custom'

/** A part as the user arranges it. The price is not theirs to set. */
export interface PartDef {
  id: string
  label: string
  keys: string[]
}

export interface QuotePart extends PartDef {
  /** Its share of the quote price, ex GST. These sum exactly to the whole. */
  total: number
  /** Labour plus materials attributable to it. Shown while arranging, never printed. */
  directCost: number
  share: number
}

export interface SplitResult {
  parts: QuotePart[]
  /** Substrates in no part. Their cost stays in the shared pool. */
  unassigned: string[]
  /** Cost belonging to no surface: set-up phases, consumables, overhead, travel. */
  shared: number
  /** Always true unless something is badly wrong; the panel watches it. */
  balances: boolean
}

const r2 = (n: number) => Math.round(n * 100) / 100
const cents = (n: number) => Math.round(n * 100)

/** The substrates a quote actually carries a quantity for. */
export function quotedKeys(substrates: Record<string, SubEntry>): string[] {
  const totals = substrateTotals(substrates)
  return Object.keys(totals)
    .filter(k => SUB_BY_KEY[k] && Number(totals[k]) > 0)
    // SUBSTRATES order, so a part's chips read the way the picker does.
    .sort((a, b) => Object.keys(SUB_BY_KEY).indexOf(a) - Object.keys(SUB_BY_KEY).indexOf(b))
}

// ── Direct cost per substrate ───────────────────────────────

/**
 * What each surface is carrying, before anything shared.
 *
 * Quantity mode gives labour per key directly. Process mode gives it through
 * each phase's `covers` — the field kept for the rates work — split across the
 * substrates a phase touches, weighted by their book labour so a phase over a
 * big wall and a small ceiling does not credit them equally. A phase covering
 * nothing is set-up or clean-up and belongs to no surface.
 */
export function directCosts(input: {
  keys: string[]
  labourByKey?: Record<string, number>
  materialsByKey?: Record<string, number>
  processes?: Array<{ name: string; hours: number; np: number; covers?: string[] }>
  avgRate?: number
  /** Relative weights for splitting a phase, usually book hours per key. */
  weight?: Record<string, number>
}): { byKey: Record<string, number>; unattributed: number } {
  const { keys, labourByKey, materialsByKey = {}, processes, avgRate = 0, weight = {} } = input
  const byKey: Record<string, number> = Object.fromEntries(keys.map(k => [k, 0]))
  let unattributed = 0

  if (labourByKey && Object.keys(labourByKey).length) {
    for (const k of keys) byKey[k] += Number(labourByKey[k]) || 0
  } else if (processes?.length) {
    for (const p of processes) {
      const cost = (Number(p.hours) || 0) * avgRate * Math.max(1, Number(p.np) || 1)
      if (cost <= 0) continue
      const covers = (p.covers ?? []).filter(k => keys.includes(k))
      if (!covers.length) { unattributed += cost; continue }
      const ws = covers.map(k => weight[k] ?? 0)
      const tot = ws.reduce((a, b) => a + b, 0)
      covers.forEach((k, i) => {
        byKey[k] += cost * (tot > 0 ? ws[i] / tot : 1 / covers.length)
      })
    }
  }

  for (const k of keys) byKey[k] += Number(materialsByKey[k]) || 0
  return { byKey, unattributed }
}

// ── The preset arrangements ─────────────────────────────────

const GROUP_ORDER: SubGroup[] = ['Interior', 'Exterior', 'Specialty']

/** Interior / Exterior / Specialty, from each substrate's own group. */
export function partsByGroup(keys: string[]): PartDef[] {
  const out: PartDef[] = []
  for (const g of GROUP_ORDER) {
    const inGroup = keys.filter(k => SUB_BY_KEY[k]?.group === g)
    if (inGroup.length) out.push({ id: `grp-${g}`, label: g, keys: inGroup })
  }
  return out
}

/**
 * One part per service in the quote.
 *
 * A substrate claimed by two services goes to the first that claims it —
 * splitting one surface across two lines is not something a client can act on.
 * Anything no service claims falls to a part named after the main job type,
 * rather than being left unassigned and quietly uncharged.
 */
export function partsByService(keys: string[], jobType: string, extraServices: string[] = []): PartDef[] {
  const services = [jobType, ...extraServices].filter(Boolean)
    .filter((s, i, a) => a.indexOf(s) === i)
  const taken = new Set<string>()
  const out: PartDef[] = []

  for (const id of services) {
    const svc = SERVICES.find(s => s.id === id) ?? serviceFor(id)
    const mine = keys.filter(k => !taken.has(k) && svc.suggests.includes(k))
    mine.forEach(k => taken.add(k))
    if (mine.length) out.push({ id: `svc-${id}`, label: id, keys: mine })
  }

  const left = keys.filter(k => !taken.has(k))
  if (left.length) {
    const first = out.find(p => p.id === `svc-${jobType}`)
    if (first) first.keys.push(...left)
    else out.push({ id: `svc-${jobType}`, label: jobType || 'Other works', keys: left })
  }
  return out
}

export const presetParts = (
  by: SplitBy, keys: string[], jobType: string, extraServices: string[] = [],
): PartDef[] =>
  by === 'service' ? partsByService(keys, jobType, extraServices) : partsByGroup(keys)

export const newPart = (label = 'New part'): PartDef => ({ id: genId('pt'), label, keys: [] })

// ── Allocation ──────────────────────────────────────────────

/**
 * Give each part its share of the quote price.
 *
 * Shares come from direct cost, so a part doing more work carries more of the
 * overheads. The arithmetic runs in cents and the last part takes the
 * remainder, which is what guarantees the column adds up — the alternative is
 * three rounded numbers that miss the total by a few cents.
 *
 * Parts with no direct cost between them split the price evenly: better than
 * dividing by zero, and it only happens on a quote with no costed substrates.
 */
export function allocate(defs: PartDef[], byKey: Record<string, number>, quotePrice: number): QuotePart[] {
  if (!defs.length) return []
  const direct = defs.map(d => d.keys.reduce((t, k) => t + (byKey[k] ?? 0), 0))
  const total = direct.reduce((a, b) => a + b, 0)
  const priceCents = cents(quotePrice)

  let allocated = 0
  return defs.map((d, i) => {
    const share = total > 0 ? direct[i] / total : 1 / defs.length
    const last = i === defs.length - 1
    // The last part absorbs the rounding, so the lines always sum to the whole.
    const c = last ? priceCents - allocated : Math.round(priceCents * share)
    allocated += c
    return {
      ...d,
      total: c / 100,
      directCost: r2(direct[i]),
      share: Math.round(share * 1000) / 1000,
    }
  })
}

export function splitQuote(input: {
  substrates: Record<string, SubEntry>
  quotePrice: number
  by: SplitBy
  jobType: string
  extraServices?: string[]
  /** Supplied for 'custom', and for renames and moves on the presets. */
  defs?: PartDef[]
  labourByKey?: Record<string, number>
  materialsByKey?: Record<string, number>
  processes?: Array<{ name: string; hours: number; np: number; covers?: string[] }>
  avgRate?: number
  weight?: Record<string, number>
}): SplitResult {
  const keys = quotedKeys(input.substrates)
  const defs = input.defs?.length
    ? input.defs
    : presetParts(input.by, keys, input.jobType, input.extraServices)

  const { byKey, unattributed } = directCosts({
    keys,
    labourByKey: input.labourByKey,
    materialsByKey: input.materialsByKey,
    processes: input.processes,
    avgRate: input.avgRate,
    weight: input.weight,
  })

  const assigned = new Set(defs.flatMap(d => d.keys))
  const unassigned = keys.filter(k => !assigned.has(k))
  // An unassigned substrate keeps its cost in the shared pool rather than
  // disappearing. A quantity that silently stops being charged for is the
  // worst thing this could do.
  const shared = r2(unattributed + unassigned.reduce((t, k) => t + (byKey[k] ?? 0), 0))

  const parts = allocate(defs, byKey, input.quotePrice)
  const sum = parts.reduce((t, p) => t + cents(p.total), 0)

  return { parts, unassigned, shared, balances: sum === cents(input.quotePrice) }
}

/** The pricing lines the document prints. */
export const partLines = (parts: QuotePart[]): Array<{ desc: string; total: number }> =>
  parts.map(p => ({ desc: p.label, total: p.total }))
