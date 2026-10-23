// Lines on an invoice, written by hand.
//
// An invoice already prints as many lines as it is given — buildInvTable has
// taken extra.line_items since the import, and the picker writes them when
// billing logged work. What there was no way to do was type them: split a
// job into "Interior — ground floor", "Deck restoration", "Add-on: third
// coat to the hallway" and price each one.
//
// So this is the editing side of a format that already exists. Lines written
// here print exactly like picked ones, and the same three detail levels
// apply.
//
// Add-ons are np_variations. The job already records work agreed after the
// quote — amount, description, Approved or not — and the billing already
// counts approved ones toward what the job is worth. What was missing was
// getting one onto an invoice without retyping it, and knowing afterwards
// which have been billed, which is what extra.billed_variations records.
//
// Pure — no hooks, no Supabase.

type Row = Record<string, any>

const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0 }
const r2 = (v: number) => Math.round(v * 100) / 100

export interface EditLine {
  /** Local only — React needs a stable key while the row is being edited. */
  id: string
  description: string
  qty: number
  unit: string
  unitPrice: number
  /** Where an add-on came from, so it is not billed twice. */
  variationId?: string
}

let seq = 0
export const blankLine = (over: Partial<EditLine> = {}): EditLine => ({
  id: `l${Date.now().toString(36)}${seq++}`,
  description: '', qty: 1, unit: 'lot', unitPrice: 0, ...over,
})

/** What one line is worth. Quantity times price, to the cent. */
export const lineTotal = (l: Partial<EditLine>): number =>
  r2(n(l?.qty ?? 1) * n(l?.unitPrice))

export const linesTotal = (lines: Partial<EditLine>[]): number =>
  r2(lines.reduce((s, l) => s + lineTotal(l), 0))

/** A line with nothing on it at all — not saved, and not an error either. */
export const isBlank = (l: Partial<EditLine>): boolean =>
  !String(l?.description ?? '').trim() && lineTotal(l) === 0

/**
 * Editable rows to what is stored on the invoice.
 *
 * `amount` is what the printed invoice reads first, so it is written as well
 * as total_ex_gst — the two spellings have to agree or the page prints one
 * figure and the total says another.
 */
export const toStored = (lines: EditLine[]): Row[] =>
  lines.filter(l => !isBlank(l)).map(l => ({
    description: String(l.description ?? '').trim() || 'Painting services',
    qty: n(l.qty) || 1,
    unit: String(l.unit ?? '').trim() || 'lot',
    unitPrice: r2(n(l.unitPrice)),
    amount: lineTotal(l),
    total_ex_gst: lineTotal(l),
    ...(l.variationId ? { variation_id: l.variationId } : {}),
  }))

/** Stored lines back to editable rows, tolerating every spelling in the data. */
export function fromStored(items: unknown): EditLine[] {
  if (!Array.isArray(items)) return []
  return items.map((li: Row) => {
    const amount = n(li?.amount ?? li?.total_ex_gst ?? li?.totalExGST ?? li?.total)
    const qty = n(li?.qty) || 1
    return blankLine({
      description: String(li?.description ?? li?.desc ?? ''),
      qty,
      unit: li?.unit && isNaN(Number(li.unit)) ? String(li.unit) : 'lot',
      // An older line may carry only its total, so the price is derived back.
      unitPrice: li?.unitPrice !== undefined ? r2(n(li.unitPrice)) : r2(amount / (qty || 1)),
      ...(li?.variation_id ? { variationId: String(li.variation_id) } : {}),
    })
  })
}

// ── Add-ons ──────────────────────────────────────────────────

/** Add-ons already on an invoice, by id, so none is billed twice. */
export function billedVariationIds(invoices: Row[], exceptInvoiceId?: string): Set<string> {
  const out = new Set<string>()
  for (const inv of invoices) {
    if (exceptInvoiceId && inv?.id === exceptInvoiceId) continue
    const ids = inv?.extra?.billed_variations
    if (Array.isArray(ids)) for (const id of ids) out.add(String(id))
    // Belt and braces: a line may carry its origin even if the list is lost.
    const items = inv?.extra?.line_items
    if (Array.isArray(items)) {
      for (const li of items) if (li?.variation_id) out.add(String(li.variation_id))
    }
  }
  return out
}

export interface AddOn {
  id: string
  description: string
  amountExGST: number
  date: string
  approved: boolean
  billed: boolean
}

/**
 * A job's add-ons, with whether each has been billed already.
 *
 * Pending ones are included and flagged rather than hidden: an add-on the
 * client has agreed to verbally but nobody has ticked is exactly the thing
 * that gets done and never charged for.
 */
export function jobAddOns(
  variations: Row[], jobId: string, invoices: Row[], exceptInvoiceId?: string,
): AddOn[] {
  const billed = billedVariationIds(invoices, exceptInvoiceId)
  return variations
    .filter(v => v.job_id === jobId)
    .map(v => ({
      id: String(v.id ?? ''),
      description: String(v.var_desc ?? '').trim() || 'Additional work',
      amountExGST: r2(n(v.amount_ex_gst)),
      date: String(v.date ?? '').slice(0, 10),
      approved: String(v.var_status ?? '').trim() === 'Approved',
      billed: billed.has(String(v.id ?? '')),
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

/** An add-on as a line ready to drop into the editor. */
export const addOnLine = (a: AddOn): EditLine =>
  blankLine({
    description: a.description,
    qty: 1, unit: 'lot',
    unitPrice: a.amountExGST,
    variationId: a.id,
  })

/** The add-on ids an invoice's lines cover, for extra.billed_variations. */
export const variationIdsOf = (lines: EditLine[]): string[] =>
  [...new Set(lines.filter(l => l.variationId && !isBlank(l)).map(l => l.variationId!))]

/** What a job's add-ons come to. Approved only, since pending is not agreed. */
export const addOnsValue = (addOns: AddOn[]): number =>
  r2(addOns.filter(a => a.approved).reduce((s, a) => s + a.amountExGST, 0))
