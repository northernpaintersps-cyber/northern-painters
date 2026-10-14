// The rate card: rates you have read and accepted.
//
// The point of storing it rather than asking each time is that a quote should
// never be priced by a fresh AI call. Two identical questions can give two
// different numbers; a price has to come from a figure you looked at and
// agreed to, and you have to be able to see which card priced which quote.
//
// Lives in np_settings under key 'rate_card', the way the quote drafts do, so
// there is no migration. Past versions are kept so a figure can be traced back
// after it has been replaced.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { SUB_BY_KEY } from '@/lib/substrates'
import type { RateProposal, ServiceRateProposal, SubstrateRateProposal } from '@/lib/ai'

/** How many superseded cards to keep. */
const KEEP_VERSIONS = 6

export interface RateCard {
  /** When it was accepted, not when it was generated. */
  acceptedAt: string
  generatedAt: string
  model: string
  services: ServiceRateProposal[]
  substrates: SubstrateRateProposal[]
  cannotDetermine: Array<{ what: string; why: string }>
  notes: string
  /** Set when a line was changed by hand before accepting. */
  edited?: boolean
}

export interface RateCardStore {
  current: RateCard | null
  history: RateCard[]
}

export const emptyStore = (): RateCardStore => ({ current: null, history: [] })

export const toCard = (p: RateProposal, edited = false): RateCard => ({
  acceptedAt: new Date().toISOString().slice(0, 10),
  generatedAt: p.generatedAt,
  model: p.model,
  services: p.services,
  substrates: p.substrates,
  cannotDetermine: p.cannotDetermine,
  notes: p.notes,
  ...(edited ? { edited: true } : {}),
})

/** Keep whatever is well-formed and drop the rest, rather than failing. */
export function cleanStore(raw: unknown): RateCardStore {
  const v = (raw ?? {}) as any
  const card = (c: any): RateCard | null => {
    if (!c || typeof c !== 'object') return null
    return {
      acceptedAt: String(c.acceptedAt ?? ''),
      generatedAt: String(c.generatedAt ?? ''),
      model: String(c.model ?? ''),
      services: Array.isArray(c.services) ? c.services : [],
      substrates: Array.isArray(c.substrates) ? c.substrates : [],
      cannotDetermine: Array.isArray(c.cannotDetermine) ? c.cannotDetermine : [],
      notes: String(c.notes ?? ''),
      edited: !!c.edited,
    }
  }
  return {
    current: card(v.current),
    history: (Array.isArray(v.history) ? v.history : []).map(card).filter(Boolean) as RateCard[],
  }
}

export function useRateCard() {
  const { user } = useAuth()
  return useQuery<RateCardStore>({
    queryKey: ['np_settings', 'rate_card', user?.id],
    queryFn: async () => {
      const { data } = await (supabase.from('np_settings') as any)
        .select('value').eq('user_id', user!.id).eq('key', 'rate_card').maybeSingle()
      return cleanStore(data?.value)
    },
    enabled: !!user,
  })
}

export function useAcceptRateCard() {
  const qc = useQueryClient()
  const { user } = useAuth()
  return useMutation({
    mutationFn: async (next: RateCard | null) => {
      const { data } = await (supabase.from('np_settings') as any)
        .select('value').eq('user_id', user!.id).eq('key', 'rate_card').maybeSingle()
      const store = cleanStore(data?.value)
      // The card being replaced goes to the top of the history, so a figure
      // can be traced after it has been superseded.
      const history = [store.current, ...store.history]
        .filter(Boolean).slice(0, KEEP_VERSIONS) as RateCard[]
      const value: RateCardStore = { current: next, history: next ? history : store.history }
      const { error } = await (supabase.from('np_settings') as any).upsert({
        key: 'rate_card', user_id: user!.id, value, updated_at: new Date().toISOString(),
      })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['np_settings', 'rate_card'] }),
  })
}

// ── What the quote builder asks it ──────────────────────────

/**
 * Hours per unit for a substrate from the accepted card, or null.
 *
 * Service first, because a door on a new build is not a door on a repaint, and
 * a service-specific figure beats a general one. Low confidence is refused:
 * the card is allowed to hold a figure the estimator can read while still not
 * being firm enough to price from silently.
 */
export function cardHoursPerUnit(
  card: RateCard | null | undefined, key: string, service?: string,
): { hours: number; jobs: number; confidence: string } | null {
  if (!card || !SUB_BY_KEY[key]) return null
  const rows = card.substrates.filter(s => s.key === key && s.confidence !== 'low')
  const hit = (service && rows.find(s => s.service === service)) || rows.find(s => !s.service)
  if (!hit || !(hit.hoursPerUnit > 0)) return null
  return { hours: hit.hoursPerUnit, jobs: hit.jobs.length, confidence: hit.confidence }
}

/** One line for the quote builder: where its rates are coming from. */
export function cardSummary(card: RateCard | null | undefined): string {
  if (!card) return ''
  const n = card.substrates.filter(s => s.confidence !== 'low').length
  if (!n) return `Rate card of ${card.acceptedAt} carries no substrate rates firm enough to price from.`
  return `Using your rate card of ${card.acceptedAt} for ${n} substrate${n === 1 ? '' : 's'}`
    + `${card.edited ? ', edited by hand' : ''}. The rest use the standard rates.`
}
