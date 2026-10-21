import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { CloseIcon } from './icons'
import { cn } from '../../lib/cn'
import { usePresence } from '../../lib/usePresence'

/** 退场动画时长，必须和 `.drawer-out` 的 `--duration-press` 对上。 */
const EXIT_MS = 140

/**
 * 右侧抽屉。
 *
 * 与 `Modal` 的分工：`Modal` 是"打断一下再回去"的居中弹窗（转账、确认、
 * 表单提交）；抽屉是"在列表旁边调一组条件"的侧栏，页面主体仍然可见，
 * 关掉之后回到原来的滚动位置。所以这里不做居中、不缩背景，只从右侧滑出。
 *
 * 生命周期约定与 `Modal` 一致：**常驻挂载 + `open` 控制显隐**。
 * 条件挂载（`{open && <Drawer/>}`）会让退场动画没机会播，
 * 抽屉里的草稿状态也会每次重开都被重建 —— 草稿要由调用方自己管
 * （见 `BillsPage` 的 `useResetOnOpen` 用法）。
 *
 * **不叠加**：抽屉里不要再开 `Modal`。两者各自管 Esc / 焦点陷阱 / body 滚动，
 * 叠在一起会互相抢键盘事件（`Modal` 那份用了共享栈，这份没有）。
 *
 * @module app/components/ui/Drawer
 */
export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 'max-w-[400px]',
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children?: ReactNode
  footer?: ReactNode
  /** 面板宽度，桌面尺度自适应：窄屏自动占满 */
  width?: string
}) {
  const { mounted, exiting } = usePresence(open, EXIT_MS)
  const panel = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose }, [onClose])
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    if (!mounted || !panel.current) return
    const node = panel.current
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    node.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); closeRef.current(); return }
      if (e.key !== 'Tab') return
      const targets = Array.from(node.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'))
        .filter(el => el.getClientRects().length > 0 && !el.closest('[inert]'))
      const first = targets[0]
      const last = targets.at(-1)
      if (!first || !last) { e.preventDefault(); node.focus(); return }
      if (e.shiftKey && (document.activeElement === first || document.activeElement === node)) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && (document.activeElement === last || document.activeElement === node)) { e.preventDefault(); first.focus() }
    }
    const onFocus = (e: FocusEvent) => {
      if (e.target instanceof Node && !node.contains(e.target)) node.focus()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('focusin', onFocus)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('focusin', onFocus)
      document.body.style.overflow = previousOverflow
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [mounted])

  if (!mounted) return null

  return createPortal(
    <div className="fixed inset-0 z-[80] flex justify-end">
      <button
        type="button"
        aria-label="关闭筛选背景"
        tabIndex={-1}
        onClick={onClose}
        className={cn(
          'absolute inset-0 cursor-default bg-ink/25 backdrop-blur-[2px]',
          exiting ? 'fade-out' : 'fade-in',
        )}
      />
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        className={cn(
          'drawer-panel relative flex h-full w-full min-w-0 flex-col border-l border-line bg-surface outline-none',
          'shadow-[-18px_0_48px_rgba(14,27,38,0.14)]',
          exiting ? 'drawer-out' : 'drawer-in',
          width,
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-[17px] leading-6 font-semibold text-ink">{title}</h2>
            {description && <p id={descriptionId} className="mt-1 text-[13px] text-ink-soft">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭抽屉"
            className="grid size-9 shrink-0 place-items-center rounded-chip text-ink-soft transition-colors hover:bg-sunk hover:text-ink"
          >
            <CloseIcon size={20} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-1">{children}</div>
        {footer && <div className="flex gap-3 border-t border-line px-5 py-4">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
