import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { ToastContext, type ToastTone } from './toast-context'
import { AlertIcon, CheckIcon } from './icons'
import { cn } from '@/lib/cn'

/** 一条轻提示停留多久（不含退场动画）。 */
const TOAST_HOLD_MS = 2600
/** 退场动画时长，必须和 `.toast-out` 的 `--duration-press` 对上。 */
const TOAST_EXIT_MS = 140

interface Toast {
  id: number
  message: string
  tone: ToastTone
  /** 正在退场：换成滑出动画。 */
  exiting?: boolean
}

const TONES: Record<ToastTone, { className: string; icon: ReactNode }> = {
  info: { className: 'border-line bg-surface text-ink', icon: null },
  success: {
    className: 'border-blue-wash bg-blue-tint text-ink',
    icon: <CheckIcon size={17} className="text-blue" />,
  },
  error: {
    className: 'border-coral-wash bg-coral-wash text-ink',
    icon: <AlertIcon size={17} className="text-coral" />,
  },
}

/**
 * 极简轻提示：右上角堆叠，停留 2.6s 后滑出。
 *
 * 退场用**两个**定时器而不是一个：到点先打上 `exiting` 让它滑出去，
 * 动画放完才真的从列表里摘掉。原来是一个定时器直接删——轻提示是"啪"地没的，
 * 而它偏偏正是用户盯着看的那个东西。
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const seq = useRef(0)

  const show = useCallback((message: string, tone: ToastTone = 'info') => {
    const id = ++seq.current
    setToasts((prev) => [...prev, { id, message, tone }])
    window.setTimeout(() => {
      setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, exiting: true } : t)))
    }, TOAST_HOLD_MS)
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, TOAST_HOLD_MS + TOAST_EXIT_MS)
  }, [])

  const value = useMemo(() => ({ show }), [show])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed top-11 right-4 left-4 z-[90] flex flex-col gap-2.5 sm:left-auto sm:right-8 sm:w-[320px] print:hidden"
        role="status"
        aria-live="polite"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cn(
              'flex items-start gap-2.5 rounded-field border px-4 py-3 text-[13px] leading-relaxed',
              'shadow-[0_10px_28px_rgba(14,27,38,0.10)]',
              toast.exiting === true ? 'toast-out' : 'toast-in',
              TONES[toast.tone].className,
            )}
          >
            {TONES[toast.tone].icon}
            <span className="min-w-0">{toast.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
