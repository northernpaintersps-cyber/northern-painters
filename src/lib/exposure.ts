// How exposed a job is to the weather.
//
// This is what makes the calendar's forecast actionable: 20mm on a day booked
// with a kitchen cabinet respray is irrelevant, and the same 20mm on a roof
// coating is the day cancelled. Without the classification the tint has to
// either flag everything or flag nothing.
//
// It rides on the `weather` column that np_jobs already has — it held
// ['None', 'High - exterior'] and nothing ever read it — so there is no
// migration and no SQL to run. Old values map in `normalise` below.

import { SERVICE_BY_ID } from '@/lib/quoteData'

export type Exposure = 'none' | 'partly' | 'full'

export const EXPOSURE_ORDER: Exposure[] = ['none', 'partly', 'full']

/** What goes in the column, and what the Select shows. */
export const EXPOSURE_LABELS: Record<Exposure, string> = {
  none: 'None — inside work',
  partly: 'Partly exposed',
  full: 'Fully exposed',
}

export const EXPOSURE_HINT: Record<Exposure, string> = {
  none: 'Inside, under roof. Rain does not stop it.',
  partly: 'Some outside work. Rain costs part of the day.',
  full: 'All outside. Rain stops it.',
}

/** Tailwind classes for a tag. Grey, amber, red — no overlap with the status colours. */
export const EXPOSURE_TAG: Record<Exposure, string> = {
  none: 'bg-gray-100 text-gray-600 border-gray-200',
  partly: 'bg-amber-100 text-amber-800 border-amber-300',
  full: 'bg-red-100 text-red-800 border-red-300',
}

export const EXPOSURE_ICON_COLOR: Record<Exposure, string> = {
  none: 'text-gray-400',
  partly: 'text-amber-600',
  full: 'text-red-600',
}

/** Short, for a chip or a narrow column. */
export const EXPOSURE_SHORT: Record<Exposure, string> = {
  none: 'Inside', partly: 'Partly out', full: 'Outside',
}

/** Rain is only worth flagging on a job that rain can actually stop. */
export const isExposed = (e: Exposure): boolean => e !== 'none'

// ── Reading the stored value ─────────────────────────────────

/**
 * The stored string back to a level. Accepts the current labels, the two legacy
 * values, and the bare level, since a column edited by hand over two years is
 * not a tidy enum.
 */
export function normalise(stored?: string | null): Exposure | null {
  const v = (stored ?? '').trim().toLowerCase()
  if (!v) return null
  // A bare 'None' is the old field's default, which was written onto every job
  // created and read by nothing — it records no decision, so treat it as unset
  // and let the job type speak. Otherwise every exterior job on the books would
  // claim to be inside work. The current label carries its own words, so it is
  // distinguishable from the default it replaces.
  if (v === 'none') return null
  if (v.startsWith('none')) return 'none'
  if (v.startsWith('part')) return 'partly'
  if (v.startsWith('full')) return 'full'
  if (v.startsWith('high')) return 'full'          // legacy 'High - exterior'
  if (v.includes('exterior') || v.includes('outside')) return 'full'
  if (v.includes('interior') || v.includes('inside')) return 'none'
  return null
}

/**
 * What a job type implies, used when nothing is stored. SERVICES already
 * records interior/exterior per service, which is exactly this question.
 *
 * Imported and legacy rows hold type strings that are not service ids and can
 * be null, so there is a word test behind it. An unrecognised type lands on
 * 'partly' rather than 'none': the cost of a tint you did not need is smaller
 * than the cost of a wet day you were not warned about.
 */
export function deriveExposure(type?: string | null): Exposure {
  const svc = type ? SERVICE_BY_ID[type] : undefined
  if (svc) {
    if (svc.interior && svc.exterior) return 'partly'
    return svc.exterior ? 'full' : 'none'
  }
  const t = (type ?? '').toLowerCase()
  if (!t) return 'partly'
  if (/exterior|roof|deck|driveway|fence|render|gutter|weatherboard|outside/.test(t)) return 'full'
  if (/interior|cabinet|kitchen|inside/.test(t)) return 'none'
  return 'partly'
}

/** The level for a job: what was set, or what its type implies. */
export const jobExposure = (job: { weather?: string | null; type?: string | null }): Exposure =>
  normalise(job?.weather) ?? deriveExposure(job?.type)

/** True when nothing is stored, so the UI can say the level was inferred. */
export const isInferred = (job: { weather?: string | null }): boolean =>
  normalise(job?.weather) == null

/** The Select options, in order, plus the inferred-default placeholder. */
export const EXPOSURE_OPTIONS: string[] = EXPOSURE_ORDER.map(e => EXPOSURE_LABELS[e])

/** The level stored for an option label. */
export const exposureFor = (label: string): Exposure => normalise(label) ?? 'partly'
