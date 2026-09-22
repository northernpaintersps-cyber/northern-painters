import { cn } from '@/lib/utils'
import type { LucideIcon } from 'lucide-react'

interface StatCardProps {
  label: string
  value: string | number
  sub?: string
  icon?: LucideIcon
  color?: 'default' | 'green' | 'red' | 'amber' | 'blue' | 'purple' | 'gray'
  onClick?: () => void
}

const colors = {
  default: 'text-gray-900',
  green:   'text-green-400',
  red:     'text-red-400',
  amber:   'text-amber-400',
  blue:    'text-blue-400',
  purple:  'text-purple-400',
  gray:    'text-gray-500',
}

export function StatCard({ label, value, sub, icon: Icon, color = 'default', onClick }: StatCardProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'bg-white border border-gray-200 rounded-xl p-4',
        onClick && 'cursor-pointer hover:border-gray-600 transition-colors'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">{label}</p>
          <p className={cn('text-2xl font-bold tabular-nums', colors[color])}>{value}</p>
          {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
        </div>
        {Icon && (
          <div className="shrink-0 w-9 h-9 rounded-lg bg-gray-50 flex items-center justify-center">
            <Icon size={16} className="text-gray-500" />
          </div>
        )}
      </div>
    </div>
  )
}
