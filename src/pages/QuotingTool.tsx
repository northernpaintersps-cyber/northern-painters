import { useState, useMemo, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { fmtCurrency, genId, nextJobId } from '@/lib/utils'
import { useBusinessSettings } from '@/pages/SettingsPage'
import {
  generateQuote, suggestProcessHours, estimateConsumables,
  extractQuantities, type ExtractDoc, type QuantityExtraction,
} from '@/lib/ai'
import {
  INT_SUBS, EXT_SUBS, SPEC_SUBS, PROD_RATES, JOB_TYPES, QUOTE_TERMS,
  PREP_OPTS, HEIGHT_OPTS, ACCESS_OPTS, METHOD_OPTS, CONS_PREP, WORKFLOWS,
  BENCHMARKS, type Sub,
} from '@/lib/quoteData'
import {
  Plus, Trash2, Loader2, Sparkles, Save, ClipboardList, Settings2,
  FileText, Image as ImageIcon, Ruler, Hammer, RefreshCw,
  FileDown, Lock, ArrowUp, ArrowDown, Check,
} from 'lucide-react'

type Row = Record<string, any>
const INP = 'w-full px-2.5 py-2 text-[13px] bg-white border border-black/20 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500'
const BTN = 'flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] bg-white border border-black/20 rounded-lg hover:bg-[#f5f4f0]'
const BTN_P = 'flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] bg-blue-600 hover:bg-blue-700 text-white rounded-lg'
const CT = 'text-[13px] font-bold mb-2.5'

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`bg-white border border-black/[0.12] rounded-xl p-4 mb-3.5 ${className}`}>{children}</div>
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      {children}
    </div>
  )
}

type Process = { id: string; name: string; hours: number }
type Room = { id: string; name: string; w: number; l: number; h: number }
type Equip = { id: string; name: string; cost: number }
type ExtraMat = { id: string; name: string; cost: number }
type Painter = { id: string; name: string; rate: number }

// Markdown-ish rendering for the AI estimate, tables included
function renderEstimate(src: string): string {
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const lines = esc(src).split('\n')
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

  for (const raw of lines) {
    const line = raw.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    if (/^\s*\|/.test(line)) {
      const cells = line.split('|').slice(1, -1).map(c => c.trim())
      if (cells.every(c => /^:?-{2,}:?$/.test(c))) continue     // separator row
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

export default function QuotingTool() {
  const nav = useNavigate()
  const qc = useQueryClient()
  const { user } = useAuth()
  const { data: biz } = useBusinessSettings()
  const apiKey = biz?.ai_api_key?.trim() ?? ''
  const rates = biz?.rates ?? { standard: 65, lead: 75, sub: 70, overhead: 12, hpd: 8, charge_rate: 65 }

  const { data: jobs = [] } = useQuery({
    queryKey: ['np_jobs', user?.id],
    queryFn: async () => {
      const { data } = await supabase.from('np_jobs').select('*').eq('user_id', user!.id)
      return (data ?? []) as Row[]
    },
    enabled: !!user,
  })

  // Drafts live in np_settings, so no migration is needed
  const { data: drafts = [] } = useQuery({
    queryKey: ['np_quote_drafts', user?.id],
    queryFn: async () => {
      const { data } = await (supabase.from('np_settings') as any)
        .select('value').eq('user_id', user!.id).eq('key', 'quote_drafts').maybeSingle()
      return (data?.value ?? []) as Row[]
    },
    enabled: !!user,
  })
  const saveDrafts = useMutation({
    mutationFn: async (list: Row[]) => {
      const { error } = await (supabase.from('np_settings') as any).upsert({
        key: 'quote_drafts', user_id: user!.id, value: list, updated_at: new Date().toISOString(),
      })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['np_quote_drafts'] }),
  })

  // 1. Job details
  const [client, setClient] = useState('')
  const [address, setAddress] = useState('')
  const [jobType, setJobType] = useState(JOB_TYPES[0])
  const [terms, setTerms] = useState(QUOTE_TERMS[0])

  // 1b. Documents & scope
  const [docs, setDocs] = useState<ExtractDoc[]>([])
  const [siteNotes, setSiteNotes] = useState('')
  const [extracting, setExtracting] = useState(false)
  const [extractRes, setExtractRes] = useState<QuantityExtraction | null>(null)
  const imgRef = useRef<HTMLInputElement>(null)
  const pdfRef = useRef<HTMLInputElement>(null)

  // 1c. Rooms
  const [rooms, setRooms] = useState<Room[]>([])

  // 2. Substrates
  const [qty, setQty] = useState<Record<string, number>>({})
  const [extraSubs, setExtraSubs] = useState<{ id: string; group: 'i' | 'e' | 's'; label: string; unit: string; qty: number }[]>([])

  // 3. Condition
  const [prep, setPrep] = useState(PREP_OPTS[1])
  const [ceilingHeight, setCeilingHeight] = useState(HEIGHT_OPTS[0])
  const [access, setAccess] = useState(ACCESS_OPTS[0])

  // 4. Labour
  const [method, setMethod] = useState('roll')
  const [coats, setCoats] = useState('2')
  const [procUnit, setProcUnit] = useState<'hrs' | 'days'>('hrs')
  const [processes, setProcesses] = useState<Process[]>([])
  const [suggesting, setSuggesting] = useState(false)

  // 5. Consumables & extra materials
  const [consPrep, setConsPrep] = useState('medium')
  const [consTotal, setConsTotal] = useState(0)
  const [consNotes, setConsNotes] = useState('')
  const [consBusy, setConsBusy] = useState(false)
  const [extraMats, setExtraMats] = useState<ExtraMat[]>([])

  // 6. Painters & logistics
  const [painters, setPainters] = useState<Painter[]>([
    { id: genId('p'), name: 'Painter 1', rate: rates.standard },
    { id: genId('p'), name: 'Painter 2', rate: rates.standard },
  ])
  const [travelKm, setTravelKm] = useState('')
  const [equip, setEquip] = useState<Equip[]>([])
  const [logisticsNotes, setLogisticsNotes] = useState('')

  // Output
  const [estimate, setEstimate] = useState('')
  const [genBusy, setGenBusy] = useState(false)
  const [genErr, setGenErr] = useState('')
  const [lockedPrice, setLockedPrice] = useState<number | ''>('')
  const [showRates, setShowRates] = useState(false)

  // Prefill from a site visit
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('np_prefill_quote')
      if (!raw) return
      sessionStorage.removeItem('np_prefill_quote')
      const p = JSON.parse(raw)
      if (p.client) setClient(p.client)
      if (p.address) setAddress(p.address)
      if (p.jobType && JOB_TYPES.includes(p.jobType)) setJobType(p.jobType)
      if (Array.isArray(p.areas) && p.areas.length) {
        const walls = p.areas.reduce((s: number, a: any) => s + (a.sqm || 0), 0)
        if (walls > 0) setQty(q => ({ ...q, walls: Math.round(walls) }))
        setSiteNotes(p.areas.map((a: any) => `${a.area_name}: ${a.notes || ''}`)
          .filter((l: string) => l.trim().length > 2).join('\n'))
      }
    } catch {}
  }, [])

  const allSubs: { sub: Sub }[] = [
    ...INT_SUBS.map(s => ({ sub: s })),
    ...EXT_SUBS.map(s => ({ sub: s })),
    ...SPEC_SUBS.map(s => ({ sub: s })),
  ]

  const substrateLines = useMemo(() => {
    const lines = allSubs
      .filter(({ sub }) => (qty[sub.key] || 0) > 0)
      .map(({ sub }) => `${sub.label}: ${qty[sub.key]} ${sub.unit} — ${sub.paint}, ${sub.defMethod}, ${sub.defFinish}`)
    extraSubs.filter(s => s.qty > 0).forEach(s => lines.push(`${s.label}: ${s.qty} ${s.unit}`))
    return lines.join('\n')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qty, extraSubs])

  // V16 PROD_RATES baseline — a sanity figure next to the AI's hours
  const baselineHours = useMemo(() => allSubs.reduce((s, { sub }) =>
    s + (qty[sub.key] || 0) * (PROD_RATES[sub.key] ?? 0), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [qty])

  const rateSum = painters.reduce((s, p) => s + (p.rate || 0), 0)
  const totalHours = processes.reduce((s, p) => s + (p.hours || 0), 0)
  const labourCost = totalHours * rateSum
  const days = rates.hpd > 0 ? totalHours / rates.hpd : 0
  const equipTotal = equip.reduce((s, e) => s + (e.cost || 0), 0)
  const extraMatTotal = extraMats.reduce((s, m) => s + (m.cost || 0), 0)

  // Materials priced from the paint product library against substrate quantities
  const materials = useMemo(() => {
    const products: Record<string, { product: string; size: string; litres: number; coverage: number; price: number }> = {}
    const lib: any[] = biz?.paint_products ?? []
    allSubs.forEach(({ sub }) => {
      const q = qty[sub.key] || 0
      if (q <= 0) return
      const first = sub.paint.toLowerCase().split(' ')[0]
      const hit = lib.find(p => (p.product ?? '').toLowerCase().includes(first))
      const coverage = hit?.coverage ?? 12
      const m2 = sub.unit === 'm2' ? q : sub.unit === 'lm' ? q * 0.3 : q * 2
      const litres = (m2 * parseInt(coats)) / coverage
      const key = hit?.product ?? sub.paint
      if (!products[key]) products[key] = { product: key, size: hit?.size ?? '4L', litres: 0, coverage, price: hit?.yours ?? 0 }
      products[key].litres += litres
    })
    const rows = Object.values(products).map(p => {
      const tinL = parseFloat(p.size) || 4
      const tins = Math.ceil(p.litres / tinL)
      return { ...p, tins, cost: tins * p.price }
    })
    return { rows, total: rows.reduce((s, r) => s + r.cost, 0) + extraMatTotal }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qty, coats, biz, extraMatTotal])

  const subtotal = labourCost + materials.total + consTotal + equipTotal
  const gst = subtotal * 0.1

  function addDocFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? [])
    if (picked.length) setDocs(d => [...d, ...picked.map(f => ({ file: f, measurements: '' }))])
    e.target.value = ''
  }

  async function runExtract() {
    if (!apiKey) { setGenErr('No API key set. Add your Anthropic API key in Settings.'); return }
    setExtracting(true); setGenErr('')
    try {
      const res = await extractQuantities(apiKey, docs, siteNotes)
      setExtractRes(res)
      const next = { ...qty }
      ;(['interior', 'exterior', 'specialty'] as const).forEach(sec => {
        const vals = (res as any)[sec] as Record<string, number> | undefined
        if (!vals) return
        Object.entries(vals).forEach(([k, v]) => { if (v > 0) next[k] = v })
      })
      setQty(next)
    } catch (e: any) { setGenErr(e?.message ?? 'Extraction failed') } finally { setExtracting(false) }
  }

  function applyRooms() {
    const ceil = rooms.reduce((s, r) => s + r.w * r.l, 0)
    const wall = rooms.reduce((s, r) => s + 2 * (r.w + r.l) * (r.h || 2.4), 0)
    setQty(q => ({ ...q, ceilings: Math.round(ceil), walls: Math.round(wall) }))
  }

  function loadWorkflow() {
    const steps = WORKFLOWS[jobType] ?? WORKFLOWS['Interior repaint']
    setProcesses(steps.map(name => ({ id: genId('pr'), name, hours: 0 })))
  }

  async function aiSuggestHours() {
    if (!apiKey) { setGenErr('No API key set. Add your Anthropic API key in Settings.'); return }
    let list = processes
    if (!list.length) {
      const steps = WORKFLOWS[jobType] ?? WORKFLOWS['Interior repaint']
      list = steps.map(name => ({ id: genId('pr'), name, hours: 0 }))
      setProcesses(list)
    }
    setSuggesting(true); setGenErr('')
    try {
      const hours = await suggestProcessHours(apiKey, {
        jobType, prep, method: METHOD_OPTS.find(m => m.v === method)?.l ?? 'Brush & Roll',
        coats, access, ceilingHeight, substrates: substrateLines,
        processes: list.map(p => p.name), painters: painters.length,
      })
      setProcesses(list.map(p => ({ ...p, hours: hours[p.name] ?? p.hours })))
    } catch (e: any) { setGenErr(e?.message ?? 'Hour estimate failed') } finally { setSuggesting(false) }
  }

  async function runConsAI() {
    if (!apiKey) { setGenErr('No API key set. Add your Anthropic API key in Settings.'); return }
    setConsBusy(true); setGenErr('')
    try {
      const r = await estimateConsumables(apiKey, {
        jobType, prepLevel: consPrep, substrates: substrateLines,
        method: METHOD_OPTS.find(m => m.v === method)?.l ?? 'Brush & Roll',
      })
      setConsTotal(Math.round(r.total)); setConsNotes(r.notes)
    } catch (e: any) { setGenErr(e?.message ?? 'Consumables estimate failed') } finally { setConsBusy(false) }
  }

  // Benchmarks drawn from the user's own finished jobs
  const benchmarkText = useMemo(() => {
    const finished = jobs.filter(j => j.status === 'Finished' && (j.agreed_ex_gst || 0) > 0)
    const sameType = finished.filter(j => j.type === jobType)
    const pool = sameType.length ? sameType : finished
    if (!pool.length) {
      return 'INDUSTRY BENCHMARKS (no comparable finished jobs yet): Interior medium $7700–$16500. Exterior medium $13900–$21800. Full repaint $18800–$38000. New build $21400.'
    }
    const prices = pool.map(j => j.agreed_ex_gst as number)
    const label = sameType.length ? `YOUR PAST ${jobType.toUpperCase()} JOBS` : 'YOUR PAST FINISHED JOBS'
    const lines = pool.slice(0, 6).map(j => `${j.client || 'Job'} (${j.address || ''}): agreed $${Math.round(j.agreed_ex_gst)}`).join('; ')
    return `${label}: ${lines}. Price range: $${Math.round(Math.min(...prices))}–$${Math.round(Math.max(...prices))} ex GST.`
  }, [jobs, jobType])

  async function runQuote() {
    if (!apiKey) { setGenErr('No API key set. Add your Anthropic API key in Settings.'); return }
    setGenBusy(true); setGenErr(''); setEstimate('')
    try {
      const text = await generateQuote(apiKey, {
        client, address, jobType, terms,
        method: METHOD_OPTS.find(m => m.v === method)?.l ?? 'Brush & Roll',
        coats, prep, ceilingHeight, access, travelKm,
        equipText: equip.map(e => e.name).filter(Boolean).join(', ') || 'None',
        equipTotal,
        substrates: substrateLines,
        labourBreakdown: processes.map(p => `${p.name}: ${p.hours.toFixed(1)} hrs ($${Math.round(p.hours * rateSum)})`).join('\n'),
        totalHours, labourCost, days,
        consumables: consTotal,
        materialsBreakdown: materials.rows.length
          ? materials.rows.map(r => `${r.product} (${r.size}): ${r.litres.toFixed(1)}L needed → ${r.tins} tin${r.tins !== 1 ? 's' : ''} = ${fmtCurrency(r.cost)}`).join('\n')
            + `\nTOTAL MATERIALS: ${fmtCurrency(materials.total)} ex GST`
          : 'No paint products found in library — estimate manually.',
        materialsTotal: materials.total,
        painterDesc: `${painters.length} painter${painters.length !== 1 ? 's' : ''} @ ${painters.map(p => '$' + p.rate).join(', ')}/hr`,
        overheadPct: rates.overhead, hoursPerDay: rates.hpd,
        tradePrices: (biz?.paint_products ?? []).slice(0, 20)
          .map((p: any) => `${p.product} ${p.size}: $${p.yours} trade, ${p.coverage}m2/L`).join('; '),
        benchmarks: benchmarkText,
        siteNotes, logisticsNotes,
      })
      setEstimate(text)
    } catch (e: any) { setGenErr(e?.message ?? 'Quote generation failed') } finally { setGenBusy(false) }
  }

  // V16 saveQJob — the quote becomes the job, no job needed up front
  const saveJob = useMutation({
    mutationFn: async () => {
      const id = nextJobId(jobs.map(j => j.id))
      const agreed = typeof lockedPrice === 'number' && lockedPrice > 0 ? lockedPrice : subtotal
      const { error } = await (supabase.from('np_jobs') as any).upsert({
        id, user_id: user!.id,
        client, address, type: jobType, terms,
        job_desc: `${jobType} — ${substrateLines.split('\n').slice(0, 3).join('; ')}`,
        status: 'Not Started', quote_status: 'Quote Created',
        quote_ex_gst: Math.round(subtotal),
        agreed_ex_gst: Math.round(agreed),
        est_labour_ex: Math.round(labourCost),
        est_materials_ex: Math.round(materials.total + consTotal),
        labour_rate: painters[0]?.rate ?? rates.standard,
        est_days: Math.max(1, Math.round(days)),
        notes: siteNotes,
        extra: { quote_estimate: estimate, substrates: qty, processes, painters },
        created_at: new Date().toISOString(),
      })
      if (error) throw error
      return id
    },
    onSuccess: id => {
      qc.invalidateQueries({ queryKey: ['np_jobs'] })
      if (confirm(`Saved as job ${id}. Open the Jobs page?`)) nav('/jobs')
    },
    onError: (e: any) => alert('Save failed: ' + e.message),
  })

  function saveDraft() {
    const draft = {
      id: genId('qd'), savedAt: new Date().toISOString(),
      client, address, jobType, terms, qty, extraSubs, prep, ceilingHeight, access,
      method, coats, processes, consPrep, consTotal, consNotes, extraMats,
      painters, travelKm, equip, siteNotes, logisticsNotes, estimate, lockedPrice,
    }
    const next = [draft, ...drafts.filter(d => d.client !== client || d.jobType !== jobType)].slice(0, 20)
    saveDrafts.mutate(next)
  }

  function loadDraft(d: Row) {
    setClient(d.client ?? ''); setAddress(d.address ?? ''); setJobType(d.jobType ?? JOB_TYPES[0])
    setTerms(d.terms ?? QUOTE_TERMS[0]); setQty(d.qty ?? {}); setExtraSubs(d.extraSubs ?? [])
    setPrep(d.prep ?? PREP_OPTS[1]); setCeilingHeight(d.ceilingHeight ?? HEIGHT_OPTS[0]); setAccess(d.access ?? ACCESS_OPTS[0])
    setMethod(d.method ?? 'roll'); setCoats(d.coats ?? '2'); setProcesses(d.processes ?? [])
    setConsPrep(d.consPrep ?? 'medium'); setConsTotal(d.consTotal ?? 0); setConsNotes(d.consNotes ?? '')
    setExtraMats(d.extraMats ?? []); setPainters(d.painters?.length ? d.painters : painters)
    setTravelKm(d.travelKm ?? ''); setEquip(d.equip ?? []); setSiteNotes(d.siteNotes ?? '')
    setLogisticsNotes(d.logisticsNotes ?? ''); setEstimate(d.estimate ?? ''); setLockedPrice(d.lockedPrice ?? '')
  }

  function clearAll() {
    if (!confirm('Start a new quote? Unsaved changes will be lost.')) return
    setClient(''); setAddress(''); setQty({}); setExtraSubs([]); setProcesses([])
    setConsTotal(0); setConsNotes(''); setExtraMats([]); setEquip([]); setRooms([])
    setSiteNotes(''); setLogisticsNotes(''); setEstimate(''); setLockedPrice(''); setDocs([]); setExtractRes(null)
  }

  function exportQuote() {
    const w = window.open('', '_blank')
    if (!w) return
    w.document.write(buildQuoteHTML({
      client, address, jobType, biz, estimate,
      subtotal: typeof lockedPrice === 'number' && lockedPrice > 0 ? lockedPrice : subtotal,
      lockedPrice: typeof lockedPrice === 'number' ? lockedPrice : 0,
      substrateLines, days,
    }))
    w.document.close()
    setTimeout(() => w.print(), 500)
  }

  const SubGroup = ({ title, subs, group }: { title: string; subs: Sub[]; group: 'i' | 'e' | 's' }) => (
    <Card>
      <div className={CT}>{title}</div>
      <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(210px,1fr))' }}>
        {subs.map(s => (
          <div key={s.key} className="flex items-center gap-2 bg-[#f5f4f0] rounded-lg px-2.5 py-1.5">
            <div className="flex-1 min-w-0">
              <div className="text-[12.5px] font-medium truncate">{s.label}</div>
              <div className="text-[10px] text-[#666] truncate">{s.paint}</div>
            </div>
            <input type="number" min={0} step="any" value={qty[s.key] || ''} placeholder="0"
              onChange={e => setQty(q => ({ ...q, [s.key]: parseFloat(e.target.value) || 0 }))}
              className="w-16 px-1.5 py-1 text-right font-mono text-xs bg-white border border-black/20 rounded focus:outline-none focus:ring-1 focus:ring-blue-500" />
            <span className="text-[10px] text-[#999] w-8">{s.unit}</span>
          </div>
        ))}
      </div>
      {extraSubs.filter(s => s.group === group).map(s => (
        <div key={s.id} className="flex items-center gap-2 bg-[#f5f4f0] rounded-lg px-2.5 py-1.5 mt-1.5">
          <input value={s.label} placeholder="Substrate name"
            onChange={e => setExtraSubs(x => x.map(y => y.id === s.id ? { ...y, label: e.target.value } : y))}
            className="flex-1 px-1.5 py-1 text-xs bg-white border border-black/20 rounded focus:outline-none" />
          <input type="number" value={s.qty || ''} placeholder="0"
            onChange={e => setExtraSubs(x => x.map(y => y.id === s.id ? { ...y, qty: parseFloat(e.target.value) || 0 } : y))}
            className="w-16 px-1.5 py-1 text-right font-mono text-xs bg-white border border-black/20 rounded focus:outline-none" />
          <select value={s.unit} onChange={e => setExtraSubs(x => x.map(y => y.id === s.id ? { ...y, unit: e.target.value } : y))}
            className="text-[10px] bg-white border border-black/20 rounded px-1 py-1">
            <option>m2</option><option>lm</option><option>count</option>
          </select>
          <button onClick={() => setExtraSubs(x => x.filter(y => y.id !== s.id))} className="text-[#c0392b]"><Trash2 size={12} /></button>
        </div>
      ))}
      <button onClick={() => setExtraSubs(x => [...x, { id: genId('xs'), group, label: '', unit: 'm2', qty: 0 }])}
        className={`${BTN} mt-2`}><Plus size={12} /> Add substrate</button>
    </Card>
  )

  return (
    <div className="p-5">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <h2 className="text-[17px] font-semibold text-gray-900">AI Quote Builder</h2>
        <div className="flex gap-2 flex-wrap">
          <button onClick={saveDraft} className={BTN_P}><Save size={13} /> Save Draft</button>
          <button onClick={() => setShowRates(s => !s)} className={BTN}><Settings2 size={13} /> Rates</button>
        </div>
      </div>

      {drafts.length > 0 && (
        <div className="flex gap-2 flex-wrap items-center mb-3 px-3.5 py-2.5 bg-[#f0fdf4] rounded-[10px] border border-[#86efac]">
          <span className="text-[13px] font-semibold text-[#166534] flex items-center gap-1.5">
            <ClipboardList size={14} /> {drafts.length} saved draft{drafts.length !== 1 ? 's' : ''}
          </span>
          {drafts.slice(0, 5).map(d => (
            <button key={d.id} onClick={() => loadDraft(d)} className={`${BTN} bg-white`}>
              {(d.client || 'Unnamed').split(' ')[0]}{d.lockedPrice ? ` $${Math.round(d.lockedPrice)}` : ''}
            </button>
          ))}
          <button onClick={() => { if (confirm('Delete all drafts?')) saveDrafts.mutate([]) }}
            className={`${BTN} ml-auto text-[#c0392b]`}><Trash2 size={12} /> Clear</button>
        </div>
      )}

      {showRates && (
        <Card>
          <div className={CT}>Labour Rates</div>
          <div className="text-[11px] text-[#666] mb-2">
            These come from Settings → Labour rates. Change them there so every page stays in step.
          </div>
          <div className="flex gap-4 flex-wrap text-[13px] items-end">
            {([['Standard', rates.standard], ['Lead', rates.lead], ['Sub', rates.sub],
               ['Overhead %', rates.overhead], ['Hrs per day', rates.hpd]] as [string, number][]).map(([l, v]) => (
              <div key={l}>
                <div className="text-[11px] text-[#666]">{l}</div>
                <div className="font-semibold">{v}</div>
              </div>
            ))}
            <button onClick={() => nav('/settings')} className={BTN}>Edit in Settings</button>
          </div>
        </Card>
      )}

      <div className="grid gap-3.5 items-start" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)' }}>
        {/* LEFT */}
        <div>
          <Card>
            <div className={CT}>1. Job Details</div>
            <div className="flex flex-col gap-2.5">
              <Field label="Client"><input value={client} onChange={e => setClient(e.target.value)} placeholder="e.g. Jenny and Garry" className={INP} /></Field>
              <Field label="Address"><input value={address} onChange={e => setAddress(e.target.value)} placeholder="e.g. Goonellabah, Northern Rivers" className={INP} /></Field>
              <Field label="Job type">
                <select value={jobType} onChange={e => setJobType(e.target.value)} className={INP}>
                  {JOB_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
              <Field label="Quote terms">
                <select value={terms} onChange={e => setTerms(e.target.value)} className={INP}>
                  {QUOTE_TERMS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
            </div>
          </Card>

          <Card>
            <div className={CT}>1b. Documents, Drawings &amp; Scope</div>
            <div className="text-[11px] text-[#666] mb-2.5">
              Upload floor plans, drawings, finishes schedules, scope of works, or site photos.
              AI reads all documents and auto-fills substrate quantities below.
            </div>
            <div className="flex gap-2 flex-wrap mb-2.5">
              <button onClick={() => imgRef.current?.click()} className={BTN}><ImageIcon size={13} /> Add Images</button>
              <input ref={imgRef} type="file" accept="image/*" multiple className="hidden" onChange={addDocFiles} />
              <button onClick={() => pdfRef.current?.click()} className={BTN}><FileText size={13} /> Add PDF</button>
              <input ref={pdfRef} type="file" accept="application/pdf" multiple className="hidden" onChange={addDocFiles} />
              {docs.length > 0 && (
                <button onClick={runExtract} disabled={extracting} className={`${BTN_P} disabled:opacity-50`}>
                  {extracting ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} Extract quantities
                </button>
              )}
            </div>
            {docs.map((d, i) => (
              <div key={i} className="bg-[#f5f4f0] rounded-[7px] px-2.5 py-1.5 mb-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  {d.file.type === 'application/pdf' ? <FileText size={14} className="text-[#2563eb]" /> : <ImageIcon size={14} className="text-[#2563eb]" />}
                  <span className="flex-1 text-xs truncate">{d.file.name}</span>
                  <span className="text-[10px] text-[#666]">{(d.file.size / 1024).toFixed(0)} KB</span>
                  <button onClick={() => setDocs(x => x.filter((_, j) => j !== i))} className="text-[#c0392b] text-lg leading-none">×</button>
                </div>
                <div className="flex items-center gap-1.5 mt-1.5 pt-1.5 border-t border-black/[0.07] flex-wrap">
                  <Ruler size={11} className="text-[#2563eb]" />
                  <span className="text-[10px] text-[#666]">Known measurements</span>
                  <input value={d.measurements ?? ''} placeholder="e.g. front wall 8m · ceiling 2.7m"
                    onChange={e => setDocs(x => x.map((y, j) => j === i ? { ...y, measurements: e.target.value } : y))}
                    className="flex-1 min-w-[140px] px-1.5 py-1 border border-black/[0.18] rounded-[5px] text-[11px] bg-white focus:outline-none" />
                </div>
              </div>
            ))}
            {extractRes && (
              <div className="bg-[#f0fdf4] border border-[#86efac] rounded-lg px-3 py-2 mb-2.5 text-xs text-[#166534]">
                <Check size={12} className="inline mr-1" />
                Quantities applied to the substrates below.
                {extractRes.confidence && <span className="ml-1 font-bold">{extractRes.confidence.toUpperCase()}</span>}
                {extractRes.scopeNotes && <div className="mt-1 text-[#92400e]">{extractRes.scopeNotes}</div>}
              </div>
            )}
            <Field label="Site / Quoting Notes (used by AI in calculations)">
              <textarea value={siteNotes} onChange={e => setSiteNotes(e.target.value)} rows={6}
                placeholder="e.g. Walls in Dulux Antique White USA. Ceiling has water stains — stain block needed. 2 coats throughout."
                className={`${INP} resize-y leading-relaxed`} />
            </Field>
          </Card>

          <Card>
            <div className="flex justify-between items-center mb-2">
              <div className={`${CT} m-0`}>1c. Room Calculator</div>
              <button onClick={() => setRooms(r => [...r, { id: genId('rm'), name: '', w: 0, l: 0, h: 2.4 }])} className={BTN}>
                <Plus size={12} /> Add room
              </button>
            </div>
            <div className="text-[11px] text-[#666] mb-2">
              Enter dimensions to auto-calculate ceiling and wall areas (height defaults to 2.4m).
            </div>
            {rooms.length > 0 && (
              <table className="w-full border-collapse text-xs mb-2">
                <thead>
                  <tr>{['Room', 'W m', 'L m', 'H m', 'Ceil m²', 'Wall m²', ''].map(h => (
                    <th key={h} className="text-left px-1.5 py-1 text-[#666] border-b border-black/[0.12] font-medium">{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {rooms.map(r => {
                    const ceil = r.w * r.l
                    const wall = 2 * (r.w + r.l) * (r.h || 2.4)
                    const upd = (patch: Partial<Room>) => setRooms(x => x.map(y => y.id === r.id ? { ...y, ...patch } : y))
                    return (
                      <tr key={r.id}>
                        <td className="px-1.5 py-1"><input value={r.name} onChange={e => upd({ name: e.target.value })} className="w-full px-1 py-0.5 border border-black/15 rounded text-xs" /></td>
                        {(['w', 'l', 'h'] as const).map(k => (
                          <td key={k} className="px-1.5 py-1">
                            <input type="number" step="0.1" value={r[k] || ''} onChange={e => upd({ [k]: parseFloat(e.target.value) || 0 } as Partial<Room>)}
                              className="w-14 px-1 py-0.5 border border-black/15 rounded text-xs text-right font-mono" />
                          </td>
                        ))}
                        <td className="px-1.5 py-1 font-mono">{ceil.toFixed(1)}</td>
                        <td className="px-1.5 py-1 font-mono">{wall.toFixed(1)}</td>
                        <td className="px-1.5 py-1"><button onClick={() => setRooms(x => x.filter(y => y.id !== r.id))} className="text-[#c0392b]"><Trash2 size={12} /></button></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
            <div className="flex justify-between items-center gap-2 flex-wrap">
              <div className="text-xs text-[#666]">
                {rooms.length > 0 && `Total ceiling ${rooms.reduce((s, r) => s + r.w * r.l, 0).toFixed(1)} m² · wall ${rooms.reduce((s, r) => s + 2 * (r.w + r.l) * (r.h || 2.4), 0).toFixed(1)} m²`}
              </div>
              <button onClick={applyRooms} disabled={!rooms.length} className={`${BTN_P} disabled:opacity-50`}>
                <Check size={12} /> Apply to substrates
              </button>
            </div>
          </Card>

          <SubGroup title="2a. Interior Substrates" subs={INT_SUBS} group="i" />
          <SubGroup title="2b. Exterior Substrates" subs={EXT_SUBS} group="e" />
          <SubGroup title="2c. Specialty" subs={SPEC_SUBS} group="s" />

          <Card>
            <div className={CT}>3. Condition and Complexity</div>
            <div className="flex flex-col gap-2.5">
              <Field label="Surface condition"><select value={prep} onChange={e => setPrep(e.target.value)} className={INP}>{PREP_OPTS.map(o => <option key={o}>{o}</option>)}</select></Field>
              <Field label="Ceiling height"><select value={ceilingHeight} onChange={e => setCeilingHeight(e.target.value)} className={INP}>{HEIGHT_OPTS.map(o => <option key={o}>{o}</option>)}</select></Field>
              <Field label="Access complexity"><select value={access} onChange={e => setAccess(e.target.value)} className={INP}>{ACCESS_OPTS.map(o => <option key={o}>{o}</option>)}</select></Field>
            </div>
          </Card>

          <Card>
            <div className="flex justify-between items-center mb-1 flex-wrap gap-2">
              <div className={`${CT} m-0`}>4. Labour — Processes &amp; Hours</div>
              <div className="flex gap-1.5 items-center flex-wrap">
                <div className="flex border border-black/[0.18] rounded-md overflow-hidden text-[11px]">
                  {(['hrs', 'days'] as const).map(u => (
                    <button key={u} onClick={() => setProcUnit(u)}
                      className={`px-2.5 py-1 font-semibold ${procUnit === u ? 'bg-blue-600 text-white' : 'bg-[#f5f4f0] text-[#666]'}`}>{u}</button>
                  ))}
                </div>
                <button onClick={loadWorkflow} className={BTN}><ClipboardList size={12} /> Template</button>
                <button onClick={aiSuggestHours} disabled={suggesting} className={`${BTN} disabled:opacity-50`}>
                  {suggesting ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} AI Suggest
                </button>
                <button onClick={() => setProcesses(p => [...p, { id: genId('pr'), name: '', hours: 0 }])} className={BTN}><Plus size={12} /></button>
              </div>
            </div>
            <div className="text-[11px] text-[#666] mb-2.5">
              Enter time per process step. These exact totals go into the quote — AI does not recalculate them.
              {baselineHours > 0 && <> Production-rate baseline for your quantities: <strong>{baselineHours.toFixed(1)} hrs</strong>.</>}
            </div>
            <div className="flex gap-2 mb-2.5 flex-wrap">
              <div className="flex-1 min-w-[140px]">
                <label className="block text-[10px] uppercase font-bold text-[#666] mb-1">Application method</label>
                <select value={method} onChange={e => setMethod(e.target.value)} className={INP}>
                  {METHOD_OPTS.map(m => <option key={m.v} value={m.v}>{m.l}</option>)}
                </select>
              </div>
              <div className="flex-1 min-w-[120px]">
                <label className="block text-[10px] uppercase font-bold text-[#666] mb-1">Coats</label>
                <select value={coats} onChange={e => setCoats(e.target.value)} className={INP}>
                  {['1', '2', '3'].map(c => <option key={c} value={c}>{c} coat{c !== '1' ? 's' : ''}</option>)}
                </select>
              </div>
            </div>

            {processes.length === 0 ? (
              <div className="text-[#666] text-xs py-1.5">
                Use <b>Template</b> to load the steps for this job type, then <b>AI Suggest</b> to estimate times.
              </div>
            ) : (
              <div className="flex flex-col gap-1.5 mb-2.5">
                {processes.map((p, i) => (
                  <div key={p.id} className="flex items-center gap-1.5">
                    <div className="flex flex-col">
                      <button onClick={() => setProcesses(x => { const n = [...x]; if (i > 0) { [n[i - 1], n[i]] = [n[i], n[i - 1]] } return n })}
                        className="text-[#666] hover:text-gray-900 leading-none"><ArrowUp size={11} /></button>
                      <button onClick={() => setProcesses(x => { const n = [...x]; if (i < n.length - 1) { [n[i + 1], n[i]] = [n[i], n[i + 1]] } return n })}
                        className="text-[#666] hover:text-gray-900 leading-none"><ArrowDown size={11} /></button>
                    </div>
                    <input value={p.name} placeholder="Process step"
                      onChange={e => setProcesses(x => x.map(y => y.id === p.id ? { ...y, name: e.target.value } : y))}
                      className="flex-1 min-w-0 px-2 py-1.5 text-xs bg-white border border-black/20 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500" />
                    <input type="number" step="0.5" min={0}
                      value={procUnit === 'days' ? (p.hours ? (p.hours / rates.hpd).toFixed(2).replace(/\.?0+$/, '') : '') : (p.hours || '')}
                      onChange={e => {
                        const v = parseFloat(e.target.value) || 0
                        setProcesses(x => x.map(y => y.id === p.id ? { ...y, hours: procUnit === 'days' ? v * rates.hpd : v } : y))
                      }}
                      className="w-16 px-1.5 py-1.5 text-right font-mono text-xs bg-white border border-black/20 rounded-lg focus:outline-none" />
                    <span className="text-[10px] text-[#999] w-7">{procUnit}</span>
                    <span className="text-[11px] font-semibold text-[#2563eb] w-16 text-right">{fmtCurrency(p.hours * rateSum)}</span>
                    <button onClick={() => setProcesses(x => x.filter(y => y.id !== p.id))} className="text-[#c0392b]"><Trash2 size={12} /></button>
                  </div>
                ))}
              </div>
            )}

            {totalHours > 0 && (
              <div className="grid grid-cols-3 gap-2 px-3 py-2.5 bg-[#f5f4f0] rounded-lg">
                {([['Total Hours', totalHours.toFixed(1)], ['Labour ex GST', fmtCurrency(labourCost)], ['Est. Days', days.toFixed(1)]] as [string, string][]).map(([l, v], i) => (
                  <div key={l}>
                    <div className="text-[10px] text-[#666] font-semibold uppercase mb-0.5">{l}</div>
                    <div className="text-base font-bold" style={i === 1 ? { color: '#2563eb' } : undefined}>{v}</div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <div className={CT}>5. Consumables</div>
            <div className="text-[11px] text-[#666] mb-2.5">
              AI estimates masking tape, plastic, sandpaper, caulk, cloths, thinners and other consumables
              based on your substrates and prep level.
            </div>
            <div className="flex gap-2 items-end mb-2.5 flex-wrap">
              <div className="flex-1 min-w-[180px]">
                <label className="block text-[10px] uppercase font-bold text-[#666] mb-1">Prep Level</label>
                <select value={consPrep} onChange={e => setConsPrep(e.target.value)} className={INP}>
                  {CONS_PREP.map(c => <option key={c.v} value={c.v}>{c.l}</option>)}
                </select>
              </div>
              <button onClick={runConsAI} disabled={consBusy} className={`${BTN_P} whitespace-nowrap disabled:opacity-50`}>
                {consBusy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} Estimate
              </button>
            </div>
            {consNotes && <div className="mb-2.5 px-3 py-2.5 bg-[#f5f4f0] rounded-lg text-xs text-[#666] leading-relaxed">{consNotes}</div>}
            <div className="flex items-center gap-2">
              <span className="text-[13px] text-[#666] font-semibold">Total consumables (ex GST)</span>
              <div className="flex items-center gap-1 ml-auto">
                <span className="text-[15px] text-[#666]">$</span>
                <input type="number" min={0} value={consTotal || ''} placeholder="0"
                  onChange={e => setConsTotal(parseFloat(e.target.value) || 0)}
                  className="w-24 text-base font-bold text-[#2563eb] border-2 border-[#2563eb] rounded-lg px-2 py-1.5 bg-[#f5f4f0] focus:outline-none" />
              </div>
            </div>
          </Card>

          <Card>
            <div className="flex justify-between items-center mb-2">
              <div className={`${CT} m-0`}>5b. Extra Materials</div>
              <button onClick={() => setExtraMats(m => [...m, { id: genId('em'), name: '', cost: 0 }])} className={BTN}><Plus size={12} /> Add</button>
            </div>
            {extraMats.length === 0 ? <div className="text-[#666] text-xs">None added.</div> : extraMats.map(m => (
              <div key={m.id} className="flex items-center gap-2 mb-1.5">
                <input value={m.name} placeholder="e.g. Stain blocker, specialty primer"
                  onChange={e => setExtraMats(x => x.map(y => y.id === m.id ? { ...y, name: e.target.value } : y))}
                  className="flex-1 min-w-0 px-2 py-1.5 text-xs bg-white border border-black/20 rounded-lg focus:outline-none" />
                <input type="number" value={m.cost || ''} placeholder="0"
                  onChange={e => setExtraMats(x => x.map(y => y.id === m.id ? { ...y, cost: parseFloat(e.target.value) || 0 } : y))}
                  className="w-20 px-2 py-1.5 text-right font-mono text-xs bg-white border border-black/20 rounded-lg focus:outline-none" />
                <button onClick={() => setExtraMats(x => x.filter(y => y.id !== m.id))} className="text-[#c0392b]"><Trash2 size={12} /></button>
              </div>
            ))}
          </Card>

          <Card>
            <div className={CT}>6. Painters and Logistics</div>
            <div className="flex flex-col gap-2.5">
              <Field label="Painters">
                <div className="flex items-center gap-2 mb-2">
                  <input type="number" min={1} max={10} value={painters.length}
                    onChange={e => {
                      const n = Math.max(1, Math.min(10, parseInt(e.target.value) || 1))
                      setPainters(p => n > p.length
                        ? [...p, ...Array.from({ length: n - p.length }, (_, i) => ({ id: genId('p'), name: `Painter ${p.length + i + 1}`, rate: rates.standard }))]
                        : p.slice(0, n))
                    }}
                    className="w-16 px-2 py-1.5 text-[13px] bg-white border border-black/20 rounded-lg focus:outline-none" />
                  <span className="text-xs text-[#666]">painters · combined ${rateSum}/hr</span>
                </div>
                {painters.map(p => (
                  <div key={p.id} className="flex items-center gap-2 mb-1.5">
                    <input value={p.name} onChange={e => setPainters(x => x.map(y => y.id === p.id ? { ...y, name: e.target.value } : y))}
                      className="flex-1 min-w-0 px-2 py-1.5 text-xs bg-white border border-black/20 rounded-lg focus:outline-none" />
                    <span className="text-xs text-[#666]">$</span>
                    <input type="number" value={p.rate}
                      onChange={e => setPainters(x => x.map(y => y.id === p.id ? { ...y, rate: parseFloat(e.target.value) || 0 } : y))}
                      className="w-20 px-2 py-1.5 text-right font-mono text-xs bg-white border border-black/20 rounded-lg focus:outline-none" />
                    <span className="text-[10px] text-[#999]">/hr</span>
                  </div>
                ))}
              </Field>
              <Field label="Travel one way km">
                <input type="number" value={travelKm} onChange={e => setTravelKm(e.target.value)} placeholder="e.g. 25" className={INP} />
              </Field>
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-xs font-medium text-gray-500">Access &amp; Equipment Hire</label>
                  <button onClick={() => setEquip(x => [...x, { id: genId('eq'), name: '', cost: 0 }])} className={BTN}><Plus size={11} /> Add</button>
                </div>
                {equip.map(eq => (
                  <div key={eq.id} className="flex items-center gap-2 mb-1.5">
                    <input value={eq.name} placeholder="e.g. Scaffold hire, boom lift"
                      onChange={e => setEquip(x => x.map(y => y.id === eq.id ? { ...y, name: e.target.value } : y))}
                      className="flex-1 min-w-0 px-2 py-1.5 text-xs bg-white border border-black/20 rounded-lg focus:outline-none" />
                    <input type="number" value={eq.cost || ''} placeholder="0"
                      onChange={e => setEquip(x => x.map(y => y.id === eq.id ? { ...y, cost: parseFloat(e.target.value) || 0 } : y))}
                      className="w-20 px-2 py-1.5 text-right font-mono text-xs bg-white border border-black/20 rounded-lg focus:outline-none" />
                    <button onClick={() => setEquip(x => x.filter(y => y.id !== eq.id))} className="text-[#c0392b]"><Trash2 size={12} /></button>
                  </div>
                ))}
                {equipTotal > 0 && (
                  <div className="flex justify-between items-center px-2.5 py-2 bg-[#f5f4f0] rounded-[7px] text-xs mt-1">
                    <span className="text-[#666]">Equipment hire total (ex GST)</span>
                    <span className="font-bold text-sm text-[#2563eb]">{fmtCurrency(equipTotal)}</span>
                  </div>
                )}
              </div>
              <Field label="Site visit notes">
                <textarea value={logisticsNotes} onChange={e => setLogisticsNotes(e.target.value)} rows={3}
                  placeholder="e.g. Premium finish, oil-based previously used, morning access only…" className={`${INP} resize-y`} />
              </Field>
            </div>
          </Card>

          <button onClick={runQuote} disabled={genBusy}
            className="w-full flex items-center justify-center gap-2 px-3 py-3 text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50">
            {genBusy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            {genBusy ? 'Generating estimate…' : 'Generate Quote Estimate'}
          </button>
        </div>

        {/* RIGHT */}
        <div>
          <Card className="min-h-[300px]">
            <div className={CT}>Quote Estimate</div>
            {genErr && <div className="text-xs text-[#c0392b] bg-[#fef2f2] rounded-lg px-3 py-2 mb-2.5">{genErr}</div>}
            {estimate ? (
              <div className="text-[13px] leading-relaxed" dangerouslySetInnerHTML={{ __html: renderEstimate(estimate) }} />
            ) : !genErr && (
              <div className="text-center py-10 text-[#666]">
                <Sparkles size={36} className="mx-auto mb-3 opacity-25" />
                Fill in the substrates and details, then click Generate
              </div>
            )}
          </Card>

          <Card>
            <div className={CT}>Running Totals</div>
            {([
              ['Labour ex GST', labourCost],
              ['Materials ex GST', materials.total],
              ['Consumables ex GST', consTotal],
              ['Equipment hire ex GST', equipTotal],
              ['Subtotal ex GST', subtotal],
              ['GST 10%', gst],
              ['TOTAL inc GST', subtotal + gst],
            ] as [string, number][]).map(([l, v], i) => (
              <div key={l} className={`flex justify-between py-1.5 ${i >= 4 ? 'border-t border-black/[0.12] font-bold' : 'border-b border-black/[0.06]'}`}>
                <span className="text-[13px]">{l}</span>
                <span className="text-[13px]" style={l.startsWith('TOTAL') ? { color: '#0a7c4e' } : undefined}>{fmtCurrency(v)}</span>
              </div>
            ))}
          </Card>

          <Card>
            <div className={CT}>Actions</div>
            <div className="bg-[#f5f4f0] rounded-[10px] px-3.5 py-3 mb-3">
              <div className="text-[11px] font-bold uppercase text-[#666] mb-2 tracking-wide">Locked Price (ex GST)</div>
              <div className="flex gap-2 items-center">
                <span className="text-[15px] text-[#666]">$</span>
                <input type="number" min={0} step="0.01" value={lockedPrice}
                  onChange={e => setLockedPrice(e.target.value === '' ? '' : parseFloat(e.target.value) || 0)}
                  placeholder="Enter final agreed price…"
                  className="flex-1 min-w-0 text-base font-bold text-[#2563eb] border-2 border-[#2563eb] rounded-lg px-2.5 py-2 bg-white focus:outline-none" />
                <Lock size={14} className="text-[#666]" />
              </div>
              {typeof lockedPrice === 'number' && lockedPrice > 0 && (
                <div className="text-[11px] text-[#666] mt-1.5">
                  {fmtCurrency(lockedPrice)} ex GST · {fmtCurrency(lockedPrice * 1.1)} inc GST
                  {subtotal > 0 && <> · {lockedPrice >= subtotal ? '+' : ''}{(((lockedPrice - subtotal) / subtotal) * 100).toFixed(1)}% vs calculated</>}
                </div>
              )}
            </div>
            <div className="flex gap-2 flex-wrap">
              <button onClick={exportQuote} className={BTN_P}><FileDown size={13} /> Export Quote</button>
              <button onClick={() => saveJob.mutate()} disabled={!client.trim() || saveJob.isPending}
                className={`${BTN_P} disabled:opacity-50`}>
                {saveJob.isPending ? <Loader2 size={13} className="animate-spin" /> : <Hammer size={13} />} Save as Job
              </button>
              <button onClick={saveDraft} className={BTN}><Save size={13} /> Save Draft</button>
              <button onClick={clearAll} className={BTN}><RefreshCw size={13} /> New</button>
            </div>
            {!client.trim() && <div className="text-[11px] text-[#666] mt-2">Enter a client name to save as a job.</div>}
          </Card>

          <Card>
            <div className={CT}>Pricing benchmarks</div>
            <table className="w-full text-xs">
              <tbody>
                {BENCHMARKS.map(([t, r]) => (
                  <tr key={t}>
                    <td className="px-2 py-1.5 border-b border-black/[0.06]">{t}</td>
                    <td className="px-2 py-1.5 border-b border-black/[0.06] font-semibold text-[#0a7c4e]">{r}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      </div>
    </div>
  )
}

// ── Print quote HTML — V16 _buildQuoteHTML() ─────────────────
function safePart(v: string) {
  return (v || '').replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')
}

function buildQuoteHTML(o: {
  client: string; address: string; jobType: string; biz: any
  estimate: string; subtotal: number; lockedPrice: number; substrateLines: string; days: number
}): string {
  const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const gstBase = o.lockedPrice > 0 ? o.lockedPrice : o.subtotal
  const gst2 = gstBase * 0.1
  const company = o.biz?.company_name || 'Northern Painters'
  const contactLine = [o.biz?.abn ? `ABN ${o.biz.abn}` : '', o.biz?.address || 'Byron Bay, NSW', o.biz?.email || '']
    .filter(Boolean).join(' · ')
  const date = new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })
  const title = ['Quote', safePart(o.client), safePart(o.address)].filter(Boolean).join('_')

  const lockedBanner = o.lockedPrice > 0 && o.lockedPrice !== o.subtotal
    ? `<div class="locked-banner"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#166534;margin-bottom:4px">🔒 Locked / Agreed Price</div><div style="font-size:20px;font-weight:800;color:#15803d">$${o.lockedPrice.toFixed(2)} <span style="font-size:12px;font-weight:600">ex GST</span> &nbsp;&nbsp; $${(o.lockedPrice * 1.1).toFixed(2)} <span style="font-size:12px;font-weight:600">inc GST</span></div></div>`
    : ''

  const scopeRows = o.substrateLines.split('\n').filter(Boolean).map(l => `<li>${esc(l)}</li>`).join('')

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${esc(title)}</title><style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,Helvetica,sans-serif;font-size:11.5px;color:#1a1a18;padding:28px 32px;max-width:860px;margin:0 auto}
h1{font-size:20px;font-weight:800;letter-spacing:-.5px}h2{font-size:13px;font-weight:700;margin:16px 0 6px}
table{width:100%;border-collapse:collapse;margin-bottom:12px}
th{background:#1a1a18;color:#fff;padding:6px 8px;text-align:left;font-size:11px}
td{padding:5px 8px;border-bottom:1px solid #e5e5e0;font-size:11px}
.total-row td{font-weight:700;background:#f5f4f0}.gst-row td{color:#555}
.grand-row td{background:#1a1a18;color:#fff;font-weight:800;font-size:13px}
.section{margin-bottom:18px}
.label{font-size:10px;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px}
.two-col{display:grid;grid-template-columns:1fr 1fr;gap:20px}
.locked-banner{background:#dcfce7;border:2px solid #16a34a;border-radius:8px;padding:12px 16px;margin-bottom:16px}
.est{white-space:pre-wrap;line-height:1.6;font-size:11px}
@media print{button{display:none!important}}
</style></head><body>
<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px;padding-bottom:16px;border-bottom:2px solid #1a1a18">
  <div><h1>${esc(company)}</h1><div style="font-size:10px;color:#888;margin-top:3px">${esc(contactLine)}</div></div>
  <div style="text-align:right">
    <div style="font-size:20px;font-weight:800;text-transform:uppercase;letter-spacing:1px">QUOTE</div>
    <div style="font-size:11px;color:#555">${date}</div>
  </div>
</div>
${lockedBanner}
<div class="two-col section">
  <div><div class="label">To</div><div style="font-weight:600">${esc(o.client)}</div></div>
  <div><div class="label">Project</div><div style="font-weight:600">${esc(o.jobType)}</div><div class="label" style="margin-top:6px">Site</div><div>${esc(o.address)}</div></div>
</div>
${o.days ? `<div class="section"><div class="label">Estimated Duration</div><div>${o.days.toFixed(1)} days</div></div>` : ''}
${scopeRows ? `<div class="section"><h2>Scope of Works</h2><ul style="padding-left:16px;line-height:1.8">${scopeRows}</ul></div>` : ''}
${o.estimate ? `<div class="section"><h2>Estimate Detail</h2><div class="est">${esc(o.estimate)}</div></div>` : ''}
<div class="section"><h2>Pricing</h2><table>
<tbody><tr><td>Painting services — as per scope</td><td style="text-align:right">$${gstBase.toFixed(2)}</td></tr></tbody>
<tfoot>
<tr class="total-row"><td>Subtotal ex GST</td><td style="text-align:right">$${gstBase.toFixed(2)}</td></tr>
<tr class="gst-row"><td>GST (10%)</td><td style="text-align:right">$${gst2.toFixed(2)}</td></tr>
<tr class="grand-row"><td>TOTAL inc GST</td><td style="text-align:right">$${(gstBase + gst2).toFixed(2)}</td></tr>
</tfoot></table></div>
${o.biz?.invoice_terms ? `<div class="section"><h2>Payment Terms</h2><p style="line-height:1.6">${esc(o.biz.invoice_terms)}</p></div>` : ''}
<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e5e0;font-size:10px;color:#888;text-align:center">${esc(company)} · ${esc(contactLine)} · This quote is valid for ${o.biz?.quote_valid_days || 30} days from the date of issue.</div>
<button onclick="window.print()" style="margin-top:16px;padding:10px 24px;background:#1a1a18;color:#fff;border:none;border-radius:6px;font-size:13px;cursor:pointer">Print / Save as PDF</button>
</body></html>`
}
