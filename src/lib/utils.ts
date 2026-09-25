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

// ── Numbers ─────────────────────────────────────────────────
/** Coerce a form field or imported value to a number. Blank/garbage → null. */
export function toNum(v: any): number | null {
  if (v == null || v === '' || v === 'null' || v === 'undefined') return null
  const n = Number(v)
  return isNaN(n) ? null : n
}

// ── Invoice line items ──────────────────────────────────────
export interface InvoiceLineItem {
  description: string
  qty: number
  total_ex_gst: number
}

/** Line items reach us from the AI scanner and from V16 backups, which spell
 *  the fields differently across versions. Accept every spelling in one place. */
export function normaliseLineItems(raw: any): InvoiceLineItem[] {
  if (!Array.isArray(raw)) return []
  return raw.map((li: any) => ({
    description: String(li.description ?? li.desc ?? ''),
    qty: toNum(li.qty) ?? 1,
    total_ex_gst:
      toNum(li.total_ex_gst ?? li.totalExGST ?? li.total ?? li.unit_price ?? li.unitPrice) ?? 0,
  })).filter(li => li.description || li.total_ex_gst)
}

/** Line items live on the row; older imports may still nest them under extra. */
export function lineItemsOf(row: any): InvoiceLineItem[] {
  return normaliseLineItems(
    Array.isArray(row?.line_items) ? row.line_items : row?.extra?.line_items,
  )
}

// ── GST ─────────────────────────────────────────────────────
export const GST = 0.1
export function exToInc(ex: number) { return ex * 1.1 }
export function exToGST(ex: number) { return ex * 0.1 }
export function incToEx(inc: number) { return inc / 1.1 }
export const incOf = (ex: number) => ex * (1 + GST)
export const exOf = (inc: number) => inc / (1 + GST)

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
  job: {
    scheduledDates?: unknown; scheduled_dates?: unknown
    schedStart?: string | null; sched_start?: string | null
    estDays?: number | null; est_days?: number | null
  },
  workWeekends = false
): string[] {
  const rawManual = job.scheduled_dates ?? job.scheduledDates
  const manual = Array.isArray(rawManual) ? rawManual as string[] : []
  if (manual.length) return [...manual].sort()
  const start = normaliseDate(job.sched_start ?? job.schedStart)
  if (!start) return []
  const days = Number(job.est_days ?? job.estDays) || 1
  return getWorkingDates(start, days, workWeekends)
}


// ── Crew references ──────────────────────────────────────────
// Assignments store a crew reference that may be a crew id (V16 exports
// crewId) or a plain name. Resolve either against the crew list.
export function findCrew<T extends { id?: string | null; name?: string | null }>(
  crew: T[], ref: string | null | undefined,
): T | undefined {
  if (!ref) return undefined
  return crew.find(c => c.id === ref) ?? crew.find(c => c.name === ref)
}

export function crewLabel<T extends { id?: string | null; name?: string | null }>(
  crew: T[], ref: string | null | undefined,
): string {
  return findCrew(crew, ref)?.name ?? ref ?? ''
}

// ── Invoice calculations ─────────────────────────────────────
// DB column is total_inc_gst; V16 backups use incGST. Accept both.
type Inv = {
  incGST?: number | null; total_inc_gst?: number | null
  received?: number | null
  manualPaid?: boolean | null; manual_paid?: boolean | null
}

export function invIncGST(inv: Inv): number {
  return inv.total_inc_gst ?? inv.incGST ?? 0
}

export function calcOwed(inv: Inv) {
  if (inv.manualPaid || inv.manual_paid) return 0
  return Math.max(0, invIncGST(inv) - (inv.received ?? 0))
}

export function invStatus(inv: Inv): 'Paid' | 'Part Paid' | 'Unpaid' {
  if (inv.manualPaid || inv.manual_paid) return 'Paid'
  if (calcOwed(inv) <= 0) return 'Paid'
  if ((inv.received ?? 0) > 0) return 'Part Paid'
  return 'Unpaid'
}

/** An invoice ex GST. agreed_ex_gst is the stored figure, but imported V16 rows
 *  often leave it null, so fall back to deriving it from the inc-GST total. */
export function invExGST(inv: Inv & { agreed_ex_gst?: number | null }): number {
  return inv.agreed_ex_gst ?? exOf(invIncGST(inv))
}

// ── Labour and material lines ────────────────────────────────
// np_labour carries both rate (what the work costs) and charge_rate (what the
// client pays); `billable` is hours x charge_rate. Older rows have neither, so
// billable falls back to cost. Moved here from Labour.tsx so the billing
// calculation and the Labour page cannot drift apart.
type LabourRow = { billable?: number | null; cost?: number | null; hours?: number | null; rate?: number | null; billing_type?: string | null }
export const labBillable = (l: LabourRow) => (l.billable !== undefined && l.billable !== null ? l.billable : (l.cost || 0))
export const labCost = (l: LabourRow) => (l.cost != null ? l.cost : (l.hours || 0) * (l.rate || 0))
export const isBillableLabour = (l: LabourRow) => l.billing_type === 'Hourly' || l.billing_type === 'Hourly/Estimate'

// Materials have no charge column, so they bill at cost plus the global markup.
// The existing Billing column decides whether a line is rechargeable at all.
type MaterialRow = { cost_ex_gst?: number | null; billing_type?: string | null }
export const matCost = (m: MaterialRow) => m.cost_ex_gst ?? 0
export const isBillableMaterial = (m: MaterialRow) => m.billing_type === 'Hourly' || m.billing_type === 'Hourly/Estimate'
export const matBillable = (m: MaterialRow, markupPct: number) => matCost(m) * (1 + markupPct / 100)

// ── Payment schedule milestones ──────────────────────────────
// np_pay_schedules stores the milestone array as JSON in its notes column.
export type Milestone = {
  label: string; pct: number; amount: number
  dueDate: string; received: boolean; receivedDate: string
}
export function parseMilestones(schedule: { notes?: string | null } | undefined | null): Milestone[] {
  if (!schedule?.notes) return []
  try {
    const parsed = JSON.parse(schedule.notes)
    return Array.isArray(parsed) ? parsed as Milestone[] : []
  } catch { return [] }
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

// ── Job search ───────────────────────────────────────────────
// Every field optional: the pages hold jobs as Record<string, any>, so a
// required `id` here would make those arrays unassignable.
export type PickableJob = {
  id?: string | null
  client?: string | null
  address?: string | null
  job_desc?: string | null
  status?: string | null
}

/** Digits only, so "12" matches "NP-0012" and "np 12" matches it too. */
const digits = (s: string) => s.replace(/\D+/g, '')

export function jobLabel(j: PickableJob | undefined): string {
  if (!j) return ''
  return [j.id, j.client, j.address?.split(',')[0]].filter(Boolean).join(' — ')
}

export function matchesJob(j: PickableJob, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  // status is shown in the list, so it should be searchable too
  const hay = `${j.id ?? ''} ${j.client ?? ''} ${j.address ?? ''} ${j.job_desc ?? ''} ${j.status ?? ''}`.toLowerCase()
  if (hay.includes(q)) return true
  // Bare numbers: "12" should find NP-0012 without typing the prefix or zeros.
  const qd = digits(q)
  if (qd && digits(j.id ?? '').includes(qd)) return true
  // Every word present somewhere, so "jordy esmonde" still finds it.
  const words = q.split(/\s+/).filter(Boolean)
  return words.length > 1 && words.every(w => hay.includes(w))
}

// ── Duplicate supplier invoices ──────────────────────────────
// Invoice numbers are written inconsistently — INV-88213, INV 88213, inv88213
// and 88213 are the same docket. Compare on letters and digits only.
export const normaliseInvNo = (v: any) =>
  String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')

export type DuplicateBasis = 'invoice' | 'amount'
export type DuplicateHit<T> = { row: T; sameSupplier: boolean; basis: DuplicateBasis }

/**
 * An earlier row carrying the same invoice number. A match from the same
 * supplier is the real duplicate; the same number from a different supplier is
 * a coincidence worth mentioning but not the same thing, so it is only used
 * when nothing better is found.
 */
export function findDuplicateInvoice<T extends Record<string, any>>(
  rows: T[], receiptNo: any, supplier?: any, excludeId?: string,
): DuplicateHit<T> | null {
  const want = normaliseInvNo(receiptNo)
  if (!want) return null
  const sup = String(supplier ?? '').trim().toLowerCase()
  let fallback: T | undefined
  for (const r of rows) {
    if (excludeId && r.id === excludeId) continue
    if (normaliseInvNo(r.receipt_no) !== want) continue
    const rowSup = String(r.supplier ?? '').trim().toLowerCase()
    // No supplier on either side is not evidence of a different supplier.
    if (!sup || !rowSup || rowSup === sup) return { row: r, sameSupplier: true, basis: 'invoice' }
    if (!fallback) fallback = r
  }
  return fallback ? { row: fallback, sameSupplier: false, basis: 'invoice' } : null
}

/** Merchant names are typed inconsistently for the same shop — "Dulux Australia"
 *  and "Dulux Australia - Inspirations Paint Ballina" are one supplier. Exact
 *  equality would miss most real duplicates, so compare loosely: a blank on
 *  either side cannot contradict, one containing the other counts, and
 *  otherwise the first word has to agree. */
export function suppliersLookAlike(a: any, b: any): boolean {
  const norm = (v: any) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const x = norm(a), y = norm(b)
  if (!x || !y) return true
  if (x === y || x.includes(y) || y.includes(x)) return true
  return x.split(' ')[0] === y.split(' ')[0]
}

const cents = (v: any) => (v == null || v === '' ? null : Math.round(Number(v) * 100))

/**
 * A material already logged for the same purchase.
 *
 * Preferred signal is the invoice number. Two thirds of rows have none, so
 * when it is missing this falls back to the same amount on the same date from
 * a supplier that looks like the same one — which is what an accidental
 * re-entry looks like.
 */
export function findDuplicateMaterial<T extends Record<string, any>>(
  rows: T[],
  candidate: { receipt_no?: any; supplier?: any; date?: any; cost_ex_gst?: any },
  excludeId?: string,
): DuplicateHit<T> | null {
  const byNumber = findDuplicateInvoice(rows, candidate.receipt_no, candidate.supplier, excludeId)
  if (byNumber) return byNumber
  if (normaliseInvNo(candidate.receipt_no)) return null   // it has a number and it did not match

  const amt = cents(candidate.cost_ex_gst)
  const date = String(candidate.date ?? '').trim()
  if (amt == null || amt === 0 || !date) return null

  for (const r of rows) {
    if (excludeId && r.id === excludeId) continue
    if (cents(r.cost_ex_gst) !== amt) continue
    if (String(r.date ?? '').trim() !== date) continue
    if (!suppliersLookAlike(candidate.supplier, r.supplier)) continue
    const exact = String(candidate.supplier ?? '').trim().toLowerCase()
      === String(r.supplier ?? '').trim().toLowerCase()
    return { row: r, sameSupplier: exact, basis: 'amount' }
  }
  return null
}

// ── GST reconciliation ───────────────────────────────────────
const money2 = (n: number) => Math.round(n * 100) / 100

/**
 * Make an invoice's three money fields agree.
 *
 * A scan can come back with figures that cannot all be true at once — an
 * ex-GST value that is really the till total, or a mistyped GST line. The
 * inc-GST total is the amount that actually left the bank, so when the three
 * do not reconcile that is the one to trust and the other two are derived
 * from it. Untouched when they already add up, so a supplier's own rounding
 * is preserved.
 */
export function reconcileGst(
  ex: number | null | undefined,
  gst: number | null | undefined,
  total: number | null | undefined,
): { cost_ex_gst: number | null; gst: number | null; total_inc_gst: number | null } {
  const ok = (v: any): v is number => typeof v === 'number' && isFinite(v)
  const e = ok(ex) ? ex : null
  const g = ok(gst) ? gst : null
  const t = ok(total) ? total : null

  if (t !== null && t !== 0) {
    // Already consistent to the cent — leave the supplier's own figures alone.
    // Compared in whole cents: 100 + 10.01 - 110 is 0.0100000000000051 in
    // floating point, which would fail a naive <= 0.01 test.
    const cents = (v: number) => Math.round(v * 100)
    if (e !== null && g !== null && Math.abs(cents(e) + cents(g) - cents(t)) <= 1) {
      return { cost_ex_gst: e, gst: g, total_inc_gst: t }
    }
    const nex = money2(t / 1.1)
    return { cost_ex_gst: nex, gst: money2(t - nex), total_inc_gst: t }
  }
  if (e !== null && e !== 0) {
    const ngst = g !== null ? g : money2(e * 0.1)
    return { cost_ex_gst: e, gst: ngst, total_inc_gst: money2(e + ngst) }
  }
  if (g !== null && g !== 0) {
    const nex = money2(g * 10)
    return { cost_ex_gst: nex, gst: g, total_inc_gst: money2(nex + g) }
  }
  return { cost_ex_gst: e, gst: g, total_inc_gst: t }
}
