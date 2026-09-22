import { cn } from '@/lib/utils'

type Variant = 'green' | 'blue' | 'amber' | 'red' | 'purple' | 'gray' | 'teal'

const variants: Record<Variant, string> = {
  green:  'bg-green-100 text-green-800',
  blue:   'bg-blue-100 text-blue-800',
  amber:  'bg-amber-100 text-amber-800',
  red:    'bg-red-100 text-red-800',
  purple: 'bg-purple-100 text-purple-800',
  gray:   'bg-gray-100 text-gray-600',
  teal:   'bg-teal-100 text-teal-800',
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
