// What the assistant can do.
//
// Read, compute, draft, navigate. No writes — every AI call in this app only
// proposes and you press the button, which is what makes it safe to point a
// model at a client's PDF. A model that can write turns text inside an
// untrusted document into a way to change your data.
//
// Two rules shape all of this:
//
// 1. np_settings is not reachable. It holds your Anthropic key.
// 2. The figures come from the app's own helpers, never re-derived here.
//    computeJobBilling, serviceRates and unbilledSummary already produce the
//    numbers on screen; two sources of truth for margin is how Invoices and
//    Profitability drifted apart before.

import { selectAll } from '@/lib/supabase'
import type { AgentTool } from '@/lib/agent'
import { computeJobBilling, unbilledSummary } from '@/lib/jobBilling'
import { buildJobRates, serviceRates, median } from '@/lib/jobRates'
import { jobExposure, EXPOSURE_SHORT } from '@/lib/exposure'
import { getJobScheduledDates, calcOwed, invStatus, today } from '@/lib/utils'
import { attentionList } from '@/lib/attention'
import { quoteFollowUp, invoiceReminder, bookingConfirmation, MESSAGE_KINDS } from '@/lib/messages'
import { buildWriteTools, WRITE_PROMPT, type Propose } from '@/lib/agentWrites'
import { emptyContext, type WriteContext } from '@/lib/writes'

type Row = Record<string, any>

/**
 * Every table the assistant may read. np_settings is absent on purpose and a
 * test asserts it: the row keyed 'business' holds ai_api_key.
 */
export const READABLE_TABLES = [
  'np_jobs', 'np_invoices', 'np_labour', 'np_materials', 'np_expenses',
  'np_receipts', 'np_variations', 'np_enquiries', 'np_crew', 'np_assignments',
  'np_calendar_events', 'np_site_visits', 'np_todos', 'np_pay_schedules',
  'np_ads_spend', 'np_assets',
] as const

export type ReadableTable = typeof READABLE_TABLES[number]

const TABLE_NOTES: Record<ReadableTable, string> = {
  np_jobs: 'Jobs. id, client, address, type, status, quote_status, quote_ex_gst, agreed_ex_gst, est_labour_ex, est_materials_ex, labour_rate, sched_start, est_days, quote_sent, weather (exposure), scheduled_dates, extra.',
  np_invoices: 'Invoices out to clients. id, job_id, client, date, due_date, total_inc_gst, received, manual_paid, notes, extra (covers_to, billed_labour, billed_materials, booking_deposit).',
  np_labour: 'Hours worked. job_id, date, sub (the worker), hours, rate (cost), charge_rate, cost, billable, billing_type.',
  np_materials: 'Paint and materials bought. job_id, date, supplier, invoice_no, cost_ex_gst, gst, total_inc_gst, billing_type.',
  np_expenses: 'Business costs not tied to a job. date, category, amount, notes.',
  np_receipts: 'Money received, including cash.',
  np_assets: 'Machinery, tools and vehicles owned by the business. name, category, purchase_date, cost_ex_gst, method (immediate, prime_cost, diminishing, none), effective_life_yr, business_use_pct, disposal_date. Depreciation is worked out from these, not stored.',
  np_variations: 'Extra work agreed after the quote. job_id, amount_ex_gst, var_status (Approved matters).',
  np_enquiries: 'Leads before they become jobs. client, source, job_type, enq_status (New, Replied, Waiting for Answer, Visit Scheduled, Quote Sent, Won, Lost, No Response).',
  np_crew: 'The painters. id, name, rate, charge_rate, phone.',
  np_assignments: 'Who is on which job on which day. job_id, crew_name, date, time_slot (full, morning, afternoon).',
  np_calendar_events: 'Diary entries that are not jobs. date, title, color (the event type), notes.',
  np_site_visits: 'Site visits, with photos and per-photo notes in the photos column.',
  np_todos: 'Your own task list. priority, done.',
  np_pay_schedules: 'Progress payment schedules for crew and subbies.',
  np_ads_spend: 'Advertising spend.',
}

export interface ToolContext {
  userId: string
  /** The business settings, for bank details on a draft. Never the API key. */
  biz?: Row | null
  /** Called when the model asks to open a record. The UI decides what to do. */
  onOpen?: (route: string, label: string) => void
  /** Called with a drafted message, for the clipboard. */
  onDraft?: (text: string, label: string) => void
  /**
   * Row access. Defaults to Supabase, scoped by RLS. Overridden in tests so
   * the arithmetic in these tools can be checked against known rows — which
   * is the only part of this file that can be wrong quietly.
   */
  load?: (table: string) => Promise<Row[]>
  /**
   * Shows a proposed change and resolves once the owner decides. Supplying it
   * is what turns the write tools on; without it the assistant is read-only,
   * which is how it behaves in tests and anywhere the screen cannot ask.
   */
  propose?: Propose
}

// ── Row access, cached for the turn ─────────────────────────
// A five-step answer must not fetch np_jobs five times.

export function makeLoader(userId: string) {
  const cache = new Map<string, Promise<Row[]>>()
  return (table: string): Promise<Row[]> => {
    if (!READABLE_TABLES.includes(table as ReadableTable)) {
      // The enum should stop this, but a model can send anything and this is
      // the boundary that actually matters.
      return Promise.reject(new Error(
        `${table} is not readable. Available: ${READABLE_TABLES.join(', ')}`))
    }
    let p = cache.get(table)
    if (!p) {
      p = selectAll(table, userId).then(r => {
        if (r.error) throw new Error(`Could not read ${table}: ${r.error.message ?? r.error}`)
        return r.data ?? []
      })
      cache.set(table, p)
    }
    return p
  }
}

// ── Filtering ───────────────────────────────────────────────

export type Op = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'empty' | 'not_empty'
export interface Filter { column: string; op: Op; value?: string | number }

const str = (v: unknown) => (v == null ? '' : String(v))

export function matches(row: Row, f: Filter): boolean {
  const cell = row[f.column]
  switch (f.op) {
    case 'empty': return cell == null || cell === ''
    case 'not_empty': return cell != null && cell !== ''
    case 'contains': return str(cell).toLowerCase().includes(str(f.value).toLowerCase())
    case 'ne': return str(cell) !== str(f.value)
    case 'eq': return str(cell) === str(f.value)
    default: {
      // Numeric where both sides look numeric, lexical otherwise, so the same
      // operators work on dates (YYYY-MM-DD sorts correctly as text).
      const a = Number(cell), b = Number(f.value)
      const numeric = cell !== '' && cell != null && Number.isFinite(a) && Number.isFinite(b)
      const [x, y]: [any, any] = numeric ? [a, b] : [str(cell), str(f.value)]
      if (f.op === 'gt') return x > y
      if (f.op === 'gte') return x >= y
      if (f.op === 'lt') return x < y
      return x <= y
    }
  }
}

export const applyFilters = (rows: Row[], filters?: Filter[]): Row[] =>
  (filters?.length ? rows.filter(r => filters.every(f => matches(r, f))) : rows)

const pick = (row: Row, columns?: string[]): Row =>
  (columns?.length
    ? Object.fromEntries(columns.filter(c => c in row).map(c => [c, row[c]]))
    : row)

const FILTER_SCHEMA = {
  type: 'array',
  description: 'All must match. Dates are YYYY-MM-DD and compare correctly with gt/lt.',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['column', 'op'],
    properties: {
      column: { type: 'string' },
      op: { type: 'string', enum: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'empty', 'not_empty'] },
      value: { type: ['string', 'number'], description: 'Omit for empty / not_empty.' },
    },
  },
}

// ── The tools ───────────────────────────────────────────────

export function buildTools(ctx: ToolContext): AgentTool[] {
  const load = ctx.load ?? makeLoader(ctx.userId)
  const jobOf = async (jobId: string) => {
    const jobs = await load('np_jobs')
    const job = jobs.find(j => String(j.id) === String(jobId))
    if (!job) throw new Error(`No job ${jobId}. Use query_table on np_jobs to find the right id.`)
    return job
  }

  const tools: AgentTool[] = [
    {
      name: 'query_table',
      description: 'Read rows from one table. Returns the rows and how many matched before any limit.',
      input_schema: {
        type: 'object',
        additionalProperties: false,
        required: ['table'],
        properties: {
          table: { type: 'string', enum: [...READABLE_TABLES] },
          filters: FILTER_SCHEMA,
          columns: {
            type: 'array', items: { type: 'string' },
            description: 'Only these columns. Use it — whole rows are large.',
          },
          order_by: { type: 'string' },
          descending: { type: 'boolean' },
          limit: { type: 'number', description: 'Default 50, maximum 500.' },
        },
      },
      run: async (i: any) => {
        const rows = applyFilters(await load(i.table), i.filters)
        const sorted = i.order_by
          ? [...rows].sort((a, b) => {
              const x = a[i.order_by], y = b[i.order_by]
              const n = Number(x) - Number(y)
              const cmp = Number.isFinite(n) ? n : str(x).localeCompare(str(y))
              return i.descending ? -cmp : cmp
            })
          : rows
        const limit = Math.min(Math.max(Number(i.limit) || 50, 1), 500)
        return {
          matched: sorted.length,
          returned: Math.min(sorted.length, limit),
          rows: sorted.slice(0, limit).map(r => pick(r, i.columns)),
        }
      },
      describe: (i, out: any) => `${i.table} · ${out.returned} of ${out.matched} rows`,
    },

    {
      name: 'aggregate',
      description: 'Sum, average, count or median a column, optionally grouped. '
        + 'Use this for every total — never add the numbers up yourself.',
      input_schema: {
        type: 'object',
        additionalProperties: false,
        required: ['table', 'metric'],
        properties: {
          table: { type: 'string', enum: [...READABLE_TABLES] },
          metric: { type: 'string', enum: ['sum', 'avg', 'count', 'median', 'min', 'max'] },
          column: { type: 'string', description: 'Required for everything but count.' },
          group_by: { type: 'string' },
          filters: FILTER_SCHEMA,
        },
      },
      run: async (i: any) => {
        const rows = applyFilters(await load(i.table), i.filters)
        if (i.metric !== 'count' && !i.column) throw new Error('column is required for ' + i.metric)

        const calc = (group: Row[]) => {
          if (i.metric === 'count') return group.length
          const nums = group.map(r => Number(r[i.column])).filter(Number.isFinite)
          if (!nums.length) return null
          switch (i.metric) {
            case 'sum': return Math.round(nums.reduce((a, b) => a + b, 0) * 100) / 100
            case 'avg': return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100
            case 'median': return median(nums)
            case 'min': return Math.min(...nums)
            default: return Math.max(...nums)
          }
        }

        if (!i.group_by) return { rows: rows.length, value: calc(rows) }
        const groups = new Map<string, Row[]>()
        for (const r of rows) {
          const k = str(r[i.group_by]) || '(blank)'
          const g = groups.get(k)
          if (g) g.push(r); else groups.set(k, [r])
        }
        return {
          rows: rows.length,
          groups: [...groups].map(([key, g]) => ({ key, rows: g.length, value: calc(g) }))
            .sort((a, b) => Number(b.value ?? 0) - Number(a.value ?? 0)),
        }
      },
      describe: (i, out: any) =>
        `${i.metric}(${i.column ?? '*'}) on ${i.table} · ${out.rows} rows`
        + (out.groups ? ` · ${out.groups.length} groups` : ` = ${out.value}`),
    },

    {
      name: 'job_detail',
      description: 'Everything about one job: its billing position, what is unbilled, '
        + 'its schedule, crew and weather exposure. The same figures the job screen shows.',
      input_schema: {
        type: 'object', additionalProperties: false, required: ['job_id'],
        properties: { job_id: { type: 'string' } },
      },
      run: async (i: any) => {
        const job = await jobOf(i.job_id)
        const [invoices, labour, materials, variations, schedules, assignments] = await Promise.all([
          load('np_invoices'), load('np_labour'), load('np_materials'),
          load('np_variations'), load('np_pay_schedules'), load('np_assignments'),
        ])
        const mine = (rows: Row[]) => rows.filter(r => String(r.job_id) === String(job.id))
        const b = computeJobBilling({
          job,
          invoices: mine(invoices),
          labour: mine(labour),
          materials: mine(materials),
          variations: mine(variations),
          paySchedule: schedules.find(s => String(s.job_id) === String(job.id)),
          markupPct: Number(ctx.biz?.default_markup_pct) || 0,
        })
        return {
          job: {
            id: job.id, client: job.client, address: job.address, type: job.type,
            status: job.status, quote_status: job.quote_status,
            agreed_ex_gst: job.agreed_ex_gst, quote_ex_gst: job.quote_ex_gst,
            est_labour_ex: job.est_labour_ex, est_materials_ex: job.est_materials_ex,
            sched_start: job.sched_start, est_days: job.est_days,
          },
          exposure: EXPOSURE_SHORT[jobExposure(job)],
          scheduled_dates: getJobScheduledDates(job),
          crew: mine(assignments).map(a => ({ date: a.date, who: a.crew_name, slot: a.time_slot })),
          billing: {
            basis: b.basis,
            billable_to_date_inc_gst: b.billableToDateIncGST,
            invoiced_inc_gst: b.invoicedIncGST,
            received_inc_gst: b.receivedIncGST,
            owed_inc_gst: b.owedIncGST,
            left_to_invoice_inc_gst: b.leftToInvoiceIncGST,
            over_billed_inc_gst: b.overBilledIncGST,
            invoiced_up_to: b.invoicedUpTo,
            unbilled: unbilledSummary(b) || 'nothing outstanding',
          },
          real_cost_ex_gst: {
            labour: Math.round(mine(labour).reduce((s, l) =>
              s + (l.cost ?? (l.hours || 0) * (l.rate || 0)), 0) * 100) / 100,
            materials: Math.round(mine(materials).reduce((s, m) =>
              s + (m.cost_ex_gst || 0), 0) * 100) / 100,
            hours: Math.round(mine(labour).reduce((s, l) => s + (l.hours || 0), 0) * 10) / 10,
          },
        }
      },
      describe: i => `job ${i.job_id}`,
    },

    {
      name: 'needs_attention',
      description: 'Overdue invoices, overdue scheduled payments, quotes due a chase, '
        + 'jobs starting with no crew, and new enquiries — worst first, by money '
        + 'then by lateness.',
      input_schema: { type: 'object', additionalProperties: false, properties: {} },
      run: async () => {
        const [jobs, invoices, enquiries, assignments, schedules] = await Promise.all([
          load('np_jobs'), load('np_invoices'), load('np_enquiries'), load('np_assignments'),
          load('np_pay_schedules'),
        ])
        return {
          today: today(),
          items: attentionList({ jobs, invoices, enquiries, assignments, schedules }),
        }
      },
      describe: (_i, out: any) => `${out.items.length} things wanting attention`,
    },

    {
      name: 'rates',
      description: 'What your own finished jobs cost per square metre and per hour, '
        + 'by service. Medians, from jobs that have both a recorded takeoff and logged costs.',
      input_schema: {
        type: 'object', additionalProperties: false,
        properties: { service: { type: 'string', description: 'A job type. Omit for all.' } },
      },
      run: async (i: any) => {
        const [jobs, labour, materials, variations] = await Promise.all([
          load('np_jobs'), load('np_labour'), load('np_materials'), load('np_variations'),
        ])
        const all = serviceRates(buildJobRates({ jobs, labour, materials, variations }))
        const rows = i.service ? all.filter(r => r.type === i.service) : all
        return {
          services: rows,
          note: 'Blended per job: a labour entry records hours against the job, not the '
            + 'surface, so these cannot be split between ceilings and walls.',
        }
      },
      describe: (_i, out: any) => `rates for ${out.services.length} services`,
    },

    {
      name: 'outstanding_money',
      description: 'Every invoice with money owed, with how many days past due it is.',
      input_schema: {
        type: 'object', additionalProperties: false,
        properties: { min_days_overdue: { type: 'number' } },
      },
      run: async (i: any) => {
        const invoices = await load('np_invoices')
        const t = today()
        const rows = invoices
          .filter(inv => calcOwed(inv) > 0)
          .map(inv => ({
            id: inv.id, job_id: inv.job_id, client: inv.client, date: inv.date,
            due_date: inv.due_date, status: invStatus(inv),
            owed_inc_gst: calcOwed(inv),
            days_overdue: inv.due_date
              ? Math.floor((Date.parse(`${t}T00:00:00`) - Date.parse(`${inv.due_date}T00:00:00`)) / 864e5)
              : null,
          }))
          .filter(r => i.min_days_overdue == null || (r.days_overdue ?? -1) >= i.min_days_overdue)
          .sort((a, b) => (b.days_overdue ?? 0) - (a.days_overdue ?? 0))
        return {
          total_owed_inc_gst: Math.round(rows.reduce((s, r) => s + r.owed_inc_gst, 0) * 100) / 100,
          invoices: rows,
        }
      },
      describe: (_i, out: any) => `${out.invoices.length} unpaid · ${out.total_owed_inc_gst} owed`,
    },

    {
      name: 'draft_message',
      description: 'Draft a message in the business\'s own wording and put it on the clipboard. '
        + 'It is not sent — the app has no outbound channel.',
      input_schema: {
        type: 'object', additionalProperties: false, required: ['kind'],
        properties: {
          kind: { type: 'string', enum: [...MESSAGE_KINDS] },
          job_id: { type: 'string', description: 'For a quote chase or a booking confirmation.' },
          invoice_id: { type: 'string', description: 'For an invoice reminder.' },
          date: { type: 'string', description: 'For a booking confirmation.' },
        },
      },
      run: async (i: any) => {
        let text = ''
        let label = i.kind
        if (i.kind === 'invoice_reminder') {
          const inv = (await load('np_invoices')).find(x => String(x.id) === String(i.invoice_id))
          if (!inv) throw new Error(`No invoice ${i.invoice_id}.`)
          text = invoiceReminder(inv, calcOwed(inv), ctx.biz)
          label = `reminder for invoice ${inv.id}`
        } else {
          const job = await jobOf(i.job_id)
          if (i.kind === 'quote_follow_up') {
            text = quoteFollowUp(job)
            label = `quote chase for ${job.id}`
          } else {
            const date = i.date || getJobScheduledDates(job)[0] || job.sched_start
            if (!date) throw new Error(`Job ${job.id} has no start date — give one.`)
            text = bookingConfirmation(job, date)
            label = `booking confirmation for ${job.id}`
          }
        }
        ctx.onDraft?.(text, label)
        return { drafted: label, text, note: 'Copied to the clipboard. Nothing was sent.' }
      },
      describe: (_i, out: any) => `drafted a ${out.drafted}`,
    },

    {
      name: 'open_record',
      description: 'Open a screen in the app for the user. Use it when they should look at '
        + 'something, not instead of answering.',
      input_schema: {
        type: 'object', additionalProperties: false, required: ['page'],
        properties: {
          page: {
            type: 'string',
            enum: ['jobs', 'invoices', 'quotes', 'crew', 'calendar', 'enquiries', 'costs',
                   'materials', 'labour', 'payments', 'rates', 'visits', 'profitability'],
          },
          why: { type: 'string', description: 'One short line for the button.' },
        },
      },
      run: (i: any) => {
        const route = `/${i.page}`
        ctx.onOpen?.(route, i.why || `Open ${i.page}`)
        return { opened: route }
      },
      describe: (i: any) => `offered to open ${i.page}`,
    },
  ]

  if (ctx.propose) {
    // One load for the whole turn, through the same cache the read tools use.
    const rows = async (): Promise<WriteContext> => {
      const [jobs, crew, labour, materials, assignments, receipts] = await Promise.all([
        load('np_jobs'), load('np_crew'), load('np_labour'),
        load('np_materials'), load('np_assignments'), load('np_receipts'),
      ])
      return { ...emptyContext(), jobs, crew, labour, materials, assignments, receipts, biz: ctx.biz }
    }
    tools.push(...buildWriteTools({ propose: ctx.propose, rows }))
  }

  return tools
}

// ── The system prompt ───────────────────────────────────────

/** Built from the table list, so it cannot drift from what is readable. */
export function systemPrompt(biz?: Row | null, canWrite = false): string {
  return `You are the assistant inside a painting business's own management app. The owner is a working painter in the Northern Rivers, New South Wales${biz?.company_name ? `, trading as ${biz.company_name}` : ''}. You are talking to them, not to their clients.

You have tools that read their live data. Use them. You know nothing about this business except what a tool returns.

THE TABLES
${READABLE_TABLES.map(t => `- ${t} — ${TABLE_NOTES[t]}`).join('\n')}

NEVER DO ARITHMETIC
Every number you state must have come back from a tool. Use aggregate for totals, averages, counts and medians, however simple the sum looks. Do not add up rows from query_table and report the result — you will occasionally be wrong, it will look exactly as confident as when you are right, and they will price work on it.

If a figure needs working out in a way no tool offers, say what you can get and what you cannot, rather than estimating it.

PREFER THE PURPOSE-BUILT TOOL
job_detail, needs_attention, rates and outstanding_money return the same figures the screens show, because they call the same code. Working the same thing out from query_table risks a different answer to the one on screen, which is worse than useless. Reach for query_table for things those tools do not cover.

CONVENTIONS
Amounts are ex GST unless the field name says inc_gst. GST is 10%. Dates are YYYY-MM-DD in the data; write them as dd/mm/yyyy. Today is ${today()}.
A job's id is its number, like 7142. Name the ids behind any claim so they can be checked.
Quantities: m2 for areas, lineal metres for runs, and a count for things like doors and windows.

WHAT YOU CANNOT DO
You cannot delete anything, and you cannot touch invoices, receipts, quotes or site visits. You cannot send a message; draft_message puts wording on the clipboard and they send it themselves. You cannot run in the background: you only exist while this screen is open.

If asked to do one of those, say so plainly in a line and offer what you can do instead.{WRITES}

HOW TO ANSWER
Lead with the answer. Short paragraphs, and a small markdown table when you are comparing more than about three things. No preamble, no restating the question.

Say when the data is thin. "Three finished jobs" is an anecdote, not a rate, and you should name that rather than let a median off three jobs sound like a fact. If a tool comes back empty, say it came back empty — do not fill the gap.`
    .replace('{WRITES}', canWrite ? `
${WRITE_PROMPT}` : '')
}
