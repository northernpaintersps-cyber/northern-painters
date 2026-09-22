import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Modal } from '@/components/ui/Modal'
import { fmtCurrency, fmtDate } from '@/lib/utils'
import {
  Loader2, Trash2, Eye, Pencil, Hammer, Lock, ArrowUpDown, X, FileText, Copy,
} from 'lucide-react'

type Row = Record<string, any>

const STATUS_BADGE: Record<string, string> = {
  Locked:    'bg-[#dcfce7] text-[#166534]',
  Draft:     'bg-[#fef3c7] text-[#92400e]',
  Converted: 'bg-[#dbeafe] text-[#1e40af]',
}
const BADGE = 'inline-block px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap'

function useQuotes() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['np_quotes', user?.id],
    queryFn: async () => {
      const { data, error } = await (supabase.from('np_quotes') as any)
        .select('*').eq('user_id', user!.id).order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as Row[]
    },
    enabled: !!user,
  })
}

function useDel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.from('np_quotes') as any).delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['np_quotes'] }),
  })
}

// Same renderer the builder uses, so a reviewed quote reads identically
function renderEstimate(src: string): string {
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const out: string[] = []
  let table: string[][] | null = null
  const flushTable = () => {
    if (!table || !table.length) { table = null; return }
    const [head, ...body] = table
    out.push('<table style="width:100%;border-collapse:collapse;font-size:12px;margin:6px 0">')
    out.push('<thead><tr>' + head.map(c => `<th style="text-align:left;padding:5px 7px;background:#fafaf8;border-bottom:1px solid rgba(0,0,0,.12);font-weight:600">${c}</th>`).join('') + '</tr></thead><tbody>')
    body.forEach(r => out.push('<tr>' + r.map(c => `<td style="padding:5px 7px;border-bottom:1px solid rgba(0,0,0,.06)">${c}</td>`).join('') + '</tr>'))
    out.push('</tbody></table>')
    table = null
  }
  for (const raw of esc(src).split('\n')) {
    const line = raw.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    if (/^\s*\|/.test(line)) {
      const cells = line.split('|').slice(1, -1).map(c => c.trim())
      if (cells.every(c => /^:?-{2,}:?$/.test(c))) continue
      ;(table ??= []).push(cells)
      continue
    }
    flushTable()
    const h = line.match(/^(#{1,4})\s+(.*)$/)
    if (h) { out.push(`<div style="font-weight:700;font-size:13px;margin:12px 0 4px">${h[2]}</div>`); continue }
    const li = line.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)$/)
    if (li) { out.push(`<div style="padding-left:14px;margin:2px 0">• ${li[1]}</div>`); continue }
    if (!line.trim()) { out.push('<div style="height:6px"></div>'); continue }
    out.push(`<div style="margin:2px 0">${line}</div>`)
  }
  flushTable()
  return out.join('')
}

export default function Quotes() {
  const nav = useNavigate()
  const { data: quotes = [], isLoading, error } = useQuotes()
  const del = useDel()

  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [asc, setAsc] = useState(false)
  const [viewing, setViewing] = useState<Row | null>(null)

  const rows = useMemo(() => {
    const s = q.toLowerCase()
    const list = quotes.filter(x => {
      if (status && (x.status || 'Draft') !== status) return false
      if (s && !`${x.client ?? ''}${x.address ?? ''}${x.job_type ?? ''}${x.quote_no ?? ''}`.toLowerCase().includes(s)) return false
      return true
    })
    return [...list].sort((a, b) => {
      const da = a.created_at || '', db = b.created_at || ''
      return asc ? (da < db ? -1 : 1) : (da > db ? -1 : 1)
    })
  }, [quotes, q, status, asc])

  const totLocked = quotes.filter(x => x.status === 'Locked').reduce((s, x) => s + (x.locked_price || 0), 0)
  const totConverted = quotes.filter(x => x.status === 'Converted').length

  // Reopen a saved quote in the builder, fully restored
  function reopen(quote: Row) {
    try {
      sessionStorage.setItem('np_reopen_quote', JSON.stringify({ ...quote.state, _quoteId: quote.id }))
    } catch {}
    nav('/quotes/build')
  }

  function duplicate(quote: Row) {
    try {
      const state = { ...quote.state }
      delete state._quoteId
      sessionStorage.setItem('np_reopen_quote', JSON.stringify({ ...state, client: `${quote.client} (copy)` }))
    } catch {}
    nav('/quotes/build')
  }

  if (isLoading) return (
    <div className="flex items-center justify-center h-64"><Loader2 size={20} className="animate-spin text-blue-600" /></div>
  )

  // The table is new, so surface the migration clearly rather than an empty page
  if (error) return (
    <div className="p-5">
      <h2 className="text-[17px] font-semibold text-gray-900 mb-4">Saved Quotes</h2>
      <div className="bg-white border border-[#fca5a5] rounded-xl p-4">
        <div className="text-[13px] font-bold text-[#c0392b] mb-2">The quotes table doesn't exist yet</div>
        <div className="text-xs text-[#666] mb-3">
          Run this once in Supabase → SQL Editor, then reload this page.
        </div>
        <pre className="text-[11px] bg-[#f5f4f0] rounded-lg p-3 overflow-auto whitespace-pre-wrap">{`create table if not exists np_quotes (
  id text primary key,
  user_id uuid references auth.users not null,
  quote_no text,
  client text,
  address text,
  job_type text,
  terms text,
  status text default 'Draft',
  locked_price numeric,
  quote_ex_gst numeric,
  labour_cost numeric,
  materials_cost numeric,
  consumables numeric,
  equipment numeric,
  total_hours numeric,
  est_days numeric,
  job_id text,
  estimate_text text,
  state jsonb,
  locked_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table np_quotes enable row level security;
create policy "Users own their quotes" on np_quotes for all using (auth.uid() = user_id);`}</pre>
      </div>
    </div>
  )

  return (
    <div className="p-5">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <h2 className="text-[17px] font-semibold text-gray-900">Saved Quotes</h2>
        <button onClick={() => nav('/quotes/build')}
          className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white font-medium text-[13px] px-3 py-1.5 rounded-lg">
          <FileText size={14} /> New Quote
        </button>
      </div>

      <div className="grid gap-2.5 mb-3.5" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))' }}>
        {[
          { l: 'Saved quotes', v: String(quotes.length), c: '#2563eb' },
          { l: 'Locked value (ex GST)', v: fmtCurrency(totLocked), c: '#16a34a' },
          { l: 'Converted to jobs', v: String(totConverted) },
        ].map(m => (
          <div key={m.l} className="bg-[#f5f4f0] rounded-lg px-4 py-3.5">
            <div className="text-[11px] text-[#666] mb-1">{m.l}</div>
            <div className="text-xl font-semibold" style={m.c ? { color: m.c } : undefined}>{m.v}</div>
          </div>
        ))}
      </div>

      <div className="flex gap-2 mb-3 flex-wrap items-center">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search client, address, quote no…"
          className="w-[240px] px-2.5 py-1.5 text-[12.5px] bg-white border border-black/20 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500" />
        <select value={status} onChange={e => setStatus(e.target.value)}
          className="px-2.5 py-1.5 text-[12.5px] bg-white border border-black/20 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500">
          <option value="">All statuses</option>
          {['Draft', 'Locked', 'Converted'].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <button onClick={() => setAsc(a => !a)}
          className="flex items-center gap-1 px-2.5 py-1.5 text-[12.5px] bg-white border border-black/20 rounded-lg hover:bg-[#f5f4f0]">
          <ArrowUpDown size={13} /> {asc ? 'Oldest first' : 'Newest first'}
        </button>
        {(q || status) && (
          <button onClick={() => { setQ(''); setStatus('') }}
            className="flex items-center gap-1 px-2.5 py-1.5 text-[12.5px] bg-white border border-black/20 rounded-lg hover:bg-[#f5f4f0] text-[#c0392b]">
            <X size={13} /> Clear
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="bg-white border border-black/[0.12] rounded-xl text-center py-10 text-[#666]">
          <Lock size={32} className="mx-auto mb-2.5 opacity-30" />
          <div className="text-sm font-semibold mb-1">No saved quotes yet</div>
          <div className="text-xs">Build a quote, set the locked price, then Lock &amp; Save to keep it here permanently.</div>
        </div>
      ) : (
        <div className="bg-white border border-black/[0.12] rounded-xl overflow-hidden">
          <div className="overflow-auto max-h-[70vh]">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr>
                  {['Date','Client','Address','Job type','Calculated','Locked price','Status','Job',''].map((h, i) => (
                    <th key={i} className="text-left px-2.5 py-[7px] border-b border-black/[0.12] text-[#666] font-medium whitespace-nowrap bg-[#fafaf8] sticky top-0 z-[2]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(x => (
                  <tr key={x.id} className="border-b border-black/[0.06] hover:bg-[#fafaf8]">
                    <td className="px-2.5 py-[7px] whitespace-nowrap">{fmtDate(x.created_at)}</td>
                    <td className="px-2.5 py-[7px] font-medium">{x.client || '—'}</td>
                    <td className="px-2.5 py-[7px] text-xs text-[#666] max-w-[180px] truncate">{x.address || ''}</td>
                    <td className="px-2.5 py-[7px] text-xs">{x.job_type || ''}</td>
                    <td className="px-2.5 py-[7px]">{fmtCurrency(x.quote_ex_gst)}</td>
                    <td className="px-2.5 py-[7px] font-semibold" style={{ color: x.locked_price ? '#16a34a' : undefined }}>
                      {x.locked_price ? fmtCurrency(x.locked_price) : '—'}
                    </td>
                    <td className="px-2.5 py-[7px]">
                      <span className={`${BADGE} ${STATUS_BADGE[x.status] || STATUS_BADGE.Draft}`}>{x.status || 'Draft'}</span>
                    </td>
                    <td className="px-2.5 py-[7px] text-[#2563eb] font-medium text-xs">{x.job_id || '—'}</td>
                    <td className="px-2.5 py-[7px] whitespace-nowrap">
                      <button onClick={() => setViewing(x)} title="Review"
                        className="ml-1 px-1.5 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700 align-middle"><Eye size={12} /></button>
                      <button onClick={() => reopen(x)} title="Reopen in builder"
                        className="ml-1 px-1.5 py-1 rounded-md bg-white border border-black/20 hover:bg-[#f5f4f0] align-middle"><Pencil size={12} /></button>
                      <button onClick={() => duplicate(x)} title="Duplicate as a new quote"
                        className="ml-1 px-1.5 py-1 rounded-md bg-white border border-black/20 hover:bg-[#f5f4f0] align-middle"><Copy size={12} /></button>
                      <button onClick={() => { if (confirm(`Delete the quote for ${x.client}? This cannot be undone.`)) del.mutate(x.id) }}
                        title="Delete"
                        className="ml-1 px-1.5 py-1 rounded-md bg-white border border-black/20 hover:bg-[#f5f4f0] align-middle text-[#c0392b]"><Trash2 size={12} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal open={!!viewing} onClose={() => setViewing(null)} size="xl"
        title={viewing ? `Quote — ${viewing.client}` : ''}>
        {viewing && (
          <>
            <div className="grid gap-2 mb-3.5" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))' }}>
              {([
                ['Calculated', fmtCurrency(viewing.quote_ex_gst)],
                ['Locked', viewing.locked_price ? fmtCurrency(viewing.locked_price) : '—'],
                ['Labour', fmtCurrency(viewing.labour_cost)],
                ['Materials', fmtCurrency(viewing.materials_cost)],
                ['Consumables', fmtCurrency(viewing.consumables)],
                ['Hours', viewing.total_hours ? Number(viewing.total_hours).toFixed(1) : '—'],
                ['Days', viewing.est_days ? Number(viewing.est_days).toFixed(1) : '—'],
              ] as [string, string][]).map(([l, v]) => (
                <div key={l} className="bg-[#f5f4f0] rounded-lg px-3 py-2">
                  <div className="text-[10px] text-[#666] uppercase font-semibold mb-0.5">{l}</div>
                  <div className="text-[13px] font-bold">{v}</div>
                </div>
              ))}
            </div>

            <div className="text-[11px] text-[#666] mb-3">
              {viewing.job_type} · {viewing.terms} · saved {fmtDate(viewing.created_at)}
              {viewing.locked_at && ` · locked ${fmtDate(viewing.locked_at)}`}
              {viewing.address && <> · {viewing.address}</>}
            </div>

            {viewing.estimate_text ? (
              <div className="text-[13px] leading-relaxed border-t border-black/10 pt-3"
                dangerouslySetInnerHTML={{ __html: renderEstimate(viewing.estimate_text) }} />
            ) : (
              <div className="text-xs text-[#666] border-t border-black/10 pt-3">
                No AI estimate was generated for this quote — the figures above come from the builder.
              </div>
            )}

            <div className="flex justify-end gap-2 mt-4 pt-4 border-t border-black/10">
              <button onClick={() => { const v = viewing; setViewing(null); duplicate(v) }} className="px-4 py-2 text-[13px] rounded-lg bg-white border border-black/20 hover:bg-[#f5f4f0] flex items-center gap-1.5">
                <Copy size={13} /> Duplicate
              </button>
              <button onClick={() => { const v = viewing; setViewing(null); reopen(v) }}
                className="px-5 py-2 text-[13px] rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold flex items-center gap-1.5">
                <Pencil size={13} /> Reopen in builder
              </button>
              {!viewing.job_id && (
                <button onClick={() => { const v = viewing; setViewing(null); reopen(v) }}
                  className="px-4 py-2 text-[13px] rounded-lg bg-white border border-black/20 hover:bg-[#f5f4f0] flex items-center gap-1.5">
                  <Hammer size={13} /> Convert to job
                </button>
              )}
            </div>
          </>
        )}
      </Modal>
    </div>
  )
}
