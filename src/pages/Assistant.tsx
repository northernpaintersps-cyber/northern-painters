// The assistant.
//
// The old AI chat was handed a truncated text summary of four tables and had
// no tools, so it answered from a sample. This one has tools and reads the
// live data, which means two things have to be visible that were not before:
// which tools it called, and what the turn cost. An assistant you cannot check
// is worse than a screen you can read yourself.

import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { useBusinessSettings } from '@/pages/SettingsPage'
import { runAgent, totalTokens, type AgentStep } from '@/lib/agent'
import { buildTools, systemPrompt } from '@/lib/agentTools'
import { mdHTML } from '@/lib/markdown'
import {
  Send, Loader2, Sparkles, Trash2, Wrench, AlertCircle, ExternalLink,
  ClipboardCheck, ChevronDown, ChevronRight, Key,
} from 'lucide-react'

const QUICK = [
  'What needs my attention today?',
  'Which finished jobs made the least money, and why?',
  'How much is owed to me, and how late is it?',
  'What are my real rates per m² by service?',
  'What have I not invoiced yet?',
  'How much did I spend at each supplier this year?',
  'Which quotes are going cold?',
  'What is job 7142 costing me against its quote?',
]

interface Turn {
  role: 'user' | 'assistant'
  text: string
  steps?: AgentStep[]
  cost?: { input: number; output: number; cached: number }
  capped?: boolean
}

const HISTORY_TURNS = 20
const key = (userId?: string) => `np_assistant_${userId ?? 'anon'}`

/** localStorage can throw and can come back empty. Neither may break the page. */
function loadHistory(userId?: string): Turn[] {
  try {
    const raw = localStorage.getItem(key(userId))
    const parsed = raw ? JSON.parse(raw) : null
    return Array.isArray(parsed) ? parsed.slice(-HISTORY_TURNS * 2) : []
  } catch { return [] }
}
function saveHistory(userId: string | undefined, turns: Turn[]) {
  try { localStorage.setItem(key(userId), JSON.stringify(turns.slice(-HISTORY_TURNS * 2))) }
  catch { /* a full quota must not stop the conversation */ }
}

function StepLine({ step }: { step: AgentStep }) {
  if (step.error) return (
    <div className="flex items-start gap-1.5 text-[11px] text-[#b45309]">
      <AlertCircle size={11} className="shrink-0 mt-px" />
      <span><b>{step.tool}</b> — {step.error}</span>
    </div>
  )
  return (
    <div className="flex items-start gap-1.5 text-[11px] text-[#666]">
      <Wrench size={11} className="shrink-0 mt-px" />
      <span>{step.summary}</span>
    </div>
  )
}

function Steps({ steps }: { steps: AgentStep[] }) {
  const [open, setOpen] = useState(false)
  if (!steps.length) return null
  const errors = steps.filter(s => s.error).length
  return (
    <div className="mb-1.5">
      <button onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1 text-[11px] text-[#666] hover:text-[#1a1a18]">
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        {steps.length} step{steps.length === 1 ? '' : 's'}
        {errors > 0 && <span className="text-[#b45309]"> · {errors} failed</span>}
      </button>
      {open && (
        <div className="flex flex-col gap-0.5 mt-1 pl-3 border-l-2 border-black/[0.08]">
          {steps.map((s, i) => <StepLine key={i} step={s} />)}
        </div>
      )}
    </div>
  )
}

export default function Assistant() {
  const { user } = useAuth()
  const nav = useNavigate()
  const { data: biz } = useBusinessSettings()
  const apiKey = biz?.ai_api_key?.trim() ?? ''

  const [turns, setTurns] = useState<Turn[]>(() => loadHistory(user?.id))
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [live, setLive] = useState<AgentStep[]>([])
  const [offer, setOffer] = useState<{ route: string; label: string } | null>(null)
  const [copied, setCopied] = useState('')
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setTurns(loadHistory(user?.id)) }, [user?.id])
  useEffect(() => { saveHistory(user?.id, turns) }, [turns, user?.id])
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [turns, live])

  async function ask(question: string) {
    const q = question.trim()
    if (!q || busy) return
    if (!apiKey) return
    setInput('')
    setOffer(null)
    setTurns(t => [...t, { role: 'user', text: q }])
    setBusy(true)
    setLive([])

    try {
      const tools = buildTools({
        userId: user!.id,
        biz,
        onOpen: (route, label) => setOffer({ route, label }),
        onDraft: async (text, label) => {
          try { await navigator.clipboard.writeText(text); setCopied(label) }
          catch { /* the text is in the reply either way */ }
        },
      })

      // The conversation as the API wants it. Only the plain text of past
      // turns goes back — replaying old tool calls would re-answer from
      // figures that may have changed since.
      const messages = [
        ...turns.slice(-HISTORY_TURNS).map(t => ({ role: t.role, content: t.text })),
        { role: 'user', content: q },
      ]

      const run = await runAgent({
        apiKey,
        system: systemPrompt(biz),
        messages,
        tools,
        onStep: s => setLive(prev => [...prev, s]),
      })

      setTurns(t => [...t, {
        role: 'assistant',
        text: run.text || 'No answer came back. Try asking again.',
        steps: run.steps,
        cost: totalTokens(run.usage),
        capped: run.cappedOut,
      }])
    } catch (e: any) {
      setTurns(t => [...t, {
        role: 'assistant',
        text: `That failed: ${e?.message ?? e}`,
      }])
    } finally {
      setBusy(false)
      setLive([])
    }
  }

  if (!apiKey) return (
    <div className="p-5">
      <h1 className="text-lg font-bold text-gray-900 mb-1">Assistant</h1>
      <div className="bg-white border border-black/[0.12] rounded-xl p-5 max-w-xl">
        <div className="flex items-center gap-2 text-[13px] font-semibold mb-1.5">
          <Key size={14} className="text-[#d97706]" /> No API key yet
        </div>
        <p className="text-[12.5px] text-[#666] mb-3">
          The assistant reads your own data and answers questions about it, using your
          Anthropic API key. Add one in Settings and it will work from there.
        </p>
        <button onClick={() => nav('/settings')}
          className="text-sm bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-2 rounded-lg">
          Open Settings
        </button>
      </div>
    </div>
  )

  return (
    <div className="p-5 flex flex-col h-[calc(100vh-80px)]">
      <div className="flex items-start justify-between gap-2 flex-wrap mb-3 shrink-0">
        <div>
          <h1 className="text-lg font-bold text-gray-900 mb-0.5">Assistant</h1>
          <p className="text-[12px] text-[#666]">
            Reads your jobs, invoices, costs and crew. It cannot change anything.
          </p>
        </div>
        {turns.length > 0 && (
          <button onClick={() => { setTurns([]); saveHistory(user?.id, []) }}
            className="flex items-center gap-1.5 text-[12px] text-[#666] hover:text-[#c0392b]">
            <Trash2 size={13} /> Clear
          </button>
        )}
      </div>

      {/* Conversation */}
      <div className="flex-1 overflow-y-auto bg-white border border-black/[0.12] rounded-xl p-4">
        {turns.length === 0 && !busy && (
          <div className="max-w-2xl">
            <div className="flex items-center gap-1.5 text-[13px] font-semibold mb-2">
              <Sparkles size={14} className="text-blue-600" /> Ask it something
            </div>
            <p className="text-[12px] text-[#666] mb-3">
              It looks the answer up rather than guessing, and shows you which tables it
              read. Every figure comes from your data — it is not allowed to do the sums
              itself.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {QUICK.map(q => (
                <button key={q} onClick={() => ask(q)}
                  className="text-[11.5px] text-left px-2.5 py-1.5 rounded-lg bg-[#f5f4f0] border border-black/[0.1] hover:bg-white">
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((t, i) => (
          <div key={i} className={`mb-3.5 ${t.role === 'user' ? 'flex justify-end' : ''}`}>
            {t.role === 'user' ? (
              <div className="bg-blue-600 text-white text-[12.5px] rounded-2xl rounded-br-sm px-3.5 py-2 max-w-[80%]">
                {t.text}
              </div>
            ) : (
              <div className="max-w-[92%]">
                {t.steps && <Steps steps={t.steps} />}
                <div className="text-[12.5px] leading-relaxed text-[#1a1a18]"
                  dangerouslySetInnerHTML={{ __html: mdHTML(t.text) }} />
                <div className="flex items-center gap-3 mt-1">
                  {t.capped && (
                    <span className="text-[10.5px] text-[#b45309]">
                      Stopped early — it ran out of steps. Ask something narrower.
                    </span>
                  )}
                  {t.cost && (
                    <span className="text-[10.5px] text-[#999] tabular-nums"
                      title={`${t.cost.cached} cached input tokens`}>
                      {(t.cost.input + t.cost.output).toLocaleString()} tokens
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}

        {busy && (
          <div className="max-w-[92%]">
            <div className="flex flex-col gap-0.5 mb-1.5 pl-3 border-l-2 border-blue-500/30">
              {live.map((s, i) => <StepLine key={i} step={s} />)}
            </div>
            <div className="flex items-center gap-1.5 text-[12px] text-[#666]">
              <Loader2 size={13} className="animate-spin text-blue-600" />
              {live.length ? 'Working through it…' : 'Thinking…'}
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* What it did for you, outside the conversation so it does not scroll away */}
      {(offer || copied) && (
        <div className="flex items-center gap-2 flex-wrap mt-2 shrink-0">
          {offer && (
            <button onClick={() => nav(offer.route)}
              className="flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 hover:bg-blue-100">
              <ExternalLink size={12} /> {offer.label}
            </button>
          )}
          {copied && (
            <span className="flex items-center gap-1.5 text-[12px] text-[#0a7c4e]">
              <ClipboardCheck size={12} /> {copied} copied to the clipboard
            </span>
          )}
        </div>
      )}

      {/* Ask */}
      <div className="flex gap-2 mt-2.5 shrink-0">
        <input value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(input) } }}
          placeholder="Ask about your jobs, money, crew or rates…"
          disabled={busy}
          className="flex-1 bg-white border border-black/20 rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-60" />
        <button onClick={() => ask(input)} disabled={busy || !input.trim()}
          className="flex items-center gap-1.5 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-semibold px-4 py-2 rounded-lg">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
        </button>
      </div>
    </div>
  )
}
