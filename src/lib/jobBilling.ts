// What has been invoiced on a job, and what is still to bill.
//
// Two bases, chosen from the job's terms:
//   fixed   — the agreed contract sum plus approved variations
//   actuals — logged billable labour plus materials at cost + markup
//
// A fixed-price job is billed against what was agreed regardless of what the
// work actually cost. An hourly or estimate job has no contract sum, so the
// only honest answer is what has been logged so far.
//
// Everything here is ex GST internally and converted once at the edges: labour,
// materials, variations and the agreed price are all stored ex GST, and only
// invoices carry an inc-GST total.
//
// Pure — no hooks, no Supabase — so the arithmetic can be checked without
// running the app.

import {
  incOf, invIncGST, invExGST, calcOwed,
  labBillable, isBillableLabour,
  matCost, isBillableMaterial,
  parseMilestones, type Milestone,
} from './utils'

export type BillingBasis = 'fixed' | 'actuals'

type Row = Record<string, any>

export type MilestoneStatus = 'unbilled' | 'invoiced' | 'paid'

export interface MilestoneView extends Milestone {
  index: number
  invoice: Row | null
  status: MilestoneStatus
  /** The milestone is ticked received by hand but has no settled invoice. */
  mismatch: boolean
}

export interface JobBilling {
  basis: BillingBasis

  contractExGST: number          // fixed basis only, else 0
  variationsExGST: number
  labourBillableExGST: number    // actuals basis only, else 0
  materialsBillableExGST: number // actuals basis only, else 0 — includes markup
  materialsMarkupExGST: number   // the markup portion, shown separately

  billableToDateExGST: number
  billableToDateIncGST: number

  invoicedIncGST: number
  invoicedExGST: number
  receivedIncGST: number
  cashReceivedIncGST: number
  owedIncGST: number

  leftToInvoiceIncGST: number
  /** Invoiced beyond what is billable — shown rather than a negative remainder. */
  overBilledIncGST: number
  invoicePct: number
  paidPct: number

  invoices: Row[]
  milestones: MilestoneView[]
  /** False when there is nothing to measure against; suppresses tiles and bars. */
  hasValue: boolean
}

/** Matches the test the Invoices page has always used, so no job reclassifies. */
export function billingBasis(job: Row | undefined): BillingBasis {
  const terms = (job?.terms || '').toLowerCase()
  return terms.includes('hourly') || terms.includes('estimate') ? 'actuals' : 'fixed'
}

export function computeJobBilling(input: {
  job: Row
  invoices: Row[]
  labour?: Row[]
  materials?: Row[]
  variations?: Row[]
  paySchedule?: Row | null
  markupPct?: number
}): JobBilling {
  const { job, paySchedule } = input
  const markupPct = input.markupPct ?? 0
  const jobId = job?.id

  const invoices = (input.invoices ?? []).filter(i => i.job_id === jobId)
  const labour = (input.labour ?? []).filter(l => l.job_id === jobId)
  const materials = (input.materials ?? []).filter(m => m.job_id === jobId)
  const variations = (input.variations ?? []).filter(v => v.job_id === jobId)

  const basis = billingBasis(job)

  // Approved variations are extra agreed work on either basis — on an hourly
  // job the hours land in labour, but a fixed-price variation is its own sum.
  const variationsExGST = variations
    .filter(v => v.var_status === 'Approved')
    .reduce((s, v) => s + (v.amount_ex_gst || 0), 0)

  let contractExGST = 0
  let labourBillableExGST = 0
  let materialsBillableExGST = 0
  let materialsMarkupExGST = 0

  if (basis === 'fixed') {
    contractExGST = job?.agreed_ex_gst || job?.quote_ex_gst || 0
  } else {
    labourBillableExGST = labour
      .filter(isBillableLabour)
      .reduce((s, l) => s + labBillable(l), 0)
    const matCostExGST = materials
      .filter(isBillableMaterial)
      .reduce((s, m) => s + matCost(m), 0)
    materialsMarkupExGST = matCostExGST * (markupPct / 100)
    materialsBillableExGST = matCostExGST + materialsMarkupExGST
  }

  const billableToDateExGST = basis === 'fixed'
    ? contractExGST + variationsExGST
    : labourBillableExGST + materialsBillableExGST + variationsExGST
  const billableToDateIncGST = incOf(billableToDateExGST)

  const invoicedIncGST = invoices.reduce((s, i) => s + invIncGST(i), 0)
  const invoicedExGST = invoices.reduce((s, i) => s + invExGST(i), 0)
  const receivedIncGST = invoices.reduce((s, i) => s + (i.received || 0), 0)
  const cashReceivedIncGST = invoices.reduce((s, i) => s + (i.extra?.cash_received || 0), 0)
  const owedIncGST = invoices.reduce((s, i) => s + calcOwed(i), 0)

  const remainder = billableToDateIncGST - invoicedIncGST
  const leftToInvoiceIncGST = Math.max(0, remainder)
  const overBilledIncGST = Math.max(0, -remainder)

  const hasValue = billableToDateIncGST > 0
  const invoicePct = hasValue ? Math.min(100, (invoicedIncGST / billableToDateIncGST) * 100) : 0
  const paidPct = invoicedIncGST > 0 ? Math.min(100, (receivedIncGST / invoicedIncGST) * 100) : 0

  // A milestone's own `received` flag is ticked by hand on the Payments page,
  // so the linked invoice is the source of truth and a disagreement is flagged
  // rather than silently corrected.
  const milestones: MilestoneView[] = parseMilestones(paySchedule).map((m, index) => {
    const invoice = invoices.find(i => i.extra?.milestone_index === index) ?? null
    const status: MilestoneStatus = !invoice ? 'unbilled'
      : calcOwed(invoice) <= 0 ? 'paid' : 'invoiced'
    return { ...m, index, invoice, status, mismatch: !!m.received && status !== 'paid' }
  })

  return {
    basis,
    contractExGST, variationsExGST,
    labourBillableExGST, materialsBillableExGST, materialsMarkupExGST,
    billableToDateExGST, billableToDateIncGST,
    invoicedIncGST, invoicedExGST, receivedIncGST, cashReceivedIncGST, owedIncGST,
    leftToInvoiceIncGST, overBilledIncGST, invoicePct, paidPct,
    invoices, milestones, hasValue,
  }
}

/** One-line audit trail for the actuals basis, e.g. under the headline tile. */
export function billingBreakdown(b: JobBilling): string {
  if (b.basis !== 'actuals') return ''
  const parts = [`${money(b.labourBillableExGST)} labour`]
  if (b.materialsBillableExGST > 0) {
    parts.push(b.materialsMarkupExGST > 0
      ? `${money(b.materialsBillableExGST)} materials (incl. ${money(b.materialsMarkupExGST)} markup)`
      : `${money(b.materialsBillableExGST)} materials`)
  }
  if (b.variationsExGST > 0) parts.push(`${money(b.variationsExGST)} variations`)
  return parts.join(' + ') + ' ex GST'
}

const money = (n: number) => '$' + Math.round(n).toLocaleString('en-AU')
