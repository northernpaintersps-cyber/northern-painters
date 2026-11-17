// The breakdown you hand a client when they ask what they are paying for.
//
// A builder rings and asks to see the labour and materials behind a figure.
// Until now the only answer was the job page, which cannot be shown to anyone:
// it carries what the work COST you in a column beside what it charges, which
// is the margin, which is nobody's business but yours.
//
// So this builds a list from the charge side only, and never imports a cost
// helper. A test asserts that — `labCost`, `matCost` and `lineCost` must not
// appear in this file, because one of them slipping into a client document is
// not a bug you find later, it is a bug the client finds first.
//
// ── Showing the client what the job cost you ────────────────
//
// By default no cost figure is computed, let alone printed: `costExGST` is
// simply absent from every row unless `withCost` is passed, so a document has
// nothing to leak. That is the right default and it stays the default.
//
// But on a fixed-quote job that ran long you may want the opposite. The client
// agreed a price, the job took half as long again, and the only way to show
// that is to show the figures: what the hours cost, what the paint cost, and
// the gap against the price. The owner asked for this deliberately, having
// been told twice what it discloses. It is their business and their call.
//
// So cost is opt-in at two separate points — it has to be computed, and then
// it has to be asked for — and the screen says plainly which mode is on.
//
// ── What is left out, and what is yours to decide ───────────
//
// Work nobody is charged for is always left out. A line marked Not billable —
// coming back to make good a defect — has a charge of nil. Listing it invites
// an argument about whether it should be credited, when it already has been.
//
// Who did the work is a choice, and it defaults to no. invoiceableLines builds
// a labour description as `sub — labour_desc`, so the subcontractor's name is
// in the string by default, and in a client's inbox that tells a builder who
// you engage and lets them work out what you pay. So labour reads as its phase
// unless you ask for the full log, which some clients do and which is a
// perfectly reasonable thing to hand over — see LabourDetail below.

import type { InvoiceableLine } from './jobBilling'
import { isNotBillable, labCost } from './utils'

type Row = Record<string, any>

const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0 }
const r2 = (v: number) => Math.round(v * 100) / 100

/** Which kinds of line the client asked about. */
export type BreakdownKind = 'all' | 'labour' | 'materials'
export const BREAKDOWN_KINDS: { id: BreakdownKind; label: string }[] = [
  { id: 'all', label: 'Labour and materials' },
  { id: 'labour', label: 'Labour only' },
  { id: 'materials', label: 'Materials only' },
]

/**
 * How much of the labour log the client sees.
 *
 *   phase    One row per phase of the job — "Preparation — 14 hrs". What a
 *            client usually means by a breakdown.
 *   entries  Every entry as it was logged, by date and task, but not by whom.
 *   full     Every entry with the name of who carried it out. The whole log.
 *            Hands the builder your subcontractors, which is sometimes exactly
 *            what is wanted and is never the default.
 */
export type LabourDetail = 'phase' | 'entries' | 'full'
export const LABOUR_DETAIL: { id: LabourDetail; label: string; hint: string }[] = [
  { id: 'phase', label: 'By phase', hint: 'One row per phase of the job' },
  { id: 'entries', label: 'Every entry', hint: 'Each day logged, with the task' },
  { id: 'full', label: 'Full log', hint: 'Each day logged, with the task and who did it' },
]

/**
 * Why a line carries the figure it does.
 *
 *   charged    Invoiced at the figure shown.
 *   included   Covered by the agreed price. On a fixed-quote job this is
 *              every line, and printing $0.00 against each of them would be
 *              both wrong and insulting — the client is paying for it, just
 *              not line by line.
 *   no-charge  Done and not charged for at all. Making good a defect. Worth
 *              showing on purpose: it is work you did for nothing, and the
 *              client has no way of knowing unless you tell them.
 */
export type ChargeBasis = 'charged' | 'included' | 'no-charge'

export const BASIS_LABEL: Record<ChargeBasis, string> = {
  charged: '',
  included: 'Included',
  'no-charge': 'No charge',
}

/** One line as the client sees it. Charge only — never a cost or a margin. */
export interface ClientLine {
  id: string
  kind: 'labour' | 'material'
  date: string
  description: string
  /** Labour only. Lets the list read "42 hrs" and derive a rate if asked. */
  hours?: number
  /**
   * Labour only — the phase on its own, without the note that qualifies it.
   *
   * Kept apart from `description` because grouping has to be by phase and not
   * by the whole string: "Preparation — cutting in" and "Preparation" are the
   * same phase of the job, and grouping on the description would show the
   * client two preparation rows where there was one phase of preparation.
   */
  phase?: string
  chargeExGST: number
  /** Nil on anything but 'charged'. See ChargeBasis. */
  basis: ChargeBasis
  /**
   * What the entry cost you, ex GST. Absent unless `withCost` was passed, so
   * a document built without it has no cost to print even by accident.
   */
  costExGST?: number
}

/** Which side of the money a document shows. 'charge' discloses nothing. */
export type MoneyShown = 'charge' | 'cost' | 'both'
export const MONEY_SHOWN: { id: MoneyShown; label: string; hint: string }[] = [
  { id: 'charge', label: 'What they pay', hint: 'What the client is charged. Discloses nothing.' },
  { id: 'cost', label: 'What it cost me', hint: 'What the work cost you — your rates and your suppliers' },
  { id: 'both', label: 'Both', hint: 'Side by side, with the gap between them' },
]
export const showsCost = (m: MoneyShown | undefined): boolean => m === 'cost' || m === 'both'
export const showsCharge = (m: MoneyShown | undefined): boolean => (m ?? 'charge') !== 'cost'

/**
 * Labour described for the client. The worker's name goes on the front only
 * on the full log, because `invoiceableLines` would otherwise carry it into
 * every document by default.
 */
export function labourDescription(row: Row | undefined, detail: LabourDetail = 'phase'): string {
  const phase = String(row?.phase_name ?? '').trim()
  const desc = String(row?.labour_desc ?? '').trim()
  // The phase is the useful half — "Preparation", "Second coat". Where both
  // exist the phase leads and the note qualifies it.
  const parts = [phase, desc].filter(Boolean)
  // A note that merely repeats the phase is not worth printing twice.
  if (parts.length === 2 && parts[1].toLowerCase() === parts[0].toLowerCase()) parts.pop()
  const what = parts.join(' — ') || 'Painting labour'
  const worker = detail === 'full' ? String(row?.sub ?? '').trim() : ''
  return worker ? `${worker} — ${what}` : what
}

/** Materials described by product, with the supplier only if you want it shown. */
export function materialDescription(row: Row | undefined, showSupplier = false): string {
  const desc = String(row?.mat_desc ?? '').trim()
  const supplier = String(row?.supplier ?? '').trim()
  if (showSupplier && supplier) return [supplier, desc].filter(Boolean).join(' — ')
  return desc || 'Paint and materials'
}

/**
 * The client-facing lines for a job.
 *
 * `lines` comes from invoiceableLines, so the charge arithmetic — rate
 * overrides, materials markup — stays in one place and this cannot disagree
 * with the invoice. The raw rows come along only to describe each line
 * without the subcontractor's name.
 */
export function clientLines(input: {
  lines: InvoiceableLine[]
  labour?: Row[]
  materials?: Row[]
  kind?: BreakdownKind
  showSupplier?: boolean
  /** 'full' puts the name of who did the work into each labour description. */
  labourDetail?: LabourDetail
  /**
   * Also list work that carries no charge — a fixed-quote line covered by the
   * agreed price, or something done for nothing. Off by default, because on an
   * hourly job a nil line invites an argument about crediting work that was
   * never billed. On a fixed-quote job it is the only way the breakdown says
   * anything at all, since every line there is covered by the price.
   */
  includeUncharged?: boolean
  /**
   * Also work out what each entry cost you. Off by default, and when it is off
   * the figure is not merely hidden — it is never computed, so no document can
   * print it. See the note at the top of the file.
   */
  withCost?: boolean
}): ClientLine[] {
  const kind = input.kind ?? 'all'
  const detail = input.labourDetail ?? 'phase'
  const labourById = new Map((input.labour ?? []).map(r => [String(r.id), r]))
  const matById = new Map((input.materials ?? []).map(r => [String(r.id), r]))
  const rowOf = (l: InvoiceableLine) =>
    (l.kind === 'labour' ? labourById : matById).get(l.id)

  return input.lines
    .filter(l => !l.notBillable || input.includeUncharged)
    .filter(l => kind === 'all'
      || (kind === 'labour' && l.kind === 'labour')
      || (kind === 'materials' && l.kind === 'material'))
    .map((l): ClientLine => ({
      id: l.id,
      kind: l.kind,
      date: l.date ?? '',
      description: l.kind === 'labour'
        ? labourDescription(labourById.get(l.id), detail)
        : materialDescription(matById.get(l.id), input.showSupplier),
      ...(l.kind === 'labour'
        ? {
            hours: r2(n(l.hours)),
            phase: String(labourById.get(l.id)?.phase_name ?? '').trim() || 'Painting labour',
          }
        : {}),
      chargeExGST: r2(n(l.amountExGST)),
      // Both reasons reach here as notBillable; only the row says which.
      basis: !l.notBillable ? 'charged'
        : isNotBillable(rowOf(l)) ? 'no-charge'
        : 'included',
      ...(input.withCost
        ? { costExGST: r2(l.kind === 'labour'
            ? labCost(rowOf(l) ?? {})
            : n(rowOf(l)?.cost_ex_gst)) }
        : {}),
    }))
    .sort((a, b) => (a.date || '').localeCompare(b.date || '')
      || a.kind.localeCompare(b.kind)
      || a.description.localeCompare(b.description))
}

/** Only the lines the tick boxes selected. An empty selection means all of them. */
export const selected = (rows: ClientLine[], picked?: Set<string> | null): ClientLine[] =>
  picked && picked.size ? rows.filter(r => picked.has(r.id)) : rows

export interface BreakdownTotals {
  /** Chargeable hours only. See the note below — this one matters. */
  labourHours: number
  labourExGST: number
  materialsExGST: number
  exGST: number
  gst: number
  incGST: number
  /** Hours on work carrying no charge, kept well away from the figures above. */
  unchargedHours: number
  /** How many lines carry no charge, so a document knows to say so. */
  uncharged: number
  /** True when nothing in the selection is charged — the fixed-quote case. */
  allUncharged: boolean
  /**
   * What the work cost you. Nil unless the rows were built `withCost`.
   *
   * Unlike the charge figures these count every line, charged or not: an hour
   * you did not bill for still cost you, and leaving it out of the cost while
   * counting it in the hours is how a job looks better than it was.
   */
  labourCostExGST: number
  materialsCostExGST: number
  costExGST: number
  /** Whether any row actually carries a cost, so a document knows it can ask. */
  hasCost: boolean
}

export const isCharged = (r: ClientLine): boolean => r.basis === 'charged'

/**
 * What the selected lines come to. `gstRate` is 0 on a cash job.
 *
 * Only charged lines reach the money, and only their hours reach labourHours.
 * That second part is not fussiness: the rate column is derived by dividing
 * the charge by the hours, so folding four unpaid hours into the total would
 * print a rate below the one you actually charge — in a document the client
 * keeps, and can hold you to next time.
 */
export function breakdownTotals(rows: ClientLine[], gstRate = 0.1): BreakdownTotals {
  const charged = rows.filter(isCharged)
  const free = rows.filter(r => !isCharged(r))
  const lab = charged.filter(r => r.kind === 'labour')
  const mat = charged.filter(r => r.kind === 'material')
  const labourExGST = r2(lab.reduce((s, r) => s + r.chargeExGST, 0))
  const materialsExGST = r2(mat.reduce((s, r) => s + r.chargeExGST, 0))
  const exGST = r2(labourExGST + materialsExGST)
  const gst = r2(exGST * gstRate)
  // Cost counts every row, not just the charged ones — see the note above.
  const labourCost = r2(rows.filter(r => r.kind === 'labour')
    .reduce((s, r) => s + n(r.costExGST), 0))
  const materialsCost = r2(rows.filter(r => r.kind === 'material')
    .reduce((s, r) => s + n(r.costExGST), 0))
  return {
    labourHours: r2(lab.reduce((s, r) => s + n(r.hours), 0)),
    labourExGST,
    materialsExGST,
    exGST,
    gst,
    incGST: r2(exGST + gst),
    labourCostExGST: labourCost,
    materialsCostExGST: materialsCost,
    costExGST: r2(labourCost + materialsCost),
    hasCost: rows.some(r => r.costExGST !== undefined),
    unchargedHours: r2(free.reduce((s, r) => s + n(r.hours), 0)),
    uncharged: free.length,
    allUncharged: rows.length > 0 && charged.length === 0,
  }
}

export interface PhaseGroup {
  name: string
  hours: number
  chargeExGST: number
  /** Every row in the group shares it, so the group can be labelled honestly. */
  basis: ChargeBasis
}

/**
 * Labour gathered by phase, which is how a client reads it: one row for
 * preparation, one for each coat. Rows keep the order they were first seen in,
 * which is date order, so the list reads as the job progressed.
 */
export const groupLabourByPhase = (rows: ClientLine[]): PhaseGroup[] =>
  groupPhases(rows, isCharged)

/**
 * The same, for work carrying no charge.
 *
 * Kept as a separate pass rather than folded in with the rest: an uncharged
 * row has hours but no money, so averaging it into a phase would divide the
 * same charge over more hours and print a rate below the one you charge.
 * On a fixed-quote job this is every row, which is why it groups at all —
 * otherwise the client reads "Preparation" three times.
 */
export const groupUnchargedByPhase = (rows: ClientLine[]): PhaseGroup[] =>
  groupPhases(rows, r => !isCharged(r))

function groupPhases(rows: ClientLine[], keep: (r: ClientLine) => boolean): PhaseGroup[] {
  const out: PhaseGroup[] = []
  const at = new Map<string, PhaseGroup>()
  for (const r of rows) {
    if (r.kind !== 'labour' || !keep(r)) continue
    const name = r.phase || r.description
    // Keyed on the basis too, so one phase part-charged and part-included
    // becomes two rows rather than one row with a label that fits neither.
    const key = `${name}\u0000${r.basis}`
    let g = at.get(key)
    if (!g) {
      g = { name, hours: 0, chargeExGST: 0, basis: r.basis }
      at.set(key, g)
      out.push(g)
    }
    g.hours = r2(g.hours + n(r.hours))
    g.chargeExGST = r2(g.chargeExGST + r.chargeExGST)
  }
  return out
}

/**
 * The rate a line works out to, for the optional rate column.
 *
 * Derived from the charge and the hours rather than read from the labour row,
 * because the row's charge_rate is what was logged and the charge may have
 * been billed at an agreed rate instead. The figure shown has to be the one
 * that multiplies out to the total, or the client will do the division
 * themselves and find it does not.
 */
export const ratePerHour = (chargeExGST: number, hours: number | undefined): number | null => {
  const h = n(hours)
  return h > 0 ? r2(n(chargeExGST) / h) : null
}

export interface Shortfall {
  /** What the client agreed to pay, or what they were billed. */
  revenueExGST: number
  labourCostExGST: number
  materialsCostExGST: number
  costExGST: number
  /** Revenue less cost. Negative is the loss. */
  marginExGST: number
  hours: number
  /** What an hour of labour cost you. */
  costPerHour: number | null
  /**
   * What an hour of labour actually earned, once the paint is paid for.
   *
   * Materials come out of the price first — they were bought, not earned — so
   * this is (price − materials) ÷ hours. Dividing the whole price by the hours
   * would count the paint as wages and flatter the figure, which is the
   * opposite of the point when you are showing a job that lost money.
   */
  earnedPerHour: number | null
}

/**
 * The job's position: what came in, what it cost, and the gap.
 *
 * `revenueExGST` is the agreed price on a fixed job, and the sum of the
 * charged lines on an hourly one — which is why it is passed in rather than
 * guessed at here.
 */
export function shortfallOf(rows: ClientLine[], revenueExGST: number): Shortfall {
  const t = breakdownTotals(rows, 0)
  const hours = r2(t.labourHours + t.unchargedHours)
  const rev = r2(n(revenueExGST))
  return {
    revenueExGST: rev,
    labourCostExGST: t.labourCostExGST,
    materialsCostExGST: t.materialsCostExGST,
    costExGST: t.costExGST,
    marginExGST: r2(rev - t.costExGST),
    hours,
    costPerHour: ratePerHour(t.labourCostExGST, hours),
    earnedPerHour: ratePerHour(r2(rev - t.materialsCostExGST), hours),
  }
}

// ── The two things you can do with it ────────────────────────

/** A loss reads -$1,000.00, not $-1,000.00. */
const money = (v: number) => {
  const x = n(v)
  return (x < 0 ? '-$' : '$')
    + Math.abs(x).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const auDate = (d: string) => {
  if (!d) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : d
}

/** 8 reads as "8", 9.5 as "9.5", 9.25 as "9.25" — no trailing noughts. */
const hrs = (h: number) => {
  if (Math.round(h * 100) % 100 === 0) return String(Math.round(h))
  return h.toFixed(2).replace(/0$/, '')
}

export interface BreakdownOptions {
  /** Shown at the top so the client knows which job this answers. */
  jobTitle?: string
  client?: string
  site?: string
  /** 0 on a cash job — then no GST line is printed at all. */
  gstRate?: number
  /** Your charge rate per hour, beside each labour row. Off by default. */
  showRate?: boolean
  /**
   * How the labour reads. Must match what was passed to `clientLines`, or the
   * rows will carry a name the grouping then throws away.
   */
  labourDetail?: LabourDetail
  /** Prints the date each entry was logged. */
  showDates?: boolean
  /**
   * The agreed price, ex GST, for a fixed-quote job.
   *
   * When nothing in the selection is charged line by line, the document has no
   * sum to print — adding nil to nil is not the answer to "what did it come
   * to". It prints this instead, which is the figure that actually applies.
   */
  agreedExGST?: number
  /**
   * Which side of the money the lines show. 'charge' is the default and
   * discloses nothing; the others need rows built `withCost`.
   */
  money?: MoneyShown
  /**
   * Close with what came in, what it cost and the gap. Needs `withCost` rows,
   * and `agreedExGST` on a fixed job or there is no revenue to compare.
   */
  showShortfall?: boolean
}

/**
 * A plain-text list, for pasting into the reply to the email that asked.
 *
 * Most of these questions arrive by email and want answering in the same
 * email, not as an attachment the builder has to open on a phone on site.
 */
export function buildBreakdownText(rows: ClientLine[], o: BreakdownOptions = {}): string {
  const gstRate = o.gstRate ?? 0.1
  const t = breakdownTotals(rows, gstRate)
  const showDates = o.showDates ?? true
  const out: string[] = []

  const head = [o.jobTitle, o.site].filter(Boolean).join(' — ')
  if (head) out.push(head)
  if (o.client) out.push(o.client)
  if (out.length) out.push('')

  const wantCost = showsCost(o.money) && t.hasCost
  const wantCharge = showsCharge(o.money)

  // An uncharged line reads as what it is rather than as $0.00, which would
  // say the work was worthless rather than that it was already paid for.
  const chargeOf = (r: ClientLine) =>
    isCharged(r) ? money(r.chargeExGST) : BASIS_LABEL[r.basis].toLowerCase()
  const when = (r: ClientLine) => (showDates && r.date ? auDate(r.date) + '  ' : '')

  /** The money at the end of a line: cost, charge, or "cost / charge". */
  const tail = (cost: number, charge: string, hours?: number) => {
    const bits: string[] = []
    if (wantCost) {
      const rate = o.showRate ? ratePerHour(cost, hours) : null
      bits.push(`cost ${money(cost)}${rate != null ? ` (${money(rate)}/hr)` : ''}`)
    }
    if (wantCharge) bits.push(wantCost ? `charged ${charge}` : charge)
    return bits.join(', ')
  }

  const labour = rows.filter(r => r.kind === 'labour')
  const chargedLabour = labour.filter(isCharged)
  if (labour.length) {
    const h = t.labourHours || t.unchargedHours
    out.push(`LABOUR${h ? ` — ${hrs(t.labourHours + t.unchargedHours)} hrs` : ''}`)
    const groups = (o.labourDetail ?? 'phase') === 'phase' ? groupLabourByPhase(rows) : null
    if (groups) {
      const costOfPhase = (name: string, basis: ChargeBasis) => r2(labour
        .filter(r => (r.phase || r.description) === name && r.basis === basis)
        .reduce((s, r) => s + n(r.costExGST), 0))
      const line = (g: PhaseGroup, charge: string) => {
        const rate = wantCharge && o.showRate ? ratePerHour(g.chargeExGST, g.hours) : null
        return `  ${g.name}${g.hours ? ` — ${hrs(g.hours)} hrs` : ''}`
          + `${rate != null ? ` @ ${money(rate)}/hr` : ''}`
          + ` — ${tail(costOfPhase(g.name, g.basis), charge, g.hours)}`
      }
      for (const g of groups) out.push(line(g, money(g.chargeExGST)))
      // Grouping leaves the uncharged hours out, so they follow, grouped too.
      for (const g of groupUnchargedByPhase(rows)) {
        out.push(line(g, BASIS_LABEL[g.basis].toLowerCase()))
      }
    } else {
      for (const r of labour) {
        const rate = wantCharge && o.showRate && isCharged(r)
          ? ratePerHour(r.chargeExGST, r.hours) : null
        out.push(`  ${when(r)}${r.description}`
          + `${r.hours ? ` — ${hrs(r.hours)} hrs` : ''}`
          + `${rate != null ? ` @ ${money(rate)}/hr` : ''}`
          + ` — ${tail(n(r.costExGST), chargeOf(r), r.hours)}`)
      }
    }
    if (wantCost) out.push(`  Labour cost: ${money(t.labourCostExGST)}`)
    if (wantCharge && chargedLabour.length) out.push(`  Labour total: ${money(t.labourExGST)}`)
    out.push('')
  }

  const mats = rows.filter(r => r.kind === 'material')
  if (mats.length) {
    out.push('MATERIALS')
    for (const r of mats) {
      out.push(`  ${when(r)}${r.description} — ${tail(n(r.costExGST), chargeOf(r))}`)
    }
    if (wantCost) out.push(`  Materials cost: ${money(t.materialsCostExGST)}`)
    if (wantCharge && mats.some(isCharged)) out.push(`  Materials total: ${money(t.materialsExGST)}`)
    out.push('')
  }

  if (!labour.length && !mats.length) return 'Nothing selected.'

  // What came in, what it cost, and the gap. The revenue is the agreed price
  // on a fixed job and the charged lines on an hourly one.
  const revenue = o.agreedExGST ?? t.exGST
  const addShortfall = () => {
    if (!o.showShortfall || !t.hasCost) return
    const s = shortfallOf(rows, revenue)
    out.push('')
    out.push('WHERE THE JOB ENDED UP')
    out.push(`  ${o.agreedExGST != null ? 'Agreed price' : 'Charged'} ex GST: ${money(s.revenueExGST)}`)
    out.push(`  Less materials: ${money(s.materialsCostExGST)}`)
    out.push(`  Less labour (${hrs(s.hours)} hrs): ${money(s.labourCostExGST)}`)
    out.push(`  ${s.marginExGST < 0 ? 'Shortfall' : 'Margin'}: ${money(s.marginExGST)}`)
    if (s.earnedPerHour != null) {
      out.push(`  Earned per hour of labour: ${money(s.earnedPerHour)}`)
    }
    if (s.costPerHour != null) out.push(`  Labour cost per hour: ${money(s.costPerHour)}`)
  }

  // Nothing charged line by line means there is no sum to print. Adding nil
  // to nil is not the answer to "what did it come to" — the agreed price is.
  if (t.allUncharged) {
    // The shortfall block opens with the agreed price, so printing it here
    // too would state the same figure twice, four lines apart.
    const willRepeat = o.showShortfall && t.hasCost
    if (o.agreedExGST != null && !willRepeat) {
      out.push(`Agreed price ex GST: ${money(o.agreedExGST)}`)
      if (gstRate > 0) {
        out.push(`GST: ${money(r2(o.agreedExGST * gstRate))}`)
        out.push(`Agreed price inc GST: ${money(r2(o.agreedExGST * (1 + gstRate)))}`)
      }
    } else if (!o.showShortfall || !t.hasCost) {
      out.push('All of the above is covered by the agreed price for this job.')
    }
    addShortfall()
    return out.join('\n')
  }

  out.push(`Total ex GST: ${money(t.exGST)}`)
  if (gstRate > 0) {
    out.push(`GST: ${money(t.gst)}`)
    out.push(`Total inc GST: ${money(t.incGST)}`)
  }
  if (t.uncharged) {
    out.push('')
    out.push(t.uncharged === 1
      ? 'One entry above carries no charge.'
      : `${t.uncharged} entries above carry no charge.`)
  }
  addShortfall()
  return out.join('\n')
}

const esc = (v: any) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * The same list as a printable page, on your letterhead.
 *
 * Headed "Breakdown of works" rather than styled as an invoice: it is a
 * record of what was done, and a document that looks like a tax invoice but
 * is not one is a document somebody eventually tries to pay.
 */
export function buildBreakdownHTML(
  rows: ClientLine[],
  o: BreakdownOptions & {
    biz?: Partial<{
      company_name: string; website: string; phone: string; address: string
      licence: string; abn: string
    }> | null
    /** Where the letterhead images are served from. */
    origin?: string
  } = {},
): string {
  const gstRate = o.gstRate ?? 0.1
  const t = breakdownTotals(rows, gstRate)
  const showDates = o.showDates ?? true
  const biz = o.biz ?? {}
  const origin = o.origin ?? ''
  const date = new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })

  const labour = rows.filter(r => r.kind === 'labour')
  const mats = rows.filter(r => r.kind === 'material')
  const groups = (o.labourDetail ?? 'phase') === 'phase' ? groupLabourByPhase(rows) : null

  const wantCost = showsCost(o.money) && t.hasCost
  const wantCharge = showsCharge(o.money)

  const cols = (kind: 'labour' | 'material') => {
    const c: string[] = []
    if (showDates && !(kind === 'labour' && groups)) c.push('<th style="width:88px">Date</th>')
    c.push('<th>Description</th>')
    if (kind === 'labour') c.push('<th style="width:70px;text-align:right">Hours</th>')
    if (wantCost) {
      if (kind === 'labour' && o.showRate) c.push('<th style="width:90px;text-align:right">Cost/hr</th>')
      c.push('<th style="width:110px;text-align:right">Cost</th>')
    }
    if (wantCharge) {
      if (kind === 'labour' && o.showRate) c.push('<th style="width:90px;text-align:right">Rate</th>')
      c.push(`<th style="width:110px;text-align:right">${wantCost ? 'Charged' : 'Amount'}</th>`)
    }
    return c.join('')
  }

  /** The money cells at the end of a row, matching `cols` exactly. */
  const moneyCells = (cost: number, chargeCell: string, hours?: number, rated = false) => {
    let c = ''
    if (wantCost) {
      if (rated && o.showRate) {
        const cr = ratePerHour(cost, hours)
        c += `<td class="num">${cr != null ? money(cr) : '—'}</td>`
      }
      c += `<td class="num cost">${money(cost)}</td>`
    }
    if (wantCharge) c += chargeCell
    return c
  }

  // The hours heading counts every hour on the page, charged or not — it is
  // reporting what was done, not what is owed.
  const allHours = r2(t.labourHours + t.unchargedHours)

  // An uncharged line says why rather than printing $0.00 — see ChargeBasis.
  const amountCell = (r: ClientLine) => isCharged(r)
    ? `<td class="num amt">${money(r.chargeExGST)}</td>`
    : `<td class="num free">${esc(BASIS_LABEL[r.basis])}</td>`

  const costOfPhase = (name: string, basis: ChargeBasis) => r2(labour
    .filter(r => (r.phase || r.description) === name && r.basis === basis)
    .reduce((s, r) => s + n(r.costExGST), 0))

  const phaseRow = (g: PhaseGroup, chargeCell: string) => {
    const rate = wantCharge && o.showRate ? ratePerHour(g.chargeExGST, g.hours) : null
    return `<tr><td>${esc(g.name)}</td>`
      + `<td class="num">${g.hours ? hrs(g.hours) : '—'}</td>`
      + moneyCells(costOfPhase(g.name, g.basis),
          (o.showRate ? `<td class="num">${rate != null ? money(rate) : '—'}</td>` : '') + chargeCell,
          g.hours, true)
      + '</tr>'
  }

  const labourBody = groups
    ? groups.map(g => phaseRow(g, `<td class="num amt">${money(g.chargeExGST)}</td>`)).join('')
      // Grouping skips the uncharged hours, so they follow the phases.
      + groupUnchargedByPhase(rows)
          .map(g => phaseRow(g, `<td class="num free">${esc(BASIS_LABEL[g.basis])}</td>`))
          .join('')
    : labour.map(r => {
        const rate = wantCharge && o.showRate && isCharged(r)
          ? ratePerHour(r.chargeExGST, r.hours) : null
        return '<tr>'
          + (showDates ? `<td class="dt">${esc(auDate(r.date)) || '—'}</td>` : '')
          + `<td>${esc(r.description)}</td>`
          + `<td class="num">${r.hours ? hrs(r.hours) : '—'}</td>`
          + moneyCells(n(r.costExGST),
              (o.showRate ? `<td class="num">${rate != null ? money(rate) : '—'}</td>` : '')
              + amountCell(r),
              r.hours, true)
          + '</tr>'
      }).join('')

  const matsBody = mats.map(r => '<tr>'
    + (showDates ? `<td class="dt">${esc(auDate(r.date)) || '—'}</td>` : '')
    + `<td>${esc(r.description)}</td>`
    + moneyCells(n(r.costExGST), amountCell(r))
    + '</tr>').join('')

  /**
   * How many columns that section's table has, so the subtotal row spans all
   * but the last and its figure lands under Amount. Starts at two — the
   * description and the amount itself — and must agree with `cols` above.
   */
  const span = (kind: 'labour' | 'material') => {
    let c = 1                                   // description
    if (showDates && !(kind === 'labour' && groups)) c++
    if (kind === 'labour') c++                  // hours
    if (wantCost) { c++; if (kind === 'labour' && o.showRate) c++ }
    if (wantCharge) { c++; if (kind === 'labour' && o.showRate) c++ }
    return c
  }

  /** The money cells on a subtotal row, matching `cols` the same way. */
  const subCells = (cost: number, charge: string, kind: 'labour' | 'material') => {
    let c = ''
    if (wantCost) {
      if (kind === 'labour' && o.showRate) c += '<td></td>'
      c += `<td class="num">${money(cost)}</td>`
    }
    if (wantCharge) {
      if (kind === 'labour' && o.showRate) c += '<td></td>'
      c += `<td class="num">${charge}</td>`
    }
    return c
  }
  /** Columns a subtotal's label spans: everything the money cells do not. */
  const labelSpan = (kind: 'labour' | 'material') => {
    let money = 0
    if (wantCost) { money++; if (kind === 'labour' && o.showRate) money++ }
    if (wantCharge) { money++; if (kind === 'labour' && o.showRate) money++ }
    return span(kind) - money
  }

  // What came in, what it cost, and the gap.
  const shortfallBlock = (() => {
    if (!o.showShortfall || !t.hasCost) return ''
    const s = shortfallOf(rows, o.agreedExGST ?? t.exGST)
    const row = (label: string, value: string, cls = '') =>
      `<tr${cls ? ` class="${cls}"` : ''}><td>${label}</td><td>${value}</td></tr>`
    return `<h2>Where the job ended up</h2>
<table class="grand" style="margin-left:0;width:min(420px,100%)"><tbody>
${row(o.agreedExGST != null ? 'Agreed price ex GST' : 'Charged ex GST', money(s.revenueExGST))}
${row('Less materials', money(s.materialsCostExGST))}
${row(`Less labour (${hrs(s.hours)} hrs)`, money(s.labourCostExGST))}
${row(s.marginExGST < 0 ? 'Shortfall' : 'Margin', money(s.marginExGST), s.marginExGST < 0 ? 'big loss' : 'big')}
</tbody></table>
<table class="grand" style="margin-left:0;width:min(420px,100%);margin-top:4px"><tbody>
${s.earnedPerHour != null ? row('Earned per hour of labour', money(s.earnedPerHour)) : ''}
${s.costPerHour != null ? row('Labour cost per hour', money(s.costPerHour)) : ''}
</tbody></table>`
  })()

  const meta: string[] = []
  if (o.client) meta.push(`<span class="lbl">To:</span><span>${esc(o.client)}</span>`)
  if (o.jobTitle) meta.push(`<span class="lbl">Project:</span><span>${esc(o.jobTitle)}</span>`)
  if (o.site) meta.push(`<span class="lbl">Site:</span><span>${esc(o.site)}</span>`)
  meta.push(`<span class="lbl">Date:</span><span>${date}</span>`)

  const title = ['Breakdown of works', o.jobTitle, o.site].filter(Boolean).join(' — ')

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${esc(title)}</title><style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,Helvetica,sans-serif;font-size:11.5px;color:#1a1a18;padding:28px 32px;max-width:860px;margin:0 auto}
.hdr{display:flex;justify-content:space-between;align-items:center;padding-bottom:14px;border-bottom:3px solid #1a1a18;margin-bottom:18px}
.contact{text-align:right;font-size:10.5px;color:#555;line-height:1.8}
h1{font-size:22px;font-weight:700;margin-bottom:14px}
.meta{display:grid;grid-template-columns:90px 1fr;gap:2px 10px;font-size:11.5px;margin-bottom:16px;max-width:420px}
.meta .lbl{font-weight:700}
h2{font-size:12px;font-weight:700;margin:18px 0 6px;border-bottom:1.5px solid #1a1a18;padding-bottom:3px;text-transform:uppercase;letter-spacing:.4px}
p{line-height:1.6;margin-bottom:8px}
table{width:100%;border-collapse:collapse;margin-bottom:6px;font-size:11px}
th{background:#f0efec;padding:6px 8px;text-align:left;border:1px solid #ccc;font-size:10.5px;font-weight:700}
td{border:1px solid #ddd;padding:5px 8px}
tr:nth-child(even) td{background:#fafaf8}
td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
td.amt{font-weight:600}
td.dt{white-space:nowrap;color:#555}
td.free{color:#555;font-style:italic;font-weight:600}
td.cost{color:#555}
.grand tr.loss td{color:#b91c1c}
.sub td{font-weight:700;background:#f0efec !important;border:1px solid #ccc}
.grand{margin-top:14px;margin-left:auto;width:min(320px,100%);border-collapse:collapse}
.grand td{border:none;padding:4px 8px;font-size:12px}
.grand td:last-child{text-align:right;font-variant-numeric:tabular-nums}
.grand tr.big td{font-weight:700;font-size:13px;border-top:2px solid #1a1a18;padding-top:7px}
.note{font-size:10.5px;color:#666;margin-top:18px;line-height:1.6}
.footer{display:flex;justify-content:space-between;align-items:flex-end;margin-top:24px;padding-top:12px;border-top:1px solid #ccc}
@media print{button{display:none}body{padding:16px}table{break-inside:avoid}h2{break-after:avoid}.footer{break-inside:avoid}}
</style></head><body>
<div class="hdr">
  ${origin ? `<img src="${origin}/np-logo.png" alt="${esc(biz.company_name || 'Northern Painters')}" style="width:300px;height:auto;display:block">`
    : `<div style="font-size:18px;font-weight:700">${esc(biz.company_name || 'Northern Painters')}</div>`}
  <div class="contact">${esc(biz.website || 'www.northernpaintersps.com.au')}<br>Ph: ${esc(biz.phone || '')}<br>${esc(biz.address || '')}<br><span style="font-size:9.5px;color:#aaa">Lic. No: ${esc(biz.licence || '')} &nbsp;|&nbsp; ABN ${esc(biz.abn || '')}</span></div>
</div>
<h1>Breakdown of Works</h1>
<div class="meta">${meta.join('')}</div>
${labour.length ? `<h2>Labour</h2>
<table><thead><tr>${cols('labour')}</tr></thead><tbody>${labourBody}
<tr class="sub"><td colspan="${labelSpan('labour')}">Labour${allHours ? ` — ${hrs(allHours)} hours` : ''}</td>${subCells(t.labourCostExGST, labour.some(isCharged) ? money(t.labourExGST) : '—', 'labour')}</tr>
</tbody></table>` : ''}
${mats.length ? `<h2>Materials</h2>
<table><thead><tr>${cols('material')}</tr></thead><tbody>${matsBody}
<tr class="sub"><td colspan="${labelSpan('material')}">Materials</td>${subCells(t.materialsCostExGST, mats.some(isCharged) ? money(t.materialsExGST) : '—', 'material')}</tr>
</tbody></table>` : ''}
${!labour.length && !mats.length ? '<p>Nothing selected.</p>' : ''}
${t.allUncharged ? (o.agreedExGST != null && !(o.showShortfall && t.hasCost) ? `<table class="grand"><tbody>
<tr><td>Agreed price ex GST</td><td>${money(o.agreedExGST)}</td></tr>
${gstRate > 0 ? `<tr><td>GST</td><td>${money(r2(o.agreedExGST * gstRate))}</td></tr>
<tr class="big"><td>Agreed price inc GST</td><td>${money(r2(o.agreedExGST * (1 + gstRate)))}</td></tr>`
  : `<tr class="big"><td>Agreed price</td><td>${money(o.agreedExGST)}</td></tr>`}
</tbody></table>`
  : (o.showShortfall && t.hasCost ? ''
      : '<p class="note" style="margin-top:14px">All of the above is covered by the agreed price for this job.</p>'))
: `<table class="grand"><tbody>
<tr><td>Total ex GST</td><td>${money(t.exGST)}</td></tr>
${gstRate > 0 ? `<tr><td>GST</td><td>${money(t.gst)}</td></tr>
<tr class="big"><td>Total inc GST</td><td>${money(t.incGST)}</td></tr>`
  : `<tr class="big"><td>Total</td><td>${money(t.exGST)}</td></tr>`}
</tbody></table>`}
${shortfallBlock}
<p class="note">${t.uncharged && !t.allUncharged
  ? `Entries marked <b>Included</b> are covered by the agreed price for this job; entries marked <b>No charge</b> were carried out at no cost to you. Neither is added to the total above.<br>`
  : ''}This is a breakdown of works carried out, provided for your records. It is not a tax invoice and is not a request for payment.</p>
<div class="footer">
  <div style="font-size:10.5px;color:#666">${esc(biz.company_name || 'Northern Painters')}${biz.licence ? ` &nbsp;|&nbsp; Lic. No: ${esc(biz.licence)}` : ''}${biz.abn ? ` &nbsp;|&nbsp; ABN ${esc(biz.abn)}` : ''}</div>
</div>
<br><button onclick="window.print()" style="margin-top:12px;padding:10px 24px;background:#1a1a18;color:#fff;border:none;border-radius:6px;font-size:13px;cursor:pointer">Print / Save as PDF</button>
</body></html>`
}
