import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, selectAll } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import type { Database } from '@/lib/database.types'
import { invalidateTable } from '../lib/queryKeys'

type Job = Database['public']['Tables']['np_jobs']['Row']
type JobInsert = Database['public']['Tables']['np_jobs']['Insert']

export function useJobs() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['jobs', user?.id],
    queryFn: async () => {
      const { data, error } = await selectAll('np_jobs', user!.id, { orderBy: 'created_at' })
      if (error) throw error
      return data as Job[]
    },
    enabled: !!user,
  })
}

export function useUpsertJob() {
  const qc = useQueryClient()
  const { user } = useAuth()
  return useMutation({
    mutationFn: async (job: Partial<Job> & { id: string }) => {
      const payload = { ...job, user_id: user!.id, updated_at: new Date().toISOString() }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.from('np_jobs') as any)
        .upsert(payload)
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: () => invalidateTable(qc, 'np_jobs'),
  })
}

export function useDeleteJob() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('np_jobs').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => invalidateTable(qc, 'np_jobs'),
  })
}

export type { Job, JobInsert }
