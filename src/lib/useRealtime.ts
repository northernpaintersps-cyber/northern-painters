import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import { useAuth } from './auth'
import { invalidateTable } from './queryKeys'

// Tables watched for changes. Which query keys each one refreshes lives in
// queryKeys.ts, shared with the pages' own mutations.
const TABLES = [
  'np_jobs', 'np_invoices', 'np_labour', 'np_materials', 'np_expenses',
  'np_receipts', 'np_crew', 'np_assignments', 'np_enquiries', 'np_variations',
  'np_todos', 'np_calendar_events', 'np_pay_schedules', 'np_site_visits',
  'np_ads_spend',
]

export function useRealtime() {
  const qc = useQueryClient()
  const { user } = useAuth()

  useEffect(() => {
    if (!user) return

    const channel = supabase.channel('np-realtime')

    TABLES.forEach(table => {
      channel.on(
        'postgres_changes' as any,
        { event: '*', schema: 'public', table },
        () => invalidateTable(qc, table)
      )
    })

    channel.subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [user, qc])
}
