// The painting scope, as something you can look at rather than add up.
//
// The substrate list answers "what did I type", and the takeoff answers "what
// did the AI measure", and neither alone tells you whether the scope is right.
// This joins them: every line of work with the arithmetic behind it, the
// sheets it was read from, the coating it will get, and whatever the checks
// had to say about it.
//
// Pure — no React, no Supabase — so the derivation can be checked without
// logging in.

import {
  SUBSTRATES, SUB_BY_KEY, coatOf, unitLabel, subTotal,
  type SubEntry, type SubGroup, type SubUnit, type CoatSettings, type FinishSpec,
} from './substrates'
import type { QuantityExtraction } from './ai'
import type { RowConfidence } from './takeoffSchema'
import type { Warning } from './takeoffChecks'

export interface ScopePhoto {
  id: string
  /** Something an <img> can show: a signed bucket link or an inline data URL. */
  data: string
  /** The bucket path, so the link can be signed again when the quote reopens. */
  path?: string
  tag?: string
  label?: string
  source: 'visit' | 'upload'
}

export interface ScopeEvidence {
  /** The arithmetic: "Bed1 3.6x3.2 + Bed2 3.0x3.4 = 21.7". */
  basis: string
  sheets: string[]
  confidence: RowConfidence
  /** What the AI measured for the whole substrate. */
  takeoffQty: number
  /** The typed lines no longer sum to what was measured. */
  drifted: boolean
}

export interface ScopeItem {
  /** Stable across reorders — `${key}::${lineId}`. */
  id: string
  key: string
  lineId: string
  /** "Doors interior — French", or just the label when the entry is not split. */
  title: string
  type: string
  group: SubGroup
  qty: number
  unit: SubUnit
  unitText: string
  coatText: string
  spec?: FinishSpec
  notes: string
  /**
   * Only ever set on the first line of a substrate. A TakeoffRow is per
   * substrate — it has no idea the doors were split into French and solid —
   * so repeating the same basis on each line would read as though the AI
   * had measured them separately.
   */
  evidence: ScopeEvidence | null
  /** True for a later line of a split substrate, which shares the first one's takeoff. */
  partOf: string
  warnings: Warning[]
  photoIds: string[]
}

/** How much of a line's quantity may drift from the takeoff before it is flagged. */
const DRIFT_TOLERANCE = 0.05

/** The coating in one line, as the panel shows it. */
export function coatText(c: CoatSettings, spec?: FinishSpec): string {
  const parts: string[] = []
  if (spec?.product) parts.push(spec.colour ? `${spec.product} · ${spec.colour}` : spec.product)
  const coats = c.uc !== 'None' && c.ucCoats > 0
    ? `${c.ucCoats} x ${c.uc} undercoat + ${c.topCoats} top`
    : `${c.topCoats} coat${c.topCoats === 1 ? '' : 's'}`
  parts.push(coats, c.fin, c.app)
  // CoatSettings.colour is the magnitude of colour change, a pricing input —
  // showing "Moderate change" beside a named colour reads as a contradiction.
  return parts.filter(Boolean).join(' · ')
}

export interface BuildScopeInput {
  substrates: Record<string, SubEntry>
  takeoff?: QuantityExtraction | null
  /** From checkTakeoff — passed in so the review table and the panel share one call. */
  warnings?: Record<string, Warning[]>
  finishSpecs?: Record<string, FinishSpec>
  /** ScopeItem.id -> photo ids. */
  photoLinks?: Record<string, string[]>
  /** Include substrates that are ticked off. Default false. */
  includeExcluded?: boolean
}

export function buildScope(input: BuildScopeInput): ScopeItem[] {
  const { substrates, takeoff, warnings, finishSpecs, photoLinks, includeExcluded } = input
  const rowFor = new Map((takeoff?.quantities ?? []).map(r => [r.key, r]))
  const out: ScopeItem[] = []

  // Walk SUBSTRATES rather than the record, so the panel's order matches the
  // substrate picker's.
  for (const s of SUBSTRATES) {
    const entry = substrates?.[s.key]
    if (!entry) continue
    if (!entry.inc && !includeExcluded) continue

    const coat = coatOf(substrates, s.key)
    const spec = finishSpecs?.[s.key]
    const row = rowFor.get(s.key)
    const typed = subTotal(entry)

    let first = true
    for (const line of entry.lines ?? []) {
      const qty = Number(line.qty) || 0
      // emptySubstrates() gives every substrate a blank placeholder line.
      // Without this, every ticked substrate renders an empty row.
      if (qty <= 0 && !line.type && !line.notes) continue

      const id = `${s.key}::${line.id}`
      out.push({
        id,
        key: s.key,
        lineId: line.id,
        title: line.type ? `${s.label} — ${line.type}` : s.label,
        type: line.type ?? '',
        group: s.group,
        qty,
        unit: s.unit,
        unitText: unitLabel(s.unit),
        coatText: coatText(coat, spec),
        spec,
        notes: line.notes ?? '',
        evidence: first && row
          ? {
              basis: row.basis,
              sheets: row.sheets ?? [],
              confidence: row.confidence,
              takeoffQty: row.qty,
              drifted: Math.abs(typed - row.qty) > DRIFT_TOLERANCE * Math.max(1, row.qty),
            }
          : null,
        partOf: first ? '' : s.label,
        warnings: first ? (warnings?.[s.key] ?? []) : [],
        photoIds: photoLinks?.[id] ?? [],
      })
      first = false
    }
  }

  return out
}

/** The items grouped for display, keeping SUBSTRATES order within each group. */
export function groupScope(items: ScopeItem[]): Array<{ group: SubGroup; items: ScopeItem[] }> {
  const groups: SubGroup[] = ['Interior', 'Exterior', 'Specialty']
  return groups
    .map(group => ({ group, items: items.filter(i => i.group === group) }))
    .filter(g => g.items.length > 0)
}

export interface ScopeStats {
  items: number
  sqm: number
  lm: number
  count: number
  withEvidence: number
  drifted: number
  warn: number
  errors: number
  photos: number
}

export function scopeStats(items: ScopeItem[]): ScopeStats {
  const s: ScopeStats = {
    items: items.length, sqm: 0, lm: 0, count: 0,
    withEvidence: 0, drifted: 0, warn: 0, errors: 0, photos: 0,
  }
  for (const i of items) {
    if (i.unit === 'sqm') s.sqm += i.qty
    else if (i.unit === 'lm') s.lm += i.qty
    else s.count += i.qty
    if (i.evidence) s.withEvidence++
    if (i.evidence?.drifted) s.drifted++
    s.errors += i.warnings.filter(w => w.level === 'error').length
    s.warn += i.warnings.filter(w => w.level === 'warn').length
    s.photos += i.photoIds.length
  }
  s.sqm = Math.round(s.sqm * 10) / 10
  s.lm = Math.round(s.lm * 10) / 10
  return s
}

/** Photo links whose scope item no longer exists, so the map cannot grow forever. */
export function pruneLinks(
  links: Record<string, string[]>, items: ScopeItem[],
): Record<string, string[]> {
  const live = new Set(items.map(i => i.id))
  const out: Record<string, string[]> = {}
  for (const [id, ids] of Object.entries(links ?? {})) {
    if (live.has(id) && ids.length) out[id] = ids
  }
  return out
}

/** A one-line summary for the collapsed bar on a phone. */
export function scopeSummary(s: ScopeStats): string {
  // "lines", not "items" — the count of qty-unit substrates is also "items".
  const bits: string[] = [`${s.items} line${s.items === 1 ? '' : 's'}`]
  if (s.sqm > 0) bits.push(`${s.sqm} m²`)
  if (s.lm > 0) bits.push(`${s.lm} lm`)
  if (s.count > 0) bits.push(`${s.count} items`)
  const flags = s.errors + s.warn
  if (flags > 0) bits.push(`${flags} flag${flags === 1 ? '' : 's'}`)
  return bits.join(' · ')
}

export { SUB_BY_KEY }
