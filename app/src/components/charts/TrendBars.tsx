import { useState } from 'react'
import type { Currency, SpendingTrendPoint } from '@/api/types'
import { cn } from '@/lib/cn'
import { formatCurrency } from '@/lib/format'

/**
 * 近 6 个月支出走势：细柱 + 基线，无网格无花哨。
 *
 * 默认高亮最后一个月并显示数值，鼠标移到任意一列就切到那个月。
 * 数值一律渲染出来但未选中时透明 —— 这样切换高亮时行高和基线都不会跳。
 * 图表本身对读屏是装饰性的（aria-hidden），完整数据用一份 sr-only 列表给出。
 */
export function TrendBars({
  points,
  height = 132,
  currency = 'CNY',
}: {
  points: SpendingTrendPoint[]
  height?: number
  currency?: Currency
}) {
  const [active, setActive] = useState<number | null>(null)
  const max = Math.max(...points.map((p) => p.amount), 1)
  const shown = active ?? points.length - 1
  const monthOf = (month: string) => Number(month.split('-')[1])

  return (
    <div>
      <ul className="sr-only">
        {points.map((point) => (
          <li key={point.month}>
            {point.month} 支出 {formatCurrency(point.amount, currency)}
          </li>
        ))}
      </ul>

      <div
        className="flex items-end gap-3"
        style={{ height }}
        aria-hidden="true"
        onPointerLeave={() => setActive(null)}
      >
        {points.map((point, index) => {
          const isShown = index === shown
          const barHeight = Math.max((point.amount / max) * (height - 34), 6)
          return (
            <div
              key={point.month}
              onPointerEnter={() => setActive(index)}
              className="flex min-w-0 flex-1 cursor-default flex-col items-center gap-2"
            >
              <span
                className={cn(
                  'num text-[11px] leading-none whitespace-nowrap transition-colors',
                  isShown ? 'font-medium text-ink' : 'text-transparent',
                )}
              >
                {formatCurrency(point.amount, currency)}
              </span>
              <div
                className={cn(
                  'w-full rounded-t-[6px] transition-[height,background-color] duration-500',
                  isShown ? 'bg-gold' : 'bg-gold-wash',
                )}
                style={{ height: barHeight }}
              />
              <span
                className={cn(
                  'text-[12px] leading-none transition-colors',
                  isShown ? 'font-medium text-ink' : 'text-ink-mute',
                )}
              >
                {monthOf(point.month)} 月
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
