import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * 页面标题层级：一个 h1 + 可选说明 + 右侧操作。
 *
 * 之前每个页面都自己拼 `<h1 className="text-[30px] ...">`，字号/字重/颜色
 * 抄来抄去，偶尔漏一个就出现了 32px / 22px 的"近亲"。这里收成一个组件——
 * 标题尺寸只有一处定义，说明与操作的位置关系也跟着固定下来。
 */
interface PageHeaderProps {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  className?: string
}

export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <header className={cn('flex flex-wrap items-end justify-between gap-x-6 gap-y-2', className)}>
      <div className="min-w-0">
        <h1 className="text-[30px] leading-tight font-bold tracking-[-0.02em] text-ink">{title}</h1>
        {description !== undefined && (
          <p className="mt-1.5 text-[13px] text-ink-soft">{description}</p>
        )}
      </div>
      {actions !== undefined && (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </header>
  )
}
