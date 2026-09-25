import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, selectAll } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Modal } from '@/components/ui/Modal'
import JobPicker from '@/components/JobPicker'
import { Input } from '@/components/ui/Field'
import { fmtCurrency, genId, parseMilestones, incOf, today } from '@/lib/utils'
import { billingBasis } from '@/lib/jobBilling'
import { Plus, Loader2, Trash2, Copy, Check, Banknote } from 'lucide-react'
import { useBusinessSettings } from '@/pages/SettingsPage'

type Milestone = { label: string; pct: number; amount: number; dueDate: string; received: boolean; receivedDate: string }
type Row = Record<string, any>

const STRUCTURES = [
  { id: 'df',   label: 'Deposit + Final' },
  { id: 'dpf',  label: 'Deposit + Progress + Final' },
  { id: 'd2pf', label: 'Deposit + 2x Progress + Final' },
  { id: 'wk',   label: 'Weekly claims' },
]

// V16 buildMS()
function buildMS(agreed: number, struct: string, dep: number, start: string): Milestone[] {
  const inc = agreed * 1.1
  const rem = 100 - dep
  const addD = (d: string, n: number) => {
    if (!d) return ''
    const dt = new Date(d); dt.setDate(dt.getDate() + n)
    return dt.toISOString().split('T')[0]
  }
  const mk = (label: string, pct: number, dueDate: string): Milestone =>
    ({ label, pct, amount: Math.round((inc * pct) / 100), dueDate, received: false, receivedDate: '' })

  if (struct === 'df') return [mk('Deposit', dep, start), mk('Final payment', rem, '')]
  if (struct === 'dpf') return [
    mk('Deposit', dep, start),
    mk('Progress claim 50%', Math.round(rem / 2), addD(start, 7)),
    mk('Final payment', rem - Math.round(rem / 2), ''),
  ]
  if (struct === 'd2pf') return [
    mk('Deposit', dep, start),
    mk('Progress 1 — 33%', Math.round(rem / 3), addD(start, 7)),
    mk('Progress 2 — 66%', Math.round(rem / 3), addD(start, 14)),
    mk('Final payment', rem - 2 * Math.round(rem / 3), ''),
  ]
  return [
    mk('Deposit', dep, start),
    mk('Week 1 claim', Math.round(rem / 3), addD(start, 7)),
    mk('Week 2 claim', Math.round(rem / 3), addD(start, 14)),
    mk('Final payment', rem - 2 * Math.round(rem / 3), ''),
  ]
}

// Milestones are persisted as JSON in np_pay_schedules.notes
const msOf = parseMilestones

function useTable(table: string) {
  const { user } = useAuth()
  return useQuery({
    queryKey: [table, user?.id],
    queryFn: async () => {
      const { data } = await selectAll(table, user!.id)
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
      const { error } = await (supabase.from('np_pay_schedules') as any)
        .upsert({ ...row, user_id: user!.id, updated_at: new Date().toISOString() })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['np_pay_schedules'] }),
  })
}

function useDel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.from('np_pay_schedules') as any).delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['np_pay_schedules'] }),
  })
}

const INL = 'border border-transparent bg-transparent text-[12.5px] px-1 py-0.5 rounded hover:border-black/20 focus:border-[#2563eb] focus:bg-white focus:outline-none'
const BADGE = 'inline-block px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap'

export default function Payments() {
  const { data: schedules = [], isLoading } = useTable('np_pay_schedules')
  const { data: jobs = [] } = useTable('np_jobs')
  const { data: biz } = useBusinessSettings()
  const upsert = useUpsert()
  const del = useDel()

  const [q, setQ] = useState('')
  const [modal, setModal] = useState(false)
  const [jobId, setJobId] = useState('')
  const [value, setValue] = useState<number | ''>('')
  const [struct, setStruct] = useState('df')
  const [depPct, setDepPct] = useState(20)
  const [start, setStart] = useState('')

  const todayStr = new Date().toISOString().slice(0, 10)

  const filtered = useMemo(() => {
    const s = q.toLowerCase()
    if (!s) return schedules
    return schedules.filter(x => `${x.id ?? ''}${x.worker ?? ''}`.toLowerCase().includes(s))
  }, [schedules, q])

  // Same rule as each card, so the header cannot disagree with the rows: a
  // fixed job is owed the rest of its contract, an estimate only what has
  // actually been scheduled.
  const totals = filtered.reduce((acc, s) => {
    const ms = msOf(s)
    const rec = ms.reduce((b, m) => b + (m.received ? m.amount : 0), 0)
    const sched = ms.reduce((b, m) => b + (m.amount || 0), 0)
    const isFixed = billingBasis(jobs.find(j => j.id === s.id)) === 'fixed'
    const target = isFixed ? incOf(s.amount || 0) : sched
    acc.value += incOf(s.amount || 0)
    acc.received += rec
    acc.left += Math.max(0, target - rec)
    return acc
  }, { value: 0, received: 0, left: 0 })
  const overdue = filtered.reduce((a, s) => a + msOf(s).filter(m => !m.received && m.dueDate && m.dueDate < todayStr).length, 0)

  const preview = useMemo(
    () => (typeof value === 'number' && value > 0 ? buildMS(value, struct, depPct, start) : []),
    [value, struct, depPct, start],
  )

  function openNew() {
    setJobId(''); setValue(''); setStruct('df'); setDepPct(20); setStart(''); setModal(true)
  }

  async function create() {
    if (!value || value <= 0) { alert('Enter agreed value'); return }
    const j = jobs.find(x => x.id === jobId)
    const ms = buildMS(value, struct, depPct, start)
    await upsert.mutateAsync({
      id: jobId || genId('ps'),
      worker: j?.client || 'Unknown',
      amount: value,
      period_start: ms[0]?.dueDate || null,
      period_end: ms[ms.length - 1]?.dueDate || null,
      paid: false,
      notes: JSON.stringify(ms),
      created_at: new Date().toISOString(),
    })
    setModal(false)
  }

  /** Persist a changed milestone array. `paid` stays in step with the rows. */
  async function saveMs(s: Row, ms: Milestone[]) {
    await upsert.mutateAsync({
      ...s,
      notes: JSON.stringify(ms),
      paid: ms.length > 0 && ms.every(m => m.received),
      period_start: ms[0]?.dueDate || s.period_start || null,
      period_end: ms[ms.length - 1]?.dueDate || s.period_end || null,
    })
  }

  /** A one-off progress payment. pct is left at 0 — it only means something for
   *  the generated structures, and an ad-hoc amount is not a share of anything. */
  async function addPayment(s: Row) {
    const ms = msOf(s)
    ms.push({
      label: `Payment ${ms.length + 1}`, pct: 0, amount: 0,
      dueDate: today(), received: false, receivedDate: '',
    })
    await saveMs(s, ms)
  }

  async function patchMilestone(s: Row, idx: number, patch: Partial<Milestone>) {
    const ms = msOf(s)
    if (!ms[idx]) return
    ms[idx] = { ...ms[idx], ...patch }
    await saveMs(s, ms)
  }

  async function removeMilestone(s: Row, idx: number) {
    const ms = msOf(s)
    if (!confirm(`Remove "${ms[idx]?.label || 'this payment'}"?`)) return
    ms.splice(idx, 1)
    await saveMs(s, ms)
  }

  async function setReceived(s: Row, idx: number, received: boolean) {
    const ms = msOf(s)
    ms[idx] = {
      ...ms[idx], received,
      receivedDate: received ? new Date().toLocaleDateString('en-AU') : '',
    }
    await upsert.mutateAsync({ ...s, notes: JSON.stringify(ms), paid: ms.every(m => m.received) })
  }

  // V16 copyPayMsg()
  async function copyMsg(s: Row) {
    const ms = msOf(s)
    const next = ms.find(m => !m.received)
    if (!next) { alert('All received!'); return }
    const bsb = biz?.bsb || ''
    const acc = biz?.account_no || ''
    const msg = `Hi ${s.worker},\n\nPayment reminder:\n${next.label}: ${fmtCurrency(next.amount)} inc GST${next.dueDate ? `\nDue: ${next.dueDate}` : ''}\n\n${bsb ? `BSB: ${bsb}\n` : ''}${acc ? `Acc: ${acc}\n` : ''}Ref: ${s.id}\n\nThanks,\n${biz?.company_name || 'Northern Painters'}${biz?.licence ? `\nLic ${biz.licence}` : ''}${biz?.abn ? ` | ABN ${biz.abn}` : ''}`
    try { await navigator.clipboard.writeText(msg); alert('Copied!') }
    catch { prompt('Copy:', msg) }
  }

  if (isLoading) return (
    <div className="flex items-center justify-center h-64"><Loader2 size={20} className="animate-spin text-blue-600" /></div>
  )

  return (
    <div className="p-5">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <h2 className="text-[17px] font-semibold text-gray-900">Payment Schedules</h2>
        <button onClick={openNew}
          className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white font-medium text-[13px] px-3 py-1.5 rounded-lg">
          <Plus size={14} /> New Schedule
        </button>
      </div>

      <div className="grid gap-2.5 mb-3.5" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))' }}>
        {[
          { l: 'Job value (inc GST)', v: fmtCurrency(totals.value), c: '#2563eb' },
          { l: 'Received', v: fmtCurrency(totals.received), c: '#16a34a' },
          { l: 'Left to pay', v: fmtCurrency(totals.left), c: '#d97706' },
          { l: 'Overdue', v: String(overdue), c: overdue ? '#dc2626' : undefined },
        ].map(m => (
          <div key={m.l} className="bg-[#f5f4f0] rounded-lg px-4 py-3.5">
            <div className="text-[11px] text-[#666] mb-1">{m.l}</div>
            <div className="text-xl font-semibold" style={m.c ? { color: m.c } : undefined}>{m.v}</div>
          </div>
        ))}
      </div>

      <div className="mb-2.5">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="🔍 Search job, client…"
          className="w-60 px-2.5 py-2 text-[13px] bg-white border border-black/20 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500" />
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white border border-black/[0.12] rounded-xl text-center py-8 text-[#666]">
          <Banknote size={32} className="mx-auto mb-2.5 opacity-30" />
          No payment schedules {q ? 'match your search.' : 'yet.'}
        </div>
      ) : filtered.map(s => {
        const ms = msOf(s)
        const received = ms.reduce((a, m) => a + (m.received ? m.amount : 0), 0)
        const scheduled = ms.reduce((a, m) => a + (m.amount || 0), 0)
        const job = jobs.find(j => j.id === s.id)
        // A fixed quote has to add up to the contract; an estimate is open-ended,
        // so the final total does not have to match what was estimated.
        const isFixed = billingBasis(job) === 'fixed'
        const contractIncGST = incOf(s.amount || 0)
        // Progress is measured against the contract on a fixed job, and against
        // what has actually been scheduled on an estimate.
        const target = isFixed ? contractIncGST : scheduled
        const leftToPay = Math.max(0, target - received)
        const pct = target ? Math.round((received / target) * 100) : 0
        const allDone = ms.length > 0 && ms.every(m => m.received)
        const unallocated = contractIncGST - scheduled
        return (
          <div key={s.id} className="bg-white border border-black/[0.12] rounded-xl p-4 mb-3.5">
            <div className="flex justify-between items-start mb-2.5 flex-wrap gap-2">
              <div>
                <div className="text-[15px] font-semibold flex items-center gap-2 flex-wrap">
                  {s.id} — {s.worker}
                  <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${
                    isFixed ? 'bg-[#e0f2fe] text-[#0369a1]' : 'bg-[#fef3c7] text-[#92400e]'}`}>
                    {isFixed ? 'Fixed price' : 'Estimate / hourly'}
                  </span>
                </div>
                <div className="text-xs text-[#666]">{job?.job_desc || ''} · {fmtCurrency(s.amount)} ex GST</div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => copyMsg(s)}
                  className="flex items-center gap-1 px-2.5 py-1 text-[11px] bg-white border border-black/20 rounded-lg hover:bg-[#f5f4f0]">
                  <Copy size={11} /> Msg
                </button>
                <button onClick={() => { if (confirm('Delete this schedule?')) del.mutate(s.id) }}
                  className="flex items-center gap-1 px-2.5 py-1 text-[11px] bg-white border border-black/20 rounded-lg hover:bg-[#f5f4f0] text-[#c0392b]">
                  <Trash2 size={11} />
                </button>
              </div>
            </div>

            <div className="grid gap-2 mb-2.5" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))' }}>
              {([
                [isFixed ? 'Quoted inc GST' : 'Estimated inc GST', fmtCurrency(contractIncGST), '#2563eb'],
                ['Scheduled', fmtCurrency(scheduled), undefined],
                ['Received', fmtCurrency(received), '#16a34a'],
                ['Left to pay', leftToPay > 0 ? fmtCurrency(leftToPay) : 'Paid in full', leftToPay > 0 ? '#d97706' : '#16a34a'],
              ] as [string, string, string | undefined][]).map(([l, v, c]) => (
                <div key={l} className="bg-[#f5f4f0] border border-black/[0.12] rounded-lg px-2.5 py-2">
                  <div className="text-[10px] font-bold uppercase text-[#666] tracking-wide mb-0.5">{l}</div>
                  <div className="text-[14px] font-bold" style={c ? { color: c } : undefined}>{v}</div>
                </div>
              ))}
            </div>

            {isFixed ? (
              Math.abs(unallocated) >= 1 && (
                <div className="text-[11px] mb-2 px-2.5 py-1.5 rounded-lg bg-[#fffbeb] border border-[#fbbf24] text-[#92400e]">
                  {unallocated > 0
                    ? <>Schedule totals {fmtCurrency(scheduled)} of {fmtCurrency(contractIncGST)} quoted — <b>{fmtCurrency(unallocated)} not yet scheduled</b>.</>
                    : <>Schedule totals {fmtCurrency(scheduled)}, which is <b>{fmtCurrency(-unallocated)} over</b> the {fmtCurrency(contractIncGST)} quoted.</>}
                </div>
              )
            ) : (
              <div className="text-[11px] mb-2 text-[#666]">
                Estimated {fmtCurrency(contractIncGST)} inc GST — payments do not have to add up to it.
              </div>
            )}

            <div className="h-1.5 bg-black/[0.12] rounded-[3px] overflow-hidden">
              <div className="h-full rounded-[3px] transition-all"
                style={{ width: `${Math.min(pct, 100)}%`, background: allDone ? '#0a7c4e' : '#2563eb' }} />
            </div>

            <table className="w-full border-collapse text-[12.5px] mt-2.5">
              <thead>
                <tr>
                  {['Milestone','Amount inc GST','Due','Status',''].map((h, i) => (
                    <th key={i} className="px-2 py-1.5 text-left border-b border-black/[0.12] text-[#666] font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ms.map((m, mi) => {
                  const od = !m.received && !!m.dueDate && m.dueDate < todayStr
                  return (
                    <tr key={mi} style={od ? { background: '#fff5f5' } : undefined}>
                      <td className="px-2 py-1.5 border-b border-black/[0.06]">
                        <input defaultValue={m.label} placeholder="Payment"
                          onBlur={e => { if (e.target.value !== m.label) patchMilestone(s, mi, { label: e.target.value }) }}
                          className={INL} />
                      </td>
                      <td className="px-2 py-1.5 border-b border-black/[0.06] font-medium">
                        <input type="number" min={0} step="0.01" defaultValue={m.amount || ''} placeholder="0"
                          onBlur={e => {
                            const v = parseFloat(e.target.value) || 0
                            if (v !== m.amount) patchMilestone(s, mi, { amount: v })
                          }}
                          className={`${INL} w-24 text-right font-mono`} />
                      </td>
                      <td className="px-2 py-1.5 border-b border-black/[0.06]" style={od ? { color: '#c0392b' } : undefined}>
                        <input type="date" defaultValue={m.dueDate || ''}
                          onBlur={e => { if (e.target.value !== m.dueDate) patchMilestone(s, mi, { dueDate: e.target.value }) }}
                          className={`${INL} w-32`} />
                      </td>
                      <td className="px-2 py-1.5 border-b border-black/[0.06]">
                        {m.received
                          ? <span className={`${BADGE} bg-[#dcfce7] text-[#166534]`}>Received {m.receivedDate}</span>
                          : od
                            ? <span className={`${BADGE} bg-[#fee2e2] text-[#991b1b]`}>Overdue</span>
                            : <span className={`${BADGE} bg-[#fef3c7] text-[#92400e]`}>Pending</span>}
                      </td>
                      <td className="px-2 py-1.5 border-b border-black/[0.06]">
                        {!m.received ? (
                          <button onClick={() => setReceived(s, mi, true)}
                            className="flex items-center gap-1 px-2 py-1 text-[11px] rounded-md bg-[#dcfce7] text-[#166534] border border-[#dcfce7] hover:brightness-95">
                            <Check size={11} /> Received
                          </button>
                        ) : (
                          <button onClick={() => setReceived(s, mi, false)}
                            className="px-2 py-1 text-[11px] rounded-md bg-white border border-black/20 hover:bg-[#f5f4f0]">Undo</button>
                        )}
                        <button onClick={() => removeMilestone(s, mi)} title="Remove this payment"
                          className="ml-1 px-1.5 py-1 text-[11px] rounded-md bg-white border border-black/20 hover:bg-[#f5f4f0] text-[#c0392b]">
                          <Trash2 size={11} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            <button onClick={() => addPayment(s)}
              className="mt-2 flex items-center gap-1 px-2.5 py-1 text-[11px] bg-white border border-dashed border-[#2563eb] text-[#2563eb] rounded-lg hover:bg-blue-50">
              <Plus size={11} /> Add payment
            </button>
          </div>
        )
      })}

      {/* New schedule modal */}
      <Modal open={modal} onClose={() => setModal(false)} size="lg" title="New Payment Schedule">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-500 mb-1">Job</label>
            <JobPicker jobs={jobs} value={jobId} label={null} noneLabel="— Select job —"
              onChange={(id, j) => {
                setJobId(id)
                if ((j as any)?.agreed_ex_gst) setValue((j as any).agreed_ex_gst)
              }} />
          </div>
          <Input label="Agreed value (ex GST)" type="number" value={value}
            onChange={e => setValue(e.target.value === '' ? '' : parseFloat(e.target.value) || 0)} />
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Structure</label>
            <select value={struct} onChange={e => setStruct(e.target.value)}
              className="w-full bg-white border border-black/20 rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-blue-500">
              {STRUCTURES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
          <Input label="Deposit %" type="number" value={depPct} onChange={e => setDepPct(parseFloat(e.target.value) || 0)} />
          <Input label="Start date" type="date" value={start} onChange={e => setStart(e.target.value)} />
        </div>

        {preview.length > 0 && (
          <table className="w-full border-collapse text-[13px] mt-3.5">
            <thead>
              <tr>
                {['Milestone','Amount inc GST','Due'].map(h => (
                  <th key={h} className="px-1.5 py-1 text-left border-b border-black/[0.12] text-[#666] font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.map((m, i) => (
                <tr key={i}>
                  <td className="px-1.5 py-1">{m.label}</td>
                  <td className="px-1.5 py-1 font-medium">{fmtCurrency(m.amount)}</td>
                  <td className="px-1.5 py-1">{m.dueDate || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-black/10">
          <button onClick={() => setModal(false)} className="px-4 py-2 text-[13px] rounded-lg bg-[#f5f4f0] text-gray-600 border border-black/10 hover:bg-gray-200">Cancel</button>
          <button onClick={create} className="px-5 py-2 text-[13px] rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold">Create</button>
        </div>
      </Modal>
    </div>
  )
}
