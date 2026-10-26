// Everything about one job, in one place.
//
// The job's facts were spread across a modal's eight tabs, the Costs page,
// the Invoices page and the calendar, and the one question you most want
// answered — what has been billed and what is still to bill — could only be
// answered by opening an invoice and reading the line picker.
//
// The hard part was already done: invoiceableLines marks every logged entry
// billed or not and names the invoice that took it. This is where that gets
// shown.
//
// ── Money in and money out never share a row ────────────────
//
// A labour entry has two figures: what it cost you and what the client is
// charged for it, and they are not the same number. Mixing them is how a
// job looks profitable when it is not. So the page keeps them apart
// everywhere: two separate columns in the header, two separate columns in
// the table, slate for cost and blue for charge throughout, and the only
// place they meet is the margin between them.

import { useMemo, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { selectAll } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import {
  fmtCurrency, fmtDate, calcOwed, invStatus, parseMilestones,
  getJobScheduledDates, crewLabel, isCashJob, jobGstRate, labCost,
} from '@/lib/utils'
import {
  computeJobBilling, invoiceableLines, billingBreakdown, unbilledSummary,
  type InvoiceableLine,
} from '@/lib/jobBilling'
import { jobHours, hoursColour, hoursLabel } from '@/lib/hours'
import { jobPhases, splitHours, type PhaseHours } from '@/lib/phases'
import { jobAddOns } from '@/lib/invoiceLines'
import { jobExposure, EXPOSURE_LABELS, EXPOSURE_TAG, isExposed } from '@/lib/exposure'
import { handOff } from '@/lib/handoff'
import { useBusinessSettings } from '@/pages/SettingsPage'
import InfoTip, { TipCalc } from '@/components/InfoTip'
import JobModal from '@/components/JobModal'
import {
  Loader2, ArrowLeft, Edit2, FileText, Plus, Clock, Package, Users,
  CalendarDays, Receipt, Camera, AlertTriangle, Check,
} from 'lucide-react'

type Row = Record<string, any>

/** Cost is what you pay. Charge is what the client pays. Never the same colour. */
const COST = '#64748b'
const CHARGE = '#2563eb'
const GOOD = '#16a34a'
const BAD = '#dc2626'

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

function Card({ title, right, children, className = '' }: {
  title?: React.ReactNode; right?: React.ReactNode
  children: React.ReactNode; className?: string
}) {
  return (
    <div className={`bg-white border border-black/[0.12] rounded-xl ${className}`}>
      {title && (
        <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-black/[0.08]">
          <div className="text-[13px] font-bold text-gray-900 flex items-center gap-1.5">{title}</div>
          {right}
        </div>
      )}
      <div className="px-4 py-3">{children}</div>
    </div>
  )
}

/** A figure with its label. `tone` carries the cost/charge distinction. */
function Figure({ label, value, tone, sub, strong, help }: {
  label: string; value: string; tone?: string
  sub?: React.ReactNode; strong?: boolean; help?: React.ReactNode
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-[3px]">
      <span className={`text-[11.5px] ${strong ? 'font-semibold text-gray-900' : 'text-[#666]'} flex items-center gap-1`}>
        {label}{help && <InfoTip title={label}>{help}</InfoTip>}
      </span>
      <span className="text-right">
        <span className={`tabular-nums ${strong ? 'text-[15px] font-bold' : 'text-[13px] font-medium'}`}
          style={tone ? { color: tone } : undefined}>{value}</span>
        {sub && <span className="block text-[10px] text-[#666]">{sub}</span>}
      </span>
    </div>
  )
}

const Bar = ({ pct, colour }: { pct: number; colour: string }) => (
  <div className="h-1.5 rounded-full bg-black/[0.07] overflow-hidden">
    <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: colour }} />
  </div>
)

export default function JobDashboard() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const { data: biz } = useBusinessSettings()

  const { data: jobs = [], isLoading } = useTable('np_jobs')
  const { data: invoices = [] } = useTable('np_invoices')
  const { data: labour = [] } = useTable('np_labour')
  const { data: materials = [] } = useTable('np_materials')
  const { data: variations = [] } = useTable('np_variations')
  const { data: schedules = [] } = useTable('np_pay_schedules')
  const { data: assignments = [] } = useTable('np_assignments')
  const { data: crew = [] } = useTable('np_crew')
  const { data: receipts = [] } = useTable('np_receipts')
  const { data: visits = [] } = useTable('np_site_visits')

  const [editing, setEditing] = useState(false)
  const [onlyUnbilled, setOnlyUnbilled] = useState(false)

  const job = jobs.find(j => String(j.id) === id)
  const markupPct = Number(biz?.default_markup_pct) || 0

  const b = useMemo(() => job ? computeJobBilling({
    job, invoices, labour, materials, variations,
    paySchedule: schedules.find(s => String(s.id) === id) ?? null,
    markupPct,
  }) : null, [job, invoices, labour, materials, variations, schedules, id, markupPct])

  const lines = useMemo(() => job
    ? invoiceableLines({ job, invoices, labour, materials, markupPct })
    : [], [job, invoices, labour, materials, markupPct])

  const mine = <T extends Row>(rows: T[]) => rows.filter(r => String(r.job_id ?? '') === id)
  const jobLabour = mine(labour)
  const jobMaterials = mine(materials)

  // Money out. What the work has cost, which is never what it is charged at.
  const labourCost = jobLabour.reduce((s, l) => s + labCost(l), 0)
  const materialCost = jobMaterials.reduce((s, m) => s + (Number(m.cost_ex_gst) || 0), 0)
  const totalCost = labourCost + materialCost

  const hours = useMemo(
    () => job ? jobHours(job, labour, Number(biz?.rates?.standard) || 65) : null,
    [job, labour, biz])
  const phases = useMemo<PhaseHours | null>(
    () => job ? splitHours(jobPhases(job), jobLabour) : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [job, labour])

  const addOns = useMemo(
    () => job ? jobAddOns(variations, String(job.id), invoices) : [],
    [variations, job, invoices])

  if (isLoading) return (
    <div className="flex items-center justify-center h-64"><Loader2 size={20} className="animate-spin text-blue-600" /></div>
  )
  if (!job || !b) return (
    <div className="p-5">
      <button onClick={() => nav('/jobs')} className="flex items-center gap-1.5 text-[13px] text-[#666] hover:text-gray-900 mb-3">
        <ArrowLeft size={14} /> All jobs
      </button>
      <div className="bg-white border border-black/[0.12] rounded-xl py-10 text-center text-[#666]">
        No job with the id <b>{id}</b>.
      </div>
    </div>
  )

  const cash = isCashJob(job)
  const gstNote = jobGstRate(job) ? 'ex GST' : 'cash, no GST'
  const unbilledLines = lines.filter(l => !l.billed)
  const shown = onlyUnbilled ? unbilledLines : lines
  const leftToInvoice = unbilledLines.reduce((s, l) => s + l.amountExGST, 0)
  const margin = b.billableToDateExGST > 0
    ? ((b.billableToDateExGST - totalCost) / b.billableToDateExGST) * 100
    : null

  const jobInvoices = invoices.filter(i => String(i.job_id ?? '') === id)
  const jobReceipts = receipts.filter(r => String(r.job_id ?? '') === id)
  const jobVisits = visits.filter(v => String(v.job_id ?? '') === id)
  const dates = getJobScheduledDates(job)
  const booked = assignments.filter(a => String(a.job_id ?? '') === id)
  const exposure = jobExposure(job)
  const milestones = parseMilestones(schedules.find(s => String(s.id) === id))

  /** Raise an invoice for everything not yet billed, already ticked. */
  function billTheRest() {
    nav('/invoices' + handOff('np_prefill_invoice', {
      job_id: job!.id, client: job!.client, date: new Date().toISOString().slice(0, 10),
      notes: `Progress claim — ${job!.job_desc || job!.client || ''}`.trim(),
      pick: unbilledLines.map(l => l.id),
    }))
  }

  return (
    <div className="p-5">
      <JobModal open={editing} onClose={() => setEditing(false)} jobId={String(job.id)} />

      {/* ── Who and where ───────────────────────────────── */}
      <div className="flex items-start gap-3 flex-wrap mb-3.5">
        <button onClick={() => nav('/jobs')} className="flex items-center gap-1.5 text-[13px] text-[#666] hover:text-gray-900 mt-1">
          <ArrowLeft size={14} /> Jobs
        </button>
        <div className="flex-1 min-w-[220px]">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-extrabold text-[#2563eb] bg-[#dbeafe] px-2.5 py-1 rounded-full">{job.id}</span>
            <h2 className="text-[17px] font-semibold text-gray-900">{job.client}</h2>
            {cash && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#dcfce7] text-[#166534]">Cash — off the books</span>}
          </div>
          <div className="text-[12px] text-[#666] mt-0.5">
            {[job.address, job.job_type, job.terms].filter(Boolean).join(' · ')}
          </div>
          <div className="flex gap-1.5 flex-wrap mt-1.5">
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-[#f1f0e8] text-[#5f5e5a]">{job.status || '—'}</span>
            {job.quote_status && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#ede9fe] text-[#5b21b6]">Quote: {job.quote_status}</span>
            )}
            {isExposed(exposure) && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#fff7ed] text-[#9a3412]"
                title={EXPOSURE_LABELS[exposure]}>{EXPOSURE_TAG[exposure]}</span>
            )}
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setEditing(true)}
            className="flex items-center gap-1.5 text-[13px] px-3 py-1.5 rounded-lg bg-white border border-black/20 hover:bg-[#f5f4f0]">
            <Edit2 size={13} /> Edit
          </button>
          <button onClick={billTheRest} disabled={!unbilledLines.length}
            title={unbilledLines.length ? 'Opens an invoice with every unbilled line already ticked' : 'Nothing logged that is not already invoiced'}
            className="flex items-center gap-1.5 text-[13px] px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold disabled:opacity-40">
            <FileText size={13} /> Bill the rest{leftToInvoice > 0 && ` · ${fmtCurrency(leftToInvoice)}`}
          </button>
        </div>
      </div>

      {/* ── Money in · money out · what is left ──────────── */}
      <div className="grid gap-2.5 mb-3.5 lg:grid-cols-3">
        <Card title={<><span className="w-2 h-2 rounded-full" style={{ background: CHARGE }} /> Money in — the client</>}>
          <Figure strong label={b.basis === 'fixed' ? 'Agreed price' : 'Billable to date'}
            value={fmtCurrency(b.billableToDateExGST)} tone={CHARGE} sub={gstNote}
            help={b.basis === 'fixed'
              ? <>The contract sum plus approved add-ons. A fixed-price job is worth this
                  however many hours it takes.
                  <TipCalc>Agreed price plus approved add-ons, ex GST.</TipCalc></>
              : <>What the logged work comes to at charge rates — not what it cost you.
                  <TipCalc>{billingBreakdown(b) || 'Billable labour and materials at cost plus markup, plus approved add-ons.'}</TipCalc></>} />
          <Figure label="Invoiced" value={fmtCurrency(b.invoicedIncGST)} sub="inc GST" />
          <Figure label="Received" value={fmtCurrency(b.receivedIncGST)} tone={GOOD} sub="inc GST" />
          <Figure label="Owed now" value={fmtCurrency(b.owedIncGST)} tone={b.owedIncGST > 0 ? BAD : undefined} />
          <div className="mt-2">
            <div className="flex justify-between text-[10px] text-[#666] mb-1">
              <span>Invoiced {b.invoicePct.toFixed(0)}%</span>
              <span>Paid {b.paidPct.toFixed(0)}% of that</span>
            </div>
            <Bar pct={b.invoicePct} colour={CHARGE} />
            <div className="h-1" />
            <Bar pct={b.paidPct} colour={GOOD} />
          </div>
        </Card>

        <Card title={<><span className="w-2 h-2 rounded-full" style={{ background: COST }} /> Money out — what it cost you</>}>
          <Figure label="Labour" value={fmtCurrency(labourCost)} tone={COST}
            sub={`${jobLabour.length} ${jobLabour.length === 1 ? 'entry' : 'entries'}`} />
          <Figure label="Materials" value={fmtCurrency(materialCost)} tone={COST}
            sub={`${jobMaterials.length} ${jobMaterials.length === 1 ? 'purchase' : 'purchases'}`} />
          <Figure strong label="Total cost" value={fmtCurrency(totalCost)} tone={COST}
            help={<>What this job has taken out, at your cost rates — never what the client is
              charged for it.
              <TipCalc>Logged labour at its cost rate, plus materials at what they cost.
              A cost rate that leaves out super, insurance and downtime makes this look
              better than it is.</TipCalc></>} />
          {hours?.budgeted != null && (
            <div className="mt-2 pt-2 border-t border-black/[0.06]">
              <Figure label="Hours" value={`${hours.logged.toFixed(1)} of ${hours.budgeted.toFixed(1)}`}
                sub={<span style={{ color: hoursColour(hours) }}>
                  {hoursLabel(hours)} {hours.over ? 'over' : 'left'} · ${hours.rate}/hr
                </span>} />
              <Bar pct={(hours.used ?? 0) * 100} colour={hoursColour(hours)} />
            </div>
          )}
        </Card>

        <Card title="Where that leaves it">
          <Figure strong label="Gross profit" value={fmtCurrency(b.billableToDateExGST - totalCost)}
            tone={b.billableToDateExGST - totalCost >= 0 ? GOOD : BAD}
            help={<>What the job is worth less what it has cost so far.
              <TipCalc>{b.basis === 'fixed'
                ? 'Agreed price (plus add-ons) less labour and material costs. On a job still running this improves as it finishes, because the price is fixed and the costs are not all in yet.'
                : 'Billable work less what that work cost.'}</TipCalc></>} />
          <Figure label="Margin" value={margin == null ? '—' : `${margin.toFixed(1)}%`}
            tone={margin == null ? undefined : margin >= 30 ? GOOD : margin >= 15 ? '#d97706' : BAD} />
          <div className="mt-2 pt-2 border-t border-black/[0.06]">
            <Figure label="Left to invoice" value={fmtCurrency(leftToInvoice)} tone={CHARGE}
              sub={`${unbilledLines.length} logged ${unbilledLines.length === 1 ? 'line' : 'lines'} not yet billed`}
              help={<>Work logged on this job that no invoice covers yet, at charge rates.
                <TipCalc>Every labour and material line not named on an invoice and not inside
                a period an invoice claims. The table below lists them.</TipCalc></>} />
            {b.overBilledIncGST > 0 && (
              <Figure label="Over-billed" value={fmtCurrency(b.overBilledIncGST)} tone={BAD} />
            )}
          </div>
          {unbilledSummary(b) && (
            <div className="text-[10.5px] text-[#92400e] bg-[#fffbeb] border border-[#fde68a] rounded px-2 py-1 mt-2">
              {unbilledSummary(b)}
            </div>
          )}
        </Card>
      </div>

      {/* ── Every logged line, and whether it has been billed ── */}
      <Card className="mb-3.5"
        title={<><Clock size={13} /> Logged work — what is billed and what is not</>}
        right={
          <label className="flex items-center gap-1.5 text-[11px] text-[#666] cursor-pointer">
            <input type="checkbox" checked={onlyUnbilled} onChange={e => setOnlyUnbilled(e.target.checked)}
              className="w-3.5 h-3.5 accent-blue-600" />
            Only what is left to bill
          </label>
        }>
        {lines.length === 0 ? (
          <div className="text-[12px] text-[#666] py-2">
            Nothing logged against this job yet.
            {b.basis === 'fixed' && <> On a fixed-price job that is normal early on — the price
              is agreed and the costs arrive as the work does.</>}
          </div>
        ) : (
          <div className="overflow-auto max-h-[46vh] -mx-1">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr>
                  {[
                    { h: '', a: 'left' }, { h: 'Date', a: 'left' }, { h: 'What', a: 'left' },
                    { h: 'Cost', a: 'right', c: COST }, { h: 'Charge', a: 'right', c: CHARGE },
                    { h: 'Invoiced', a: 'left' },
                  ].map((c, i) => (
                    <th key={i} className="px-2 py-1.5 bg-[#fafaf8] border-b border-black/[0.12] text-[11px] font-medium sticky top-0 whitespace-nowrap"
                      style={{ color: c.c ?? '#666', textAlign: c.a as any }}>{c.h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map(l => {
                  const cost = lineCost(l, jobLabour, jobMaterials)
                  return (
                    <tr key={`${l.kind}-${l.id}`} className={`border-b border-black/[0.06] ${l.billed ? '' : 'bg-[#fcfcfa]'}`}>
                      <td className="px-2 py-1">
                        <span className={`inline-block px-1.5 py-0.5 rounded-full text-[9px] font-semibold ${
                          l.kind === 'labour' ? 'bg-[#dbeafe] text-[#1e40af]' : 'bg-[#f3e8ff] text-[#6b21a8]'}`}>
                          {l.kind === 'labour' ? 'Labour' : 'Material'}
                        </span>
                      </td>
                      <td className="px-2 py-1 whitespace-nowrap text-[#666]">{fmtDate(l.date) || '—'}</td>
                      <td className="px-2 py-1">{l.description}</td>
                      <td className="px-2 py-1 text-right tabular-nums" style={{ color: COST }}>
                        {cost != null ? fmtCurrency(cost) : '—'}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums font-medium" style={{ color: CHARGE }}>
                        {fmtCurrency(l.amountExGST)}
                      </td>
                      <td className="px-2 py-1 whitespace-nowrap">
                        {l.billed
                          ? <span className="text-[10.5px] text-[#166534] flex items-center gap-1">
                              <Check size={11} /> {l.billedOn ?? 'yes'}
                            </span>
                          : <span className="text-[10.5px] font-semibold text-[#92400e]">not yet</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="bg-[#f5f4f0] font-semibold">
                  <td colSpan={3} className="px-2 py-1.5 text-right text-[11px]">
                    {onlyUnbilled ? 'Left to bill' : 'All logged work'}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums" style={{ color: COST }}>
                    {fmtCurrency(onlyUnbilled
                      ? unbilledLines.reduce((s, l) => s + (lineCost(l, jobLabour, jobMaterials) ?? 0), 0)
                      : totalCost)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums" style={{ color: CHARGE }}>
                    {fmtCurrency(shown.reduce((s, l) => s + l.amountExGST, 0))}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <div className="text-[10px] text-[#666] mt-2">
          <b style={{ color: COST }}>Cost</b> is what you paid for the work.{' '}
          <b style={{ color: CHARGE }}>Charge</b> is what the client is billed for it.
          {b.basis === 'fixed' && <> On a fixed-price job the charge column is what those hours
            would be worth billed out — the client pays the agreed price regardless.</>}
        </div>
      </Card>

      {/* ── The rest of it ──────────────────────────────── */}
      <div className="grid gap-2.5 lg:grid-cols-2">
        <Card title={<><Receipt size={13} /> Invoices</>}>
          {jobInvoices.length === 0 ? <Empty>No invoices raised on this job.</Empty> : (
            <div className="flex flex-col gap-1">
              {jobInvoices.map(i => (
                <Link key={i.id} to="/invoices"
                  className="flex items-center gap-2 px-2 py-1 rounded hover:bg-[#f5f4f0] text-[12px]">
                  <span className="flex-1 truncate">{i.id}</span>
                  <span className="text-[#666] whitespace-nowrap">{fmtDate(i.date)}</span>
                  <span className="tabular-nums font-medium">{fmtCurrency(i.total_inc_gst || 0)}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap ${
                    invStatus(i) === 'Paid' ? 'bg-[#dcfce7] text-[#166534]'
                      : invStatus(i) === 'Part Paid' ? 'bg-[#fef3c7] text-[#92400e]'
                      : 'bg-[#fee2e2] text-[#991b1b]'}`}>
                    {invStatus(i)}{calcOwed(i) > 0 && ` · ${fmtCurrency(calcOwed(i))} owed`}
                  </span>
                </Link>
              ))}
            </div>
          )}
          {jobReceipts.length > 0 && (
            <div className="mt-2 pt-2 border-t border-black/[0.06] text-[11px] text-[#666]">
              {jobReceipts.length} receipt{jobReceipts.length !== 1 ? 's' : ''} recorded ·{' '}
              {fmtCurrency(jobReceipts.reduce((s, r) => s + (Number(r.total_inc_gst) || 0), 0))}
            </div>
          )}
        </Card>

        <Card title={<><Package size={13} /> Payment schedule and add-ons</>}>
          {milestones.length === 0 ? <Empty>No payment schedule on this job.</Empty> : (
            <div className="flex flex-col gap-1 mb-2">
              {b.milestones.map(m => (
                <div key={m.index} className="flex items-center gap-2 text-[12px]">
                  <span className="flex-1 truncate">{m.label}</span>
                  <span className="text-[#666] text-[10.5px] whitespace-nowrap">{m.dueDate || 'no date'}</span>
                  <span className="tabular-nums">{fmtCurrency(m.amount)}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap ${
                    m.status === 'paid' ? 'bg-[#dcfce7] text-[#166534]'
                      : m.status === 'invoiced' ? 'bg-[#dbeafe] text-[#1e40af]'
                      : 'bg-[#f1f0e8] text-[#5f5e5a]'}`}>{m.status}</span>
                </div>
              ))}
            </div>
          )}
          {addOns.length > 0 && (
            <div className="pt-2 border-t border-black/[0.06] flex flex-col gap-1">
              {addOns.map(a => (
                <div key={a.id} className="flex items-center gap-2 text-[12px]">
                  <span className="flex-1 truncate">{a.description}</span>
                  <span className="tabular-nums">{fmtCurrency(a.amountExGST)}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap ${
                    !a.approved ? 'bg-[#fffbeb] text-[#92400e]'
                      : a.billed ? 'bg-[#dcfce7] text-[#166534]' : 'bg-[#f3e8ff] text-[#6b21a8]'}`}>
                    {!a.approved ? 'pending' : a.billed ? 'billed' : 'approved'}
                  </span>
                </div>
              ))}
            </div>
          )}
          {!milestones.length && !addOns.length && <Empty>Nothing scheduled and no add-ons.</Empty>}
        </Card>

        <Card title={<><CalendarDays size={13} /> Schedule and crew</>}>
          <Figure label="Starts" value={fmtDate(job.sched_start) || 'not set'} />
          <Figure label="Days on site" value={dates.length ? String(dates.length) : (job.est_days ? `${job.est_days} est.` : '—')} />
          {dates.length > 0 && (
            <div className="text-[10.5px] text-[#666] mt-1">
              {fmtDate(dates[0])} → {fmtDate(dates[dates.length - 1])}
            </div>
          )}
          <div className="mt-2 pt-2 border-t border-black/[0.06]">
            <div className="text-[11px] text-[#666] mb-1 flex items-center gap-1"><Users size={11} /> Booked on</div>
            {booked.length === 0
              ? <Empty>Nobody booked on this job.</Empty>
              : (
                <div className="flex flex-wrap gap-1">
                  {[...new Set(booked.map(a => crewLabel(crew, a.crew_name)))].map(n => (
                    <span key={n} className="text-[10.5px] px-2 py-0.5 rounded-full bg-[#dbeafe] text-[#1e40af]">{n}</span>
                  ))}
                </div>
              )}
          </div>
          {isExposed(exposure) && (
            <div className="text-[10.5px] text-[#9a3412] bg-[#fff7ed] border border-[#fed7aa] rounded px-2 py-1 mt-2 flex items-start gap-1.5">
              <AlertTriangle size={11} className="mt-px shrink-0" /> {EXPOSURE_LABELS[exposure]} — rain on a
              scheduled day is worth watching on the calendar.
            </div>
          )}
        </Card>

        <Card title={<><Camera size={13} /> Hours by phase, and site visits</>}>
          {phases && Object.keys(phases.byPhase).length > 0 ? (
            <div className="flex flex-col gap-0.5 mb-2">
              {Object.entries(phases.byPhase).sort((a, b) => b[1] - a[1]).map(([name, hrs]) => (
                <div key={name} className="flex items-center gap-2 text-[12px]">
                  <span className="flex-1 truncate">{name}</span>
                  <span className="tabular-nums text-[#666]">{hrs.toFixed(1)}h</span>
                </div>
              ))}
              {phases.untagged > 0 && (
                <div className="flex items-center gap-2 text-[12px] text-[#666]">
                  <span className="flex-1">Not tagged to a phase</span>
                  <span className="tabular-nums">{phases.untagged.toFixed(1)}h</span>
                </div>
              )}
            </div>
          ) : (
            <Empty>
              No hours tagged to a phase yet. Tagging them is what turns a blended job rate into
              a real rate per task.
            </Empty>
          )}
          <div className="pt-2 border-t border-black/[0.06] text-[11px] text-[#666]">
            {jobVisits.length
              ? <Link to="/visits" className="text-[#2563eb] hover:underline">
                  {jobVisits.length} site visit{jobVisits.length !== 1 ? 's' : ''} recorded
                </Link>
              : 'No site visits recorded.'}
          </div>
        </Card>
      </div>

      <div className="flex gap-2 flex-wrap mt-3.5">
        {[
          ['Log labour', '/labour'], ['Add materials', '/materials'],
          ['Costs', '/costs'], ['Pay schedule', '/payments'],
        ].map(([label, to]) => (
          <Link key={to} to={to}
            className="flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-lg bg-white border border-black/20 hover:bg-[#f5f4f0]">
            <Plus size={12} /> {label}
          </Link>
        ))}
      </div>
    </div>
  )
}

const Empty = ({ children }: { children: React.ReactNode }) =>
  <div className="text-[11.5px] text-[#666] py-1">{children}</div>

/**
 * What a billable line cost, as against what it is charged at.
 *
 * invoiceableLines gives the charge, which is the figure the invoice needs.
 * The cost lives on the row it came from, and showing them side by side is
 * the whole point of the table.
 */
function lineCost(l: InvoiceableLine, labour: Row[], materials: Row[]): number | null {
  if (l.kind === 'labour') {
    const row = labour.find(x => String(x.id) === l.id)
    return row ? labCost(row) : null
  }
  const row = materials.find(x => String(x.id) === l.id)
  return row ? Number(row.cost_ex_gst) || 0 : null
}
