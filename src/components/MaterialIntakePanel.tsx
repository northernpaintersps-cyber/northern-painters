// Drop a week of supplier invoices in, approve them one by one.
//
// The scan button beside this one is for a receipt photographed at the
// counter: one file, straight into the form. This is for the dozen PDFs that
// arrived by email since Monday, where going through the modal twelve times
// is the whole problem.
//
// Everything lands in a list first. Nothing is written to np_materials until
// a row is approved, every row carries its suggested job and its duplicate
// warning before you decide, and the batch totals are shown so the lot can be
// checked against the supplier statement before any of it is saved.

import { useRef, useState, useMemo } from 'react'
import { extractInvoice } from '@/lib/ai'
import {
  intakeRow, failedRow, flagDuplicates, toMaterial, counts, problemWith,
  readyToApprove, CONFIDENT, activeJobs, jobsForPicker, ACTIVE_DAYS,
  type IntakeRow,
} from '@/lib/materialIntake'
import { fmtCurrency } from '@/lib/utils'
import JobPicker from '@/components/JobPicker'
import {
  Upload, Loader2, Check, X, AlertTriangle, FileWarning, Trash2, CircleCheck,
} from 'lucide-react'

type Row = Record<string, any>

export default function MaterialIntakePanel({ jobs, materials, labour, apiKey, onSave }: {
  jobs: Row[]
  materials: Row[]
  /** Work logged, so a job being worked can break a tie the address cannot. */
  labour: Row[]
  apiKey?: string
  /** Writes one approved row. Returns when it is saved. */
  onSave: (material: Row) => Promise<void>
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<IntakeRow[]>([])
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [err, setErr] = useState('')

  const c = useMemo(() => counts(rows), [rows])
  const ready = useMemo(() => readyToApprove(rows), [rows])

  /** Re-runs the duplicate check over the whole batch after any edit. */
  const update = (key: string, patch: Partial<IntakeRow>) =>
    setRows(rs => flagDuplicates(
      rs.map(r => (r.key === key ? { ...r, ...patch } : r)), materials))

  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])]
    if (fileRef.current) fileRef.current.value = ''
    if (!files.length) return
    if (!apiKey) { setErr('No AI API key set. Add your Anthropic API key in Settings.'); return }

    setErr('')
    setBusy({ done: 0, total: files.length })
    const found: IntakeRow[] = []
    // One at a time rather than all at once: a dozen parallel calls is a
    // good way to be rate-limited halfway through and lose the lot, and the
    // progress count is only honest if they finish in order.
    for (const [i, file] of files.entries()) {
      try {
        const x = await extractInvoice(apiKey, file)
        // Activity is worked out per invoice, from that invoice's own date —
        // a batch spanning a fortnight has a different set of live jobs at
        // each end of it.
        found.push(intakeRow(x, file.name, jobs, undefined,
          activeJobs([...labour, ...materials], x.date)))
      } catch (e: any) {
        found.push(failedRow(file.name, e?.message || 'Could not be read'))
      }
      setBusy({ done: i + 1, total: files.length })
    }
    setRows(rs => flagDuplicates([...rs, ...found], materials))
    setBusy(null)
  }

  async function approve(r: IntakeRow) {
    setSaving(r.key)
    try {
      // The user id is left blank here and filled by the save mutation, which
      // stamps `user_id` on every row it writes. A component has no business
      // knowing whose rows these are, and two places deciding it is how one
      // of them ends up wrong.
      await onSave(toMaterial(r, ''))
      setRows(rs => rs.map(x => (x.key === r.key ? { ...x, status: 'approved' } : x)))
    } catch (e: any) {
      setErr(e?.message || 'Could not save that row.')
    } finally { setSaving(null) }
  }

  async function approveAll() {
    for (const r of ready) await approve(r)
  }

  const reject = (key: string) =>
    setRows(rs => rs.map(r => (r.key === key ? { ...r, status: 'rejected' } : r)))

  const BTN = 'px-2.5 py-1.5 text-[13px] bg-white border border-black/20 rounded-lg hover:bg-[#f5f4f0] disabled:opacity-40 disabled:cursor-not-allowed'

  return (
    <div className="bg-white border border-black/[0.12] rounded-xl p-4 mb-3.5">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
        <div className="text-[13px] font-bold flex items-center gap-1.5">
          <Upload size={14} /> Import invoices
        </div>
        <div className="flex gap-2 flex-wrap">
          <input ref={fileRef} type="file" multiple accept="application/pdf,image/*"
            onChange={onFiles} className="hidden" />
          <button onClick={() => fileRef.current?.click()} disabled={!!busy} className={BTN}>
            {busy ? <span className="flex items-center gap-1.5">
              <Loader2 size={14} className="animate-spin" /> Reading {busy.done} of {busy.total}…
            </span> : 'Choose files'}
          </button>
          {rows.length > 0 && (
            <button onClick={() => setRows([])} disabled={!!busy || !!saving}
              className={`${BTN} flex items-center gap-1.5`}>
              <Trash2 size={14} /> Clear
            </button>
          )}
        </div>
      </div>

      <div className="text-[11px] text-[#666] mb-3">
        Several at once — PDFs or photos. Each one is read, matched to a job where the address
        says so, and checked against what is already on file. Nothing is saved until you approve it.
      </div>

      {err && <div className="text-[12px] text-[#b3261e] mb-2">{err}</div>}

      {rows.length > 0 && (
        <>
          <div className="flex gap-2.5 flex-wrap items-center mb-3 text-[12px]">
            <span className="px-2 py-1 rounded bg-[#f5f4f0]">
              <b>{c.pending}</b> to review
              {c.pending > 0 && <> · {fmtCurrency(c.pendingExGST)} ex GST, {fmtCurrency(c.pendingGST)} GST</>}
            </span>
            {c.approved > 0 && <span className="px-2 py-1 rounded bg-green-50 text-green-800">
              <b>{c.approved}</b> saved</span>}
            {c.duplicates > 0 && <span className="px-2 py-1 rounded bg-amber-50 text-amber-900">
              <b>{c.duplicates}</b> possible duplicate{c.duplicates !== 1 ? 's' : ''}</span>}
            {c.needJob > 0 && <span className="px-2 py-1 rounded bg-[#f5f4f0] text-[#666]">
              <b>{c.needJob}</b> need a job</span>}
            {c.failed > 0 && <span className="px-2 py-1 rounded bg-red-50 text-[#b3261e]">
              <b>{c.failed}</b> unreadable</span>}
            {ready.length > 0 && (
              <button onClick={approveAll} disabled={!!saving}
                className="px-2.5 py-1.5 text-[12px] rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 flex items-center gap-1.5">
                <CircleCheck size={13} /> Approve {ready.length} clean row{ready.length !== 1 ? 's' : ''}
              </button>
            )}
          </div>

          <div className="flex flex-col gap-2">
            {rows.map(r => {
              const problem = problemWith(r)
              const done = r.status === 'approved' || r.status === 'rejected'
              return (
                <div key={r.key}
                  className={`border rounded-lg p-2.5 ${
                    r.status === 'approved' ? 'border-green-200 bg-green-50/40'
                    : r.status === 'rejected' ? 'border-black/[0.08] bg-black/[0.02] opacity-60'
                    : r.status === 'failed' ? 'border-red-200 bg-red-50/40'
                    : r.duplicateOf ? 'border-amber-300 bg-amber-50/40'
                    : 'border-black/[0.12]'}`}>

                  <div className="flex justify-between items-start gap-2 flex-wrap">
                    <div className="min-w-0">
                      <div className="text-[13px] font-semibold truncate">
                        {r.supplier || r.fileName}
                        {r.status === 'approved' && <span className="ml-1.5 text-[11px] font-normal text-green-700">saved</span>}
                        {r.status === 'rejected' && <span className="ml-1.5 text-[11px] font-normal text-[#666]">skipped</span>}
                      </div>
                      <div className="text-[11px] text-[#666] truncate">
                        {r.date || 'no date'}
                        {r.receipt_no ? ` · #${r.receipt_no}` : ''}
                        {r.category ? ` · ${r.category}` : ''}
                        {' · '}{r.fileName}
                      </div>
                      {r.mat_desc && <div className="text-[11px] text-[#666] mt-0.5 line-clamp-2">{r.mat_desc}</div>}
                    </div>
                    <div className="text-right whitespace-nowrap">
                      <div className="text-[13px] font-semibold tabular-nums">{fmtCurrency(r.cost_ex_gst)}</div>
                      <div className="text-[11px] text-[#666] tabular-nums">
                        {r.gst ? `${fmtCurrency(r.gst)} GST` : 'no GST'}
                      </div>
                    </div>
                  </div>

                  {r.status === 'failed' && (
                    <div className="mt-1.5 text-[12px] text-[#b3261e] flex items-start gap-1.5">
                      <FileWarning size={13} className="mt-px shrink-0" />
                      <span>Could not be read — {r.error}. Add it by hand, or try a clearer scan.</span>
                    </div>
                  )}

                  {r.duplicateOf && !done && (
                    <div className="mt-1.5 text-[12px] text-amber-900 flex items-start gap-1.5">
                      <AlertTriangle size={13} className="mt-px shrink-0" />
                      <span>
                        Looks like {r.duplicateOf.inBatch ? 'another file in this batch' : `material ${r.duplicateOf.id}`}
                        {' '}— same {r.duplicateOf.basis === 'number' ? 'invoice number' : 'amount and date'}
                        {r.duplicateOf.sameSupplier ? '' : ', though the supplier is spelled differently'}.
                        Approve it only if it really is a second purchase.
                      </span>
                    </div>
                  )}

                  {!done && r.status !== 'failed' && (
                    <div className="mt-2 flex items-end gap-2 flex-wrap">
                      <div className="min-w-[200px] flex-1">
                        <JobPicker
                          jobs={jobsForPicker(jobs, activeJobs([...labour, ...materials], r.date))}
                          value={r.job_id}
                          onChange={(id: string) => update(r.key, { job_id: id })} />
                        {r.job_id && r.suggestion.decidedByActivity && r.job_id === r.suggestion.jobId && (
                          <div className="mt-1 text-[11px] text-[#666]">
                            Two jobs share this address — chose the one worked in the last {ACTIVE_DAYS} days. Check it.
                          </div>
                        )}
                        {r.job_id && !r.suggestion.decidedByActivity && r.suggestion.active === false
                          && r.job_id === r.suggestion.jobId && (
                          <div className="mt-1 text-[11px] text-[#666]">
                            No work logged on this job around {r.date || 'the invoice date'}.
                          </div>
                        )}
                        {!r.job_id && r.suggestion.jobId && (
                          <button onClick={() => update(r.key, { job_id: r.suggestion.jobId! })}
                            className="mt-1 text-[11px] text-blue-700 hover:underline text-left">
                            Use {r.suggestion.jobId} — {r.suggestion.on}
                            {r.suggestion.score < CONFIDENT && r.invoiceAddress
                              ? ` (invoice says “${r.invoiceAddress}”)` : ''}
                          </button>
                        )}
                        {!r.job_id && !r.suggestion.jobId && r.invoiceAddress && (
                          <div className="mt-1 text-[11px] text-[#666]">
                            Invoice address “{r.invoiceAddress}” matched no job.
                          </div>
                        )}
                        {!r.job_id && !r.invoiceAddress && (
                          <div className="mt-1 text-[11px] text-[#666]">
                            No delivery address on the invoice — choose a job, or leave it blank for stock.
                          </div>
                        )}
                      </div>
                      <div className="flex gap-1.5">
                        <button onClick={() => approve(r)} disabled={!!problem || saving === r.key}
                          title={problem ?? 'Save this to the materials log'}
                          className="px-2.5 py-1.5 text-[12px] rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5">
                          {saving === r.key ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                          {problem ?? 'Approve'}
                        </button>
                        <button onClick={() => reject(r.key)} disabled={saving === r.key}
                          className={`${BTN} flex items-center gap-1.5`}>
                          <X size={13} /> Skip
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
