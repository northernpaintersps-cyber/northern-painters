// A searchable job field, for the modals that used to list every job in a
// plain <select>. Matches on job number, client and address, so "12",
// "esmonde" and "jordy" all find NP-0012 — Jordy Mckay — 81 Esmonde St.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, X, ChevronDown } from 'lucide-react'
import { jobLabel, matchesJob, type PickableJob } from '@/lib/utils'

export { jobLabel, matchesJob, type PickableJob }

export default function JobPicker({
  jobs, value, onChange, label = 'Job', placeholder = 'Search job number, client or address…',
  allowNone = true, noneLabel = '— No job —', className = '',
}: {
  jobs: PickableJob[]
  value: string | null | undefined
  onChange: (id: string, job: PickableJob | undefined) => void
  label?: string | null
  placeholder?: string
  allowNone?: boolean
  noneLabel?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const selected = jobs.find(j => j.id === value)
  const matches = useMemo(() => jobs.filter(j => matchesJob(j, query)), [jobs, query])

  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  useEffect(() => { setActive(0) }, [query])

  function pick(j: PickableJob | undefined) {
    onChange(j?.id ?? '', j)
    setOpen(false)
    setQuery('')
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { setOpen(false); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, matches.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (matches[active]) pick(matches[active]) }
  }

  return (
    <div className={className}>
      {label && <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>}
      <div ref={boxRef} className="relative">
        <button type="button" onClick={() => setOpen(o => !o)}
          className="w-full flex items-center gap-2 bg-white border border-black/20 rounded-lg px-3 py-2 text-[13px] text-left focus:outline-none focus:ring-1 focus:ring-blue-500">
          <span className={`flex-1 truncate ${selected ? 'text-gray-900' : 'text-gray-400'}`}>
            {selected ? jobLabel(selected) : noneLabel}
          </span>
          {selected && allowNone && (
            <span role="button" tabIndex={-1} title="Clear"
              onClick={e => { e.stopPropagation(); pick(undefined) }}
              className="text-[#999] hover:text-[#c0392b]">
              <X size={13} />
            </span>
          )}
          <ChevronDown size={13} className="text-[#999] shrink-0" />
        </button>

        {open && (
          <div className="absolute z-30 mt-1 w-full bg-white border border-black/20 rounded-lg shadow-lg overflow-hidden">
            <div className="flex items-center gap-1.5 px-2.5 py-2 border-b border-black/[0.08]">
              <Search size={13} className="text-[#999] shrink-0" />
              <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)}
                onKeyDown={onKeyDown} placeholder={placeholder}
                className="flex-1 min-w-0 text-[13px] bg-transparent focus:outline-none" />
            </div>
            <div className="max-h-56 overflow-y-auto">
              {allowNone && (
                <button type="button" onClick={() => pick(undefined)}
                  className="w-full text-left px-2.5 py-1.5 text-[12px] text-[#666] hover:bg-[#f5f4f0]">
                  {noneLabel}
                </button>
              )}
              {matches.length === 0 ? (
                <div className="px-2.5 py-3 text-[12px] text-[#999]">No job matches “{query}”.</div>
              ) : matches.map((j, i) => (
                <button key={j.id} type="button" onClick={() => pick(j)}
                  onMouseEnter={() => setActive(i)}
                  className={`w-full text-left px-2.5 py-1.5 ${i === active ? 'bg-[#eff6ff]' : 'hover:bg-[#f5f4f0]'}`}>
                  <div className="text-[12.5px]">
                    <span className="font-semibold text-[#2563eb]">{j.id}</span>
                    {j.client && <span className="ml-1.5">{j.client}</span>}
                  </div>
                  {(j.address || j.status) && (
                    <div className="text-[10.5px] text-[#666] truncate">
                      {[j.address, j.status].filter(Boolean).join(' · ')}
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
