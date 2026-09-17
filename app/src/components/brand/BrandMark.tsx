import type { CardNetwork } from '@/api/types'
import { cn } from '@/lib/cn'

/**
 * 卡组织标记。
 *
 * **不带底色**：标本身就是透明的，之前套一层白色圆角壳看着像贴纸，很假。
 *
 * 取值逻辑照真实卡片来：
 *   · 银联 —— 无论卡底都用**彩色**标。红/蓝/绿三色是它的商标，
 *     做成单色就认不出来；白字部分在深色卡上也看得见。
 *   · Visa —— 深色卡上用**白色**标（真卡就是白墨或烫印），
 *     浅色卡上用官方藏青渐变。深藏青印在墨蓝卡面上等于看不见 ——
 *     这正是当初垫白底的原因，但垫白底是错的解法。
 */
const MARKS: Record<
  CardNetwork,
  { onLight: string; onDark?: string; label: string; ratio: number; height: number }
> = {
  visa: {
    onLight: '/brands/visa.svg',
    onDark: '/brands/visa-white.svg',
    label: 'VISA',
    ratio: 256 / 83,
    height: 15,
  },
  unionpay: {
    onLight: '/brands/unionpay.svg',
    label: '银联',
    ratio: 256 / 160,
    height: 22,
  },
}

export function BrandMark({
  network,
  tone = 'onLight',
  size = 'md',
  className,
}: {
  network: CardNetwork
  /** 卡面底色：深色卡要用白色 Visa 标 */
  tone?: 'onDark' | 'onLight'
  /** sm 用于产品选择等紧凑位置，md 用于卡面 */
  size?: 'sm' | 'md'
  className?: string
}) {
  const mark = MARKS[network]
  if (!mark) return null
  const src = tone === 'onDark' ? (mark.onDark ?? mark.onLight) : mark.onLight
  const height = size === 'sm' ? mark.height - 3 : mark.height

  return (
    <img
      src={src}
      alt={mark.label}
      title={mark.label}
      style={{ height, width: height * mark.ratio }}
      className={cn('shrink-0 object-contain', className)}
    />
  )
}
