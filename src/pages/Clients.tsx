import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { fmtCurrency } from '@/lib/utils'
import { Badge } from '@/components/ui/Badge'
import { Search, Loader2 } from 'lucide-react'

function useJobs() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['np_jobs', user?.id],
    queryFn: async () => {
      const { data } = await supabase.from('np_jobs').select('id,client,agreed_ex_gst,quote_ex_gst,status,quote_status').eq('user_id', user!.id)
      return (data ?? []) as any[]
    },
    enabled: !!user,
  })
}

function useInvoices() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['np_invoices', user?.id],
    queryFn: async () => {
      const { data } = await supabase.from('np_invoices').select('client,total_inc_gst,received,manual_paid').eq('user_id', user!.id)
      return (data ?? []) as any[]
    },
    enabled: !!user,
  })
}

export default function Clients() {
  const { data: jobs = [], isLoading } = useJobs()
  const { data: invoices = [] } = useInvoices()
  const [search, setSearch] = useState('')

  const clients = useMemo(() => {
    const map: Record<string, { client: string; jobs: number; agreed: number; invoiced: number; received: number; statuses: Set<string> }> = {}

    jobs.forEach(j => {
      if (!j.client) return
      if (!map[j.client]) map[j.client] = { client: j.client, jobs: 0, agreed: 0, invoiced: 0, received: 0, statuses: new Set() }
      map[j.client].jobs++
      map[j.client].agreed += j.agreed_ex_gst || j.quote_ex_gst || 0
      if (j.status) map[j.client].statuses.add(j.status)
    })

    invoices.forEach(inv => {
      if (!inv.client || !map[inv.client]) return
      map[inv.client].invoiced += inv.total_inc_gst || 0
      map[inv.client].received += inv.received || (inv.manual_paid ? inv.total_inc_gst : 0) || 0
    })

    return Object.values(map)
      .filter(c => !search || c.client.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => b.agreed - a.agreed)
  }, [jobs, invoices, search])

  const totalAgreed = clients.reduce((s, c) => s + c.agreed, 0)
  const totalReceived = clients.reduce((s, c) => s + c.received, 0)
  const totalOutstanding = clients.reduce((s, c) => s + Math.max(0, c.invoiced - c.received), 0)

  return (
    <div className="p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-[17px] font-semibold text-gray-900">Clients</h2>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-2.5 mb-4">
        {[
          { label: 'Total Clients', value: clients.length, cls: 'text-blue-700' },
          { label: 'Total Agreed (ex GST)', value: fmtCurrency(totalAgreed), cls: 'text-gray-900' },
          { label: 'Received (inc GST)', value: fmtCurrency(totalReceived), cls: 'text-green-700' },
        ].map(m => (
          <div key={m.label} className="bg-[#f5f4f0] rounded-lg px-4 py-3">
            <div className="text-[11px] text-gray-500 mb-1">{m.label}</div>
            <div className={`text-xl font-semibold ${m.cls}`}>{m.value}</div>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="flex gap-2 mb-3">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search clients…"
            className="pl-8 pr-3 py-1.5 text-[12.5px] bg-white border border-black/20 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 w-56"
          />
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 size={18} className="animate-spin text-blue-600" /></div>
      ) : (
        <div className="bg-white border border-black/10 rounded-xl overflow-hidden">
          <div className="overflow-x-auto max-h-[70vh]">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr>
                  {['Client','Jobs','Agreed (ex GST)','Invoiced (inc GST)','Received','Outstanding','Statuses'].map(h => (
                    <th key={h} className="text-left px-3 py-2 border-b border-black/10 text-gray-500 font-medium whitespace-nowrap bg-[#fafaf8] sticky top-0">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {clients.map(c => {
                  const outstanding = Math.max(0, c.invoiced - c.received)
                  return (
                    <tr key={c.client} className="hover:bg-[#fafaf8] border-b border-black/[0.06] last:border-0">
                      <td className="px-3 py-2 font-medium text-gray-900">{c.client}</td>
                      <td className="px-3 py-2 text-gray-700">{c.jobs}</td>
                      <td className="px-3 py-2 text-gray-900">{fmtCurrency(c.agreed)}</td>
                      <td className="px-3 py-2 text-gray-700">{c.invoiced ? fmtCurrency(c.invoiced) : '—'}</td>
                      <td className="px-3 py-2 text-green-700 font-medium">{c.received ? fmtCurrency(c.received) : '—'}</td>
                      <td className="px-3 py-2">
                        {outstanding > 0
                          ? <span className="text-red-700 font-semibold">{fmtCurrency(outstanding)}</span>
                          : <span className="text-gray-400">—</span>}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex gap-1 flex-wrap">
                          {[...c.statuses].filter(Boolean).slice(0, 3).map(s => (
                            <Badge key={s} label={s} />
                          ))}
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {clients.length === 0 && (
                  <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-400">No clients found</td></tr>
                )}
              </tbody>
              {clients.length > 0 && (
                <tfoot>
                  <tr className="bg-[#fafaf8] font-semibold text-gray-900">
                    <td className="px-3 py-2 text-gray-500">Total</td>
                    <td className="px-3 py-2">{clients.reduce((s, c) => s + c.jobs, 0)}</td>
                    <td className="px-3 py-2">{fmtCurrency(totalAgreed)}</td>
                    <td className="px-3 py-2">{fmtCurrency(clients.reduce((s, c) => s + c.invoiced, 0))}</td>
                    <td className="px-3 py-2 text-green-700">{fmtCurrency(totalReceived)}</td>
                    <td className="px-3 py-2 text-red-700">{fmtCurrency(totalOutstanding)}</td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
