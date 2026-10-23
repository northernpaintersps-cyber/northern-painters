// Which jobs the calendar shows, and on which days.
//
// A job does not stop having happened when it is marked done. Marking one
// Finished used to empty every day the crew spent on it, which is the
// opposite of what a diary is for: you look back at a week to see where
// everyone was, and a month with its finished work deleted answers nothing.
//
// So finished work stays, with one restriction. Only its days up to today
// are kept — a finished job with dates still ahead of it is a leftover from
// the schedule rather than a plan, and leaving those in front of the crew
// would put phantom work on the board.
//
// Pure — no hooks, no Supabase.

import { getJobScheduledDates } from './utils'

type Row = Record<string, any>

/** Work that is coming or under way. */
export const CONFIRMED_STATUSES = [
  'Not Started', 'Scheduled', 'In Progress', 'Hourly Rate Accepted', 'Booked',
] as const

/** Work that is over. Kept on the calendar, in the past only. */
export const DONE_STATUSES = ['Finished', 'Closed'] as const

const has = (list: readonly string[], status: unknown) =>
  list.includes(String(status ?? '').trim() as any)

export const isDoneJob = (job: Row) => has(DONE_STATUSES, job?.status)
export const isLiveJob = (job: Row) => has(CONFIRMED_STATUSES, job?.status)

/** On the calendar at all — live, or finished and therefore history. */
export const onCalendar = (job: Row) => isLiveJob(job) || isDoneJob(job)

/**
 * The days this job occupies on the calendar.
 *
 * Empty for a job that does not belong there at all, so a caller can map
 * over every job without filtering first.
 */
export function calendarDates(job: Row, todayStr: string, workWeekends = false): string[] {
  if (!onCalendar(job)) return []
  const dates = getJobScheduledDates(job, workWeekends)
  // Today counts as past: a job finished this afternoon still happened today.
  return isDoneJob(job) ? dates.filter(d => d <= todayStr) : dates
}
