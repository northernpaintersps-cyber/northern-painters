import { useState } from 'react'
import {
  SUBSTRATES, GROUPS, GROUP_HDR, GROUP_BG, unitLabel, subTotal, newSubLine,
  UC_OPTS, COLOUR_OPTS, defaultCoat, type CoatSettings,
  type SubEntry, type SubGroup,
} from '@/lib/substrates'
import { APP_OPTS, FINISH_OPTS } from '@/lib/quoteData'
import { Trash2, SlidersHorizontal } from 'lucide-react'

/**
 * The substrate checklist, shared by the site visit and the quote builder so
 * a visit's takeoff lands in the quote unchanged. Tick a substrate, then add
 * one line per type — the type field is a combo box: pick a preset or type
 * your own.
 */
export default function SubstratePicker({ value, onChange, groups = GROUPS, showCoating = false }: {
  value: Record<string, SubEntry>
  onChange: (next: Record<string, SubEntry>) => void
  groups?: SubGroup[]
  /** V16's per-substrate coating settings panel. On in the quote builder. */
  showCoating?: boolean
}) {
  const [openCoat, setOpenCoat] = useState<Set<string>>(new Set())
  const toggleCoat = (key: string) => setOpenCoat(o => {
    const n = new Set(o); n.has(key) ? n.delete(key) : n.add(key); return n
  })

  const setEntry = (key: string, patch: Partial<SubEntry>) =>
    onChange({ ...value, [key]: { ...value[key], ...patch } })

  const setCoat = (key: string, patch: Partial<CoatSettings>) =>
    setEntry(key, { coat: { ...(value[key]?.coat ?? defaultCoat(SUBSTRATES.find(x => x.key === key))), ...patch } })

  const setLine = (key: string, lineId: string, patch: Partial<SubEntry['lines'][0]>) =>
    setEntry(key, { lines: value[key].lines.map(l => l.id === lineId ? { ...l, ...patch } : l) })

  const addLine = (key: string) =>
    setEntry(key, { lines: [...value[key].lines, newSubLine()] })

  const delLine = (key: string, lineId: string) =>
    setEntry(key, { lines: value[key].lines.filter(l => l.id !== lineId) })

  return (
    <div>
      {groups.map(group => (
        <div key={group}>
          <div className="px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-widest text-[#444] mt-2 first:mt-0"
            style={{ background: GROUP_HDR[group], borderRadius: '6px 6px 0 0' }}>
            {group}
          </div>
          {SUBSTRATES.filter(s => s.group === group).map(s => {
            const entry = value[s.key] ?? { inc: false, lines: [] }
            const total = subTotal(entry)
            return (
              <div key={s.key} className="border border-black/[0.08] border-t-0 px-3 py-2.5 transition-opacity"
                style={{ background: entry.inc ? '#fff' : GROUP_BG[group], opacity: entry.inc ? 1 : 0.55 }}>
                <div className="flex items-center gap-2 flex-wrap">
                  <input type="checkbox" id={`sub-${s.key}`} checked={entry.inc}
                    onChange={e => setEntry(s.key, {
                      inc: e.target.checked,
                      lines: entry.lines.length ? entry.lines : [newSubLine()],
                    })}
                    className="w-5 h-5 cursor-pointer shrink-0 accent-blue-600" />
                  <label htmlFor={`sub-${s.key}`} className="text-[13px] font-semibold cursor-pointer flex-1 min-w-[110px]">
                    {s.label}
                    <span className="block text-[10px] font-normal text-[#666]">{s.paint}</span>
                  </label>
                  {total > 0 && (
                    <span className="text-[11px] font-bold text-[#0a7c4e] bg-[#dcfce7] rounded-[5px] px-1.5 py-0.5 whitespace-nowrap">
                      {total} {unitLabel(s.unit)}
                    </span>
                  )}
                  {entry.inc && showCoating && (
                    <button onClick={() => toggleCoat(s.key)} title="Coating settings"
                      className={`px-2 py-1 rounded-[7px] border text-[11px] ${openCoat.has(s.key) ? 'border-[#2563eb] text-[#2563eb] bg-blue-50' : 'border-black/20 text-[#666]'}`}>
                      <SlidersHorizontal size={12} />
                    </button>
                  )}
                  {entry.inc && (
                    <button onClick={() => addLine(s.key)}
                      className="px-2.5 py-1 border-[1.5px] border-dashed border-[#2563eb] rounded-[7px] text-[11px] text-[#2563eb] font-semibold whitespace-nowrap">
                      + Add type
                    </button>
                  )}
                </div>

                {entry.inc && (
                  <div className="mt-2 flex flex-col gap-1.5">
                    {entry.lines.map(l => (
                      <div key={l.id} className="flex items-center gap-1.5 flex-wrap bg-[#f8f8f6] rounded-lg px-2 py-1.5">
                        {/* Combo box — pick a preset type or type a new one */}
                        <input list={s.typeOpts.length ? `types-${s.key}` : undefined}
                          value={l.type} placeholder={s.typeOpts.length ? 'Type… (or enter your own)' : 'Type / detail'}
                          onChange={e => setLine(s.key, l.id, { type: e.target.value })}
                          className="px-1.5 py-1 text-[11px] bg-white border border-black/20 rounded min-w-[130px] flex-1" />
                        {s.typeOpts.length > 0 && (
                          <datalist id={`types-${s.key}`}>
                            {s.typeOpts.map(t => <option key={t} value={t} />)}
                          </datalist>
                        )}
                        <input type="number" min={0} step="any" value={l.qty || ''} placeholder="0"
                          onChange={e => setLine(s.key, l.id, { qty: parseFloat(e.target.value) || 0 })}
                          className="w-16 px-1.5 py-1 text-right font-mono text-[11px] bg-white border border-black/20 rounded" />
                        <span className="text-[10px] text-[#999] w-9">{unitLabel(s.unit)}</span>
                        <input value={l.notes} placeholder="Notes…"
                          onChange={e => setLine(s.key, l.id, { notes: e.target.value })}
                          className="flex-1 min-w-[90px] px-1.5 py-1 text-[11px] bg-white border border-black/20 rounded" />
                        {entry.lines.length > 1 && (
                          <button onClick={() => delLine(s.key, l.id)} className="text-[#c0392b]"><Trash2 size={12} /></button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {entry.inc && showCoating && openCoat.has(s.key) && (() => {
                  const c = entry.coat ?? defaultCoat(s)
                  return (
                    <div className="mt-2 flex flex-wrap gap-2 bg-[#f9f8f5] border-t border-black/[0.06] px-2 py-2 rounded-lg">
                      {([
                        ['Application', c.app, APP_OPTS, (v: string) => setCoat(s.key, { app: v })],
                        ['Undercoat', c.uc, UC_OPTS, (v: string) => setCoat(s.key, { uc: v })],
                        ['UC Application', c.ucApp, APP_OPTS, (v: string) => setCoat(s.key, { ucApp: v })],
                        ['Finish', c.fin, FINISH_OPTS, (v: string) => setCoat(s.key, { fin: v })],
                        ['Colour change', c.colour, COLOUR_OPTS, (v: string) => setCoat(s.key, { colour: v })],
                      ] as [string, string, string[], (v: string) => void][]).map(([label, val, opts, set]) => (
                        <div key={label}>
                          <div className="text-[10px] text-[#666] mb-0.5">{label}</div>
                          <select value={val} onChange={e => set(e.target.value)}
                            className="text-[11px] px-1.5 py-1 border border-black/20 rounded bg-white focus:outline-none">
                            {opts.map(o => <option key={o}>{o}</option>)}
                          </select>
                        </div>
                      ))}
                      {([
                        ['UC coats', c.ucCoats, 0, 3, (n: number) => setCoat(s.key, { ucCoats: n })],
                        ['Top coats', c.topCoats, 1, 4, (n: number) => setCoat(s.key, { topCoats: n })],
                      ] as [string, number, number, number, (n: number) => void][]).map(([label, val, min, max, set]) => (
                        <div key={label}>
                          <div className="text-[10px] text-[#666] mb-0.5">{label}</div>
                          <input type="number" min={min} max={max} value={val}
                            onChange={e => set(Math.max(min, Math.min(max, parseInt(e.target.value) || min)))}
                            className="w-14 text-[11px] px-1.5 py-1 border border-black/20 rounded bg-white focus:outline-none" />
                        </div>
                      ))}
                    </div>
                  )
                })()}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
