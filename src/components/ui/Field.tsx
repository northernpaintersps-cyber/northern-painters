import { cn } from '@/lib/utils'

const base = 'w-full bg-white border border-black/20 rounded-lg px-3 py-2 text-[13px] text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500'

interface FieldProps {
  label: string
  error?: string
  className?: string
  children: React.ReactNode
}

export function FieldWrapper({ label, error, className, children }: FieldProps) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <label className="text-xs font-medium text-gray-500">{label}</label>
      {children}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string
  error?: string
  wrapperClassName?: string
}

export function Input({ label, error, wrapperClassName, className, ...props }: InputProps) {
  return (
    <FieldWrapper label={label} error={error} className={wrapperClassName}>
      <input className={cn(base, className)} {...props} />
    </FieldWrapper>
  )
}

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label: string
  options: string[]
  error?: string
  wrapperClassName?: string
  placeholder?: string
}

export function Select({ label, options, error, wrapperClassName, className, placeholder, ...props }: SelectProps) {
  return (
    <FieldWrapper label={label} error={error} className={wrapperClassName}>
      <select className={cn(base, 'cursor-pointer', className)} {...props}>
        {placeholder !== undefined && <option value="">{placeholder || '—'}</option>}
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </FieldWrapper>
  )
}

interface TextAreaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string
  error?: string
  wrapperClassName?: string
}

export function TextArea({ label, error, wrapperClassName, className, ...props }: TextAreaProps) {
  return (
    <FieldWrapper label={label} error={error} className={wrapperClassName}>
      <textarea className={cn(base, 'resize-none', className)} rows={3} {...props} />
    </FieldWrapper>
  )
}
