import { useState, useMemo, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { fmtCurrency, genId, today } from '@/lib/utils'
import { generateQuoteScope } from '@/lib/ai'
import { Plus, Loader2, Trash2, ChevronDown, ChevronUp, Printer, Sparkles, AlertCircle } from 'lucide-react'
import { useBusinessSettings } from '@/pages/SettingsPage'

// ── Constants ─────────────────────────────────────────────────
const SURFACE_TYPES = ['Walls','Ceiling','Trim/Cornice','Doors','Windows','Facade/Exterior','Deck/Timber','Fence','Other']

// sqm per hour by surface + prep level
const LABOUR_RATE_SQM: Record<string, Record<string, number>> = {
  'Walls':           { minimal: 14, moderate: 10, heavy: 7  },
  'Ceiling':         { minimal: 12, moderate: 9,  heavy: 6  },
  'Trim/Cornice':    { minimal: 8,  moderate: 6,  heavy: 4  },
  'Doors':           { minimal: 1.5,moderate: 1,  heavy: 0.5 },
  'Windows':         { minimal: 1,  moderate: 0.8,heavy: 0.5 },
  'Facade/Exterior': { minimal: 12, moderate: 9,  heavy: 6  },
  'Deck/Timber':     { minimal: 10, moderate: 7,  heavy: 5  },
  'Fence':           { minimal: 12, moderate: 9,  heavy: 6  },
  'Other':           { minimal: 10, moderate: 7,  heavy: 5  },
}

// litres per sqm per coat by surface
const COVERAGE: Record<string, number> = {
  'Walls': 10, 'Ceiling': 10, 'Trim/Cornice': 12, 'Doors': 12,
  'Windows': 14, 'Facade/Exterior': 8, 'Deck/Timber': 7, 'Fence': 8, 'Other': 10,
}

const PREP_LEVELS = ['minimal','moderate','heavy']

interface QuoteItem {
  id: string
  area_name: string
  surface_type: string
  length: number
  height: number
  quantity: number
  coats: number
  prep_level: string
  labour_rate: number          // $/hr
  paint_cost_per_litre: number
  markup_pct: number
  notes: string
}

function defaultItem(): QuoteItem {
  return {
    id: genId('qi'),
    area_name: '',
    surface_type: 'Walls',
    length: 0,
    height: 0,
    quantity: 1,
    coats: 2,
    prep_level: 'moderate',
    labour_rate: 65,
    paint_cost_per_litre: 8,
    markup_pct: 20,
    notes: '',
  }
}

function calcItem(item: QuoteItem) {
  const sqm = item.length * item.height * item.quantity
  const paintLitres  = (sqm * item.coats) / (COVERAGE[item.surface_type] ?? 10)
  const paintCost    = paintLitres * item.paint_cost_per_litre
  const ratePerSqm   = LABOUR_RATE_SQM[item.surface_type]?.[item.prep_level] ?? 10
  const labourHours  = sqm / ratePerSqm
  const labourCost   = labourHours * item.labour_rate
  const baseCost     = paintCost + labourCost
  const total        = baseCost * (1 + item.markup_pct / 100)
  return { sqm, paintLitres, paintCost, labourHours, labourCost, baseCost, total }
}

// ── Hooks ─────────────────────────────────────────────────────
function useJobs() {
  const { user } = useAuth()
  return useQuery<any[]>({
    queryKey: ['np_jobs_qt', user?.id],
    queryFn: async () => {
      const { data } = await supabase.from('np_jobs').select('id,client,address,quote_no,agreed_ex_gst,labour_rate,extra').eq('user_id', user!.id).order('created_at', { ascending: false })
      return data ?? []
    },
    enabled: !!user,
  })
}

function useSaveQuote() {
  const qc = useQueryClient()
  const { user } = useAuth()
  return useMutation({
    mutationFn: async ({ jobId, items, settings }: { jobId: string; items: QuoteItem[]; settings: any }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = supabase as any
      const { error } = await db.from('np_jobs')
        .update({ extra: { quote_items: items, quote_settings: settings }, updated_at: new Date().toISOString() })
        .eq('id', jobId)
        .eq('user_id', user!.id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['np_jobs_qt'] }),
  })
}

// ── Item row ──────────────────────────────────────────────────
function ItemRow({ item, onChange, onDelete }: {
  item: QuoteItem
  onChange: (updated: QuoteItem) => void
  onDelete: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const calc = calcItem(item)

  function set(k: keyof QuoteItem, v: any) { onChange({ ...item, [k]: v }) }
  const n = (k: keyof QuoteItem) => (e: React.ChangeEvent<HTMLInputElement>) => set(k, parseFloat(e.target.value) || 0)
  const s = (k: keyof QuoteItem) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => set(k, e.target.value)

  const INP = 'bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-yellow-400'
  const SEL = `${INP} cursor-pointer`

  return (
    <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
      {/* Summary row */}
      <div className="flex items-center gap-3 p-3 cursor-pointer" onClick={() => setExpanded(v => !v)}>
        <div className="flex-1 min-w-0 grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1">
          <div>
            <p className="text-xs text-gray-500">Area / room</p>
            <p className="text-sm font-medium text-white truncate">{item.area_name || 'Unnamed'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Surface</p>
            <p className="text-sm text-gray-300">{item.surface_type}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Sqm · {item.coats} coats</p>
            <p className="text-sm text-gray-300">{calc.sqm.toFixed(1)} m²</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Item total</p>
            <p className="text-sm font-bold text-yellow-400">{fmtCurrency(calc.total)}</p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={e => { e.stopPropagation(); onDelete() }} className="text-gray-600 hover:text-red-400 p-1"><Trash2 size={13} /></button>
          {expanded ? <ChevronUp size={14} className="text-gray-500" /> : <ChevronDown size={14} className="text-gray-500" />}
        </div>
      </div>

      {/* Detail panel */}
      {expanded && (
        <div className="border-t border-gray-700 p-4 space-y-4 bg-gray-850">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="md:col-span-2 flex flex-col gap-1">
              <label className="text-xs text-gray-400">Area / room name</label>
              <input value={item.area_name} onChange={s('area_name')} placeholder="e.g. Living room walls" className={`${INP} w-full`} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-400">Surface type</label>
              <select value={item.surface_type} onChange={s('surface_type') as any} className={`${SEL} w-full`}>
                {SURFACE_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-400">Prep level</label>
              <select value={item.prep_level} onChange={s('prep_level') as any} className={`${SEL} w-full`}>
                {PREP_LEVELS.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-400">Length (m)</label>
              <input type="number" value={item.length || ''} onChange={n('length')} min={0} step={0.1} className={`${INP} w-full`} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-400">Height (m)</label>
              <input type="number" value={item.height || ''} onChange={n('height')} min={0} step={0.1} className={`${INP} w-full`} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-400">Qty (walls)</label>
              <input type="number" value={item.quantity || ''} onChange={n('quantity')} min={1} step={1} className={`${INP} w-full`} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-400">Coats</label>
              <input type="number" value={item.coats || ''} onChange={n('coats')} min={1} max={4} step={1} className={`${INP} w-full`} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-400">Labour $/hr</label>
              <input type="number" value={item.labour_rate || ''} onChange={n('labour_rate')} min={0} className={`${INP} w-full`} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-400">Paint $/L</label>
              <input type="number" value={item.paint_cost_per_litre || ''} onChange={n('paint_cost_per_litre')} min={0} step={0.5} className={`${INP} w-full`} />
            </div>
          </div>

          <div className="flex items-center gap-6">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-400">Markup %</label>
              <input type="number" value={item.markup_pct || ''} onChange={n('markup_pct')} min={0} max={100} className={`${INP} w-24`} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-400">Notes</label>
              <input value={item.notes} onChange={s('notes')} className={`${INP} w-64`} placeholder="e.g. include feature wall" />
            </div>
          </div>

          {/* Calc breakdown */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 bg-gray-900 rounded-lg p-3">
            {[
              ['Area', `${calc.sqm.toFixed(1)} m²`],
              ['Paint needed', `${calc.paintLitres.toFixed(1)} L`],
              ['Paint cost', fmtCurrency(calc.paintCost)],
              ['Labour hours', `${calc.labourHours.toFixed(1)} h`],
              ['Labour cost', fmtCurrency(calc.labourCost)],
              ['Base cost', fmtCurrency(calc.baseCost)],
              [`Markup ${item.markup_pct}%`, fmtCurrency(calc.total - calc.baseCost)],
              ['Item total (ex GST)', fmtCurrency(calc.total)],
            ].map(([label, value]) => (
              <div key={String(label)}>
                <p className="text-xs text-gray-500">{label}</p>
                <p className={`text-sm font-semibold ${label === 'Item total (ex GST)' ? 'text-yellow-400' : 'text-white'}`}>{value}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Print quote HTML ──────────────────────────────────────────
function buildQuoteHTML(job: any, items: QuoteItem[], settings: any) {
  const totalExGST = items.reduce((s, it) => s + calcItem(it).total, 0)
  const gst = totalExGST * 0.1
  const totalIncGST = totalExGST + gst
  const rows = items.map(it => {
    const c = calcItem(it)
    return `<tr>
      <td>${it.area_name || it.surface_type}</td>
      <td>${it.surface_type}</td>
      <td>${c.sqm.toFixed(1)} m²</td>
      <td>${it.coats} coats</td>
      <td style="text-align:right">${fmtCurrency(c.total)}</td>
    </tr>`
  }).join('')

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
  <title>Quote ${job.quote_no || job.id}</title>
  <style>
    body{font-family:Arial,sans-serif;color:#111;max-width:800px;margin:40px auto;padding:0 24px;font-size:13px}
    h1{font-size:22px;margin:0} .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:32px}
    .logo{font-size:18px;font-weight:700;color:#f59e0b} .meta{color:#555;font-size:12px;line-height:1.8}
    table{width:100%;border-collapse:collapse;margin:16px 0}
    th{background:#f3f4f6;text-align:left;padding:8px 10px;font-size:11px;text-transform:uppercase;letter-spacing:.05em}
    td{padding:8px 10px;border-bottom:1px solid #e5e7eb}
    .totals td{border:none;padding:6px 10px} .totals .label{color:#555} .grand{font-weight:700;font-size:15px}
    .note{margin-top:32px;padding:16px;background:#fffbeb;border:1px solid #fcd34d;border-radius:6px;font-size:12px}
    .footer{margin-top:40px;font-size:11px;color:#999;border-top:1px solid #e5e7eb;padding-top:16px}
    @media print{body{margin:0}}
  </style></head><body>
  <div class="header">
    <div>
      <div class="logo">${(settings as any).company_name || 'Northern Painters'}</div>
      <div class="meta">
        ABN: ${settings.abn || '—'}<br>
        ${settings.address || ''}<br>
        ${settings.phone || ''} · ${settings.email || ''}
      </div>
    </div>
    <div style="text-align:right">
      <h1>QUOTE</h1>
      <div class="meta">
        Quote No: <strong>${job.quote_no || job.id}</strong><br>
        Date: ${today()}<br>
        Valid for: ${settings.valid_days || 30} days
      </div>
    </div>
  </div>

  <div style="margin-bottom:24px">
    <strong>${job.client || ''}</strong><br>
    <span style="color:#555">${job.address || ''}</span>
  </div>

  <table>
    <thead><tr><th>Area / Room</th><th>Surface</th><th>Area</th><th>Coats</th><th style="text-align:right">Price (ex GST)</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <table class="totals">
    <tr><td class="label">Subtotal (ex GST)</td><td style="text-align:right">${fmtCurrency(totalExGST)}</td></tr>
    <tr><td class="label">GST (10%)</td><td style="text-align:right">${fmtCurrency(gst)}</td></tr>
    <tr class="grand"><td>TOTAL (inc GST)</td><td style="text-align:right">${fmtCurrency(totalIncGST)}</td></tr>
  </table>

  ${settings.notes ? `<div class="note"><strong>Notes:</strong><br>${settings.notes.replace(/\n/g,'<br>')}</div>` : ''}
  ${settings.payment_terms ? `<div class="note" style="margin-top:12px"><strong>Payment terms:</strong><br>${settings.payment_terms.replace(/\n/g,'<br>')}</div>` : ''}

  <div class="footer">
    This quote is valid for ${settings.valid_days || 30} days from the date above. Prices are in Australian dollars.<br>
    All work carried out by licensed, insured painters. ${(settings as any).company_name || 'Northern Painters'} — ${settings.phone || ''} — ${settings.email || ''}
  </div>
  </body></html>`
}

// ── Main page ─────────────────────────────────────────────────
export default function QuotingTool() {
  const { data: jobs = [], isLoading } = useJobs()
  const saveQuote = useSaveQuote()
  const { data: bizSettings } = useBusinessSettings()

  const [selJobId, setSelJobId] = useState<string>('')
  const [items, setItems] = useState<QuoteItem[]>([])
  const [settings, setSettings] = useState({
    abn: '', address: '', phone: '', email: '',
    valid_days: 30,
    notes: 'All surfaces to be cleaned and prepared before painting.\nAll furniture and floor coverings to be protected during works.',
    payment_terms: '50% deposit on commencement, balance on completion.',
  })

  // Pre-fill from business settings once loaded
  useEffect(() => {
    if (bizSettings) {
      setSettings(s => ({
        ...s,
        abn: s.abn || bizSettings.abn || '',
        address: s.address || bizSettings.address || '',
        phone: s.phone || bizSettings.phone || '',
        email: s.email || bizSettings.email || '',
        valid_days: bizSettings.quote_valid_days || s.valid_days,
        notes: bizSettings.quote_footer || s.notes,
      }))
    }
  }, [bizSettings])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [aiWriting, setAiWriting] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)

  const selJob = jobs.find(j => j.id === selJobId)

  function loadJob(jobId: string) {
    setSelJobId(jobId)
    const job = jobs.find(j => j.id === jobId)
    if (!job) return
    const extra = (job.extra as any) ?? {}
    if (extra.quote_items?.length) {
      setItems(extra.quote_items)
    } else {
      setItems([defaultItem()])
    }
    if (extra.quote_settings) setSettings(s => ({ ...s, ...extra.quote_settings }))
  }

  function addItem() {
    setItems(prev => [...prev, {
      ...defaultItem(),
      labour_rate: bizSettings?.default_labour_rate ?? 65,
      markup_pct: bizSettings?.default_markup_pct ?? 20,
    }])
  }

  function updateItem(id: string, updated: QuoteItem) {
    setItems(prev => prev.map(it => it.id === id ? updated : it))
  }

  function removeItem(id: string) {
    setItems(prev => prev.filter(it => it.id !== id))
  }

  async function handleSave() {
    if (!selJobId) return
    setSaving(true)
    try {
      await saveQuote.mutateAsync({ jobId: selJobId, items, settings })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } finally { setSaving(false) }
  }

  async function handleAiScope() {
    const apiKey = bizSettings?.ai_api_key?.trim()
    if (!apiKey) {
      setAiError('No AI API key set. Add your Anthropic API key in Settings.')
      return
    }
    setAiWriting(true)
    setAiError(null)
    try {
      const scope = await generateQuoteScope(apiKey, {
        client: selJob?.client ?? '',
        address: selJob?.address ?? '',
        jobType: selJob?.type ?? '',
        items: items.map(it => {
          const c = calcItem(it)
          return { area_name: it.area_name, surface_type: it.surface_type, sqm: c.sqm, coats: it.coats, prep_level: it.prep_level, notes: it.notes }
        }),
        totalExGST: totals.exGST,
      })
      setSettings(s => ({ ...s, notes: scope }))
      setSettingsOpen(true)
    } catch (err: any) {
      setAiError(err?.message || 'AI failed. Check your API key.')
    } finally {
      setAiWriting(false)
    }
  }

  function printQuote() {
    if (!selJob) return
    const html = buildQuoteHTML(selJob, items, { ...settings, company_name: bizSettings?.company_name })
    const w = window.open('', '_blank')
    if (!w) return
    w.document.write(html)
    w.document.close()
    w.focus()
    setTimeout(() => w.print(), 400)
  }

  const totals = useMemo(() => {
    const exGST = items.reduce((s, it) => s + calcItem(it).total, 0)
    return { exGST, gst: exGST * 0.1, incGST: exGST * 1.1 }
  }, [items])

  const se = (k: string) => (e: React.ChangeEvent<any>) => setSettings(p => ({ ...p, [k]: e.target.value }))
  const INP = 'w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-yellow-400'

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold text-white">Quote Builder</h1>
          <p className="text-xs text-gray-500 mt-0.5">Measurement-based quote calculator</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setSettingsOpen(v => !v)}
            className="text-xs px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-400 hover:text-white transition-colors">
            Quote settings
          </button>
          {selJob && (
            <>
              <button onClick={handleAiScope} disabled={aiWriting || items.length === 0}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-purple-500/20 border border-purple-500/40 text-purple-300 hover:bg-purple-500/30 disabled:opacity-40 transition-colors">
                {aiWriting ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                {aiWriting ? 'Writing…' : 'AI scope'}
              </button>
              <button onClick={printQuote}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-300 hover:text-white transition-colors">
                <Printer size={13} /> Print / PDF
              </button>
              <button onClick={handleSave} disabled={saving}
                className="flex items-center gap-1.5 text-sm px-4 py-1.5 rounded-lg bg-yellow-400 hover:bg-yellow-300 text-gray-900 font-semibold disabled:opacity-50 transition-colors">
                {saving ? <Loader2 size={13} className="animate-spin" /> : saved ? '✓ Saved' : 'Save quote'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* AI error */}
      {aiError && (
        <div className="flex items-start gap-2 bg-red-900/20 border border-red-800/50 rounded-lg px-4 py-3">
          <AlertCircle size={14} className="text-red-400 mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="text-sm text-red-300">{aiError}</p>
          </div>
          <button onClick={() => setAiError(null)} className="text-red-600 hover:text-red-400 text-xs">✕</button>
        </div>
      )}

      {/* AI scope success hint */}
      {aiWriting === false && saved === false && settings.notes && settingsOpen && (
        <div className="flex items-center gap-2 bg-purple-900/20 border border-purple-800/40 rounded-lg px-4 py-2">
          <Sparkles size={13} className="text-purple-400" />
          <p className="text-xs text-purple-300">AI scope written. Review the notes in Quote settings above before printing.</p>
        </div>
      )}

      {/* Quote settings panel */}
      {settingsOpen && (
        <div className="bg-gray-900 rounded-xl border border-gray-700 p-5 space-y-3">
          <p className="text-sm font-semibold text-white">Quote settings (printed on quote)</p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div><label className="text-xs text-gray-400 block mb-1">ABN</label><input value={settings.abn} onChange={se('abn')} className={INP} /></div>
            <div><label className="text-xs text-gray-400 block mb-1">Business address</label><input value={settings.address} onChange={se('address')} className={INP} /></div>
            <div><label className="text-xs text-gray-400 block mb-1">Phone</label><input value={settings.phone} onChange={se('phone')} className={INP} /></div>
            <div><label className="text-xs text-gray-400 block mb-1">Email</label><input value={settings.email} onChange={se('email')} className={INP} /></div>
            <div><label className="text-xs text-gray-400 block mb-1">Valid for (days)</label><input type="number" value={settings.valid_days} onChange={se('valid_days')} className={INP} /></div>
          </div>
          <div><label className="text-xs text-gray-400 block mb-1">Notes (printed on quote)</label>
            <textarea value={settings.notes} onChange={se('notes')} rows={2} className={`${INP} resize-none`} /></div>
          <div><label className="text-xs text-gray-400 block mb-1">Payment terms</label>
            <textarea value={settings.payment_terms} onChange={se('payment_terms')} rows={2} className={`${INP} resize-none`} /></div>
        </div>
      )}

      {/* Job selector */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 space-y-3">
        <p className="text-sm font-semibold text-white">Select job</p>
        {isLoading
          ? <div className="flex justify-center py-4"><Loader2 size={16} className="animate-spin text-yellow-400" /></div>
          : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <select value={selJobId} onChange={e => loadJob(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-yellow-400 cursor-pointer">
                  <option value="">— Select a job to build quote —</option>
                  {jobs.map(j => (
                    <option key={j.id} value={j.id}>{j.id} · {j.client || 'No client'} {j.address ? `— ${j.address}` : ''}</option>
                  ))}
                </select>
              </div>
              {selJob && (
                <div className="flex items-center gap-4 text-sm text-gray-400">
                  <span className="font-mono text-gray-500 text-xs">{selJob.id}</span>
                  <span className="text-white">{selJob.client}</span>
                  {selJob.address && <span className="text-gray-500 truncate">{selJob.address}</span>}
                </div>
              )}
            </div>
          )
        }
      </div>

      {/* Items */}
      {selJobId && (
        <>
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-white">Quote line items</p>
            <button onClick={addItem}
              className="flex items-center gap-1.5 text-sm bg-yellow-400 hover:bg-yellow-300 text-gray-900 font-semibold px-3 py-1.5 rounded-lg transition-colors">
              <Plus size={14} /> Add area
            </button>
          </div>

          <div className="space-y-3">
            {items.map(item => (
              <ItemRow key={item.id} item={item}
                onChange={updated => updateItem(item.id, updated)}
                onDelete={() => removeItem(item.id)}
              />
            ))}
            {!items.length && (
              <div className="text-center py-8 text-gray-500 text-sm border-2 border-dashed border-gray-800 rounded-xl">
                Click "Add area" to start building the quote
              </div>
            )}
          </div>

          {/* Totals */}
          {items.length > 0 && (
            <div className="bg-gray-900 rounded-xl border border-gray-700 p-5">
              <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div className="space-y-1 flex-1">
                  <p className="text-xs text-gray-500 font-semibold uppercase tracking-wide mb-3">Summary</p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {[
                      { label: 'Total sqm', value: `${items.reduce((s, it) => s + calcItem(it).sqm, 0).toFixed(1)} m²` },
                      { label: 'Total labour hrs', value: `${items.reduce((s, it) => s + calcItem(it).labourHours, 0).toFixed(1)} h` },
                      { label: 'Total paint', value: `${items.reduce((s, it) => s + calcItem(it).paintLitres, 0).toFixed(1)} L` },
                      { label: 'Items', value: items.length },
                    ].map(({ label, value }) => (
                      <div key={label} className="bg-gray-800 rounded-lg p-3">
                        <p className="text-xs text-gray-500">{label}</p>
                        <p className="text-sm font-semibold text-white">{value}</p>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="space-y-1 text-right min-w-[200px]">
                  <div className="flex justify-between text-sm text-gray-400">
                    <span>Subtotal ex GST</span>
                    <span className="font-semibold text-white tabular-nums">{fmtCurrency(totals.exGST)}</span>
                  </div>
                  <div className="flex justify-between text-sm text-gray-400">
                    <span>GST (10%)</span>
                    <span className="font-semibold text-white tabular-nums">{fmtCurrency(totals.gst)}</span>
                  </div>
                  <div className="flex justify-between text-base font-bold border-t border-gray-700 pt-2 mt-2">
                    <span className="text-white">TOTAL inc GST</span>
                    <span className="text-yellow-400 tabular-nums">{fmtCurrency(totals.incGST)}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
