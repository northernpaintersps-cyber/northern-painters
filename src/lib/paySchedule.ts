// Building a payment schedule.
//
// Moved out of Payments.tsx so the invoice modal can offer a schedule for a
// job that has none without a second copy of what a schedule is. The
// milestone arithmetic is unchanged — same structures, same percentages,
// same dates off the start.
//
// A schedule is a set of promises with dates, which is why nothing here
// creates one on its own: the dates come from a person choosing a start and
// a structure. Generated behind someone's back they are fiction, and they
// drive the overdue alerts.
//
// Pure — no hooks, no Supabase.

import { localDate, genId, type Milestone } from './utils'

type Row = Record<string, any>

export const STRUCTURES = [
  { id: 'df',   label: 'Deposit + Final' },
  { id: 'dpf',  label: 'Deposit + Progress + Final' },
  { id: 'd2pf', label: 'Deposit + 2x Progress + Final' },
  { id: 'wk',   label: 'Weekly claims' },
] as const

export type StructureId = typeof STRUCTURES[number]['id']

// V16 buildMS()
export function buildMS(
  agreed: number, struct: string, dep: number, start: string, gstFree = false,
): Milestone[] {
  // Cash work is not invoiced, so the agreed figure is the whole amount.
  const inc = gstFree ? agreed : agreed * 1.1
  const rem = 100 - dep
  const addD = (d: string, n: number) => {
    if (!d) return ''
    const dt = new Date(d); dt.setDate(dt.getDate() + n)
    return localDate(dt)
  }
  const mk = (label: string, pct: number, dueDate: string): Milestone =>
    ({ label, pct, amount: Math.round((inc * pct) / 100), dueDate, received: false, receivedDate: '',
       ...(gstFree ? { gstFree: true } : {}) })

  if (struct === 'df') return [mk('Deposit', dep, start), mk('Final payment', rem, '')]
  if (struct === 'dpf') return [
    mk('Deposit', dep, start),
    mk('Progress claim 50%', Math.round(rem / 2), addD(start, 7)),
    mk('Final payment', rem - Math.round(rem / 2), ''),
  ]
  if (struct === 'd2pf') return [
    mk('Deposit', dep, start),
    mk('Progress 1 — 33%', Math.round(rem / 3), addD(start, 7)),
    mk('Progress 2 — 66%', Math.round(rem / 3), addD(start, 14)),
    mk('Final payment', rem - 2 * Math.round(rem / 3), ''),
  ]
  return [
    mk('Deposit', dep, start),
    mk('Week 1 claim', Math.round(rem / 3), addD(start, 7)),
    mk('Week 2 claim', Math.round(rem / 3), addD(start, 14)),
    mk('Final payment', rem - 2 * Math.round(rem / 3), ''),
  ]
}

/** Does this job already have a schedule? Its id is the job's. */
export const hasSchedule = (schedules: Row[], jobId: string | null | undefined): boolean =>
  !!jobId && schedules.some(s => String(s.id) === String(jobId))

export const scheduleFor = (schedules: Row[], jobId: string | null | undefined): Row | undefined =>
  jobId ? schedules.find(s => String(s.id) === String(jobId)) : undefined

/**
 * The np_pay_schedules row for a new schedule.
 *
 * The id is the job's id, which is what makes one schedule per job and lets
 * every other screen find it without a join.
 */
export function scheduleRowFor(
  job: Row | undefined | null,
  opts: { value: number; struct: string; depositPct: number; start: string; gstFree?: boolean },
): Row {
  const ms = buildMS(opts.value, opts.struct, opts.depositPct, opts.start, opts.gstFree)
  return {
    id: job?.id || genId('ps'),
    worker: job?.client || 'Unknown',
    amount: opts.value,
    period_start: ms[0]?.dueDate || null,
    period_end: ms[ms.length - 1]?.dueDate || null,
    paid: false,
    notes: JSON.stringify(ms),
    created_at: new Date().toISOString(),
  }
}
