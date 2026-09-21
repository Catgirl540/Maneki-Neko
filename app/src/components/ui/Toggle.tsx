import { cn } from '@/lib/cn'

export function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-7 w-12 shrink-0 rounded-chip transition-colors duration-200',
        checked ? 'bg-gold' : 'bg-line-strong',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <span
        className={cn(
          // 位置用 translate 而不是 left：left 是布局属性，过渡它每帧都要重排；
          // 而且 `transition-transform` 对 left 根本不生效——那样滑块会**瞬移**。
          // 滑块 20px、轨道 48px、左右各留 4px，所以最大位移正好 20px。
          'absolute top-1 left-1 size-5 rounded-full bg-surface',
          'transition-transform duration-[var(--duration-state)] ease-[var(--ease-out-soft)]',
          checked ? 'translate-x-5' : 'translate-x-0',
        )}
      />
    </button>
  )
}

export function Row({
  title,
  description,
  right,
  icon,
  className,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  right?: React.ReactNode
  icon?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-center gap-4 py-4', className)}>
      {icon && (
        <span className="grid size-10 shrink-0 place-items-center rounded-tile bg-gold-tint text-gold-deep">
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium text-ink">{title}</span>
        {description && (
          <span className="mt-0.5 block truncate text-[13px] text-ink-mute">{description}</span>
        )}
      </span>
      {right && <span className="shrink-0">{right}</span>}
    </div>
  )
}