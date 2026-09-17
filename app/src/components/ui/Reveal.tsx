import { cn } from '@/lib/cn'
import { EyeIcon, EyeOffIcon } from './icons'

/**
 * 敏感信息旁边的那只小眼睛。放在哪一块，就只管哪一块。
 */
export function RevealToggle({
  shown,
  onToggle,
  className,
  tone = 'onLight',
  label,
}: {
  shown: boolean
  onToggle: () => void
  className?: string
  /** 放在深色卡面上时要用浅色，否则图标看不见 */
  tone?: 'onLight' | 'onDark'
  label?: string
}) {
  const text = label ?? (shown ? '隐藏' : '显示')
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={shown}
      aria-label={text}
      title={text}
      className={cn(
        'inline-flex size-7 shrink-0 items-center justify-center rounded-full transition-colors',
        tone === 'onDark'
          ? 'text-ink-invert/60 hover:bg-white/15 hover:text-ink-invert'
          : 'text-ink-mute hover:bg-sunk hover:text-ink',
        className,
      )}
    >
      {shown ? <EyeOffIcon size={17} /> : <EyeIcon size={17} />}
    </button>
  )
}

/** 敏感文本：遮住时用等长的圆点，看不出位数 */
export function Masked({
  shown,
  text,
  mask = '••••••',
  className,
}: {
  shown: boolean
  text: string
  mask?: string
  className?: string
}) {
  return <span className={className}>{shown ? text : mask}</span>
}
