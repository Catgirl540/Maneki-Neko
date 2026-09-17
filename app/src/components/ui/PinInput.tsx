import { useRef, type ClipboardEvent, type KeyboardEvent } from 'react'
import { cn } from '@/lib/cn'

/**
 * 支付密码输入：6 个独立格子。
 *
 * 用 `type="password"` 让浏览器自己打点，不手写掩码逻辑。
 * 每格只收一位数字 —— 支付密码是纯数字，直接掐掉别的字符比事后报错好。
 * 支持整段粘贴（手机验证码/密码管理器的常见用法）。
 */
export function PinInput({
  value,
  onChange,
  length = 6,
  label,
  error,
  autoFocus,
  disabled,
  className,
}: {
  value: string
  onChange: (next: string) => void
  length?: number
  label: string
  error?: string
  autoFocus?: boolean
  disabled?: boolean
  className?: string
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([])
  const digits = value.split('')

  function focusAt(index: number) {
    const target = refs.current[Math.min(Math.max(index, 0), length - 1)]
    target?.focus()
    target?.select()
  }

  function setAt(index: number, char: string) {
    const next = digits.slice()
    next[index] = char
    onChange(next.join('').slice(0, length))
  }

  function onInput(index: number, raw: string) {
    const char = raw.replace(/\D/g, '').slice(-1)
    if (!char) return
    setAt(index, char)
    focusAt(index + 1)
  }

  function onKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Backspace') {
      event.preventDefault()
      if (digits[index]) {
        setAt(index, '')
      } else if (index > 0) {
        setAt(index - 1, '')
        focusAt(index - 1)
      }
      return
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      focusAt(index - 1)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      focusAt(index + 1)
    }
  }

  function onPaste(event: ClipboardEvent<HTMLInputElement>) {
    const text = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, length)
    if (!text) return
    event.preventDefault()
    onChange(text)
    focusAt(text.length)
  }

  return (
    <div className={className}>
      <p className="mb-2 text-[13px] font-medium text-ink-soft">{label}</p>
      <div className="flex gap-2.5">
        {Array.from({ length }, (_, index) => (
          <input
            key={index}
            ref={(el) => {
              refs.current[index] = el
            }}
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={1}
            disabled={disabled}
            autoFocus={autoFocus && index === 0}
            aria-label={`${label}第 ${index + 1} 位`}
            value={digits[index] ?? ''}
            onChange={(e) => onInput(index, e.target.value)}
            onKeyDown={(e) => onKeyDown(index, e)}
            onPaste={onPaste}
            onFocus={(e) => e.target.select()}
            className={cn(
              'num h-14 w-full min-w-0 rounded-field border bg-surface text-center text-[20px] text-ink outline-none transition-colors',
              error ? 'border-coral' : 'border-line focus:border-gold',
              disabled && 'opacity-50',
            )}
          />
        ))}
      </div>
      {error && <p className="mt-2 text-[13px] text-coral">{error}</p>}
    </div>
  )
}
