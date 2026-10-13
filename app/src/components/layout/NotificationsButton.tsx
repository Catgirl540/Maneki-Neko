import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BellIcon } from '@/components/ui/icons'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { formatDateTime } from '@/lib/format'
import { useAsync } from '@/lib/useAsync'
import { api } from '@/api'
import { cn } from '@/lib/cn'

/**
 * 通知入口：铃铛 + 可滚动、可键盘操作的弹窗。
 *
 * - `sidebar`：侧栏底部的一行，展开时显示「通知」，收起时只留图标。
 * - `floating`：移动端悬浮在底部导航之上（移动端没有侧栏）。
 *
 * 红点定位在内层 `relative` 包裹上，不依赖按钮自身的 position ——
 * `cn` 只做拼接、不消解冲突，`relative` 叠在 `fixed` 上会把按钮拽回普通流。
 */
export function NotificationsButton({
  variant = 'sidebar',
  collapsed = false,
}: {
  variant?: 'sidebar' | 'floating'
  collapsed?: boolean
}) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const security = useAsync(() => api.getSecurityOverview(), [])
  const alerts = security.data?.logs.slice(0, 3) ?? []

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="通知"
        aria-haspopup="dialog"
        aria-expanded={open}
        title={variant === 'sidebar' && collapsed ? '通知' : undefined}
        className={variant === 'floating'
          ? 'fixed bottom-20 left-4 z-40 grid size-12 place-items-center rounded-chip border border-line bg-surface text-ink-soft shadow-[0_10px_28px_rgba(14,27,38,0.12)] transition-colors hover:border-line-strong hover:text-ink lg:hidden print:hidden'
          : cn('flex h-12 w-full items-center rounded-tile text-[15px] text-ink-soft transition-colors duration-200 hover:bg-paper hover:text-ink', collapsed ? 'justify-center' : 'gap-3 px-3.5')}
      >
        <span className="relative grid size-5 place-items-center">
          <BellIcon size={20} className={variant === 'sidebar' ? 'text-ink-mute' : undefined} />
          {alerts.length > 0 && <span className="absolute -top-0.5 -right-0.5 size-2 rounded-chip bg-coral" />}
        </span>
        {variant === 'sidebar' && !collapsed && '通知'}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="最新动态" description="最近的账户与安全记录" footer={<Button block onClick={() => { setOpen(false); navigate('/security') }}>查看全部安全日志</Button>}>
        {security.loading && <p className="py-4 text-[14px] text-ink-soft">正在加载通知…</p>}
        {security.error && <div role="alert" className="rounded-field bg-coral-wash p-4 text-[14px] text-ink"><p>{security.error}</p><Button size="sm" className="mt-3" onClick={security.reload}>重新加载</Button></div>}
        {!security.loading && !security.error && alerts.length === 0 && <p className="py-4 text-[14px] text-ink-soft">暂无新动态，账户记录会显示在这里。</p>}
        <ul className="divide-y divide-line">
          {alerts.map(log => <li key={log.id} className="flex items-start gap-3 py-4">
            <span className={`mt-1.5 size-2 shrink-0 rounded-chip ${log.level === 'warn' ? 'bg-coral' : 'bg-blue'}`} />
            <span className="min-w-0"><span className="block text-[14px] font-medium text-ink">{log.action}</span><span className="mt-1 block text-[12px] leading-relaxed break-words text-ink-soft">{formatDateTime(log.createdAt)} · {log.detail}</span></span>
          </li>)}
        </ul>
      </Modal>
    </>
  )
}
