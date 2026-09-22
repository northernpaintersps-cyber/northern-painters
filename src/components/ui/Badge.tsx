import { cn } from '@/lib/utils'

type Variant = 'green' | 'blue' | 'amber' | 'red' | 'purple' | 'gray' | 'teal'

const variants: Record<Variant, string> = {
  green:  'bg-green-500/20 text-green-400',
  blue:   'bg-blue-500/20 text-blue-400',
  amber:  'bg-amber-500/20 text-amber-400',
  red:    'bg-red-500/20 text-red-400',
  purple: 'bg-purple-500/20 text-purple-400',
  gray:   'bg-gray-500/20 text-gray-400',
  teal:   'bg-teal-500/20 text-teal-400',
}

export const STATUS_VARIANT: Record<string, Variant> = {
  'Active': 'green', 'In Progress': 'green', 'Accepted': 'green', 'Booked': 'teal', 'Won': 'green',
  'Quoting': 'amber', 'Sent': 'blue', 'Negotiating': 'amber', 'Scheduled': 'blue', 'Not Started': 'gray',
  'Completed': 'blue', 'Finished': 'blue', 'Closed': 'blue', 'Invoiced': 'purple',
  'On Hold': 'gray', 'Cancelled': 'red', 'Lost': 'red', 'Not Accepted': 'red',
  'Paid': 'green', 'Part Paid': 'amber', 'Unpaid': 'red',
  'Pending': 'amber', 'Approved': 'green', 'Rejected': 'red',
  'New': 'blue', 'Info Collected': 'gray', 'Site Visit': 'amber', 'Quote Created': 'blue',
  'High': 'red', 'Normal': 'blue', 'Low': 'gray',
}

interface BadgeProps {
  label: string
  variant?: Variant
  className?: string
}

export function Badge({ label, variant, className }: BadgeProps) {
  const v = variant ?? STATUS_VARIANT[label] ?? 'gray'
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap', variants[v], className)}>
      {label}
    </span>
  )
}
