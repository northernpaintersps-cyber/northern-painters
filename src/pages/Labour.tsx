import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, selectAll } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Modal } from '@/components/ui/Modal'
import JobPicker from '@/components/JobPicker'
import { Input, Select } from '@/components/ui/Field'
import {
  fmtCurrency, genId, today, labBillable, labCost, isBillableLabour,
  findOverlappingLabour, labourSpan, jobBillingType, type LabourOverlap,
} from '@/lib/utils'
import { Plus, Loader2, Trash2, ArrowUpDown, X, Clock, AlertTriangle } from 'lucide-react'

type Row = Record<string, any>

const BILLING = ['Hourly', 'Hourly/Estimate', 'Fixed Quote']
const II = 'border-none bg-transparent text-[12.5px] w-full focus:outline-none focus:bg-blue-50/60 rounded px-0.5'
const IS = 'border-none bg-transparent text-xs cursor-pointer focus:outline-none'

// labBillable / labCost / isBillableLabour now live in lib/utils so the billing
// calculation and this page cannot drift apart.
const isBill = isBillableLabour

// Hours between two HH:MM times, minus an optional break in minutes
function hoursBetween(from: string, to: string, breakMins = 0) {
  if (!from || !to) return 0
  const [fh, fm] = from.split(':').map(Number)
  const [th, tm] = to.split(':').map(Number)
  let mins = (th * 60 + tm) - (fh * 60 + fm)
  if (mins < 0) mins += 24 * 60
  return Math.max(0, (mins - breakMins) / 60)
}

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
      const payload: Row = { ...row, user_id: user!.id, updated_at: new Date().toISOString() }
      const { error } = await (supabase.from('np_labour') as any).upsert(payload)
      if (!error) return
      // period_start / period_end are new. Until they are added in Supabase the
      // rest of the entry must still save, so drop them and retry once.
      const missing = error.message?.match(/Could not find the '(\w+)' column/)?.[1]
      if (missing && (missing === 'period_start' || missing === 'period_end')) {
        delete payload.period_start; delete payload.period_end
        const retry = await (supabase.from('np_labour') as any).upsert(payload)
        if (retry.error) throw retry.error
        return
      }
      throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['np_labour'] }),
  })
}

function useDel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.from('np_labour') as any).delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['np_labour'] }),
  })
}

export default function Labour() {
  const { user } = useAuth()
  const { data: rows = [], isLoading } = useTable('np_labour')
  const { data: jobs = [] } = useTable('np_jobs')
  const { data: crew = [] } = useTable('np_crew')
  const upsert = useUpsert()
  const del = useDel()

  const { data: settings } = useQuery({
    queryKey: ['np_settings', 'business', user?.id],
    queryFn: async () => {
      const { data } = await (supabase.from('np_settings') as any)
        .select('value').eq('user_id', user!.id).eq('key', 'business').maybeSingle()
      return (data?.value ?? {}) as any
    },
    enabled: !!user,
  })
  const rate0 = settings?.rates?.standard ?? 65
  const charge0 = settings?.rates?.charge_rate ?? 95

  const [q, setQ] = useState('')
  const [jobId, setJobId] = useState('')
  const [billing, setBilling] = useState('')
  const [asc, setAsc] = useState(false)
  const [modal, setModal] = useState(false)
  const [mode, setMode] = useState<'hours' | 'clock'>('hours')
  const [form, setForm] = useState<Row>({})
  const [overlap, setOverlap] = useState<LabourOverlap<Row> | null>(null)

  const anyFilter = !!(q || jobId || billing)

  const labs = useMemo(() => {
    let list = rows
    if (q) {
      const s = q.toLowerCase()
      list = list.filter(l => [l.sub, l.client, l.job_id, l.notes].some(v => (v || '').toLowerCase().includes(s)))
    }
    if (jobId) list = list.filter(l => l.job_id === jobId)
    if (billing) list = list.filter(l => (l.billing_type || 'Fixed Quote') === billing)
    return [...list].sort((a, b) => {
      const da = a.date || '', db = b.date || ''
      return asc ? (da < db ? -1 : da > db ? 1 : 0) : (da > db ? -1 : da < db ? 1 : 0)
    })
  }, [rows, q, jobId, billing, asc])

  const totCost = labs.reduce((a, b) => a + labCost(b), 0)
  const totBill = labs.reduce((a, b) => a + labBillable(b), 0)
  const hBill = labs.filter(isBill).reduce((a, b) => a + labBillable(b), 0)
  const hCost = labs.filter(isBill).reduce((a, b) => a + labCost(b), 0)
  const labMargin = hBill > 0 ? ((hBill - hCost) / hBill) * 100 : 0

  // Inline edit — recompute cost and billable the way V16 does
  function quick(l: Row, patch: Row) {
    const next = { ...l, ...patch }
    const hours = next.hours || 0
    next.cost = hours * (next.rate || 0)
    next.billable = hours * (next.charge_rate ?? next.rate ?? 0)
    upsert.mutate(next)
  }

  function openNew() {
    setMode('hours')
    setForm({
      date: today(), rate: rate0, charge_rate: charge0,
      billing_type: 'Hourly', worker_payment_type: 'ABN',
      clock_in: '08:00', clock_out: '17:00', break_mins: 30, hours: '',
      period_start: '', period_end: '',
    })
    setOverlap(null)
    setModal(true)
  }

  /** Re-check for an overlapping entry whenever a field that defines the span
   *  changes. Batching means a shared date proves nothing, so only the period
   *  and the worker/job pairing are considered. */
  function setField(patch: Row) {
    setForm(p => {
      const next = { ...p, ...patch }
      setOverlap(findOverlappingLabour(rows, next, next.id))
      return next
    })
  }

  const formHours = mode === 'clock'
    ? hoursBetween(form.clock_in, form.clock_out, parseFloat(form.break_mins) || 0)
    : (parseFloat(form.hours) || 0)

  async function save() {
    if (!form.sub?.trim()) { alert('Worker name required'); return }
    const hours = formHours
    const rate = parseFloat(form.rate) || 0
    const chargeRate = parseFloat(form.charge_rate) || rate
    const job = jobs.find(j => j.id === form.job_id)
    await upsert.mutateAsync({
      ...form,
      id: form.id || genId('lab'),
      hours,
      rate,
      charge_rate: chargeRate,
      cost: hours * rate,
      billable: hours * chargeRate,
      client: job?.client ?? form.client ?? null,
      clock_in: mode === 'clock' ? form.clock_in : null,
      clock_out: mode === 'clock' ? form.clock_out : null,
      period_start: form.period_start || null,
      period_end: form.period_end || form.period_start || null,
      created_at: form.created_at || new Date().toISOString(),
    })
    setModal(false)
  }

  if (isLoading) return (
    <div className="flex items-center justify-center h-64"><Loader2 size={20} className="animate-spin text-blue-600" /></div>
  )

  return (
    <div className="p-5">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <h2 className="text-[17px] font-semibold text-gray-900">Labour Log</h2>
        <button onClick={openNew}
          className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white font-medium text-[13px] px-3 py-1.5 rounded-lg">
          <Plus size={14} /> Log Labour
        </button>
      </div>

      <div className="grid gap-2.5 mb-3.5" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))' }}>
        {[
          { l: 'Total cost (paid out)', v: fmtCurrency(totCost) },
          { l: 'Total billable (to clients)', v: fmtCurrency(totBill), c: '#2563eb' },
          { l: 'Labour margin', v: `${labMargin.toFixed(1)}%`, c: labMargin >= 20 ? '#16a34a' : labMargin >= 0 ? '#d97706' : '#dc2626' },
          { l: 'Gross profit (hourly jobs)', v: fmtCurrency(hBill - hCost), c: '#16a34a' },
        ].map(m => (
          <div key={m.l} className="bg-[#f5f4f0] rounded-lg px-4 py-3.5">
            <div className="text-[11px] text-[#666] mb-1">{m.l}</div>
            <div className="text-xl font-semibold" style={m.c ? { color: m.c } : undefined}>{m.v}</div>
          </div>
        ))}
      </div>

      <div className="bg-white border border-black/[0.12] rounded-xl px-3.5 py-3 mb-2.5">
        <div className="flex gap-2 flex-wrap items-center">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="🔍 Search worker, job, notes…"
            className="flex-[2] min-w-[180px] px-2.5 py-2 text-[13px] bg-white border border-black/20 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500" />
          <select value={jobId} onChange={e => setJobId(e.target.value)}
            className="flex-1 min-w-[150px] px-2.5 py-2 text-[13px] bg-white border border-black/20 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500">
            <option value="">All jobs</option>
            {jobs.map(j => <option key={j.id} value={j.id}>{j.id} — {j.client}</option>)}
          </select>
          <select value={billing} onChange={e => setBilling(e.target.value)}
            className="flex-1 min-w-[130px] px-2.5 py-2 text-[13px] bg-white border border-black/20 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500">
            <option value="">All billing types</option>
            {BILLING.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
          <button onClick={() => setAsc(a => !a)}
            className="flex items-center gap-1 px-2.5 py-2 text-[13px] bg-white border border-black/20 rounded-lg hover:bg-[#f5f4f0] whitespace-nowrap">
            <ArrowUpDown size={13} /> {asc ? 'Oldest first' : 'Newest first'}
          </button>
          {anyFilter && (
            <button onClick={() => { setQ(''); setJobId(''); setBilling('') }}
              className="flex items-center gap-1 px-2.5 py-2 text-[13px] bg-white border border-black/20 rounded-lg hover:bg-[#f5f4f0] text-[#c0392b]">
              <X size={13} /> Clear
            </button>
          )}
        </div>
      </div>

      <div className="bg-white border border-black/[0.12] rounded-xl overflow-hidden">
        <div className="overflow-auto max-h-[70vh]">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr>
                {[
                  { h: 'Date' }, { h: 'Job / Client' }, { h: 'Sub / Worker' }, { h: 'Hrs' },
                  { h: 'Cost/hr', c: '#64748b' }, { h: 'Cost', c: '#64748b' },
                  { h: 'Charge/hr', c: '#2563eb' }, { h: 'Billable', c: '#2563eb' },
                  { h: 'Billing' }, { h: 'W.Pay' }, { h: 'Paid?' }, { h: 'Notes' }, { h: '' },
                ].map((c, i) => (
                  <th key={i} className="text-left px-2.5 py-[7px] border-b border-black/[0.12] font-medium whitespace-nowrap bg-[#fafaf8] sticky top-0 z-[2]"
                    style={{ color: c.c ?? '#666' }}>{c.h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {labs.map(l => {
                const cr = l.charge_rate ?? l.rate ?? 0
                const bill = labBillable(l)
                const cost = labCost(l)
                const mg = isBill(l) && bill > 0 ? ((bill - cost) / bill) * 100 : null
                const job = jobs.find(j => j.id === l.job_id)
                return (
                  <tr key={l.id} className="border-b border-black/[0.06] hover:bg-[#fafaf8]">
                    <td className="px-2.5 py-[7px]">
                      <input type="date" defaultValue={l.date ?? ''} className={II} style={{ width: 110 }}
                        onBlur={e => { if (e.target.value !== (l.date ?? '')) upsert.mutate({ ...l, date: e.target.value || null }) }} />
                    </td>
                    <td className="px-2.5 py-[7px]" style={{ minWidth: 110 }}>
                      <select value={l.job_id ?? ''} className={`${IS} max-w-[120px]`}
                        onChange={e => {
                          const j = jobs.find(x => x.id === e.target.value)
                          upsert.mutate({ ...l, job_id: e.target.value || null, client: j?.client ?? null })
                        }}>
                        <option value="">—</option>
                        {jobs.map(j => <option key={j.id} value={j.id}>{j.id} — {j.client}</option>)}
                      </select>
                      <div className="text-[10px] text-[#666] mt-0.5 truncate max-w-[120px]">{job?.client || l.client || ''}</div>
                    </td>
                    <td className="px-2.5 py-[7px]">
                      <input defaultValue={l.sub ?? ''} className={II} style={{ width: 90 }}
                        onBlur={e => { if (e.target.value !== (l.sub ?? '')) upsert.mutate({ ...l, sub: e.target.value }) }} />
                    </td>
                    <td className="px-2.5 py-[7px]">
                      <input type="number" step="0.5" defaultValue={l.hours ?? 0} className={II} style={{ width: 44 }}
                        onBlur={e => {
                          const v = parseFloat(e.target.value) || 0
                          if (v !== (l.hours ?? 0)) quick(l, { hours: v })
                        }} />
                    </td>
                    <td className="px-2.5 py-[7px]" style={{ color: '#64748b' }}>
                      <input type="number" defaultValue={l.rate ?? 0} className={II} style={{ width: 52 }}
                        onBlur={e => {
                          const v = parseFloat(e.target.value) || 0
                          if (v !== (l.rate ?? 0)) quick(l, { rate: v })
                        }} />
                    </td>
                    <td className="px-2.5 py-[7px] font-semibold" style={{ color: '#64748b' }}>{fmtCurrency(cost)}</td>
                    <td className="px-2.5 py-[7px]" style={{ color: '#2563eb' }}>
                      <input type="number" defaultValue={cr} className={II} style={{ width: 52, color: '#2563eb' }}
                        onBlur={e => {
                          const v = parseFloat(e.target.value) || 0
                          if (v !== cr) quick(l, { charge_rate: v })
                        }} />
                    </td>
                    <td className="px-2.5 py-[7px] font-bold" style={{ color: '#2563eb' }}>
                      {fmtCurrency(bill)}
                      {mg !== null && (
                        <div className="text-[9px] font-semibold" style={{ color: mg >= 20 ? '#16a34a' : '#d97706' }}>{mg.toFixed(0)}% margin</div>
                      )}
                    </td>
                    <td className="px-2.5 py-[7px]">
                      <select value={l.billing_type ?? 'Hourly'} className={`${IS} text-[11px]`}
                        onChange={e => upsert.mutate({ ...l, billing_type: e.target.value })}>
                        {BILLING.map(b => <option key={b} value={b}>{b}</option>)}
                      </select>
                    </td>
                    <td className="px-2.5 py-[7px]">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${
                        l.worker_payment_type === 'Cash' ? 'bg-[#fef3c7] text-[#92400e]' : 'bg-[#dcfce7] text-[#166534]'}`}>
                        {l.worker_payment_type === 'Cash' ? 'Cash' : 'ABN'}
                      </span>
                    </td>
                    <td className="px-2.5 py-[7px]">
                      <select value={l.paid ? '1' : '0'} className={IS}
                        onChange={e => upsert.mutate({ ...l, paid: e.target.value === '1' })}>
                        <option value="0">No</option>
                        <option value="1">Yes</option>
                      </select>
                    </td>
                    <td className="px-2.5 py-[7px]">
                      <input defaultValue={l.notes ?? ''} placeholder="Notes…" className={II} style={{ width: 80 }}
                        onBlur={e => { if (e.target.value !== (l.notes ?? '')) upsert.mutate({ ...l, notes: e.target.value }) }} />
                    </td>
                    <td className="px-2.5 py-[7px]">
                      <button onClick={() => { if (confirm('Delete this entry?')) del.mutate(l.id) }}
                        className="px-1.5 py-1 rounded-md bg-white border border-black/20 hover:bg-[#f5f4f0] text-[#c0392b]"><Trash2 size={12} /></button>
                    </td>
                  </tr>
                )
              })}
              {labs.length === 0 && (
                <tr><td colSpan={13} className="text-center text-[#666] py-6">No labour entries match your filters.</td></tr>
              )}
            </tbody>
            {labs.length > 0 && (
              <tfoot>
                <tr className="bg-[#fafaf8] font-semibold">
                  <td colSpan={5} className="px-2.5 py-2 text-right">Totals</td>
                  <td className="px-2.5 py-2" style={{ color: '#64748b' }}>{fmtCurrency(totCost)}</td>
                  <td className="px-2.5 py-2" />
                  <td className="px-2.5 py-2" style={{ color: '#2563eb' }}>{fmtCurrency(totBill)}</td>
                  <td colSpan={5} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      <Modal open={modal} onClose={() => setModal(false)} size="lg" title="Log Labour">
        {/* Hours vs clock in/out */}
        <div className="flex gap-[3px] bg-[#f5f4f0] border border-black/[0.12] rounded-lg p-[3px] mb-3 w-fit">
          {([['hours', 'Enter hours'], ['clock', 'Clock in / out']] as const).map(([id, label]) => (
            <button key={id} onClick={() => setMode(id)}
              className={`flex items-center gap-1 text-xs px-3 py-1.5 rounded-md ${mode === id ? 'bg-blue-600 text-white' : 'text-[#666]'}`}>
              {id === 'clock' && <Clock size={12} />} {label}
            </button>
          ))}
        </div>

        {overlap && (
          <div className="flex gap-2 items-start bg-[#fffbeb] border border-[#fbbf24] rounded-lg px-3.5 py-2.5 mb-3.5">
            <AlertTriangle size={18} className="text-[#b45309] shrink-0 mt-px" />
            <div className="text-xs text-[#78350f]">
              <strong className="text-[13px] text-[#b45309] block">
                {overlap.identical ? 'Same hours already logged' : 'Overlapping period already logged'}
              </strong>
              {overlap.row.sub} already has {overlap.row.hours}h
              {overlap.row.job_id ? ` on ${overlap.row.job_id}` : ''} covering{' '}
              {(() => { const sp = labourSpan(overlap.row); return sp ? (sp.from === sp.to ? sp.from : `${sp.from} to ${sp.to}`) : '' })()}
              {overlap.identical
                ? ' — the same span and hours, so this looks like the same entry twice.'
                : ' — those dates overlap, so some hours may be counted twice.'}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Input label="Date entered" type="date" value={form.date || ''}
            onChange={e => setField({ date: e.target.value })} />
          <JobPicker jobs={jobs} value={form.job_id}
            noneLabel="— Select job —"
            onChange={(id, j) => setField({
              job_id: id,
              client: j?.client ?? form.client,
              // The job decides how it is billed; still editable below.
              ...(j ? { billing_type: jobBillingType(j as any) } : {}),
            })} />
          {/* Hours are often batched — a week entered on the Friday — so the
              date above says nothing about when the work happened. */}
          <Input label="Hours cover from" type="date" value={form.period_start || ''}
            onChange={e => setField({ period_start: e.target.value })} />
          <Input label="Hours cover to" type="date" value={form.period_end || ''}
            onChange={e => setField({ period_end: e.target.value })} />

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Sub / Worker</label>
            <input list="crew-names" value={form.sub || ''}
              onChange={e => {
                const name = e.target.value
                const c = crew.find(x => x.name === name)
                setForm(p => ({ ...p, sub: name, rate: c?.rate ?? p.rate, charge_rate: c?.charge_rate ?? p.charge_rate }))
              }}
              className="w-full bg-white border border-black/20 rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-blue-500" />
            <datalist id="crew-names">{crew.map(c => <option key={c.id} value={c.name} />)}</datalist>
          </div>
          <Select label="Worker payment type" value={form.worker_payment_type || 'ABN'}
            onChange={e => setForm(p => ({ ...p, worker_payment_type: e.target.value }))} options={['ABN', 'Cash']} />

          {mode === 'clock' ? (
            <>
              <Input label="Clock in" type="time" value={form.clock_in || ''} onChange={e => setForm(p => ({ ...p, clock_in: e.target.value }))} />
              <Input label="Clock out" type="time" value={form.clock_out || ''} onChange={e => setForm(p => ({ ...p, clock_out: e.target.value }))} />
              <Input label="Break (minutes)" type="number" value={form.break_mins ?? 30} onChange={e => setForm(p => ({ ...p, break_mins: e.target.value }))} />
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Hours worked</label>
                <div className="px-3 py-2 text-[13px] bg-[#f5f4f0] border border-black/10 rounded-lg font-mono font-semibold">
                  {formHours.toFixed(2)} h
                </div>
              </div>
            </>
          ) : (
            <Input label="Hours" type="number" step="0.5" value={form.hours ?? ''} onChange={e => setForm(p => ({ ...p, hours: e.target.value }))} />
          )}

          <Input label="Cost rate ($/hr — what you pay)" type="number" value={form.rate ?? ''} onChange={e => setForm(p => ({ ...p, rate: e.target.value }))} />
          <Input label="Charge rate ($/hr — what you bill)" type="number" value={form.charge_rate ?? ''} onChange={e => setForm(p => ({ ...p, charge_rate: e.target.value }))} />
          <Select label="Billing type" value={form.billing_type || 'Hourly'} onChange={e => setForm(p => ({ ...p, billing_type: e.target.value }))} options={BILLING} />
          <Input label="Description" value={form.labour_desc || ''} onChange={e => setForm(p => ({ ...p, labour_desc: e.target.value }))} />
          <Input label="Notes" value={form.notes || ''} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} wrapperClassName="col-span-2" />
        </div>

        <div className="flex justify-between items-center mt-4 pt-3 border-t border-black/10 text-[13px]">
          <div className="text-[#666]">
            Cost <span className="font-semibold text-gray-900">{fmtCurrency(formHours * (parseFloat(form.rate) || 0))}</span>
            <span className="mx-2">·</span>
            Billable <span className="font-semibold text-[#2563eb]">{fmtCurrency(formHours * (parseFloat(form.charge_rate) || parseFloat(form.rate) || 0))}</span>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setModal(false)} className="px-4 py-2 text-[13px] rounded-lg bg-[#f5f4f0] text-gray-600 border border-black/10 hover:bg-gray-200">Cancel</button>
            <button onClick={save} className="px-5 py-2 text-[13px] rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold">Save</button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
