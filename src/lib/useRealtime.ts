import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import { useAuth } from './auth'

// Tables and the React Query keys they invalidate
const TABLE_KEYS: [string, string][] = [
  ['np_jobs',            'np_jobs'],
  ['np_invoices',        'np_invoices'],
  ['np_labour',          'np_labour'],
  ['np_materials',       'np_materials'],
  ['np_expenses',        'np_expenses'],
  ['np_receipts',        'np_receipts'],
  ['np_crew',            'np_crew'],
  ['np_assignments',     'np_assignments'],
  ['np_enquiries',       'np_enquiries'],
  ['np_variations',      'np_variations'],
  ['np_todos',           'np_todos'],
  ['np_calendar_events', 'np_calendar_events'],
  ['np_pay_schedules',   'np_pay_schedules'],
  ['np_site_visits',     'np_site_visits'],
  ['np_ads_spend',       'np_ads_spend'],
]

export function useRealtime() {
  const qc = useQueryClient()
  const { user } = useAuth()

  useEffect(() => {
    if (!user) return

    const channel = supabase.channel('np-realtime')

    TABLE_KEYS.forEach(([table, key]) => {
      channel.on(
        'postgres_changes' as any,
        { event: '*', schema: 'public', table },
        () => qc.invalidateQueries({ queryKey: [key] })
      )
    })

    channel.subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [user, qc])
}
