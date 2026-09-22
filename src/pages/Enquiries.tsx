import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Modal } from '@/components/ui/Modal'
import { Input, Select, TextArea } from '@/components/ui/Field'
import { genId, today } from '@/lib/utils'
import {
  Plus, Loader2, Trash2, Edit2, Hammer, ArrowUpDown,
  Camera, MapPin, Paperclip, Download,
} from 'lucide-react'

type Row = Record<string, any>

const STATUSES = ['New', 'Replied', 'Waiting for Answer', 'Visit Scheduled', 'Quote Sent', 'Won', 'Lost', 'No Response']
const ACTIONS = ['Send Message', 'Arrange Site Visit', 'Reschedule Visit', 'Follow Up', 'Send Quote']
const SOURCES = ['Website', 'Referral', 'Builder', 'Facebook', 'Word of Mouth', 'Other']

// V16 statusBadge()
const SBADGE: Record<string, string> = {
  'New':             'bg-[#dbeafe] text-[#1e40af]',
  'Won':             'bg-[#dcfce7] text-[#166534]',
  'Lost':            'bg-[#fee2e2] text-[#991b1b]',
  'Quote Sent':      'bg-[#fef3c7] text-[#92400e]',
  'Visit Scheduled': 'bg-[#ede9fe] text-[#5b21b6]',
}
const BADGE = 'inline-block px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap'

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
      const { error } = await (supabase.from('np_enquiries') as any)
        .upsert({ ...row, user_id: user!.id, updated_at: new Date().toISOString() })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['np_enquiries'] }),
  })
}

function useDel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.from('np_enquiries') as any).delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['np_enquiries'] }),
  })
}

export default function Enquiries() {
  const nav = useNavigate()
  const { data: enquiries = [], isLoading } = useTable('np_enquiries')
  const { data: siteVisits = [] } = useTable('np_site_visits')
  const upsert = useUpsert()
  const del = useDel()

  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [asc, setAsc] = useState(false)
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState<Row>({})
  const [saving, setSaving] = useState(false)

  const rows = useMemo(() => {
    const s = q.toLowerCase()
    const list = enquiries.filter(e => {
      if (statusFilter && e.enq_status !== statusFilter) return false
      if (s && !`${e.client ?? ''}${e.phone ?? ''}${e.email ?? ''}${e.address ?? ''}${e.notes ?? ''}`.toLowerCase().includes(s)) return false
      return true
    })
    return [...list].sort((a, b) => {
      const da = a.date || '', db = b.date || ''
      return asc ? (da < db ? -1 : da > db ? 1 : 0) : (da > db ? -1 : da < db ? 1 : 0)
    })
  }, [enquiries, q, statusFilter, asc])

  const attsOf = (e: Row): any[] => Array.isArray(e.attachments) ? e.attachments : []

  function openNew() {
    setForm({ date: today(), enq_status: 'New', source: SOURCES[0], action: ACTIONS[0], attachments: [] })
    setModal(true)
  }
  function openEdit(e: Row) {
    setForm({ ...e, attachments: attsOf(e) })
    setModal(true)
  }

  const ef = (k: string) => (ev: React.ChangeEvent<any>) => setForm(p => ({ ...p, [k]: ev.target.value }))

  async function addFiles(ev: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(ev.target.files ?? [])
    ev.target.value = ''
    for (const file of files) {
      if (file.size > 4 * 1024 * 1024) {
        alert(`${file.name} is larger than 4 MB and was skipped. Compress the PDF first.`)
        continue
      }
      const dataUrl = await new Promise<string>(res => {
        const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsDataURL(file)
      })
      setForm(p => ({
        ...p,
        attachments: [...(p.attachments ?? []), { name: file.name, size: file.size, type: file.type, dataUrl }],
      }))
    }
  }

  async function save() {
    if (!form.client?.trim()) { alert('Client name required'); return }
    setSaving(true)
    try {
      await upsert.mutateAsync({
        ...form,
        id: form.id || genId('enq'),
        created_at: form.created_at || new Date().toISOString(),
      })
      setModal(false)
    } catch (e: any) { alert('Save failed: ' + e.message) } finally { setSaving(false) }
  }

  // V16 convertEnquiry — pre-fill a new job from the enquiry
  function convert(e: Row) {
    try {
      sessionStorage.setItem('np_prefill_job', JSON.stringify({
        client: e.client || '', address: e.address || '',
        lead_source: e.source || '', job_desc: e.notes || '',
        type: e.job_type || 'Interior repaint',
        status: 'Not Started', quote_status: 'Info Collected',
        terms: 'Labour and materials', on_books: 'Invoiced', weather: 'None',
        _enq_id: e.id,
      }))
    } catch {}
    nav('/jobs?new=1')
  }

  // V16 startSVFromEnquiry
  function startSiteVisit(e: Row) {
    try {
      sessionStorage.setItem('np_prefill_visit', JSON.stringify({
        client: e.client || '', address: e.address || '', date: today(),
      }))
    } catch {}
    nav('/visits?new=1')
  }

  if (isLoading) return (
    <div className="flex items-center justify-center h-64"><Loader2 size={20} className="animate-spin text-blue-600" /></div>
  )

  return (
    <div className="p-5">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <h2 className="text-[17px] font-semibold text-gray-900">Enquiries</h2>
        <button onClick={openNew}
          className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white font-medium text-[13px] px-3 py-1.5 rounded-lg">
          <Plus size={14} /> New Enquiry
        </button>
      </div>

      <div className="grid gap-2.5 mb-3.5" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))' }}>
        {[
          { l: 'Total enquiries', v: enquiries.length, c: '#2563eb' },
          { l: 'New', v: enquiries.filter(e => e.enq_status === 'New').length },
          { l: 'Won', v: enquiries.filter(e => e.enq_status === 'Won').length, c: '#16a34a' },
          { l: 'Lost', v: enquiries.filter(e => e.enq_status === 'Lost').length, c: '#dc2626' },
        ].map(m => (
          <div key={m.l} className="bg-[#f5f4f0] rounded-lg px-4 py-3.5">
            <div className="text-[11px] text-[#666] mb-1">{m.l}</div>
            <div className="text-xl font-semibold" style={m.c ? { color: m.c } : undefined}>{m.v}</div>
          </div>
        ))}
      </div>

      <div className="flex gap-2 mb-3 flex-wrap items-center">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search..."
          className="w-[200px] px-2.5 py-1.5 text-[12.5px] bg-white border border-black/20 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500" />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="px-2.5 py-1.5 text-[12.5px] bg-white border border-black/20 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500">
          <option value="">All statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <button onClick={() => setAsc(a => !a)}
          className="flex items-center gap-1 px-2.5 py-1.5 text-[12.5px] bg-white border border-black/20 rounded-lg hover:bg-[#f5f4f0] whitespace-nowrap">
          <ArrowUpDown size={13} /> {asc ? 'Oldest first' : 'Newest first'}
        </button>
      </div>

      <div className="bg-white border border-black/[0.12] rounded-xl overflow-hidden">
        <div className="overflow-auto max-h-[70vh]">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr>
                {['Date','Client','Phone','Job type','Source','Status','Next action','Docs','Site Visit','Converted',''].map((h, i) => (
                  <th key={i} className="text-left px-2.5 py-[7px] border-b border-black/[0.12] text-[#666] font-medium whitespace-nowrap bg-[#fafaf8] sticky top-0 z-[2]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(e => {
                const atts = attsOf(e)
                const sv = siteVisits.find(s => s.job_id && s.job_id === e.job_id)
                  ?? (e.client ? siteVisits.find(s => s.client === e.client) : undefined)
                return (
                  <tr key={e.id} className="border-b border-black/[0.06] hover:bg-[#fafaf8]">
                    <td className="px-2.5 py-[7px] text-xs">{e.date || '—'}</td>
                    <td className="px-2.5 py-[7px] font-medium">{e.client}</td>
                    <td className="px-2.5 py-[7px] text-xs">{e.phone || ''}</td>
                    <td className="px-2.5 py-[7px] text-xs">{e.job_type || ''}</td>
                    <td className="px-2.5 py-[7px]">
                      {e.source ? <span className={`${BADGE} bg-[#f1f0e8] text-[#5f5e5a]`}>{e.source}</span> : null}
                    </td>
                    <td className="px-2.5 py-[7px]">
                      <span className={`${BADGE} ${SBADGE[e.enq_status] || 'bg-[#f1f0e8] text-[#5f5e5a]'}`}>{e.enq_status || 'New'}</span>
                    </td>
                    <td className="px-2.5 py-[7px] text-xs text-[#666]">{e.action || ''}</td>
                    <td className="px-2.5 py-[7px] text-center">
                      {atts.length ? (
                        <button onClick={() => openEdit(e)} title="View attachments"
                          className="text-[11px] bg-[#fef3c7] text-[#92400e] rounded-full px-2 py-0.5 font-semibold inline-flex items-center gap-1">
                          <Paperclip size={10} /> {atts.length}
                        </button>
                      ) : '—'}
                    </td>
                    <td className="px-2.5 py-[7px] text-center">
                      {sv ? (
                        <button onClick={() => nav('/visits')} title={`${sv.date || ''} — ${sv.address || ''}`}
                          className={`${BADGE} bg-[#ede9fe] text-[#5b21b6] inline-flex items-center gap-1`}>
                          <MapPin size={10} /> {sv.date || 'Done'}
                        </button>
                      ) : (
                        <button onClick={() => startSiteVisit(e)} title="New site visit"
                          className="px-1.5 py-1 rounded-md bg-white border border-black/20 hover:bg-[#f5f4f0]"><Camera size={12} /></button>
                      )}
                    </td>
                    <td className="px-2.5 py-[7px]">
                      {e.converted_to_job ? (
                        <button onClick={() => nav('/jobs')} title="Go to job"
                          className={`${BADGE} bg-[#dcfce7] text-[#166534]`}>{e.job_id || 'Yes'}</button>
                      ) : '—'}
                    </td>
                    <td className="px-2.5 py-[7px] whitespace-nowrap">
                      <button onClick={() => openEdit(e)}
                        className="ml-1 px-1.5 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700 align-middle"><Edit2 size={12} /></button>
                      {!e.converted_to_job && (
                        <button onClick={() => convert(e)} title="Convert to Job"
                          className="ml-1 px-1.5 py-1 rounded-md bg-white border border-black/20 hover:bg-[#f5f4f0] align-middle"><Hammer size={12} /></button>
                      )}
                      <button onClick={() => { if (confirm('Delete this enquiry?')) del.mutate(e.id) }}
                        className="ml-1 px-1.5 py-1 rounded-md bg-white border border-black/20 hover:bg-[#f5f4f0] align-middle text-[#c0392b]"><Trash2 size={12} /></button>
                    </td>
                  </tr>
                )
              })}
              {rows.length === 0 && (
                <tr><td colSpan={11} className="text-center text-[#666] py-6">No enquiries yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={modal} onClose={() => setModal(false)} size="lg" title={form.id ? 'Edit Enquiry' : 'New Enquiry'}>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Date" type="date" value={form.date || ''} onChange={ef('date')} />
          <Select label="Source" value={form.source || ''} onChange={ef('source')} options={SOURCES} />
          <Input label="Client name" value={form.client || ''} onChange={ef('client')} />
          <Input label="Phone" value={form.phone || ''} onChange={ef('phone')} />
          <Input label="Email" value={form.email || ''} onChange={ef('email')} />
          <Input label="Address" value={form.address || ''} onChange={ef('address')} />
          <Input label="Job type" placeholder="e.g. Exterior repaint" value={form.job_type || ''} onChange={ef('job_type')} />
          <Select label="Status" value={form.enq_status || 'New'} onChange={ef('enq_status')} options={STATUSES} />
          <Select label="Next action" value={form.action || ''} onChange={ef('action')} options={ACTIONS} />
          <TextArea label="Notes" rows={2} value={form.notes || ''} onChange={ef('notes')} wrapperClassName="col-span-2" />

          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-500 mb-1">Attachments (PDF, images — max 4 MB each)</label>
            <input type="file" multiple accept="application/pdf,image/*" onChange={addFiles}
              className="text-[12px] text-gray-600 file:mr-3 file:py-1 file:px-3 file:rounded file:border file:border-black/20 file:text-[12px] file:bg-white file:text-gray-700 hover:file:bg-[#f5f4f0]" />
            <div className="mt-2">
              {(form.attachments ?? []).length === 0 ? (
                <div className="text-xs text-[#666]">No files attached yet.</div>
              ) : (form.attachments ?? []).map((a: any, i: number) => (
                <div key={i} className="flex items-center gap-2 px-2 py-1.5 bg-[#f5f4f0] rounded-md mb-1">
                  <Paperclip size={14} className="text-[#dc2626] shrink-0" />
                  <span className="text-xs flex-1 truncate">{a.name}</span>
                  <span className="text-[10px] text-[#666] whitespace-nowrap">{(a.size / 1024).toFixed(0)} KB</span>
                  <a href={a.dataUrl} download={a.name} title="Download"
                    className="px-1.5 py-0.5 rounded bg-white border border-black/20 hover:bg-white"><Download size={12} /></a>
                  <button title="Remove" className="px-1.5 py-0.5 rounded bg-white border border-black/20 text-[#c0392b]"
                    onClick={() => setForm(p => ({ ...p, attachments: (p.attachments ?? []).filter((_: any, j: number) => j !== i) }))}>
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex justify-between mt-5 pt-4 border-t border-black/10">
          <div>
            {form.id && (
              <button onClick={() => { if (confirm('Delete this enquiry?')) { del.mutate(form.id); setModal(false) } }}
                className="flex items-center gap-1.5 text-[13px] text-red-500 hover:text-red-700"><Trash2 size={14} /> Delete</button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={() => setModal(false)} className="px-4 py-2 text-[13px] rounded-lg bg-[#f5f4f0] text-gray-600 border border-black/10 hover:bg-gray-200">Cancel</button>
            <button onClick={save} disabled={saving}
              className="flex items-center gap-1.5 px-5 py-2 text-[13px] rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold disabled:opacity-50">
              {saving && <Loader2 size={13} className="animate-spin" />} Save
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
