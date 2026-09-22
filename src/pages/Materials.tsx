import { useState, useMemo, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Modal } from '@/components/ui/Modal'
import { Input, Select, TextArea } from '@/components/ui/Field'
import { fmtCurrency, fmtDate, genId, today } from '@/lib/utils'
import { extractInvoice } from '@/lib/ai'
import { useBusinessSettings } from '@/pages/SettingsPage'
import { Plus, Search, Loader2, Trash2, Edit2, Scan, AlertCircle } from 'lucide-react'

const CATEGORIES = ['Paint', 'Primer/Undercoat', 'Filler/Putty', 'Tape/Masking', 'Brushes/Rollers', 'Sandpaper/Prep', 'Caulk/Sealant', 'Solvent/Cleaner', 'Hardware', 'Other']
const BILLING_TYPES = ['Fixed Quote', 'Hourly', 'Hourly/Estimate']

function useMaterials() {
  const { user } = useAuth()
  return useQuery<any[]>({
    queryKey: ['np_materials', user?.id],
    queryFn: async () => {
      const { data, error } = await (supabase.from('np_materials') as any).select('*').eq('user_id', user!.id).order('date', { ascending: false })
      if (error) throw error
      return data ?? []
    },
    enabled: !!user,
  })
}

function useJobs() {
  const { user } = useAuth()
  return useQuery<any[]>({
    queryKey: ['np_jobs_mat', user?.id],
    queryFn: async () => {
      const { data } = await supabase.from('np_jobs').select('id,client,address').eq('user_id', user!.id).order('id', { ascending: false })
      return data ?? []
    },
    enabled: !!user,
  })
}

function useUpsertMaterial() {
  const qc = useQueryClient()
  const { user } = useAuth()
  return useMutation({
    mutationFn: async (row: any) => {
      const { error } = await (supabase.from('np_materials') as any).upsert({
        ...row,
        user_id: user!.id,
        updated_at: new Date().toISOString(),
      })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['np_materials'] }),
  })
}

function useDeleteMaterial() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.from('np_materials') as any).delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['np_materials'] }),
  })
}

function emptyForm() {
  return {
    id: '',
    job_id: '',
    date: today(),
    supplier: '',
    mat_desc: '',
    category: 'Paint',
    billing_type: 'Fixed Quote',
    cost_ex_gst: '' as any,
    gst: '' as any,
    total_inc_gst: '' as any,
    receipt_no: '',
    notes: '',
  }
}

export default function Materials() {
  const { data: materials = [], isLoading } = useMaterials()
  const { data: jobs = [] } = useJobs()
  const { data: bizSettings } = useBusinessSettings()
  const upsert = useUpsertMaterial()
  const del = useDeleteMaterial()

  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('All')
  const [jobFilter, setJobFilter] = useState('All')
  const [form, setForm] = useState(emptyForm())
  const [modalOpen, setModalOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const scanInputRef = useRef<HTMLInputElement>(null)

  const ef = (k: string) => (e: React.ChangeEvent<any>) => {
    const v = e.target.value
    setForm(p => {
      const next = { ...p, [k]: v }
      // Auto-calc GST and total from ex-GST
      if (k === 'cost_ex_gst') {
        const ex = parseFloat(v) || 0
        next.gst = parseFloat((ex * 0.1).toFixed(2))
        next.total_inc_gst = parseFloat((ex * 1.1).toFixed(2))
      }
      return next
    })
  }

  const filtered = useMemo(() => {
    const s = search.toLowerCase()
    return materials.filter(m => {
      const matchSearch = !s || [m.mat_desc, m.supplier, m.receipt_no, m.notes, m.job_id].some(v => v?.toLowerCase().includes(s))
      const matchCat = catFilter === 'All' || m.category === catFilter
      const matchJob = jobFilter === 'All' || m.job_id === jobFilter
      return matchSearch && matchCat && matchJob
    })
  }, [materials, search, catFilter, jobFilter])

  const totals = useMemo(() => ({
    ex: filtered.reduce((s, m) => s + (m.cost_ex_gst ?? 0), 0),
    gst: filtered.reduce((s, m) => s + (m.gst ?? 0), 0),
    inc: filtered.reduce((s, m) => s + (m.total_inc_gst ?? 0), 0),
  }), [filtered])

  function openNew() {
    setForm(emptyForm())
    setScanError(null)
    setModalOpen(true)
  }

  function openEdit(m: any) {
    setForm({ ...emptyForm(), ...m })
    setScanError(null)
    setModalOpen(true)
  }

  async function handleScan(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const apiKey = bizSettings?.ai_api_key?.trim()
    if (!apiKey) {
      setScanError('No AI API key set. Add your Anthropic API key in Settings.')
      if (scanInputRef.current) scanInputRef.current.value = ''
      return
    }
    setScanning(true)
    setScanError(null)
    try {
      const result = await extractInvoice(apiKey, file)
      setForm(f => ({
        ...f,
        supplier:      result.supplier || f.supplier,
        mat_desc:      result.description || f.mat_desc,
        date:          result.date || f.date,
        receipt_no:    result.receipt_no || f.receipt_no,
        cost_ex_gst:   result.cost_ex_gst ?? f.cost_ex_gst,
        gst:           result.gst ?? f.gst,
        total_inc_gst: result.total_inc_gst ?? f.total_inc_gst,
        category:      result.category || f.category,
        notes:         result.notes ? (f.notes ? `${f.notes}\n${result.notes}` : result.notes) : f.notes,
      }))
    } catch (err: any) {
      setScanError(err?.message || 'Scan failed. Check your API key and try again.')
    } finally {
      setScanning(false)
      if (scanInputRef.current) scanInputRef.current.value = ''
    }
  }

  async function save() {
    setSaving(true)
    try {
      await upsert.mutateAsync({
        ...form,
        id: form.id || genId('mat'),
        cost_ex_gst: parseFloat(form.cost_ex_gst) || 0,
        gst: parseFloat(form.gst) || 0,
        total_inc_gst: parseFloat(form.total_inc_gst) || 0,
      })
      setModalOpen(false)
    } finally { setSaving(false) }
  }

  const jobOptions = ['', ...jobs.map(j => j.id)]
  const jobLabel = (id: string) => {
    if (!id) return ''
    const j = jobs.find(x => x.id === id)
    return j ? `${j.id} – ${j.client}` : id
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Materials</h1>
          <p className="text-xs text-gray-500 mt-0.5">All paint and material purchases, linked to jobs</p>
        </div>
        <button onClick={openNew} className="flex items-center gap-1.5 bg-yellow-400 hover:bg-yellow-300 text-gray-900 font-semibold text-sm px-3 py-1.5 rounded-lg transition-colors">
          <Plus size={14} /> Add material
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search materials…"
            className="w-full pl-8 pr-3 py-2 bg-gray-900 border border-gray-800 rounded-lg text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-yellow-400" />
        </div>
        <select value={catFilter} onChange={e => setCatFilter(e.target.value)}
          className="bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:ring-1 focus:ring-yellow-400">
          <option value="All">All categories</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={jobFilter} onChange={e => setJobFilter(e.target.value)}
          className="bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:ring-1 focus:ring-yellow-400">
          <option value="All">All jobs</option>
          {jobs.map(j => <option key={j.id} value={j.id}>{j.id} – {j.client}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 size={20} className="animate-spin text-yellow-400" /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-xs text-gray-500">
                  <th className="text-left px-4 py-3 font-medium">Date</th>
                  <th className="text-left px-4 py-3 font-medium">Job</th>
                  <th className="text-left px-4 py-3 font-medium">Description</th>
                  <th className="text-left px-4 py-3 font-medium">Supplier</th>
                  <th className="text-left px-4 py-3 font-medium">Category</th>
                  <th className="text-left px-4 py-3 font-medium">Billing</th>
                  <th className="text-right px-4 py-3 font-medium">Ex GST</th>
                  <th className="text-right px-4 py-3 font-medium">GST</th>
                  <th className="text-right px-4 py-3 font-medium">Total</th>
                  <th className="px-4 py-3 w-12"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={10} className="text-center py-10 text-gray-600">No materials found</td></tr>
                )}
                {filtered.map(m => (
                  <tr key={m.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                    <td className="px-4 py-3 text-gray-400 whitespace-nowrap">{fmtDate(m.date)}</td>
                    <td className="px-4 py-3">
                      {m.job_id ? <span className="text-xs bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded">{m.job_id}</span> : <span className="text-gray-600">—</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-200 max-w-xs truncate">{m.mat_desc}</td>
                    <td className="px-4 py-3 text-gray-400">{m.supplier || '—'}</td>
                    <td className="px-4 py-3 text-gray-400">{m.category || '—'}</td>
                    <td className="px-4 py-3 text-gray-400">{m.billing_type || '—'}</td>
                    <td className="px-4 py-3 text-right text-gray-300 font-mono">{fmtCurrency(m.cost_ex_gst ?? 0)}</td>
                    <td className="px-4 py-3 text-right text-gray-500 font-mono">{fmtCurrency(m.gst ?? 0)}</td>
                    <td className="px-4 py-3 text-right text-white font-mono font-medium">{fmtCurrency(m.total_inc_gst ?? 0)}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <button onClick={() => openEdit(m)} className="p-1 text-gray-600 hover:text-yellow-400 transition-colors"><Edit2 size={13} /></button>
                        <button onClick={() => { if (confirm('Delete this material?')) del.mutate(m.id) }} className="p-1 text-gray-600 hover:text-red-400 transition-colors"><Trash2 size={13} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-gray-700 bg-gray-800/40">
                  <td colSpan={6} className="px-4 py-3 text-xs text-gray-500 font-medium">{filtered.length} entries</td>
                  <td className="px-4 py-3 text-right text-gray-300 font-mono font-medium">{fmtCurrency(totals.ex)}</td>
                  <td className="px-4 py-3 text-right text-gray-500 font-mono">{fmtCurrency(totals.gst)}</td>
                  <td className="px-4 py-3 text-right text-white font-mono font-bold">{fmtCurrency(totals.inc)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} size="lg">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-white">{form.id ? 'Edit material' : 'Add material'}</h2>
          <label className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors cursor-pointer
            ${scanning ? 'border-yellow-400/50 bg-yellow-400/10 text-yellow-400' : 'border-gray-700 bg-gray-800 text-gray-400 hover:text-white hover:border-gray-600'}`}>
            <input ref={scanInputRef} type="file" accept="image/*" className="hidden" onChange={handleScan} disabled={scanning} />
            {scanning ? <Loader2 size={12} className="animate-spin" /> : <Scan size={12} />}
            {scanning ? 'Scanning…' : 'Scan invoice'}
          </label>
        </div>
        {scanError && (
          <div className="flex items-start gap-2 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2 mb-3">
            <AlertCircle size={13} className="text-red-400 mt-0.5 shrink-0" />
            <p className="text-xs text-red-300">{scanError}</p>
          </div>
        )}
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Input label="Date" type="date" value={form.date} onChange={ef('date')} />
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-400">Job</label>
              <select value={form.job_id} onChange={ef('job_id')}
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-yellow-400">
                <option value="">No job / overhead</option>
                {jobs.map(j => <option key={j.id} value={j.id}>{j.id} – {j.client} – {j.address}</option>)}
              </select>
            </div>
          </div>
          <Input label="Description" value={form.mat_desc} onChange={ef('mat_desc')} placeholder="Dulux Weathershield 15L — Inv #12345" />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Supplier" value={form.supplier} onChange={ef('supplier')} placeholder="Inspirations Paint" />
            <Input label="Receipt / invoice no." value={form.receipt_no} onChange={ef('receipt_no')} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Select label="Category" value={form.category} onChange={ef('category')} options={CATEGORIES} />
            <Select label="Billing type" value={form.billing_type} onChange={ef('billing_type')} options={BILLING_TYPES} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Input label="Cost ex GST ($)" type="number" value={form.cost_ex_gst} onChange={ef('cost_ex_gst')} />
            <Input label="GST ($)" type="number" value={form.gst} onChange={ef('gst')} />
            <Input label="Total inc GST ($)" type="number" value={form.total_inc_gst} onChange={ef('total_inc_gst')} />
          </div>
          <TextArea label="Notes" value={form.notes} onChange={ef('notes')} />
        </div>
        <div className="flex justify-between mt-5 pt-4 border-t border-gray-800">
          <div>
            {form.id && (
              <button onClick={() => { if (confirm('Delete?')) { del.mutate(form.id); setModalOpen(false) } }}
                className="flex items-center gap-1.5 text-sm text-red-400 hover:text-red-300">
                <Trash2 size={14} /> Delete
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={() => setModalOpen(false)} className="text-sm px-4 py-2 rounded-lg bg-gray-800 text-gray-400 hover:text-white">Cancel</button>
            <button onClick={save} disabled={saving} className="flex items-center gap-1.5 text-sm px-5 py-2 rounded-lg bg-yellow-400 hover:bg-yellow-300 text-gray-900 font-semibold disabled:opacity-50">
              {saving && <Loader2 size={13} className="animate-spin" />} Save
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
