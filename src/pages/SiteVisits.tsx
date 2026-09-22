import { useState, useMemo, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Modal } from '@/components/ui/Modal'
import { Input, Select, TextArea } from '@/components/ui/Field'
import { genId, today } from '@/lib/utils'
import {
  Plus, Loader2, Trash2, Edit2, Calculator, ArrowUpDown, X, Camera,
  Mic, Pencil, Eraser, Download, MapPin,
} from 'lucide-react'

type Row = Record<string, any>

const JOB_TYPES = ['Interior repaint', 'Exterior repaint', 'Full repaint', 'New build - exterior', 'Hourly rate', 'Limewash / specialty', 'Other']
const CONDITIONS = ['Good', 'Fair', 'Poor']
const BADGE = 'inline-block px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap'

type Area = { name: string; notes: string; condition: string; prep: string; l: number; w: number; h: number }
const emptyArea = (): Area => ({ name: 'General', notes: '', condition: 'Good', prep: '', l: 0, w: 0, h: 0 })

// Extra site-visit data lives in the notes column as JSON (no migration needed)
type SVData = { client?: string; address?: string; jobType?: string; status?: string; summary?: string; areas?: Area[]; voiceNotes?: string[]; sketch?: string | null }
function readSV(v: Row): SVData {
  try { const d = JSON.parse(v.notes || '{}'); return typeof d === 'object' && d ? d : { summary: v.notes } }
  catch { return { summary: v.notes || '' } }
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

// ── Sketch pad ───────────────────────────────────────────────
function SketchPad({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)

  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, c.width, c.height)
    if (value) {
      const img = new Image()
      img.onload = () => ctx.drawImage(img, 0, 0)
      img.src = value
    }
  }, [value])

  function pos(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = canvasRef.current!
    const r = c.getBoundingClientRect()
    return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) }
  }
  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    drawing.current = true
    const ctx = canvasRef.current!.getContext('2d')!
    const { x, y } = pos(e)
    ctx.beginPath(); ctx.moveTo(x, y)
    ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.strokeStyle = '#1a1a18'
    canvasRef.current!.setPointerCapture(e.pointerId)
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return
    const ctx = canvasRef.current!.getContext('2d')!
    const { x, y } = pos(e)
    ctx.lineTo(x, y); ctx.stroke()
  }
  function up() {
    if (!drawing.current) return
    drawing.current = false
    onChange(canvasRef.current!.toDataURL('image/png'))
  }
  function clear() {
    const c = canvasRef.current!
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height)
    onChange(null)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-xs font-medium text-gray-500 flex items-center gap-1"><Pencil size={12} /> Sketch</label>
        <div className="flex gap-1.5">
          <button onClick={clear} className="flex items-center gap-1 px-2 py-1 text-[11px] bg-white border border-black/20 rounded-md hover:bg-[#f5f4f0]">
            <Eraser size={11} /> Clear
          </button>
          {value && (
            <a href={value} download="sketch.png" className="flex items-center gap-1 px-2 py-1 text-[11px] bg-white border border-black/20 rounded-md hover:bg-[#f5f4f0]">
              <Download size={11} /> Save
            </a>
          )}
        </div>
      </div>
      <canvas ref={canvasRef} width={760} height={380}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}
        className="w-full border border-black/20 rounded-lg bg-white touch-none cursor-crosshair" />
    </div>
  )
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
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState<Row>({})
  const [data, setData] = useState<SVData>({})
  const [listening, setListening] = useState(false)
  const photoRef = useRef<HTMLInputElement>(null)

  const anyFilter = !!(q || status)

  const rows = useMemo(() => {
    let list = visits.map(v => ({ v, d: readSV(v) }))
    if (q) {
      const s = q.toLowerCase()
      list = list.filter(({ v, d }) => `${d.client ?? ''}${d.address ?? ''}${d.jobType ?? ''}${v.job_id ?? ''}`.toLowerCase().includes(s))
    }
    if (status) list = list.filter(({ d }) => (d.status || 'Draft') === status)
    return list.sort((a, b) => {
      const da = a.v.date || '', db = b.v.date || ''
      return asc ? (da < db ? -1 : da > db ? 1 : 0) : (da > db ? -1 : da < db ? 1 : 0)
    })
  }, [visits, q, status, asc])

  function openNew(prefill?: Partial<SVData>) {
    setForm({ date: today(), photos: [] })
    setData({ status: 'Draft', areas: [emptyArea()], voiceNotes: [], sketch: null, jobType: JOB_TYPES[0], ...(prefill ?? {}) })
    setModal(true)
  }
  function openEdit(v: Row) {
    setForm({ ...v, photos: Array.isArray(v.photos) ? v.photos : [] })
    const d = readSV(v)
    setData({ areas: [emptyArea()], voiceNotes: [], sketch: null, status: 'Draft', ...d })
    setModal(true)
  }

  // Prefill when arriving from an enquiry
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('new') !== '1') return
    let pre: any = {}
    try {
      const raw = sessionStorage.getItem('np_prefill_visit')
      if (raw) { pre = JSON.parse(raw); sessionStorage.removeItem('np_prefill_visit') }
    } catch {}
    openNew({ client: pre.client, address: pre.address })
    window.history.replaceState({}, '', window.location.pathname)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function addPhotos(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    for (const file of files) {
      const dataUrl = await new Promise<string>(res => {
        const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsDataURL(file)
      })
      setForm(p => ({ ...p, photos: [...(p.photos ?? []), { name: file.name, dataUrl, tag: 'before' }] }))
    }
  }

  // Voice note via the browser speech API
  function recordVoice() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) { alert('Voice input not supported in this browser.\nPlease use Google Chrome.'); return }
    const rec = new SR()
    rec.lang = 'en-AU'; rec.interimResults = false; rec.maxAlternatives = 1
    setListening(true)
    rec.onresult = (ev: any) => {
      setListening(false)
      const t = ev.results[0][0].transcript
      setData(p => ({ ...p, voiceNotes: [...(p.voiceNotes ?? []), t] }))
    }
    rec.onerror = (ev: any) => {
      setListening(false)
      if (ev.error !== 'no-speech') alert(`Voice error: ${ev.error}`)
    }
    rec.onend = () => setListening(false)
    try { rec.start() } catch (err: any) { setListening(false); alert('Could not start microphone: ' + err.message) }
  }

  function setArea(i: number, patch: Partial<Area>) {
    setData(p => ({ ...p, areas: (p.areas ?? []).map((a, j) => (j === i ? { ...a, ...patch } : a)) }))
  }

  async function save() {
    await upsert.mutateAsync({
      id: form.id || genId('sv'),
      job_id: form.job_id || null,
      date: form.date || today(),
      photos: form.photos ?? [],
      notes: JSON.stringify(data),
      created_at: form.created_at || new Date().toISOString(),
    })
    setModal(false)
  }

  // V16 buildQuoteFromSiteVisit — hand the areas to the quote builder
  function buildQuote(v: Row, d: SVData) {
    try {
      sessionStorage.setItem('np_prefill_quote', JSON.stringify({
        job_id: v.job_id, client: d.client, address: d.address, jobType: d.jobType,
        areas: (d.areas ?? []).map(a => ({
          area_name: a.name,
          sqm: a.l && a.h ? a.l * a.h : 0,
          length: a.l, height: a.h,
          prep_level: a.condition === 'Poor' ? 'heavy' : a.condition === 'Fair' ? 'moderate' : 'light',
          notes: a.notes,
        })),
      }))
    } catch {}
    nav('/quotes')
  }

  if (isLoading) return (
    <div className="flex items-center justify-center h-64"><Loader2 size={20} className="animate-spin text-blue-600" /></div>
  )

  const areas = data.areas ?? []
  const photos: any[] = form.photos ?? []

  return (
    <div className="p-5">
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
                    {['Date','Client','Address','Job Type','Photos','Status',''].map((h, i) => (
                      <th key={i} className="text-left px-2.5 py-[7px] border-b border-black/[0.12] text-[#666] font-medium whitespace-nowrap bg-[#fafaf8] sticky top-0 z-[2]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ v, d }) => (
                    <tr key={v.id} className="border-b border-black/[0.06] hover:bg-[#fafaf8]">
                      <td className="px-2.5 py-[7px] whitespace-nowrap">{v.date || '—'}</td>
                      <td className="px-2.5 py-[7px] font-medium">{d.client || '—'}</td>
                      <td className="px-2.5 py-[7px] text-xs text-[#666]">{d.address || '—'}</td>
                      <td className="px-2.5 py-[7px] text-xs">{d.jobType || '—'}</td>
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
                        <button onClick={() => buildQuote(v, d)}
                          className="ml-1 px-2 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700 align-middle inline-flex items-center gap-1 text-[11px]">
                          <Calculator size={11} /> Build Quote
                        </button>
                        <button onClick={() => { if (confirm('Delete this site visit?')) del.mutate(v.id) }}
                          className="ml-1 px-1.5 py-1 rounded-md bg-white border border-black/20 hover:bg-[#f5f4f0] align-middle text-[#c0392b]"><Trash2 size={12} /></button>
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr><td colSpan={7} className="text-center text-[#666] py-6">No site visits match your filters.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <Modal open={modal} onClose={() => setModal(false)} size="xl" title={form.id ? 'Site Visit' : 'New Site Visit'}>
        <div className="grid grid-cols-2 gap-3 mb-4">
          <Input label="Date" type="date" value={form.date || ''} onChange={e => setForm(p => ({ ...p, date: e.target.value }))} />
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Link to job (optional)</label>
            <select value={form.job_id || ''} onChange={e => {
              const j = jobs.find(x => x.id === e.target.value)
              setForm(p => ({ ...p, job_id: e.target.value }))
              if (j) setData(p => ({ ...p, client: j.client, address: j.address }))
            }}
              className="w-full bg-white border border-black/20 rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-blue-500">
              <option value="">— None —</option>
              {jobs.map(j => <option key={j.id} value={j.id}>{j.id} — {j.client}</option>)}
            </select>
          </div>
          <Input label="Client" value={data.client || ''} onChange={e => setData(p => ({ ...p, client: e.target.value }))} />
          <Input label="Address" value={data.address || ''} onChange={e => setData(p => ({ ...p, address: e.target.value }))} />
          <Select label="Job type" value={data.jobType || JOB_TYPES[0]} onChange={e => setData(p => ({ ...p, jobType: e.target.value }))} options={JOB_TYPES} />
          <Select label="Status" value={data.status || 'Draft'} onChange={e => setData(p => ({ ...p, status: e.target.value }))} options={['Draft', 'Complete']} />
        </div>

        {/* Areas */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[13px] font-bold flex items-center gap-1.5"><MapPin size={14} /> Areas</div>
            <button onClick={() => setData(p => ({ ...p, areas: [...(p.areas ?? []), emptyArea()] }))}
              className="flex items-center gap-1 px-2.5 py-1 text-[11px] bg-white border border-black/20 rounded-lg hover:bg-[#f5f4f0]">
              <Plus size={11} /> Add area
            </button>
          </div>
          {areas.map((a, i) => (
            <div key={i} className="bg-[#f5f4f0] rounded-lg p-3 mb-2">
              <div className="grid grid-cols-4 gap-2 mb-2">
                <Input label="Area name" value={a.name} onChange={e => setArea(i, { name: e.target.value })} wrapperClassName="col-span-2" />
                <Select label="Condition" value={a.condition} onChange={e => setArea(i, { condition: e.target.value })} options={CONDITIONS} />
                <div className="flex items-end">
                  <button onClick={() => setData(p => ({ ...p, areas: (p.areas ?? []).filter((_, j) => j !== i) }))}
                    className="px-2 py-2 rounded-md bg-white border border-black/20 hover:bg-white text-[#c0392b]"><Trash2 size={13} /></button>
                </div>
              </div>
              <div className="grid grid-cols-4 gap-2">
                <Input label="Length (m)" type="number" step="0.1" value={a.l || ''} onChange={e => setArea(i, { l: parseFloat(e.target.value) || 0 })} />
                <Input label="Width (m)" type="number" step="0.1" value={a.w || ''} onChange={e => setArea(i, { w: parseFloat(e.target.value) || 0 })} />
                <Input label="Height (m)" type="number" step="0.1" value={a.h || ''} onChange={e => setArea(i, { h: parseFloat(e.target.value) || 0 })} />
                <Input label="Prep required" value={a.prep} onChange={e => setArea(i, { prep: e.target.value })} />
              </div>
              <Input label="Notes" value={a.notes} onChange={e => setArea(i, { notes: e.target.value })} wrapperClassName="mt-2" />
            </div>
          ))}
        </div>

        {/* Photos */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[13px] font-bold flex items-center gap-1.5"><Camera size={14} /> Photos</div>
            <button onClick={() => photoRef.current?.click()}
              className="flex items-center gap-1 px-2.5 py-1 text-[11px] bg-white border border-black/20 rounded-lg hover:bg-[#f5f4f0]">
              <Camera size={11} /> Add photos
            </button>
            <input ref={photoRef} type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={addPhotos} />
          </div>
          {photos.length > 0 && (
            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(120px,1fr))' }}>
              {photos.map((p, i) => (
                <div key={i} className="relative">
                  <img src={p.dataUrl} alt={p.name} className="w-full h-24 object-cover rounded-lg border border-black/10" />
                  <select value={p.tag || 'before'}
                    onChange={e => setForm(f => ({ ...f, photos: f.photos.map((x: any, j: number) => (j === i ? { ...x, tag: e.target.value } : x)) }))}
                    className="absolute bottom-1 left-1 text-[10px] rounded px-1 py-0.5 bg-white/90 border border-black/10">
                    <option value="before">Before</option>
                    <option value="after">After</option>
                    <option value="detail">Detail</option>
                  </select>
                  <button onClick={() => setForm(f => ({ ...f, photos: f.photos.filter((_: any, j: number) => j !== i) }))}
                    className="absolute top-1 right-1 w-5 h-5 rounded-full bg-white/90 border border-black/10 text-[#c0392b] text-xs leading-none">×</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Voice notes */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[13px] font-bold flex items-center gap-1.5"><Mic size={14} /> Voice notes</div>
            <button onClick={recordVoice}
              className={`flex items-center gap-1 px-2.5 py-1 text-[11px] rounded-lg border ${listening ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-black/20 hover:bg-[#f5f4f0]'}`}>
              <Mic size={11} /> {listening ? 'Listening…' : 'Record note'}
            </button>
          </div>
          {(data.voiceNotes ?? []).length === 0 ? (
            <div className="text-xs text-[#666]">No voice notes yet — tap Record note and speak.</div>
          ) : (data.voiceNotes ?? []).map((n, i) => (
            <div key={i} className="flex items-start gap-2 bg-[#f5f4f0] rounded-md px-2.5 py-1.5 mb-1">
              <span className="flex-1 text-xs">{n}</span>
              <button onClick={() => setData(p => ({ ...p, voiceNotes: (p.voiceNotes ?? []).filter((_, j) => j !== i) }))}
                className="text-[#c0392b]"><Trash2 size={12} /></button>
            </div>
          ))}
        </div>

        {/* Sketch */}
        <div className="mb-4">
          <SketchPad value={data.sketch ?? null} onChange={v => setData(p => ({ ...p, sketch: v }))} />
        </div>

        <TextArea label="Summary notes" rows={3} value={data.summary || ''} onChange={e => setData(p => ({ ...p, summary: e.target.value }))} />

        <div className="flex justify-between mt-5 pt-4 border-t border-black/10">
          <div>
            {form.id && (
              <button onClick={() => { if (confirm('Delete this site visit?')) { del.mutate(form.id); setModal(false) } }}
                className="flex items-center gap-1.5 text-[13px] text-red-500 hover:text-red-700"><Trash2 size={14} /> Delete</button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={() => setModal(false)} className="px-4 py-2 text-[13px] rounded-lg bg-[#f5f4f0] text-gray-600 border border-black/10 hover:bg-gray-200">Cancel</button>
            <button onClick={save} className="px-5 py-2 text-[13px] rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold">Save</button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
