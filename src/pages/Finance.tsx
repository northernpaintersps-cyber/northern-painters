import { useState, useMemo, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Modal } from '@/components/ui/Modal'
import { Input, Select, TextArea } from '@/components/ui/Field'
import { StatCard } from '@/components/ui/StatCard'
import { fmtCurrency, fmtDate, genId, today, exToGST, exToInc, inQuarter, inYear, getQuarter } from '@/lib/utils'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell
} from 'recharts'
import { Plus, Loader2, Trash2, Edit2, ChevronDown, ChevronUp } from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────
type Tab = 'labour' | 'materials' | 'expenses' | 'paySchedules' | 'bas'

const EXPENSE_CATS = ['Advertising','Equipment','Fuel','Insurance','Office','Subcontractor','Tools','Vehicle','Other']
const MAT_CATS = ['Paint','Primer','Filler','Tape','Sheets','Brushes','Rollers','Sundries','Other']
const PAYMENT_TYPES = ['ABN','Employee','Cash']
const BAS_QUARTERS = [
  { label: 'Q1 Jul–Sep', q: 1 },
  { label: 'Q2 Oct–Dec', q: 2 },
  { label: 'Q3 Jan–Mar', q: 3 },
  { label: 'Q4 Apr–Jun', q: 4 },
]

// ── Hooks ─────────────────────────────────────────────────────
function useTable<T>(table: string) {
  const { user } = useAuth()
  return useQuery<T[]>({
    queryKey: [table, user?.id],
    queryFn: async () => {
      const { data, error } = await (supabase.from(table as any) as any).select('*').eq('user_id', user!.id).order('date', { ascending: false })
      if (error) throw error
      return data ?? []
    },
    enabled: !!user,
  })
}

function useUpsert(table: string) {
  const qc = useQueryClient()
  const { user } = useAuth()
  return useMutation({
    mutationFn: async (row: any) => {
      const { error } = await (supabase.from(table as any) as any).upsert({ ...row, user_id: user!.id, updated_at: new Date().toISOString() })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [table] }),
  })
}

function useDelete(table: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.from(table as any) as any).delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [table] }),
  })
}

function useJobs() {
  const { user } = useAuth()
  return useQuery<any[]>({
    queryKey: ['np_jobs_fin', user?.id],
    queryFn: async () => {
      const { data } = await supabase.from('np_jobs').select('id,client').eq('user_id', user!.id)
      return data ?? []
    },
    enabled: !!user,
  })
}

function useInvoices() {
  const { user } = useAuth()
  return useQuery<any[]>({
    queryKey: ['np_invoices_fin', user?.id],
    queryFn: async () => {
      const { data } = await supabase.from('np_invoices').select('*').eq('user_id', user!.id)
      return data ?? []
    },
    enabled: !!user,
  })
}

// ── Job select helper (value+label options) ───────────────────
const SEL_BASE = 'w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 cursor-pointer'
function JobSelect({ label, value, onChange, jobs }: { label: string; value: string; onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void; jobs: any[] }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-gray-500">{label}</label>
      <select value={value} onChange={onChange} className={SEL_BASE}>
        <option value="">— No job —</option>
        {jobs.map(j => <option key={j.id} value={j.id}>{j.id} {j.client || ''}</option>)}
      </select>
    </div>
  )
}

// ── Small row components ──────────────────────────────────────
function Row({ cells, onEdit, onDelete }: { cells: React.ReactNode[]; onEdit: () => void; onDelete: () => void }) {
  return (
    <tr className="border-t border-gray-200 hover:bg-gray-50/40 group">
      {cells.map((c, i) => <td key={i} className="px-3 py-2.5 text-sm text-gray-600 whitespace-nowrap">{c}</td>)}
      <td className="px-3 py-2.5 text-right">
        <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={onEdit} className="text-gray-500 hover:text-blue-600"><Edit2 size={13} /></button>
          <button onClick={onDelete} className="text-gray-500 hover:text-red-400"><Trash2 size={13} /></button>
        </div>
      </td>
    </tr>
  )
}

function THead({ cols }: { cols: string[] }) {
  return (
    <thead>
      <tr>
        {cols.map(c => <th key={c} className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{c}</th>)}
        <th className="w-16" />
      </tr>
    </thead>
  )
}

// ── Labour tab ────────────────────────────────────────────────
function LabourTab({ jobs }: { jobs: any[] }) {
  const { data: rows = [], isLoading } = useTable<any>('np_labour')
  const upsert = useUpsert('np_labour')
  const del = useDelete('np_labour')
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<any>({})
  const [saving, setSaving] = useState(false)

  const ef = (k: string) => (e: React.ChangeEvent<any>) => {
    setForm((p: any) => {
      const v = e.target.value
      const next = { ...p, [k]: v }
      if (k === 'hours' || k === 'rate') {
        const h = parseFloat(k === 'hours' ? v : p.hours) || 0
        const r = parseFloat(k === 'rate' ? v : p.rate) || 0
        next.cost = h * r
      }
      return next
    })
  }

  function openNew() { setForm({ date: today(), worker_payment_type: 'ABN' }); setOpen(true) }
  function openEdit(r: any) { setForm({ ...r }); setOpen(true) }

  async function save() {
    setSaving(true)
    try {
      await upsert.mutateAsync({ ...form, id: form.id || genId('lb') })
      setOpen(false)
    } finally { setSaving(false) }
  }

  const total = rows.reduce((s, r) => s + (r.cost ?? (r.hours ?? 0) * (r.rate ?? 0)), 0)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-500">Total labour cost: <span className="text-gray-900 font-semibold">{fmtCurrency(total)}</span></div>
        <button onClick={openNew} className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-gray-900 font-semibold text-sm px-3 py-1.5 rounded-lg">
          <Plus size={14} /> Add entry
        </button>
      </div>
      {isLoading
        ? <div className="flex justify-center py-12"><Loader2 size={20} className="animate-spin text-blue-600" /></div>
        : (
          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="w-full">
              <THead cols={['Date','Job','Sub / Worker','Hours','Rate','Cost','Type','Paid']} />
              <tbody>
                {rows.map(r => (
                  <Row key={r.id}
                    cells={[
                      fmtDate(r.date),
                      r.job_id || r.client || '—',
                      r.sub || '—',
                      r.hours ?? '—',
                      r.rate ? fmtCurrency(r.rate) : '—',
                      fmtCurrency(r.cost ?? (r.hours ?? 0) * (r.rate ?? 0)),
                      r.worker_payment_type || '—',
                      r.paid ? <span className="text-green-400 text-xs">Paid</span> : <span className="text-gray-500 text-xs">Unpaid</span>,
                    ]}
                    onEdit={() => openEdit(r)}
                    onDelete={() => { if (confirm('Delete this entry?')) del.mutate(r.id) }}
                  />
                ))}
                {!rows.length && <tr><td colSpan={9} className="text-center py-8 text-gray-500 text-sm">No labour entries yet</td></tr>}
              </tbody>
            </table>
          </div>
        )
      }
      <Modal open={open} onClose={() => setOpen(false)} title={form.id ? 'Edit labour entry' : 'New labour entry'}>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Input label="Date" type="date" value={form.date || ''} onChange={ef('date')} />
            <JobSelect label="Job" value={form.job_id || ''} onChange={ef('job_id')} jobs={jobs} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Sub / worker name" value={form.sub || ''} onChange={ef('sub')} />
            <Select label="Payment type" value={form.worker_payment_type || 'ABN'} onChange={ef('worker_payment_type')} options={PAYMENT_TYPES} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Input label="Hours" type="number" value={form.hours ?? ''} onChange={ef('hours')} />
            <Input label="Rate ($/hr)" type="number" value={form.rate ?? ''} onChange={ef('rate')} />
            <Input label="Cost ($)" type="number" value={form.cost ?? ''} onChange={ef('cost')} />
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="lbpaid" checked={!!form.paid} onChange={e => setForm((p: any) => ({ ...p, paid: e.target.checked }))} className="accent-yellow-400" />
            <label htmlFor="lbpaid" className="text-sm text-gray-600">Paid</label>
          </div>
          <TextArea label="Notes" value={form.notes || ''} onChange={ef('notes')} />
        </div>
        <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-gray-200">
          <button onClick={() => setOpen(false)} className="text-sm px-4 py-2 rounded-lg bg-gray-50 text-gray-500 hover:text-gray-900">Cancel</button>
          <button onClick={save} disabled={saving} className="flex items-center gap-1.5 text-sm px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-gray-900 font-semibold disabled:opacity-50">
            {saving && <Loader2 size={13} className="animate-spin" />} Save
          </button>
        </div>
      </Modal>
    </div>
  )
}

// ── Materials tab ─────────────────────────────────────────────
function MaterialsTab({ jobs }: { jobs: any[] }) {
  const { data: rows = [], isLoading } = useTable<any>('np_materials')
  const upsert = useUpsert('np_materials')
  const del = useDelete('np_materials')
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<any>({})
  const [saving, setSaving] = useState(false)

  const ef = (k: string) => (e: React.ChangeEvent<any>) => {
    setForm((p: any) => {
      const v = e.target.value
      const next = { ...p, [k]: v }
      if (k === 'cost_ex_gst') {
        const ex = parseFloat(v) || 0
        next.gst = ex * 0.1
        next.total_inc_gst = ex * 1.1
      }
      return next
    })
  }

  function openNew() { setForm({ date: today(), category: 'Paint' }); setOpen(true) }
  function openEdit(r: any) { setForm({ ...r }); setOpen(true) }

  async function save() {
    setSaving(true)
    try {
      await upsert.mutateAsync({ ...form, id: form.id || genId('mt') })
      setOpen(false)
    } finally { setSaving(false) }
  }

  const total = rows.reduce((s, r) => s + (r.total_inc_gst ?? 0), 0)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-500">Total materials (inc GST): <span className="text-gray-900 font-semibold">{fmtCurrency(total)}</span></div>
        <button onClick={openNew} className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-gray-900 font-semibold text-sm px-3 py-1.5 rounded-lg">
          <Plus size={14} /> Add entry
        </button>
      </div>
      {isLoading
        ? <div className="flex justify-center py-12"><Loader2 size={20} className="animate-spin text-blue-600" /></div>
        : (
          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="w-full">
              <THead cols={['Date','Job','Supplier','Description','Category','Ex GST','GST','Inc GST']} />
              <tbody>
                {rows.map(r => (
                  <Row key={r.id}
                    cells={[
                      fmtDate(r.date),
                      r.job_id || r.client || '—',
                      r.supplier || '—',
                      r.mat_desc || '—',
                      r.category || '—',
                      fmtCurrency(r.cost_ex_gst),
                      fmtCurrency(r.gst),
                      fmtCurrency(r.total_inc_gst),
                    ]}
                    onEdit={() => openEdit(r)}
                    onDelete={() => { if (confirm('Delete this entry?')) del.mutate(r.id) }}
                  />
                ))}
                {!rows.length && <tr><td colSpan={9} className="text-center py-8 text-gray-500 text-sm">No material entries yet</td></tr>}
              </tbody>
            </table>
          </div>
        )
      }
      <Modal open={open} onClose={() => setOpen(false)} title={form.id ? 'Edit material entry' : 'New material entry'}>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Input label="Date" type="date" value={form.date || ''} onChange={ef('date')} />
            <JobSelect label="Job" value={form.job_id || ''} onChange={ef('job_id')} jobs={jobs} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Supplier" value={form.supplier || ''} onChange={ef('supplier')} />
            <Select label="Category" value={form.category || ''} onChange={ef('category')} options={MAT_CATS} />
          </div>
          <Input label="Description" value={form.mat_desc || ''} onChange={ef('mat_desc')} />
          <div className="grid grid-cols-3 gap-3">
            <Input label="Ex GST ($)" type="number" value={form.cost_ex_gst ?? ''} onChange={ef('cost_ex_gst')} />
            <Input label="GST ($)" type="number" value={form.gst ?? ''} onChange={ef('gst')} />
            <Input label="Inc GST ($)" type="number" value={form.total_inc_gst ?? ''} onChange={ef('total_inc_gst')} />
          </div>
          <Input label="Receipt no." value={form.receipt_no || ''} onChange={ef('receipt_no')} />
          <TextArea label="Notes" value={form.notes || ''} onChange={ef('notes')} />
        </div>
        <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-gray-200">
          <button onClick={() => setOpen(false)} className="text-sm px-4 py-2 rounded-lg bg-gray-50 text-gray-500 hover:text-gray-900">Cancel</button>
          <button onClick={save} disabled={saving} className="flex items-center gap-1.5 text-sm px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-gray-900 font-semibold disabled:opacity-50">
            {saving && <Loader2 size={13} className="animate-spin" />} Save
          </button>
        </div>
      </Modal>
    </div>
  )
}

// ── Expenses tab ──────────────────────────────────────────────
function ExpensesTab({ jobs }: { jobs: any[] }) {
  const { data: rows = [], isLoading } = useTable<any>('np_expenses')
  const upsert = useUpsert('np_expenses')
  const del = useDelete('np_expenses')
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<any>({})
  const [saving, setSaving] = useState(false)

  const ef = (k: string) => (e: React.ChangeEvent<any>) => {
    setForm((p: any) => {
      const v = e.target.value
      const next = { ...p, [k]: v }
      if (k === 'amount_ex_gst') {
        next.gst = (parseFloat(v) || 0) * 0.1
      }
      return next
    })
  }

  function openNew() { setForm({ date: today(), category: 'Other' }); setOpen(true) }
  function openEdit(r: any) { setForm({ ...r }); setOpen(true) }

  async function save() {
    setSaving(true)
    try {
      await upsert.mutateAsync({ ...form, id: form.id || genId('ex') })
      setOpen(false)
    } finally { setSaving(false) }
  }

  const totalEx = rows.reduce((s, r) => s + (r.amount_ex_gst ?? 0), 0)
  const totalGST = rows.reduce((s, r) => s + (r.gst ?? 0), 0)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-500">
          Total ex GST: <span className="text-gray-900 font-semibold">{fmtCurrency(totalEx)}</span>
          <span className="mx-2 text-gray-600">·</span>
          GST claimable: <span className="text-green-400 font-semibold">{fmtCurrency(totalGST)}</span>
        </div>
        <button onClick={openNew} className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-gray-900 font-semibold text-sm px-3 py-1.5 rounded-lg">
          <Plus size={14} /> Add expense
        </button>
      </div>
      {isLoading
        ? <div className="flex justify-center py-12"><Loader2 size={20} className="animate-spin text-blue-600" /></div>
        : (
          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="w-full">
              <THead cols={['Date','Job','Description','Category','Ex GST','GST']} />
              <tbody>
                {rows.map(r => (
                  <Row key={r.id}
                    cells={[
                      fmtDate(r.date),
                      r.job_id || '—',
                      r.exp_desc || '—',
                      r.category || '—',
                      fmtCurrency(r.amount_ex_gst),
                      fmtCurrency(r.gst),
                    ]}
                    onEdit={() => openEdit(r)}
                    onDelete={() => { if (confirm('Delete this entry?')) del.mutate(r.id) }}
                  />
                ))}
                {!rows.length && <tr><td colSpan={7} className="text-center py-8 text-gray-500 text-sm">No expenses yet</td></tr>}
              </tbody>
            </table>
          </div>
        )
      }
      <Modal open={open} onClose={() => setOpen(false)} title={form.id ? 'Edit expense' : 'New expense'}>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Input label="Date" type="date" value={form.date || ''} onChange={ef('date')} />
            <JobSelect label="Job (optional)" value={form.job_id || ''} onChange={ef('job_id')} jobs={jobs} />
          </div>
          <Input label="Description" value={form.exp_desc || ''} onChange={ef('exp_desc')} />
          <div className="grid grid-cols-3 gap-3">
            <Select label="Category" value={form.category || ''} onChange={ef('category')} options={EXPENSE_CATS} />
            <Input label="Ex GST ($)" type="number" value={form.amount_ex_gst ?? ''} onChange={ef('amount_ex_gst')} />
            <Input label="GST ($)" type="number" value={form.gst ?? ''} onChange={ef('gst')} />
          </div>
          <TextArea label="Notes" value={form.notes || ''} onChange={ef('notes')} />
        </div>
        <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-gray-200">
          <button onClick={() => setOpen(false)} className="text-sm px-4 py-2 rounded-lg bg-gray-50 text-gray-500 hover:text-gray-900">Cancel</button>
          <button onClick={save} disabled={saving} className="flex items-center gap-1.5 text-sm px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-gray-900 font-semibold disabled:opacity-50">
            {saving && <Loader2 size={13} className="animate-spin" />} Save
          </button>
        </div>
      </Modal>
    </div>
  )
}

// ── Pay Schedules tab ─────────────────────────────────────────
function PaySchedulesTab({ jobs }: { jobs: any[] }) {
  const qc = useQueryClient()
  const { user } = useAuth()
  const { data: rows = [], isLoading } = useTable<any>('np_pay_schedules')
  const { data: labourRows = [] } = useTable<any>('np_labour')
  const upsert = useUpsert('np_pay_schedules')
  const upsertLabour = useUpsert('np_labour')
  const del = useDelete('np_pay_schedules')
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<any>({})
  const [saving, setSaving] = useState(false)
  const [showSummary, setShowSummary] = useState(true)

  const ef = (k: string) => (e: React.ChangeEvent<any>) =>
    setForm((p: any) => ({ ...p, [k]: e.target.value }))

  function openNew() { setForm({ period_start: today() }); setOpen(true) }
  function openEdit(r: any) { setForm({ ...r }); setOpen(true) }

  async function save() {
    setSaving(true)
    try {
      await upsert.mutateAsync({ ...form, id: form.id || genId('ps') })
      setOpen(false)
    } finally { setSaving(false) }
  }

  // Labour by worker summary
  const workerSummary = useMemo(() => {
    const map: Record<string, { total: number; unpaid: number; entries: any[] }> = {}
    labourRows.forEach((r: any) => {
      const name = r.sub || 'Unknown'
      const cost = r.cost ?? (r.hours ?? 0) * (r.rate ?? 0)
      if (!map[name]) map[name] = { total: 0, unpaid: 0, entries: [] }
      map[name].total += cost
      if (!r.paid) map[name].unpaid += cost
      map[name].entries.push(r)
    })
    return Object.entries(map).sort((a, b) => b[1].unpaid - a[1].unpaid)
  }, [labourRows])

  async function markWorkerPaid(workerName: string, entries: any[]) {
    const unpaid = entries.filter(e => !e.paid)
    if (!unpaid.length || !confirm(`Mark ${unpaid.length} entries as paid for ${workerName}?`)) return
    for (const e of unpaid) {
      await upsertLabour.mutateAsync({ ...e, paid: true })
    }
    qc.invalidateQueries({ queryKey: ['np_labour'] })
  }

  return (
    <div className="space-y-5">
      {/* Labour by worker summary */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <button
          onClick={() => setShowSummary(v => !v)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-gray-900 hover:bg-gray-50/50 transition-colors">
          <span>Labour owed by worker</span>
          {showSummary ? <ChevronUp size={14} className="text-gray-500" /> : <ChevronDown size={14} className="text-gray-500" />}
        </button>
        {showSummary && (
          <div className="divide-y divide-gray-200">
            {workerSummary.map(([name, data]) => (
              <div key={name} className="flex items-center gap-4 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900">{name}</p>
                  <p className="text-xs text-gray-500">{data.entries.length} entries · all time total {fmtCurrency(data.total)}</p>
                </div>
                <div className="text-right">
                  <p className={`text-sm font-bold tabular-nums ${data.unpaid > 0 ? 'text-amber-400' : 'text-green-400'}`}>
                    {data.unpaid > 0 ? `${fmtCurrency(data.unpaid)} unpaid` : 'All paid'}
                  </p>
                </div>
                {data.unpaid > 0 && (
                  <button
                    onClick={() => markWorkerPaid(name, data.entries)}
                    className="text-xs px-3 py-1.5 rounded-lg bg-green-500/20 text-green-400 hover:bg-green-500/30 font-medium transition-colors whitespace-nowrap">
                    Mark paid
                  </button>
                )}
              </div>
            ))}
            {!workerSummary.length && (
              <p className="text-sm text-gray-500 text-center py-6">No labour entries yet</p>
            )}
          </div>
        )}
      </div>

      {/* Pay schedules table */}
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-900">Pay schedules</p>
        <button onClick={openNew} className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-gray-900 font-semibold text-sm px-3 py-1.5 rounded-lg">
          <Plus size={14} /> Add schedule
        </button>
      </div>
      {isLoading
        ? <div className="flex justify-center py-12"><Loader2 size={20} className="animate-spin text-blue-600" /></div>
        : (
          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="w-full">
              <THead cols={['Worker','Job','Period start','Period end','Amount','Paid']} />
              <tbody>
                {rows.map(r => (
                  <Row key={r.id}
                    cells={[
                      r.worker || '—',
                      r.job_id || '—',
                      fmtDate(r.period_start),
                      fmtDate(r.period_end),
                      fmtCurrency(r.amount),
                      r.paid ? <span className="text-green-400 text-xs">Paid</span> : <span className="text-amber-400 text-xs">Pending</span>,
                    ]}
                    onEdit={() => openEdit(r)}
                    onDelete={() => { if (confirm('Delete?')) del.mutate(r.id) }}
                  />
                ))}
                {!rows.length && <tr><td colSpan={7} className="text-center py-8 text-gray-500 text-sm">No pay schedules yet</td></tr>}
              </tbody>
            </table>
          </div>
        )
      }
      <Modal open={open} onClose={() => setOpen(false)} title={form.id && rows.find((r: any) => r.id === form.id) ? 'Edit pay schedule' : 'New pay schedule'}>
        <div className="space-y-3">
          <JobSelect label="Job (optional)" value={form.job_id || ''} onChange={ef('job_id')} jobs={jobs} />
          <Input label="Worker / subcontractor" value={form.worker || ''} onChange={ef('worker')} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Period start" type="date" value={form.period_start || ''} onChange={ef('period_start')} />
            <Input label="Period end" type="date" value={form.period_end || ''} onChange={ef('period_end')} />
          </div>
          <Input label="Amount ($)" type="number" value={form.amount ?? ''} onChange={ef('amount')} />
          <div className="flex items-center gap-2">
            <input type="checkbox" id="pspaid" checked={!!form.paid} onChange={e => setForm((p: any) => ({ ...p, paid: e.target.checked }))} className="accent-yellow-400" />
            <label htmlFor="pspaid" className="text-sm text-gray-600">Paid</label>
          </div>
          <TextArea label="Notes / milestones" value={form.notes || ''} onChange={ef('notes')} />
        </div>
        <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-gray-200">
          <button onClick={() => setOpen(false)} className="text-sm px-4 py-2 rounded-lg bg-gray-50 text-gray-500 hover:text-gray-900">Cancel</button>
          <button onClick={save} disabled={saving} className="flex items-center gap-1.5 text-sm px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-gray-900 font-semibold disabled:opacity-50">
            {saving && <Loader2 size={13} className="animate-spin" />} Save
          </button>
        </div>
      </Modal>
    </div>
  )
}

// ── BAS / GST tab ─────────────────────────────────────────────
function BasTab({ invoices, labour, materials, expenses }: { invoices: any[]; labour: any[]; materials: any[]; expenses: any[] }) {
  const now = new Date()
  const curYear = now.getFullYear()
  // Australian financial year: Jul-Jun. If before July, show previous FY.
  const finYear = now.getMonth() >= 6 ? curYear : curYear - 1
  const [year, setYear] = useState(finYear)
  const [selQ, setSelQ] = useState(BAS_QUARTERS[Math.floor(now.getMonth() / 3)])

  // Map Aus FY quarters: Q1=Jul-Sep, Q2=Oct-Dec, Q3=Jan-Mar, Q4=Apr-Jun
  function inAusQ(dateStr: string | null, y: number, q: number): boolean {
    if (!dateStr) return false
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return false
    // Q1: Jul(6)-Sep(8) of year y; Q2: Oct(9)-Dec(11) of y; Q3: Jan(0)-Mar(2) of y+1; Q4: Apr(3)-Jun(5) of y+1
    const m = d.getMonth()
    const yr = d.getFullYear()
    if (q === 1) return yr === y && m >= 6 && m <= 8
    if (q === 2) return yr === y && m >= 9 && m <= 11
    if (q === 3) return yr === y + 1 && m >= 0 && m <= 2
    if (q === 4) return yr === y + 1 && m >= 3 && m <= 5
    return false
  }

  const qInvoices = invoices.filter(i => inAusQ(i.date, year, selQ.q))
  const qLabour   = labour.filter(l => inAusQ(l.date, year, selQ.q))
  const qMats     = materials.filter(m => inAusQ(m.date, year, selQ.q))
  const qExp      = expenses.filter(e => inAusQ(e.date, year, selQ.q))

  const revenue       = qInvoices.reduce((s, i) => s + (i.total_inc_gst ?? 0), 0)
  const revenueEx     = qInvoices.reduce((s, i) => s + (i.agreed_ex_gst ?? 0), 0)
  const gstCollected  = revenue - revenueEx
  const labourCost    = qLabour.reduce((s, r) => s + (r.cost ?? (r.hours ?? 0) * (r.rate ?? 0)), 0)
  const matCostEx     = qMats.reduce((s, m) => s + (m.cost_ex_gst ?? 0), 0)
  const matGST        = qMats.reduce((s, m) => s + (m.gst ?? 0), 0)
  const expCostEx     = qExp.reduce((s, e) => s + (e.amount_ex_gst ?? 0), 0)
  const expGST        = qExp.reduce((s, e) => s + (e.gst ?? 0), 0)
  const totalGSTPaid  = matGST + expGST
  const netGST        = gstCollected - totalGSTPaid
  const netProfit     = revenueEx - labourCost - matCostEx - expCostEx

  // Chart: monthly breakdown
  const months = [
    { m: 6, lbl: 'Jul' }, { m: 7, lbl: 'Aug' }, { m: 8, lbl: 'Sep' },
    { m: 9, lbl: 'Oct' }, { m: 10, lbl: 'Nov' }, { m: 11, lbl: 'Dec' },
    { m: 0, lbl: 'Jan' }, { m: 1, lbl: 'Feb' }, { m: 2, lbl: 'Mar' },
    { m: 3, lbl: 'Apr' }, { m: 4, lbl: 'May' }, { m: 5, lbl: 'Jun' },
  ]
  const chartData = months.map(({ m, lbl }) => {
    const yr = m >= 6 ? year : year + 1
    const invMonth = invoices.filter(i => {
      if (!i.date) return false
      const d = new Date(i.date)
      return d.getFullYear() === yr && d.getMonth() === m
    })
    return {
      name: lbl,
      revenue: invMonth.reduce((s, i) => s + (i.agreed_ex_gst ?? 0), 0),
    }
  })

  return (
    <div className="space-y-6">
      {/* Period selector */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">FY</span>
          <button onClick={() => setYear(y => y - 1)} className="p-1 rounded bg-gray-50 text-gray-500 hover:text-gray-900"><ChevronDown size={14} /></button>
          <span className="text-sm font-semibold text-gray-900 w-20 text-center">{year}–{String(year + 1).slice(2)}</span>
          <button onClick={() => setYear(y => y + 1)} className="p-1 rounded bg-gray-50 text-gray-500 hover:text-gray-900"><ChevronUp size={14} /></button>
        </div>
        <div className="flex gap-1">
          {BAS_QUARTERS.map(bq => (
            <button key={bq.q} onClick={() => setSelQ(bq)}
              className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors
                ${selQ.q === bq.q ? 'bg-blue-600 text-gray-900' : 'bg-gray-50 text-gray-500 hover:text-gray-900'}`}>
              {bq.label}
            </button>
          ))}
        </div>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Revenue (ex GST)" value={fmtCurrency(revenueEx)} color="green" />
        <StatCard label="GST collected" value={fmtCurrency(gstCollected)} color="blue" />
        <StatCard label="GST paid (inputs)" value={fmtCurrency(totalGSTPaid)} color="amber" />
        <StatCard label="Net GST payable" value={fmtCurrency(netGST)} color={netGST > 0 ? 'red' : 'green'} />
      </div>

      {/* BAS summary box */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <h3 className="text-sm font-semibold text-gray-900">BAS summary — {selQ.label} {year}–{String(year + 1).slice(2)}</h3>
        <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
          {[
            ['G1 Total sales (inc GST)', fmtCurrency(revenue)],
            ['G2 Export sales', '—'],
            ['G3 Other GST-free sales', '—'],
            ['1A GST on sales', fmtCurrency(gstCollected)],
            ['G10 Capital purchases (inc GST)', fmtCurrency(matCostEx + matGST + expCostEx + expGST)],
            ['1B GST on purchases', fmtCurrency(totalGSTPaid)],
            ['Net GST payable (1A − 1B)', fmtCurrency(netGST)],
          ].map(([k, v]) => (
            <div key={String(k)} className="flex justify-between border-b border-gray-200 pb-1.5">
              <span className="text-gray-500">{k}</span>
              <span className={`font-mono font-semibold ${k === 'Net GST payable (1A − 1B)' ? (netGST > 0 ? 'text-red-400' : 'text-green-400') : 'text-gray-200'}`}>{v}</span>
            </div>
          ))}
        </div>
        <div className="pt-1 border-t border-gray-200 flex justify-between text-sm">
          <span className="text-gray-500">Estimated net profit (ex GST)</span>
          <span className={`font-mono font-semibold ${netProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>{fmtCurrency(netProfit)}</span>
        </div>
      </div>

      {/* Annual revenue chart */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-4">Monthly revenue (ex GST) — FY {year}–{String(year + 1).slice(2)}</h3>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={chartData} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false}
              tickFormatter={(v: unknown) => `$${((v as number) / 1000).toFixed(0)}k`} />
            <Tooltip
              contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: '8px', fontSize: 12 }}
              formatter={(v: unknown) => [fmtCurrency(v as number), 'Revenue']}
            />
            <Bar dataKey="revenue" radius={[4, 4, 0, 0]}>
              {chartData.map((entry, i) => (
                <Cell key={i} fill={entry.revenue > 0 ? '#facc15' : '#374151'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// ── Main Finance page ─────────────────────────────────────────
export default function Finance() {
  const [tab, setTab] = useState<Tab>('labour')
  const { data: jobs = [] } = useJobs()
  const { data: invoices = [] } = useInvoices()
  const { data: labour = [] } = useTable<any>('np_labour')
  const { data: materials = [] } = useTable<any>('np_materials')
  const { data: expenses = [] } = useTable<any>('np_expenses')

  const TABS: { key: Tab; label: string }[] = [
    { key: 'labour',       label: 'Labour log' },
    { key: 'materials',    label: 'Materials' },
    { key: 'expenses',     label: 'Expenses' },
    { key: 'paySchedules', label: 'Pay schedules' },
    { key: 'bas',          label: 'BAS / GST' },
  ]

  // Top-level summary
  const totalRevenue   = invoices.reduce((s, i) => s + (i.agreed_ex_gst ?? 0), 0)
  const totalLabour    = labour.reduce((s, r) => s + (r.cost ?? (r.hours ?? 0) * (r.rate ?? 0)), 0)
  const totalMaterials = materials.reduce((s, m) => s + (m.cost_ex_gst ?? 0), 0)
  const totalExpenses  = expenses.reduce((s, e) => s + (e.amount_ex_gst ?? 0), 0)
  const grossProfit    = totalRevenue - totalLabour - totalMaterials - totalExpenses

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-lg font-bold text-gray-900">Finance</h1>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard label="Total revenue (ex GST)" value={fmtCurrency(totalRevenue)} color="green" />
        <StatCard label="Labour cost" value={fmtCurrency(totalLabour)} color="blue" />
        <StatCard label="Materials cost" value={fmtCurrency(totalMaterials)} color="amber" />
        <StatCard label="Expenses" value={fmtCurrency(totalExpenses)} color="red" />
        <StatCard label="Gross profit" value={fmtCurrency(grossProfit)} color={grossProfit >= 0 ? 'green' : 'red'} />
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 flex gap-1 overflow-x-auto">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-px
              ${tab === t.key ? 'text-blue-600 border-blue-500' : 'text-gray-500 border-transparent hover:text-gray-900'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'labour'       && <LabourTab jobs={jobs} />}
      {tab === 'materials'    && <MaterialsTab jobs={jobs} />}
      {tab === 'expenses'     && <ExpensesTab jobs={jobs} />}
      {tab === 'paySchedules' && <PaySchedulesTab jobs={jobs} />}
      {tab === 'bas'          && <BasTab invoices={invoices} labour={labour} materials={materials} expenses={expenses} />}
    </div>
  )
}
