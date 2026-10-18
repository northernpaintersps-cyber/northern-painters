// The asset register, and what it deducts.
//
// A compressor is not a tin of paint. It is bought once and earns over years,
// so its cost reaches the P&L as depreciation spread across those years —
// unless it is written off at once, which is a decision recorded per asset.
//
// Four treatments, which is all a painting business needs:
//
//   immediate    the whole cost in the year of purchase (instant write-off)
//   prime_cost   cost / effective life, the same amount every year
//   diminishing  200% / effective life, applied to what is left each year
//   none         owned, tracked, not depreciated
//
// Two things modify every one of them:
//
//   business use   only the business share is deductible. A ute at 80%
//                  deducts 80% of the year's depreciation.
//   cash           an asset bought with cash is not deductible at all and
//                  claims no GST credit — the same rule as every other cost
//                  since cashBooks.ts. It still appears in the register,
//                  because you still own it.
//
// A "year" here is an Australian financial year, 1 July to 30 June, named by
// the year it ends in — the same one the P&L beside it reports on. See
// lib/fy.ts. An asset bought in May and one bought in August are a whole
// year apart for depreciation, which is exactly the distinction a calendar
// year got wrong.
//
// Pure — no hooks, no Supabase.

import { isCashPaid } from './cashBooks'
import { fyOf, fyRange } from './fy'

export const ASSET_CATEGORIES = [
  'Vehicle', 'Machinery', 'Tools', 'Equipment', 'Technology', 'Other',
] as const

export const DEP_METHODS = ['immediate', 'prime_cost', 'diminishing', 'none'] as const
export type DepMethod = typeof DEP_METHODS[number]

export const METHOD_LABEL: Record<DepMethod, string> = {
  immediate: 'Immediate write-off',
  prime_cost: 'Prime cost (straight line)',
  diminishing: 'Diminishing value',
  none: 'Not depreciated',
}

/** ATO effective lives, near enough for the things a painter buys. Editable
 *  per asset — these are only what a new row starts at. */
export const DEFAULT_LIFE: Record<string, number> = {
  Vehicle: 8, Machinery: 10, Tools: 5, Equipment: 7, Technology: 3, Other: 5,
}

export type Asset = Record<string, any>

const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0 }
const r2 = (v: number) => Math.round(v * 100) / 100

export const assetMethod = (a: Asset): DepMethod => {
  const m = String(a?.method ?? '').trim() as DepMethod
  return (DEP_METHODS as readonly string[]).includes(m) ? m : 'prime_cost'
}

/** The business share, 0–1. Absent means wholly business, which is the norm. */
export const businessShare = (a: Asset): number => {
  const raw = a?.business_use_pct
  if (raw === null || raw === undefined || raw === '') return 1
  return Math.min(1, Math.max(0, n(raw) / 100))
}

/**
 * What the asset is being written down from.
 *
 * `prior_depreciation` is what was already claimed before this register
 * existed, so an asset brought in part way through its life starts from the
 * right value instead of from new. Deliberately simple: the remaining value
 * is written off over the full effective life rather than the remaining life,
 * which is the conservative direction and is plain to see in the schedule.
 */
export const depreciableBase = (a: Asset): number =>
  Math.max(0, n(a.cost_ex_gst) - n(a.prior_depreciation))

/** The financial year a date falls in. Re-exported so callers need one import. */
export const yearOf = fyOf

const dayNumber = (iso: string): number => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000 : NaN
}

/**
 * The share of its first financial year the asset was actually held for.
 *
 * A rig bought on 20 June earns ten days of deduction, not a year's — and
 * one bought on 2 July earns nearly all of it, which is the reason the date
 * of a big purchase is worth thinking about.
 */
function firstYearFraction(a: Asset): number {
  const bought = String(a.purchase_date ?? '').slice(0, 10)
  const fy = fyOf(bought)
  if (fy === null) return 1
  const [from, to] = fyRange(fy)
  const start = Math.max(dayNumber(bought), dayNumber(from))
  const held = dayNumber(to) - start + 1          // inclusive of both days
  const whole = dayNumber(to) - dayNumber(from) + 1
  if (!Number.isFinite(held) || !Number.isFinite(whole) || whole <= 0) return 1
  return Math.min(1, Math.max(0, held / whole))
}

export interface YearDepreciation {
  /** Written-down value at the start of the year, before this year's charge. */
  opening: number
  /** The full charge, before the business-use share is applied. */
  charge: number
  /** What is actually deductible: charge x business use, nil when cash. */
  deduction: number
  closing: number
  /** True once the asset is fully written off. */
  writtenOff: boolean
}

const nil = (opening: number): YearDepreciation =>
  ({ opening, charge: 0, deduction: 0, closing: opening, writtenOff: opening <= 0 })

/**
 * The depreciation schedule, year by year, from purchase to written off.
 *
 * Walked forward rather than solved, because diminishing value depends on the
 * year before it and because the first year is pro-rated by days held — a rig
 * bought in November does not earn a full year's deduction.
 */
export function schedule(a: Asset, upToYear: number): Map<number, YearDepreciation> {
  const out = new Map<number, YearDepreciation>()
  const bought = yearOf(a.purchase_date)
  if (bought === null) return out

  const method = assetMethod(a)
  const base = depreciableBase(a)
  const life = Math.max(1, n(a.effective_life_yr) || 5)
  const share = businessShare(a)
  const deductible = !isCashPaid(a)
  const sold = yearOf(a.disposal_date)

  let wdv = base
  for (let y = bought; y <= upToYear; y++) {
    // The year of sale stops depreciating. The ATO pro-rates it, but the gain
    // or loss on disposal swamps that and is worked out separately anyway.
    if (sold !== null && y > sold) { out.set(y, nil(0)); continue }
    if (wdv <= 0 || method === 'none') { out.set(y, nil(wdv)); continue }

    let charge: number
    if (method === 'immediate') {
      charge = y === bought ? wdv : 0
    } else {
      const full = method === 'diminishing' ? wdv * (2 / life) : base / life
      // Part-year in the year of purchase — but not for an asset that arrived
      // already part written down, which is past its first year by definition.
      charge = y === bought && n(a.prior_depreciation) === 0
        ? full * firstYearFraction(a)
        : full
    }
    charge = r2(Math.min(charge, wdv))
    const opening = wdv
    wdv = r2(wdv - charge)
    out.set(y, {
      opening,
      charge,
      deduction: deductible ? r2(charge * share) : 0,
      closing: wdv,
      writtenOff: wdv <= 0,
    })
  }
  return out
}

/** This year's figures for one asset. */
export const depreciationFor = (a: Asset, year: number): YearDepreciation =>
  schedule(a, year).get(year) ?? nil(depreciableBase(a))

/** Written-down value at the end of a year — what it is worth on paper. */
export const writtenDownValue = (a: Asset, year: number): number =>
  depreciationFor(a, year).closing

export interface RegisterTotals {
  count: number
  /** What was paid for everything still owned, ex GST. */
  costExGST: number
  /** What that is worth on paper at the end of the year. */
  writtenDown: number
  /** The deduction the P&L should carry for the year. */
  deduction: number
  /** Bought during the year — the ones with a GST credit to claim. */
  purchasedExGST: number
  purchasedGST: number
  /** Depreciation forgone because the asset was bought with cash. */
  nonDeductible: number
}

/** Everything the Tax page needs from the register for one year. */
export function registerTotals(assets: Asset[], year: number): RegisterTotals {
  let count = 0, costExGST = 0, writtenDown = 0, deduction = 0
  let purchasedExGST = 0, purchasedGST = 0, nonDeductible = 0

  for (const a of assets) {
    const bought = yearOf(a.purchase_date)
    if (bought === null || bought > year) continue
    const sold = yearOf(a.disposal_date)
    const d = depreciationFor(a, year)

    deduction += d.deduction
    if (isCashPaid(a)) nonDeductible += d.charge * businessShare(a)

    if (sold === null || sold >= year) {        // still owned at year end
      count++
      costExGST += n(a.cost_ex_gst)
      writtenDown += d.closing
    }
    if (bought === year) {
      purchasedExGST += n(a.cost_ex_gst)
      // A cash purchase claims no GST credit, same as everywhere else, and
      // only the business share of the rest is claimable.
      if (!isCashPaid(a)) purchasedGST += n(a.gst) * businessShare(a)
    }
  }
  return {
    count,
    costExGST: r2(costExGST), writtenDown: r2(writtenDown), deduction: r2(deduction),
    purchasedExGST: r2(purchasedExGST), purchasedGST: r2(purchasedGST),
    nonDeductible: r2(nonDeductible),
  }
}

/**
 * Sold, traded or scrapped: what it made against what the books said it was
 * worth. Positive is a gain, which is assessable; negative is a loss.
 */
export function disposalResult(a: Asset): { gain: number; year: number } | null {
  const sold = yearOf(a.disposal_date)
  if (sold === null) return null
  const wdv = depreciationFor(a, sold - 1).closing   // value going into the year
  return { gain: r2(n(a.disposal_amount_ex_gst) - wdv), year: sold }
}
