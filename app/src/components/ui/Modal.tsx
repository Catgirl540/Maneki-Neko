import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { CloseIcon } from './icons'
import { cn } from '../../lib/cn'
import { usePresence } from '../../lib/usePresence'

/** 退场动画时长，必须和 `.pop-out` / `.fade-out` 的 `--duration-press` 对上。 */
const EXIT_MS = 140
const dialogStack: HTMLElement[] = []
let previousOverflow = ''

/**
 * 通用弹层：用于转入、转出及其它账户操作。
 *
 * ## 退场动画要靠 `open` 驱动，不能靠父级卸载
 *
 * 关掉的动画只在这两种情况下会播：
 *
 * ```tsx
 * // ✅ 常驻挂载，用 open 控制显隐
 * <MyModal open={open} onClose={…} />
 *
 * // ❌ 条件挂载：父级直接把组件从树上摘了，本组件没机会播退场动画
 * {open && <MyModal onClose={…} />}
 * ```
 *
 * 第二种写法还有个副作用：包装组件里往往把 `open` 写死成 `open`（永远为真），
 * 于是连"是不是正在关"都无从判断。
 *
 * 常驻挂载的代价是**表单状态不会自己重置**了（以前靠"关掉就卸载"白捡的）。
 * 用 `useResetOnOpen(open, reset)` 补回来，别用 `key={open ? 'a' : 'b'}`——
 * 那个写法会在关闭的瞬间重挂载，退场动画同样没了
 * （`DashboardPage` 里原来就是这么写的，见那边的注释）。
 *
 * **已知没跟上的地方**：`CardApplicationModal` / `CardSecretsModal` /
 * `ProductDetailModal` / `RedeemModal` / `RiskAssessmentModal` /
 * `WealthAccountOpeningModal` 这几个还是"包装组件 + 父级条件挂载"的老写法，
 * 所以它们**只有入场动画、没有退场动画**。改法是纯机械的（把包装组件的
 * `open` 由写死改成从 props 传、父级改成常驻挂载），但要逐个核对包装组件
 * 在数据为空时不会解引用，所以没有顺手一起动。
 *
 * @module app/components/ui/Modal
 */

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 'max-w-[440px]',
  closeDisabled = false,
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children?: ReactNode
  footer?: ReactNode
  width?: string
  /** 写操作提交期间禁止关闭，避免丢失结果或重复提交。 */
  closeDisabled?: boolean
}) {
  // 关掉之后还要留在 DOM 里把退场动画放完，所以不能直接用 open 决定渲不渲染。
  const { mounted, exiting } = usePresence(open, EXIT_MS)
  const dialog = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = () => { if (!closeDisabled) onClose() } }, [onClose, closeDisabled])
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    if (!mounted || !dialog.current) return
    const panel = dialog.current
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (dialogStack.length === 0) {
      previousOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
    }
    dialogStack.push(panel)
    panel.focus()
    const onKey = (e: KeyboardEvent) => {
      if (dialogStack.at(-1) !== panel) return
      if (e.key === 'Escape') { e.preventDefault(); closeRef.current(); return }
      if (e.key !== 'Tab') return
      const targets = Array.from(panel.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'))
        .filter(el => el.getClientRects().length > 0 && !el.closest('[inert]'))
      const first = targets[0]
      const last = targets.at(-1)
      if (!first || !last) { e.preventDefault(); panel.focus(); return }
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && (document.activeElement === last || document.activeElement === panel)) { e.preventDefault(); first.focus() }
    }
    const onFocus = (e: FocusEvent) => {
      if (dialogStack.at(-1) === panel && e.target instanceof Node && !panel.contains(e.target)) panel.focus()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('focusin', onFocus)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('focusin', onFocus)
      const index = dialogStack.indexOf(panel)
      if (index >= 0) dialogStack.splice(index, 1)
      if (dialogStack.length === 0) document.body.style.overflow = previousOverflow
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [mounted])

  if (!mounted) return null

  return createPortal(
    <div className="modal-overlay fixed inset-0 z-[80] flex items-center justify-center overflow-y-auto p-3 sm:p-6">
      <button
        type="button"
        aria-label="关闭弹窗背景"
        tabIndex={-1}
        onClick={onClose}
        disabled={closeDisabled}
        className={cn(
          'absolute inset-0 cursor-default bg-ink/25 backdrop-blur-[2px]',
          exiting ? 'fade-out' : 'fade-in',
        )}
      />
      <div
        ref={dialog}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-busy={closeDisabled || undefined}
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        className={cn(
          'modal-panel relative w-full min-w-0 overflow-y-auto rounded-card border border-line bg-surface p-5 outline-none sm:p-7',
          'shadow-[0_18px_48px_rgba(14,27,38,0.14)]',
          exiting ? 'pop-out' : 'pop-in',
          width,
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="pt-1 text-[20px] leading-7 font-semibold text-ink">{title}</h2>
          <button type="button" onClick={onClose} disabled={closeDisabled} aria-label="关闭弹窗" className="grid size-10 shrink-0 place-items-center rounded-chip text-ink-soft transition-colors hover:bg-sunk hover:text-ink"><CloseIcon size={20} /></button>
        </div>
        {description && <p id={descriptionId} className="mt-2 text-[14px] text-ink-soft">{description}</p>}
        {children && <div className="mt-6">{children}</div>}
        {footer && <div className="mt-7 flex gap-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
