import { type ClassValue, clsx } from 'clsx'

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs)
}

// ── Currency ────────────────────────────────────────────────
export function fmtCurrency(n: number | null | undefined, decimals = 0) {
  if (n == null || isNaN(n)) return '—'
  return new Intl.NumberFormat('en-AU', {
    style: 'currency', currency: 'AUD', maximumFractionDigits: decimals
  }).format(n)
}

export function fmtNumber(n: number | null | undefined, decimals = 1) {
  if (n == null || isNaN(n)) return '—'
  return n.toFixed(decimals)
}

// ── GST ─────────────────────────────────────────────────────
export function exToInc(ex: number) { return ex * 1.1 }
export function exToGST(ex: number) { return ex * 0.1 }
export function incToEx(inc: number) { return inc / 1.1 }

// ── Dates ───────────────────────────────────────────────────
export function today() {
  return new Date().toISOString().slice(0, 10)
}

export function fmtDate(d: string | null | undefined) {
  if (!d) return '—'
  const dt = new Date(d)
  if (isNaN(dt.getTime())) return d
  return dt.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function fmtDateShort(d: string | null | undefined) {
  if (!d) return '—'
  const dt = new Date(d)
  if (isNaN(dt.getTime())) return d
  return dt.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
}

export function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

export function isWorkDay(dateStr: string, workWeekends = false): boolean {
  const day = new Date(dateStr).getDay()
  if (workWeekends) return true
  return day !== 0 && day !== 6
}

export function getWorkingDates(start: string, numDays: number, workWeekends = false): string[] {
  const dates: string[] = []
  let current = start
  while (dates.length < numDays) {
    if (isWorkDay(current, workWeekends)) dates.push(current)
    current = addDays(current, 1)
  }
  return dates
}

// Normalise dd-MM-yy or dd/MM/yy or dd-MM-yyyy → YYYY-MM-DD
export function normaliseDate(d: string | null | undefined): string | null {
  if (!d) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d
  const m = d.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{2,4})$/)
  if (!m) return null
  const [, dd, mm, yy] = m
  const yyyy = yy.length === 2 ? '20' + yy : yy
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`
}

// ── Job scheduled dates ──────────────────────────────────────
export function getJobScheduledDates(
  job: { scheduledDates?: unknown; schedStart?: string | null; estDays?: number | null },
  workWeekends = false
): string[] {
  const manual = Array.isArray(job.scheduledDates) ? job.scheduledDates as string[] : []
  if (manual.length) return [...manual].sort()
  const start = normaliseDate(job.schedStart)
  if (!start) return []
  const days = Number(job.estDays) || 1
  return getWorkingDates(start, days, workWeekends)
}

// ── Invoice calculations ─────────────────────────────────────
export function calcOwed(inv: { incGST?: number | null; received?: number | null; manualPaid?: boolean | null; manual_paid?: boolean | null }) {
  if (inv.manualPaid || inv.manual_paid) return 0
  return Math.max(0, (inv.incGST ?? 0) - (inv.received ?? 0))
}

export function invStatus(inv: { incGST?: number | null; received?: number | null; manualPaid?: boolean | null; manual_paid?: boolean | null }): 'Paid' | 'Part Paid' | 'Unpaid' {
  if (inv.manualPaid || inv.manual_paid || calcOwed(inv) <= 0) return 'Paid'
  if ((inv.received ?? 0) > 0) return 'Part Paid'
  return 'Unpaid'
}

// ── Gross margin ─────────────────────────────────────────────
export function grossMargin(revenue: number, labourCost: number, materialCost: number): number {
  if (!revenue) return 0
  return ((revenue - labourCost - materialCost) / revenue) * 100
}

// ── IDs ──────────────────────────────────────────────────────
export function nextJobId(existingIds: string[]): string {
  const nums = existingIds
    .map(id => parseInt(id.replace('NP-', '')))
    .filter(n => !isNaN(n))
  const max = nums.length ? Math.max(...nums) : 0
  return `NP-${String(max + 1).padStart(4, '0')}`
}

export function genId(prefix = '') {
  return prefix + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase()
}

// ── Quarter helpers ──────────────────────────────────────────
export function getQuarter(dateStr: string): { year: number; q: number } {
  const d = new Date(dateStr)
  return { year: d.getFullYear(), q: Math.floor(d.getMonth() / 3) + 1 }
}

export function inQuarter(dateStr: string | null | undefined, year: number, q: number): boolean {
  if (!dateStr) return false
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return false
  return d.getFullYear() === year && Math.floor(d.getMonth() / 3) + 1 === q
}

export function inYear(dateStr: string | null | undefined, year: number): boolean {
  if (!dateStr) return false
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return false
  return d.getFullYear() === year
}
