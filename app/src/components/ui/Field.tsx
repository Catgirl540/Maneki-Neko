import { useId, type InputHTMLAttributes, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  icon?: ReactNode
  trailing?: ReactNode
  hint?: string
  error?: string
}

export function Field({ label, icon, trailing, hint, error, className, id, ...rest }: FieldProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const hintId = `${inputId}-hint`
  const describedBy = [rest['aria-describedby'], (error || hint) && hintId].filter(Boolean).join(' ') || undefined
  return (
    <div className="min-w-0">
      {label && <label htmlFor={inputId} className="mb-2 block text-[13px] font-medium text-ink-soft">{label}</label>}
      <div className={cn('flex h-14 min-w-0 items-center gap-3 rounded-field border bg-surface px-4 transition-colors', error ? 'border-coral' : 'border-line focus-within:border-gold')}>
        {icon && <span className="shrink-0 text-ink-mute">{icon}</span>}
        <input {...rest} id={inputId} aria-invalid={error ? true : rest['aria-invalid']} aria-describedby={describedBy} className={cn('h-full min-w-0 w-full bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-mute', className)} />
        {trailing && <span className="shrink-0 whitespace-nowrap">{trailing}</span>}
      </div>
      {(error || hint) && <p id={hintId} role={error ? 'alert' : undefined} className={cn('mt-2 text-[13px]', error ? 'text-coral' : 'text-ink-mute')}>{error ?? hint}</p>}
    </div>
  )
}
