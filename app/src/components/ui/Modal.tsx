import { useEffect, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { usePresence } from '@/lib/usePresence'

/** 退场动画时长，必须和 `.pop-out` / `.fade-out` 的 `--duration-press` 对上。 */
const EXIT_MS = 140

/**
 * 轻量弹层：仅用于转入、二次确认等短流程。
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
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children?: ReactNode
  footer?: ReactNode
  width?: string
}) {
  // 关掉之后还要留在 DOM 里把退场动画放完，所以不能直接用 open 决定渲不渲染。
  const { mounted, exiting } = usePresence(open, EXIT_MS)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!mounted) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <button
        type="button"
        aria-label="关闭"
        onClick={onClose}
        className={cn(
          'absolute inset-0 cursor-default bg-ink/25 backdrop-blur-[2px]',
          exiting ? 'fade-out' : 'fade-in',
        )}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'relative w-full rounded-card border border-line bg-surface p-7',
          'shadow-[0_18px_48px_rgba(14,27,38,0.14)]',
          exiting ? 'pop-out' : 'pop-in',
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
