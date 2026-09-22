import { useState, useMemo, useEffect } from 'react'
import { Plus, Copy, Trash2, Settings2, Calculator } from 'lucide-react'

// ── V16 constants ────────────────────────────────────────────
const UM2: Record<string, number> = {
  cornice: 0.15, skirtings: 0.10, architraves: 0.08, architraves_e: 0.08,
  fascia: 0.25, gutters: 0.18, balustrades: 0.35, fences: 1.8,
  doors_i: 2.0, doors_e: 2.0, garage_e: 8.0, win_i: 0.75, win_e: 0.75,
  wardrobes: 4.5, posts: 0.5, downpipes: 0.25,
}

const UC_DEF: Record<string, { n: string; L: number; p: number; cov: number }> = {
  acrylic: { n: 'Dulux Acrylic Undercoat', L: 10, p: 99, cov: 12 },
  oil:     { n: 'Dulux Oil Based Undercoat', L: 4, p: 64, cov: 12 },
  ext:     { n: 'Dulux Exterior Primer', L: 4, p: 58, cov: 12 },
}

const CATALOG = [
  { n: 'Dulux Ceiling White Flat', L: 15, p: 120, cov: 14 },
  { n: 'Dulux Wash+Wear Low Sheen', L: 15, p: 155, cov: 16 },
  { n: 'Dulux Aquanamel Semi-Gloss', L: 4, p: 72, cov: 12 },
  { n: 'Dulux Aquanamel Gloss', L: 4, p: 72, cov: 12 },
  { n: 'Dulux Acrylic Undercoat', L: 10, p: 99, cov: 12 },
  { n: 'Dulux Oil Based Undercoat', L: 4, p: 64, cov: 12 },
  { n: 'Dulux Weathershield Low Sheen', L: 15, p: 185, cov: 14 },
  { n: 'Dulux Weathershield Semi-Gloss', L: 4, p: 70, cov: 12 },
  { n: 'Dulux Exterior Primer', L: 4, p: 58, cov: 12 },
  { n: 'Acratex Render Coat', L: 15, p: 172, cov: 6 },
  { n: 'Dulux Roof & Trim', L: 10, p: 135, cov: 10 },
  { n: 'Dulux Super Grip Medium', L: 10, p: 118, cov: 6 },
  { n: 'Cutek CD50 Clear', L: 4, p: 79, cov: 8 },
  { n: 'Cutek CD50 Tinted', L: 4, p: 82, cov: 8 },
  { n: 'Intergrain Ultradeck', L: 4, p: 72, cov: 8 },
  { n: 'Limewash', L: 5, p: 92, cov: 8 },
  { n: 'Porters Stone Finish', L: 4, p: 82, cov: 8 },
  { n: 'Sikkens Cetol TGL Gloss', L: 1, p: 44, cov: 10 },
  { n: 'Berger Breathe Easy Low Sheen', L: 15, p: 135, cov: 15 },
  { n: 'Taubmans All Weather Deck', L: 4, p: 68, cov: 10 },
]

type Preset = { key: string; label: string; unit: string; product: string; L: number; p: number; cov: number; coats: number; note?: string }

const INT: Preset[] = [
  { key:'ceilings',    label:'Ceilings',          unit:'m²',   product:'Dulux Ceiling White Flat',   L:15, p:120, cov:14, coats:2 },
  { key:'cornice',     label:'Cornice',           unit:'lm',   product:'Dulux Ceiling White Flat',   L:15, p:120, cov:14, coats:2, note:'0.15 m²/lm' },
  { key:'walls',       label:'Walls',             unit:'m²',   product:'Dulux Wash+Wear Low Sheen',  L:15, p:155, cov:16, coats:2 },
  { key:'feature',     label:'Feature wall',      unit:'m²',   product:'Dulux Wash+Wear Low Sheen',  L:15, p:155, cov:16, coats:2 },
  { key:'wet_ceil',    label:'Wet area ceilings', unit:'m²',   product:'Dulux Wash+Wear Low Sheen',  L:15, p:155, cov:16, coats:2 },
  { key:'wet_walls',   label:'Wet area walls',    unit:'m²',   product:'Dulux Wash+Wear Low Sheen',  L:15, p:155, cov:16, coats:2 },
  { key:'doors_i',     label:'Doors (interior)',  unit:'each', product:'Dulux Aquanamel Semi-Gloss', L:4,  p:72,  cov:12, coats:2, note:'2.0 m²/each' },
  { key:'win_i',       label:'Window frames',     unit:'each', product:'Dulux Aquanamel Semi-Gloss', L:4,  p:72,  cov:12, coats:2, note:'0.75 m²/each' },
  { key:'architraves', label:'Architraves',       unit:'each', product:'Dulux Aquanamel Semi-Gloss', L:4,  p:72,  cov:12, coats:2, note:'0.08 m²/each' },
  { key:'skirtings',   label:'Skirting boards',   unit:'lm',   product:'Dulux Aquanamel Semi-Gloss', L:4,  p:72,  cov:12, coats:2, note:'0.10 m²/lm' },
  { key:'wardrobes',   label:'Built-in wardrobes',unit:'each', product:'Dulux Wash+Wear Low Sheen',  L:15, p:155, cov:16, coats:2, note:'4.5 m²/each' },
]

const EXT: Preset[] = [
  { key:'weatherboards', label:'Weatherboards',           unit:'m²',   product:'Dulux Weathershield Low Sheen',  L:15, p:185, cov:14, coats:2 },
  { key:'cladding',      label:'Cladding (fibre cement)', unit:'m²',   product:'Dulux Weathershield Low Sheen',  L:15, p:185, cov:14, coats:2 },
  { key:'render',        label:'Render & masonry',        unit:'m²',   product:'Acratex Render Coat',            L:15, p:172, cov:6,  coats:2 },
  { key:'eaves',         label:'Eaves & soffits',         unit:'m²',   product:'Dulux Weathershield Low Sheen',  L:15, p:185, cov:14, coats:2 },
  { key:'fascia',        label:'Fascia boards',           unit:'lm',   product:'Dulux Weathershield Low Sheen',  L:15, p:185, cov:14, coats:2, note:'0.25 m²/lm' },
  { key:'gutters',       label:'Gutters',                 unit:'lm',   product:'Dulux Weathershield Low Sheen',  L:15, p:185, cov:14, coats:2, note:'0.18 m²/lm' },
  { key:'downpipes',     label:'Downpipes',               unit:'each', product:'Dulux Weathershield Low Sheen',  L:15, p:185, cov:14, coats:2, note:'0.25 m²/each' },
  { key:'fences',        label:'Fences',                  unit:'lm',   product:'Dulux Weathershield Low Sheen',  L:15, p:185, cov:14, coats:2, note:'1.8 m²/lm' },
  { key:'balustrades',   label:'Balustrades/handrails',   unit:'lm',   product:'Dulux Weathershield Semi-Gloss', L:4,  p:70,  cov:12, coats:2, note:'0.35 m²/lm' },
  { key:'posts',         label:'Posts & columns',         unit:'each', product:'Dulux Weathershield Low Sheen',  L:15, p:185, cov:14, coats:2, note:'0.5 m²/each' },
  { key:'doors_e',       label:'Doors (exterior)',        unit:'each', product:'Dulux Weathershield Semi-Gloss', L:4,  p:70,  cov:12, coats:2, note:'2.0 m²/each' },
  { key:'win_e',         label:'Window frames (ext.)',    unit:'each', product:'Dulux Weathershield Semi-Gloss', L:4,  p:70,  cov:12, coats:2, note:'0.75 m²/each' },
  { key:'architraves_e', label:'Architraves (exterior)',  unit:'each', product:'Dulux Weathershield Semi-Gloss', L:4,  p:70,  cov:12, coats:2, note:'0.08 m²/each' },
  { key:'garage_e',      label:'Garage doors',            unit:'each', product:'Dulux Weathershield Low Sheen',  L:15, p:185, cov:14, coats:2, note:'8.0 m²/each' },
  { key:'roof',          label:'Roof coating',            unit:'m²',   product:'Dulux Roof & Trim',              L:10, p:135, cov:10, coats:2 },
  { key:'concrete',      label:'Concrete & paving',       unit:'m²',   product:'Dulux Super Grip Medium',        L:10, p:118, cov:6,  coats:2 },
]

const SPC: Preset[] = [
  { key:'deck_oil',    label:'Deck (clear oil)',  unit:'m²', product:'Cutek CD50 Clear',        L:4, p:79, cov:8,  coats:2 },
  { key:'deck_tinted', label:'Deck (tinted oil)', unit:'m²', product:'Cutek CD50 Tinted',       L:4, p:82, cov:8,  coats:2 },
  { key:'deck_stain',  label:'Deck stain',        unit:'m²', product:'Intergrain Ultradeck',    L:4, p:72, cov:8,  coats:2 },
  { key:'limewash',    label:'Limewash',          unit:'m²', product:'Limewash',                L:5, p:92, cov:8,  coats:2 },
  { key:'stone',       label:'Stone finish',      unit:'m²', product:'Porters Stone Finish',    L:4, p:82, cov:8,  coats:2 },
  { key:'timber',      label:'Timber stain',      unit:'m²', product:'Sikkens Cetol TGL Gloss', L:1, p:44, cov:10, coats:2 },
]

const PRESETS: Record<Section, Preset[]> = { interior: INT, exterior: EXT, specialty: SPC }
type Section = 'interior' | 'exterior' | 'specialty'
const SECTIONS: { id: Section; label: string }[] = [
  { id: 'interior', label: 'Interior' },
  { id: 'exterior', label: 'Exterior' },
  { id: 'specialty', label: 'Specialty' },
]

type Row = {
  id: number; key: string | null; label: string; unit: string; note: string
  qty: number; coats: number; product: string; L: number; price: number; cov: number
  colour: string; uc: boolean; ucType: string; ucCoats: number; ucCov: number; ucPrice: number; ucL: number
  expanded: boolean; custom: boolean
}

let seq = 0
function mk(p: Partial<Preset> & { custom?: boolean }): Row {
  return {
    id: seq++, key: p.key ?? null, label: p.label ?? '', unit: p.unit ?? 'm²', note: p.note ?? '',
    qty: 0, coats: p.coats ?? 2, product: p.product ?? '', L: p.L ?? 4, price: p.p ?? 0, cov: p.cov ?? 12,
    colour: '', uc: false, ucType: 'acrylic', ucCoats: 1, ucCov: 12, ucPrice: 99, ucL: 10,
    expanded: false, custom: !!p.custom,
  }
}
const freshRows = (): Record<Section, Row[]> => ({
  interior: INT.map(p => mk(p)),
  exterior: EXT.map(p => mk(p)),
  specialty: SPC.map(p => mk(p)),
})

const LS_KEY = 'np_paintcalc_v1'
const INP = 'px-1.5 py-1 border border-black/20 rounded-md text-xs bg-white focus:outline-none focus:ring-1 focus:ring-blue-500'
const MINI = 'w-5 h-5 p-0 min-w-0 text-[13px] leading-none bg-white border border-black/20 rounded hover:bg-[#f5f4f0] flex items-center justify-center'

function isColour(v: string) {
  if (!v) return ''
  const s = new Option().style
  s.color = v
  return s.color ? v : ''
}

export default function PaintCalc() {
  const [rows, setRows] = useState<Record<Section, Row[]>>(freshRows)
  const [wastePct, setWastePct] = useState(10)
  const [tab, setTab] = useState<Section>('interior')

  // Persist across navigation
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY)
      if (raw) {
        const saved = JSON.parse(raw)
        if (saved?.rows) {
          setRows(saved.rows)
          seq = Math.max(seq, ...Object.values(saved.rows as Record<Section, Row[]>).flat().map(r => r.id + 1))
        }
        if (typeof saved?.wastePct === 'number') setWastePct(saved.wastePct)
      }
    } catch {}
  }, [])
  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ rows, wastePct })) } catch {}
  }, [rows, wastePct])

  function update(sec: Section, id: number, patch: Partial<Row>) {
    setRows(prev => ({ ...prev, [sec]: prev[sec].map(r => r.id === id ? { ...r, ...patch } : r) }))
  }
  function removeRow(sec: Section, id: number) {
    setRows(prev => ({ ...prev, [sec]: prev[sec].filter(r => r.id !== id) }))
  }
  function duplicate(sec: Section, id: number) {
    setRows(prev => {
      const list = prev[sec]
      const i = list.findIndex(r => r.id === id)
      if (i < 0) return prev
      const clone = { ...list[i], id: seq++, qty: 0, custom: true, expanded: false }
      const next = [...list]
      next.splice(i + 1, 0, clone)
      return { ...prev, [sec]: next }
    })
  }
  function addCustom(sec: Section) {
    setRows(prev => ({ ...prev, [sec]: [...prev[sec], mk({ label: '', unit: 'm²', custom: true, coats: 2, cov: 12, L: 4, p: 0 })] }))
  }
  function resetSection(sec: Section) {
    if (!confirm(`Reset ${sec} substrates to defaults?`)) return
    setRows(prev => ({ ...prev, [sec]: PRESETS[sec].map(p => mk(p)) }))
  }
  // Selecting a catalogue product fills tin size / coverage / price
  function onProduct(sec: Section, id: number, value: string) {
    const hit = CATALOG.find(c => c.n.toLowerCase() === value.trim().toLowerCase())
    update(sec, id, hit ? { product: value, L: hit.L, price: hit.p, cov: hit.cov } : { product: value })
  }

  // ── Results (V16 renderResults_pc) ────────────────────────
  const results = useMemo(() => {
    const waste = 1 + wastePct / 100
    const prodMap: Record<string, { product: string; colour: string; L: number; price: number; litres: number }> = {}
    const ucMap: Record<string, { product: string; L: number; price: number; litres: number }> = {}

    ;(Object.keys(rows) as Section[]).forEach(sec => rows[sec].forEach(r => {
      if (!r.qty || r.qty <= 0) return
      const m2 = r.unit === 'm²' ? r.qty : r.qty * (UM2[r.key ?? ''] ?? 1.0)
      const litres = (m2 * (r.coats || 2)) / (r.cov || 12)
      if (litres > 0) {
        const k = `${r.product || 'Custom'}||${r.colour || ''}`
        if (!prodMap[k]) prodMap[k] = { product: r.product || 'Custom', colour: r.colour || '', L: r.L || 4, price: r.price || 0, litres: 0 }
        prodMap[k].litres += litres
      }
      if (r.uc) {
        const d = UC_DEF[r.ucType] ?? UC_DEF.acrylic
        if (!ucMap[r.ucType]) ucMap[r.ucType] = { product: d.n, L: r.ucL || d.L, price: r.ucPrice || d.p, litres: 0 }
        ucMap[r.ucType].litres += (m2 * (r.ucCoats || 1)) / (r.ucCov || d.cov)
      }
    }))

    const calc = (p: { L: number; price: number; litres: number }) => {
      const lW = p.litres * waste
      const tins = Math.ceil(lW / p.L)
      return { lW, tins, cost: tins * p.price }
    }
    const top = Object.values(prodMap).map(p => ({ ...p, ...calc(p) }))
    const uc = Object.values(ucMap).map(p => ({ ...p, colour: '', ...calc(p) }))
    const all = [...top, ...uc]
    return {
      top, uc,
      totalCost: all.reduce((s, x) => s + x.cost, 0),
      totalL: all.reduce((s, x) => s + x.lW, 0),
      totalTins: all.reduce((s, x) => s + x.tins, 0),
    }
  }, [rows, wastePct])

  const Item = ({ p, isUC }: { p: any; isUC?: boolean }) => (
    <div className="border border-black/[0.12] rounded-[7px] px-2.5 py-2 mb-1.5">
      <div className="flex justify-between items-start mb-1.5">
        <span className="font-bold text-[13px]">
          {p.product}{isUC && <span className="text-[10px] font-normal text-[#666] ml-1">(UC)</span>}
        </span>
        <span className="font-mono text-[13px] font-bold text-[#1a6b3c]">${p.cost.toLocaleString('en-AU')}</span>
      </div>
      {p.colour && (
        <div className="flex items-center gap-1.5 mb-1 text-[11px] text-[#666]">
          <span className="w-2.5 h-2.5 rounded-full border border-black/20" style={{ background: isColour(p.colour) || '#ccc' }} />
          {p.colour}
        </div>
      )}
      <div className="grid grid-cols-3 gap-1">
        {[
          { v: `${p.lW.toFixed(1)}L`, l: 'Litres' },
          { v: `${p.tins} × ${p.L}L`, l: 'Tins' },
          { v: `$${p.price}`, l: '$/tin' },
        ].map(x => (
          <div key={x.l} className="text-center bg-[#f5f4f0] border border-black/[0.12] rounded px-1 py-1">
            <div className="font-mono font-bold text-xs text-[#2563eb]">{x.v}</div>
            <div className="text-[9px] text-[#999] uppercase">{x.l}</div>
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <div className="p-5">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <h2 className="text-[17px] font-semibold text-gray-900 flex items-center gap-2">
          <Calculator size={18} className="text-[#2563eb]" /> Paint Calculator
        </h2>
        <div className="flex items-center gap-2">
          <label className="text-[11px] text-[#666]">Waste / overage</label>
          <div className="flex items-center gap-1">
            <input type="number" min={0} max={50} value={wastePct}
              onChange={e => setWastePct(parseFloat(e.target.value) || 0)}
              className={`${INP} w-14 text-right font-mono`} />
            <span className="text-[11px] text-[#666]">%</span>
          </div>
        </div>
      </div>

      <div className="grid gap-3.5 items-start" style={{ gridTemplateColumns: 'minmax(0,1fr) 340px' }}>
        {/* Substrates */}
        <div>
          <div className="flex gap-[3px] bg-[#f5f4f0] border border-black/[0.12] rounded-lg p-[3px] mb-2.5 w-fit">
            {SECTIONS.map(s => (
              <button key={s.id} onClick={() => setTab(s.id)}
                className={`text-xs px-3.5 py-1.5 rounded-md ${tab === s.id ? 'bg-blue-600 text-white' : 'text-[#666]'}`}>
                {s.label}
              </button>
            ))}
          </div>

          {rows[tab].map(r => {
            const hasQ = r.qty > 0
            const ucD = UC_DEF[r.ucType] ?? UC_DEF.acrylic
            return (
              <div key={r.id} className="bg-white rounded-lg mb-1.5 overflow-hidden"
                style={{ border: `1.5px solid ${hasQ ? '#2563eb' : 'rgba(0,0,0,.12)'}` }}>
                <div className="flex items-center gap-1.5 px-2.5 py-[7px]">
                  <div className="flex-1 min-w-0">
                    {r.custom ? (
                      <input value={r.label} placeholder="Substrate name"
                        onChange={e => update(tab, r.id, { label: e.target.value })}
                        className={`${INP} font-bold text-[13px] w-full`} />
                    ) : (
                      <div className="font-bold text-[13.5px]">{r.label}</div>
                    )}
                    <div className="text-[11px] text-[#666] mt-px truncate">
                      {r.product}{r.note && <span className="text-[#999]"> · {r.note}</span>}
                    </div>
                  </div>
                  {r.colour && (
                    <span className="w-[11px] h-[11px] rounded-full border-[1.5px] border-black/20 shrink-0"
                      style={{ background: isColour(r.colour) || '#ccc' }} />
                  )}
                  <input type="number" min={0} step="any" value={r.qty || ''} placeholder="0"
                    onChange={e => update(tab, r.id, { qty: parseFloat(e.target.value) || 0 })}
                    className={`${INP} w-16 text-right font-mono font-semibold`} />
                  <span className="text-[10px] text-[#999] whitespace-nowrap">{r.unit}</span>
                  <div className="flex items-center gap-0.5">
                    <button onClick={() => update(tab, r.id, { coats: Math.max(1, r.coats - 1) })} className={MINI}>−</button>
                    <span className="text-xs font-bold font-mono min-w-[22px] text-center">{r.coats}×</span>
                    <button onClick={() => update(tab, r.id, { coats: r.coats + 1 })} className={MINI}>+</button>
                  </div>
                  <div className="flex gap-0.5">
                    <button onClick={() => update(tab, r.id, { expanded: !r.expanded })} title="Settings"
                      className={`w-6 h-6 p-0 rounded border flex items-center justify-center ${r.expanded ? 'bg-[#ede9fe] border-[#c4b5fd] text-[#5b21b6]' : 'bg-white border-black/20 hover:bg-[#f5f4f0]'}`}>
                      <Settings2 size={11} />
                    </button>
                    <button onClick={() => duplicate(tab, r.id)} title="Duplicate"
                      className="w-6 h-6 p-0 rounded bg-white border border-black/20 hover:bg-[#f5f4f0] flex items-center justify-center"><Copy size={11} /></button>
                    <button onClick={() => removeRow(tab, r.id)} title="Remove"
                      className="w-6 h-6 p-0 rounded bg-white border border-black/20 hover:bg-[#f5f4f0] flex items-center justify-center text-[#c0392b]"><Trash2 size={11} /></button>
                  </div>
                </div>

                {r.expanded && (
                  <div className="border-t border-black/[0.12] px-3 py-2.5 bg-[#f5f4f0]">
                    <div className="mb-2">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-[#666] block mb-1">Product</label>
                      <input list="pc-prodlist" value={r.product} placeholder="Type or select product…"
                        onChange={e => onProduct(tab, r.id, e.target.value)}
                        className={`${INP} w-full`} />
                    </div>
                    <div className="grid grid-cols-3 gap-2 mb-2">
                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-wider text-[#666] block mb-0.5">Tin size</label>
                        <div className="flex items-center gap-1">
                          <input type="number" min={1} step="any" value={r.L}
                            onChange={e => update(tab, r.id, { L: parseFloat(e.target.value) || 4 })}
                            className={`${INP} w-14 text-right font-mono`} />
                          <span className="text-[11px] text-[#999]">L</span>
                        </div>
                      </div>
                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-wider text-[#666] block mb-0.5">Coverage</label>
                        <div className="flex items-center gap-1">
                          <input type="number" min={1} step="any" value={r.cov}
                            onChange={e => update(tab, r.id, { cov: parseFloat(e.target.value) || 12 })}
                            className={`${INP} w-14 text-right font-mono`} />
                          <span className="text-[11px] text-[#999]">m²/L</span>
                        </div>
                      </div>
                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-wider text-[#666] block mb-0.5">Price/tin</label>
                        <div className="flex items-center gap-1">
                          <span className="text-[11px] text-[#999]">$</span>
                          <input type="number" min={0} step="any" value={r.price}
                            onChange={e => update(tab, r.id, { price: parseFloat(e.target.value) || 0 })}
                            className={`${INP} w-16 text-right font-mono`} />
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mb-2">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-[#666] whitespace-nowrap">Colour</label>
                      <span className="w-[22px] h-[22px] rounded border border-black/20"
                        style={{ background: isColour(r.colour) || '#f5f4f0' }} />
                      <input value={r.colour} placeholder="e.g. Dulux Vivid White, Lexicon Quarter…"
                        onChange={e => update(tab, r.id, { colour: e.target.value })}
                        className={`${INP} flex-1`} />
                    </div>
                    <div className="border-t border-dashed border-black/[0.12] pt-2">
                      <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
                        <input type="checkbox" id={`uc-${r.id}`} checked={r.uc}
                          onChange={e => update(tab, r.id, { uc: e.target.checked })} className="accent-blue-600" />
                        <label htmlFor={`uc-${r.id}`} className="text-[11px] font-semibold text-[#666] cursor-pointer">Add undercoat / primer</label>
                        {r.uc && (
                          <div className="flex gap-0.5">
                            {(['acrylic', 'oil', 'ext'] as const).map(t => (
                              <button key={t} onClick={() => update(tab, r.id, { ucType: t, ucPrice: UC_DEF[t].p, ucL: UC_DEF[t].L, ucCov: UC_DEF[t].cov })}
                                className={`text-[10px] px-2 py-0.5 rounded border ${r.ucType === t ? 'bg-[#ede9fe] border-[#c4b5fd] text-[#5b21b6]' : 'bg-white border-black/20 hover:bg-white'}`}>
                                {t === 'acrylic' ? 'Acrylic' : t === 'oil' ? 'Oil Based' : 'Ext Primer'}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      {r.uc && (
                        <div className="flex gap-3 flex-wrap items-center p-2 bg-white border border-black/[0.12] rounded-[5px]">
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] text-[#666] font-semibold">Coats</span>
                            <button onClick={() => update(tab, r.id, { ucCoats: Math.max(1, r.ucCoats - 1) })} className={MINI}>−</button>
                            <span className="text-xs font-bold font-mono min-w-4 text-center">{r.ucCoats}</span>
                            <button onClick={() => update(tab, r.id, { ucCoats: r.ucCoats + 1 })} className={MINI}>+</button>
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] text-[#666] font-semibold">Cov.</span>
                            <input type="number" min={1} step="any" value={r.ucCov}
                              onChange={e => update(tab, r.id, { ucCov: parseFloat(e.target.value) || ucD.cov })}
                              className={`${INP} w-12 text-right font-mono`} />
                            <span className="text-[10px] text-[#999]">m²/L</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] text-[#666] font-semibold">$/tin</span>
                            <input type="number" min={0} step="any" value={r.ucPrice}
                              onChange={e => update(tab, r.id, { ucPrice: parseFloat(e.target.value) || 0 })}
                              className={`${INP} w-14 text-right font-mono`} />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}

          <button onClick={() => addCustom(tab)}
            className="w-full mt-1.5 flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs bg-white border border-black/20 rounded-lg hover:bg-[#f5f4f0]">
            <Plus size={13} /> Add substrate
          </button>
          <button onClick={() => resetSection(tab)}
            className="block text-right w-full text-[10px] text-[#666] underline py-1 mt-0.5">Reset to defaults</button>

          <datalist id="pc-prodlist">
            {CATALOG.map(c => <option key={c.n} value={c.n} />)}
          </datalist>
        </div>

        {/* Results */}
        <div className="bg-white border border-black/[0.12] rounded-xl p-3.5 sticky top-4">
          <div className="flex justify-between items-center mb-2">
            <div className="text-[13px] font-bold">Materials required</div>
            <div className="font-mono text-base font-bold text-[#1a6b3c]">
              {results.totalCost > 0 ? `$${results.totalCost.toLocaleString('en-AU')}` : '—'}
            </div>
          </div>

          {results.top.length === 0 && results.uc.length === 0 ? (
            <div className="text-center py-8 text-[#666] text-xs">Enter quantities to see paint materials.</div>
          ) : (
            <>
              {results.top.length > 0 && (
                <>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-[#999] mt-2 mb-1 border-b border-black/[0.12] pb-0.5">Topcoats</div>
                  {results.top.map((p, i) => <Item key={i} p={p} />)}
                </>
              )}
              {results.uc.length > 0 && (
                <>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-[#999] mt-2 mb-1 border-b border-black/[0.12] pb-0.5">Undercoats / Primer</div>
                  {results.uc.map((p, i) => <Item key={i} p={p} isUC />)}
                </>
              )}
              <div className="grid grid-cols-2 gap-1.5 mt-2.5 pt-2.5 border-t border-black/[0.12]">
                <div className="bg-[#e8eff8] border border-[#2563eb] rounded-[7px] p-2 text-center">
                  <div className="font-mono text-base font-bold text-[#2563eb]">{results.totalL.toFixed(0)}L</div>
                  <div className="text-[9px] text-[#666] uppercase mt-px">Total litres</div>
                </div>
                <div className="bg-[#e8eff8] border border-[#2563eb] rounded-[7px] p-2 text-center">
                  <div className="font-mono text-base font-bold text-[#2563eb]">{results.totalTins} tins</div>
                  <div className="text-[9px] text-[#666] uppercase mt-px">To purchase</div>
                </div>
              </div>
              <div className="text-[10px] text-[#999] text-center mt-1.5">Includes {wastePct}% waste/overage</div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
