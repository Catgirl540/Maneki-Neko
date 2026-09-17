import { useState, type PointerEvent } from 'react'
import type { NavPoint } from '@/api/types'
import { ChartTooltip } from './ChartTooltip'

const W = 640
const H = 160
const PAD = 12

/**
 * 净值走势。单序列面积图，鼠标进入出竖线 + 标记点 + 当日净值。
 *
 * 与现金流图同样的取舍：画布用固定 viewBox + preserveAspectRatio="none"，
 * 非等比缩放下 SVG 的 <circle> 会变成椭圆，所以标记点用 HTML 叠层画。
 */
export function Sparkline({ points, className }: { points: NavPoint[]; className?: string }) {
  const [active, setActive] = useState<number | null>(null)

  if (points.length < 2) {
    return (
      <div className="grid h-[160px] place-items-center text-[13px] text-ink-mute">暂无净值数据</div>
    )
  }

  const count = points.length
  const values = points.map((p) => p.nav)
  const min = Math.min(...values)
  const max = Math.max(...values)
  // 上下各留 8% 余量，曲线不至于贴着边
  const span = (max - min || 0.0001) * 1.16
  const low = min - (span - (max - min)) / 2

  const xOf = (i: number) => (i / (count - 1)) * W
  const yOf = (v: number) => PAD + (1 - (v - low) / span) * (H - PAD * 2)
  const line = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xOf(i).toFixed(2)} ${yOf(p.nav).toFixed(2)}`)
    .join(' ')
  const area = `${line} L ${W} ${H} L 0 ${H} Z`

  const activeXPct = active == null ? 0 : (active / (count - 1)) * 100
  const activePoint = active == null ? null : points[active]
  // 涨跌决定曲线颜色：跌破 1 就用珊瑚色，一眼看出亏没亏
  const up = values[count - 1] >= values[0]
  const color = up ? 'var(--color-blue)' : 'var(--color-coral)'

  function pick(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    if (rect.width === 0) return
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
    setActive(Math.round(ratio * (count - 1)))
  }

  return (
    <div className={className}>
      <div
        className="relative"
        style={{ height: H }}
        onPointerMove={pick}
        onPointerDown={pick}
        onPointerLeave={() => setActive(null)}
      >
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="nav-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.24} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <path d={area} fill="url(#nav-fill)" />
          <path
            d={line}
            fill="none"
            stroke={color}
            strokeWidth={2.2}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        {activePoint && (
          <div className="pointer-events-none absolute inset-0" aria-hidden="true">
            <span
              className="absolute top-0 bottom-0 w-px bg-line-strong"
              style={{ left: `${activeXPct}%` }}
            />
            <span
              className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-chip border-2 bg-surface"
              style={{ left: `${activeXPct}%`, top: yOf(activePoint.nav), borderColor: color }}
            />
          </div>
        )}

        {activePoint && (
          <ChartTooltip xPct={activeXPct} width={148}>
            <p className="text-[12px] font-medium text-ink">{activePoint.date}</p>
            <p className="num mt-1.5 text-[13px] text-ink-soft">
              单位净值 <span className="font-medium text-ink">{activePoint.nav.toFixed(4)}</span>
            </p>
          </ChartTooltip>
        )}
      </div>

      <div className="num mt-2 flex justify-between text-[11px] text-ink-mute">
        <span>{points[0].date}</span>
        <span>
          区间 {min.toFixed(4)} ~ {max.toFixed(4)}
        </span>
        <span>{points[count - 1].date}</span>
      </div>
    </div>
  )
}
