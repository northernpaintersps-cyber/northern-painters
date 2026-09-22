import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Modal } from '@/components/ui/Modal'
import { Input, Select, TextArea } from '@/components/ui/Field'
import { fmtCurrency, fmtDate, genId, today } from '@/lib/utils'
import { Plus, Loader2, Trash2, Edit2, Search } from 'lucide-react'

const REC_CATS = ['Paint','Hardware','Equipment','Fuel','Materials','Subcontractor','Other']

function useReceipts() {
  const { user } = useAuth()
  return useQuery<any[]>({
    queryKey: ['np_receipts', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('np_receipts').select('*').eq('user_id', user!.id).order('date', { ascending: false })
      if (error) throw error
      return data ?? []
    },
    enabled: !!user,
  })
}

function useJobs() {
  const { user } = useAuth()
  return useQuery<any[]>({
    queryKey: ['np_jobs_rec', user?.id],
    queryFn: async () => {
      const { data } = await supabase.from('np_jobs').select('id,client').eq('user_id', user!.id)
      return data ?? []
    },
    enabled: !!user,
  })
}

function useUpsert() {
  const qc = useQueryClient()
  const { user } = useAuth()
  return useMutation({
    mutationFn: async (row: any) => {
      const { error } = await supabase.from('np_receipts').upsert({ ...row, user_id: user!.id, updated_at: new Date().toISOString() } as any)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['np_receipts'] }),
  })
}

function useDelete() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('np_receipts').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['np_receipts'] }),
  })
}

export default function Receipts() {
  const { data: receipts = [], isLoading } = useReceipts()
  const { data: jobs = [] } = useJobs()
  const upsert = useUpsert()
  const del = useDelete()

  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<any>({})
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [filterCat, setFilterCat] = useState('')

  const ef = (k: string) => (e: React.ChangeEvent<any>) => {
    setForm((p: any) => {
      const v = e.target.value
      const next = { ...p, [k]: v }
      if (k === 'cost_ex_gst') {
        const ex = parseFloat(v) || 0
        next.gst = parseFloat((ex * 0.1).toFixed(2))
        next.total_inc_gst = parseFloat((ex * 1.1).toFixed(2))
      }
      return next
    })
  }

  function openNew() { setForm({ date: today(), category: 'Other' }); setOpen(true) }
  function openEdit(r: any) { setForm({ ...r }); setOpen(true) }

  async function save() {
    setSaving(true)
    try {
      await upsert.mutateAsync({ ...form, id: form.id || genId('rc') })
      setOpen(false)
    } finally { setSaving(false) }
  }

  const filtered = useMemo(() => {
    let out = receipts
    if (search) {
      const q = search.toLowerCase()
      out = out.filter(r => [r.supplier, r.rec_desc, r.client, r.job_id, r.category].some((f: any) => f?.toLowerCase().includes(q)))
    }
    if (filterCat) out = out.filter(r => r.category === filterCat)
    return out
  }, [receipts, search, filterCat])

  const totalIncGST = filtered.reduce((s, r) => s + (r.total_inc_gst ?? 0), 0)
  const totalGST    = filtered.reduce((s, r) => s + (r.gst ?? 0), 0)

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-white">Receipts</h1>
          <p className="text-xs text-gray-500 mt-0.5">{receipts.length} receipts · GST claimable: <span className="text-green-400">{fmtCurrency(totalGST)}</span></p>
        </div>
        <button onClick={openNew}
          className="flex items-center gap-1.5 bg-yellow-400 hover:bg-yellow-300 text-gray-900 font-semibold text-sm px-3 py-1.5 rounded-lg transition-colors">
          <Plus size={14} /> Add receipt
        </button>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Total inc GST', value: fmtCurrency(totalIncGST), color: 'text-white' },
          { label: 'GST claimable', value: fmtCurrency(totalGST), color: 'text-green-400' },
          { label: 'Receipts shown', value: filtered.length, color: 'text-gray-300' },
        ].map(s => (
          <div key={s.label} className="bg-gray-900 rounded-xl border border-gray-800 p-3 flex items-center justify-between">
            <span className="text-xs text-gray-400">{s.label}</span>
            <span className={`text-lg font-bold tabular-nums ${s.color}`}>{s.value}</span>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search supplier, description…"
            className="w-full bg-gray-900 border border-gray-700 rounded-lg pl-8 pr-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-yellow-400/50" />
        </div>
        <select value={filterCat} onChange={e => setFilterCat(e.target.value)}
          className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-yellow-400/50">
          <option value="">All categories</option>
          {REC_CATS.map(c => <option key={c}>{c}</option>)}
        </select>
      </div>

      {/* Table */}
      {isLoading
        ? <div className="flex justify-center py-16"><Loader2 size={20} className="animate-spin text-yellow-400" /></div>
        : (
          <div className="overflow-x-auto rounded-xl border border-gray-800">
            <table className="w-full">
              <thead>
                <tr>
                  {['Date','Job','Supplier','Description','Category','Ex GST','GST','Inc GST',''].map(h => (
                    <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.id} className="border-t border-gray-800 hover:bg-gray-800/40 group">
                    <td className="px-3 py-2.5 text-sm text-gray-300 whitespace-nowrap">{fmtDate(r.date)}</td>
                    <td className="px-3 py-2.5 text-sm text-gray-300">{r.job_id || r.client || '—'}</td>
                    <td className="px-3 py-2.5 text-sm text-gray-300">{r.supplier || '—'}</td>
                    <td className="px-3 py-2.5 text-sm text-gray-300 max-w-[200px] truncate">{r.rec_desc || '—'}</td>
                    <td className="px-3 py-2.5 text-sm text-gray-400">{r.category || '—'}</td>
                    <td className="px-3 py-2.5 text-sm text-gray-300 tabular-nums">{fmtCurrency(r.cost_ex_gst)}</td>
                    <td className="px-3 py-2.5 text-sm text-green-400 tabular-nums">{fmtCurrency(r.gst)}</td>
                    <td className="px-3 py-2.5 text-sm font-semibold text-white tabular-nums">{fmtCurrency(r.total_inc_gst)}</td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => openEdit(r)} className="text-gray-500 hover:text-yellow-400"><Edit2 size={13} /></button>
                        <button onClick={() => { if (confirm('Delete this receipt?')) del.mutate(r.id) }} className="text-gray-500 hover:text-red-400"><Trash2 size={13} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!filtered.length && (
                  <tr><td colSpan={9} className="text-center py-10 text-gray-500 text-sm">No receipts found</td></tr>
                )}
              </tbody>
              {filtered.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-gray-700">
                    <td colSpan={5} className="px-3 py-2.5 text-xs text-gray-500 font-semibold uppercase tracking-wide">Totals</td>
                    <td className="px-3 py-2.5 text-sm font-semibold text-white tabular-nums">{fmtCurrency(filtered.reduce((s, r) => s + (r.cost_ex_gst ?? 0), 0))}</td>
                    <td className="px-3 py-2.5 text-sm font-semibold text-green-400 tabular-nums">{fmtCurrency(totalGST)}</td>
                    <td className="px-3 py-2.5 text-sm font-semibold text-white tabular-nums">{fmtCurrency(totalIncGST)}</td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )
      }

      {/* Modal */}
      <Modal open={open} onClose={() => setOpen(false)} title={form.id ? 'Edit receipt' : 'New receipt'}>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Input label="Date" type="date" value={form.date || ''} onChange={ef('date')} />
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-400">Job (optional)</label>
              <select value={form.job_id || ''} onChange={ef('job_id')}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-yellow-400 cursor-pointer">
                <option value="">— No job —</option>
                {jobs.map(j => <option key={j.id} value={j.id}>{j.id} {j.client || ''}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Supplier" value={form.supplier || ''} onChange={ef('supplier')} />
            <Select label="Category" value={form.category || ''} onChange={ef('category')} options={REC_CATS} />
          </div>
          <Input label="Description" value={form.rec_desc || ''} onChange={ef('rec_desc')} />
          <div className="grid grid-cols-3 gap-3">
            <Input label="Ex GST ($)" type="number" value={form.cost_ex_gst ?? ''} onChange={ef('cost_ex_gst')} />
            <Input label="GST ($)" type="number" value={form.gst ?? ''} onChange={ef('gst')} />
            <Input label="Inc GST ($)" type="number" value={form.total_inc_gst ?? ''} onChange={ef('total_inc_gst')} />
          </div>
          <TextArea label="Notes" value={form.notes || ''} onChange={ef('notes')} />
        </div>
        <div className="flex justify-between mt-5 pt-4 border-t border-gray-800">
          <div>
            {form.id && (
              <button onClick={() => { if (confirm('Delete?')) { del.mutate(form.id); setOpen(false) } }}
                className="flex items-center gap-1.5 text-sm text-red-400 hover:text-red-300">
                <Trash2 size={14} /> Delete
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={() => setOpen(false)} className="text-sm px-4 py-2 rounded-lg bg-gray-800 text-gray-400 hover:text-white">Cancel</button>
            <button onClick={save} disabled={saving} className="flex items-center gap-1.5 text-sm px-5 py-2 rounded-lg bg-yellow-400 hover:bg-yellow-300 text-gray-900 font-semibold disabled:opacity-50">
              {saving && <Loader2 size={13} className="animate-spin" />} Save
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
