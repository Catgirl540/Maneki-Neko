import type { Cents } from '@/api/types'
import { cn } from '@/lib/cn'
import { formatMoney } from '@/lib/format'

export interface DonutSegment {
  key: string
  label: string
  amount: Cents
  ratio: number
  color: string
}

/**
 * 环形图：平头端点、24px 描边，与参考稿一致。
 *
 * 交互由外部控制（activeKey / onActiveChange）：这样图例和圆环能共享同一个高亮，
 * 鼠标移到图例某一行，对应的弧也会亮起来。
 * 命中用一层透明的加粗描边，细弧也点得中。
 */
export function Donut({
  segments,
  size = 176,
  thickness = 22,
  centerLabel,
  centerValue,
  activeKey = null,
  onActiveChange,
}: {
  segments: DonutSegment[]
  size?: number
  thickness?: number
  centerLabel?: string
  centerValue?: string
  activeKey?: string | null
  onActiveChange?: (key: string | null) => void
}) {
  // 留出 3px 余量：高亮时描边会加粗，不至于画到画布外
  const radius = (size - thickness - 6) / 2
  const circumference = 2 * Math.PI * radius
  // 预先算好每段弧长与起点偏移，避免在渲染中累加可变变量
  const lengths = segments.map((seg) => Math.max(seg.ratio, 0) * circumference)
  const offsets = lengths.map((_, index) =>
    lengths.slice(0, index).reduce((sum, value) => sum + value, 0),
  )
  const active = segments.find((s) => s.key === activeKey) ?? null

  return (
    <div
      className="relative"
      style={{ width: size, height: size }}
      onPointerLeave={() => onActiveChange?.(null)}
    >
      <svg width={size} height={size} className="-rotate-90" role="img" aria-label="支出构成">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--color-line)"
          strokeWidth={thickness}
        />
        {segments.map((seg, index) => {
          const isActive = seg.key === activeKey
          return (
            <circle
              key={seg.key}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={seg.color}
              strokeWidth={isActive ? thickness + 6 : thickness}
              strokeDasharray={`${lengths[index]} ${circumference - lengths[index]}`}
              strokeDashoffset={-offsets[index]}
              // 未选中的压暗，让高亮那段真正跳出来
              opacity={activeKey == null || isActive ? 1 : 0.3}
              className="transition-[stroke-width,opacity] duration-200"
            />
          )
        })}

        {/* 透明命中层：必须画在可见弧之后，否则会被盖住 */}
        {onActiveChange &&
          segments.map((seg, index) => (
            <circle
              key={`hit-${seg.key}`}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke="transparent"
              strokeWidth={thickness + 18}
              strokeDasharray={`${lengths[index]} ${circumference - lengths[index]}`}
              strokeDashoffset={-offsets[index]}
              style={{ pointerEvents: 'stroke' }}
              onPointerEnter={() => onActiveChange(seg.key)}
            />
          ))}
      </svg>

      {(centerLabel || centerValue || active) && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-4 text-center">
          {active ? (
            <>
              <span className="text-[12px] leading-none text-ink-mute">{active.label}</span>
              <span className="num mt-1 text-[16px] leading-none font-semibold text-ink">
                {formatMoney(active.amount)}
              </span>
              <span className="mt-1 text-[11px] leading-none text-ink-mute">
                占比 {(active.ratio * 100).toFixed(1)}%
              </span>
            </>
          ) : (
            <>
              {centerLabel && <span className="text-[12px] text-ink-mute">{centerLabel}</span>}
              {centerValue && (
                <span className="num text-[19px] font-semibold text-ink">{centerValue}</span>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

export function DonutLegend({
  segments,
  activeKey = null,
  onActiveChange,
}: {
  segments: DonutSegment[]
  activeKey?: string | null
  onActiveChange?: (key: string | null) => void
}) {
  return (
    <ul className="flex flex-col gap-1" onPointerLeave={() => onActiveChange?.(null)}>
      {segments.map((seg) => (
        <li
          key={seg.key}
          onPointerEnter={() => onActiveChange?.(seg.key)}
          className={cn(
            'flex cursor-default items-center gap-2.5 rounded-tile px-2 py-1.5 text-[13px] transition-colors',
            activeKey === seg.key ? 'bg-sunk' : 'hover:bg-sunk',
          )}
        >
          <span
            className="size-2.5 shrink-0 rounded-chip"
            style={{ backgroundColor: seg.color }}
          />
          <span className="text-ink-soft">{seg.label}</span>
          <span className="num ml-auto font-medium text-ink">{formatMoney(seg.amount)}</span>
        </li>
      ))}
    </ul>
  )
}
