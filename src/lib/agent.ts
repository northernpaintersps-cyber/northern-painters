// The tool-use loop.
//
// `callClaude` answers one question in one trip and returns a string. An
// assistant needs the opposite shape: several trips, several tools per trip,
// and the content blocks rather than the text. This is that loop and nothing
// else — the tools live in agentTools.ts and the screen in pages/Assistant.
//
// The transport is injectable because every way this loop fails is invisible
// from the UI: a missing tool_result is an API 400, a thrown tool kills the
// turn, and a loop with no cap spends the user's own API credit. A stub
// transport lets all three be proved under node.

import { request, replyText, type Tool, type CallUsage } from '@/lib/ai'

export interface AgentTool extends Tool {
  /** Runs the tool. Throwing is fine — it comes back as an error result. */
  run: (input: any) => Promise<unknown> | unknown
  /** One line for the UI: "queried np_invoices · 23 rows". */
  describe?: (input: any, result: unknown) => string
}

export interface AgentStep {
  kind: 'tool' | 'stopped'
  tool?: string
  input?: unknown
  /** What the UI shows for this step. */
  summary?: string
  error?: string
}

export type Transport = (messages: any[], system: string, tools: Tool[]) => Promise<any>

export const DEFAULT_MAX_STEPS = 8

/** How much of a tool result is worth sending back. Beyond this it is noise. */
const RESULT_LIMIT = 24000

export interface AgentRun {
  text: string
  messages: any[]
  usage: CallUsage[]
  steps: AgentStep[]
  /** True when the step cap ended the turn rather than the model finishing. */
  cappedOut: boolean
}

const toolResultText = (value: unknown): string => {
  const s = typeof value === 'string' ? value : JSON.stringify(value ?? null)
  return s.length > RESULT_LIMIT
    ? `${s.slice(0, RESULT_LIMIT)}\n\n[truncated at ${RESULT_LIMIT} characters]`
    : s
}

export async function runAgent(opts: {
  apiKey: string
  system: string
  /** The running conversation. Appended to, and returned. */
  messages: any[]
  tools: AgentTool[]
  model?: string
  maxTokens?: number
  maxSteps?: number
  onStep?: (s: AgentStep) => void
  /** For tests. Defaults to the real Messages API. */
  transport?: Transport
}): Promise<AgentRun> {
  const maxSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS
  const byName = new Map(opts.tools.map(t => [t.name, t]))
  const schemas: Tool[] = opts.tools.map(({ name, description, input_schema }) =>
    ({ name, description, input_schema }))

  const usage: CallUsage[] = []
  const steps: AgentStep[] = []
  const messages = opts.messages

  const transport: Transport = opts.transport ?? ((msgs, system, tools) =>
    request(opts.apiKey, msgs, system, {
      model: opts.model ?? 'claude-sonnet-5',
      maxTokens: opts.maxTokens ?? 4000,
      tools,
      cacheSystem: true,
      onUsage: u => usage.push(u),
    }))

  const record = (s: AgentStep) => { steps.push(s); opts.onStep?.(s) }

  let text = ''

  for (let step = 0; step < maxSteps; step++) {
    const data = await transport(messages, opts.system, schemas)
    const content = Array.isArray(data?.content) ? data.content : []
    messages.push({ role: 'assistant', content })

    const calls = content.filter((c: any) => c?.type === 'tool_use')
    text = replyText(data) || text

    if (!calls.length) return { text, messages, usage, steps, cappedOut: false }

    // Every tool_use id must come back with exactly one result, or the next
    // request is a 400. That includes the ones that failed, and it includes a
    // tool name the model invented.
    const results: any[] = []
    for (const call of calls) {
      const tool = byName.get(call.name)
      if (!tool) {
        const error = `No such tool: ${call.name}`
        record({ kind: 'tool', tool: call.name, input: call.input, error })
        results.push({ type: 'tool_result', tool_use_id: call.id, is_error: true, content: error })
        continue
      }
      try {
        const out = await tool.run(call.input ?? {})
        record({
          kind: 'tool', tool: call.name, input: call.input,
          summary: tool.describe?.(call.input ?? {}, out) ?? call.name,
        })
        results.push({ type: 'tool_result', tool_use_id: call.id, content: toolResultText(out) })
      } catch (e: any) {
        // Reported to the model rather than thrown: it can then say what it
        // could not find, instead of the whole answer disappearing.
        const error = e?.message ?? String(e)
        record({ kind: 'tool', tool: call.name, input: call.input, error })
        results.push({ type: 'tool_result', tool_use_id: call.id, is_error: true, content: error })
      }
    }
    messages.push({ role: 'user', content: results })
  }

  // Out of steps. Return what there is and say so, rather than looping on.
  record({ kind: 'stopped', summary: `Stopped after ${maxSteps} steps` })
  return { text, messages, usage, steps, cappedOut: true }
}

/** What a turn cost, for the readout. */
export const totalTokens = (usage: CallUsage[]) =>
  usage.reduce((a, u) => ({
    input: a.input + u.inputTokens,
    output: a.output + u.outputTokens,
    cached: a.cached + u.cacheReadTokens,
  }), { input: 0, output: 0, cached: 0 })
