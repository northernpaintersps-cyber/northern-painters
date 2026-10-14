// A change the assistant wants to make, for you to confirm or not.
//
// The whole safety story rests on this card, so it has to be readable in the
// second before you tap: what will happen in one line, the fields it writes
// with the old value where there is one, and any warning the app's own checks
// raised sitting between the detail and the Confirm button rather than above it.
//
// There is no "confirm all". Several changes queue and you tap through them.

import { Check, X, AlertTriangle, Loader2 } from 'lucide-react'
import type { Change } from '@/lib/writes'

const VERB: Record<Change['op'], string> = {
  create: 'Add', update: 'Change', delete: 'Remove',
}

export default function ChangeCard({ change, busy, onConfirm, onCancel, queued }: {
  change: Change
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
  /** How many more are waiting behind this one. */
  queued?: number
}) {
  const warn = change.warnings.length > 0
  return (
    <div className={`rounded-xl border-2 p-3.5 ${warn ? 'border-amber-300 bg-amber-50/40' : 'border-blue-300 bg-blue-50/40'}`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wide text-[#666]">
            {VERB[change.op]} · {change.table.replace('np_', '').replace('_', ' ')}
          </div>
          <div className="text-[13px] font-semibold text-[#1a1a18]">{change.summary}</div>
        </div>
        {!!queued && (
          <span className="shrink-0 text-[10px] text-[#666] bg-white border border-black/[0.12] rounded-full px-2 py-0.5">
            +{queued} more
          </span>
        )}
      </div>

      <div className="bg-white border border-black/[0.1] rounded-lg divide-y divide-black/[0.06] mb-2">
        {change.fields.map((f, i) => (
          <div key={i} className="flex items-baseline gap-2 px-2.5 py-1">
            <span className="text-[11px] text-[#666] w-24 shrink-0">{f.label}</span>
            {f.from != null && f.from !== f.to && (
              <>
                <span className="text-[11.5px] text-[#999] line-through">{f.from}</span>
                <span className="text-[10px] text-[#999]">→</span>
              </>
            )}
            <span className="text-[11.5px] font-medium tabular-nums">{f.to}</span>
          </div>
        ))}
      </div>

      {warn && (
        <div className="flex flex-col gap-1 mb-2.5">
          {change.warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-1.5 text-[11px] text-[#92400e]">
              <AlertTriangle size={11} className="shrink-0 mt-px" />
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <button onClick={onConfirm} disabled={busy}
          className="flex items-center gap-1.5 text-[12.5px] font-semibold px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50">
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
          {warn ? 'Confirm anyway' : 'Confirm'}
        </button>
        <button onClick={onCancel} disabled={busy}
          className="flex items-center gap-1.5 text-[12.5px] px-3 py-1.5 rounded-lg bg-white border border-black/[0.15] hover:bg-[#f5f4f0] disabled:opacity-50">
          <X size={13} /> Cancel
        </button>
      </div>
    </div>
  )
}
