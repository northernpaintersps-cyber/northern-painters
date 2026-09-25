import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, selectAll } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Modal } from '@/components/ui/Modal'
import { Input, Select } from '@/components/ui/Field'
import { Badge } from '@/components/ui/Badge'
import { fmtDate, genId, today } from '@/lib/utils'
import { Plus, Trash2, Loader2, AlertTriangle, FileText } from 'lucide-react'

const CATEGORIES = ['Public Liability', 'Workers Compensation', 'Trade Licence', 'Safety Plan', 'Contract Template', 'Subcontractor Agreement', 'Other']

type Doc = Record<string, any>

function useDocs() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['np_legal_docs', user?.id],
    queryFn: async () => {
      const { data, error } = await selectAll('np_legal_docs', user!.id, { orderBy: 'expiry_date', ascending: true })
      if (error) throw error
      return (data ?? []) as Doc[]
    },
    enabled: !!user,
  })
}

function useUpsertDoc() {
  const qc = useQueryClient()
  const { user } = useAuth()
  return useMutation({
    mutationFn: async (doc: Doc) => {
      const { error } = await supabase.from('np_legal_docs').upsert({ ...doc, user_id: user!.id, updated_at: new Date().toISOString() } as any)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['np_legal_docs'] }),
  })
}

function useDeleteDoc() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('np_legal_docs').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['np_legal_docs'] }),
  })
}

function expiryStatus(expiry: string) {
  if (!expiry) return null
  const days = Math.ceil((new Date(expiry).getTime() - Date.now()) / 86400000)
  if (days < 0) return { label: 'Expired', variant: 'red' as const }
  if (days <= 30) return { label: `Expires in ${days}d`, variant: 'amber' as const }
  return { label: `Valid · ${fmtDate(expiry)}`, variant: 'green' as const }
}

export default function LegalDocs() {
  const { data: docs = [], isLoading } = useDocs()
  const upsert = useUpsertDoc()
  const del = useDeleteDoc()
  const [modalOpen, setModalOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [form, setForm] = useState<Doc>({})
  const [saving, setSaving] = useState(false)
  const [fileData, setFileData] = useState<string>('')

  const expiringSoon = docs.filter(d => {
    if (!d.expiry_date) return false
    const days = Math.ceil((new Date(d.expiry_date).getTime() - Date.now()) / 86400000)
    return days >= 0 && days <= 30
  })
  const expired = docs.filter(d => d.expiry_date && new Date(d.expiry_date) < new Date())

  function openNew() {
    setForm({ category: CATEGORIES[0], date_issued: today() })
    setSelectedId(null)
    setFileData('')
    setModalOpen(true)
  }

  function openEdit(doc: Doc) {
    setForm({ ...doc })
    setSelectedId(doc.id)
    setFileData('')
    setModalOpen(true)
  }

  function ef(k: string) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm(p => ({ ...p, [k]: e.target.value }))
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      setFileData(reader.result as string)
      setForm(p => ({ ...p, file_name: file.name, file_type: file.type }))
    }
    reader.readAsDataURL(file)
  }

  async function handleSave() {
    setSaving(true)
    try {
      const id = selectedId || genId('ld')
      const payload: Doc = { ...form, id, created_at: form.created_at || new Date().toISOString() }
      if (fileData) payload.file_data = fileData
      await upsert.mutateAsync(payload)
      setModalOpen(false)
    } catch (e: any) {
      alert('Save failed: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!selectedId || !confirm('Delete this document?')) return
    await del.mutateAsync(selectedId)
    setModalOpen(false)
  }

  return (
    <div className="p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-[17px] font-semibold text-gray-900">Legal Documents</h2>
        <button onClick={openNew} className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors font-medium">
          <Plus size={14} /> Add Document
        </button>
      </div>

      {/* Alerts */}
      {(expired.length > 0 || expiringSoon.length > 0) && (
        <div className="mb-4 space-y-2">
          {expired.length > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-[12px] text-red-800">
              <AlertTriangle size={14} />
              <strong>{expired.length}</strong> document{expired.length > 1 ? 's have' : ' has'} expired: {expired.map(d => d.name).join(', ')}
            </div>
          )}
          {expiringSoon.length > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-[12px] text-amber-800">
              <AlertTriangle size={14} />
              <strong>{expiringSoon.length}</strong> document{expiringSoon.length > 1 ? 's expire' : ' expires'} within 30 days
            </div>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 size={18} className="animate-spin text-blue-600" /></div>
      ) : docs.length === 0 ? (
        <div className="bg-white border border-black/10 rounded-xl p-12 text-center">
          <FileText size={32} className="mx-auto mb-3 text-gray-300" />
          <div className="text-gray-500 text-[13px]">No documents yet. Add your licences, insurance, and certificates.</div>
        </div>
      ) : (
        <div className="bg-white border border-black/10 rounded-xl overflow-hidden">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr>
                {['Document','Category','Issued','Expiry','Status',''].map(h => (
                  <th key={h} className="text-left px-3 py-2 border-b border-black/10 text-gray-500 font-medium bg-[#fafaf8] sticky top-0">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {docs.map(doc => {
                const status = expiryStatus(doc.expiry_date)
                return (
                  <tr key={doc.id} className="hover:bg-[#fafaf8] border-b border-black/[0.06] last:border-0 cursor-pointer" onClick={() => openEdit(doc)}>
                    <td className="px-3 py-2">
                      <div className="font-medium text-gray-900">{doc.name || '—'}</div>
                      {doc.notes && <div className="text-gray-500 text-[11px]">{doc.notes}</div>}
                    </td>
                    <td className="px-3 py-2 text-gray-600">{doc.category || '—'}</td>
                    <td className="px-3 py-2 text-gray-600">{fmtDate(doc.date_issued)}</td>
                    <td className="px-3 py-2 text-gray-600">{doc.expiry_date ? fmtDate(doc.expiry_date) : '—'}</td>
                    <td className="px-3 py-2">
                      {status && <Badge label={status.label} variant={status.variant} />}
                    </td>
                    <td className="px-3 py-2">
                      {doc.file_data && (
                        <a href={doc.file_data} download={doc.file_name || 'document'}
                          onClick={e => e.stopPropagation()}
                          className="text-blue-600 hover:text-blue-800 text-[11px] font-medium">
                          Download
                        </a>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={selectedId ? 'Edit Document' : 'Add Document'}>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Document name" value={form.name || ''} onChange={ef('name')} placeholder="e.g. Public Liability Insurance" wrapperClassName="col-span-2" />
          <Select label="Category" value={form.category || ''} onChange={ef('category')} options={CATEGORIES} />
          <Input label="Date issued" type="date" value={form.date_issued || ''} onChange={ef('date_issued')} />
          <Input label="Expiry date" type="date" value={form.expiry_date || ''} onChange={ef('expiry_date')} />
          <Input label="Policy / Licence no." value={form.ref_no || ''} onChange={ef('ref_no')} />
          <Input label="Notes" value={form.notes || ''} onChange={ef('notes')} wrapperClassName="col-span-2" />
          <div className="col-span-2 flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">Attach file (PDF, image)</label>
            <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={handleFile}
              className="text-[12px] text-gray-600 file:mr-3 file:py-1 file:px-3 file:rounded file:border file:border-black/20 file:text-[12px] file:bg-white file:text-gray-700 hover:file:bg-[#f5f4f0]" />
            {(form.file_name || fileData) && (
              <div className="text-[11px] text-blue-700">{form.file_name || 'File attached'}</div>
            )}
          </div>
        </div>
        <div className="flex justify-between mt-5 pt-4 border-t border-black/10">
          <div>{selectedId && <button onClick={handleDelete} className="flex items-center gap-1.5 text-[13px] text-red-500 hover:text-red-700"><Trash2 size={14} /> Delete</button>}</div>
          <div className="flex gap-2">
            <button onClick={() => setModalOpen(false)} className="px-4 py-2 text-[13px] rounded-lg bg-[#f5f4f0] text-gray-600 hover:bg-gray-200 border border-black/10">Cancel</button>
            <button onClick={handleSave} disabled={saving} className="flex items-center gap-1.5 px-5 py-2 text-[13px] rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold disabled:opacity-50">
              {saving && <Loader2 size={13} className="animate-spin" />} Save
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
