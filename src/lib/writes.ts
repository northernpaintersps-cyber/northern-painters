// One way to write a row.
//
// Every page had its own private useUpsert hook and its own idea of which
// fields are derived, which was fine while the forms were the only writers.
// The assistant is a second writer, and the way it would go wrong is not a
// crash — it is writing a labour row the Labour page would have written
// differently, and nobody noticing for a month.
//
// So: a builder per kind of change turns a semantic request into a fully
// derived row using the app's own exported helpers, and applyChange is the
// only thing that touches the database. A change is data until it is applied,
// which is what makes the confirmation step possible.

import type { QueryClient } from '@tanstack/react-query'
import { supabase, upsertRows } from '@/lib/supabase'
import { invalidateTable } from '@/lib/queryKeys'
import {
  genId, today, fmtCurrency, fmtDate, normaliseDate,
  findOverlappingLabour, findDuplicateMaterial, jobBillingType,
  deriveScheduledDates, getJobScheduledDates, findCrew, crewLabel,
} from '@/lib/utils'
import { workingDatesFrom } from '@/lib/derive'
import { JOB_STATUSES, QUOTE_STATUSES } from '@/components/JobModal'

type Row = Record<string, any>

export type ChangeOp = 'create' | 'update' | 'delete'

export interface ChangeField { label: string; from?: string; to: string }

export interface Change {
  table: string
  op: ChangeOp
  /** The fully derived row to upsert. For a delete, only `id` matters. */
  row: Row
  /** One line for the card. */
  summary: string
  /** Field by field, for the card's detail. */
  fields: ChangeField[]
  /** Deterministic checks that already exist in the app. Shown, not blocking. */
  warnings: string[]
  /** Blocks the proposal. A change with errors is never offered. */
  errors: string[]
  /** Tables to refresh beyond `table`. */
  alsoInvalidate?: string[]
}

/**
 * What the assistant may write. np_settings is absent for the same reason it
 * is not readable: it holds the Anthropic key.
 */
export const WRITABLE_TABLES = [
  'np_labour', 'np_materials', 'np_expenses', 'np_receipts', 'np_jobs',
  'np_assignments', 'np_calendar_events', 'np_todos', 'np_enquiries',
  'np_variations', 'np_crew', 'np_invoices', 'np_ads_spend',
] as const

export const isWritable = (table: string): boolean =>
  (WRITABLE_TABLES as readonly string[]).includes(table)

export const hasErrors = (c: Change): boolean => c.errors.length > 0

// ── Applying one ────────────────────────────────────────────

export async function applyChange(c: Change, userId: string, qc: QueryClient): Promise<void> {
  if (!isWritable(c.table)) throw new Error(`${c.table} cannot be written to.`)
  if (hasErrors(c)) throw new Error(c.errors[0])
  if (!c.row?.id) throw new Error('A change needs a row id.')

  if (c.op === 'delete') {
    const { error } = await supabase.from(c.table as any)
      .delete().eq('id', c.row.id).eq('user_id', userId)
    if (error) throw new Error(error.message)
  } else {
    // upsertRows already strips a column Postgres does not know and retries,
    // which is what saved the time_slot rollout.
    await upsertRows(c.table, [{
      ...c.row, user_id: userId, updated_at: new Date().toISOString(),
    }])
  }
  invalidateTable(qc, c.table, ...(c.alsoInvalidate ?? []))
}

// ── Shared bits ─────────────────────────────────────────────

export interface WriteContext {
  jobs: Row[]
  crew: Row[]
  labour: Row[]
  materials: Row[]
  assignments: Row[]
  receipts: Row[]
  /** The business settings, for default rates. Never the API key. */
  biz?: Row | null
}

export const emptyContext = (): WriteContext =>
  ({ jobs: [], crew: [], labour: [], materials: [], assignments: [], receipts: [] })

const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0)
const money = (n: number) => fmtCurrency(n)
const jobOf = (ctx: WriteContext, id?: string | null) =>
  ctx.jobs.find(j => String(j.id) === String(id))

const base = (table: string, op: ChangeOp): Change =>
  ({ table, op, row: {}, summary: '', fields: [], warnings: [], errors: [] })

/** A date the model gave us, or today. Rejects anything that is not a date. */
function dateOr(value: unknown, fallback = today()): { date: string; error?: string } {
  if (value == null || value === '') return { date: fallback }
  const d = normaliseDate(String(value))
  if (!d) return { date: fallback, error: `"${value}" is not a date I can use (expect YYYY-MM-DD).` }
  return { date: d }
}

// ── Labour ──────────────────────────────────────────────────

export interface LabourRequest {
  job_id?: string | null
  worker: string
  hours: number
  date?: string
  /** Cost rate. Taken from the crew record, then Settings, when omitted. */
  rate?: number
  charge_rate?: number
  description?: string
  notes?: string
}

/**
 * Mirrors Labour.tsx's save handler: cost is hours x rate, billable is hours x
 * charge_rate with the cost rate as its fallback, client comes off the job and
 * billing_type from jobBillingType.
 */
export function buildLabour(ctx: WriteContext, r: LabourRequest): Change {
  const c = base('np_labour', 'create')
  const worker = String(r.worker ?? '').trim()
  const hours = num(r.hours)
  const job = jobOf(ctx, r.job_id)
  const member = findCrew(ctx.crew, worker)
  const { date, error } = dateOr(r.date)

  if (!worker) c.errors.push('Which worker? A labour entry needs a name.')
  if (hours <= 0) c.errors.push('Hours must be more than zero.')
  if (hours > 24) c.errors.push(`${hours} hours in one day is not possible — check the number.`)
  if (r.job_id && !job) c.errors.push(`No job ${r.job_id}.`)
  if (error) c.errors.push(error)

  const rate = num(r.rate ?? member?.rate ?? ctx.biz?.rates?.standard ?? 65)
  const chargeRate = num(r.charge_rate ?? member?.charge_rate ?? rate)
  const cost = hours * rate
  const billable = hours * chargeRate

  c.row = {
    id: genId('lab'),
    date,
    sub: member?.name ?? worker,
    job_id: job?.id ?? null,
    client: job?.client ?? null,
    hours,
    rate,
    charge_rate: chargeRate,
    cost,
    billable,
    billing_type: jobBillingType(job),
    labour_desc: r.description ?? null,
    notes: r.notes ?? null,
    // No period_start/period_end: those columns do not exist yet, and for a
    // single day's work they would only repeat `date`. Labour.tsx writes them
    // and carries a retry that drops them again.
    created_at: new Date().toISOString(),
  }

  // The overlap check exists and the form only draws a banner with it. Here it
  // sits next to the Confirm button, which is the first time in this app that
  // it is in front of you at the moment you commit.
  const overlap = findOverlappingLabour(ctx.labour, c.row, c.row.id)
  if (overlap) {
    c.warnings.push(overlap.identical
      ? `${c.row.sub} already has ${hours} hrs logged on ${fmtDate(date)} for this job.`
      : `${c.row.sub} already has an overlapping entry around ${fmtDate(date)}.`)
  }
  if (!job) c.warnings.push('Not against any job, so it will not appear in a job\'s costs.')

  c.summary = `Log ${hours} hrs for ${c.row.sub}${job ? ` on ${job.id}` : ''} on ${fmtDate(date)}`
  c.fields = [
    { label: 'Worker', to: c.row.sub },
    { label: 'Job', to: job ? `${job.id} — ${job.client ?? ''}` : 'none' },
    { label: 'Date', to: fmtDate(date) },
    { label: 'Hours', to: String(hours) },
    { label: 'Cost rate', to: `${money(rate)}/hr` },
    { label: 'Cost', to: money(cost) },
    { label: 'Charge rate', to: `${money(chargeRate)}/hr` },
    { label: 'Billable', to: money(billable) },
  ]
  return c
}

// ── Job schedule ────────────────────────────────────────────

export interface RescheduleRequest {
  job_id: string
  /** A new start date, a new day count, or an explicit list of days. */
  start?: string
  days?: number
  dates?: string[]
}

/**
 * Writes scheduled_dates, sched_start and est_days together, as all four
 * existing paths do — a job whose three disagree is what put the calendar and
 * the Jobs page out of step before.
 */
export function buildReschedule(ctx: WriteContext, r: RescheduleRequest): Change {
  const c = base('np_jobs', 'update')
  c.alsoInvalidate = ['np_assignments']
  const job = jobOf(ctx, r.job_id)
  if (!job) { c.errors.push(`No job ${r.job_id}.`); return c }

  const was = getJobScheduledDates(job)
  let dates: string[]

  if (r.dates?.length) {
    const bad = r.dates.filter(d => !normaliseDate(d))
    if (bad.length) c.errors.push(`Not dates I can use: ${bad.join(', ')}`)
    dates = [...new Set(r.dates.map(d => normaliseDate(d)!).filter(Boolean))].sort()
  } else {
    const start = r.start ? dateOr(r.start).date : (normaliseDate(job.sched_start) ?? today())
    if (r.start && !normaliseDate(r.start)) c.errors.push(`"${r.start}" is not a date I can use.`)
    const days = Math.max(1, Math.round(num(r.days ?? job.est_days ?? 1)))
    if (days > 120) c.errors.push(`${days} days is longer than this tool will schedule.`)
    // Recomputed from the start and the day count, deliberately ignoring the
    // stored list — reading it back is the bug utils.ts:152-161 warns about.
    dates = deriveScheduledDates({ ...job, sched_start: start, est_days: days })
    if (!dates.length) dates = workingDatesFrom(start, days)
  }

  if (!dates.length) c.errors.push('That leaves the job with no days at all.')

  c.row = {
    ...job,
    scheduled_dates: dates,
    sched_start: dates[0] ?? null,
    est_days: dates.length || null,
  }

  // An assignment on a day the job no longer runs is not a clash any more, but
  // it is a booking the crew still thinks they have.
  const orphaned = ctx.assignments.filter(a =>
    String(a.job_id) === String(job.id) && a.date && !dates.includes(a.date))
  if (orphaned.length) {
    c.warnings.push(`${orphaned.length} crew booking${orphaned.length === 1 ? '' : 's'} `
      + `(${[...new Set(orphaned.map(a => crewLabel(ctx.crew, a.crew_name)))].join(', ')}) `
      + 'fall on days this job will no longer run. They are not removed — check the crew board.')
  }

  c.summary = `Reschedule ${job.id} to ${dates.length} day${dates.length === 1 ? '' : 's'} from ${fmtDate(dates[0] ?? '')}`
  c.fields = [
    { label: 'Job', to: `${job.id} — ${job.client ?? ''}` },
    { label: 'Start', from: was[0] ? fmtDate(was[0]) : '—', to: fmtDate(dates[0] ?? '') },
    { label: 'Days', from: String(was.length || '—'), to: String(dates.length) },
    { label: 'Last day', from: was.at(-1) ? fmtDate(was.at(-1)!) : '—', to: fmtDate(dates.at(-1) ?? '') },
  ]
  return c
}

// ── Job status ──────────────────────────────────────────────

export function buildJobStatus(
  ctx: WriteContext, r: { job_id: string; status?: string; quote_status?: string },
): Change {
  const c = base('np_jobs', 'update')
  const job = jobOf(ctx, r.job_id)
  if (!job) { c.errors.push(`No job ${r.job_id}.`); return c }

  if (r.status && !JOB_STATUSES.includes(r.status)) {
    c.errors.push(`"${r.status}" is not a job status. One of: ${JOB_STATUSES.join(', ')}`)
  }
  if (r.quote_status && !QUOTE_STATUSES.includes(r.quote_status)) {
    c.errors.push(`"${r.quote_status}" is not a quote status. One of: ${QUOTE_STATUSES.join(', ')}`)
  }
  if (!r.status && !r.quote_status) c.errors.push('Nothing to change.')

  c.row = {
    ...job,
    ...(r.status ? { status: r.status } : {}),
    ...(r.quote_status ? { quote_status: r.quote_status } : {}),
  }
  c.summary = `Set ${job.id} to ${r.status ?? r.quote_status}`
  c.fields = [
    { label: 'Job', to: `${job.id} — ${job.client ?? ''}` },
    ...(r.status ? [{ label: 'Job status', from: job.status ?? '—', to: r.status }] : []),
    ...(r.quote_status ? [{ label: 'Quote status', from: job.quote_status ?? '—', to: r.quote_status }] : []),
  ]
  return c
}

// ── Materials ───────────────────────────────────────────────

export interface MaterialRequest {
  job_id?: string | null
  supplier: string
  cost_ex_gst: number
  date?: string
  /** The supplier's own invoice or docket number. The column is receipt_no. */
  receipt_no?: string
  description?: string
  category?: string
  notes?: string
  /** Supplied when it came off a receipt and disagrees with ex x 0.1. */
  gst?: number
}

export function buildMaterial(ctx: WriteContext, r: MaterialRequest): Change {
  const c = base('np_materials', 'create')
  const supplier = String(r.supplier ?? '').trim()
  const ex = num(r.cost_ex_gst)
  const job = jobOf(ctx, r.job_id)
  const { date, error } = dateOr(r.date)

  if (!supplier) c.errors.push('Which supplier?')
  if (ex <= 0) c.errors.push('The amount must be more than zero.')
  if (r.job_id && !job) c.errors.push(`No job ${r.job_id}.`)
  if (error) c.errors.push(error)

  // The form derives the trio this way; a figure off a receipt wins when given.
  const gst = r.gst != null ? num(r.gst) : +(ex * 0.1).toFixed(2)

  c.row = {
    id: genId('mat'),
    date,
    job_id: job?.id ?? null,
    client: job?.client ?? null,
    supplier,
    // receipt_no, not invoice_no: that is the column, and it is what
    // findDuplicateMaterial matches on. A misnamed field would have been
    // stripped by upsertRows without a word and the number lost.
    receipt_no: r.receipt_no ?? null,
    mat_desc: r.description ?? null,
    category: r.category ?? null,
    cost_ex_gst: ex,
    gst,
    total_inc_gst: +(ex + gst).toFixed(2),
    billing_type: jobBillingType(job),
    notes: r.notes ?? null,
    created_at: new Date().toISOString(),
  }

  // The hit carries why it matched, so the warning can say which it is: the
  // same invoice number is near-certain, the same amount on the same day from
  // a similar supplier is a strong hint.
  const dup = findDuplicateMaterial(ctx.materials, c.row, c.row.id)
  if (dup) {
    const d = dup.row
    c.warnings.push(dup.basis === 'invoice'
      ? `Invoice ${d.receipt_no} from ${d.supplier} is already logged`
        + `${dup.sameSupplier ? '' : ' (under a different supplier name)'}.`
      : `${money(num(d.cost_ex_gst))} from ${d.supplier} on ${fmtDate(d.date)} looks like the same purchase.`)
  }
  if (!job) c.warnings.push('Not against any job, so it counts as overhead.')

  c.summary = `Log ${money(ex)} from ${supplier}${job ? ` on ${job.id}` : ''}`
  c.fields = [
    { label: 'Supplier', to: supplier },
    { label: 'Job', to: job ? `${job.id} — ${job.client ?? ''}` : 'overhead' },
    { label: 'Date', to: fmtDate(date) },
    { label: 'Ex GST', to: money(ex) },
    { label: 'GST', to: money(gst) },
    { label: 'Inc GST', to: money(c.row.total_inc_gst) },
    ...(r.description ? [{ label: 'What', to: r.description }] : []),
    ...(r.receipt_no ? [{ label: 'Invoice no', to: r.receipt_no }] : []),
  ]
  return c
}

// ── Expenses ────────────────────────────────────────────────

export function buildExpense(
  _ctx: WriteContext,
  r: { description: string; amount_ex_gst: number; category?: string; date?: string; gst_applies?: boolean },
): Change {
  const c = base('np_expenses', 'create')
  const ex = num(r.amount_ex_gst)
  const desc = String(r.description ?? '').trim()
  const { date, error } = dateOr(r.date)

  if (!desc) c.errors.push('What was the expense for?')
  if (ex <= 0) c.errors.push('The amount must be more than zero.')
  if (error) c.errors.push(error)

  const gst = r.gst_applies === false ? 0 : +(ex * 0.1).toFixed(2)
  c.row = {
    id: genId('exp'),
    date,
    // exp_desc, not description — see the material row's note above.
    exp_desc: desc,
    category: r.category ?? 'Other',
    amount_ex_gst: ex,
    gst,
    created_at: new Date().toISOString(),
  }
  c.summary = `Log ${money(ex)} expense — ${desc}`
  c.fields = [
    { label: 'What', to: desc },
    { label: 'Category', to: c.row.category },
    { label: 'Date', to: fmtDate(date) },
    { label: 'Ex GST', to: money(ex) },
    { label: 'GST', to: money(gst) },
  ]
  return c
}

// ── Crew bookings ───────────────────────────────────────────

export type Slot = 'full' | 'morning' | 'afternoon'

export interface BookingRequest {
  job_id: string
  worker: string
  dates?: string[]
  date?: string
  slot?: Slot
  notes?: string
}

/**
 * One booking per day. The clash rule from the crew board runs here as a
 * warning — on that screen it is a banner computed after the fact, so nothing
 * checked it at the moment of booking.
 */
export function buildBookings(ctx: WriteContext, r: BookingRequest): Change[] {
  const job = jobOf(ctx, r.job_id)
  const worker = String(r.worker ?? '').trim()
  const member = findCrew(ctx.crew, worker)
  const slot: Slot = (['full', 'morning', 'afternoon'] as const).includes(r.slot as Slot)
    ? r.slot as Slot : 'full'

  const asked = r.dates?.length ? r.dates : (r.date ? [r.date] : [])
  const dates = [...new Set(asked.map(d => normaliseDate(d)!).filter(Boolean))].sort()

  const fail = (msg: string): Change[] => {
    const c = base('np_assignments', 'create')
    c.errors.push(msg)
    return [c]
  }
  if (!job) return fail(`No job ${r.job_id}.`)
  if (!worker) return fail('Which painter?')
  if (!member) {
    return fail(`${worker} is not on the crew list. Add them first, or check the spelling.`)
  }
  if (!dates.length) return fail('Which day or days?')

  const scheduled = getJobScheduledDates(job)
  const clashes = (a: Slot, b: Slot) => a === 'full' || b === 'full' || a === b
  const who = member.name

  return dates.map(date => {
    const c = base('np_assignments', 'create')
    c.alsoInvalidate = ['np_jobs']
    const existing = ctx.assignments.find(a =>
      String(a.job_id) === String(job.id) && a.date === date
      && findCrew(ctx.crew, a.crew_name)?.id === member.id)

    c.op = existing ? 'update' : 'create'
    c.row = {
      id: existing?.id ?? genId('a'),
      job_id: job.id,
      crew_name: who,
      date,
      time_slot: slot,
      notes: r.notes ?? existing?.notes ?? null,
      created_at: existing?.created_at ?? new Date().toISOString(),
    }

    const sameDay = ctx.assignments.filter(a =>
      a.date === date && String(a.job_id) !== String(job.id)
      && crewLabel(ctx.crew, a.crew_name) === who)
    const clash = sameDay.find(a => clashes(
      (['full', 'morning', 'afternoon'] as const).includes(a.time_slot) ? a.time_slot : 'full', slot))
    if (clash) {
      c.warnings.push(`${who} is already on job ${clash.job_id} on ${fmtDate(date)}`
        + `${clash.time_slot && clash.time_slot !== 'full' ? ` (${clash.time_slot})` : ''}`
        + ' — they cannot do both.')
    }
    if (!scheduled.includes(date)) {
      c.warnings.push(`${job.id} is not scheduled to run on ${fmtDate(date)}.`)
    }

    c.summary = `Book ${who} on ${job.id}, ${fmtDate(date)}`
      + (slot === 'full' ? '' : ` (${slot})`)
    c.fields = [
      { label: 'Painter', to: who },
      { label: 'Job', to: `${job.id} — ${job.client ?? ''}` },
      { label: 'Date', to: fmtDate(date) },
      { label: 'Shift', from: existing?.time_slot, to: slot === 'full' ? 'Full day' : slot },
    ]
    return c
  })
}

// ── The small flat ones ─────────────────────────────────────

export function buildTodo(_ctx: WriteContext, r: { text: string; priority?: string }): Change {
  const c = base('np_todos', 'create')
  const text = String(r.text ?? '').trim()
  if (!text) c.errors.push('What is the task?')
  const priority = ['High', 'Normal', 'Low'].includes(r.priority ?? '') ? r.priority! : 'Normal'
  c.row = { id: genId('t'), todo_text: text, done: false, priority, created_at: new Date().toISOString() }
  c.summary = `Add to-do — ${text}`
  c.fields = [{ label: 'Task', to: text }, { label: 'Priority', to: priority }]
  return c
}

export function buildEnquiry(
  _ctx: WriteContext,
  r: { client: string; phone?: string; email?: string; source?: string; job_type?: string; notes?: string; date?: string },
): Change {
  const c = base('np_enquiries', 'create')
  const client = String(r.client ?? '').trim()
  if (!client) c.errors.push('Who is the enquiry from?')
  const { date, error } = dateOr(r.date)
  if (error) c.errors.push(error)
  c.row = {
    id: genId('enq'), date, client,
    phone: r.phone ?? null, email: r.email ?? null,
    source: r.source ?? null, job_type: r.job_type ?? null,
    notes: r.notes ?? null, enq_status: 'New',
    created_at: new Date().toISOString(),
  }
  c.summary = `Add enquiry from ${client}`
  c.fields = [
    { label: 'Client', to: client },
    { label: 'Date', to: fmtDate(date) },
    ...(r.source ? [{ label: 'Source', to: r.source }] : []),
    ...(r.phone ? [{ label: 'Phone', to: r.phone }] : []),
    { label: 'Status', to: 'New' },
  ]
  return c
}

export function buildVariation(
  ctx: WriteContext,
  r: { job_id: string; description: string; amount_ex_gst: number; approved?: boolean; date?: string },
): Change {
  const c = base('np_variations', 'create')
  const job = jobOf(ctx, r.job_id)
  const ex = num(r.amount_ex_gst)
  const desc = String(r.description ?? '').trim()
  const { date, error } = dateOr(r.date)
  if (!job) c.errors.push(`No job ${r.job_id}.`)
  if (!desc) c.errors.push('What is the variation for?')
  if (error) c.errors.push(error)
  // Only Approved variations count toward billing, so defaulting to Approved
  // would quietly change what a job is owed.
  const status = r.approved ? 'Approved' : 'Pending'
  c.row = {
    id: genId('var'), job_id: job?.id ?? null, date,
    var_desc: desc, amount_ex_gst: ex, var_status: status,
    created_at: new Date().toISOString(),
  }
  if (status === 'Pending') {
    c.warnings.push('Logged as Pending, so it does not count toward what the job is owed yet.')
  }
  c.summary = `Add ${money(ex)} variation on ${r.job_id} — ${desc}`
  c.fields = [
    { label: 'Job', to: job ? `${job.id} — ${job.client ?? ''}` : String(r.job_id) },
    { label: 'What', to: desc },
    { label: 'Amount ex GST', to: money(ex) },
    { label: 'Status', to: status },
  ]
  return c
}

export function buildCalendarEvent(
  _ctx: WriteContext,
  r: { title: string; date: string; event_type?: string; time?: string; notes?: string },
): Change {
  const c = base('np_calendar_events', 'create')
  const title = String(r.title ?? '').trim()
  if (!title) c.errors.push('What is the event?')
  const { date, error } = dateOr(r.date)
  if (error) c.errors.push(error)
  const TYPES = ['Quote Visit', 'Client Meeting', 'Builder Meeting', 'Follow Up', 'Site Visit', 'Other']
  const type = TYPES.includes(r.event_type ?? '') ? r.event_type! : 'Other'
  c.row = {
    id: genId('ev'), date, title, color: type,
    time: r.time ?? null, notes: r.notes ?? null,
    created_at: new Date().toISOString(),
  }
  c.summary = `Add ${type.toLowerCase()} — ${title} on ${fmtDate(date)}`
  c.fields = [
    { label: 'What', to: title },
    { label: 'Type', to: type },
    { label: 'Date', to: fmtDate(date) },
    ...(r.time ? [{ label: 'Time', to: r.time }] : []),
  ]
  return c
}
