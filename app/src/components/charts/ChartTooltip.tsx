import type { ReactNode } from 'react'

/**
 * 图表浮层。
 *
 * 放在图表的 relative 容器里，按百分比 x 定位到数据点旁；
 * 靠近右边缘时整体翻到左侧，避免被卡片裁掉。
 * 用 inline style 写 transform 而不是 Tailwind 任意值 —— calc 里的减号必须有空格，
 * 走 arbitrary value 得写成 `calc(-100%_-_12px)`，太容易写错。
 */
export function ChartTooltip({
  xPct,
  children,
  width = 180,
  flipAt = 58,
}: {
  xPct: number
  children: ReactNode
  width?: number
  flipAt?: number
}) {
  const flip = xPct > flipAt
  return (
    <div
      className="pointer-events-none absolute top-0 z-10 rounded-field border border-line bg-surface px-3.5 py-3 shadow-[0_10px_28px_rgba(14,27,38,0.12)]"
      style={{
        left: `${xPct}%`,
        width,
        transform: flip ? 'translateX(calc(-100% - 12px))' : 'translateX(12px)',
      }}
    >
      {children}
    </div>
  )
}

/** 浮层里的一行「色块 + 名称 + 数值」 */
export function TooltipRow({
  color,
  label,
  value,
}: {
  color: string
  label: string
  value: string
}) {
  return (
    <div className="flex items-center gap-2 text-[12px]">
      <span className="size-2 shrink-0 rounded-chip" style={{ backgroundColor: color }} />
      <span className="text-ink-soft">{label}</span>
      <span className="num ml-auto font-medium text-ink">{value}</span>
    </div>
  )
}
