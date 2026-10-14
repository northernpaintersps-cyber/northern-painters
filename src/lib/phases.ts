// The phases of a job, and matching an hour to one.
//
// A labour row now carries phase_name and phase_id (see
// supabase/np-labour-phase.sql). The name is the real key: a quote's process
// ids are regenerated every time the steps are reloaded, so an id-only link
// breaks the moment anyone presses "Load Process Steps" again.
//
// Each phase also carries `covers` — the substrate keys it works on — which is
// how hours logged against a phase become hours against surfaces.

type Row = Record<string, any>

export interface JobPhase {
  id: string
  name: string
  /** Substrate keys this phase works on. Empty for setup, access, clean-up. */
  covers: string[]
  service?: string
  /** Hours estimated at quote time, for comparing against what it took. */
  estHours?: number
}

/** The phases written onto a job when its quote was saved. */
export function jobPhases(job: Row | null | undefined): JobPhase[] {
  const raw = job?.extra?.processes
  if (!Array.isArray(raw)) return []
  return raw
    .map((p: any): JobPhase => ({
      id: String(p?.id ?? ''),
      name: String(p?.name ?? '').trim(),
      covers: Array.isArray(p?.covers) ? p.covers.map(String) : [],
      service: p?.service ? String(p.service) : undefined,
      estHours: Number(p?.hours) || 0,
    }))
    .filter(p => p.name)
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/**
 * The phase an entry belongs to. The id is tried first and the name second,
 * because the id is exact while it lasts and the name is what survives a
 * reload. Returns null rather than guessing when neither matches — a wrong
 * attribution is worse than an unattributed hour.
 */
export function matchPhase(phases: JobPhase[], entry: Row): JobPhase | null {
  const byId = entry?.phase_id && phases.find(p => p.id === entry.phase_id)
  if (byId) return byId
  const name = String(entry?.phase_name ?? '').trim()
  if (!name) return null
  const n = norm(name)
  return phases.find(p => norm(p.name) === n)
    ?? phases.find(p => norm(p.name).includes(n) || n.includes(norm(p.name)))
    ?? null
}

/** The closest phase to a name the model or the user typed. */
export const findPhaseByName = (phases: JobPhase[], name: string): JobPhase | null =>
  matchPhase(phases, { phase_name: name })

export interface PhaseHours {
  /** Hours against each phase name that matched one. */
  byPhase: Record<string, number>
  /**
   * Hours spread across substrate keys. A phase covering three substrates
   * splits its hours between them by their share of the job's book hours, so a
   * phase that touches the ceilings and the walls does not credit a square
   * metre of cornice with a day's work.
   */
  bySubstrate: Record<string, number>
  /** Hours on entries that matched no phase. Still part of the job total. */
  untagged: number
  total: number
}

/**
 * Split a job's logged hours by phase, and through each phase's `covers` by
 * substrate. `weight` supplies each substrate's share — pass the job's book
 * hours per substrate, so a big wall area takes more of a phase than a small
 * one. Falls back to an even split when no weights are given.
 */
export function splitHours(
  phases: JobPhase[], entries: Row[], weight: Record<string, number> = {},
): PhaseHours {
  const byPhase: Record<string, number> = {}
  const bySubstrate: Record<string, number> = {}
  let untagged = 0
  let total = 0

  for (const e of entries) {
    const hours = Number(e?.hours) || 0
    if (hours <= 0) continue
    total += hours
    const phase = matchPhase(phases, e)
    if (!phase) { untagged += hours; continue }
    byPhase[phase.name] = (byPhase[phase.name] ?? 0) + hours

    const keys = phase.covers.filter(Boolean)
    if (!keys.length) continue   // setup and clean-up belong to no surface
    const weights = keys.map(k => (weight[k] ?? 0))
    const sum = weights.reduce((a, b) => a + b, 0)
    keys.forEach((k, i) => {
      const share = sum > 0 ? weights[i] / sum : 1 / keys.length
      bySubstrate[k] = (bySubstrate[k] ?? 0) + hours * share
    })
  }

  const r = (o: Record<string, number>) =>
    Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v * 100) / 100]))
  return {
    byPhase: r(byPhase),
    bySubstrate: r(bySubstrate),
    untagged: Math.round(untagged * 100) / 100,
    total: Math.round(total * 100) / 100,
  }
}
