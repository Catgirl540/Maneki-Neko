import { cn } from '@/lib/cn'

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (next: T) => void
  className?: string
}) {
  return (
    <div
      className={cn(
        'inline-flex rounded-chip border border-line bg-surface p-1',
        className,
      )}
      role="tablist"
    >
      {options.map((opt) => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              'h-9 rounded-chip px-4 text-[13px] font-medium transition-colors duration-200',
              active ? 'bg-gold-wash text-gold-deep' : 'text-ink-soft hover:text-ink',
            )}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

export function Tag({
  children,
  tone = 'neutral',
  className,
}: {
  children: React.ReactNode
  tone?: 'neutral' | 'gold' | 'blue' | 'coral'
  className?: string
}) {
  const tones = {
    neutral: 'bg-sunk text-ink-soft border-line',
    gold: 'bg-gold-wash text-gold-deep border-gold-wash',
    blue: 'bg-blue-wash text-blue border-blue-wash',
    coral: 'bg-coral-wash text-coral border-coral-wash',
  } as const
  return (
    <span
      className={cn(
        'inline-flex h-7 items-center rounded-chip border px-2.5 text-[12px] font-medium',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-tile bg-line/60', className)} />
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <p className="text-[15px] font-medium text-ink">{title}</p>
      {description && <p className="max-w-xs text-[13px] text-ink-mute">{description}</p>}
      {action}
    </div>
  )
}