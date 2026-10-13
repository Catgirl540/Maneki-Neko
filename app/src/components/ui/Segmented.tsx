import { cn } from '@/lib/cn'

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
  disabled = false,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (next: T) => void
  className?: string
  disabled?: boolean
}) {
  return (
    <div
      className={cn(
        'inline-flex max-w-full flex-wrap rounded-field border border-line bg-surface p-1',
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
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            className={cn(
              'min-h-10 rounded-chip px-3 text-[13px] font-medium whitespace-nowrap transition-colors duration-200 sm:px-4',
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

/**
 * 骨架屏。
 *
 * 用 `.skeleton` 的扫光而不是 `animate-pulse`：脉冲只是整块明暗呼吸，
 * 扫光能表达"正在往这个方向填内容"，也更不容易被误认成一块静态灰底。
 * `.skeleton` 只动 transform，不重排。
 */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton rounded-tile', className)} aria-hidden="true" />
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
