import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !key) throw new Error('Missing Supabase env vars')

export const supabase = createClient<Database>(url, key)

/**
 * Every row of a table, not the first 1000.
 *
 * PostgREST caps an unbounded select at 1000 rows. Any check that has to be
 * sure — "has this invoice already been entered?" — silently stops seeing the
 * oldest records once a table passes that size, because the queries here sort
 * newest first.
 */
export async function fetchAllRows(
  table: string, userId: string,
  opts?: { columns?: string; orderBy?: string; ascending?: boolean },
): Promise<any[]> {
  const page = 1000
  const out: any[] = []
  for (let from = 0; ; from += page) {
    let q = (supabase.from(table as any) as any)
      .select(opts?.columns ?? '*')
      .eq('user_id', userId)
      .range(from, from + page - 1)
    if (opts?.orderBy) q = q.order(opts.orderBy, { ascending: opts.ascending ?? false })
    const { data, error } = await q
    if (error) throw error
    const rows = data ?? []
    out.push(...rows)
    if (rows.length < page) return out
  }
}

/**
 * Drop-in for `supabase.from(t).select('*').eq('user_id', uid)` that is not
 * capped at PostgREST's 1000-row default. Same `{ data, error }` shape, so the
 * calling code does not change.
 */
export async function selectAll(
  table: string, userId: string,
  opts?: { columns?: string; orderBy?: string; ascending?: boolean },
): Promise<{ data: any[] | null; error: any }> {
  try {
    return { data: await fetchAllRows(table, userId, opts), error: null }
  } catch (error) {
    return { data: null, error }
  }
}

/**
 * Postgres rejects the whole statement when one column is missing, so a schema
 * that has drifted behind the app fails the save outright — assigning crew to a
 * job died on `Could not find the 'client' column of 'np_assignments'`.
 *
 * Strip the offending column and retry, so the rest of the row still saves.
 * Returns the names of any columns dropped, for the caller to warn about.
 * Columns are finite and never re-added, so this always terminates.
 */
const MISSING_COL = /Could not find the '([^']+)' column/i

export async function upsertRows(
  table: string, rows: any[], opts?: { onConflict?: string },
): Promise<string[]> {
  if (!rows.length) return []
  const dropped: string[] = []
  for (;;) {
    const { error } = await (supabase.from(table as any) as any)
      .upsert(rows, opts?.onConflict ? { onConflict: opts.onConflict } : undefined)
    if (!error) return dropped
    const missing = error.message?.match(MISSING_COL)?.[1]
    if (!missing || dropped.includes(missing)) throw error
    dropped.push(missing)
    for (const r of rows) delete r[missing]
  }
}
