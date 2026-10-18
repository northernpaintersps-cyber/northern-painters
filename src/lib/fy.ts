// The Australian financial year: 1 July to 30 June.
//
// The app reported on calendar years, labelled them "Financial Year", and
// numbered its BAS quarters from January. None of that matches what gets
// lodged: a quarter was three months out of step with the one on the form,
// and a year's profit covered six months of each of two real ones.
//
// An FY is named by the year it ENDS in, which is the Australian convention —
// FY2026 runs 1 July 2025 to 30 June 2026 and is written "2025–26".
//
// Quarters are the BAS ones, numbered within the financial year:
//
//   Q1  Jul – Sep        Q3  Jan – Mar
//   Q2  Oct – Dec        Q4  Apr – Jun
//
// Everything here works on 'YYYY-MM-DD' strings and never builds a Date from
// one, because a date put through UTC in this timezone comes back a day
// early — the rule the rest of the app follows too.

/** The financial year a date falls in, named by the year it ends in. */
export function fyOf(date: unknown): number | null {
  const m = /^(\d{4})-(\d{2})/.exec(String(date ?? ''))
  if (!m) return null
  const year = Number(m[1])
  return Number(m[2]) >= 7 ? year + 1 : year
}

/** First and last day of a financial year, inclusive. */
export const fyRange = (fy: number): [string, string] =>
  [`${fy - 1}-07-01`, `${fy}-06-30`]

/** "2025–26", with an en dash, as the ATO writes it. */
export const fyLabel = (fy: number): string =>
  `${fy - 1}–${String(fy).slice(2)}`

/** The financial year that a day sits in. Defaults to today. */
export const currentFY = (todayStr?: string): number =>
  fyOf(todayStr ?? localToday()) ?? new Date().getFullYear()

/** Today as 'YYYY-MM-DD' in local time — never through UTC. */
function localToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** A BAS quarter within a financial year: 1 is Jul–Sep, 4 is Apr–Jun. */
export function quarterRange(fy: number, q: number): [string, string] {
  switch (q) {
    case 1: return [`${fy - 1}-07-01`, `${fy - 1}-09-30`]
    case 2: return [`${fy - 1}-10-01`, `${fy - 1}-12-31`]
    case 3: return [`${fy}-01-01`, `${fy}-03-31`]
    default: return [`${fy}-04-01`, `${fy}-06-30`]
  }
}

export const QUARTER_MONTHS = ['Jul–Sep', 'Oct–Dec', 'Jan–Mar', 'Apr–Jun'] as const

/** Which BAS quarter a date is in, 1–4 within its own financial year. */
export function quarterOf(date: unknown): number | null {
  const m = /^\d{4}-(\d{2})/.exec(String(date ?? ''))
  if (!m) return null
  const month = Number(m[1])
  return month >= 7 ? Math.floor((month - 7) / 3) + 1 : Math.floor((month - 1) / 3) + 3
}

/** The quarter a day sits in. Defaults to today. */
export const currentQuarter = (todayStr?: string): number =>
  quarterOf(todayStr ?? localToday()) ?? 1

export const inFY = (date: unknown, fy: number): boolean => {
  const s = String(date ?? '')
  const [from, to] = fyRange(fy)
  return !!s && s >= from && s <= to
}

export const inQuarter = (date: unknown, fy: number, q: number): boolean => {
  const s = String(date ?? '')
  const [from, to] = quarterRange(fy, q)
  return !!s && s >= from && s <= to
}

/** "Q2 2025–26 (Oct–Dec)" — the heading a BAS report wants. */
export const quarterLabel = (fy: number, q: number): string =>
  `Q${q} ${fyLabel(fy)} (${QUARTER_MONTHS[q - 1]})`

/**
 * The financial years worth offering in a picker: every one with data in it,
 * the current one always, and no gaps between them.
 */
export function fyOptions(dates: unknown[], todayStr?: string): number[] {
  const now = currentFY(todayStr)
  const years = dates.map(fyOf).filter((y): y is number => y !== null)
  const lo = Math.min(now, ...(years.length ? years : [now]))
  const out: number[] = []
  for (let y = now; y >= lo; y--) out.push(y)
  return out
}
