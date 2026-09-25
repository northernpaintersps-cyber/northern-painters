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
