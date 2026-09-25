// What has been invoiced on a job and what is still to bill.
//
// Deliberately separate from the Cost Tracker: that answers "am I over budget?"
// in ex-GST cost terms, this answers "what do I send the client?" in inc-GST
// billing terms. Putting both GST bases on one screen is what let the Invoices
// and Profitability pages drift apart in the first place.

import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { fmtCurrency, fmtDate, invStatus } from '@/lib/utils'
import { computeJobBilling, billingBreakdown } from '@/lib/jobBilling'
import { useBusinessSettings } from '@/pages/SettingsPage'

function Tile({ label, value, color, sub }: {
  label: string; value: string; color?: string; sub?: string
}) {
  return (
    <div className="bg-[#f5f4f0] border border-black/[0.12] rounded-lg px-3 py-2">
      <div className="text-[10px] font-bold uppercase text-[#666] tracking-wide mb-0.5">{label}</div>
      <div className="text-[15px] font-bold" style={color ? { color } : undefined}>{value}</div>
      {sub && <div className="text-[10px] text-[#666] mt-0.5">{sub}</div>}
    </div>
  )
}

function Bar({ label, pct, of, from }: { label: string; pct: number; of: string; from: string }) {
  return (
    <>
      <div className="flex justify-between text-[10px] text-[#666] mb-1">
        <span>{label} ({pct.toFixed(0)}%)</span>
        <span>{from} of {of}</span>
      </div>
      <div className="h-1.5 bg-black/[0.12] rounded-[3px] overflow-hidden mb-2">
        <div className="h-full rounded-[3px]" style={{ width: `${pct}%`, background: label === 'Received' ? '#16a34a' : '#1d4ed8' }} />
      </div>
    </>
  )
}

const MS_STYLE: Record<string, string> = {
  paid: 'bg-[#dcfce7] text-[#166534]',
  invoiced: 'bg-[#dbeafe] text-[#1e40af]',
  unbilled: 'bg-[#f1f0e8] text-[#5f5e5a]',
}

export default function JobBillingTab({ job, jobId }: { job: any; jobId: string | null }) {
  const { user } = useAuth()
  const { data: biz } = useBusinessSettings()
  const on = !!user && !!jobId

  // np_labour_job / np_materials_job / np_variations reuse the Cost Tracker's
  // query keys, so opening both tabs costs one fetch, not two.
  const labour = useQuery<any[]>({
    queryKey: ['np_labour_job', jobId, user?.id],
    queryFn: async () => (await supabase.from('np_labour').select('*').eq('user_id', user!.id).eq('job_id', jobId!)).data ?? [],
    enabled: on,
  })
  const materials = useQuery<any[]>({
    queryKey: ['np_materials_job', jobId, user?.id],
    queryFn: async () => (await (supabase.from('np_materials') as any).select('*').eq('user_id', user!.id).eq('job_id', jobId!)).data ?? [],
    enabled: on,
  })
  const variations = useQuery<any[]>({
    queryKey: ['np_variations', jobId, user?.id],
    queryFn: async () => (await supabase.from('np_variations').select('*').eq('user_id', user!.id).eq('job_id', jobId!).eq('var_status', 'Approved')).data ?? [],
    enabled: on,
  })
  const invoices = useQuery<any[]>({
    queryKey: ['np_invoices_job', jobId, user?.id],
    queryFn: async () => (await supabase.from('np_invoices').select('*').eq('user_id', user!.id).eq('job_id', jobId!)).data ?? [],
    enabled: on,
  })
  const schedule = useQuery<any>({
    queryKey: ['np_pay_schedule_job', jobId, user?.id],
    queryFn: async () => (await supabase.from('np_pay_schedules').select('*').eq('user_id', user!.id).eq('id', jobId!).maybeSingle()).data ?? null,
    enabled: on,
  })

  if (!jobId) {
    return <div className="text-sm text-gray-500 py-6 text-center">Save the job first to track invoicing against it.</div>
  }

  const b = computeJobBilling({
    job: { ...job, id: jobId },
    invoices: invoices.data ?? [],
    labour: labour.data ?? [],
    materials: materials.data ?? [],
    variations: variations.data ?? [],
    paySchedule: schedule.data,
    markupPct: biz?.default_markup_pct ?? 0,
  })

  return (
    <div className="flex flex-col gap-3">
      <div className="text-[11px] text-[#666]">
        {b.basis === 'fixed'
          ? 'Fixed price — billable is the agreed amount plus approved variations.'
          : 'Hourly / estimate — billable is the labour and materials logged so far, plus approved variations.'}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <Tile label={b.basis === 'fixed' ? 'Job value' : 'Billable to date'}
          value={fmtCurrency(b.billableToDateIncGST)} color="#2563eb" sub="inc GST" />
        <Tile label="Invoiced" value={fmtCurrency(b.invoicedIncGST)} color="#1d4ed8"
          sub={`${b.invoices.length} invoice${b.invoices.length !== 1 ? 's' : ''}`} />
        <Tile label="Received" value={fmtCurrency(b.receivedIncGST)} color="#16a34a"
          sub={b.cashReceivedIncGST ? `incl. ${fmtCurrency(b.cashReceivedIncGST)} cash` : undefined} />
        <Tile label="Outstanding" value={b.owedIncGST > 0 ? fmtCurrency(b.owedIncGST) : 'Paid'}
          color={b.owedIncGST > 0 ? '#dc2626' : '#16a34a'} sub="left to pay" />
        {b.hasValue && (
          <Tile label="Left to invoice"
            value={b.leftToInvoiceIncGST > 0 ? fmtCurrency(b.leftToInvoiceIncGST) : 'Done'}
            color={b.leftToInvoiceIncGST > 0 ? '#d97706' : '#16a34a'}
            sub={`of ${fmtCurrency(b.billableToDateIncGST)}`} />
        )}
        {b.overBilledIncGST > 0 && (
          <Tile label="Over-billed" value={fmtCurrency(b.overBilledIncGST)} color="#dc2626"
            sub="invoiced beyond billable" />
        )}
      </div>

      {b.basis === 'actuals' && b.billableToDateExGST > 0 && (
        <div className="text-[11px] text-[#666]">{billingBreakdown(b)}</div>
      )}

      {b.hasValue && (
        <div>
          <Bar label="Invoiced" pct={b.invoicePct}
            from={fmtCurrency(b.invoicedIncGST)} of={fmtCurrency(b.billableToDateIncGST)} />
          <Bar label="Received" pct={b.paidPct}
            from={fmtCurrency(b.receivedIncGST)} of={fmtCurrency(b.invoicedIncGST)} />
        </div>
      )}

      {b.milestones.length > 0 && (
        <div>
          <div className="text-xs font-semibold mb-1.5">Payment schedule</div>
          <div className="flex flex-col gap-1">
            {b.milestones.map(m => (
              <div key={m.index} className="flex items-center gap-2 text-[11px] bg-[#f8f8f6] rounded px-2 py-1.5">
                <span className="flex-1">{m.label}</span>
                {m.invoice && <span className="text-[10px] text-[#2563eb]">{m.invoice.id}</span>}
                <span className="font-mono">{fmtCurrency(m.amount)}</span>
                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${MS_STYLE[m.status]}`}>
                  {m.status}
                </span>
                {m.mismatch && (
                  <span className="text-[10px] text-[#b45309]"
                    title="Ticked received on the Payments page, but no settled invoice is linked">
                    check
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="text-xs font-semibold mb-1.5">Invoices</div>
        {b.invoices.length === 0 ? (
          <div className="text-[11px] text-[#666]">Nothing invoiced against this job yet.</div>
        ) : (
          <div className="flex flex-col gap-1">
            {b.invoices.map(i => (
              <div key={i.id} className="flex items-center gap-2 text-[11px] bg-[#f8f8f6] rounded px-2 py-1.5">
                <span className="font-semibold text-[#2563eb]">{i.id}</span>
                <span className="text-[#666] whitespace-nowrap">{fmtDate(i.date)}</span>
                <span className="flex-1 truncate text-[#666]">{i.notes || ''}</span>
                <span className="font-mono whitespace-nowrap">{fmtCurrency(i.total_inc_gst)}</span>
                <span className="text-[10px] text-[#666] whitespace-nowrap">{invStatus(i)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
