import { useEffect } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
}

const sizes = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }

export function Modal({ open, onClose, title, children, size = 'md' }: ModalProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    if (open) document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className={cn('relative w-full bg-white border border-black/15 rounded-xl shadow-[0_8px_40px_rgba(0,0,0,0.15)] max-h-[90vh] flex flex-col', sizes[size])}>
        {title && (
          <div className="flex items-center justify-between px-6 py-4 border-b border-black/10 shrink-0">
            <h3 className="text-base font-semibold text-gray-900">{title}</h3>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-900 transition-colors">
              <X size={16} />
            </button>
          </div>
        )}
        <div className="overflow-y-auto flex-1 p-6">{children}</div>
      </div>
    </div>
  )
}
