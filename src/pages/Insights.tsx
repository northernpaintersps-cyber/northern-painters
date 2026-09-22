import { useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { askBusiness, type ChatTurn } from '@/lib/ai'
import { MessageCircle, RefreshCw, Send, Loader2, Hammer, Package, Clock, FileText } from 'lucide-react'

const QUICK_QUESTIONS = [
  'What is my average margin on finished jobs?',
  'Which job type is most profitable for me?',
  "What's my average job value by type?",
  'How much have I spent on materials this year?',
  'Which jobs had the lowest margin and why?',
  "What's my win rate on quotes sent?",
  'What are my top suppliers by spend?',
  'Compare my labour costs vs materials costs',
  "What's my average daily labour rate?",
  'Which clients have I done the most work for?',
  "What's my total pipeline value right now?",
  'Give me a business performance summary',
]

function useTable(table: string) {
  const { user } = useAuth()
  return useQuery({
    queryKey: [table, user?.id],
    queryFn: async () => {
      const { data } = await (supabase.from(table as any) as any).select('*').eq('user_id', user!.id)
      return (data ?? []) as any[]
    },
    enabled: !!user,
  })
}

// Minimal markdown → HTML (V16 mdHTML): bold, italic, code, headings, lists, line breaks
function mdHTML(src: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const lines = esc(src).split('\n')
  const out: string[] = []
  let inList = false
  for (const raw of lines) {
    let line = raw
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
      .replace(/`([^`]+)`/g, '<code style="background:rgba(0,0,0,.06);padding:1px 4px;border-radius:3px">$1</code>')
    const li = line.match(/^\s*[-•]\s+(.*)$/)
    const h = line.match(/^(#{1,4})\s+(.*)$/)
    if (li) {
      if (!inList) { out.push('<ul style="margin:4px 0;padding-left:18px">'); inList = true }
      out.push(`<li style="margin:2px 0">${li[1]}</li>`)
      continue
    }
    if (inList) { out.push('</ul>'); inList = false }
    if (h) { out.push(`<div style="font-weight:700;margin:8px 0 4px">${h[2]}</div>`); continue }
    if (!line.trim()) { out.push('<div style="height:6px"></div>'); continue }
    out.push(`<div>${line}</div>`)
  }
  if (inList) out.push('</ul>')
  return out.join('')
}

// V16 buildBusinessContext()
function buildBusinessContext(d: {
  jobs: any[]; invoices: any[]; labour: any[]; materials: any[]
}): string {
  const { jobs, invoices, labour, materials } = d
  const jobData = jobs.map(j => {
    const matCost = materials.filter(m => m.job_id === j.id).reduce((s, m) => s + (m.cost_ex_gst || 0), 0)
    const labCost = labour.filter(l => l.job_id === j.id).reduce((s, l) => s + (l.cost || (l.hours || 0) * (l.rate || 0)), 0)
    const realCost = matCost + labCost
    const agreed = j.agreed_ex_gst || 0
    const margin = agreed > 0 ? ((agreed - realCost) / agreed) * 100 : null
    return {
      id: j.id, client: j.client, type: j.type, status: j.status, quoteStatus: j.quote_status,
      agreedExGST: agreed, quoteExGST: j.quote_ex_gst || 0,
      realCost: realCost > 0 ? realCost : null,
      marginPct: margin !== null ? parseFloat(margin.toFixed(1)) : null,
    }
  })

  const byType: Record<string, { count: number; totalAgreed: number; margins: number[] }> = {}
  jobData.filter(j => j.agreedExGST > 0 && j.status === 'Finished').forEach(j => {
    const t = j.type || '—'
    if (!byType[t]) byType[t] = { count: 0, totalAgreed: 0, margins: [] }
    byType[t].count++
    byType[t].totalAgreed += j.agreedExGST
    if (j.marginPct !== null) byType[t].margins.push(j.marginPct)
  })
  const typeStats = Object.entries(byType).map(([type, x]) => ({
    type, count: x.count,
    avgValue: Math.round(x.totalAgreed / x.count),
    avgMargin: x.margins.length ? parseFloat((x.margins.reduce((a, b) => a + b, 0) / x.margins.length).toFixed(1)) : null,
  }))

  const totalInvoiced = invoices.reduce((s, i) => s + (i.agreed_ex_gst || 0), 0)
  const totalMat = materials.reduce((s, m) => s + (m.cost_ex_gst || 0), 0)
  const totalLab = labour.reduce((s, l) => s + (l.cost || (l.hours || 0) * (l.rate || 0)), 0)
  const finished = jobData.filter(j => j.status === 'Finished')
  const active = jobData.filter(j => ['In Progress', 'Scheduled', 'Booked'].includes(j.status))
  const pipelineValue = jobData.filter(j => ['Sent', 'Negotiating'].includes(j.quoteStatus) && !j.status)
    .reduce((s, j) => s + j.quoteExGST, 0)
  const n = (x: number) => Math.round(x).toLocaleString()

  return `NORTHERN PAINTERS — BUSINESS DATA SNAPSHOT (today: ${new Date().toLocaleDateString('en-AU')})

FINANCIALS:
- Total invoiced ex GST: $${n(totalInvoiced)}
- Total materials cost: $${n(totalMat)}
- Total labour cost: $${n(totalLab)}
- Total real costs: $${n(totalMat + totalLab)}
- Pipeline (quotes sent): $${n(pipelineValue)} ex GST

JOBS (${jobs.length} total — ${finished.length} finished, ${active.length} active):
${jobData.map(j => `  ${j.id} | ${j.client} | ${j.type} | ${j.status || j.quoteStatus || '—'} | Agreed: $${j.agreedExGST ? j.agreedExGST.toLocaleString() : '0'}${j.realCost ? ` | Real cost: $${n(j.realCost)}` : ''}${j.marginPct !== null ? ` | Margin: ${j.marginPct}%` : ''}`).join('\n')}

PERFORMANCE BY JOB TYPE (finished jobs only):
${typeStats.length ? typeStats.map(t => `  ${t.type}: ${t.count} jobs, avg value $${t.avgValue.toLocaleString()}${t.avgMargin !== null ? `, avg margin ${t.avgMargin}%` : ''}`).join('\n') : '  Not enough finished job data yet.'}

MATERIALS LOG (${materials.length} entries):
${materials.slice(0, 40).map(m => `  ${m.date || '—'} | ${m.supplier || '—'} | ${m.mat_desc || '—'} | $${(m.cost_ex_gst || 0).toFixed(2)} ex GST${m.job_id ? ' | Job: ' + m.job_id : ''}`).join('\n')}${materials.length > 40 ? `\n  ... and ${materials.length - 40} more entries` : ''}

LABOUR LOG (${labour.length} entries):
${labour.slice(0, 30).map(l => `  ${l.date || '—'} | ${l.labour_desc || '—'} | ${l.hours || 0}hrs @ $${l.rate || 0}/hr = $${(l.cost || 0).toFixed(2)}${l.job_id ? ' | Job: ' + l.job_id : ''}`).join('\n')}${labour.length > 30 ? `\n  ... and ${labour.length - 30} more entries` : ''}`
}

export default function Insights() {
  const { user } = useAuth()
  const { data: jobs = [] } = useTable('np_jobs')
  const { data: invoices = [] } = useTable('np_invoices')
  const { data: labour = [] } = useTable('np_labour')
  const { data: materials = [] } = useTable('np_materials')

  const { data: settings } = useQuery({
    queryKey: ['np_settings', 'business', user?.id],
    queryFn: async () => {
      const { data } = await (supabase.from('np_settings') as any)
        .select('value').eq('user_id', user!.id).eq('key', 'business').maybeSingle()
      return (data?.value ?? {}) as any
    },
    enabled: !!user,
  })
  const apiKey = settings?.ai_api_key || ''

  const [history, setHistory] = useState<ChatTurn[]>([])
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  const [error, setError] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [history, thinking])

  async function ask(question?: string) {
    const q = (question ?? input).trim()
    if (!q || thinking) return
    if (!apiKey) {
      setError('No API key set. Add your Anthropic API key in Settings to use AI features.')
      return
    }
    setError('')
    setInput('')
    const next: ChatTurn[] = [...history, { role: 'user', content: q }]
    setHistory(next)
    setThinking(true)
    try {
      const context = buildBusinessContext({ jobs, invoices, labour, materials })
      const reply = await askBusiness(apiKey, next, context)
      setHistory([...next, { role: 'assistant', content: reply }])
    } catch (e: any) {
      setHistory(history)
      setError(e?.message ?? 'Request failed')
    } finally {
      setThinking(false)
    }
  }

  return (
    <div className="p-5">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <h2 className="text-[17px] font-semibold text-gray-900 flex items-center gap-2">
          <MessageCircle size={18} className="text-[#2563eb]" /> AI Business Chat
        </h2>
        <button onClick={() => { setHistory([]); setError('') }}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] bg-white border border-black/20 rounded-lg hover:bg-[#f5f4f0]">
          <RefreshCw size={13} /> Clear chat
        </button>
      </div>

      <div className="grid gap-3.5 items-start" style={{ gridTemplateColumns: 'minmax(0,1fr) 320px' }}>
        {/* Chat column */}
        <div>
          <div ref={scrollRef}
            className="min-h-[400px] max-h-[65vh] overflow-y-auto flex flex-col gap-3 px-0.5 py-1 mb-3">
            {history.length === 0 && !thinking && (
              <div className="text-center px-5 py-10 text-[#666]">
                <MessageCircle size={36} className="mx-auto mb-2.5 opacity-30" />
                <div className="text-sm font-semibold mb-1.5">Ask anything about your business</div>
                <div className="text-xs">Average rate per m², best-performing job types, real margins, materials spend — anything in your data.</div>
              </div>
            )}

            {history.map((m, i) => m.role === 'user' ? (
              <div key={i} className="flex justify-end">
                <div className="bg-[#2563eb] text-white px-3.5 py-2.5 text-[13px] leading-relaxed max-w-[75%]"
                  style={{ borderRadius: '14px 14px 4px 14px' }}>
                  {m.content}
                </div>
              </div>
            ) : (
              <div key={i} className="flex justify-start">
                <div className="bg-[#f5f4f0] px-3.5 py-3 text-[13px] leading-relaxed max-w-[85%]"
                  style={{ borderRadius: '14px 14px 14px 4px' }}
                  dangerouslySetInnerHTML={{ __html: mdHTML(m.content) }} />
              </div>
            ))}

            {thinking && (
              <div className="flex justify-start">
                <div className="bg-[#f5f4f0] px-3.5 py-2.5 text-[13px] text-[#666] flex items-center gap-1.5"
                  style={{ borderRadius: '14px 14px 14px 4px' }}>
                  <Loader2 size={14} className="animate-spin" /> Thinking…
                </div>
              </div>
            )}

            {error && (
              <div className="text-xs text-[#c0392b] bg-[#fef2f2] rounded-lg px-3 py-2">Error: {error}</div>
            )}
          </div>

          <div className="flex gap-2 items-end">
            <textarea
              rows={2} value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask() } }}
              placeholder="e.g. What's my average margin on exterior repaints?"
              className="flex-1 px-3 py-2.5 border border-black/20 rounded-[10px] text-[13px] resize-none font-[inherit] focus:outline-none focus:ring-1 focus:ring-blue-500" />
            <button onClick={() => ask()} disabled={thinking}
              className="flex items-center gap-1.5 px-4 h-11 bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-medium rounded-lg disabled:opacity-50">
              <Send size={14} /> Ask
            </button>
          </div>
          <div className="text-[11px] text-[#666] mt-1.5">Press Enter to send · Shift+Enter for new line</div>
        </div>

        {/* Sidebar */}
        <div className="flex flex-col gap-2.5">
          <div className="bg-white border border-black/[0.12] rounded-xl p-3.5">
            <div className="text-xs font-semibold text-[#666] mb-2.5 uppercase tracking-wide">Quick Questions</div>
            {QUICK_QUESTIONS.map(q => (
              <button key={q} onClick={() => ask(q)} disabled={thinking}
                className="w-full text-left text-[11px] px-2.5 py-1.5 mb-1.5 leading-snug bg-white border border-black/20 rounded-lg hover:bg-[#f5f4f0] disabled:opacity-50">
                {q}
              </button>
            ))}
          </div>

          <div className="bg-white border border-black/[0.12] rounded-xl p-3.5">
            <div className="text-xs font-semibold text-[#666] mb-2 uppercase tracking-wide">Your Data</div>
            <div className="text-xs text-[#666] flex flex-col gap-1">
              <div className="flex items-center gap-1.5"><Hammer size={12} /> {jobs.length} jobs · {jobs.filter(j => j.status === 'Finished').length} finished</div>
              <div className="flex items-center gap-1.5"><Package size={12} /> {materials.length} material entries</div>
              <div className="flex items-center gap-1.5"><Clock size={12} /> {labour.length} labour entries</div>
              <div className="flex items-center gap-1.5"><FileText size={12} /> {invoices.length} invoices</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
