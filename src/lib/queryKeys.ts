import type { QueryClient } from '@tanstack/react-query'

// Several pages read the same table under different query keys: a whole-table
// list, a per-job slice (`<table>_job`), and the Reports page's own short keys.
// A mutation that invalidates only its own key leaves the others serving rows
// that no longer exist — a deleted invoice kept appearing on the job's Billing
// tab, which reads `np_invoices_job`.
//
// One map, used by every mutation and by the realtime subscription, so a write
// to a table refreshes every view of it.
export const TABLE_QUERY_KEYS: Record<string, string[]> = {
  np_jobs:            ['np_jobs', 'jobs', 'np_jobs_mat', 'rep_jobs'],
  np_invoices:        ['np_invoices', 'np_invoices_job', 'rep_inv'],
  np_labour:          ['np_labour', 'np_labour_job', 'rep_lab'],
  np_materials:       ['np_materials', 'np_materials_job', 'rep_mat'],
  np_variations:      ['np_variations'],
  np_pay_schedules:   ['np_pay_schedules', 'np_pay_schedule_job'],
  np_expenses:        ['np_expenses', 'rep_exp'],
  np_assignments:     ['np_assignments', 'rep_asg'],
  np_enquiries:       ['np_enquiries', 'rep_enq'],
  np_ads_spend:       ['np_ads_spend', 'rep_ads'],
}

/** Every query key that reads `table`. Unlisted tables use their own name. */
export const keysFor = (table: string): string[] => TABLE_QUERY_KEYS[table] ?? [table]

/** Refresh every cached view of `table` after a write. */
export function invalidateTable(qc: QueryClient, ...tables: string[]) {
  for (const t of tables) for (const k of keysFor(t)) qc.invalidateQueries({ queryKey: [k] })
}
