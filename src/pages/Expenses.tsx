import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Modal } from '@/components/ui/Modal'
import { Input, Select } from '@/components/ui/Field'
import { fmtCurrency, genId, today } from '@/lib/utils'
import { Plus, Loader2, Trash2, Edit2 } from 'lucide-react'

type Row = Record<string, any>

// V16 EXP_CATS
const EXP_CATS = [
  'Advertising & Marketing', 'Bank Charges & Fees', 'Insurance', 'Motor Vehicle & Fuel',
  'Phone & Internet', 'Subcontractor Labour', 'Tools & Equipment', 'Office & Stationery',
  'Professional Fees', 'Rent & Utilities', 'Software & Subscriptions', 'Other',
]

const incGST = (e: Row) => (e.amount_ex_gst || 0) + (e.gst || 0)
const hasGST = (e: Row) => (e.gst || 0) > 0

function useTable(table: string) {
  const { user } = useAuth()
  return useQuery({
    queryKey: [table, user?.id],
    queryFn: async () => {
      const { data } = await (supabase.from(table as any) as any).select('*').eq('user_id', user!.id)
      return (data ?? []) as Row[]
    },
    enabled: !!user,
  })
}

function useUpsert() {
  const qc = useQueryClient()
  const { user } = useAuth()
  return useMutation({
    mutationFn: async (row: Row) => {
      const { error } = await (supabase.from('np_expenses') as any)
        .upsert({ ...row, user_id: user!.id, updated_at: new Date().toISOString() })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['np_expenses'] }),
  })
}

function useDel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.from('np_expenses') as any).delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['np_expenses'] }),
  })
}

export default function Expenses() {
  const { data: expenses = [], isLoading } = useTable('np_expenses')
  const { data: jobs = [] } = useTable('np_jobs')
  const upsert = useUpsert()
  const del = useDel()

  const curYear = String(new Date().getFullYear())
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [year, setYear] = useState(curYear)
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState<Row>({})

  const years = useMemo(() => {
    const ys = [...new Set(expenses.map(e => (e.date || '').slice(0, 4)).filter(Boolean))].sort().reverse()
    if (!ys.includes(curYear)) ys.unshift(curYear)
    return ys
  }, [expenses, curYear])

  const rows = useMemo(() => expenses.filter(e => {
    if (cat && e.category !== cat) return false
    if (year && !(e.date || '').startsWith(year)) return false
    if (q && !`${e.exp_desc ?? ''}${e.supplier ?? ''}${e.category ?? ''}`.toLowerCase().includes(q.toLowerCase())) return false
    return true
  }).sort((a, b) => (b.date || '').localeCompare(a.date || '')), [expenses, q, cat, year])

  const totExGST = rows.reduce((s, e) => s + (e.amount_ex_gst || 0), 0)
  const totGST = rows.reduce((s, e) => s + (e.gst || 0), 0)
  const totInc = rows.reduce((s, e) => s + incGST(e), 0)

  const byCat = useMemo(() => {
    const m: Record<string, number> = {}
    rows.forEach(e => { const c = e.category || 'Other'; m[c] = (m[c] || 0) + (e.amount_ex_gst || 0) })
    return Object.entries(m).sort((a, b) => b[1] - a[1])
  }, [rows])

  function openNew() {
    setForm({ date: today(), category: 'Other', gst_applies: true })
    setModal(true)
  }
  function openEdit(e: Row) {
    setForm({ ...e, gst_applies: hasGST(e) })
    setModal(true)
  }

  const ef = (k: string) => (ev: React.ChangeEvent<any>) => {
    const v = ev.target.value
    setForm(p => {
      const next = { ...p, [k]: v }
      if (k === 'amount_ex_gst' || k === 'gst_applies') {
        const ex = parseFloat(next.amount_ex_gst) || 0
        next.gst = next.gst_applies ? parseFloat((ex * 0.1).toFixed(2)) : 0
      }
      return next
    })
  }

  async function save() {
    const ex = parseFloat(form.amount_ex_gst) || 0
    const gst = form.gst_applies ? (parseFloat(form.gst) || parseFloat((ex * 0.1).toFixed(2))) : 0
    const { gst_applies, ...rest } = form
    await upsert.mutateAsync({
      ...rest,
      id: form.id || genId('exp'),
      amount_ex_gst: ex,
      gst,
      created_at: form.created_at || new Date().toISOString(),
    })
    setModal(false)
  }

  if (isLoading) return (
    <div className="flex items-center justify-center h-64"><Loader2 size={20} className="animate-spin text-blue-600" /></div>
  )

  return (
    <div className="p-5">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <h2 className="text-[17px] font-semibold text-gray-900">Business Expenses</h2>
        <button onClick={openNew}
          className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white font-medium text-[13px] px-3 py-1.5 rounded-lg">
          <Plus size={14} /> Add Expense
        </button>
      </div>

      <div className="grid gap-2.5 mb-3.5" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))' }}>
        {[
          { l: 'Total ex GST', v: fmtCurrency(totExGST) },
          { l: 'GST credits', v: fmtCurrency(totGST), c: '#16a34a' },
          { l: 'Total inc GST', v: fmtCurrency(totInc) },
          { l: 'Entries', v: String(rows.length), c: '#2563eb' },
        ].map(m => (
          <div key={m.l} className="bg-[#f5f4f0] rounded-lg px-4 py-3.5">
            <div className="text-[11px] text-[#666] mb-1">{m.l}</div>
            <div className="text-xl font-semibold" style={m.c ? { color: m.c } : undefined}>{m.v}</div>
          </div>
        ))}
      </div>

      <div className="bg-white border border-black/[0.12] rounded-xl px-3.5 py-3 mb-2.5">
        <div className="flex gap-2 flex-wrap items-center">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="🔍 Search..."
            className="flex-[2] min-w-[160px] px-2.5 py-2 text-[13px] bg-white border border-black/20 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500" />
          <select value={cat} onChange={e => setCat(e.target.value)}
            className="flex-1 min-w-[160px] px-2.5 py-2 text-[13px] bg-white border border-black/20 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500">
            <option value="">All categories</option>
            {EXP_CATS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={year} onChange={e => setYear(e.target.value)}
            className="px-2.5 py-2 text-[13px] bg-white border border-black/20 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500">
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {byCat.length > 1 && (
        <div className="bg-white border border-black/[0.12] rounded-xl px-3.5 py-3 mb-2.5">
          <div className="text-xs font-semibold text-[#666] mb-2">BY CATEGORY ({year})</div>
          {byCat.map(([c, v]) => (
            <div key={c} className="flex justify-between items-center py-1.5 border-b border-black/[0.05]">
              <span className="text-[13px]">{c}</span>
              <span className="font-semibold text-[13px]">{fmtCurrency(v)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="bg-white border border-black/[0.12] rounded-xl overflow-hidden">
        <div className="overflow-auto max-h-[70vh]">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr>
                {['Date','Supplier','Description','Category','Ex GST','GST','Inc GST','GST?',''].map((h, i) => (
                  <th key={i} className={`px-2.5 py-[7px] border-b border-black/[0.12] text-[#666] font-medium whitespace-nowrap bg-[#fafaf8] sticky top-0 z-[2] ${[4,5,6].includes(i) ? 'text-right' : i === 7 ? 'text-center' : 'text-left'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(e => (
                <tr key={e.id} className="border-b border-black/[0.06] hover:bg-[#fafaf8]">
                  <td className="px-2.5 py-[7px] text-xs whitespace-nowrap">{e.date || '—'}</td>
                  <td className="px-2.5 py-[7px] text-xs">{e.supplier || '—'}</td>
                  <td className="px-2.5 py-[7px] text-xs max-w-[180px] truncate">{e.exp_desc || ''}</td>
                  <td className="px-2.5 py-[7px]">
                    <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#f1f0e8] text-[#5f5e5a]">{e.category || 'Other'}</span>
                  </td>
                  <td className="px-2.5 py-[7px] text-right font-medium">{fmtCurrency(e.amount_ex_gst || 0)}</td>
                  <td className="px-2.5 py-[7px] text-right text-[#666]">{e.gst ? fmtCurrency(e.gst) : '—'}</td>
                  <td className="px-2.5 py-[7px] text-right">{fmtCurrency(incGST(e))}</td>
                  <td className="px-2.5 py-[7px] text-center">
                    {hasGST(e)
                      ? <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#dcfce7] text-[#166534]">Yes</span>
                      : <span className="text-[11px] text-[#666]">No</span>}
                  </td>
                  <td className="px-2.5 py-[7px] whitespace-nowrap">
                    <button onClick={() => openEdit(e)}
                      className="ml-1 px-1.5 py-1 rounded-md bg-white border border-black/20 hover:bg-[#f5f4f0] align-middle"><Edit2 size={12} /></button>
                    <button onClick={() => { if (confirm('Delete this expense?')) del.mutate(e.id) }}
                      className="ml-1 px-1.5 py-1 rounded-md bg-white border border-black/20 hover:bg-[#f5f4f0] align-middle text-[#c0392b]"><Trash2 size={12} /></button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={9} className="text-center text-[#666] py-6">No expenses recorded for this period.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title={form.id ? 'Edit Expense' : 'New Expense'}>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Date" type="date" value={form.date || ''} onChange={ef('date')} />
          <Input label="Supplier" value={form.supplier || ''} onChange={ef('supplier')} />
          <Input label="Description" value={form.exp_desc || ''} onChange={ef('exp_desc')} wrapperClassName="col-span-2" />
          <Select label="Category" value={form.category || 'Other'} onChange={ef('category')} options={EXP_CATS} />
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Link to job (optional)</label>
            <select value={form.job_id || ''} onChange={ef('job_id')}
              className="w-full bg-white border border-black/20 rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-blue-500">
              <option value="">— None (overhead) —</option>
              {jobs.map(j => <option key={j.id} value={j.id}>{j.id} — {j.client}</option>)}
            </select>
          </div>
          <Input label="Amount ex GST ($)" type="number" step="0.01" value={form.amount_ex_gst ?? ''} onChange={ef('amount_ex_gst')} />
          <Input label="GST ($)" type="number" step="0.01" value={form.gst ?? ''} onChange={ef('gst')}
            className={form.gst_applies ? '' : 'opacity-60'} readOnly={!form.gst_applies} />
          <div className="col-span-2 flex items-center gap-2">
            <input type="checkbox" id="gst-applies" checked={!!form.gst_applies}
              onChange={e => ef('gst_applies')({ target: { value: e.target.checked } } as any)}
              className="w-4 h-4 accent-blue-600" />
            <label htmlFor="gst-applies" className="text-[13px] text-gray-600">GST applies (claimable credit)</label>
          </div>
          <Input label="Notes" value={form.notes || ''} onChange={ef('notes')} wrapperClassName="col-span-2" />
        </div>
        <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-black/10">
          <button onClick={() => setModal(false)} className="px-4 py-2 text-[13px] rounded-lg bg-[#f5f4f0] text-gray-600 border border-black/10 hover:bg-gray-200">Cancel</button>
          <button onClick={save} className="px-5 py-2 text-[13px] rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold">Save</button>
        </div>
      </Modal>
    </div>
  )
}
