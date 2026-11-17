// "Can you break down the labour and materials?"
//
// Tick what the client asked about, then either copy it into the reply to
// their email or print it on the letterhead. The list is built from the charge
// side only — see lib/clientBreakdown, which is where the rule that no cost
// figure reaches this list is written down and tested.
//
// It is a list, deliberately, not a second invoice. The client already has the
// invoice; what they are asking for is what sits behind it.

import { useMemo, useState } from 'react'
import { ClipboardCheck, Copy, Printer, Users } from 'lucide-react'
import {
  clientLines, selected, breakdownTotals, buildBreakdownText, buildBreakdownHTML,
  ratePerHour, BREAKDOWN_KINDS, LABOUR_DETAIL,
  type BreakdownKind, type LabourDetail, type ClientLine,
} from '@/lib/clientBreakdown'
import type { InvoiceableLine } from '@/lib/jobBilling'
import { fmtCurrency, fmtDate } from '@/lib/utils'

type Row = Record<string, any>

export default function ClientBreakdownPanel({
  lines, labour, materials, job, gstRate, biz,
}: {
  /** From invoiceableLines — the charge figures, as the invoice uses them. */
  lines: InvoiceableLine[]
  labour: Row[]
  materials: Row[]
  job: Row
  /** 0 on a cash job, and then no GST is printed. */
  gstRate: number
  biz?: Row | null
}) {
  const [kind, setKind] = useState<BreakdownKind>('all')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [showRate, setShowRate] = useState(false)
  const [labourDetail, setLabourDetail] = useState<LabourDetail>('phase')
  const [showDates, setShowDates] = useState(true)
  const [showSupplier, setShowSupplier] = useState(false)
  const [copied, setCopied] = useState(false)

  const rows = useMemo(
    () => clientLines({ lines, labour, materials, kind, showSupplier, labourDetail }),
    [lines, labour, materials, kind, showSupplier, labourDetail])

  // No ticks means the whole list, which is what "all" on the filter already
  // says. Ticking one narrows it; unticking them all widens it back.
  const chosen = useMemo(() => selected(rows, picked), [rows, picked])
  const t = breakdownTotals(chosen, gstRate)

  const opts = {
    jobTitle: String(job?.job_desc || job?.type || job?.id || ''),
    client: String(job?.client || ''),
    site: String(job?.address || ''),
    gstRate, showRate, labourDetail, showDates,
  }

  const toggle = (id: string) => setPicked(p => {
    const next = new Set(p)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  const copy = async () => {
    const text = buildBreakdownText(chosen, opts)
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard refused — on an installed app without the permission, or
      // over http. The text is no use trapped here, so it goes to a window
      // the user can select from.
      const w = window.open('', '_blank')
      if (w) {
        w.document.write(`<pre style="font:13px/1.6 ui-monospace,Menlo,monospace;padding:16px;white-space:pre-wrap">${
          text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre>`)
        w.document.close()
      }
    }
  }

  const print = () => {
    const w = window.open('', '_blank')
    if (!w) return
    w.document.write(buildBreakdownHTML(chosen, { ...opts, biz, origin: window.location.origin }))
    w.document.close()
  }

  const labourRows = rows.filter(r => r.kind === 'labour')
  const matRows = rows.filter(r => r.kind === 'material')

  return (
    <div className="flex flex-col gap-2.5">
      {/* What they asked about */}
      <div className="flex flex-wrap items-center gap-1.5">
        {BREAKDOWN_KINDS.map(k => (
          <button key={k.id} type="button" onClick={() => setKind(k.id)}
            className={`text-[11.5px] px-2.5 py-1 rounded-lg border ${
              kind === k.id
                ? 'bg-[#1a1a18] text-white border-[#1a1a18]'
                : 'bg-white text-[#444] border-black/20 hover:bg-[#f5f4f0]'}`}>
            {k.label}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="text-[11.5px] text-[#666] bg-[#f5f4f0] rounded-lg px-3 py-2.5">
          Nothing chargeable logged for this. Work marked <b>Not billable</b> is left out on
          purpose — nobody is charged for it, so it does not belong in a breakdown the client
          reads.
        </div>
      ) : (
        <>
          {/* Tick individual entries, or leave them all unticked for the lot */}
          <div className="border border-black/[0.12] rounded-lg overflow-hidden">
            <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 bg-[#f5f4f0] text-[11px] flex-wrap">
              <div className="flex gap-2.5">
                <button type="button" className="text-[#2563eb] font-semibold"
                  onClick={() => setPicked(new Set(rows.map(r => r.id)))}>
                  Tick all
                </button>
                <button type="button" className="text-[#666]" onClick={() => setPicked(new Set())}>
                  Clear
                </button>
              </div>
              <span className="text-[#666]">
                {picked.size === 0
                  ? <>all {rows.length} {rows.length === 1 ? 'entry' : 'entries'}</>
                  : <>{picked.size} of {rows.length} ticked</>}
                {' · '}
                <b className="text-[#2563eb]">{fmtCurrency(t.exGST, 2)}</b> ex GST
              </span>
            </div>

            <div className="max-h-64 overflow-y-auto">
              {([['Labour', labourRows], ['Materials', matRows]] as [string, ClientLine[]][])
                .filter(([, rs]) => rs.length)
                .map(([heading, rs]) => (
                  <div key={heading}>
                    {kind === 'all' && (
                      <div className="px-2.5 py-1 bg-[#fafaf8] border-t border-black/[0.08] text-[10px] font-semibold uppercase tracking-wide text-[#666]">
                        {heading}
                      </div>
                    )}
                    {rs.map(r => (
                      <label key={r.id}
                        className="flex items-center gap-2 px-2.5 py-1.5 text-[11.5px] border-t border-black/[0.06] cursor-pointer hover:bg-[#f8f8f6]">
                        <input type="checkbox" checked={picked.has(r.id)} onChange={() => toggle(r.id)}
                          className="w-4 h-4 accent-blue-600 shrink-0" />
                        <span className="text-[#666] whitespace-nowrap">{fmtDate(r.date) || '—'}</span>
                        <span className="flex-1 truncate">{r.description}</span>
                        {r.hours ? (
                          <span className="text-[#666] tabular-nums whitespace-nowrap">{r.hours}h</span>
                        ) : null}
                        {showRate && r.kind === 'labour' && ratePerHour(r.chargeExGST, r.hours) != null && (
                          <span className="text-[#666] tabular-nums whitespace-nowrap">
                            {fmtCurrency(ratePerHour(r.chargeExGST, r.hours)!, 2)}/hr
                          </span>
                        )}
                        <span className="tabular-nums whitespace-nowrap font-medium">
                          {fmtCurrency(r.chargeExGST, 2)}
                        </span>
                      </label>
                    ))}
                  </div>
                ))}
            </div>
          </div>

          {/* How much the document gives away */}
          {kind !== 'materials' && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-[#666] mr-0.5">Labour reads as:</span>
              {LABOUR_DETAIL.map(d => (
                <button key={d.id} type="button" title={d.hint}
                  onClick={() => setLabourDetail(d.id)}
                  className={`text-[11px] px-2 py-0.5 rounded-md border ${
                    labourDetail === d.id
                      ? 'bg-[#eef2ff] text-[#1e40af] border-[#c7d2fe] font-semibold'
                      : 'bg-white text-[#444] border-black/15 hover:bg-[#f5f4f0]'}`}>
                  {d.label}
                </button>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-[#444]">
            <Tick checked={showDates} onChange={setShowDates} label="Show dates" />
            <Tick checked={showSupplier} onChange={setShowSupplier}
              label="Name the suppliers" hint="Shows where you buy" />
            <Tick checked={showRate} onChange={setShowRate}
              label="Show rate per hour"
              hint="Puts your charge rate in writing in the client's hands" />
          </div>

          <div className="flex items-start gap-1.5 text-[10.5px] text-[#666] bg-[#fafaf8] border border-black/[0.08] rounded-lg px-2.5 py-2">
            <Users size={12} className="shrink-0 mt-px" />
            <span>
              {labourDetail === 'full'
                ? <><b className="text-[#92400e]">The full log names your subcontractors.</b> Every
                   figure is still what the client is charged — what the work cost you is never in
                   this document.</>
                : <>Labour is described by its phase, not by who did it, and every figure is what
                   the client is charged — what the work cost you is not in this document.</>}
              {t.labourHours > 0 && <> {t.labourHours} hrs</>}
              {t.labourExGST > 0 && <> at {fmtCurrency(t.labourExGST, 2)}</>}
              {t.materialsExGST > 0 && <>, materials {fmtCurrency(t.materialsExGST, 2)}</>}
              {gstRate > 0
                ? <>, <b>{fmtCurrency(t.incGST, 2)}</b> inc GST.</>
                : <>, <b>{fmtCurrency(t.exGST, 2)}</b> total — cash job, no GST.</>}
            </span>
          </div>

          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={copy}
              className="flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-lg bg-[#1a1a18] text-white hover:bg-black">
              {copied ? <ClipboardCheck size={13} /> : <Copy size={13} />}
              {copied ? 'Copied' : 'Copy as a list'}
            </button>
            <button type="button" onClick={print}
              className="flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-lg bg-white border border-black/20 hover:bg-[#f5f4f0]">
              <Printer size={13} /> Print on letterhead
            </button>
          </div>
        </>
      )}
    </div>
  )
}

const Tick = ({ checked, onChange, label, hint }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string
}) => (
  <label className="flex items-center gap-1.5 cursor-pointer" title={hint}>
    <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
      className="w-3.5 h-3.5 accent-blue-600" />
    {label}
  </label>
)
