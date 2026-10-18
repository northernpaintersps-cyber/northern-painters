import { useState, useRef, useEffect } from 'react'
import { HelpCircle } from 'lucide-react'

/**
 * A "what is this number" mark.
 *
 * A figure on the Dashboard is a summary of a rule, and the rule is rarely
 * obvious from the label: "Gross margin 2026" says nothing about which costs
 * are in it or which revenue it is a share of. Rather than shorten the rules
 * until they fit on a card, each one is written out here.
 *
 * Hover shows it, and so does a tap — the Dashboard is read on a phone on a
 * site as often as at a desk, and hover does not exist there. Escape and a
 * click elsewhere close it.
 */
export default function InfoTip({ title, children, align = 'left' }: {
  title?: string
  children: React.ReactNode
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc) }
  }, [open])

  return (
    <span ref={ref} className="relative inline-flex align-middle">
      <button
        type="button"
        aria-label={title ? `About ${title}` : 'What is this?'}
        aria-expanded={open}
        // The card underneath is often a link to its page — asking about a
        // number should not navigate away from it.
        onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="text-[#999] hover:text-[#444] focus:text-[#444] focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-500 rounded-full"
      >
        <HelpCircle size={11} />
      </button>
      {open && (
        <span
          role="tooltip"
          onClick={e => e.stopPropagation()}
          // The card it hangs off can be 150px wide on a phone, so the bubble is
          // allowed to be wider than its card but never wider than the screen.
          className={`absolute top-[18px] z-50 w-60 max-w-[calc(100vw-2rem)] cursor-default rounded-lg border border-black/[0.12] bg-white p-2.5
            text-left text-[11px] font-normal leading-[1.45] text-[#333] shadow-lg
            ${align === 'right' ? 'right-0' : 'left-0'}`}
        >
          {title && <span className="mb-1 block text-[11px] font-bold text-gray-900">{title}</span>}
          {children}
        </span>
      )}
    </span>
  )
}

/** The "how it is worked out" line inside a tip, set apart from the prose. */
export function TipCalc({ children }: { children: React.ReactNode }) {
  return (
    <span className="mt-1.5 block border-t border-black/[0.08] pt-1.5 text-[10px] text-[#666]">
      {children}
    </span>
  )
}
