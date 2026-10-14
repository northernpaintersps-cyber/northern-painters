// The write tools, and the confirmation they wait on.
//
// A write tool does not write. It builds a Change, hands it to the screen, and
// awaits your decision — `run` returns a promise the card resolves. The agent
// loop is already async, so this needs nothing from it.
//
// That shape is what keeps the conversation honest: the assistant says "added"
// only once the row is real, and "left it then" when you cancel, because the
// tool result tells it which happened. A cancel is a decision, not an error.

import type { AgentTool } from '@/lib/agent'
import {
  buildLabour, buildReschedule, buildJobStatus, buildMaterial, buildExpense,
  buildBookings, buildTodo, buildEnquiry, buildVariation, buildCalendarEvent,
  hasErrors, type Change, type WriteContext,
} from '@/lib/writes'

export type Decision = 'confirmed' | 'declined' | 'timeout'

export interface ProposeResult {
  decision: Decision
  /** Set when the write itself failed after you confirmed it. */
  error?: string
}

/** Shows the card and resolves once you decide. Supplied by the screen. */
export type Propose = (c: Change) => Promise<ProposeResult>

export interface WriteToolContext {
  propose: Propose
  /** The rows the builders need, loaded once for the turn. */
  rows: () => Promise<WriteContext>
}

/**
 * Offer a batch, one card at a time, and report back per change.
 *
 * A change with errors is never offered: the message goes straight back so the
 * model can correct itself and try again, which is cheaper and less confusing
 * than showing you a card that cannot be confirmed.
 */
async function offer(ctx: WriteToolContext, changes: Change[]): Promise<unknown> {
  const bad = changes.filter(hasErrors)
  if (bad.length) {
    throw new Error(bad.flatMap(c => c.errors).join(' '))
  }

  const results: Array<Record<string, unknown>> = []
  for (const c of changes) {
    const { decision, error } = await ctx.propose(c)
    results.push({
      change: c.summary,
      outcome: error ? 'failed' : decision,
      ...(error ? { error } : {}),
      ...(c.warnings.length ? { warnings_shown: c.warnings } : {}),
    })
    // If they said no to the first of several days, do not keep asking.
    if (decision === 'declined' || decision === 'timeout') {
      const left = changes.length - results.length
      if (left > 0) results.push({ change: `${left} further change(s)`, outcome: 'not offered' })
      break
    }
  }

  const done = results.filter(r => r.outcome === 'confirmed').length
  return {
    saved: done,
    of: changes.length,
    results,
    note: done === 0
      ? 'Nothing was written. Say what to change if you want it adjusted.'
      : 'Saved. The screens are already showing it.',
  }
}

/** Reads better in a tool description than repeating it ten times. */
const CONFIRMS = ' Proposes the change and waits for the owner to confirm it; nothing is '
  + 'written unless they do.'

export function buildWriteTools(ctx: WriteToolContext): AgentTool[] {
  const one = (fn: (w: WriteContext, i: any) => Change) =>
    async (i: any) => offer(ctx, [fn(await ctx.rows(), i)])

  const describe = (verb: string) => (_i: any, out: any) =>
    out?.saved ? `${verb} — saved` : `${verb} — not saved`

  const jobId = { type: 'string', description: 'The job number, e.g. 7142.' }
  const dateProp = { type: 'string', description: 'YYYY-MM-DD. Omit for today.' }

  return [
    {
      name: 'log_labour',
      description: 'Record hours worked.' + CONFIRMS
        + ' Give only what you were told: the rates, cost and billable figures are worked '
        + 'out from the crew record and the job.',
      input_schema: {
        type: 'object', additionalProperties: false, required: ['worker', 'hours'],
        properties: {
          worker: { type: 'string', description: 'The painter\'s name as it appears on the crew list.' },
          hours: { type: 'number' },
          job_id: jobId,
          date: dateProp,
          rate: { type: 'number', description: 'Only if the owner stated a different cost rate.' },
          charge_rate: { type: 'number', description: 'Only if the owner stated one.' },
          description: { type: 'string', description: 'What was done.' },
          phase: {
            type: 'string',
            description: 'The phase of the job, if they said one — "second coat", "prep". '
              + 'Matched against the job\'s quoted phases. Worth asking for when it is '
              + 'not obvious, because it is what turns the hours into a usable rate.',
          },
        },
      },
      run: one(buildLabour),
      describe: describe('log labour'),
    },

    {
      name: 'reschedule_job',
      description: 'Move a job or change how many days it runs. Writes the day list, the '
        + 'start and the day count together, so the calendar and the Jobs page agree.' + CONFIRMS,
      input_schema: {
        type: 'object', additionalProperties: false, required: ['job_id'],
        properties: {
          job_id: jobId,
          start: { type: 'string', description: 'A new start date, YYYY-MM-DD.' },
          days: { type: 'number', description: 'How many working days it runs.' },
          dates: {
            type: 'array', items: { type: 'string' },
            description: 'Exact days, when they are not consecutive. Overrides start and days.',
          },
        },
      },
      run: one(buildReschedule),
      describe: describe('reschedule'),
    },

    {
      name: 'set_job_status',
      description: 'Change a job\'s status or its quote status.' + CONFIRMS,
      input_schema: {
        type: 'object', additionalProperties: false, required: ['job_id'],
        properties: {
          job_id: jobId,
          status: { type: 'string', description: 'The job status, e.g. In Progress, Finished.' },
          quote_status: { type: 'string', description: 'The quote status, e.g. Sent, Accepted, Booked.' },
        },
      },
      run: one(buildJobStatus),
      describe: describe('set status'),
    },

    {
      name: 'log_material',
      description: 'Record paint or materials bought. GST is worked out unless the owner '
        + 'reads a different figure off the docket.' + CONFIRMS,
      input_schema: {
        type: 'object', additionalProperties: false, required: ['supplier', 'cost_ex_gst'],
        properties: {
          supplier: { type: 'string' },
          cost_ex_gst: { type: 'number' },
          job_id: jobId,
          date: dateProp,
          receipt_no: { type: 'string', description: 'The supplier\'s invoice or docket number.' },
          description: { type: 'string', description: 'What was bought.' },
          gst: { type: 'number', description: 'Only when the docket disagrees with ten percent.' },
        },
      },
      run: one(buildMaterial),
      describe: describe('log material'),
    },

    {
      name: 'log_expense',
      description: 'Record a business cost that is not against a job.' + CONFIRMS,
      input_schema: {
        type: 'object', additionalProperties: false, required: ['description', 'amount_ex_gst'],
        properties: {
          description: { type: 'string' },
          amount_ex_gst: { type: 'number' },
          category: { type: 'string' },
          date: dateProp,
          gst_applies: { type: 'boolean', description: 'False for something with no GST on it.' },
        },
      },
      run: one(buildExpense),
      describe: describe('log expense'),
    },

    {
      name: 'book_crew',
      description: 'Put a painter on a job for a day, or several days. One card per day, '
        + 'and a clash with another job that day is shown on it.' + CONFIRMS,
      input_schema: {
        type: 'object', additionalProperties: false, required: ['job_id', 'worker'],
        properties: {
          job_id: jobId,
          worker: { type: 'string' },
          date: dateProp,
          dates: { type: 'array', items: { type: 'string' }, description: 'For several days.' },
          slot: {
            type: 'string', enum: ['full', 'morning', 'afternoon'],
            description: 'Defaults to a full day.',
          },
        },
      },
      run: async (i: any) => offer(ctx, buildBookings(await ctx.rows(), i)),
      describe: describe('book crew'),
    },

    {
      name: 'add_variation',
      description: 'Record extra work agreed after the quote. Logged as Pending unless the '
        + 'owner says the client has approved it, because only Approved variations change '
        + 'what a job is owed.' + CONFIRMS,
      input_schema: {
        type: 'object', additionalProperties: false,
        required: ['job_id', 'description', 'amount_ex_gst'],
        properties: {
          job_id: jobId,
          description: { type: 'string' },
          amount_ex_gst: { type: 'number' },
          approved: { type: 'boolean' },
          date: dateProp,
        },
      },
      run: one(buildVariation),
      describe: describe('add variation'),
    },

    {
      name: 'add_calendar_event',
      description: 'Put a quote visit, meeting or other entry in the diary.' + CONFIRMS,
      input_schema: {
        type: 'object', additionalProperties: false, required: ['title', 'date'],
        properties: {
          title: { type: 'string' },
          date: { type: 'string', description: 'YYYY-MM-DD.' },
          event_type: {
            type: 'string',
            enum: ['Quote Visit', 'Client Meeting', 'Builder Meeting', 'Follow Up', 'Site Visit', 'Other'],
          },
          time: { type: 'string', description: 'HH:MM.' },
          notes: { type: 'string' },
        },
      },
      run: one(buildCalendarEvent),
      describe: describe('add event'),
    },

    {
      name: 'add_enquiry',
      description: 'Record a new lead.' + CONFIRMS,
      input_schema: {
        type: 'object', additionalProperties: false, required: ['client'],
        properties: {
          client: { type: 'string' },
          phone: { type: 'string' },
          email: { type: 'string' },
          source: { type: 'string', description: 'Where it came from.' },
          job_type: { type: 'string' },
          notes: { type: 'string' },
        },
      },
      run: one(buildEnquiry),
      describe: describe('add enquiry'),
    },

    {
      name: 'add_todo',
      description: 'Add something to the task list.' + CONFIRMS,
      input_schema: {
        type: 'object', additionalProperties: false, required: ['text'],
        properties: {
          text: { type: 'string' },
          priority: { type: 'string', enum: ['High', 'Normal', 'Low'] },
        },
      },
      run: one(buildTodo),
      describe: describe('add to-do'),
    },
  ]
}

/** Added to the system prompt when the write tools are available. */
export const WRITE_PROMPT = `
WHEN YOU CHANGE SOMETHING
You can record hours, materials, expenses, variations, diary entries, enquiries, to-dos, crew bookings, a job's status and a job's schedule. Everything else is still read-only, and you cannot delete.

Nothing you propose is written until the owner confirms it on screen. So propose it, do not ask first — a card they can read and tap is better than a question they have to answer twice. Afterwards the tool tells you whether it was saved, declined, or left unanswered; say what actually happened and never claim a change that came back declined.

Pass on only what you were told. Rates, GST, costs, billable amounts, ids and day lists are all worked out from the job and the crew record, and a figure you invent for one of them is worse than leaving it out.

Where you are missing something the change needs — which job, which painter, which day — ask the one question rather than guessing. A wrong job number is the easiest way to put hours on someone else's work.

If a card comes back with a warning on it and they confirm anyway, that is their call. Do not argue it a second time.
`
