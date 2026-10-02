// Sanity checks on an AI takeoff, run before anything reaches the form.
//
// The model is good at reading drawings and bad at noticing when it has
// answered in the wrong unit. These catch the failure modes that have actually
// cost money — a count returned as lineal metres, a ceiling area that does not
// match the floor it sits under — and surface them next to the number rather
// than letting them through.
//
// Pure, no React: checkable without running the app.

import { SUB_BY_KEY } from './substrates'
import type { TakeoffRow } from './takeoffSchema'

export type CheckLevel = 'warn' | 'error'
export interface Warning { level: CheckLevel; text: string }

/** Every threshold in one place, so they can be tuned without hunting. */
export const CHECK_LIMITS = {
  /**
   * Architraves counts openings, so it can never meaningfully exceed the
   * number of doors and windows — a little slack only for cased openings with
   * no door leaf. Anything beyond this multiple is the old lineal-metre bug,
   * which produced roughly five per door.
   */
  architravePerOpening: 1.5,
  /** Ceiling area as a fraction of stated floor area. */
  ceilingVsFloorMin: 0.85,
  ceilingVsFloorMax: 1.25,
  /** Wall area divided by ceiling area, for a 2.4–2.7m stud. */
  wallsToCeilingsMin: 1.8,
  wallsToCeilingsMax: 4.0,
  /** Counts above these are more likely a unit error than a big house. */
  maxGarageDoors: 4,
  maxWardrobes: 12,
}

const r1 = (n: number) => Math.round(n * 10) / 10

/**
 * Warnings per substrate key. An `error` is something that is almost certainly
 * wrong and should not be applied without a look; a `warn` is worth checking.
 */
export function checkTakeoff(
  rows: TakeoffRow[],
  ctx: { totalFloorArea?: number | null } = {},
): Record<string, Warning[]> {
  const out: Record<string, Warning[]> = {}
  const add = (key: string, level: CheckLevel, text: string) => {
    (out[key] ??= []).push({ level, text })
  }

  const qty = (key: string) => rows.find(r => r.key === key)?.qty ?? 0
  const has = (key: string) => rows.some(r => r.key === key)

  for (const row of rows) {
    const sub = SUB_BY_KEY[row.key]
    if (!sub) continue

    // The expensive one: a quantity measured in the wrong unit entirely.
    if (row.unit && row.unit !== sub.unit) {
      add(row.key, 'error',
        `Returned in ${row.unit} but ${sub.label} is measured in ${sub.unit}. `
        + 'The number is in the wrong unit — check it before applying.')
    }

    // A count of things cannot be fractional.
    if (sub.unit === 'qty' && Number.isFinite(row.qty) && !Number.isInteger(row.qty)) {
      add(row.key, 'error',
        `${sub.label} is a count but came back as ${row.qty}. Likely measured as an area or a length.`)
    }
  }

  // Architraves are openings. The old prompt asked for ~5 lineal metres per
  // door, so a figure several times the opening count is that bug resurfacing.
  const openings = qty('doors_i') + qty('win_i')
  if (has('architraves') && openings > 0) {
    const arch = qty('architraves')
    if (arch > openings * CHECK_LIMITS.architravePerOpening) {
      add('architraves', 'error',
        `${arch} architraves against ${openings} door and window openings. `
        + 'This looks like lineal metres rather than a count of openings.')
    } else if (arch < qty('doors_i')) {
      add('architraves', 'warn',
        `${arch} architrave sets but ${qty('doors_i')} doors — most door openings are architraved.`)
    }
  }

  const floor = Number(ctx.totalFloorArea) || 0
  const ceilings = qty('ceilings') + qty('wet_ceil')
  const walls = qty('walls') + qty('wet_walls')

  if (floor > 0 && ceilings > 0) {
    const ratio = ceilings / floor
    if (ratio < CHECK_LIMITS.ceilingVsFloorMin || ratio > CHECK_LIMITS.ceilingVsFloorMax) {
      add('ceilings', 'warn',
        `${r1(ceilings)} m² of ceiling against ${r1(floor)} m² of floor (${r1(ratio * 100)}%). `
        + 'Ceiling area normally tracks floor area closely.')
    }
  }

  if (ceilings > 0 && walls > 0) {
    const ratio = walls / ceilings
    if (ratio < CHECK_LIMITS.wallsToCeilingsMin || ratio > CHECK_LIMITS.wallsToCeilingsMax) {
      add('walls', 'warn',
        `${r1(walls)} m² of wall to ${r1(ceilings)} m² of ceiling is a ratio of ${r1(ratio)}. `
        + `Expect roughly ${CHECK_LIMITS.wallsToCeilingsMin}–${CHECK_LIMITS.wallsToCeilingsMax} at normal stud height.`)
    }
  }

  // Wet areas are split off from the main walls and ceilings, so one without
  // the other usually means half the split was missed.
  if (qty('wet_walls') > 0 && qty('wet_ceil') === 0) {
    add('wet_walls', 'warn', 'Wet area walls measured but no wet area ceilings.')
  }
  if (qty('wet_ceil') > 0 && qty('wet_walls') === 0) {
    add('wet_ceil', 'warn', 'Wet area ceilings measured but no wet area walls.')
  }

  if (qty('eaves') > 0 && ceilings > 0 && qty('eaves') > ceilings) {
    add('eaves', 'warn',
      `${r1(qty('eaves'))} m² of eaves exceeds ${r1(ceilings)} m² of ceiling — eaves are usually a fraction of the footprint.`)
  }

  if (qty('garage_e') > CHECK_LIMITS.maxGarageDoors) {
    add('garage_e', 'warn',
      `${qty('garage_e')} garage doors. If this is square metres, it is in the wrong unit.`)
  }
  if (qty('wardrobes') > CHECK_LIMITS.maxWardrobes) {
    add('wardrobes', 'warn',
      `${qty('wardrobes')} wardrobe units. If this is square metres, it is in the wrong unit.`)
  }

  return out
}

/** True when any check on this row says the number should not be trusted. */
export const hasError = (ws: Warning[] | undefined) => !!ws?.some(w => w.level === 'error')
