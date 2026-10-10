import { useId, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { CashFlowPoint } from '@/api/types'
import { formatAmount } from '@/lib/format'
import { cn } from '@/lib/cn'
import { ChartTooltip, TooltipRow } from './ChartTooltip'

/**
 * 画布用固定 viewBox + preserveAspectRatio="none"，让图形随容器宽度伸缩；
 * 描边靠 non-scaling-stroke 保持粗细。注意：这种非等比缩放下 SVG 里的
 * <circle> 会变成椭圆，所以**数据点标记与竖线用 HTML 叠层画**，
 * 而不是画进 SVG 里。
 */
const W = 720
const H = 240
const PAD_TOP = 16
const PAD_BOTTOM = 10

/** 天数少时全画；30 天必须抽稀，否则 X 轴糊成一团 */
const MAX_TICKS_DENSE = 7

interface Series {
  key: 'income' | 'expense'
  label: string
  color: string
  /** 面积渐变上端的透明度，向下淡出到透明 */
  topOpacity: number
}

const SERIES: Series[] = [
  { key: 'income', label: '收入', color: 'var(--color-gold)', topOpacity: 0.32 },
  { key: 'expense', label: '支出', color: 'var(--color-blue)', topOpacity: 0.26 },
]

const xOf = (index: number, count: number) => (count > 1 ? (index / (count - 1)) * W : W / 2)
const yOf = (value: number, max: number) =>
  PAD_TOP + (1 - value / max) * (H - PAD_TOP - PAD_BOTTOM)

function linePath(values: number[], max: number, count: number): string {
  return values
    .map((v, i) => `${i === 0 ? 'M' : 'L'} ${xOf(i, count).toFixed(2)} ${yOf(v, max).toFixed(2)}`)
    .join(' ')
}

function areaPath(values: number[], max: number, count: number): string {
  return `${linePath(values, max, count)} L ${W} ${H} L 0 ${H} Z`
}

/** X 轴刻度取样：等间隔挑几个，首尾一定保留 */
function tickIndices(count: number, max: number): number[] {
  if (count <= max) return Array.from({ length: count }, (_, i) => i)
  const stride = (count - 1) / (max - 1)
  return [...new Set(Array.from({ length: max }, (_, i) => Math.round(i * stride)))]
}

/** "2026-09-15" → "9/15" */
const axisLabel = (date: string) => {
  const [, m, d] = date.split('-')
  return `${Number(m)}/${Number(d)}`
}

/** "2026-09-15" → "9 月 15 日" */
const fullLabel = (date: string) => {
  const [, m, d] = date.split('-')
  return `${Number(m)} 月 ${Number(d)} 日`
}

/**
 * 现金流面积图：收入（金）与支出（蓝）双序列叠加。
 * 鼠标进入即出竖线 + 数据点标记 + 当日浮层；左右方向键也能逐日查看。
 */
export function CashFlowChart({ points, maxTicks = MAX_TICKS_DENSE }: { points: CashFlowPoint[]; maxTicks?: number }) {
  const [active, setActive] = useState<number | null>(null)
  const uid = useId().replace(/:/g, '')

  if (points.length === 0) {
    return (
      <div className="grid h-[240px] place-items-center text-[13px] text-ink-mute">暂无数据</div>
    )
  }

  const count = points.length
  const max = Math.max(...points.flatMap((p) => [p.income, p.expense]), 1)
  // 让刻度取整到好看的档位（数据单位是「分」）
  const magnitude = 10 ** Math.floor(Math.log10(max))
  const niceMax = Math.ceil(max / (magnitude / 2)) * (magnitude / 2)
  const ticks = [niceMax, niceMax / 2, 0]

  /** 分 → 轴标签（元），过万折算成「万」 */
  const tickLabel = (cents: number) => {
    if (cents === 0) return '0'
    const yuan = cents / 100
    if (yuan >= 10000) return `${Number((yuan / 10000).toFixed(1))}万`
    return yuan.toLocaleString('zh-CN', { maximumFractionDigits: 0 })
  }

  const visibleTicks = tickIndices(count, Math.max(2, maxTicks))
  const activePoint = active == null ? null : points[active]
  const activeXPct = active == null || count < 2 ? 0 : (active / (count - 1)) * 100

  /** 用容器实测宽度换算下标，而不是 SVG 用户单位 —— 图形是被拉伸的 */
  function pick(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    if (rect.width === 0 || count < 2) return
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
    setActive(Math.round(ratio * (count - 1)))
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      const step = event.key === 'ArrowLeft' ? -1 : 1
      setActive((prev) => {
        const base = prev ?? (step > 0 ? -1 : count)
        return Math.min(count - 1, Math.max(0, base + step))
      })
    } else if (event.key === 'Escape') {
      setActive(null)
    }
  }

  return (
    <div className="flex gap-3">
      {/* Y 轴刻度：绝对定位到与网格线**完全对齐**的 y 上 */}
      <div className="relative w-10 shrink-0" style={{ height: H }}>
        {ticks.map((t) => (
          <span
            key={t}
            className="num absolute right-0 -translate-y-1/2 text-[11px] leading-none text-ink-mute"
            style={{ top: yOf(t, niceMax) }}
          >
            {tickLabel(t)}
          </span>
        ))}
      </div>

      <div className="min-w-0 flex-1">
        <div
          className="relative rounded-tile"
          style={{ height: H }}
          tabIndex={0}
          role="group"
          aria-label={`现金流图，共 ${count} 天。可用左右方向键逐日查看。`}
          onPointerMove={pick}
          onPointerDown={pick}
          onPointerLeave={() => setActive(null)}
          onKeyDown={onKeyDown}
        >
          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full"
            aria-hidden="true"
          >
            <defs>
              {SERIES.map((s) => (
                <linearGradient key={s.key} id={`${uid}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={s.color} stopOpacity={s.topOpacity} />
                  <stop offset="100%" stopColor={s.color} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>

            {/* 网格线 */}
            {ticks.map((t) => (
              <line
                key={t}
                x1={0}
                x2={W}
                y1={yOf(t, niceMax)}
                y2={yOf(t, niceMax)}
                stroke="var(--color-line)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            ))}

            {SERIES.map((s) => {
              const values = points.map((p) => p[s.key])
              return (
                <g key={s.key}>
                  <path d={areaPath(values, niceMax, count)} fill={`url(#${uid}-${s.key})`} />
                  <path
                    d={linePath(values, niceMax, count)}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={2.4}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              )
            })}
          </svg>

          {/* 悬停竖线 + 数据点标记（HTML 叠层，保证是正圆） */}
          {activePoint && (
            <div className="pointer-events-none absolute inset-0" aria-hidden="true">
              <span
                className="absolute top-0 bottom-0 w-px bg-line-strong"
                style={{ left: `${activeXPct}%` }}
              />
              {SERIES.map((s) => (
                <span
                  key={s.key}
                  className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-chip border-2 bg-surface transition-[top] duration-75"
                  style={{
                    left: `${activeXPct}%`,
                    top: yOf(activePoint[s.key], niceMax),
                    borderColor: s.color,
                  }}
                />
              ))}
            </div>
          )}

          {activePoint && (
            <ChartTooltip xPct={activeXPct}>
              <p className="text-[12px] font-medium text-ink">{fullLabel(activePoint.date)}</p>
              <div className="mt-2 flex flex-col gap-1.5">
                {SERIES.map((s) => (
                  <TooltipRow
                    key={s.key}
                    color={s.color}
                    label={s.label}
                    value={`¥${formatAmount(activePoint[s.key])}`}
                  />
                ))}
              </div>
              <div className="mt-2 border-t border-line pt-2">
                <TooltipRow
                  color="var(--color-chart-neutral)"
                  label="净额"
                  value={`${activePoint.income - activePoint.expense < 0 ? '-' : '+'}¥${formatAmount(
                    Math.abs(activePoint.income - activePoint.expense),
                  )}`}
                />
              </div>
            </ChartTooltip>
          )}

          <span className="sr-only" aria-live="polite">
            {activePoint
              ? `${fullLabel(activePoint.date)}，收入 ${formatAmount(activePoint.income)} 元，支出 ${formatAmount(activePoint.expense)} 元`
              : ''}
          </span>
        </div>

        {/* X 轴标签：按数据点位置绝对定位，抽稀后仍然对得上 */}
        <div className="relative mt-3 h-4">
          {visibleTicks.map((i) => (
            <span
              key={i}
              className={cn(
                'num absolute top-0 text-[11px] leading-none transition-colors',
                i === active ? 'font-semibold text-ink' : 'text-ink-mute',
                i === 0 ? '' : i === count - 1 ? '-translate-x-full' : '-translate-x-1/2',
              )}
              style={{ left: count > 1 ? `${(i / (count - 1)) * 100}%` : '50%' }}
            >
              {axisLabel(points[i].date)}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

export function CashFlowLegend({
  totalIncome,
  totalExpense,
}: {
  totalIncome: number
  totalExpense: number
}) {
  return (
    <ul className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px]">
      {SERIES.map((s) => (
        <li key={s.key} className="flex items-center gap-2">
          <span className="size-2.5 rounded-chip" style={{ backgroundColor: s.color }} />
          <span className="text-ink-soft">{s.label}</span>
          <span className="num font-medium text-ink">
            ¥{formatAmount(s.key === 'income' ? totalIncome : totalExpense)}
          </span>
        </li>
      ))}
    </ul>
  )
}
