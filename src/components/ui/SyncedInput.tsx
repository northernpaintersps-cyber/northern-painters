import { useEffect, useRef } from 'react'

/**
 * A drop-in for the inline table `<input defaultValue={row.x} onBlur={…}>`
 * that keeps showing the stored value when that value changes underneath it.
 *
 * `defaultValue` is read once, when React creates the element. The row key is
 * stable, so React reuses the same DOM node for the life of the list and never
 * applies a later `defaultValue`. Any refetch arriving after the first paint
 * left the input showing whatever it mounted with — which, for a row that
 * rendered before its data landed, is nothing. Every labour entry appearing to
 * lose its date and worker name was this, not lost data.
 *
 * Uncontrolled while you type, deliberately: these commit on blur, and a
 * controlled input would write a row per keystroke. The value is only pushed
 * back in when the input is not focused, so it never fights the typist.
 */
export function SyncedInput({
  value, ...rest
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'defaultValue'> & {
  value: string | number | null | undefined
}) {
  const ref = useRef<HTMLInputElement>(null)
  const text = value == null ? '' : String(value)

  useEffect(() => {
    const el = ref.current
    if (el && document.activeElement !== el && el.value !== text) el.value = text
  }, [text])

  return <input ref={ref} defaultValue={text} {...rest} />
}
