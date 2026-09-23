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
  PROD_RATES, JOB_TYPES, QUOTE_TERMS,
  PREP_OPTS, HEIGHT_OPTS, ACCESS_OPTS, METHOD_OPTS, CONS_PREP,
  JOB_WORKFLOWS, PREP_LEVELS, workflowStepNames, defaultPrepLevels,
  BENCHMARKS,
} from '@/lib/quoteData'
import {
  SUBSTRATES, emptySubstrates, normaliseSubstrates, substrateLines as buildSubLines,
  substrateTotals, newSubLine, type SubEntry,
} from '@/lib/substrates'
import SubstratePicker from '@/components/SubstratePicker'
import {
  Plus, Trash2, Loader2, Sparkles, Save, ClipboardList, Settings2,
  FileText, Image as ImageIcon, Ruler, Hammer, RefreshCw,
  FileDown, Lock, ArrowUp, ArrowDown, Check, CopyPlus, ListChecks, Download, Users, Info,
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

/** np = painters on this step. V16 defaults it to the crew size but lets each
 *  step differ, so a two-painter job can still have one painter on touch-ups. */
type Process = { id: string; name: string; hours: number; np: number }
type Room = { id: string; name: string; w: number; l: number; h: number }
type Equip = { id: string; name: string; cost: number }
type ExtraMat = { id: string; name: string; cost: number }
type Painter = { id: string; name: string; role: string; rate: number }
const PAINTER_ROLES = ['Standard', 'Lead', 'Subcontractor', 'Custom']
// V16 TIN_SIZES — the tin sizes the paint adjuster prices against
const TIN_SIZES = [1, 2, 4, 10, 15]
const TIN_LABEL: Record<number, string> = { 1: '1 L', 2: '2 L', 4: '4 L', 10: '10 L', 15: '15 L drum' }
type PaintRow = { id: string; product: string; litres: number; qty: Record<number, number>; price: Record<number, number> }

/** V16 suggestTins() — greedy fill from the largest tin down, then round up. */
function suggestTins(litres: number): Record<number, number> {
  const qty: Record<number, number> = {}
  TIN_SIZES.forEach(t => { qty[t] = 0 })
  if (litres <= 0) return qty
  let rem = litres
  ;[...TIN_SIZES].reverse().forEach(t => {
    const n = Math.floor(rem / t)
    if (n > 0) { qty[t] = n; rem = Math.round((rem - n * t) * 100) / 100 }
  })
  if (rem > 0.05) {
    const smallest = TIN_SIZES.find(t => t >= rem)
    if (smallest) qty[smallest] = (qty[smallest] || 0) + 1
  }
  return qty
}
// V16 phaseColors — one tint per workflow phase so the template reads as a sequence
const WF_COLORS = ['#e8f5e9', '#e3f2fd', '#fff8e1', '#fce4ec', '#f3e5f5', '#e0f7fa',
  '#fff3e0', '#e8eaf6', '#f1f8e9', '#fbe9e7', '#e0f2f1', '#e8f5e9']

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

  // Logged costs, so comparable jobs can show real cost and margin
  const { data: pastMaterials = [] } = useQuery({
    queryKey: ['np_materials', user?.id],
    queryFn: async () => {
      const { data } = await supabase.from('np_materials').select('job_id, cost_ex_gst').eq('user_id', user!.id)
      return (data ?? []) as any[]
    },
    enabled: !!user,
  })
  const { data: pastLabour = [] } = useQuery({
    queryKey: ['np_labour', user?.id],
    queryFn: async () => {
      const { data } = await supabase.from('np_labour').select('job_id, cost, hours, rate').eq('user_id', user!.id)
      return (data ?? []) as any[]
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
  const [substrates, setSubstrates] = useState<Record<string, SubEntry>>(emptySubstrates)

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
  // Prep level per workflow item, keyed "<phaseId>-<itemId>" as V16 keys its selects.
  const [prepLevels, setPrepLevels] = useState<Record<string, string>>(() => defaultPrepLevels(JOB_TYPES[0]))
  const [wfOpen, setWfOpen] = useState(false)

  // 5. Consumables & extra materials
  const [consPrep, setConsPrep] = useState('medium')
  const [consTotal, setConsTotal] = useState(0)
  const [consNotes, setConsNotes] = useState('')
  const [consBusy, setConsBusy] = useState(false)
  const [extraMats, setExtraMats] = useState<ExtraMat[]>([])

  // 6. Painters & logistics
  const [painters, setPainters] = useState<Painter[]>([
    { id: genId('p'), name: 'Painter 1', role: 'Standard', rate: rates.standard },
    { id: genId('p'), name: 'Painter 2', role: 'Standard', rate: rates.standard },
  ])
  const [travelKm, setTravelKm] = useState('')
  const [equip, setEquip] = useState<Equip[]>([])
  const [logisticsNotes, setLogisticsNotes] = useState('')

  // 7. Cost adjustments — V16 q-cost-adj / q-paint-adj / q-labour-adj.
  // These appear once an estimate exists and are what the quote is priced from.
  const [adjLab, setAdjLab] = useState(0)
  const [adjMat, setAdjMat] = useState(0)
  const [waste, setWaste] = useState(5)              // on materials
  const [contingency, setContingency] = useState(10) // on labour
  const [overheadPct, setOverheadPct] = useState(0)  // on subtotal
  const [bufDays, setBufDays] = useState(0)
  const [bufHrs, setBufHrs] = useState(0)
  const [travelCost, setTravelCost] = useState(0)
  const [paintRows, setPaintRows] = useState<PaintRow[]>([])
  const [laHpd, setLaHpd] = useState(rates.hpd)
  const [laPrep, setLaPrep] = useState(0)
  const [laTop, setLaTop] = useState(0)
  const [laBufD, setLaBufD] = useState(0)
  const [laBufH, setLaBufH] = useState(0)
  const [laRates, setLaRates] = useState<number[]>([])

  // Output
  const [estimate, setEstimate] = useState('')
  const [genBusy, setGenBusy] = useState(false)
  const [genErr, setGenErr] = useState('')
  const [lockedPrice, setLockedPrice] = useState<number | ''>('')
  const [showRates, setShowRates] = useState(false)
  const [quoteId, setQuoteId] = useState<string | null>(null)
  const [quoteNo, setQuoteNo] = useState('')

  // Reopen a saved quote
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('np_reopen_quote')
      if (!raw) return
      sessionStorage.removeItem('np_reopen_quote')
      const d = JSON.parse(raw)
      restoreState(d)
      setQuoteId(d._quoteId ?? null)
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Prefill from a site visit
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('np_prefill_quote')
      if (!raw) return
      sessionStorage.removeItem('np_prefill_quote')
      const p = JSON.parse(raw)
      if (p.client) setClient(p.client)
      if (p.address) setAddress(p.address)
      if (p.jobType && JOB_TYPES.includes(p.jobType)) {
        setJobType(p.jobType)
        setPrepLevels(defaultPrepLevels(p.jobType))
      }
      // The site visit's typed substrate lines come across whole
      if (p.substrateEntries) setSubstrates(normaliseSubstrates(p.substrateEntries))
      else if (p.substrates) setSubstrates(normaliseSubstrates(p.substrates))
      if (p.siteNotes) setSiteNotes(p.siteNotes)
      if (Array.isArray(p.areas) && p.areas.length) {
        // Only infer wall area when the visit did not tick substrates itself
        if (!p.substrateEntries && !p.substrates) {
          const walls = p.areas.reduce((s: number, a: any) => s + (a.sqm || 0), 0)
          if (walls > 0) setSubstrates(normaliseSubstrates({ walls: Math.round(walls) }))
        }
        if (!p.siteNotes) {
          setSiteNotes(p.areas.map((a: any) => `${a.area_name}: ${a.notes || ''}`)
            .filter((l: string) => l.trim().length > 2).join('\n'))
        }
        setRooms(p.areas.filter((a: any) => a.length || a.height).map((a: any) => ({
          id: genId('rm'), name: a.area_name ?? '', w: 0, l: a.length ?? 0, h: a.height ?? 2.4,
        })))
      }
    } catch {}
  }, [])

  const substrateLines = useMemo(() => buildSubLines(substrates).join('\n'), [substrates])
  const totals = useMemo(() => substrateTotals(substrates), [substrates])

  // V16 PROD_RATES baseline — a sanity figure next to the AI's hours
  const baselineHours = useMemo(
    () => Object.entries(totals).reduce((s, [key, q]) => s + q * (PROD_RATES[key] ?? 0), 0),
    [totals])

  const rateSum = painters.reduce((s, p) => s + (p.rate || 0), 0)
  // V16 calcProcessTotal: hours are elapsed crew time, so a step costs
  // hrs × the average painter rate × however many painters are on that step.
  const avgRate = painters.length ? rateSum / painters.length : rates.standard
  const stepCost = (p: Process) => (p.hours || 0) * avgRate * Math.max(1, p.np || painters.length)
  const totalHours = processes.reduce((s, p) => s + (p.hours || 0), 0)
  const labourCost = processes.reduce((s, p) => s + stepCost(p), 0)
  const days = rates.hpd > 0 ? totalHours / rates.hpd : 0
  const equipTotal = equip.reduce((s, e) => s + (e.cost || 0), 0)
  const extraMatTotal = extraMats.reduce((s, m) => s + (m.cost || 0), 0)

  // Materials priced from the paint product library against substrate quantities
  const materials = useMemo(() => {
    const products: Record<string, { product: string; size: string; litres: number; coverage: number; price: number }> = {}
    const lib: any[] = biz?.paint_products ?? []
    SUBSTRATES.forEach(sub => {
      const q = totals[sub.key] ?? 0
      if (q <= 0) return
      const first = sub.paint.toLowerCase().split(' ')[0]
      const hit = lib.find(p => (p.product ?? '').toLowerCase().includes(first))
      const coverage = hit?.coverage ?? 12
      // linear metres and counts convert to an approximate painted area
      const m2 = sub.unit === 'sqm' ? q : sub.unit === 'lm' ? q * 0.3 : q * 2
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
  }, [totals, coats, biz, extraMatTotal])

  const subtotal = labourCost + materials.total + consTotal + equipTotal
  const gst = subtotal * 0.1

  // ── V16 calcPaintTotal / calcLabourAdj / calcCostAdj ────────
  const rowTins = (r: PaintRow) => TIN_SIZES.reduce(
    (a, t) => ({ litres: a.litres + (r.qty[t] || 0) * t, cost: a.cost + (r.qty[t] || 0) * (r.price[t] || 0) }),
    { litres: 0, cost: 0 })
  const paintTotal = paintRows.reduce((s, r) => s + rowTins(r).cost, 0)

  const laTotalDays = laPrep + laTop + laBufD
  const laTotalHrs = laTotalDays * laHpd + laBufH
  // V16 sums the painter rates outright here (not the average it uses per step)
  const laRateSum = laRates.length ? laRates.reduce((s, r) => s + (r || 0), 0) : rateSum
  const laCost = laTotalHrs * laRateSum

  // V16 pushes each calculator's result into the cost-adjustment fields.
  // Only when non-zero, so opening a calculator never wipes a figure that the
  // process rows or the materials breakdown already supplied.
  useEffect(() => { if (paintTotal > 0) setAdjMat(paintTotal) }, [paintTotal])
  useEffect(() => { if (laTotalHrs > 0) setAdjLab(laCost) }, [laCost, laTotalHrs])

  const labAdj = adjLab * (1 + contingency / 100)
  const matAdj = (adjMat + consTotal) * (1 + waste / 100)
  const adjSub = labAdj + matAdj
  const adjTotalEx = adjSub * (1 + overheadPct / 100) + travelCost
  const adjGst = adjTotalEx * 0.1
  /** What the quote is actually priced at: the locked price, else the adjusted
   *  total once an estimate exists, else the plain running subtotal. */
  const quotePrice = typeof lockedPrice === 'number' && lockedPrice > 0 ? lockedPrice
    : estimate ? adjTotalEx : subtotal

  function addDocFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? [])
    if (picked.length) setDocs(d => [...d, ...picked.map(f => ({ file: f, measurements: '' }))])
    e.target.value = ''
  }

  /** Tick a substrate on and set its quantity, keeping any typed lines intact. */
  function applyQuantities(next: Record<string, number>) {
    setSubstrates(prev => {
      const out = { ...prev }
      Object.entries(next).forEach(([key, qty]) => {
        if (!(key in out) || !(qty > 0)) return
        const entry = out[key]
        const lines = entry.lines.length ? [...entry.lines] : [newSubLine()]
        lines[0] = { ...lines[0], qty }
        out[key] = { inc: true, lines }
      })
      return out
    })
  }

  async function runExtract() {
    if (!apiKey) { setGenErr('No API key set. Add your Anthropic API key in Settings.'); return }
    setExtracting(true); setGenErr('')
    try {
      const res = await extractQuantities(apiKey, docs, siteNotes)
      setExtractRes(res)
      const next: Record<string, number> = {}
      ;(['interior', 'exterior', 'specialty'] as const).forEach(sec => {
        const vals = (res as any)[sec] as Record<string, number> | undefined
        if (!vals) return
        Object.entries(vals).forEach(([k, v]) => { if (v > 0) next[k] = v })
      })
      applyQuantities(next)
    } catch (e: any) { setGenErr(e?.message ?? 'Extraction failed') } finally { setExtracting(false) }
  }

  function applyRooms() {
    const ceil = rooms.reduce((s, r) => s + r.w * r.l, 0)
    const wall = rooms.reduce((s, r) => s + 2 * (r.w + r.l) * (r.h || 2.4), 0)
    applyQuantities({ ceilings: Math.round(ceil), walls: Math.round(wall) })
  }

  const newStep = (name: string): Process => ({ id: genId('pr'), name, hours: 0, np: painters.length })

  /** V16 loadWorkflowSteps() — replaces the step list from the template. */
  function loadWorkflow() {
    const names = workflowStepNames(jobType, prepLevels)
    setProcesses((names.length ? names : workflowStepNames(JOB_TYPES[0], prepLevels)).map(newStep))
  }

  /** V16 onchange on the job type select: re-seed the prep levels and, for a new
   *  build, switch to spray. V16 also forced a 1-coat Acrylic undercoat on each
   *  substrate; this app has no per-substrate undercoat field, so that part of
   *  the preset lives in the workflow's own "Spray undercoat" phase instead. */
  function changeJobType(next: string) {
    setJobType(next)
    setPrepLevels(defaultPrepLevels(next))
    if (/new build/i.test(next)) setMethod('spray')
  }

  async function aiSuggestHours() {
    if (!apiKey) { setGenErr('No API key set. Add your Anthropic API key in Settings.'); return }
    let list = processes
    if (!list.length) {
      list = workflowStepNames(jobType, prepLevels).map(newStep)
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

  /** V16 findComparableJobs() — finished jobs of a related type, ranked by
   *  type match (60%) and substrate overlap (40%), with real cost and margin
   *  from what was actually logged against them. Top 5. */
  const compJobs = useMemo(() => {
    const norm = (t: string) => (t || '').toLowerCase().replace(/[^a-z0-9]/g, '')
    const typeNorm = norm(jobType)
    const groups = [
      ['interiorrepaint', 'interiorrepaint', 'fullrepaintinterior'],
      ['exteriorrepaint', 'exteriorrepaint', 'fullrepaintexterior'],
      ['newbuild', 'newbuildexterior', 'newbuildfull', 'newbuildinterior'],
      ['deck', 'timber', 'deckrefinish'],
      ['roof', 'roofpaint', 'roofcoating'],
      ['specialty', 'limewash', 'specialtyfinish'],
      ['fullrepaint', 'fullhouse'],
    ]
    const subKeys = Object.keys(totals)
    return jobs
      .filter(j => j.status === 'Finished' && (j.agreed_ex_gst || 0) > 0)
      .map(j => {
        const jt = norm(j.type || '')
        let typeScore = 0
        if (jt === typeNorm) typeScore = 1
        else for (const g of groups) {
          if (g.some(k => typeNorm.includes(k) || k === typeNorm) && g.some(k => jt.includes(k) || k === jt)) { typeScore = 0.75; break }
        }
        if (typeScore === 0) return null
        const jKeys: string[] = Array.isArray(j.extra?.substrate_keys) ? j.extra.substrate_keys
          : j.extra?.substrates ? Object.keys(j.extra.substrates) : []
        let subScore = 0, matchPct = 0
        if (subKeys.length && jKeys.length) {
          const overlap = subKeys.filter(k => jKeys.includes(k)).length
          const union = new Set([...subKeys, ...jKeys]).size
          subScore = overlap / union
          matchPct = Math.round(subScore * 100)
        }
        const matCost = pastMaterials.filter(m => m.job_id === j.id)
          .reduce((s, m) => s + (m.cost_ex_gst || 0), 0)
        const labCost = pastLabour.filter(l => l.job_id === j.id)
          .reduce((s, l) => s + (l.cost || (l.hours || 0) * (l.rate || 0)), 0)
        const realCost = matCost + labCost
        const margin = j.agreed_ex_gst > 0 ? ((j.agreed_ex_gst - realCost) / j.agreed_ex_gst) * 100 : null
        return { job: j, score: typeScore * 0.6 + subScore * 0.4, matchPct, realCost, margin }
      })
      .filter(Boolean)
      .sort((a, b) => b!.score - a!.score)
      .slice(0, 5) as { job: Row; score: number; matchPct: number; realCost: number; margin: number | null }[]
  }, [jobs, jobType, totals, pastMaterials, pastLabour])

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
        labourBreakdown: processes.map(p =>
          `${p.name}: ${p.hours.toFixed(1)} hrs × ${Math.max(1, p.np || painters.length)} painter(s) ($${Math.round(stepCost(p))})`).join('\n'),
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
      // V16 seeds the adjustment panels from the estimate it just built.
      setAdjLab(labourCost)
      setAdjMat(materials.total)
      setLaHpd(rates.hpd)
      setLaRates(painters.map(p => p.rate))
      setPaintRows(materials.rows.length
        ? materials.rows.map(r => newPaintRow(r.product, r.litres))
        : [newPaintRow('', 0)])
    } catch (e: any) { setGenErr(e?.message ?? 'Quote generation failed') } finally { setGenBusy(false) }
  }

  /** V16 addPaintRow() — tins suggested from the litres, prices pro-rata from
   *  the trade price in the paint library. */
  function newPaintRow(product: string, litres: number): PaintRow {
    const hit = (biz?.paint_products ?? []).find((p: any) =>
      (p.product ?? '').toLowerCase() === product.toLowerCase())
    const perLitre = hit ? (hit.yours || 0) / (parseFloat(hit.size) || 4) : 0
    const price: Record<number, number> = {}
    TIN_SIZES.forEach(t => { price[t] = perLitre ? Math.round(perLitre * t * 100) / 100 : 0 })
    return { id: genId('pt'), product, litres, qty: suggestTins(litres), price }
  }

  const patchPaint = (id: string, patch: Partial<PaintRow>) =>
    setPaintRows(rs => rs.map(r => r.id === id ? { ...r, ...patch } : r))

  // V16 saveQJob — the quote becomes the job, no job needed up front
  const saveJob = useMutation({
    mutationFn: async () => {
      const id = nextJobId(jobs.map(j => j.id))
      const agreed = quotePrice
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
        quote_no: quoteNo || null,
        // substrate_keys lets a future quote score substrate overlap against this job
        extra: { quote_estimate: estimate, substrates, substrate_keys: Object.keys(totals), processes, painters, quote_id: quoteId },
        created_at: new Date().toISOString(),
      })
      if (error) throw error
      return id
    },
    onSuccess: async id => {
      qc.invalidateQueries({ queryKey: ['np_jobs'] })
      // Mark the saved quote as converted so the archive shows where it went
      if (quoteId) {
        await (supabase.from('np_quotes') as any)
          .update({ job_id: id, status: 'Converted', updated_at: new Date().toISOString() })
          .eq('id', quoteId)
        qc.invalidateQueries({ queryKey: ['np_quotes'] })
      }
      if (confirm(`Saved as job ${id}. Open the Jobs page?`)) nav('/jobs')
    },
    onError: (e: any) => alert('Save failed: ' + e.message),
  })

  // Everything needed to rebuild this quote exactly
  function captureState() {
    return {
      client, address, jobType, terms, substrates, prep, ceilingHeight, access,
      method, coats, processes, prepLevels, consPrep, consTotal, consNotes, extraMats,
      painters, travelKm, equip, siteNotes, logisticsNotes, estimate, lockedPrice, rooms,
      adjLab, adjMat, waste, contingency, overheadPct, bufDays, bufHrs, travelCost,
      paintRows, laHpd, laPrep, laTop, laBufD, laBufH, laRates,
    }
  }

  function restoreState(d: Row) {
    setClient(d.client ?? ''); setAddress(d.address ?? ''); setJobType(d.jobType ?? JOB_TYPES[0])
    setTerms(d.terms ?? QUOTE_TERMS[0])
    setSubstrates(normaliseSubstrates(d.substrates ?? d.qty))
    setPrep(d.prep ?? PREP_OPTS[1]); setCeilingHeight(d.ceilingHeight ?? HEIGHT_OPTS[0]); setAccess(d.access ?? ACCESS_OPTS[0])
    setMethod(d.method ?? 'roll'); setCoats(d.coats ?? '2'); setProcesses(d.processes ?? [])
    // Drafts saved before per-item prep levels existed fall back to the type's defaults.
    setPrepLevels(d.prepLevels ?? defaultPrepLevels(d.jobType ?? JOB_TYPES[0]))
    setConsPrep(d.consPrep ?? 'medium'); setConsTotal(d.consTotal ?? 0); setConsNotes(d.consNotes ?? '')
    setExtraMats(d.extraMats ?? []); if (d.painters?.length) setPainters(d.painters)
    setTravelKm(d.travelKm ?? ''); setEquip(d.equip ?? []); setSiteNotes(d.siteNotes ?? '')
    setLogisticsNotes(d.logisticsNotes ?? ''); setEstimate(d.estimate ?? '')
    setLockedPrice(d.lockedPrice ?? ''); setRooms(d.rooms ?? [])
    setAdjLab(d.adjLab ?? 0); setAdjMat(d.adjMat ?? 0)
    setWaste(d.waste ?? 5); setContingency(d.contingency ?? 10); setOverheadPct(d.overheadPct ?? 0)
    setBufDays(d.bufDays ?? 0); setBufHrs(d.bufHrs ?? 0); setTravelCost(d.travelCost ?? 0)
    setPaintRows(d.paintRows ?? [])
    setLaHpd(d.laHpd ?? rates.hpd); setLaPrep(d.laPrep ?? 0); setLaTop(d.laTop ?? 0)
    setLaBufD(d.laBufD ?? 0); setLaBufH(d.laBufH ?? 0); setLaRates(d.laRates ?? [])
  }

  // ── Lock & Save — the permanent record, not a draft ──────
  const lockAndSave = useMutation({
    mutationFn: async () => {
      const price = quotePrice
      const row = {
        id: quoteId ?? genId('QT-'),
        user_id: user!.id,
        quote_no: quoteNo || null,
        client, address, job_type: jobType, terms,
        status: typeof lockedPrice === 'number' && lockedPrice > 0 ? 'Locked' : 'Draft',
        locked_price: typeof lockedPrice === 'number' && lockedPrice > 0 ? lockedPrice : null,
        quote_ex_gst: Math.round(subtotal),
        labour_cost: Math.round(labourCost),
        materials_cost: Math.round(materials.total),
        consumables: Math.round(consTotal),
        equipment: Math.round(equipTotal),
        total_hours: Number(totalHours.toFixed(2)),
        est_days: Number(days.toFixed(2)),
        estimate_text: estimate || null,
        state: captureState(),
        locked_at: typeof lockedPrice === 'number' && lockedPrice > 0 ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      }
      const { error } = await (supabase.from('np_quotes') as any).upsert(row)
      if (error) throw error
      return row.id
    },
    onSuccess: id => {
      setQuoteId(id)
      qc.invalidateQueries({ queryKey: ['np_quotes'] })
      if (confirm('Quote saved. Open Saved Quotes?')) nav('/quotes')
    },
    onError: (e: any) => alert(
      e.message?.includes('np_quotes')
        ? 'The quotes table does not exist yet — open Saved Quotes for the one-time SQL to run.'
        : 'Save failed: ' + e.message,
    ),
  })

  function saveDraft() {
    const draft = { id: genId('qd'), savedAt: new Date().toISOString(), ...captureState() }
    const next = [draft, ...drafts.filter(d => d.client !== client || d.jobType !== jobType)].slice(0, 20)
    saveDrafts.mutate(next)
  }

  const loadDraft = restoreState

  function clearAll() {
    if (!confirm('Start a new quote? Unsaved changes will be lost.')) return
    setClient(''); setAddress(''); setSubstrates(emptySubstrates()); setProcesses([])
    setPrepLevels(defaultPrepLevels(jobType))
    setConsTotal(0); setConsNotes(''); setExtraMats([]); setEquip([]); setRooms([])
    setSiteNotes(''); setLogisticsNotes(''); setEstimate(''); setLockedPrice(''); setDocs([]); setExtractRes(null)
    setAdjLab(0); setAdjMat(0); setWaste(5); setContingency(10); setOverheadPct(0)
    setBufDays(0); setBufHrs(0); setTravelCost(0); setPaintRows([])
    setLaHpd(rates.hpd); setLaPrep(0); setLaTop(0); setLaBufD(0); setLaBufH(0); setLaRates([])
    setQuoteId(null); setQuoteNo('')
  }

  function exportQuote() {
    const w = window.open('', '_blank')
    if (!w) return
    const price = quotePrice
    // V16 getCoatRows(): the system is the finish, the coats the top-coat count,
    // and exterior substrates are suffixed "(ext)". This app has no per-substrate
    // undercoat field, so no "N + M" coats string arises.
    const coatRows = SUBSTRATES.filter(s => (totals[s.key] ?? 0) > 0).map(s => ({
      sub: s.group === 'Exterior' ? `${s.label} (ext)` : s.label,
      sys: s.defFinish,
      coats: coats,
      app: s.defMethod,
      mat: s.paint,
    }))

    w.document.write(buildQuoteHTML({
      docType: terms === 'Estimate' ? 'Estimate' : 'Quotation',
      to: client, proj: jobType, site: address,
      qno: quoteNo || defaultQuoteNo(),
      dur: days ? `${days.toFixed(1)} days` : '',
      // The client-facing document carries the standard wording, not the internal
      // AI estimate or the measured takeoff -- exactly as V16's export defaults do.
      coatRows,
      lines: [{ desc: `${jobType} (labour & materials)`, total: price }],
      origin: window.location.origin,
    }))
    w.document.close()
    setTimeout(() => w.print(), 500)
  }

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

      <div className="grid gap-3.5 items-start grid-cols-1 lg:grid-cols-2">
        {/* LEFT */}
        <div>
          <Card>
            <div className={CT}>1. Job Details</div>
            <div className="flex flex-col gap-2.5">
              <Field label="Client"><input value={client} onChange={e => setClient(e.target.value)} placeholder="e.g. Jenny and Garry" className={INP} /></Field>
              <Field label="Address"><input value={address} onChange={e => setAddress(e.target.value)} placeholder="e.g. Goonellabah, Northern Rivers" className={INP} /></Field>
              <Field label="Job type">
                <select value={jobType} onChange={e => changeJobType(e.target.value)} className={INP}>
                  {JOB_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
              <Field label="Quote no. (optional)">
                <input value={quoteNo} onChange={e => setQuoteNo(e.target.value)} placeholder="e.g. Q-1042" className={INP} />
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

          <Card>
            <div className={CT}>2. Substrates</div>
            <div className="text-[11px] text-[#666] mb-2.5">
              Tick what's in scope, then add a line per type — pick a preset or enter your own,
              so French, solid and panel doors can be priced separately. This is the same list the
              site visit uses, so a visit's takeoff lands here unchanged.
            </div>
            <SubstratePicker value={substrates} onChange={setSubstrates} />
            {Object.keys(totals).length > 0 && (
              <div className="mt-3 pt-2.5 border-t border-black/[0.12] text-[11px] text-[#666]">
                {Object.keys(totals).length} substrate{Object.keys(totals).length !== 1 ? 's' : ''} in scope ·
                {' '}{buildSubLines(substrates).length} priced line{buildSubLines(substrates).length !== 1 ? 's' : ''}
              </div>
            )}
          </Card>

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
                <button onClick={() => setProcesses(p => [...p, newStep('')])} className={BTN}><Plus size={12} /></button>
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

            {/* V16 wf-panel — the template for this job type, prep levels first */}
            {JOB_WORKFLOWS[jobType] && (
              <div className="border border-black/10 rounded-lg overflow-hidden mb-2.5">
                <button onClick={() => setWfOpen(o => !o)}
                  className="w-full flex items-center justify-between px-3 py-2 bg-[#f5f4f0] text-left">
                  <span className="text-xs font-bold text-[#2563eb] flex items-center gap-1.5">
                    <ListChecks size={13} /> Workflow Template — {jobType}
                  </span>
                  <span className="text-[11px] text-[#666]">{wfOpen ? '▴ Hide' : '▾ Show'}</span>
                </button>
                {wfOpen && (
                  <div className="px-3 py-2.5">
                    {JOB_WORKFLOWS[jobType].phases.filter(p => p.isPrep).map(ph => (
                      <div key={ph.id} className="mb-2">
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <span className="text-[10px] font-bold uppercase text-[#b45309] bg-[#fef3c7] rounded px-1.5 py-0.5">1. {ph.name}</span>
                          <span className="text-[10px] text-[#666]">— set level per item</span>
                        </div>
                        <div className="flex flex-col gap-1">
                          {ph.items?.map(item => (
                            <div key={item.id} className="flex items-center gap-2 px-1.5 py-1 bg-[#fffbeb] rounded">
                              <select
                                value={prepLevels[`${ph.id}-${item.id}`] ?? item.def}
                                onChange={e => setPrepLevels(l => ({ ...l, [`${ph.id}-${item.id}`]: e.target.value }))}
                                className="text-[11px] px-1.5 py-0.5 border border-[#fbbf24] rounded bg-white min-w-[80px] focus:outline-none">
                                {PREP_LEVELS.map(l => <option key={l}>{l}</option>)}
                              </select>
                              <span className="text-xs">{item.label}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                    <div className="flex flex-col gap-0.5">
                      {JOB_WORKFLOWS[jobType].phases.filter(p => !p.isPrep).map((ph, i) => (
                        <div key={ph.id} className="flex items-center gap-1.5 px-2 py-1 rounded"
                          style={{ background: WF_COLORS[i % WF_COLORS.length] }}>
                          <span className="text-[11px] font-bold text-[#666] min-w-[18px]">{i + 2}.</span>
                          <span className="text-xs">{ph.name}</span>
                        </div>
                      ))}
                    </div>
                    <button onClick={loadWorkflow} className={`${BTN_P} w-full justify-center mt-2.5`}>
                      <Download size={13} /> Load Process Steps
                    </button>
                  </div>
                )}
              </div>
            )}

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
                    <div className="flex items-center gap-1 shrink-0" title="Painters on this step">
                      <Users size={12} className="text-[#666]" />
                      <input type="number" min={1} step={1} value={p.np || painters.length}
                        onChange={e => setProcesses(x => x.map(y => y.id === p.id ? { ...y, np: Math.max(1, parseInt(e.target.value) || 1) } : y))}
                        className="w-10 px-1 py-1.5 text-center text-xs bg-white border border-black/20 rounded-lg focus:outline-none" />
                    </div>
                    <input type="number" step="0.5" min={0}
                      value={procUnit === 'days' ? (p.hours ? (p.hours / rates.hpd).toFixed(2).replace(/\.?0+$/, '') : '') : (p.hours || '')}
                      onChange={e => {
                        const v = parseFloat(e.target.value) || 0
                        setProcesses(x => x.map(y => y.id === p.id ? { ...y, hours: procUnit === 'days' ? v * rates.hpd : v } : y))
                      }}
                      className="w-16 px-1.5 py-1.5 text-right font-mono text-xs bg-white border border-black/20 rounded-lg focus:outline-none" />
                    <span className="text-[10px] text-[#999] w-7">{procUnit}</span>
                    <span className="text-[11px] font-semibold text-[#2563eb] w-16 text-right">
                      {p.hours > 0 ? fmtCurrency(stepCost(p)) : '—'}</span>
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
                        ? [...p, ...Array.from({ length: n - p.length }, (_, i) => ({ id: genId('p'), name: `Painter ${p.length + i + 1}`, role: 'Standard', rate: rates.standard }))]
                        : p.slice(0, n))
                    }}
                    className="w-16 px-2 py-1.5 text-[13px] bg-white border border-black/20 rounded-lg focus:outline-none" />
                  <span className="text-xs text-[#666]">painters · combined ${rateSum}/hr</span>
                </div>
                {painters.map(p => (
                  <div key={p.id} className="flex items-center gap-2 mb-1.5 flex-wrap">
                    <input value={p.name} onChange={e => setPainters(x => x.map(y => y.id === p.id ? { ...y, name: e.target.value } : y))}
                      className="flex-1 min-w-[90px] px-2 py-1.5 text-xs bg-white border border-black/20 rounded-lg focus:outline-none" />
                    {/* V16: picking a role refills the rate from your settings; Custom leaves it alone */}
                    <select value={p.role ?? 'Standard'}
                      onChange={e => setPainters(x => x.map(y => {
                        if (y.id !== p.id) return y
                        const role = e.target.value
                        const rate = role === 'Lead' ? rates.lead
                          : role === 'Subcontractor' ? rates.sub
                          : role === 'Standard' ? rates.standard : y.rate
                        return { ...y, role, rate }
                      }))}
                      className="px-2 py-1.5 text-xs bg-white border border-black/20 rounded-lg focus:outline-none">
                      {PAINTER_ROLES.map(r => <option key={r}>{r}</option>)}
                    </select>
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

          {estimate && (
            <>
              <Card>
                <div className={CT}>Cost Adjustments</div>
                <div className="text-xs text-[#666] mb-3">
                  Base costs come from the estimate above. Adjustments apply live and set the quoted price.
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 mb-3">
                  {([
                    ['Labour ex GST ($)', adjLab, setAdjLab, ''],
                    ['Materials ex GST ($)', adjMat, setAdjMat, ''],
                    ['Waste %', waste, setWaste, 'on materials'],
                    ['Contingency %', contingency, setContingency, 'on labour'],
                    ['Overhead %', overheadPct, setOverheadPct, 'on subtotal'],
                    ['Buffer days', bufDays, setBufDays, ''],
                    ['Buffer hours', bufHrs, setBufHrs, ''],
                    ['Travel expenses ($)', travelCost, setTravelCost, 'ex GST'],
                  ] as [string, number, (n: number) => void, string][]).map(([label, val, set, hint]) => (
                    <div key={label}>
                      <label className="block text-[10px] uppercase font-bold text-[#666] mb-1">
                        {label} {hint && <span className="font-normal normal-case">({hint})</span>}
                      </label>
                      <input type="number" min={0} value={val || ''} placeholder="0"
                        onChange={e => set(parseFloat(e.target.value) || 0)} className={INP} />
                    </div>
                  ))}
                </div>
                <div className="bg-[#f5f4f0] rounded-lg px-3.5 py-3">
                  <div className="grid grid-cols-3 gap-2.5">
                    {([['Labour (adj)', labAdj], ['Materials+cons (adj)', matAdj],
                       ['Overhead', adjSub * (overheadPct / 100)]] as [string, number][]).map(([l, v]) => (
                      <div key={l}>
                        <div className="text-[10px] text-[#666] font-semibold uppercase mb-0.5">{l}</div>
                        <div className="text-[15px] font-bold">{fmtCurrency(v)}</div>
                      </div>
                    ))}
                  </div>
                  {consTotal > 0 && (
                    <div className="flex justify-between items-center py-1 mt-2 border-t border-black/[0.06]">
                      <span className="text-[10px] text-[#666] font-semibold uppercase">↳ Consumables (incl. in materials)</span>
                      <span className="text-xs text-[#666]">{fmtCurrency(consTotal)}</span>
                    </div>
                  )}
                  {travelCost > 0 && (
                    <div className="flex justify-between items-center py-1 border-t border-black/[0.06]">
                      <span className="text-[10px] text-[#666] font-semibold uppercase">Travel expenses</span>
                      <span className="text-sm font-bold">{fmtCurrency(travelCost)}</span>
                    </div>
                  )}
                  <div className="grid grid-cols-3 gap-2.5 mt-2">
                    {([['Total ex GST', adjTotalEx, true], ['GST (10%)', adjGst, false],
                       ['Total inc GST', adjTotalEx + adjGst, false]] as [string, number, boolean][]).map(([l, v, hl]) => (
                      <div key={l}>
                        <div className="text-[10px] text-[#666] font-semibold uppercase mb-0.5">{l}</div>
                        <div className="text-base font-bold" style={hl ? { color: '#2563eb' } : undefined}>{fmtCurrency(v)}</div>
                      </div>
                    ))}
                  </div>
                  {(bufDays > 0 || bufHrs > 0) && (
                    <div className="text-xs text-[#666] border-t border-black/[0.08] pt-1.5 mt-1.5">
                      Buffer: {bufDays > 0 && `${bufDays} day${bufDays !== 1 ? 's' : ''} `}
                      {bufHrs > 0 && `${bufHrs} hr${bufHrs !== 1 ? 's' : ''}`} added to schedule
                    </div>
                  )}
                </div>
              </Card>

              <Card>
                <div className="flex justify-between items-center mb-2.5">
                  <div className={`${CT} m-0`}>Paint Quantity Adjuster</div>
                  <button onClick={() => setPaintRows(r => [...r, newPaintRow('', 0)])} className={BTN}>
                    <Plus size={12} /> Add product
                  </button>
                </div>
                <div className="text-[11px] text-[#666] mb-2.5">
                  Enter litres needed per product. Choose tin sizes, set prices — materials cost recalculates live.
                </div>
                {paintRows.map(r => {
                  const t = rowTins(r)
                  return (
                    <div key={r.id} className="border border-black/10 rounded-lg px-3 py-2.5 mb-2">
                      <div className="flex gap-2 items-center mb-2 flex-wrap">
                        <input value={r.product} placeholder="Product name (e.g. Wash and Wear Low Sheen)"
                          onChange={e => patchPaint(r.id, { product: e.target.value })}
                          className="flex-1 min-w-[180px] px-2 py-1.5 text-xs bg-white border border-black/20 rounded-lg focus:outline-none" />
                        <div className="flex items-center gap-1">
                          <input type="number" min={0} step="0.5" value={r.litres || ''}
                            onChange={e => {
                              const l = parseFloat(e.target.value) || 0
                              patchPaint(r.id, { litres: l, qty: suggestTins(l) })
                            }}
                            className="w-16 px-1.5 py-1.5 text-center text-xs bg-white border border-black/20 rounded-lg focus:outline-none" />
                          <span className="text-[11px] text-[#666]">L needed</span>
                        </div>
                        <button onClick={() => patchPaint(r.id, { qty: suggestTins(r.litres) })} className={BTN} title="Auto-suggest tins">
                          <Sparkles size={11} /> Suggest tins
                        </button>
                        <button onClick={() => setPaintRows(x => x.filter(y => y.id !== r.id))} className="text-[#c0392b]"><Trash2 size={12} /></button>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs border-collapse min-w-[420px]">
                          <thead>
                            <tr className="bg-[#f5f4f0]">
                              {TIN_SIZES.map(s => <th key={s} className="px-2 py-1.5 text-center font-semibold">{TIN_LABEL[s]}</th>)}
                              <th className="px-2 py-1.5 text-right font-semibold">Total L</th>
                              <th className="px-2 py-1.5 text-right font-semibold">Cost ex GST</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
                              {TIN_SIZES.map(s => (
                                <td key={s} className="px-1 py-1.5 text-center">
                                  <div className="flex flex-col gap-1 items-center">
                                    <input type="number" min={0} value={r.qty[s] || 0}
                                      onChange={e => patchPaint(r.id, { qty: { ...r.qty, [s]: parseInt(e.target.value) || 0 } })}
                                      className="w-11 px-1 py-1 text-center text-xs bg-white border border-black/20 rounded focus:outline-none" />
                                    <input type="number" min={0} step="0.01" value={r.price[s] || ''} placeholder="$"
                                      onChange={e => patchPaint(r.id, { price: { ...r.price, [s]: parseFloat(e.target.value) || 0 } })}
                                      className="w-14 px-1 py-1 text-center text-[11px] text-[#666] bg-white border border-black/20 rounded focus:outline-none" />
                                  </div>
                                </td>
                              ))}
                              <td className="px-2 py-1.5 text-right font-semibold whitespace-nowrap">{t.litres.toFixed(1)} L</td>
                              <td className="px-2 py-1.5 text-right font-bold text-[#2563eb]">{fmtCurrency(t.cost)}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )
                })}
                {paintRows.length > 0 && (
                  <div className="flex justify-between items-center mt-2.5 px-3 py-2.5 bg-[#f5f4f0] rounded-lg">
                    <span className="text-xs text-[#666]">Total materials ex GST</span>
                    <span className="font-bold text-base text-[#2563eb]">{fmtCurrency(paintTotal)}</span>
                  </div>
                )}
              </Card>

              <Card>
                <div className={CT}>Labour Calculator</div>
                <div className="text-[11px] text-[#666] mb-2.5">
                  Break down labour days by phase. Rates auto-fill from your painters above.
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-2.5 mb-2.5">
                  {([['Hrs per day', laHpd, setLaHpd], ['Days — Prep', laPrep, setLaPrep],
                     ['Days — Top coats', laTop, setLaTop], ['Buffer days', laBufD, setLaBufD],
                     ['Buffer hours', laBufH, setLaBufH]] as [string, number, (n: number) => void][]).map(([l, v, set]) => (
                    <div key={l}>
                      <label className="block text-[10px] uppercase font-bold text-[#666] mb-1">{l}</label>
                      <input type="number" min={0} step="0.5" value={v || ''} placeholder="0"
                        onChange={e => set(parseFloat(e.target.value) || 0)} className={INP} />
                    </div>
                  ))}
                </div>
                <div className="mb-2.5">
                  {painters.map((p, i) => (
                    <div key={p.id} className="flex items-center gap-2 mb-1.5 text-xs">
                      <span className="w-24 text-[#666] truncate">{p.name || `Painter ${i + 1}`}</span>
                      <span className="text-[#666]">$</span>
                      <input type="number" min={0} value={laRates[i] ?? p.rate}
                        onChange={e => setLaRates(r => {
                          const n = painters.map((q, j) => r[j] ?? q.rate)
                          n[i] = parseFloat(e.target.value) || 0
                          return n
                        })}
                        className="w-16 px-1.5 py-1 text-xs bg-white border border-black/20 rounded-lg focus:outline-none" />
                      <span className="text-[10px] text-[#999]">/hr</span>
                    </div>
                  ))}
                </div>
                <div className="bg-[#f5f4f0] rounded-lg px-3 py-2.5">
                  <div className="grid grid-cols-3 gap-2">
                    {([['Total days', (laPrep + laTop).toFixed(1)],
                       ['Buffer', laBufD > 0 || laBufH > 0 ? `${laBufD > 0 ? laBufD + 'd ' : ''}${laBufH > 0 ? laBufH + 'h' : ''}` : '—'],
                       ['Total hours', laTotalHrs.toFixed(1)]] as [string, string][]).map(([l, v]) => (
                      <div key={l}>
                        <div className="text-[10px] text-[#666] font-semibold uppercase mb-0.5">{l}</div>
                        <div className="text-[15px] font-bold">{v}</div>
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-between items-center pt-2 mt-2 border-t border-black/[0.08]">
                    <span className="text-xs text-[#666]">Labour cost ex GST</span>
                    <span className="text-lg font-bold text-[#2563eb]">{fmtCurrency(laCost)}</span>
                  </div>
                </div>
              </Card>

              {compJobs.length > 0 && (
                <Card>
                  <div className={CT}>Comparable Past Jobs</div>
                  <div className="text-xs text-[#666] mb-2.5">
                    Found {compJobs.length} comparable finished job{compJobs.length !== 1 ? 's' : ''} — sorted by
                    relevance. Margins calculated from logged materials &amp; labour.
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="bg-[#f5f4f0]">
                          <th className="px-2 py-1.5 text-left font-semibold">Job</th>
                          <th className="px-2 py-1.5 text-right font-semibold">Agreed</th>
                          <th className="px-2 py-1.5 text-right font-semibold">Real Cost</th>
                          <th className="px-2 py-1.5 text-right font-semibold">Margin</th>
                          <th className="px-2 py-1.5 text-center font-semibold">Sub Match</th>
                        </tr>
                      </thead>
                      <tbody>
                        {compJobs.map(c => (
                          <tr key={c.job.id} className="border-b border-black/[0.06]">
                            <td className="px-2 py-1.5">
                              <div className="font-medium">{c.job.client || '—'}</div>
                              <div className="text-[10px] text-[#666]">
                                {c.job.type || ''} · {(c.job.address || '').split(',')[0]}
                              </div>
                            </td>
                            <td className="px-2 py-1.5 text-right font-semibold">{fmtCurrency(c.job.agreed_ex_gst)}</td>
                            <td className="px-2 py-1.5 text-right text-[#666]">{c.realCost > 0 ? fmtCurrency(c.realCost) : '—'}</td>
                            <td className="px-2 py-1.5 text-right font-semibold"
                              style={{ color: c.margin === null ? '#666' : c.margin >= 30 ? '#27ae60' : c.margin >= 15 ? '#e67e22' : '#c0392b' }}>
                              {c.margin !== null ? `${c.margin.toFixed(1)}%` : '—'}
                            </td>
                            <td className="px-2 py-1.5 text-center">
                              <span className="text-[10px] bg-[#2563eb]/[0.13] text-[#2563eb] rounded-full px-1.5 py-0.5 font-semibold">
                                {c.matchPct > 0 ? `${c.matchPct}%` : 'type only'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {compJobs.some(c => c.realCost === 0) && (
                    <div className="text-[11px] text-[#666] mt-2 pt-1.5 border-t border-black/[0.06] flex items-center gap-1">
                      <Info size={11} /> Log materials &amp; labour against a job to see real cost and margin.
                    </div>
                  )}
                </Card>
              )}
            </>
          )}

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
                  {adjTotalEx > 0 && <> · {lockedPrice >= adjTotalEx ? '+' : ''}{(((lockedPrice - adjTotalEx) / adjTotalEx) * 100).toFixed(1)}% vs calculated</>}
                </div>
              )}
            </div>
            <div className="flex gap-2 flex-wrap">
              <button onClick={() => lockAndSave.mutate()} disabled={!client.trim() || lockAndSave.isPending}
                className={`${BTN_P} disabled:opacity-50`}>
                {lockAndSave.isPending ? <Loader2 size={13} className="animate-spin" /> : <Lock size={13} />}
                {quoteId ? 'Update saved quote' : 'Lock & Save'}
              </button>
              <button onClick={exportQuote} className={BTN_P}><FileDown size={13} /> Export Quote</button>
              <button onClick={() => saveJob.mutate()} disabled={!client.trim() || saveJob.isPending}
                className={`${BTN_P} disabled:opacity-50`}>
                {saveJob.isPending ? <Loader2 size={13} className="animate-spin" /> : <Hammer size={13} />} Save as Job
              </button>
              <button onClick={saveDraft} className={BTN}><Save size={13} /> Save Draft</button>
              <button onClick={clearAll} className={BTN}><RefreshCw size={13} /> New</button>
            </div>
            <div className="text-[11px] text-[#666] mt-2">
              {!client.trim()
                ? 'Enter a client name to save this quote.'
                : <>Lock &amp; Save keeps this quote permanently in <button onClick={() => nav('/quotes')} className="text-[#2563eb] underline">Saved Quotes</button> — reviewable and re-openable later. Drafts are a scratchpad and get replaced.</>}
            </div>
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
/** V16 doExportQuote() — the full quotation document, section for section.
 *  The body stays contenteditable as in V16 so the doc can be tweaked before
 *  printing. Letterhead images come from /public, the convention Invoices.tsx
 *  already uses, rather than V16's inline base64. */
/** V16 nextQuoteNo() — DDMMYY. */
function defaultQuoteNo(): string {
  const d = new Date()
  return String(d.getDate()).padStart(2, '0') + String(d.getMonth() + 1).padStart(2, '0')
    + String(d.getFullYear()).slice(-2)
}

// The standard wording V16 pre-fills its export dialog with. These are what the
// client actually reads, so they stay fixed rather than carrying internal detail.
const QUOTE_INCLUSIONS = [
  'All surface preparation as described',
  'Supply and application of all specified paint systems',
  'Masking and protection of adjacent areas',
  'Full site clean-up and removal of waste',
]
const QUOTE_EXCLUSIONS = [
  'Supply or installation of scaffolding',
  'Repairs to defective substrates beyond standard preparation',
  'Repainting required due to damage by other trades after completion',
  'Changes to colours or finishes beyond the approved schedule',
]
const QUOTE_TERMS_TEXT =
  'Progress claims will be required for the duration of works. The schedule and '
  + 'milestone breakdown are to be agreed with the client prior to commencement. '
  + 'A deposit may be required to secure the booking and purchase materials.'

function buildQuoteHTML(o: {
  docType: string; to: string; proj: string; site: string
  qno: string; dur: string
  coatRows: { sub: string; sys: string; coats: string; app: string; mat: string }[]
  lines: { desc: string; total: number }[]
  origin: string
}): string {
  const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const money = (n: number) => '$' + n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const date = new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })
  const fileTitle = [o.docType, o.qno, `${o.site} ${o.proj}`.trim()].filter(Boolean)
    .join('_').replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')

  const exGST = o.lines.reduce((s, l) => s + l.total, 0)
  const bullets = (items: string[]) => items.map(x => `<li>${esc(x)}</li>`).join('')
  const scope = `This quotation covers the supply and application of all specified coating `
    + `systems to ${o.site}. Works include surface preparation, priming where required, and `
    + `application of finish coats to all nominated substrates, in accordance with the `
    + `finishes schedule and AS/NZS 2311:2017.`

  // V16 falls back to a worked example when no substrates are quoted yet.
  const coatBody = o.coatRows.length
    ? o.coatRows.map(r => `<tr><td>${esc(r.sub)}</td><td>${esc(r.sys)}</td><td style="text-align:center">${esc(r.coats)}</td><td>${esc(r.app)}</td><td>${esc(r.mat)}</td></tr>`).join('')
    : `<tr><td>Ceilings</td><td>Acrylic undercoat + flat ceiling white</td><td style="text-align:center">1+2</td><td>Spray + Backroll</td><td>Dulux Ceiling White</td></tr>`
      + `<tr><td>Walls</td><td>Acrylic undercoat + low sheen acrylic</td><td style="text-align:center">1+2</td><td>Cut &amp; Roll</td><td>Dulux Wash&amp;Wear</td></tr>`
      + `<tr><td>Doors &amp; Trims</td><td>Undercoat + semi-gloss enamel</td><td style="text-align:center">1+2</td><td>Spray + Backroll</td><td>Dulux Aquaenamel</td></tr>`

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${esc(fileTitle)}</title><style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,Helvetica,sans-serif;font-size:11.5px;color:#1a1a18;padding:28px 32px;max-width:860px;margin:0 auto}
.hdr{display:flex;justify-content:space-between;align-items:center;padding-bottom:14px;border-bottom:3px solid #1a1a18;margin-bottom:18px}
.contact{text-align:right;font-size:10.5px;color:#555;line-height:1.8}
h1{font-size:22px;font-weight:700;margin-bottom:14px}
.meta{display:grid;grid-template-columns:110px 1fr;gap:2px 10px;font-size:11.5px;margin-bottom:16px;max-width:420px}
.meta .lbl{font-weight:700}
h2{font-size:12px;font-weight:700;margin:14px 0 6px;border-bottom:1.5px solid #1a1a18;padding-bottom:3px;text-transform:uppercase;letter-spacing:.4px}
p{line-height:1.6;margin-bottom:8px}
ul{margin-left:18px;margin-bottom:8px}li{margin-bottom:3px;line-height:1.5}
table{width:100%;border-collapse:collapse;margin-bottom:10px;font-size:11px}
.ct th{background:#f0efec;padding:6px 8px;text-align:left;border:1px solid #ccc;font-size:10.5px;font-weight:700}
.ct td{border:1px solid #ccc;padding:5px 8px}
.pt th{background:#1a1a18;color:#fff;padding:7px 10px;text-align:left;font-size:11px}
.pt td{border:1px solid #ddd;padding:6px 10px}
.pt tr:nth-child(even) td{background:#fafaf8}
.tot-row td{font-weight:700;background:#f0efec;border:1px solid #ccc;padding:7px 10px}
.footer{display:flex;justify-content:space-between;align-items:flex-end;margin-top:24px;padding-top:12px;border-top:1px solid #ccc}
.gst-note{background:#fefce8;border:1px solid #fde68a;border-radius:6px;padding:8px 12px;font-size:11px;margin-top:6px;font-weight:600}
@media print{button{display:none}body{padding:16px}}
</style></head><body contenteditable="true">
<div style="display:inline-block;background:${o.docType === 'Estimate' ? '#fefce8' : '#1a1a18'};color:${o.docType === 'Estimate' ? '#92400e' : '#fff'};font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;padding:4px 12px;border-radius:4px;margin-bottom:14px">${esc(o.docType)}</div>
<div class="hdr">
  <img src="${o.origin}/np-logo.png" alt="Northern Painters" style="width:300px;height:auto;display:block">
  <div class="contact">www.northernpaintersps.com.au<br>Ph: 0449 783 461<br>Northern Rivers NSW<br><span style="font-size:9.5px;color:#aaa">Lic. No: 478971C &nbsp;|&nbsp; ABN 46 435 825 953</span></div>
</div>
<h1>${esc(o.docType)}</h1>
<div class="meta">
  <span class="lbl">To:</span><span>${esc(o.to)}</span>
  <span class="lbl">Project:</span><span>${esc(o.proj)}</span>
  <span class="lbl">Site Location:</span><span>${esc(o.site)}</span>
  <span class="lbl">Date Issued:</span><span>${date}</span>
  <span class="lbl">Quote No:</span><span>${esc(o.qno || '—')}</span>
</div>
<h2>Scope of Works</h2>
<p>${esc(scope)}</p>
<p><strong>Inclusions:</strong></p><ul>${bullets(QUOTE_INCLUSIONS)}</ul>
<h2>Coating System</h2>
<table class="ct"><thead><tr><th>Substrate</th><th>System</th><th style="width:70px;text-align:center">Coats</th><th>Application Method</th><th>Materials</th></tr></thead>
<tbody>${coatBody}</tbody></table>
<h2>Surface Preparation</h2>
<ul>
  <li>Fill and sand all nail, screw and imperfection penetrations to a smooth finish</li>
  <li>Seal paintable gaps at joints, trims and corners with flexible paintable sealant</li>
  <li>Spot-prime all bare, cut or exposed substrates as required</li>
  <li>Light sanding and dust-off between coats</li>
  <li>Final tack-off and inspection prior to each coat</li>
</ul>
<h2>Exclusions</h2><ul>${bullets(QUOTE_EXCLUSIONS)}</ul>
<h2>Work Plan and Duration</h2>
<ul><li>Estimated duration: <strong>${esc(o.dur || 'To be confirmed')}</strong></li><li>Works subject to access availability and weather conditions</li><li>Scheduling to be confirmed prior to commencement</li></ul>
<h2>Standards and Compliances</h2>
<ul>
  <li>AS/NZS 2311:2017 — Guide to the Painting of Buildings</li>
  <li>Manufacturer technical data sheets and specified curing requirements</li>
  <li>NSW Guide to Standards and Tolerances (2017) — workmanship expectations</li>
</ul>
<h2>Completion and Handover</h2>
<ul>
  <li>Removal of all masking, protection and associated materials</li>
  <li>Full site clean-up on completion</li>
  <li>Final walkthrough inspection with client prior to sign-off</li>
</ul>
<h2>Pricing</h2>
<table class="pt"><thead><tr><th style="width:55px">Qty</th><th>Description</th><th style="width:110px">Price</th><th style="width:110px">Total</th></tr></thead>
<tbody>
${o.lines.map(l => `<tr><td>1</td><td>${esc(l.desc)}</td><td style="text-align:right">${money(l.total)}</td><td style="text-align:right;font-weight:600">${money(l.total)}</td></tr>`).join('')}
</tbody>
<tfoot>
<tr><td colspan="2"></td><td style="text-align:right;padding:7px 10px;border:1px solid #ddd;font-weight:700">Total ex GST</td><td class="tot-row">${money(exGST)}</td></tr>
</tfoot></table>
<div class="gst-note">Note: 10% GST to be added on top of the quoted price. Total inc. GST: <strong>${money(exGST * 1.1)}</strong></div>
<h2>Variations Clause</h2>
<p>Any changes, additional works or variations requested by the client or builder will require a written variation order or revised quotation and may incur additional charges. Work will not proceed on variations until written approval is received.</p>
<h2>Progress Claims and Payment Terms</h2>
<p>${esc(QUOTE_TERMS_TEXT)}</p>
<div class="footer">
  <div style="display:flex;gap:16px;align-items:center">
    <img src="${o.origin}/ft-logo.png" alt="NSW Fair Trading Licensed Contractor" style="height:70px;width:auto">
    <img src="${o.origin}/dulux-badge.png" alt="Dulux Accredited Painter — 5 year workmanship warranty" style="height:60px;width:auto">
  </div>
  <div style="text-align:right">
    <div style="font-size:13px;font-weight:700">NORTHERN PAINTERS</div>
    <div style="font-size:9.5px;color:#666">PAINTING SOLUTIONS<br>Lic. No: 478971C | ABN 46 435 825 953</div>
  </div>
</div>
<br><button onclick="window.print()" style="margin-top:12px;padding:10px 24px;background:#1a1a18;color:#fff;border:none;border-radius:6px;font-size:13px;cursor:pointer">Print / Save as PDF</button>
</body></html>`
}
