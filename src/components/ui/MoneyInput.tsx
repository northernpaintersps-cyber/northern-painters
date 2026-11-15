// A price typed either way round.
//
// Stores ex GST, always. The toggle is only about which figure you are
// holding in your head when you type — "$550 all up" from a client, or
// "$500 plus GST" off a quote — and the other one is shown underneath so
// you can see both before saving.
//
// On a cash job there is no GST, so there is no toggle and nothing to echo:
// one figure, labelled as such.

import { useEffect, useState } from 'react'
import { FieldWrapper } from '@/components/ui/Field'
import { fmtCurrency, cn } from '@/lib/utils'
import {
  storedEx, echoOf, fieldValue, savedMode, rememberMode, type GstMode,
} from '@/lib/gstEntry'

export default function MoneyInput({
  label, valueExGST, onChange, gstRate = 0.1, placeholder, wrapperClassName, disabled,
}: {
  label: string
  /** What is stored. Null or '' for an empty field. */
  valueExGST: number | null | undefined
  /** The ex-GST figure to save, or null when the field is empty. */
  onChange: (exGST: number | null) => void
  /** 0 on a cash job, which removes the toggle. */
  gstRate?: number
  placeholder?: string
  wrapperClassName?: string
  disabled?: boolean
}) {
  const hasGst = gstRate > 0
  const [mode, setMode] = useState<GstMode>(() => (hasGst ? savedMode() : 'ex'))
  /** What is in the box, so a half-typed "5" is not rewritten as you type. */
  const [text, setText] = useState(() => fieldValue(valueExGST, hasGst ? savedMode() : 'ex', gstRate))

  // Reopening the form on a different record, or switching mode, refills the
  // box from what is stored — but typing never does, or the cursor jumps.
  useEffect(() => {
    setText(fieldValue(valueExGST, mode, gstRate))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, valueExGST === null || valueExGST === undefined ? 'empty' : 'set'])

  const echo = hasGst ? echoOf(text, mode, gstRate) : null

  const type = (next: string) => {
    setText(next)
    onChange(storedEx(next, mode, gstRate))
  }

  const swap = (next: GstMode) => {
    if (next === mode) return
    // The stored figure does not move: only which one is being shown.
    setMode(next)
    rememberMode(next)
    setText(fieldValue(storedEx(text, mode, gstRate), next, gstRate))
  }

  return (
    <FieldWrapper label={label} className={wrapperClassName}>
      <div className="flex items-stretch gap-1.5">
        <input
          type="number" step="0.01" min={0} inputMode="decimal"
          value={text} placeholder={placeholder} disabled={disabled}
          onChange={e => type(e.target.value)}
          className="w-full bg-white border border-black/20 rounded-lg px-3 py-2 text-[13px] text-gray-900 tabular-nums focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-60" />
        {hasGst ? (
          <div className="flex shrink-0 rounded-lg bg-gray-100 p-0.5">
            {(['ex', 'inc'] as GstMode[]).map(m => (
              <button key={m} type="button" onClick={() => swap(m)} disabled={disabled}
                title={m === 'ex' ? 'The figure before GST' : 'The figure the client pays, GST included'}
                className={cn(
                  'px-2 text-[11px] font-semibold rounded-md transition-colors',
                  mode === m ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900',
                )}>
                {m === 'ex' ? 'ex GST' : 'inc GST'}
              </button>
            ))}
          </div>
        ) : (
          <span className="flex shrink-0 items-center px-2 text-[11px] text-[#166534] bg-[#dcfce7] rounded-lg">
            cash — no GST
          </span>
        )}
      </div>
      {echo !== null && (
        <div className="text-[11px] text-[#666] mt-0.5 tabular-nums">
          = {fmtCurrency(echo)} {mode === 'inc' ? 'ex GST, which is what is saved' : 'inc GST'}
        </div>
      )}
    </FieldWrapper>
  )
}
