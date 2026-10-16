// Where a saved quote sits, and which pipeline column that is.
//
// A quote used to be invisible on the Pipeline until it had been converted
// into a job, so the two columns that are entirely about quotes — Quote
// Created and Sent — only ever showed work that had already stopped being a
// quote. You had to create a job to watch a quote.
//
// 'Locked' was the old name for a finished quote. It described the mechanism
// (the price is pinned) rather than where the work had got to, and it has no
// counterpart for "I have sent it". Both are kept: stored rows still say
// Locked and read as Created.

export type QuoteStage = 'Draft' | 'Created' | 'Sent' | 'Converted'

export const QUOTE_STAGES: QuoteStage[] = ['Draft', 'Created', 'Sent', 'Converted']

/** The stages you can set by hand. Converted is set by converting. */
export const SETTABLE_STAGES: QuoteStage[] = ['Draft', 'Created', 'Sent']

/** A stored status to a stage, tolerating the old vocabulary and anything odd. */
export function quoteStage(status: unknown): QuoteStage {
  const s = String(status ?? '').trim()
  if (s === 'Converted') return 'Converted'
  if (s === 'Sent') return 'Sent'
  // Locked is what a finished quote was called before this.
  if (s === 'Created' || s === 'Locked') return 'Created'
  return 'Draft'
}

export const STAGE_LABEL: Record<QuoteStage, string> = {
  Draft: 'Draft',
  Created: 'Quote created',
  Sent: 'Sent to client',
  Converted: 'Became a job',
}

/**
 * The pipeline column a quote belongs in, or null for one that does not
 * belong on the board: a draft is not out in the world yet, and a converted
 * quote is already there as its job.
 */
export function stageColumn(status: unknown): 'quoted' | 'sent' | null {
  const stage = quoteStage(status)
  if (stage === 'Created') return 'quoted'
  if (stage === 'Sent') return 'sent'
  return null
}

export const onBoard = (status: unknown): boolean => stageColumn(status) != null

/** What a quote is worth, for the board and the totals. */
export const quoteValue = (q: { locked_price?: any; quote_ex_gst?: any }): number =>
  Number(q?.locked_price) || Number(q?.quote_ex_gst) || 0
