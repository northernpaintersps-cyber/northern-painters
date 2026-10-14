// Your own substrates, added in Settings.
//
// The catalogue is code, and deliberately so: each entry needs a painted area
// per unit, a production rate and a definition of what its number counts, and
// getting those right is most of the value. But no fixed list covers every job,
// so this merges your own entries into the same four maps the built-ins live
// in, keyed the same way, so a custom substrate is not a second-class row —
// it reaches the picker, the quote, the materials calculation and the AI
// takeoff exactly as a built-in does.
//
// Stored inside the business settings JSON, so there is no migration.

import {
  BUILTIN_SUBSTRATES, SUBSTRATES, AREA_PER_UNIT, reindexSubstrates,
  GROUPS, type Substrate, type SubGroup, type SubUnit,
} from '@/lib/substrates'
import { PROD_RATES } from '@/lib/quoteData'
import { COUNT_DEFS, rebuildTakeoffSchema } from '@/lib/takeoffSchema'

/** Custom keys carry this prefix so they can never collide with a built-in. */
export const CUSTOM_PREFIX = 'x_'

export const isCustomKey = (key: string): boolean => key.startsWith(CUSTOM_PREFIX)

const isBuiltin = (key: string): boolean => BUILTIN_SUBSTRATES.some(s => s.key === key)

export interface CustomSubstrate {
  key: string
  label: string
  unit: SubUnit
  group: SubGroup
  /** Optional. Blank means you price it on the quote instead. */
  paint?: string
  method?: string
  finish?: string
  /** Square metres of paint per unit of quantity. Blank means none is worked out. */
  areaPerUnit?: number | null
  /** Hours per unit. Blank means it contributes no hours to the estimate. */
  hoursPerUnit?: number | null
  typeOpts?: string[]
}

/**
 * A label to a key: lower case, words joined by underscores, prefixed.
 *
 * It avoids the SHIPPED keys and the ones already used in this batch, and
 * deliberately not SUB_BY_KEY — that holds the previous registration's customs,
 * which are about to be replaced by this one. Consulting it renamed a keyless
 * row to x_pool_fence_2 on every reload, which would orphan it from any quote
 * that had measured against it.
 */
export function keyFor(label: string, taken: string[] = []): string {
  const slug = label.toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24) || 'substrate'
  let key = CUSTOM_PREFIX + slug
  let n = 2
  while (taken.includes(key) || isBuiltin(key)) { key = `${CUSTOM_PREFIX}${slug}_${n}`; n++ }
  return key
}

/**
 * An area substrate is one to one by definition. A counted one defaults to
 * zero rather than to a guess: no paint is obviously wrong and gets fixed,
 * whereas a plausible invented girth is wrong and never gets looked at.
 */
export const defaultArea = (unit: SubUnit): number => (unit === 'sqm' ? 1 : 0)

/** What the AI is told to count, built from the unit since you did not write one. */
function countDef(c: CustomSubstrate): string {
  const noun = c.unit === 'sqm' ? 'Square metres' : c.unit === 'lm' ? 'Lineal metres' : 'The number'
  const tail = c.unit === 'qty' ? ` of ${c.label.toLowerCase()}, counted individually.` : ` of ${c.label.toLowerCase()}.`
  return `${noun}${tail} A substrate added by the estimator: only return a figure where the drawings or the scope clearly call for it.`
}

export const validUnit = (u: unknown): u is SubUnit =>
  u === 'sqm' || u === 'lm' || u === 'qty'

/** Drop anything malformed rather than let it break the catalogue. */
export function cleanCustoms(raw: unknown): CustomSubstrate[] {
  if (!Array.isArray(raw)) return []
  const seen: string[] = []
  const out: CustomSubstrate[] = []
  for (const r of raw) {
    const label = String((r as any)?.label ?? '').trim()
    const unit = (r as any)?.unit
    const group = (r as any)?.group
    if (!label || !validUnit(unit) || !GROUPS.includes(group)) continue
    let key = String((r as any)?.key ?? '').trim()
    // A key that is missing, collides with a built-in, or lost its prefix gets
    // a fresh one — a custom entry must never shadow a built-in substrate.
    if (!key || !isCustomKey(key) || seen.includes(key) || isBuiltin(key)) {
      key = keyFor(label, seen)
    }
    seen.push(key)
    const num = (v: unknown) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v))
    out.push({
      key, label, unit, group,
      paint: String((r as any)?.paint ?? '').trim(),
      method: String((r as any)?.method ?? '').trim(),
      finish: String((r as any)?.finish ?? '').trim(),
      areaPerUnit: num((r as any)?.areaPerUnit),
      hoursPerUnit: num((r as any)?.hoursPerUnit),
      typeOpts: Array.isArray((r as any)?.typeOpts)
        ? (r as any).typeOpts.map(String).filter(Boolean) : [],
    })
  }
  return out
}

const toSubstrate = (c: CustomSubstrate): Substrate => ({
  key: c.key,
  label: c.label,
  unit: c.unit,
  group: c.group,
  paint: c.paint || 'Priced on the quote',
  defMethod: c.method || 'Brush',
  defFinish: c.finish || 'Low Sheen',
  typeOpts: c.typeOpts ?? [],
})

/**
 * Rebuild the catalogue as the built-ins plus these. Idempotent: it starts
 * from the shipped list every time, so calling it on every settings change
 * cannot accumulate duplicates.
 */
export function registerCustomSubstrates(raw: unknown): CustomSubstrate[] {
  const customs = cleanCustoms(raw)

  // Clear the previous customs out of the keyed maps before rebuilding, or a
  // substrate you deleted would keep its rate and reappear in the guards.
  for (const k of Object.keys(AREA_PER_UNIT)) if (isCustomKey(k)) delete AREA_PER_UNIT[k]
  for (const k of Object.keys(PROD_RATES)) if (isCustomKey(k)) delete PROD_RATES[k]
  for (const k of Object.keys(COUNT_DEFS)) if (isCustomKey(k)) delete COUNT_DEFS[k]

  for (const c of customs) {
    AREA_PER_UNIT[c.key] = c.areaPerUnit ?? defaultArea(c.unit)
    PROD_RATES[c.key] = c.hoursPerUnit ?? 0
    COUNT_DEFS[c.key] = countDef(c)
  }

  // Grouped order, so your own entries sit with their group in the picker
  // rather than in a block at the end.
  const merged = GROUPS.flatMap(g => [
    ...BUILTIN_SUBSTRATES.filter(s => s.group === g),
    ...customs.filter(c => c.group === g).map(toSubstrate),
  ])
  reindexSubstrates(merged)
  rebuildTakeoffSchema()
  return customs
}

/** Which of a custom substrate's numbers are missing, for the warning in Settings. */
export function missingRates(c: CustomSubstrate): string[] {
  const out: string[] = []
  if (c.unit !== 'sqm' && (c.areaPerUnit ?? 0) <= 0) out.push('paint')
  if ((c.hoursPerUnit ?? 0) <= 0) out.push('hours')
  return out
}

/** True once SUBSTRATES holds nothing but the shipped list. */
export const noCustoms = (): boolean => SUBSTRATES.length === BUILTIN_SUBSTRATES.length
