import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Modal } from '@/components/ui/Modal'
import { Input, Select, TextArea } from '@/components/ui/Field'
import { Badge } from '@/components/ui/Badge'
import { fmtDate, genId, today } from '@/lib/utils'
import { Plus, Loader2, Trash2, Edit2, Search, Phone, Mail, MapPin, ArrowRight } from 'lucide-react'

const STATUSES = ['New','Contacted','Quote Sent','Booked','Lost','Spam']
const SOURCES  = ['Word of mouth','Google','Facebook','Instagram','Flyer','Builder referral','Return client','Other']

const STATUS_ORDER: Record<string, number> = {
  'New': 0, 'Contacted': 1, 'Quote Sent': 2, 'Booked': 3, 'Lost': 4, 'Spam': 5
}

function useEnquiries() {
  const { user } = useAuth()
  return useQuery<any[]>({
    queryKey: ['np_enquiries', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('np_enquiries').select('*').eq('user_id', user!.id).order('created_at', { ascending: false })
      if (error) throw error
      return data ?? []
    },
    enabled: !!user,
  })
}

function useUpsertEnquiry() {
  const qc = useQueryClient()
  const { user } = useAuth()
  return useMutation({
    mutationFn: async (row: any) => {
      const { error } = await supabase.from('np_enquiries').upsert({ ...row, user_id: user!.id, updated_at: new Date().toISOString() } as any)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['np_enquiries'] }),
  })
}

function useDeleteEnquiry() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('np_enquiries').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['np_enquiries'] }),
  })
}

// ── Kanban card ────────────────────────────────────────────────
function EnqCard({ enq, onEdit, onDelete, onMove }: { enq: any; onEdit: () => void; onDelete: () => void; onMove: (status: string) => void }) {
  const nextStatus = STATUSES[STATUSES.indexOf(enq.enq_status) + 1]
  return (
    <div className="bg-gray-800 rounded-xl border border-gray-700 p-3 space-y-2 hover:border-gray-600 transition-colors group">
      <div className="flex items-start justify-between gap-2">
        <div className="font-medium text-sm text-white leading-tight">{enq.client || 'Unknown'}</div>
        <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <button onClick={onEdit} className="text-gray-500 hover:text-yellow-400"><Edit2 size={12} /></button>
          <button onClick={onDelete} className="text-gray-500 hover:text-red-400"><Trash2 size={12} /></button>
        </div>
      </div>

      {enq.address && (
        <div className="flex items-center gap-1 text-xs text-gray-400 truncate">
          <MapPin size={10} className="shrink-0" /> {enq.address}
        </div>
      )}
      <div className="flex items-center gap-2 flex-wrap">
        {enq.phone && (
          <a href={`tel:${enq.phone}`} className="flex items-center gap-1 text-xs text-gray-400 hover:text-white">
            <Phone size={10} /> {enq.phone}
          </a>
        )}
        {enq.email && (
          <a href={`mailto:${enq.email}`} className="flex items-center gap-1 text-xs text-gray-400 hover:text-white truncate">
            <Mail size={10} /> {enq.email}
          </a>
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-gray-500">{fmtDate(enq.date)}</span>
          {enq.source && <span className="text-xs text-gray-500">· {enq.source}</span>}
        </div>
        {nextStatus && !['Lost','Spam'].includes(nextStatus) && (
          <button onClick={() => onMove(nextStatus)}
            className="flex items-center gap-0.5 text-xs text-gray-500 hover:text-yellow-400 transition-colors">
            {nextStatus} <ArrowRight size={10} />
          </button>
        )}
      </div>

      {enq.notes && <p className="text-xs text-gray-500 line-clamp-2">{enq.notes}</p>}
    </div>
  )
}

// ── Kanban column ──────────────────────────────────────────────
function Column({ status, enqs, onEdit, onDelete, onMove }: {
  status: string; enqs: any[];
  onEdit: (e: any) => void; onDelete: (id: string) => void; onMove: (id: string, s: string) => void
}) {
  const COLORS: Record<string, string> = {
    'New':        'text-blue-400 border-blue-800',
    'Contacted':  'text-purple-400 border-purple-800',
    'Quote Sent': 'text-amber-400 border-amber-800',
    'Booked':     'text-green-400 border-green-800',
    'Lost':       'text-red-400 border-red-800',
    'Spam':       'text-gray-400 border-gray-700',
  }
  return (
    <div className="flex flex-col min-w-[220px] w-[220px]">
      <div className={`flex items-center justify-between mb-3 pb-2 border-b ${COLORS[status] || 'text-gray-400 border-gray-700'}`}>
        <span className="text-xs font-semibold uppercase tracking-wide">{status}</span>
        <span className="text-xs font-mono bg-gray-800 px-1.5 py-0.5 rounded">{enqs.length}</span>
      </div>
      <div className="space-y-2 flex-1 overflow-y-auto max-h-[calc(100vh-280px)] pr-0.5">
        {enqs.map(e => (
          <EnqCard key={e.id} enq={e}
            onEdit={() => onEdit(e)}
            onDelete={() => onDelete(e.id)}
            onMove={(s) => onMove(e.id, s)}
          />
        ))}
        {!enqs.length && (
          <div className="rounded-lg border border-dashed border-gray-700 p-3 text-xs text-gray-600 text-center">Empty</div>
        )}
      </div>
    </div>
  )
}

// ── List view row ─────────────────────────────────────────────
function ListRow({ enq, onEdit, onDelete }: { enq: any; onEdit: () => void; onDelete: () => void }) {
  return (
    <tr className="border-t border-gray-800 hover:bg-gray-800/40 group">
      <td className="px-3 py-2.5 text-sm text-white font-medium">{enq.client || '—'}</td>
      <td className="px-3 py-2.5 text-sm text-gray-400 max-w-[180px] truncate">{enq.address || '—'}</td>
      <td className="px-3 py-2.5 text-sm text-gray-400">{enq.phone || '—'}</td>
      <td className="px-3 py-2.5 text-sm text-gray-400">{fmtDate(enq.date)}</td>
      <td className="px-3 py-2.5"><Badge label={enq.enq_status || 'New'} /></td>
      <td className="px-3 py-2.5 text-sm text-gray-400">{enq.source || '—'}</td>
      <td className="px-3 py-2.5 text-right">
        <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={onEdit} className="text-gray-500 hover:text-yellow-400"><Edit2 size={13} /></button>
          <button onClick={onDelete} className="text-gray-500 hover:text-red-400"><Trash2 size={13} /></button>
        </div>
      </td>
    </tr>
  )
}

// ── Main ──────────────────────────────────────────────────────
export default function Enquiries() {
  const { data: enquiries = [], isLoading } = useEnquiries()
  const upsert = useUpsertEnquiry()
  const del = useDeleteEnquiry()

  const [view, setView] = useState<'kanban' | 'list'>('kanban')
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<any>({})
  const [saving, setSaving] = useState(false)

  const ef = (k: string) => (e: React.ChangeEvent<any>) =>
    setForm((p: any) => ({ ...p, [k]: e.target.value }))

  function openNew() { setForm({ date: today(), enq_status: 'New' }); setOpen(true) }
  function openEdit(e: any) { setForm({ ...e }); setOpen(true) }

  async function save() {
    setSaving(true)
    try {
      await upsert.mutateAsync({ ...form, id: form.id || genId('enq') })
      setOpen(false)
    } finally { setSaving(false) }
  }

  async function moveStatus(id: string, status: string) {
    const enq = enquiries.find(e => e.id === id)
    if (!enq) return
    await upsert.mutateAsync({ ...enq, enq_status: status })
  }

  const filtered = useMemo(() => {
    let out = enquiries
    if (search) {
      const q = search.toLowerCase()
      out = out.filter(e => [e.client, e.address, e.phone, e.email, e.notes].some(f => f?.toLowerCase().includes(q)))
    }
    if (filterStatus) out = out.filter(e => e.enq_status === filterStatus)
    return out
  }, [enquiries, search, filterStatus])

  const byStatus = useMemo(() => {
    const map: Record<string, any[]> = {}
    STATUSES.forEach(s => { map[s] = [] })
    filtered.forEach(e => {
      const s = e.enq_status || 'New'
      if (!map[s]) map[s] = []
      map[s].push(e)
    })
    return map
  }, [filtered])

  // Stats
  const newCount    = enquiries.filter(e => e.enq_status === 'New').length
  const bookedCount = enquiries.filter(e => e.enq_status === 'Booked').length
  const lostCount   = enquiries.filter(e => e.enq_status === 'Lost').length
  const convRate    = enquiries.length ? Math.round((bookedCount / enquiries.length) * 100) : 0

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-white">Enquiries</h1>
        <button onClick={openNew}
          className="flex items-center gap-1.5 bg-yellow-400 hover:bg-yellow-300 text-gray-900 font-semibold text-sm px-3 py-1.5 rounded-lg transition-colors">
          <Plus size={14} /> New enquiry
        </button>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Total', value: enquiries.length, color: 'text-white' },
          { label: 'New', value: newCount, color: 'text-blue-400' },
          { label: 'Booked', value: bookedCount, color: 'text-green-400' },
          { label: 'Conversion', value: `${convRate}%`, color: convRate >= 50 ? 'text-green-400' : 'text-amber-400' },
        ].map(s => (
          <div key={s.label} className="bg-gray-900 rounded-xl border border-gray-800 p-3 flex items-center justify-between">
            <span className="text-xs text-gray-400">{s.label}</span>
            <span className={`text-xl font-bold ${s.color}`}>{s.value}</span>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search…"
            className="w-full bg-gray-900 border border-gray-700 rounded-lg pl-8 pr-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-yellow-400/50" />
        </div>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-yellow-400/50">
          <option value="">All statuses</option>
          {STATUSES.map(s => <option key={s}>{s}</option>)}
        </select>
        <div className="flex gap-1 ml-auto">
          <button onClick={() => setView('kanban')}
            className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${view === 'kanban' ? 'bg-yellow-400 text-gray-900' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
            Kanban
          </button>
          <button onClick={() => setView('list')}
            className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${view === 'list' ? 'bg-yellow-400 text-gray-900' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
            List
          </button>
        </div>
      </div>

      {/* Content */}
      {isLoading
        ? <div className="flex justify-center py-16"><Loader2 size={20} className="animate-spin text-yellow-400" /></div>
        : view === 'kanban'
          ? (
            <div className="overflow-x-auto">
              <div className="flex gap-4 pb-4 min-w-max">
                {STATUSES.map(s => (
                  <Column key={s} status={s} enqs={byStatus[s] || []}
                    onEdit={openEdit}
                    onDelete={id => { if (confirm('Delete this enquiry?')) del.mutate(id) }}
                    onMove={moveStatus}
                  />
                ))}
              </div>
            </div>
          )
          : (
            <div className="overflow-x-auto rounded-xl border border-gray-800">
              <table className="w-full">
                <thead>
                  <tr>
                    {['Client','Address','Phone','Date','Status','Source',''].map(h => (
                      <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(e => (
                    <ListRow key={e.id} enq={e}
                      onEdit={() => openEdit(e)}
                      onDelete={() => { if (confirm('Delete this enquiry?')) del.mutate(e.id) }}
                    />
                  ))}
                  {!filtered.length && (
                    <tr><td colSpan={7} className="text-center py-10 text-gray-500 text-sm">No enquiries found</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )
      }

      {/* Modal */}
      <Modal open={open} onClose={() => setOpen(false)} title={form.id ? 'Edit enquiry' : 'New enquiry'} size="lg">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Input label="Client name" value={form.client || ''} onChange={ef('client')} />
            <Input label="Date" type="date" value={form.date || ''} onChange={ef('date')} />
          </div>
          <Input label="Address" value={form.address || ''} onChange={ef('address')} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Phone" type="tel" value={form.phone || ''} onChange={ef('phone')} />
            <Input label="Email" type="email" value={form.email || ''} onChange={ef('email')} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Select label="Status" value={form.enq_status || 'New'} onChange={ef('enq_status')} options={STATUSES} />
            <Select label="Source" value={form.source || ''} onChange={ef('source')} options={SOURCES} placeholder="— Select —" />
          </div>
          <TextArea label="Notes" value={form.notes || ''} onChange={ef('notes')} rows={3} />
          {form.enq_status === 'Booked' && (
            <Input label="Converted to job ID (optional)" value={form.job_id || ''} onChange={ef('job_id')} placeholder="e.g. NP-0042" />
          )}
        </div>
        <div className="flex justify-between mt-5 pt-4 border-t border-gray-800">
          <div>
            {form.id && (
              <button onClick={() => { if (confirm('Delete this enquiry?')) { del.mutate(form.id); setOpen(false) } }}
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
