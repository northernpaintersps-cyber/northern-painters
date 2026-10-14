// Your own substrates, in Settings.
//
// Modelled on the paint products card next to it: a table of what you have
// added, and a row of fields to add another. Name, unit and group are all that
// is required — the two rates are optional, because on site you often know you
// need the line before you know what it costs.

import { useState } from 'react'
import { Plus, Trash2, AlertTriangle } from 'lucide-react'
import { GROUPS, unitLabel, type SubUnit, type SubGroup } from '@/lib/substrates'
import {
  keyFor, defaultArea, missingRates, type CustomSubstrate,
} from '@/lib/customSubstrates'

const UNITS: SubUnit[] = ['sqm', 'lm', 'qty']
const IN = 'bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder-gray-600'
const TH = 'text-left px-2 py-1.5 border-b border-black/[0.12] text-[#666] font-medium whitespace-nowrap text-xs'

const blank = (): Partial<CustomSubstrate> => ({ unit: 'sqm', group: 'Interior' })

export default function CustomSubstrates({ list, onChange }: {
  list: CustomSubstrate[]
  onChange: (next: CustomSubstrate[]) => void
}) {
  const [draft, setDraft] = useState<Partial<CustomSubstrate>>(blank())

  const set = (patch: Partial<CustomSubstrate>) => setDraft(d => ({ ...d, ...patch }))
  const num = (v: string) => (v.trim() === '' ? null : Number(v))

  function add() {
    const label = (draft.label ?? '').trim()
    if (!label) return
    onChange([...list, {
      key: keyFor(label, list.map(c => c.key)),
      label,
      unit: (draft.unit ?? 'sqm') as SubUnit,
      group: (draft.group ?? 'Interior') as SubGroup,
      paint: draft.paint ?? '',
      method: draft.method ?? '',
      finish: draft.finish ?? '',
      areaPerUnit: draft.areaPerUnit ?? null,
      hoursPerUnit: draft.hoursPerUnit ?? null,
      typeOpts: [],
    }])
    setDraft(blank())
  }

  const patch = (key: string, p: Partial<CustomSubstrate>) =>
    onChange(list.map(c => c.key === key ? { ...c, ...p } : c))

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">
        Added here, a substrate behaves exactly like a built-in one: it appears in the quote
        builder and the site visit under its group, carries into the quote, and the AI takeoff
        can return a quantity for it. Name, unit and group are all that is required.
      </p>

      {list.length > 0 && (
        <div className="overflow-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>{['Name', 'Unit', 'Group', 'Default product', 'm² per unit', 'Hrs per unit', ''].map(h => (
                <th key={h} className={TH}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {list.map(c => {
                const gaps = missingRates(c)
                return (
                  <tr key={c.key} className="border-b border-black/[0.06]">
                    <td className="px-2 py-1.5">
                      <input value={c.label} onChange={e => patch(c.key, { label: e.target.value })}
                        className={`${IN} w-full`} />
                      {gaps.length > 0 && (
                        <div className="flex items-center gap-1 text-[10px] text-amber-700 mt-0.5">
                          <AlertTriangle size={10} className="shrink-0" />
                          No {gaps.join(' or ')} figure — this substrate adds no {gaps.join(' and no ')} to an
                          estimate. Price it on the quote, or fill the number in.
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      <select value={c.unit} onChange={e => patch(c.key, { unit: e.target.value as SubUnit })}
                        className={IN}>
                        {UNITS.map(u => <option key={u} value={u}>{unitLabel(u)}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1.5">
                      <select value={c.group} onChange={e => patch(c.key, { group: e.target.value as SubGroup })}
                        className={IN}>
                        {GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1.5">
                      <input value={c.paint ?? ''} placeholder="Priced on the quote"
                        onChange={e => patch(c.key, { paint: e.target.value })} className={`${IN} w-full`} />
                    </td>
                    <td className="px-2 py-1.5">
                      <input type="number" step="0.01" min={0} value={c.areaPerUnit ?? ''}
                        placeholder={c.unit === 'sqm' ? '1' : '—'}
                        onChange={e => patch(c.key, { areaPerUnit: num(e.target.value) })}
                        className={`${IN} w-20`} />
                    </td>
                    <td className="px-2 py-1.5">
                      <input type="number" step="0.001" min={0} value={c.hoursPerUnit ?? ''} placeholder="—"
                        onChange={e => patch(c.key, { hoursPerUnit: num(e.target.value) })}
                        className={`${IN} w-20`} />
                    </td>
                    <td className="px-2 py-1.5">
                      <button onClick={() => onChange(list.filter(x => x.key !== c.key))}
                        title="Remove this substrate"
                        className="text-red-600 hover:text-red-700"><Trash2 size={14} /></button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Add a row */}
      <div className="flex gap-2 flex-wrap items-end border-t border-gray-200 pt-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Name</label>
          <input value={draft.label ?? ''} placeholder="e.g. Shade sail posts"
            onChange={e => set({ label: e.target.value })}
            onKeyDown={e => { if (e.key === 'Enter') add() }} className={`${IN} w-56`} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Unit</label>
          <select value={draft.unit} onChange={e => set({ unit: e.target.value as SubUnit })} className={IN}>
            {UNITS.map(u => <option key={u} value={u}>{unitLabel(u)}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Group</label>
          <select value={draft.group} onChange={e => set({ group: e.target.value as SubGroup })} className={IN}>
            {GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">m² per unit</label>
          <input type="number" step="0.01" min={0} value={draft.areaPerUnit ?? ''}
            placeholder={String(defaultArea((draft.unit ?? 'sqm') as SubUnit) || '—')}
            onChange={e => set({ areaPerUnit: num(e.target.value) })} className={`${IN} w-24`} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Hrs per unit</label>
          <input type="number" step="0.001" min={0} value={draft.hoursPerUnit ?? ''} placeholder="—"
            onChange={e => set({ hoursPerUnit: num(e.target.value) })} className={`${IN} w-24`} />
        </div>
        <button onClick={add} disabled={!(draft.label ?? '').trim()}
          className="flex items-center gap-1.5 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-semibold px-3 py-2 rounded-lg">
          <Plus size={14} /> Add
        </button>
      </div>
      <p className="text-[11px] text-gray-500">
        <b>m² per unit</b> is how much paint one unit needs — 1 for anything measured in m²,
        and for a counted thing the painted area of one of them, so a post measured per item
        might be 1.0 and a lineal metre of handrail about the same. <b>Hrs per unit</b> is how
        long one takes, including prep. Leave either blank and that part is simply not
        estimated. Remember to press Save.
      </p>
    </div>
  )
}
