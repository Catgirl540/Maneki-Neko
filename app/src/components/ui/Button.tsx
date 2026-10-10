import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/cn'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

const VARIANTS: Record<Variant, string> = {
  // 一屏只允许一个金色主按钮
  primary:
    'bg-gold text-ink hover:bg-gold-deep hover:text-ink-invert active:scale-[0.985] disabled:bg-gold/40 disabled:text-ink/40',
  secondary:
    'bg-surface text-ink border border-line hover:border-line-strong hover:bg-sunk active:scale-[0.985] disabled:text-ink-mute',
  ghost: 'bg-transparent text-ink-soft hover:bg-sunk hover:text-ink disabled:text-ink-mute',
  danger: 'bg-coral-wash text-coral hover:bg-coral hover:text-ink-invert',
}

const SIZES: Record<Size, string> = {
  sm: 'h-9 px-3.5 text-[13px] gap-1.5 rounded-chip',
  md: 'h-12 px-5 text-[15px] gap-2 rounded-chip',
  lg: 'h-14 px-6 text-[15px] gap-2 rounded-chip',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  block?: boolean
  icon?: ReactNode
  trailing?: ReactNode
  loading?: boolean
}

export function Button({
  variant = 'secondary',
  size = 'md',
  block,
  icon,
  trailing,
  loading,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={cn(
        // 逐个列出要过渡的属性，不用 `transition-all`：
        // 后者把 width/height 这类**布局**属性也纳进来，按钮在文字变化或
        // 变成 block 时会跟着做一次重排动画（看起来像"抖一下"），
        // 而且没人能从 `transition-all` 看出到底打算动什么。
        'inline-flex items-center justify-center whitespace-nowrap font-medium',
        'transition-[background-color,color,border-color,transform,opacity]',
        'duration-[var(--duration-state)] ease-[var(--ease-out-soft)]',
        'disabled:cursor-not-allowed',
        VARIANTS[variant],
        SIZES[size],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? (
        <span
          className="size-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden="true"
        />
      ) : (
        icon
      )}
      {children}
      {trailing}
    </button>
  )
}
