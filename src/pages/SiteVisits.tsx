import { useState, useMemo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, selectAll } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { genId, today } from '@/lib/utils'
import { substrateTotals } from '@/lib/substrates'
import SiteVisitEditor, { emptySVState, normaliseSV, type SVState } from '@/components/SiteVisitEditor'
import {
  Plus, Loader2, Trash2, Edit2, Calculator, ArrowUpDown, X, Camera, MapPin,
} from 'lucide-react'
import { takeHandoff } from '@/lib/handoff'
import { photoDataUrls } from '@/lib/photoStore'
import { photosToScope } from '@/lib/ai'
import { useBusinessSettings } from '@/pages/SettingsPage'
import { SUB_BY_KEY, newSubLine } from '@/lib/substrates'

type Row = Record<string, any>

const BADGE = 'inline-block px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap'

// Site visit detail rides in the notes column as JSON — no migration needed.
// Photos are the exception: they live in their own `photos` column and are
// written out of the blob, so they are put back here. Visits saved before
// that split still carry them inside the blob, hence the fallback.
const readSV = (v: Row): SVState => {
  const photos = Array.isArray(v.photos) ? v.photos : []
  try {
    const parsed = JSON.parse(v.notes || '{}')
    return normaliseSV({ ...parsed, photos: photos.length ? photos : (parsed.photos ?? []) })
  } catch {
    return normaliseSV({ notes: v.notes || '', photos } as Partial<SVState>)
  }
}

function useTable(table: string) {
  const { user } = useAuth()
  return useQuery({
    queryKey: [table, user?.id],
    queryFn: async () => {
      const { data } = await selectAll(table, user!.id)
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
  const { user } = useAuth()
  const { data: visits = [], isLoading } = useTable('np_site_visits')
  const { data: jobs = [] } = useTable('np_jobs')
  const upsert = useUpsert()
  const del = useDel()

  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [asc, setAsc] = useState(false)
  const [editing, setEditing] = useState<{ id: string; isNew: boolean; state: SVState } | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const { data: biz } = useBusinessSettings()

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

  // The visit id is minted when the editor opens, not at save: a photo is
  // uploaded to <user>/<visit>/<photo>.jpg the moment it is taken, so the
  // visit has to have an identity before then.
  function openNew(prefill?: Partial<SVState>) {
    setEditing({ id: genId('sv'), isNew: true, state: { ...emptySVState(), ...(prefill ?? {}) } })
  }
  function openEdit(v: Row) {
    const state = readSV(v)
    setEditing({ id: v.id, isNew: false, state: { ...state, jobId: v.job_id ?? state.jobId, date: v.date ?? state.date } })
  }

  // Arriving from an enquiry, or from a job's site-visit button
  useEffect(() => {
    const pre = takeHandoff('np_prefill_visit')
    if (!pre) return
    openNew({
      jobId: pre.jobId ?? '', client: pre.client ?? '',
      address: pre.address ?? '', date: pre.date ?? today(),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * Read the photos and the spoken notes into a scope.
   *
   * Quantities only land where the model had something to count or was told a
   * measurement — it is instructed not to estimate area from perspective, and
   * a surface it can see but not measure still arrives, ticked, with its
   * condition and prep, waiting for a number.
   */
  async function aiParse(state: SVState): Promise<Partial<SVState> | null> {
    const key = biz?.ai_api_key
    if (!key) { alert('No API key set. Add your Anthropic API key in Settings.'); return null }
    if (!state.photos.length) { alert('Take some photos first — there is nothing to read.'); return null }

    setAiBusy(true)
    try {
      const urls = await photoDataUrls(state.photos)
      const photos = state.photos
        .filter(ph => urls[ph.id])
        .map(ph => ({ dataUrl: urls[ph.id], note: ph.label, tag: ph.tag }))
      if (!photos.length) throw new Error('None of the photos could be loaded.')

      const notes = [state.notes, ...state.voiceNotes.map(v => v.text)].filter(Boolean).join('\n')
      const scope = await photosToScope(key, photos, notes)

      const withQty = scope.observations.filter(o => o.qty != null).length
      const toMeasure = scope.observations.filter(o => o.qty == null)

      // Returned rather than pushed: the editor keeps its own copy of the
      // state, so a parent setState here would never reach it.
      const subs = { ...state.substrates }
      scope.observations.forEach(o => {
        const entry = subs[o.key] ?? { inc: false, lines: [newSubLine()] }
        const lines = entry.lines.length ? [...entry.lines] : [newSubLine()]
        lines[0] = {
          ...lines[0],
          qty: o.qty ?? lines[0].qty,
          notes: [o.condition, o.prep].filter(Boolean).join(' · ') || lines[0].notes,
        }
        subs[o.key] = { ...entry, inc: true, lines }
      })
      const added = [scope.summary, scope.scopeNotes && `To check: ${scope.scopeNotes}`]
        .filter(Boolean).join('\n')
      const patch: Partial<SVState> = {
        substrates: subs,
        jobType: state.jobType || scope.jobType,
        notes: [state.notes, added].filter(Boolean).join('\n\n'),
      }

      alert(
        `${scope.observations.length} surface${scope.observations.length === 1 ? '' : 's'} found, `
        + `${withQty} with a quantity.`
        + (toMeasure.length
          ? `\n\nStill need measuring: ${toMeasure.map(o => SUB_BY_KEY[o.key]?.label ?? o.key).join(', ')}.`
            + '\nA photograph cannot be measured, so these were left for you.'
          : ''),
      )
      return patch
    } catch (err: any) {
      alert(err?.message ?? 'Could not read the photos.')
      return null
    } finally {
      setAiBusy(false)
    }
  }

  async function save(state: SVState, complete: boolean) {
    const next: SVState = { ...state, status: complete ? 'Complete' : 'Draft' }
    await upsert.mutateAsync({
      id: editing?.id ?? genId('sv'),
      job_id: next.jobId || null,
      date: next.date || today(),
      photos: next.photos,
      // Photos live in the `photos` column. Leaving them in the state blob too
      // wrote every image into the row twice, which is what made a visit with
      // ten photos impossible to save.
      notes: JSON.stringify({ ...next, photos: [] }),
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
          // Width travels too. Without it the quoting tool seeded every room
          // at w = 0, so a prefilled room contributed no ceiling at all.
          length: a.l, width: a.w, height: a.h,
          prep_level: a.condition === 'Poor' ? 'heavy' : a.condition === 'Fair' ? 'moderate' : 'light',
          notes: [a.prep, a.notes].filter(Boolean).join(' · '),
        })),
        siteNotes: [d.notes, ...d.voiceNotes.map(v => v.text)].filter(Boolean).join('\n'),
        // The id, not the images. Photos in sessionStorage would blow the
        // quota, and the setItem below is wrapped in a bare catch — an
        // overflow would silently lose the whole prefill, client and all.
        visitId: editing?.id ?? null,
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
          visitId={editing.id}
          userId={user?.id ?? ''}
          isNew={editing.isNew}
          onClose={() => setEditing(null)}
          onSave={save}
          onAIParse={aiParse}
          aiBusy={aiBusy}
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
