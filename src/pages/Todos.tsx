import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Modal } from '@/components/ui/Modal'
import { Input, Select, TextArea } from '@/components/ui/Field'
import { fmtDate, genId, today } from '@/lib/utils'
import { Plus, Loader2, Trash2, Edit2, CheckCircle2, Circle, Search, Flag } from 'lucide-react'

const PRIORITIES = ['High', 'Normal', 'Low']

const PRIORITY_STYLE: Record<string, string> = {
  High:   'text-red-400',
  Normal: 'text-blue-400',
  Low:    'text-gray-500',
}

function useTodos() {
  const { user } = useAuth()
  return useQuery<any[]>({
    queryKey: ['np_todos', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('np_todos').select('*').eq('user_id', user!.id).order('created_at', { ascending: false })
      if (error) throw error
      return data ?? []
    },
    enabled: !!user,
  })
}

function useJobs() {
  const { user } = useAuth()
  return useQuery<any[]>({
    queryKey: ['np_jobs_todo', user?.id],
    queryFn: async () => {
      const { data } = await supabase.from('np_jobs').select('id,client').eq('user_id', user!.id)
      return data ?? []
    },
    enabled: !!user,
  })
}

function useUpsert() {
  const qc = useQueryClient()
  const { user } = useAuth()
  return useMutation({
    mutationFn: async (row: any) => {
      const { error } = await supabase.from('np_todos').upsert({ ...row, user_id: user!.id, updated_at: new Date().toISOString() } as any)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['np_todos'] }),
  })
}

function useDelete() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('np_todos').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['np_todos'] }),
  })
}

// ── Todo item row ──────────────────────────────────────────────
function TodoRow({ todo, onToggle, onEdit, onDelete }: {
  todo: any
  onToggle: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const overdue = !todo.done && todo.due && todo.due < today()

  return (
    <div className={`flex items-start gap-3 p-3.5 rounded-xl border transition-colors group
      ${todo.done
        ? 'border-gray-200 bg-white/40 opacity-60'
        : overdue
          ? 'border-red-800/50 bg-red-900/10 hover:bg-red-900/20'
          : 'border-gray-200 bg-white hover:bg-gray-50/60'}`}>

      {/* Checkbox */}
      <button onClick={onToggle} className={`mt-0.5 shrink-0 transition-colors ${todo.done ? 'text-green-500' : 'text-gray-600 hover:text-blue-600'}`}>
        {todo.done ? <CheckCircle2 size={18} /> : <Circle size={18} />}
      </button>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className={`text-sm leading-snug ${todo.done ? 'line-through text-gray-500' : 'text-gray-900'}`}>
          {todo.todo_text || '—'}
        </p>
        <div className="flex items-center gap-3 mt-1 flex-wrap">
          {todo.priority && todo.priority !== 'Normal' && (
            <span className={`flex items-center gap-1 text-xs font-medium ${PRIORITY_STYLE[todo.priority] || 'text-gray-500'}`}>
              <Flag size={10} /> {todo.priority}
            </span>
          )}
          {todo.due && (
            <span className={`text-xs ${overdue && !todo.done ? 'text-red-400 font-medium' : 'text-gray-500'}`}>
              Due {fmtDate(todo.due)}{overdue && !todo.done ? ' — overdue' : ''}
            </span>
          )}
          {todo.job_id && (
            <span className="text-xs text-gray-500">Job {todo.job_id}</span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        <button onClick={onEdit} className="text-gray-500 hover:text-blue-600"><Edit2 size={13} /></button>
        <button onClick={onDelete} className="text-gray-500 hover:text-red-400"><Trash2 size={13} /></button>
      </div>
    </div>
  )
}

export default function Todos() {
  const { data: todos = [], isLoading } = useTodos()
  const { data: jobs = [] } = useJobs()
  const upsert = useUpsert()
  const del = useDelete()

  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<any>({})
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [filterPriority, setFilterPriority] = useState('')
  const [showDone, setShowDone] = useState(false)

  const ef = (k: string) => (e: React.ChangeEvent<any>) =>
    setForm((p: any) => ({ ...p, [k]: e.target.value }))

  function openNew() { setForm({ priority: 'Normal' }); setOpen(true) }
  function openEdit(t: any) { setForm({ ...t }); setOpen(true) }

  async function save() {
    setSaving(true)
    try {
      await upsert.mutateAsync({ ...form, id: form.id || genId('td') })
      setOpen(false)
    } finally { setSaving(false) }
  }

  async function toggle(todo: any) {
    await upsert.mutateAsync({ ...todo, done: !todo.done })
  }

  const filtered = useMemo(() => {
    let out = todos
    if (!showDone) out = out.filter(t => !t.done)
    if (search) {
      const q = search.toLowerCase()
      out = out.filter(t => t.todo_text?.toLowerCase().includes(q) || t.job_id?.toLowerCase().includes(q))
    }
    if (filterPriority) out = out.filter(t => t.priority === filterPriority)
    // Sort: overdue first, then by priority, then by due date
    out = [...out].sort((a, b) => {
      const aOverdue = !a.done && a.due && a.due < today()
      const bOverdue = !b.done && b.due && b.due < today()
      if (aOverdue && !bOverdue) return -1
      if (!aOverdue && bOverdue) return 1
      const pOrder = ['High', 'Normal', 'Low']
      const ap = pOrder.indexOf(a.priority || 'Normal')
      const bp = pOrder.indexOf(b.priority || 'Normal')
      if (ap !== bp) return ap - bp
      if (a.due && b.due) return a.due.localeCompare(b.due)
      if (a.due) return -1
      if (b.due) return 1
      return 0
    })
    return out
  }, [todos, search, filterPriority, showDone])

  const doneCount    = todos.filter(t => t.done).length
  const overdueCount = todos.filter(t => !t.done && t.due && t.due < today()).length
  const highCount    = todos.filter(t => !t.done && t.priority === 'High').length

  return (
    <div className="p-6 space-y-5 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-900">To-do</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            {todos.length - doneCount} open · {doneCount} done
            {overdueCount > 0 && <span className="text-red-400"> · {overdueCount} overdue</span>}
          </p>
        </div>
        <button onClick={openNew}
          className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-gray-900 font-semibold text-sm px-3 py-1.5 rounded-lg transition-colors">
          <Plus size={14} /> Add task
        </button>
      </div>

      {/* Stats strip */}
      {(overdueCount > 0 || highCount > 0) && (
        <div className="flex gap-3 flex-wrap">
          {overdueCount > 0 && (
            <div className="flex items-center gap-1.5 text-xs bg-red-900/20 border border-red-800/50 text-red-400 px-3 py-1.5 rounded-lg">
              <Flag size={11} /> {overdueCount} overdue
            </div>
          )}
          {highCount > 0 && (
            <div className="flex items-center gap-1.5 text-xs bg-amber-900/20 border border-amber-800/50 text-amber-400 px-3 py-1.5 rounded-lg">
              <Flag size={11} /> {highCount} high priority
            </div>
          )}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search tasks…"
            className="w-full bg-white border border-gray-200 rounded-lg pl-8 pr-3 py-2 text-sm text-gray-900 placeholder-gray-500 focus:outline-none focus:border-blue-500/50" />
        </div>
        <select value={filterPriority} onChange={e => setFilterPriority(e.target.value)}
          className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-600 focus:outline-none focus:border-blue-500/50">
          <option value="">All priorities</option>
          {PRIORITIES.map(p => <option key={p}>{p}</option>)}
        </select>
        <button onClick={() => setShowDone(v => !v)}
          className={`text-xs px-3 py-2 rounded-lg font-medium transition-colors whitespace-nowrap
            ${showDone ? 'bg-gray-200 text-gray-900' : 'bg-white border border-gray-200 text-gray-500 hover:text-gray-900'}`}>
          {showDone ? 'Hide done' : 'Show done'}
        </button>
      </div>

      {/* List */}
      {isLoading
        ? <div className="flex justify-center py-16"><Loader2 size={20} className="animate-spin text-blue-600" /></div>
        : (
          <div className="space-y-2">
            {filtered.map(t => (
              <TodoRow key={t.id} todo={t}
                onToggle={() => toggle(t)}
                onEdit={() => openEdit(t)}
                onDelete={() => { if (confirm('Delete this task?')) del.mutate(t.id) }}
              />
            ))}
            {!filtered.length && (
              <div className="text-center py-12 text-gray-500 text-sm">
                {showDone ? 'No tasks found' : 'All done! Nothing open.'}
              </div>
            )}
          </div>
        )
      }

      {/* Modal */}
      <Modal open={open} onClose={() => setOpen(false)} title={form.id ? 'Edit task' : 'New task'}>
        <div className="space-y-3">
          <TextArea label="Task" value={form.todo_text || ''} onChange={ef('todo_text')} rows={2} />
          <div className="grid grid-cols-2 gap-3">
            <Select label="Priority" value={form.priority || 'Normal'} onChange={ef('priority')} options={PRIORITIES} />
            <Input label="Due date" type="date" value={form.due || ''} onChange={ef('due')} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">Job (optional)</label>
            <select value={form.job_id || ''} onChange={ef('job_id')}
              className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer">
              <option value="">— No job —</option>
              {jobs.map(j => <option key={j.id} value={j.id}>{j.id} {j.client || ''}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="tddone" checked={!!form.done} onChange={e => setForm((p: any) => ({ ...p, done: e.target.checked }))} className="accent-yellow-400" />
            <label htmlFor="tddone" className="text-sm text-gray-600">Mark as done</label>
          </div>
        </div>
        <div className="flex justify-between mt-5 pt-4 border-t border-gray-200">
          <div>
            {form.id && (
              <button onClick={() => { if (confirm('Delete?')) { del.mutate(form.id); setOpen(false) } }}
                className="flex items-center gap-1.5 text-sm text-red-400 hover:text-red-300">
                <Trash2 size={14} /> Delete
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={() => setOpen(false)} className="text-sm px-4 py-2 rounded-lg bg-gray-50 text-gray-500 hover:text-gray-900">Cancel</button>
            <button onClick={save} disabled={saving} className="flex items-center gap-1.5 text-sm px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-gray-900 font-semibold disabled:opacity-50">
              {saving && <Loader2 size={13} className="animate-spin" />} Save
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
