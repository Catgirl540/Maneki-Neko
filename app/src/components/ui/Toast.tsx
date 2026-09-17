import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { ToastContext, type ToastTone } from './toast-context'
import { AlertIcon, CheckIcon } from './icons'
import { cn } from '@/lib/cn'

interface Toast {
  id: number
  message: string
  tone: ToastTone
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

/** 极简轻提示：右上角堆叠，2.6s 自动消失 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const seq = useRef(0)

  const show = useCallback((message: string, tone: ToastTone = 'info') => {
    const id = ++seq.current
    setToasts((prev) => [...prev, { id, message, tone }])
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 2600)
  }, [])

  const value = useMemo(() => ({ show }), [show])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed top-6 right-8 z-[60] flex w-[320px] flex-col gap-2.5 print:hidden"
        role="status"
        aria-live="polite"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cn(
              'float-up flex items-start gap-2.5 rounded-field border px-4 py-3 text-[13px] leading-relaxed',
              'shadow-[0_10px_28px_rgba(14,27,38,0.10)]',
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