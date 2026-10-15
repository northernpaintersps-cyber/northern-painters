// Pricing a quote in groups, each from its own substrates.
//
// A client asks for interior, exterior and deck restoring priced separately,
// and the groups are not fixed — sometimes rafters and architraves are wanted
// apart even though both are interior. So a group is any set of substrates,
// and its price is built UP from the work in it.
//
// The first version of this divided the finished quote price across the groups
// pro-rata. That is one estimate presented as several: a group with expensive
// paint and light labour came out shaped by the job average rather than by its
// own work. Each group is now costed from its own labour and its own
// materials, with the quote's own percentages applied to its own figures, and
// the quote total is the sum of the groups rather than the thing being carved
// up.
//
// Two properties hold together, which is what makes it safe to print:
// every group's price is its own work, AND the groups sum to exactly what the
// quote would have charged undivided.

import { SUB_BY_KEY, substrateTotals, type SubEntry, type SubGroup } from '@/lib/substrates'
import { serviceFor, SERVICES } from '@/lib/quoteData'
import { genId } from '@/lib/utils'

export type SplitBy = 'group' | 'service' | 'custom'

/** A group as the user arranges it. The price is not theirs to set. */
export interface PartDef {
  id: string
  label: string
  keys: string[]
}

export interface PricedPart extends PartDef {
  /** Its own labour, after contingency. */
  labour: number
  /** Its own materials, after waste, including its share of consumables. */
  materials: number
  /** Equipment and travel, which belong to the job and not to a surface. */
  shared: number
  /** What the client sees against this line, ex GST. */
  total: number
}

export interface SplitResult {
  parts: PricedPart[]
  /**
   * Substrates in no group. Their cost is in NO part and therefore in no
   * total — an error to resolve, not a rounding note.
   */
  unassigned: string[]
  /** What the groups come to. The quote total when a split is in use. */
  total: number
  labour: number
  materials: number
  shared: number
}

const r2 = (n: number) => Math.round(n * 100) / 100
const cents = (n: number) => Math.round(n * 100)

/** The substrates a quote actually carries a quantity for. */
export function quotedKeys(substrates: Record<string, SubEntry>): string[] {
  const totals = substrateTotals(substrates)
  const order = Object.keys(SUB_BY_KEY)
  return Object.keys(totals)
    .filter(k => SUB_BY_KEY[k] && Number(totals[k]) > 0)
    .sort((a, b) => order.indexOf(a) - order.indexOf(b))
}

// ── Direct cost per substrate ───────────────────────────────

export interface DirectCosts {
  labour: Record<string, number>
  materials: Record<string, number>
  /** Labour on phases that touch no surface: set-up, protect, clean-up. */
  unattributedLabour: number
}

/**
 * What each surface is carrying, before any percentage or shared cost.
 *
 * Quantity mode gives labour per key directly. Process mode gives it through
 * each phase's `covers`, split across the substrates a phase touches and
 * weighted by their book hours, so a phase over a big wall and a small ceiling
 * does not credit them equally.
 */
export function directCosts(input: {
  keys: string[]
  labourByKey?: Record<string, number>
  materialsByKey?: Record<string, number>
  processes?: Array<{ name: string; hours: number; np: number; covers?: string[] }>
  avgRate?: number
  weight?: Record<string, number>
}): DirectCosts {
  const { keys, labourByKey, materialsByKey = {}, processes, avgRate = 0, weight = {} } = input
  const labour: Record<string, number> = Object.fromEntries(keys.map(k => [k, 0]))
  const materials: Record<string, number> = Object.fromEntries(keys.map(k => [k, 0]))
  let unattributedLabour = 0

  if (labourByKey && Object.keys(labourByKey).length) {
    for (const k of keys) labour[k] += Number(labourByKey[k]) || 0
  } else if (processes?.length) {
    for (const p of processes) {
      const cost = (Number(p.hours) || 0) * avgRate * Math.max(1, Number(p.np) || 1)
      if (cost <= 0) continue
      const covers = (p.covers ?? []).filter(k => keys.includes(k))
      if (!covers.length) { unattributedLabour += cost; continue }
      const ws = covers.map(k => weight[k] ?? 0)
      const tot = ws.reduce((a, b) => a + b, 0)
      covers.forEach((k, i) => {
        labour[k] += cost * (tot > 0 ? ws[i] / tot : 1 / covers.length)
      })
    }
  }

  for (const k of keys) materials[k] += Number(materialsByKey[k]) || 0
  return { labour, materials, unattributedLabour }
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
 * One group per service in the quote — interior repaint, exterior repaint,
 * deck and timber coating. A substrate claimed by two services goes to the
 * first that claims it, since splitting one surface across two prices is not
 * something a client can act on. Anything no service claims joins the main job
 * type rather than being left out and silently uncharged.
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

// ── Pricing ─────────────────────────────────────────────────

export interface PricingInput {
  /** The quote's own computed figures, for scaling a hand-set override. */
  labourCost: number
  materialsTotal: number
  /** The adjustment fields, seeded from the above and editable. */
  adjLab: number
  adjMat: number
  contingency: number
  waste: number
  overheadPct: number
  consTotal: number
  equipTotal: number
  travelCost: number
  /**
   * True when the quote prices from the adjusted total — i.e. an estimate has
   * been generated. False means the plain running subtotal, which applies no
   * percentages and does include equipment.
   */
  adjusted: boolean
}

/**
 * Price each group from its own work.
 *
 * The arithmetic mirrors the quote's own, applied to each group's base rather
 * than the whole: contingency on its labour, waste on its materials plus its
 * share of consumables, overhead on that subtotal, travel on top. Which means
 * the groups sum to exactly what the quote charges undivided — proved by test
 * rather than asserted here.
 *
 * Where a labour or materials override has been typed by hand, each group is
 * scaled by the same ratio, so an adjusted total still distributes by the work.
 *
 * Runs in cents with the last group taking the remainder, because three
 * rounded numbers that miss the total by a cent is a document you have to
 * explain.
 */
export function priceGroups(
  defs: PartDef[], direct: DirectCosts, p: PricingInput,
): PricedPart[] {
  if (!defs.length) return []

  const labOf = (d: PartDef) => d.keys.reduce((t, k) => t + (direct.labour[k] ?? 0), 0)
  const matOf = (d: PartDef) => d.keys.reduce((t, k) => t + (direct.materials[k] ?? 0), 0)

  // Phase labour that belongs to no surface is part of the job and has to be
  // carried; it rides with the shared costs rather than vanishing.
  const rawLab = defs.map(labOf)
  const rawMat = defs.map(matOf)
  const totalRawLab = rawLab.reduce((a, b) => a + b, 0)
  const totalRawMat = rawMat.reduce((a, b) => a + b, 0)
  const totalDirect = totalRawLab + totalRawMat

  // A hand-set override moves every group by the same ratio.
  const labScale = p.labourCost > 0 ? p.adjLab / p.labourCost : (totalRawLab > 0 ? 0 : 1)
  const matScale = p.materialsTotal > 0 ? p.adjMat / p.materialsTotal : (totalRawMat > 0 ? 0 : 1)

  const shares = defs.map((_, i) =>
    totalDirect > 0 ? (rawLab[i] + rawMat[i]) / totalDirect : 1 / defs.length)

  const priced = defs.map((d, i) => {
    const share = shares[i]
    if (!p.adjusted) {
      // No estimate yet: the quote is the plain sum of its parts, equipment
      // included and no percentages anywhere.
      const labour = rawLab[i] + direct.unattributedLabour * share
      const materials = rawMat[i]
      const shared = (p.consTotal + p.equipTotal) * share
      return { d, labour, materials, shared, total: labour + materials + shared }
    }
    const labour = (rawLab[i] * labScale + direct.unattributedLabour * share)
      * (1 + p.contingency / 100)
    const materials = (rawMat[i] * matScale + p.consTotal * share) * (1 + p.waste / 100)
    const travel = p.travelCost * share
    // Overhead lands on the subtotal, travel after it — the quote's own order.
    const overhead = (labour + materials) * (p.overheadPct / 100)
    // Consumables are already inside materials, the way the quote folds them
    // in before waste. Equipment is not in the adjusted total at all, which is
    // existing behaviour and not something to change quietly here.
    return { d, labour, materials, shared: overhead + travel,
             total: labour + materials + overhead + travel }
  })

  // Cents, with the remainder on the last group.
  const grand = priced.reduce((t, x) => t + cents(x.total), 0)
  let allocated = 0
  return priced.map((x, i) => {
    const last = i === priced.length - 1
    const c = last ? grand - allocated : cents(x.total)
    allocated += c
    return {
      ...x.d,
      labour: r2(x.labour),
      materials: r2(x.materials),
      shared: r2(x.shared),
      total: c / 100,
    }
  })
}

/** Scale the groups to a figure decided for the whole job. */
export function scaleTo(parts: PricedPart[], target: number): PricedPart[] {
  const sum = parts.reduce((t, p) => t + cents(p.total), 0)
  if (!parts.length || sum <= 0) return parts
  const targetC = cents(target)
  let allocated = 0
  return parts.map((p, i) => {
    const last = i === parts.length - 1
    const c = last ? targetC - allocated : Math.round(cents(p.total) * (targetC / sum))
    allocated += c
    return { ...p, total: c / 100 }
  })
}

export function splitQuote(input: {
  substrates: Record<string, SubEntry>
  by: SplitBy
  jobType: string
  extraServices?: string[]
  defs?: PartDef[]
  labourByKey?: Record<string, number>
  materialsByKey?: Record<string, number>
  processes?: Array<{ name: string; hours: number; np: number; covers?: string[] }>
  avgRate?: number
  weight?: Record<string, number>
  pricing: PricingInput
}): SplitResult {
  const keys = quotedKeys(input.substrates)
  const defs = input.defs?.length
    ? input.defs
    : presetParts(input.by, keys, input.jobType, input.extraServices)

  const direct = directCosts({
    keys,
    labourByKey: input.labourByKey,
    materialsByKey: input.materialsByKey,
    processes: input.processes,
    avgRate: input.avgRate,
    weight: input.weight,
  })

  const assigned = new Set(defs.flatMap(d => d.keys))
  const parts = priceGroups(defs, direct, input.pricing)

  const sum = (f: (p: PricedPart) => number) => r2(parts.reduce((t, p) => t + f(p), 0))
  return {
    parts,
    // Costed bottom-up, a substrate in no group is in no price. Under the old
    // allocation it quietly rode along inside everyone else's share; now it
    // goes missing visibly, which is the honest behaviour.
    unassigned: keys.filter(k => !assigned.has(k)),
    total: sum(p => p.total),
    labour: sum(p => p.labour),
    materials: sum(p => p.materials),
    shared: sum(p => p.shared),
  }
}

/** The pricing lines the document prints. */
export const partLines = (parts: PricedPart[]): Array<{ desc: string; total: number }> =>
  parts.map(p => ({ desc: p.label, total: p.total }))
