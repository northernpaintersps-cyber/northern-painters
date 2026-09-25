import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, selectAll } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { genId } from '@/lib/utils'
import { Plus, Loader2, Trash2, Mic } from 'lucide-react'

type Row = Record<string, any>

const PRIORITIES = ['Normal', 'High', 'Low']
const PRI_BADGE: Record<string, string> = {
  High:   'bg-[#fee2e2] text-[#991b1b]',
  Normal: 'bg-[#dbeafe] text-[#1e40af]',
  Low:    'bg-[#f1f0e8] text-[#5f5e5a]',
}

function useTodos() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['np_todos', user?.id],
    queryFn: async () => {
      const { data } = await selectAll('np_todos', user!.id, { orderBy: 'created_at' })
      return (data ?? []) as Row[]
    },
    enabled: !!user,
  })
}

function useUpsert() {
  const qc = useQueryClient()
  const { user } = useAuth()
  return useMutation({
    mutationFn: async (row: Row) => {
      const { error } = await (supabase.from('np_todos') as any)
        .upsert({ ...row, user_id: user!.id, updated_at: new Date().toISOString() })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['np_todos'] }),
  })
}

function useDel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.from('np_todos') as any).delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['np_todos'] }),
  })
}

export default function Todos() {
  const { data: todos = [], isLoading } = useTodos()
  const upsert = useUpsert()
  const del = useDel()

  const [text, setText] = useState('')
  const [priority, setPriority] = useState('Normal')
  const [listening, setListening] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const pending = todos.filter(t => !t.done)
  const done = todos.filter(t => t.done)

  async function add(value?: string) {
    const v = (value ?? text).trim()
    if (!v) return
    setText('')
    await upsert.mutateAsync({
      id: genId('t'), todo_text: v, done: false,
      priority, created_at: new Date().toISOString(),
    })
    inputRef.current?.focus()
  }

  // V16 startTodoVoice()
  function startVoice() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) { alert('Voice input not supported in this browser.\nPlease use Google Chrome.'); return }
    const rec = new SR()
    rec.lang = 'en-AU'
    rec.interimResults = false
    rec.maxAlternatives = 1
    let gotResult = false
    setListening(true)
    rec.onresult = (e: any) => {
      gotResult = true
      setListening(false)
      add(e.results[0][0].transcript)
    }
    rec.onerror = (e: any) => {
      setListening(false)
      const msgs: Record<string, string> = {
        'not-allowed': 'Microphone access was denied.\n\nFix: click the mic icon in the Chrome address bar → Allow microphone, then try again.',
        'no-speech': 'No speech detected — please try again.',
        'network': 'Internet connection required for voice recognition.',
        'audio-capture': 'No microphone found. Check your mic is connected.',
      }
      if (e.error !== 'no-speech') alert(msgs[e.error] ?? `Voice error: ${e.error}`)
    }
    rec.onend = () => { if (!gotResult) setListening(false) }
    try { rec.start() } catch (err: any) { setListening(false); alert('Could not start microphone: ' + err.message) }
  }

  const Item = ({ t }: { t: Row }) => (
    <div className="flex items-center gap-2.5 px-2.5 py-2 border-b border-black/[0.06]" style={t.done ? { opacity: 0.55 } : undefined}>
      <input type="checkbox" checked={!!t.done} className="w-4 h-4 cursor-pointer shrink-0 accent-blue-600"
        onChange={e => upsert.mutate({ ...t, done: e.target.checked })} />
      <span className="flex-1 text-[13px]" style={t.done ? { textDecoration: 'line-through', color: '#666' } : undefined}>
        {t.todo_text}
      </span>
      <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-medium ${PRI_BADGE[t.priority] ?? PRI_BADGE.Normal}`}>
        {t.priority || 'Normal'}
      </span>
      <button onClick={() => del.mutate(t.id)}
        className="px-2 py-1 rounded-md bg-white border border-black/20 hover:bg-[#f5f4f0] text-[#c0392b]"><Trash2 size={12} /></button>
    </div>
  )

  if (isLoading) return (
    <div className="flex items-center justify-center h-64"><Loader2 size={20} className="animate-spin text-blue-600" /></div>
  )

  return (
    <div className="p-5">
      <h2 className="text-[17px] font-semibold text-gray-900 mb-4">
        To Do <span className="text-[13px] text-[#666] font-normal">{pending.length} pending</span>
      </h2>

      <div className="bg-white border border-black/[0.12] rounded-xl p-4 mb-3.5">
        <div className="flex gap-2 flex-wrap">
          <input ref={inputRef} value={text} onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') add() }}
            placeholder="Add a task..."
            className="flex-1 min-w-[180px] px-3 py-2 border border-black/20 rounded-lg text-[13px] focus:outline-none focus:ring-1 focus:ring-blue-500" />
          <select value={priority} onChange={e => setPriority(e.target.value)}
            className="px-2.5 py-2 border border-black/20 rounded-lg text-[13px] bg-white focus:outline-none focus:ring-1 focus:ring-blue-500">
            {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <button onClick={startVoice} title="Voice input"
            className={`flex items-center gap-1 px-3 py-2 rounded-lg border ${listening ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-black/20 hover:bg-[#f5f4f0]'}`}>
            <Mic size={14} />{listening && <span className="text-[10px]">Listening…</span>}
          </button>
          <button onClick={() => add()}
            className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-medium rounded-lg">
            <Plus size={14} /> Add
          </button>
        </div>
      </div>

      <div className="bg-white border border-black/[0.12] rounded-xl overflow-hidden">
        {pending.length ? pending.map(t => <Item key={t.id} t={t} />) : (
          <div className="text-center py-6 text-[#666]">No pending tasks. Great work!</div>
        )}
        {done.length > 0 && (
          <>
            <div className="px-3 py-2 text-[11px] font-semibold text-[#666] uppercase tracking-wide bg-[#fafaf8]">
              Completed ({done.length})
            </div>
            {done.map(t => <Item key={t.id} t={t} />)}
          </>
        )}
      </div>
    </div>
  )
}
