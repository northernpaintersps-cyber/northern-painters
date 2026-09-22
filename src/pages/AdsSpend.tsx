import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Modal } from '@/components/ui/Modal'
import { Input, Select, TextArea } from '@/components/ui/Field'
import { fmtCurrency, fmtDate, genId, today, inYear } from '@/lib/utils'
import { Plus, Loader2, Trash2, Edit2 } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'

const PLATFORMS = ['Google Ads','Facebook','Instagram','LinkedIn','Hipages','Airtasker','Tradify','Flyers/Print','Other']

function useAdsSpend() {
  const { user } = useAuth()
  return useQuery<any[]>({
    queryKey: ['np_ads_spend', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('np_ads_spend').select('*').eq('user_id', user!.id).order('date', { ascending: false })
      if (error) throw error
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
      const { error } = await supabase.from('np_ads_spend').upsert({ ...row, user_id: user!.id, updated_at: new Date().toISOString() } as any)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['np_ads_spend'] }),
  })
}

function useDelete() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('np_ads_spend').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['np_ads_spend'] }),
  })
}

export default function AdsSpend() {
  const { data: entries = [], isLoading } = useAdsSpend()
  const upsert = useUpsert()
  const del = useDelete()

  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<any>({})
  const [saving, setSaving] = useState(false)
  const [selYear, setSelYear] = useState(new Date().getFullYear())

  const ef = (k: string) => (e: React.ChangeEvent<any>) =>
    setForm((p: any) => ({ ...p, [k]: e.target.value }))

  function openNew() { setForm({ date: today(), platform: 'Google Ads' }); setOpen(true) }
  function openEdit(e: any) { setForm({ ...e }); setOpen(true) }

  async function save() {
    setSaving(true)
    try {
      await upsert.mutateAsync({ ...form, id: form.id || genId('ads') })
      setOpen(false)
    } finally { setSaving(false) }
  }

  const yearEntries = useMemo(() => entries.filter(e => inYear(e.date, selYear)), [entries, selYear])
  const totalYear = yearEntries.reduce((s, e) => s + (e.amount ?? 0), 0)
  const totalAll  = entries.reduce((s, e) => s + (e.amount ?? 0), 0)

  // By platform chart
  const byPlatform = useMemo(() => {
    const map: Record<string, number> = {}
    yearEntries.forEach(e => { map[e.platform || 'Other'] = (map[e.platform || 'Other'] ?? 0) + (e.amount ?? 0) })
    return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
  }, [yearEntries])

  // By month chart
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const byMonth = useMemo(() => {
    const map: Record<number, number> = {}
    yearEntries.forEach(e => {
      if (e.date) { const m = new Date(e.date).getMonth(); map[m] = (map[m] ?? 0) + (e.amount ?? 0) }
    })
    return MONTHS.map((name, i) => ({ name, value: map[i] ?? 0 }))
  }, [yearEntries])

  const years = useMemo(() => {
    const s = new Set<number>([new Date().getFullYear()])
    entries.forEach(e => { if (e.date) s.add(new Date(e.date).getFullYear()) })
    return [...s].sort((a, b) => b - a)
  }, [entries])

  const COLORS = ['#facc15','#60a5fa','#34d399','#f87171','#a78bfa','#fb923c','#2dd4bf','#e879f9']

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold text-white">Advertising Spend</h1>
          <p className="text-xs text-gray-500 mt-0.5">All time: <span className="text-white">{fmtCurrency(totalAll)}</span></p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-400">Year</span>
            <select value={selYear} onChange={e => setSelYear(Number(e.target.value))}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-yellow-400">
              {years.map(y => <option key={y}>{y}</option>)}
            </select>
          </div>
          <button onClick={openNew}
            className="flex items-center gap-1.5 bg-yellow-400 hover:bg-yellow-300 text-gray-900 font-semibold text-sm px-3 py-1.5 rounded-lg transition-colors">
            <Plus size={14} /> Add entry
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-3 flex flex-col gap-1">
          <span className="text-xs text-gray-400">{selYear} total</span>
          <span className="text-xl font-bold text-white tabular-nums">{fmtCurrency(totalYear)}</span>
        </div>
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-3 flex flex-col gap-1">
          <span className="text-xs text-gray-400">Monthly avg</span>
          <span className="text-xl font-bold text-white tabular-nums">{fmtCurrency(totalYear / 12)}</span>
        </div>
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-3 flex flex-col gap-1">
          <span className="text-xs text-gray-400">Entries {selYear}</span>
          <span className="text-xl font-bold text-white">{yearEntries.length}</span>
        </div>
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-3 flex flex-col gap-1">
          <span className="text-xs text-gray-400">Top platform</span>
          <span className="text-sm font-bold text-yellow-400 truncate">{byPlatform[0]?.name ?? '—'}</span>
        </div>
      </div>

      {/* Charts */}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
          <h3 className="text-sm font-semibold text-white mb-3">Monthly spend — {selYear}</h3>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={byMonth} margin={{ top: 0, right: 8, left: -15, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#6b7280' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} axisLine={false} tickLine={false}
                tickFormatter={(v: unknown) => `$${((v as number) / 1000).toFixed(0)}k`} />
              <Tooltip contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: '8px', fontSize: 12 }}
                formatter={(v: unknown) => [fmtCurrency(v as number), 'Spend']} />
              <Bar dataKey="value" radius={[3, 3, 0, 0]}>
                {byMonth.map((e, i) => <Cell key={i} fill={e.value > 0 ? '#facc15' : '#1f2937'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
          <h3 className="text-sm font-semibold text-white mb-3">By platform — {selYear}</h3>
          <div className="space-y-2">
            {byPlatform.map((p, i) => (
              <div key={p.name} className="flex items-center gap-3">
                <span className="text-xs text-gray-400 w-28 truncate shrink-0">{p.name}</span>
                <div className="flex-1 h-5 bg-gray-800 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${byPlatform[0]?.value ? (p.value / byPlatform[0].value) * 100 : 0}%`, backgroundColor: COLORS[i % COLORS.length] }} />
                </div>
                <span className="text-xs font-semibold text-white tabular-nums w-16 text-right shrink-0">{fmtCurrency(p.value)}</span>
              </div>
            ))}
            {!byPlatform.length && <p className="text-sm text-gray-500 text-center py-4">No data for {selYear}</p>}
          </div>
        </div>
      </div>

      {/* Table */}
      {isLoading
        ? <div className="flex justify-center py-10"><Loader2 size={20} className="animate-spin text-yellow-400" /></div>
        : (
          <div className="overflow-x-auto rounded-xl border border-gray-800">
            <table className="w-full">
              <thead>
                <tr>
                  {['Date','Platform','Amount','Notes',''].map(h => (
                    <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entries.map(e => (
                  <tr key={e.id} className="border-t border-gray-800 hover:bg-gray-800/40 group">
                    <td className="px-3 py-2.5 text-sm text-gray-300 whitespace-nowrap">{fmtDate(e.date)}</td>
                    <td className="px-3 py-2.5 text-sm text-gray-300">{e.platform || '—'}</td>
                    <td className="px-3 py-2.5 text-sm font-semibold text-white tabular-nums">{fmtCurrency(e.amount)}</td>
                    <td className="px-3 py-2.5 text-sm text-gray-400 max-w-[240px] truncate">{e.notes || '—'}</td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => openEdit(e)} className="text-gray-500 hover:text-yellow-400"><Edit2 size={13} /></button>
                        <button onClick={() => { if (confirm('Delete?')) del.mutate(e.id) }} className="text-gray-500 hover:text-red-400"><Trash2 size={13} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!entries.length && <tr><td colSpan={5} className="text-center py-10 text-gray-500 text-sm">No ad spend entries yet</td></tr>}
              </tbody>
            </table>
          </div>
        )
      }

      {/* Modal */}
      <Modal open={open} onClose={() => setOpen(false)} title={form.id ? 'Edit ad spend' : 'Log ad spend'}>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Input label="Date" type="date" value={form.date || ''} onChange={ef('date')} />
            <Input label="Amount ($)" type="number" value={form.amount ?? ''} onChange={ef('amount')} />
          </div>
          <Select label="Platform" value={form.platform || ''} onChange={ef('platform')} options={PLATFORMS} />
          <TextArea label="Notes / campaign" value={form.notes || ''} onChange={ef('notes')} />
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
