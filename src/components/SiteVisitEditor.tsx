import { useState, useEffect, useRef } from 'react'
import {
  SV_SUBS, SV_GROUP_HDR, SV_GROUP_BG, SV_CONDITIONS,
  SV_PHOTO_TAGS, SV_TAG_BG, SV_TAG_FG, type SVSub,
} from '@/lib/siteVisitData'
import { genId, today } from '@/lib/utils'
import {
  ArrowLeft, Save, Check, Plus, Trash2, Mic, Camera, Upload, Copy,
  Pencil, Eraser, Undo2, Sparkles, Loader2,
} from 'lucide-react'

type Row = Record<string, any>

export type SVArea = { id: string; name: string; condition: string; prep: string; l: number; w: number; h: number; notes: string }
export type SVPhoto = { id: string; data: string; tag: string; label: string }
export type SVVoice = { id: string; text: string }
export type SVLine = { id: string; type: string; sqm: number; lm: number; qty: number; notes: string }
export type SVSubData = { inc: boolean; lines: SVLine[] }

export type SVState = {
  date: string; jobId: string; client: string; address: string; jobType: string
  notes: string; status: string
  areas: SVArea[]; photos: SVPhoto[]; voiceNotes: SVVoice[]
  substrates: Record<string, SVSubData>
  sketch: string | null
}

const JOB_TYPES = ['Interior repaint', 'Exterior repaint', 'Full repaint', 'New build - exterior', 'New build - interior', 'Hourly rate', 'Limewash / specialty', 'Other']

const CARD = 'bg-white border border-black/[0.12] rounded-xl p-4 mb-3.5'
const CT = 'text-[13px] font-bold'
const INP = 'w-full px-2 py-1.5 text-[13px] bg-white border border-black/20 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500'
const BTN = 'flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] bg-white border border-black/20 rounded-lg hover:bg-[#f5f4f0]'
const BTN_P = 'flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] bg-blue-600 hover:bg-blue-700 text-white rounded-lg'

export const emptyArea = (n: number): SVArea =>
  ({ id: genId('ar'), name: `Area ${n}`, condition: 'Good', prep: '', l: 0, w: 0, h: 0, notes: '' })
const emptyLine = (): SVLine => ({ id: genId('ln'), type: '', sqm: 0, lm: 0, qty: 0, notes: '' })

export function emptySVState(): SVState {
  const substrates: Record<string, SVSubData> = {}
  SV_SUBS.forEach(s => { substrates[s.key] = { inc: false, lines: [emptyLine()] } })
  return {
    date: today(), jobId: '', client: '', address: '', jobType: JOB_TYPES[0],
    notes: '', status: 'Draft',
    areas: [emptyArea(1)], photos: [], voiceNotes: [], substrates, sketch: null,
  }
}

// Fill in any substrate the saved record predates
export function normaliseSV(s: Partial<SVState> | null | undefined): SVState {
  const base = emptySVState()
  if (!s) return base
  const substrates = { ...base.substrates }
  Object.entries(s.substrates ?? {}).forEach(([k, v]: [string, any]) => {
    if (!v) return
    substrates[k] = {
      inc: !!v.inc,
      lines: Array.isArray(v.lines) && v.lines.length
        ? v.lines.map((l: any) => ({ ...emptyLine(), ...l }))
        : [emptyLine()],
    }
  })
  return {
    ...base, ...s, substrates,
    areas: s.areas?.length ? s.areas.map((a: any, i: number) => ({ ...emptyArea(i + 1), ...a })) : base.areas,
    photos: s.photos ?? [], voiceNotes: s.voiceNotes ?? [],
  }
}

const subTotal = (d: SVSubData, unit: SVSub['unit']) =>
  d.lines.reduce((t, l) => t + (unit === 'sqm' ? l.sqm : unit === 'lm' ? l.lm : l.qty), 0)

const unitLabel = (unit: SVSub['unit'], total: number) =>
  unit === 'qty' ? `${total} ${total === 1 ? 'item' : 'items'}` : `${total} ${unit === 'sqm' ? 'm²' : 'lin.m'}`

// ── Sketch pad with pen/erase, colour, size, undo ────────────
function Sketch({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const history = useRef<string[]>([])
  const [tool, setTool] = useState<'pen' | 'erase'>('pen')
  const [colour, setColour] = useState('#1a1a1a')
  const [size, setSize] = useState(4)

  useEffect(() => {
    const c = ref.current
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

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = ref.current!
    const r = c.getBoundingClientRect()
    return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) }
  }

  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = ref.current!
    history.current.push(c.toDataURL('image/png'))
    if (history.current.length > 20) history.current.shift()
    drawing.current = true
    const ctx = c.getContext('2d')!
    const { x, y } = pos(e)
    ctx.beginPath(); ctx.moveTo(x, y)
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    ctx.lineWidth = tool === 'erase' ? size * 3 : size
    ctx.strokeStyle = tool === 'erase' ? '#fff' : colour
    c.setPointerCapture(e.pointerId)
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return
    const ctx = ref.current!.getContext('2d')!
    const { x, y } = pos(e)
    ctx.lineTo(x, y); ctx.stroke()
  }
  function up() {
    if (!drawing.current) return
    drawing.current = false
    onChange(ref.current!.toDataURL('image/png'))
  }
  function undo() {
    const prev = history.current.pop()
    if (!prev) return
    const ctx = ref.current!.getContext('2d')!
    const img = new Image()
    img.onload = () => {
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, ref.current!.width, ref.current!.height)
      ctx.drawImage(img, 0, 0)
      onChange(ref.current!.toDataURL('image/png'))
    }
    img.src = prev
  }
  function clear() {
    const c = ref.current!
    history.current.push(c.toDataURL('image/png'))
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height)
    onChange(null)
  }

  return (
    <div className="border border-black/[0.12] rounded-[10px] overflow-hidden">
      <div className="flex justify-between items-center px-3 py-2 border-b border-black/[0.12] bg-[#f9f9f7] flex-wrap gap-1.5">
        <div className="flex gap-1.5 items-center">
          <button onClick={() => setTool('pen')}
            className={`flex items-center gap-1 px-2.5 py-1 text-[12px] rounded-lg border ${tool === 'pen' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-black/20'}`}>
            <Pencil size={12} /> Pen
          </button>
          <button onClick={() => setTool('erase')}
            className={`flex items-center gap-1 px-2.5 py-1 text-[12px] rounded-lg border ${tool === 'erase' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-black/20'}`}>
            <Eraser size={12} /> Erase
          </button>
          <input type="color" value={colour} onChange={e => setColour(e.target.value)}
            className="w-7 h-7 border border-black/[0.12] rounded p-0.5 cursor-pointer" />
          <select value={size} onChange={e => setSize(parseInt(e.target.value))}
            className="px-1.5 py-1 border border-black/[0.12] rounded-md text-xs bg-white">
            <option value={2}>Thin</option>
            <option value={4}>Medium</option>
            <option value={8}>Thick</option>
            <option value={16}>Bold</option>
          </select>
        </div>
        <div className="flex gap-1.5">
          <button onClick={undo} className={BTN}><Undo2 size={12} /> Undo</button>
          <button onClick={clear} className={`${BTN} text-[#c0392b]`}><Trash2 size={12} /> Clear</button>
        </div>
      </div>
      <canvas ref={ref} width={600} height={375}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}
        className="w-full h-auto block bg-white cursor-crosshair touch-none" />
    </div>
  )
}

export default function SiteVisitEditor({ initial, jobs, isNew, onClose, onSave, onAIParse, aiBusy }: {
  initial: SVState
  jobs: Row[]
  isNew: boolean
  onClose: () => void
  onSave: (state: SVState, complete: boolean) => void
  onAIParse?: (state: SVState) => void
  aiBusy?: boolean
}) {
  const [sv, setSv] = useState<SVState>(initial)
  const [listening, setListening] = useState(false)
  const camRef = useRef<HTMLInputElement>(null)
  const upRef = useRef<HTMLInputElement>(null)

  const patch = (p: Partial<SVState>) => setSv(s => ({ ...s, ...p }))

  // Areas
  const setArea = (id: string, p: Partial<SVArea>) =>
    setSv(s => ({ ...s, areas: s.areas.map(a => a.id === id ? { ...a, ...p } : a) }))
  const addArea = () => setSv(s => ({ ...s, areas: [...s.areas, emptyArea(s.areas.length + 1)] }))
  const dupArea = (a: SVArea) =>
    setSv(s => ({ ...s, areas: [...s.areas, { ...a, id: genId('ar'), name: `${a.name} (copy)` }] }))
  const delArea = (id: string) => setSv(s => ({ ...s, areas: s.areas.filter(a => a.id !== id) }))

  // Substrates
  const setSub = (key: string, p: Partial<SVSubData>) =>
    setSv(s => ({ ...s, substrates: { ...s.substrates, [key]: { ...s.substrates[key], ...p } } }))
  const setLine = (key: string, lineId: string, p: Partial<SVLine>) =>
    setSv(s => ({
      ...s,
      substrates: {
        ...s.substrates,
        [key]: { ...s.substrates[key], lines: s.substrates[key].lines.map(l => l.id === lineId ? { ...l, ...p } : l) },
      },
    }))
  const addLine = (key: string) =>
    setSv(s => ({ ...s, substrates: { ...s.substrates, [key]: { ...s.substrates[key], lines: [...s.substrates[key].lines, emptyLine()] } } }))
  const delLine = (key: string, lineId: string) =>
    setSv(s => ({
      ...s,
      substrates: {
        ...s.substrates,
        [key]: { ...s.substrates[key], lines: s.substrates[key].lines.filter(l => l.id !== lineId) },
      },
    }))

  // Photos
  async function addPhotos(e: React.ChangeEvent<HTMLInputElement>, tag = 'reference') {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    for (const file of files) {
      const data = await new Promise<string>(res => {
        const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsDataURL(file)
      })
      setSv(s => ({ ...s, photos: [...s.photos, { id: genId('ph'), data, tag, label: '' }] }))
    }
  }

  // Voice
  function record() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) { alert('Voice input not supported in this browser.\nPlease use Google Chrome.'); return }
    const rec = new SR()
    rec.lang = 'en-AU'; rec.interimResults = false; rec.maxAlternatives = 1; rec.continuous = false
    setListening(true)
    rec.onresult = (ev: any) => {
      setListening(false)
      const text = ev.results[0][0].transcript
      setSv(s => ({ ...s, voiceNotes: [...s.voiceNotes, { id: genId('vn'), text }] }))
    }
    rec.onerror = (ev: any) => { setListening(false); if (ev.error !== 'no-speech') alert(`Voice error: ${ev.error}`) }
    rec.onend = () => setListening(false)
    try { rec.start() } catch (err: any) { setListening(false); alert('Could not start microphone: ' + err.message) }
  }

  // Grouped substrate rows
  let lastGroup = ''

  return (
    <div className="fixed inset-0 z-[200] bg-[#f5f4f0] overflow-y-auto overscroll-contain">
      {/* Sticky header */}
      <div className="bg-white border-b-2 border-black/[0.12] px-4 py-3 flex justify-between items-center sticky top-0 z-10 flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <button onClick={onClose} className={BTN}><ArrowLeft size={13} /> Back</button>
          <h2 className="text-base font-semibold m-0">{isNew ? 'New Site Visit' : (sv.client || 'Site Visit')}</h2>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => onSave(sv, false)} className={BTN}><Save size={13} /> Save Draft</button>
          <button onClick={() => onSave(sv, true)} className={BTN_P}><Check size={13} /> Complete &amp; Link to Job</button>
        </div>
      </div>

      <div className="max-w-[900px] mx-auto p-4">
        {/* Visit details */}
        <div className={CARD}>
          <div className={`${CT} mb-2.5`}>Visit details</div>
          <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))' }}>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Date</label>
              <input type="date" value={sv.date} onChange={e => patch({ date: e.target.value })} className={INP} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Link to job</label>
              <select value={sv.jobId} onChange={e => {
                const j = jobs.find(x => x.id === e.target.value)
                patch({ jobId: e.target.value, ...(j ? { client: j.client ?? '', address: j.address ?? '', jobType: j.type ?? sv.jobType } : {}) })
              }} className={INP}>
                <option value="">— Standalone visit —</option>
                {jobs.map(j => <option key={j.id} value={j.id}>{j.id} — {j.client}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Client name</label>
              <input value={sv.client} onChange={e => patch({ client: e.target.value })} className={INP} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Address</label>
              <input value={sv.address} onChange={e => patch({ address: e.target.value })} className={INP} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Job type</label>
              <select value={sv.jobType} onChange={e => patch({ jobType: e.target.value })} className={INP}>
                {JOB_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label className="block text-xs font-medium text-gray-500 mb-1">General notes</label>
              <textarea rows={3} value={sv.notes} onChange={e => patch({ notes: e.target.value })} className={`${INP} resize-y`} />
            </div>
          </div>
        </div>

        {/* Voice notes */}
        <div className={CARD}>
          <div className="flex justify-between items-center mb-2.5 gap-2 flex-wrap">
            <div className={CT}>Voice notes</div>
            <button onClick={record} className={BTN_P}>
              <Mic size={13} /> {listening ? 'Listening…' : 'Record voice note'}
            </button>
          </div>
          <div className="flex flex-col gap-1.5">
            {sv.voiceNotes.map(vn => (
              <div key={vn.id} className="bg-[#f0fdf4] rounded-lg px-3 py-2 flex justify-between items-start gap-2">
                <div className="text-[13px] flex-1">{vn.text}</div>
                <button onClick={() => setSv(s => ({ ...s, voiceNotes: s.voiceNotes.filter(v => v.id !== vn.id) }))}
                  className="text-[#666] text-base leading-none shrink-0">×</button>
              </div>
            ))}
          </div>
          {listening && <div className="text-xs text-[#dc2626] mt-2">● Recording… speak now</div>}
          {onAIParse && (
            <div className="mt-2.5 px-3 py-2 bg-[#fefce8] rounded-lg text-xs text-[#92400e] flex items-center justify-between gap-2 flex-wrap">
              <span className="flex items-center gap-1.5">
                <Sparkles size={13} /> Record your walkthrough, then let AI extract areas and measurements from your notes
              </span>
              <button onClick={() => onAIParse(sv)} disabled={aiBusy}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] rounded-lg bg-[#eab308] text-white border border-[#d97706] whitespace-nowrap disabled:opacity-50">
                {aiBusy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} AI Parse
              </button>
            </div>
          )}
        </div>

        {/* Areas */}
        <div className={CARD}>
          <div className={`${CT} mb-3`}>Areas / Rooms</div>
          {sv.areas.map(a => {
            const hasD = a.l && a.w && a.h
            const wallSqm = hasD ? Math.round(2 * (a.l + a.w) * a.h * 10) / 10 : 0
            const ceilSqm = hasD ? Math.round(a.l * a.w * 10) / 10 : 0
            return (
              <div key={a.id} className="border border-black/[0.12] rounded-[10px] p-3 mb-2.5">
                <div className="flex justify-between items-center mb-2.5 gap-2">
                  <input value={a.name} onChange={e => setArea(a.id, { name: e.target.value })}
                    className="font-semibold text-sm border-0 border-b border-black/[0.12] py-1 bg-transparent w-[180px] outline-none" />
                  <div className="flex gap-1.5 items-center">
                    <button onClick={() => dupArea(a)} title="Duplicate this area"
                      className="flex items-center gap-1 px-2 py-1 text-[11px] border border-black/[0.12] rounded-[7px] text-[#666] bg-white">
                      <Copy size={11} /> Duplicate
                    </button>
                    <button onClick={() => delArea(a.id)} className="text-[#666] text-lg leading-none px-1">×</button>
                  </div>
                </div>
                <div className="grid gap-2 mb-2" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))' }}>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Condition</label>
                    <select value={a.condition} onChange={e => setArea(a.id, { condition: e.target.value })} className={INP}>
                      {SV_CONDITIONS.map(c => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Prep needed</label>
                    <input value={a.prep} onChange={e => setArea(a.id, { prep: e.target.value })}
                      placeholder="e.g. Fill cracks, sand, prime" className={INP} />
                  </div>
                </div>
                <div className="bg-[#f8f8f6] rounded-lg p-2.5 mb-2">
                  <div className="text-[11px] font-semibold text-[#666] uppercase tracking-wide mb-2">Dimensions</div>
                  <div className="grid grid-cols-3 gap-1.5 mb-1.5">
                    {(['l', 'w', 'h'] as const).map(k => (
                      <div key={k}>
                        <label className="block text-xs font-medium text-gray-500 mb-1">
                          {k === 'l' ? 'Length' : k === 'w' ? 'Width' : 'Height'} (m)
                        </label>
                        <input type="number" min={0} step="0.1" value={a[k] || ''} placeholder="0.0"
                          onChange={e => setArea(a.id, { [k]: parseFloat(e.target.value) || 0 } as Partial<SVArea>)}
                          className={INP} />
                      </div>
                    ))}
                  </div>
                  {wallSqm > 0 && (
                    <div className="text-xs text-[#0a7c4e] font-semibold">Walls: {wallSqm} m² · Ceiling: {ceilSqm} m²</div>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Notes</label>
                  <textarea rows={2} value={a.notes} onChange={e => setArea(a.id, { notes: e.target.value })} className={`${INP} resize-y`} />
                </div>
              </div>
            )
          })}
          <button onClick={addArea} className={`${BTN_P} w-full justify-center mt-2`}><Plus size={13} /> Add area</button>
        </div>

        {/* Photos */}
        <div className={CARD}>
          <div className="flex justify-between items-center mb-3 gap-2 flex-wrap">
            <div className={CT}>Photos</div>
            <div className="flex gap-2">
              <button onClick={() => camRef.current?.click()} className={BTN_P}><Camera size={13} /> Take photo</button>
              <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden"
                onChange={e => addPhotos(e, 'before')} />
              <button onClick={() => upRef.current?.click()} className={BTN}><Upload size={13} /> Upload</button>
              <input ref={upRef} type="file" accept="image/*" multiple className="hidden"
                onChange={e => addPhotos(e, 'reference')} />
            </div>
          </div>
          {sv.photos.length === 0 ? (
            <div className="text-center py-6 text-[#666] text-[13px]">
              <Camera size={32} className="mx-auto mb-2 opacity-30" />
              No photos yet — tap "Take photo" to use your camera
            </div>
          ) : (
            <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(160px,1fr))' }}>
              {sv.photos.map(p => (
                <div key={p.id} className="border border-black/[0.12] rounded-[10px] overflow-hidden relative">
                  <img src={p.data} alt={p.label} className="w-full h-[130px] object-cover block" />
                  <div className="px-2 py-1.5">
                    <select value={p.tag}
                      onChange={e => setSv(s => ({ ...s, photos: s.photos.map(x => x.id === p.id ? { ...x, tag: e.target.value } : x) }))}
                      className="w-full px-1 py-0.5 border border-black/[0.12] rounded-[5px] text-[11px] mb-1 bg-white">
                      {SV_PHOTO_TAGS.map(t => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}
                    </select>
                    <div className="text-[10px] font-bold text-center py-0.5 rounded"
                      style={{ background: SV_TAG_BG[p.tag] ?? SV_TAG_BG.reference, color: SV_TAG_FG[p.tag] ?? SV_TAG_FG.reference }}>
                      {(p.tag || 'reference').toUpperCase()}
                    </div>
                    <input value={p.label} placeholder="Caption…"
                      onChange={e => setSv(s => ({ ...s, photos: s.photos.map(x => x.id === p.id ? { ...x, label: e.target.value } : x) }))}
                      className="w-full text-[11px] border-0 border-t border-black/[0.12] py-1 mt-1 bg-transparent outline-none" />
                  </div>
                  <button onClick={() => setSv(s => ({ ...s, photos: s.photos.filter(x => x.id !== p.id) }))}
                    className="absolute top-1 right-1 w-[22px] h-[22px] rounded-full bg-black/60 text-white text-sm leading-none flex items-center justify-center">×</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Substrates & elements */}
        <div className={CARD}>
          <div className="flex justify-between items-center mb-3 gap-2 flex-wrap">
            <div className={CT}>Substrates &amp; Elements</div>
            <span className="text-[11px] text-[#666]">Tick what's included · enter qty/area · note type</span>
          </div>
          <div>
            {SV_SUBS.map(sub => {
              const d = sv.substrates[sub.key] ?? { inc: false, lines: [] }
              const total = subTotal(d, sub.unit)
              const header = sub.group !== lastGroup ? sub.group : null
              if (header) lastGroup = sub.group
              return (
                <div key={sub.key}>
                  {header && (
                    <div className="px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-widest text-[#444] mt-2 first:mt-0"
                      style={{ background: SV_GROUP_HDR[header], borderRadius: '6px 6px 0 0' }}>
                      {header}
                    </div>
                  )}
                  <div className="border border-black/[0.08] border-t-0 px-3 py-2.5 transition-opacity"
                    style={{ background: d.inc ? '#fff' : SV_GROUP_BG[sub.group], opacity: d.inc ? 1 : 0.55 }}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <input type="checkbox" checked={d.inc} id={`sv-${sub.key}`}
                        onChange={e => setSub(sub.key, { inc: e.target.checked })}
                        className="w-5 h-5 cursor-pointer shrink-0 accent-blue-600" />
                      <label htmlFor={`sv-${sub.key}`} className="text-[13px] font-semibold cursor-pointer flex-1 min-w-[100px]">
                        {sub.label}
                      </label>
                      {total > 0 && (
                        <span className="text-[11px] font-bold text-[#0a7c4e] bg-[#dcfce7] rounded-[5px] px-1.5 py-0.5">
                          {unitLabel(sub.unit, total)}
                        </span>
                      )}
                      {d.inc && (
                        <button onClick={() => addLine(sub.key)}
                          className="px-2.5 py-1 border-[1.5px] border-dashed border-[#2563eb] rounded-[7px] text-[11px] text-[#2563eb] font-semibold whitespace-nowrap">
                          + Add type
                        </button>
                      )}
                    </div>

                    {d.inc && (
                      <div className="mt-2 flex flex-col gap-1.5">
                        {d.lines.map(ln => (
                          <div key={ln.id} className="flex items-center gap-1.5 flex-wrap bg-[#f8f8f6] rounded-lg px-2 py-1.5">
                            {sub.typeOpts ? (
                              <select value={ln.type} onChange={e => setLine(sub.key, ln.id, { type: e.target.value })}
                                className="px-1.5 py-1 text-[11px] bg-white border border-black/20 rounded min-w-[110px]">
                                <option value="">Type…</option>
                                {sub.typeOpts.map(t => <option key={t} value={t}>{t}</option>)}
                              </select>
                            ) : (
                              <input value={ln.type} placeholder="Type / detail"
                                onChange={e => setLine(sub.key, ln.id, { type: e.target.value })}
                                className="px-1.5 py-1 text-[11px] bg-white border border-black/20 rounded min-w-[110px] flex-1" />
                            )}
                            <input type="number" min={0} step="any"
                              value={(sub.unit === 'sqm' ? ln.sqm : sub.unit === 'lm' ? ln.lm : ln.qty) || ''}
                              placeholder="0"
                              onChange={e => {
                                const v = parseFloat(e.target.value) || 0
                                setLine(sub.key, ln.id, sub.unit === 'sqm' ? { sqm: v } : sub.unit === 'lm' ? { lm: v } : { qty: v })
                              }}
                              className="w-16 px-1.5 py-1 text-right font-mono text-[11px] bg-white border border-black/20 rounded" />
                            <span className="text-[10px] text-[#999] w-9">
                              {sub.unit === 'sqm' ? 'm²' : sub.unit === 'lm' ? 'lin.m' : 'items'}
                            </span>
                            <input value={ln.notes} placeholder="Notes…"
                              onChange={e => setLine(sub.key, ln.id, { notes: e.target.value })}
                              className="flex-1 min-w-[90px] px-1.5 py-1 text-[11px] bg-white border border-black/20 rounded" />
                            {d.lines.length > 1 && (
                              <button onClick={() => delLine(sub.key, ln.id)} className="text-[#c0392b]"><Trash2 size={12} /></button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Sketch */}
        <div className={CARD}>
          <div className="flex justify-between items-center mb-3 gap-2 flex-wrap">
            <div className={CT}>Sketch / Floor Plan</div>
            <span className="text-[11px] text-[#666]">Draw a rough plan or mark up areas</span>
          </div>
          <Sketch value={sv.sketch} onChange={v => patch({ sketch: v })} />
        </div>
      </div>
    </div>
  )
}
