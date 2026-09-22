import { useState, useMemo, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Modal } from '@/components/ui/Modal'
import { Input, Select, TextArea } from '@/components/ui/Field'
import { fmtCurrency, fmtDate, genId, today } from '@/lib/utils'
import { extractInvoice } from '@/lib/ai'
import { useBusinessSettings } from '@/pages/SettingsPage'
import {
  Plus, Loader2, Trash2, Edit2, Scan, AlertCircle,
  Camera, ScanLine, ArrowUpDown, X, Info, AlertTriangle, MapPin,
} from 'lucide-react'

const CATEGORIES = ['Paint', 'Primer/Undercoat', 'Filler/Putty', 'Tape/Masking', 'Brushes/Rollers', 'Sandpaper/Prep', 'Caulk/Sealant', 'Solvent/Cleaner', 'Hardware', 'Other']
const BILLING_TYPES = ['Fixed Quote', 'Hourly', 'Hourly/Estimate']

// V16 .ii / .is — borderless inline table controls
const II = 'border-none bg-transparent text-[12.5px] w-full focus:outline-none focus:bg-blue-50/60 rounded px-0.5'
const IS = 'border-none bg-transparent text-xs cursor-pointer focus:outline-none max-w-[150px]'

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
  const [dupOf, setDupOf] = useState<any | null>(null)          // V16 duplicate invoice check
  const [autoJob, setAutoJob] = useState<any | null>(null)       // job matched from the invoice address
  const [scanItems, setScanItems] = useState<any[]>([])
  const [showItems, setShowItems] = useState(false)
  const [asc, setAsc] = useState(false)
  const scanInputRef = useRef<HTMLInputElement>(null)
  const camRef = useRef<HTMLInputElement>(null)
  const galRef = useRef<HTMLInputElement>(null)

  // V16 scanMatInvoice — open the form, then run OCR into it
  async function handleHeaderScan(e: React.ChangeEvent<HTMLInputElement>) {
    if (!e.target.files?.[0]) return
    setForm(emptyForm())
    setScanError(null)
    setModalOpen(true)
    await handleScan(e)
  }

  // Inline edit — save a single field immediately
  async function quickEdit(m: any, patch: Record<string, any>) {
    await upsert.mutateAsync({ ...m, ...patch })
  }

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
    const rows = materials.filter(m => {
      const matchSearch = !s || [m.mat_desc, m.supplier, m.receipt_no, m.notes, m.job_id].some(v => v?.toLowerCase().includes(s))
      const matchCat = catFilter === 'All' || m.category === catFilter
      const matchJob = jobFilter === 'All' || m.job_id === jobFilter
      return matchSearch && matchCat && matchJob
    })
    return [...rows].sort((a, b) => {
      const da = a.date || '', db = b.date || ''
      return asc ? (da < db ? -1 : da > db ? 1 : 0) : (da > db ? -1 : da < db ? 1 : 0)
    })
  }, [materials, search, catFilter, jobFilter, asc])

  const totals = useMemo(() => ({
    ex: filtered.reduce((s, m) => s + (m.cost_ex_gst ?? 0), 0),
    gst: filtered.reduce((s, m) => s + (m.gst ?? 0), 0),
    inc: filtered.reduce((s, m) => s + (m.total_inc_gst ?? 0), 0),
  }), [filtered])

  function resetScanState() {
    setScanError(null); setDupOf(null); setAutoJob(null); setScanItems([]); setShowItems(false)
  }

  function openNew() {
    setForm(emptyForm())
    resetScanState()
    setModalOpen(true)
  }

  function openEdit(m: any) {
    setForm({ ...emptyForm(), ...m })
    resetScanState()
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
    resetScanState()
    try {
      const result = await extractInvoice(apiKey, file)

      // V16: warn if this invoice number is already on file
      const invNo = (result.receipt_no || '').trim()
      setDupOf(invNo
        ? materials.find(m => (m.receipt_no || '').trim().toLowerCase() === invNo.toLowerCase()) ?? null
        : null)

      // V16: auto-match a job from the delivery address on the invoice
      const addr = (result.job_address || '').toLowerCase().trim()
      const matched = addr
        ? jobs.find(j => {
            const a = (j.address || '').toLowerCase()
            if (!a) return false
            return a.includes(addr.split(',')[0]) || addr.includes(a.split(',')[0])
          })
        : undefined
      setAutoJob(matched ?? null)
      setScanItems(result.items ?? [])

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
        job_id:        matched?.id ?? f.job_id,
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
        ...(scanItems.length ? { extra: { line_items: scanItems } } : {}),
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
    <div className="p-5">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <h2 className="text-[17px] font-semibold text-gray-900">Materials</h2>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => camRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] bg-white border border-black/20 rounded-lg hover:bg-[#f5f4f0]">
            <Camera size={14} /> Camera
          </button>
          <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleHeaderScan} />
          <button onClick={() => galRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] bg-white border border-black/20 rounded-lg hover:bg-[#f5f4f0]">
            <ScanLine size={14} /> Gallery
          </button>
          <input ref={galRef} type="file" accept="image/*" className="hidden" onChange={handleHeaderScan} />
          <button onClick={openNew}
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white font-medium text-[13px] px-3 py-1.5 rounded-lg transition-colors">
            <Plus size={14} /> Add Material
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border border-black/[0.12] rounded-xl px-3.5 py-3 mb-2.5">
        <div className="flex gap-2 flex-wrap items-center">
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Search supplier, item, notes..."
            className="flex-[2] min-w-[180px] px-2.5 py-2 text-[13px] bg-white border border-black/20 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500" />
          <select value={jobFilter} onChange={e => setJobFilter(e.target.value)}
            className="flex-1 min-w-[150px] px-2.5 py-2 text-[13px] bg-white border border-black/20 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500">
            <option value="All">All jobs</option>
            {jobs.map(j => <option key={j.id} value={j.id}>{j.id} — {j.client}{j.address ? ` — ${j.address}` : ''}</option>)}
          </select>
          <select value={catFilter} onChange={e => setCatFilter(e.target.value)}
            className="flex-1 min-w-[140px] px-2.5 py-2 text-[13px] bg-white border border-black/20 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500">
            <option value="All">All categories</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <button onClick={() => setAsc(a => !a)} title="Toggle sort order"
            className="flex items-center gap-1 px-2.5 py-2 text-[13px] bg-white border border-black/20 rounded-lg hover:bg-[#f5f4f0] whitespace-nowrap">
            <ArrowUpDown size={13} /> {asc ? 'Oldest first' : 'Newest first'}
          </button>
          {(search || jobFilter !== 'All' || catFilter !== 'All') && (
            <button onClick={() => { setSearch(''); setJobFilter('All'); setCatFilter('All') }}
              className="flex items-center gap-1 px-2.5 py-2 text-[13px] bg-white border border-black/20 rounded-lg hover:bg-[#f5f4f0] text-[#c0392b]">
              <X size={13} /> Clear
            </button>
          )}
        </div>
      </div>

      <div className="text-[11px] text-[#666] mb-2 flex items-center gap-1">
        <Info size={12} /> Edit inline. Set billing type to include materials in a client invoice.
      </div>

      {/* V16 inline-editable table */}
      <div className="bg-white rounded-xl border border-black/[0.12] overflow-hidden">
        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 size={20} className="animate-spin text-blue-600" /></div>
        ) : (
          <div className="overflow-auto max-h-[70vh]">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr>
                  {['Date','Job','Supplier','Item','Ex GST','GST','Inc GST','Billing','Category','Notes',''].map((h, i) => (
                    <th key={i} className="text-left px-2.5 py-[7px] border-b border-black/[0.12] text-[#666] font-medium whitespace-nowrap bg-[#fafaf8] sticky top-0 z-[2]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(m => (
                  <tr key={m.id} className="border-b border-black/[0.06] hover:bg-[#fafaf8]">
                    <td className="px-2.5 py-[7px]">
                      <input type="date" defaultValue={m.date ?? ''} className={II} style={{ width: 118 }}
                        onBlur={e => { if (e.target.value !== (m.date ?? '')) quickEdit(m, { date: e.target.value || null }) }} />
                    </td>
                    <td className="px-2.5 py-[7px]" style={{ minWidth: 150 }}>
                      <select value={m.job_id ?? ''} className={IS}
                        onChange={e => {
                          const j = jobs.find(x => x.id === e.target.value)
                          quickEdit(m, { job_id: e.target.value || null, client: j?.client ?? m.client })
                        }}>
                        <option value="">Job…</option>
                        {jobs.map(j => <option key={j.id} value={j.id}>{j.id} — {j.client}</option>)}
                      </select>
                    </td>
                    <td className="px-2.5 py-[7px]">
                      <input defaultValue={m.supplier ?? ''} className={II} style={{ width: 90 }}
                        onBlur={e => { if (e.target.value !== (m.supplier ?? '')) quickEdit(m, { supplier: e.target.value }) }} />
                    </td>
                    <td className="px-2.5 py-[7px]" style={{ maxWidth: 180 }}>
                      <input defaultValue={m.mat_desc ?? ''} className={II}
                        onBlur={e => { if (e.target.value !== (m.mat_desc ?? '')) quickEdit(m, { mat_desc: e.target.value }) }} />
                    </td>
                    <td className="px-2.5 py-[7px]">
                      <input type="number" step="0.01" defaultValue={(m.cost_ex_gst ?? 0).toFixed(2)} className={II} style={{ width: 76 }}
                        onBlur={e => {
                          const ex = parseFloat(e.target.value) || 0
                          if (ex === (m.cost_ex_gst ?? 0)) return
                          const gst = Math.round(ex * 10) / 100
                          quickEdit(m, { cost_ex_gst: ex, gst, total_inc_gst: ex + gst })
                        }} />
                    </td>
                    <td className="px-2.5 py-[7px] text-[#666]">{fmtCurrency(m.gst ?? 0)}</td>
                    <td className="px-2.5 py-[7px] font-medium">{fmtCurrency(m.total_inc_gst ?? 0)}</td>
                    <td className="px-2.5 py-[7px]">
                      <select value={m.billing_type ?? 'Fixed Quote'} className={`${IS} text-[11px]`}
                        onChange={e => quickEdit(m, { billing_type: e.target.value })}>
                        <option>Hourly</option>
                        <option>Hourly/Estimate</option>
                        <option>Fixed Quote</option>
                      </select>
                    </td>
                    <td className="px-2.5 py-[7px]">
                      <select value={m.category ?? ''} className={`${IS} text-[11px]`}
                        onChange={e => quickEdit(m, { category: e.target.value })}>
                        <option value="">—</option>
                        {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </td>
                    <td className="px-2.5 py-[7px]">
                      <input defaultValue={m.notes ?? ''} placeholder="Notes…" className={II} style={{ width: 90 }}
                        onBlur={e => { if (e.target.value !== (m.notes ?? '')) quickEdit(m, { notes: e.target.value }) }} />
                    </td>
                    <td className="px-2.5 py-[7px] whitespace-nowrap">
                      <button onClick={() => openEdit(m)} title="Edit"
                        className="ml-1 px-1.5 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700 align-middle"><Edit2 size={12} /></button>
                      <button onClick={() => { if (confirm('Delete this material?')) del.mutate(m.id) }} title="Delete"
                        className="ml-1 px-1.5 py-1 rounded-md bg-white border border-black/20 hover:bg-[#f5f4f0] align-middle text-[#c0392b]"><Trash2 size={12} /></button>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={11} className="text-center py-6 text-[#666]">No entries found.</td></tr>
                )}
              </tbody>
              {filtered.length > 0 && (
                <tfoot>
                  <tr className="bg-[#fafaf8] font-semibold">
                    <td colSpan={4} className="px-2.5 py-2 text-right">Total ({filtered.length} entries)</td>
                    <td className="px-2.5 py-2">{fmtCurrency(totals.ex)}</td>
                    <td className="px-2.5 py-2 text-[#666]">{fmtCurrency(totals.gst)}</td>
                    <td className="px-2.5 py-2">{fmtCurrency(totals.inc)}</td>
                    <td colSpan={4} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>

      {/* Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} size="lg">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-gray-900">{form.id ? 'Edit material' : 'Add material'}</h2>
          <label className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors cursor-pointer
            ${scanning ? 'border-blue-500/50 bg-blue-600/10 text-blue-600' : 'border-gray-200 bg-gray-50 text-gray-500 hover:text-gray-900 hover:border-gray-600'}`}>
            <input ref={scanInputRef} type="file" accept="image/*" className="hidden" onChange={handleScan} disabled={scanning} />
            {scanning ? <Loader2 size={12} className="animate-spin" /> : <Scan size={12} />}
            {scanning ? 'Scanning…' : 'Scan invoice'}
          </label>
        </div>
        {dupOf && (
          <div className="flex gap-2 items-start bg-[#fef2f2] border border-[#fca5a5] rounded-lg px-3.5 py-2.5 mb-3.5">
            <AlertTriangle size={18} className="text-[#dc2626] shrink-0 mt-px" />
            <div>
              <strong className="text-[#dc2626] text-[13px]">Invoice already uploaded</strong>
              <div className="text-xs text-[#7f1d1d] mt-0.5">
                Invoice <strong>{dupOf.receipt_no}</strong> was previously saved
                ({[dupOf.supplier, dupOf.date].filter(Boolean).join(' · ')}
                {dupOf.total_inc_gst ? ` · ${fmtCurrency(dupOf.total_inc_gst)}` : ''}).
                Check before saving again.
              </div>
              <button onClick={() => { setDupOf(null); openEdit(dupOf) }}
                className="text-xs text-[#dc2626] underline mt-1">Open the existing entry instead</button>
            </div>
          </div>
        )}

        {autoJob && (
          <div className="flex gap-2 items-center bg-[#f0fdf4] border border-[#86efac] rounded-lg px-3.5 py-2 mb-3.5 text-xs text-[#166534]">
            <MapPin size={14} className="shrink-0" />
            Auto-matched to <strong>{autoJob.id}</strong> — {autoJob.client} from the address on the invoice.
          </div>
        )}

        {scanItems.length > 0 && (
          <div className="mb-3.5">
            <button onClick={() => setShowItems(v => !v)}
              className="w-full text-left text-xs font-semibold text-[#2563eb] px-3 py-2 bg-[#f5f4f0] rounded-lg">
              {scanItems.length} line item{scanItems.length !== 1 ? 's' : ''} extracted — click to review
            </button>
            {showItems && (
              <table className="w-full text-xs mt-1.5 border-collapse">
                <thead>
                  <tr>
                    <th className="text-left px-1.5 py-1 border-b border-black/[0.12] text-[#666] font-medium">Description</th>
                    <th className="w-12 text-center px-1.5 py-1 border-b border-black/[0.12] text-[#666] font-medium">Qty</th>
                    <th className="w-24 text-right px-1.5 py-1 border-b border-black/[0.12] text-[#666] font-medium">Ex GST</th>
                  </tr>
                </thead>
                <tbody>
                  {scanItems.map((it, i) => (
                    <tr key={i}>
                      <td className="px-1.5 py-1 border-b border-black/[0.06]">{it.description || '—'}</td>
                      <td className="px-1.5 py-1 border-b border-black/[0.06] text-center text-[#666]">{it.qty || 1}</td>
                      <td className="px-1.5 py-1 border-b border-black/[0.06] text-right">{fmtCurrency(it.total_ex_gst)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

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
              <label className="text-xs font-medium text-gray-500">Job</label>
              <select value={form.job_id} onChange={ef('job_id')}
                className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500">
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
        <div className="flex justify-between mt-5 pt-4 border-t border-gray-200">
          <div>
            {form.id && (
              <button onClick={() => { if (confirm('Delete?')) { del.mutate(form.id); setModalOpen(false) } }}
                className="flex items-center gap-1.5 text-sm text-red-400 hover:text-red-300">
                <Trash2 size={14} /> Delete
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={() => setModalOpen(false)} className="text-sm px-4 py-2 rounded-lg bg-gray-50 text-gray-500 hover:text-gray-900">Cancel</button>
            <button onClick={save} disabled={saving} className="flex items-center gap-1.5 text-sm px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-gray-900 font-semibold disabled:opacity-50">
              {saving && <Loader2 size={13} className="animate-spin" />} Save
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
