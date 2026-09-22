import { useState, useMemo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { genId, today } from '@/lib/utils'
import { substrateTotals } from '@/lib/substrates'
import SiteVisitEditor, { emptySVState, normaliseSV, type SVState } from '@/components/SiteVisitEditor'
import {
  Plus, Loader2, Trash2, Edit2, Calculator, ArrowUpDown, X, Camera, MapPin,
} from 'lucide-react'

type Row = Record<string, any>

const BADGE = 'inline-block px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap'

// Site visit detail rides in the notes column as JSON — no migration needed
const readSV = (v: Row): SVState => {
  try { return normaliseSV(JSON.parse(v.notes || '{}')) }
  catch { return normaliseSV({ notes: v.notes || '' } as Partial<SVState>) }
}

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
      const { error } = await (supabase.from('np_site_visits') as any)
        .upsert({ ...row, user_id: user!.id, updated_at: new Date().toISOString() })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['np_site_visits'] }),
  })
}

function useDel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.from('np_site_visits') as any).delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['np_site_visits'] }),
  })
}

export default function SiteVisits() {
  const nav = useNavigate()
  const { data: visits = [], isLoading } = useTable('np_site_visits')
  const { data: jobs = [] } = useTable('np_jobs')
  const upsert = useUpsert()
  const del = useDel()

  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [asc, setAsc] = useState(false)
  const [editing, setEditing] = useState<{ id: string | null; state: SVState } | null>(null)

  const anyFilter = !!(q || status)

  const rows = useMemo(() => {
    let list = visits.map(v => ({ v, d: readSV(v) }))
    if (q) {
      const s = q.toLowerCase()
      list = list.filter(({ v, d }) => `${d.client}${d.address}${d.jobType}${v.job_id ?? ''}`.toLowerCase().includes(s))
    }
    if (status) list = list.filter(({ d }) => (d.status || 'Draft') === status)
    return list.sort((a, b) => {
      const da = a.v.date || '', db = b.v.date || ''
      return asc ? (da < db ? -1 : 1) : (da > db ? -1 : 1)
    })
  }, [visits, q, status, asc])

  function openNew(prefill?: Partial<SVState>) {
    setEditing({ id: null, state: { ...emptySVState(), ...(prefill ?? {}) } })
  }
  function openEdit(v: Row) {
    const state = readSV(v)
    setEditing({ id: v.id, state: { ...state, jobId: v.job_id ?? state.jobId, date: v.date ?? state.date } })
  }

  // Arriving from an enquiry
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('new') !== '1') return
    let pre: any = {}
    try {
      const raw = sessionStorage.getItem('np_prefill_visit')
      if (raw) { pre = JSON.parse(raw); sessionStorage.removeItem('np_prefill_visit') }
    } catch {}
    openNew({ client: pre.client ?? '', address: pre.address ?? '', date: pre.date ?? today() })
    window.history.replaceState({}, '', window.location.pathname)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function save(state: SVState, complete: boolean) {
    const next: SVState = { ...state, status: complete ? 'Complete' : 'Draft' }
    await upsert.mutateAsync({
      id: editing?.id ?? genId('sv'),
      job_id: next.jobId || null,
      date: next.date || today(),
      photos: next.photos,
      notes: JSON.stringify(next),
      created_at: new Date().toISOString(),
    })
    setEditing(null)
    if (complete && !next.jobId) {
      if (confirm('Site visit complete. Build a quote from it now?')) buildQuote(next)
    }
  }

  // V16 buildQuoteFromSiteVisit — areas and ticked substrates carry across
  function buildQuote(d: SVState) {
    try {
      sessionStorage.setItem('np_prefill_quote', JSON.stringify({
        client: d.client, address: d.address, jobType: d.jobType,
        // Hand the full typed lines across, not just totals
        substrateEntries: d.substrates,
        substrates: substrateTotals(d.substrates),
        areas: d.areas.map(a => ({
          area_name: a.name,
          sqm: a.l && a.w ? a.l * a.w : 0,
          length: a.l, height: a.h,
          prep_level: a.condition === 'Poor' ? 'heavy' : a.condition === 'Fair' ? 'moderate' : 'light',
          notes: [a.prep, a.notes].filter(Boolean).join(' · '),
        })),
        siteNotes: [d.notes, ...d.voiceNotes.map(v => v.text)].filter(Boolean).join('\n'),
      }))
    } catch {}
    nav('/quotes/build')
  }

  if (isLoading) return (
    <div className="flex items-center justify-center h-64"><Loader2 size={20} className="animate-spin text-blue-600" /></div>
  )

  return (
    <div className="p-5">
      {editing && (
        <SiteVisitEditor
          initial={editing.state}
          jobs={jobs}
          isNew={!editing.id}
          onClose={() => setEditing(null)}
          onSave={save}
        />
      )}

      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <h2 className="text-[17px] font-semibold text-gray-900">Site Visits</h2>
        <button onClick={() => openNew()}
          className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white font-medium text-[13px] px-3 py-1.5 rounded-lg">
          <Plus size={14} /> New Site Visit
        </button>
      </div>

      {visits.length === 0 ? (
        <div className="bg-white border border-black/[0.12] rounded-xl text-center py-10 text-[#666]">
          <Camera size={40} className="mx-auto mb-3 opacity-30" />
          <div className="text-sm font-semibold mb-1.5">No site visits yet</div>
          <div className="text-xs">Tap New Site Visit to start capturing on your next quote visit</div>
        </div>
      ) : (
        <>
          <div className="bg-white border border-black/[0.12] rounded-xl px-3.5 py-3 mb-2.5">
            <div className="flex gap-2 flex-wrap items-center">
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="🔍 Search client, address…"
                className="flex-[2] min-w-[160px] px-2.5 py-2 text-[13px] bg-white border border-black/20 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500" />
              <select value={status} onChange={e => setStatus(e.target.value)}
                className="flex-1 min-w-[120px] px-2.5 py-2 text-[13px] bg-white border border-black/20 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500">
                <option value="">All statuses</option>
                <option>Draft</option>
                <option>Complete</option>
              </select>
              <button onClick={() => setAsc(a => !a)}
                className="flex items-center gap-1 px-2.5 py-2 text-[13px] bg-white border border-black/20 rounded-lg hover:bg-[#f5f4f0] whitespace-nowrap">
                <ArrowUpDown size={13} /> {asc ? 'Oldest first' : 'Newest first'}
              </button>
              {anyFilter && (
                <button onClick={() => { setQ(''); setStatus('') }}
                  className="flex items-center gap-1 px-2.5 py-2 text-[13px] bg-white border border-black/20 rounded-lg hover:bg-[#f5f4f0] text-[#c0392b]">
                  <X size={13} /> Clear
                </button>
              )}
            </div>
          </div>

          <div className="bg-white border border-black/[0.12] rounded-xl overflow-hidden">
            <div className="overflow-auto max-h-[70vh]">
              <table className="w-full border-collapse text-[12.5px]">
                <thead>
                  <tr>
                    {['Date','Client','Address','Job Type','Areas','Photos','Status',''].map((h, i) => (
                      <th key={i} className="text-left px-2.5 py-[7px] border-b border-black/[0.12] text-[#666] font-medium whitespace-nowrap bg-[#fafaf8] sticky top-0 z-[2]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ v, d }) => (
                    <tr key={v.id} className="border-b border-black/[0.06] hover:bg-[#fafaf8]">
                      <td className="px-2.5 py-[7px] whitespace-nowrap">{v.date || '—'}</td>
                      <td className="px-2.5 py-[7px] font-medium">{d.client || '—'}</td>
                      <td className="px-2.5 py-[7px] text-xs text-[#666] max-w-[180px] truncate">
                        {d.address ? <span className="inline-flex items-center gap-1"><MapPin size={10} /> {d.address}</span> : '—'}
                      </td>
                      <td className="px-2.5 py-[7px] text-xs">{d.jobType || '—'}</td>
                      <td className="px-2.5 py-[7px] text-xs">{d.areas.length}</td>
                      <td className="px-2.5 py-[7px]">
                        <span className={`${BADGE} bg-[#dbeafe] text-[#1e40af]`}>{(v.photos ?? []).length} photos</span>
                      </td>
                      <td className="px-2.5 py-[7px]">
                        <span className={`${BADGE} ${d.status === 'Complete' ? 'bg-[#dcfce7] text-[#166534]' : 'bg-[#fef3c7] text-[#92400e]'}`}>
                          {d.status || 'Draft'}
                        </span>
                      </td>
                      <td className="px-2.5 py-[7px] whitespace-nowrap">
                        <button onClick={() => openEdit(v)}
                          className="ml-1 px-2 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700 align-middle inline-flex items-center gap-1 text-[11px]">
                          <Edit2 size={11} /> Open
                        </button>
                        <button onClick={() => buildQuote(d)}
                          className="ml-1 px-2 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700 align-middle inline-flex items-center gap-1 text-[11px]">
                          <Calculator size={11} /> Build Quote
                        </button>
                        <button onClick={() => { if (confirm('Delete this site visit?')) del.mutate(v.id) }}
                          className="ml-1 px-1.5 py-1 rounded-md bg-white border border-black/20 hover:bg-[#f5f4f0] align-middle text-[#c0392b]"><Trash2 size={12} /></button>
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr><td colSpan={8} className="text-center text-[#666] py-6">No site visits match your filters.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
