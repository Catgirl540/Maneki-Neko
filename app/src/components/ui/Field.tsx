import type { InputHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/cn'

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  icon?: ReactNode
  trailing?: ReactNode
  hint?: string
  error?: string
}

export function Field({ label, icon, trailing, hint, error, className, ...rest }: FieldProps) {
  return (
    <label className="block">
      {label && (
        <span className="mb-2 block text-[13px] font-medium text-ink-soft">{label}</span>
      )}
      <span
        className={cn(
          'flex h-14 items-center gap-3 rounded-field border bg-surface px-4 transition-colors',
          error ? 'border-coral' : 'border-line focus-within:border-gold',
        )}
      >
        {icon && <span className="shrink-0 text-ink-mute">{icon}</span>}
        <input
          className={cn(
            'h-full w-full bg-transparent text-[15px] text-ink outline-none',
            'placeholder:text-ink-mute',
            className,
          )}
          {...rest}
        />
        {trailing}
      </span>
      {(error || hint) && (
        <span
          className={cn(
            'mt-2 block text-[13px]',
            error ? 'text-coral' : 'text-ink-mute',
          )}
        >
          {error ?? hint}
        </span>
      )}
    </label>
  )
}