import { useEffect, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

/** 轻量弹层：仅用于转入、二次确认等短流程 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 'max-w-[440px]',
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children?: ReactNode
  footer?: ReactNode
  width?: string
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <button
        type="button"
        aria-label="关闭"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-ink/25 backdrop-blur-[2px]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'float-up relative w-full rounded-card border border-line bg-surface p-7',
          'shadow-[0_18px_48px_rgba(14,27,38,0.14)]',
          width,
        )}
      >
        <h2 className="text-[20px] leading-7 font-semibold text-ink">{title}</h2>
        {description && <p className="mt-2 text-[14px] text-ink-soft">{description}</p>}
        {children && <div className="mt-6">{children}</div>}
        {footer && <div className="mt-7 flex gap-3">{footer}</div>}
      </div>
    </div>
  )
}