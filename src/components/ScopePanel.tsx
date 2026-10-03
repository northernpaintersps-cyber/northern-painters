// The painting scope, shown rather than tallied.
//
// Every line of work with the arithmetic behind it, the sheets it came from,
// the coating it will get and anything the checks flagged — so the scope can
// be read and corrected before it becomes a price.

import { useState } from 'react'
import { Camera, Check, FileText, Trash2, AlertTriangle, Plus } from 'lucide-react'
import { GROUP_HDR, type SubGroup } from '@/lib/substrates'
import {
  groupScope, scopeStats, type ScopeItem, type ScopePhoto,
} from '@/lib/scopeModel'
import type { SheetIndexEntry } from '@/lib/ai'

const CONF_STYLE: Record<string, { bg: string; fg: string }> = {
  high: { bg: '#dcfce7', fg: '#166534' },
  medium: { bg: '#fef3c7', fg: '#92400e' },
  low: { bg: '#fee2e2', fg: '#991b1b' },
}

export interface ScopePanelProps {
  items: ScopeItem[]
  photos: ScopePhoto[]
  sheetIndex?: SheetIndexEntry[]
  scopeNotes?: string
  /** Change a line's quantity. */
  onQty: (key: string, lineId: string, qty: number) => void
  /** Untick the whole substrate — `inc` lives on the entry, not the line. */
  onExclude: (key: string) => void
  /** Delete one line of a split substrate. */
  onDeleteLine: (key: string, lineId: string) => void
  /** Scroll the substrate list to this row and flash it. */
  onReveal: (key: string) => void
  onTogglePhoto: (itemId: string, photoId: string) => void
  onAddPhotos: (files: FileList | null) => void
}

export default function ScopePanel(p: ScopePanelProps) {
  const [picker, setPicker] = useState<string | null>(null)
  const [viewing, setViewing] = useState<ScopePhoto | null>(null)
  const stats = scopeStats(p.items)
  const blocks = groupScope(p.items)
  const photoById = new Map(p.photos.map(ph => [ph.id, ph]))
  const sheetByNo = new Map((p.sheetIndex ?? []).map(e => [e.sheetNo, e]))

  if (!p.items.length) {
    return (
      <div className="bg-white border border-black/[0.12] rounded-xl px-4 py-12 text-center text-[#666]">
        <FileText size={34} className="mx-auto mb-3 opacity-25" />
        <div className="text-[13px]">No scope yet.</div>
        <div className="text-[11px] mt-1">
          Extract quantities from drawings, use the room calculator, or tick substrates.
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white border border-black/[0.12] rounded-xl overflow-hidden">
      {/* Summary */}
      <div className="flex items-center gap-2 flex-wrap px-3.5 py-2.5 bg-[#f0fdf4] border-b border-[#86efac]">
        <strong className="text-[13px] text-[#166534]">
          {stats.items} line{stats.items === 1 ? '' : 's'}
        </strong>
        {stats.sqm > 0 && <span className="text-[11px] text-[#666]">{stats.sqm} m²</span>}
        {stats.lm > 0 && <span className="text-[11px] text-[#666]">· {stats.lm} lm</span>}
        {stats.count > 0 && <span className="text-[11px] text-[#666]">· {stats.count} items</span>}
        <span className="flex-1" />
        {stats.errors > 0 && (
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#fee2e2] text-[#991b1b]">
            {stats.errors} to check
          </span>
        )}
        {stats.drifted > 0 && (
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#fef3c7] text-[#92400e]">
            {stats.drifted} edited
          </span>
        )}
        <label className="flex items-center gap-1 px-2 py-1 text-[11px] bg-white border border-black/20 rounded-lg hover:bg-[#f5f4f0] cursor-pointer">
          <Camera size={11} /> Photos
          <input type="file" accept="image/*" multiple className="hidden"
            onChange={e => { p.onAddPhotos(e.target.files); e.target.value = '' }} />
        </label>
      </div>

      <div className="max-h-[72vh] overflow-y-auto">
        {blocks.map(block => (
          <div key={block.group}>
            <div className="px-3.5 py-1 text-[10px] font-bold uppercase tracking-wide text-[#555]"
              style={{ background: GROUP_HDR[block.group as SubGroup] }}>
              {block.group}
            </div>
            {block.items.map(item => {
              const err = item.warnings.some(w => w.level === 'error')
              const warn = !err && item.warnings.length > 0
              return (
                <div key={item.id}
                  className="px-3.5 py-2 border-b border-black/[0.06]"
                  style={{
                    borderLeft: `3px solid ${err ? '#dc2626' : warn ? '#f59e0b' : 'transparent'}`,
                    background: err ? '#fef2f2' : warn ? '#fffbeb' : undefined,
                  }}>

                  {/* Title, quantity */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <button onClick={() => p.onReveal(item.key)}
                      title="Show this in the substrate list"
                      className="text-[13px] font-semibold text-left flex-1 min-w-[120px] hover:text-[#2563eb]">
                      {item.title}
                    </button>
                    <input type="number" min={0} step="any" value={item.qty || ''}
                      onChange={e => p.onQty(item.key, item.lineId, parseFloat(e.target.value) || 0)}
                      className="w-20 px-1.5 py-0.5 text-right font-mono text-[12px] bg-white border border-black/20 rounded" />
                    <span className="text-[10px] text-[#666] w-10">{item.unitText}</span>
                    {item.evidence && (
                      <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full shrink-0"
                        style={{
                          background: CONF_STYLE[item.evidence.confidence]?.bg,
                          color: CONF_STYLE[item.evidence.confidence]?.fg,
                        }}>
                        {item.evidence.confidence}
                      </span>
                    )}
                  </div>

                  {/* Coating */}
                  <div className="text-[11px] text-[#444] mt-0.5">{item.coatText}</div>

                  {/* Where the number came from */}
                  {item.evidence?.basis && (
                    <div className="text-[10px] text-[#666] mt-0.5 break-words">{item.evidence.basis}</div>
                  )}
                  {item.partOf && (
                    <div className="text-[10px] text-[#999] mt-0.5">part of the {item.partOf} takeoff</div>
                  )}
                  {item.evidence?.drifted && (
                    <div className="text-[10px] text-[#92400e] mt-0.5">
                      AI measured {item.evidence.takeoffQty} {item.unitText} — edited since
                    </div>
                  )}
                  {!!item.evidence?.sheets.length && (
                    <div className="flex gap-1 flex-wrap mt-1">
                      {item.evidence.sheets.map(no => {
                        const sheet = sheetByNo.get(no)
                        return (
                          <span key={no}
                            title={sheet ? `p${sheet.page} · ${sheet.title}` : 'Sheet not in the index'}
                            className="text-[9px] px-1.5 py-0.5 rounded bg-[#e0e7ff] text-[#3730a3] font-mono">
                            {no}
                          </span>
                        )
                      })}
                    </div>
                  )}
                  {item.notes && (
                    <div className="text-[11px] text-[#555] mt-1 italic">“{item.notes}”</div>
                  )}
                  {item.warnings.map((w, i) => (
                    <div key={i} className="flex items-start gap-1 text-[10px] mt-1"
                      style={{ color: w.level === 'error' ? '#991b1b' : '#92400e' }}>
                      <AlertTriangle size={11} className="shrink-0 mt-px" /> {w.text}
                    </div>
                  ))}

                  {/* Photos */}
                  <div className="flex gap-1.5 items-center mt-1.5 flex-wrap">
                    {item.photoIds.map(id => {
                      const ph = photoById.get(id)
                      if (!ph) return null
                      return (
                        <button key={id} onClick={() => setViewing(ph)}
                          className="w-12 h-12 rounded border border-black/15 overflow-hidden shrink-0">
                          <img src={ph.data} alt={ph.label || ''} className="w-full h-full object-cover" />
                        </button>
                      )
                    })}
                    {/* A full 48px dashed box on every photo-less line is most
                        of the panel's height, so it only takes that shape once
                        there is something beside it. */}
                    {p.photos.length > 0 && (item.photoIds.length > 0 ? (
                      <button onClick={() => setPicker(picker === item.id ? null : item.id)}
                        className="w-12 h-12 rounded border border-dashed border-black/25 text-[#999] flex items-center justify-center shrink-0 hover:bg-[#f5f4f0]">
                        <Plus size={14} />
                      </button>
                    ) : (
                      <button onClick={() => setPicker(picker === item.id ? null : item.id)}
                        className="flex items-center gap-1 text-[10px] text-[#2563eb] hover:underline">
                        <Plus size={10} /> photo
                      </button>
                    ))}
                    <span className="flex-1" />
                    <button onClick={() => p.onDeleteLine(item.key, item.lineId)}
                      title="Remove this line" className="text-[#c0392b] opacity-50 hover:opacity-100">
                      <Trash2 size={12} />
                    </button>
                    <button onClick={() => p.onExclude(item.key)}
                      title="Take this substrate out of the quote"
                      className="text-[10px] text-[#666] hover:text-[#c0392b]">
                      exclude
                    </button>
                  </div>

                  {/* Which photo belongs to this line */}
                  {picker === item.id && (
                    <div className="mt-2 p-2 bg-[#f8f8f6] rounded-lg">
                      <div className="text-[10px] text-[#666] mb-1.5">
                        Tap the photos that show this surface
                      </div>
                      <div className="flex gap-1.5 flex-wrap">
                        {p.photos.map(ph => {
                          const on = item.photoIds.includes(ph.id)
                          return (
                            <button key={ph.id} onClick={() => p.onTogglePhoto(item.id, ph.id)}
                              className="relative w-14 h-14 rounded overflow-hidden shrink-0"
                              style={{ border: `2px solid ${on ? '#16a34a' : 'rgba(0,0,0,.15)'}` }}>
                              <img src={ph.data} alt={ph.label || ''} className="w-full h-full object-cover" />
                              {on && (
                                <span className="absolute inset-0 bg-[#16a34a]/25 flex items-center justify-center">
                                  <Check size={16} className="text-white" />
                                </span>
                              )}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>

      {/* Photos nobody has placed yet */}
      {p.photos.some(ph => !p.items.some(i => i.photoIds.includes(ph.id))) && (
        <div className="px-3.5 py-2 border-t border-black/[0.08] bg-[#fafaf8]">
          <div className="text-[10px] text-[#666] mb-1.5">Not yet attached to a surface</div>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {p.photos.filter(ph => !p.items.some(i => i.photoIds.includes(ph.id))).map(ph => (
              <button key={ph.id} onClick={() => setViewing(ph)}
                className="w-12 h-12 rounded border border-black/15 overflow-hidden shrink-0">
                <img src={ph.data} alt={ph.label || ''} className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        </div>
      )}

      {p.scopeNotes && (
        <div className="px-3.5 py-2 border-t border-black/[0.08] text-[11px] text-[#92400e] bg-[#fffbeb]">
          <strong>From the drawings:</strong> {p.scopeNotes}
        </div>
      )}

      {viewing && (
        <div onClick={() => setViewing(null)}
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="max-w-full max-h-full">
            <img src={viewing.data} alt={viewing.label || ''} className="max-w-full max-h-[85vh] object-contain" />
            {viewing.label && (
              <div className="text-white text-[12px] text-center mt-2">{viewing.label}</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
