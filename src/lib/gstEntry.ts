// Typing a price either way round.
//
// Every money column in this app stores an ex-GST figure, because that is
// what the arithmetic downstream reads and what the ATO wants to see. But a
// conversation with a client never happens in ex-GST: it happens in "another
// $550 all up". So every entry was a division by 1.1 done in your head,
// which is a place to fumble a number for no reason.
//
// This converts, and nothing else. What is stored does not change.
//
// Rounding is the whole difficulty. Each figure is held to the cent, which
// means the pair cannot always be exact in both directions at once — 1.1
// does not divide cleanly. Two rules keep it honest:
//
//   · the stored figure is always the ex-GST one, rounded to the cent
//   · what is shown beside it is recomputed FROM that, so the echo can never
//     disagree with what will be saved
//
// The consequence worth knowing: typing an inc figure that does not divide
// evenly can echo back a cent off what you typed. That is the truth about
// the stored figure rather than a bug in the display, and showing the lie
// instead would be worse.
//
// Pure — no hooks, no Supabase.

import { GST } from './utils'

export type GstMode = 'ex' | 'inc'

const r2 = (v: number) => Math.round(v * 100) / 100

/** A typed figure, or null when there is nothing usable in it. */
export function parseMoney(text: unknown): number | null {
  if (text === null || text === undefined) return null
  const s = String(text).replace(/[$,\s]/g, '')
  if (!s) return null
  const v = Number(s)
  return Number.isFinite(v) ? v : null
}

/** Ex GST to inc, at a rate. A zero rate is a cash job: the same figure. */
export const toInc = (ex: number, rate = GST): number => r2(ex * (1 + rate))

/** Inc GST to ex. The figure that gets stored. */
export const toEx = (inc: number, rate = GST): number => r2(inc / (1 + rate))

/**
 * What to store, from what was typed in whichever mode.
 *
 * null for anything unusable, so a half-typed field writes nothing rather
 * than a NaN — which is the worst thing that can reach a money column,
 * because it poisons every total it touches.
 */
export function storedEx(text: unknown, mode: GstMode, rate = GST): number | null {
  const v = parseMoney(text)
  if (v === null) return null
  return mode === 'inc' ? toEx(v, rate) : r2(v)
}

/**
 * The other figure, to show beside the field.
 *
 * Computed from the ex-GST figure that will actually be saved, so what you
 * read is what you get. Null when there is nothing to show — no entry yet,
 * or a cash job, where there is no second figure to speak of.
 */
export function echoOf(text: unknown, mode: GstMode, rate = GST): number | null {
  if (!rate) return null
  const ex = storedEx(text, mode, rate)
  if (ex === null) return null
  return mode === 'inc' ? ex : toInc(ex, rate)
}

/** The figure to put in the box when editing a stored ex-GST amount. */
export function fieldValue(ex: number | null | undefined, mode: GstMode, rate = GST): string {
  const v = Number(ex)
  if (!Number.isFinite(v) || ex === null || ex === undefined || ex === ('' as any)) return ''
  return String(mode === 'inc' ? toInc(v, rate) : r2(v))
}

// ── Which way the person thinks ─────────────────────────────
// Remembered, because somebody who quotes in inc-GST does so every time and
// should not have to say so on every entry.

const KEY = 'np_gst_entry_mode'

export function savedMode(fallback: GstMode = 'ex'): GstMode {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'inc' || v === 'ex' ? v : fallback
  } catch { return fallback }
}

export function rememberMode(mode: GstMode): void {
  try { localStorage.setItem(KEY, mode) } catch { /* private window, no matter */ }
}
