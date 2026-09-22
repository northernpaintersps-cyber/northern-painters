import {
  SUBSTRATES, GROUPS, GROUP_HDR, GROUP_BG, unitLabel, subTotal, newSubLine,
  type SubEntry, type SubGroup,
} from '@/lib/substrates'
import { Trash2 } from 'lucide-react'

/**
 * The substrate checklist, shared by the site visit and the quote builder so
 * a visit's takeoff lands in the quote unchanged. Tick a substrate, then add
 * one line per type — the type field is a combo box: pick a preset or type
 * your own.
 */
export default function SubstratePicker({ value, onChange, groups = GROUPS }: {
  value: Record<string, SubEntry>
  onChange: (next: Record<string, SubEntry>) => void
  groups?: SubGroup[]
}) {
  const setEntry = (key: string, patch: Partial<SubEntry>) =>
    onChange({ ...value, [key]: { ...value[key], ...patch } })

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
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
