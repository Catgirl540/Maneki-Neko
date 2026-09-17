import type { RiskLevel, RiskTolerance } from '@/api/types'
import { RISK_PLAIN_LABEL, TOLERANCE_LABEL } from '@/lib/wealth'
import { cn } from '@/lib/cn'

/**
 * 风险等级徽章。
 *
 * 新规要求**通俗说法前置**（「中低风险」），R 符号退到次要位置 —— 所以
 * 视觉上「中低风险」是主角，`R2` 是小字。同时理财一律非保本，一并标出。
 *
 * 颜色只取三级（低/中/高），不按 R1–R5 各给一个色 ——
 * 五个风险色会让人误以为精确到档，而且和全站三色克制原则冲突。
 */
const TONE: Record<RiskLevel, string> = {
  R1: 'bg-blue-wash text-blue',
  R2: 'bg-blue-wash text-blue',
  R3: 'bg-gold-wash text-gold-deep',
  R4: 'bg-coral-wash text-coral',
  R5: 'bg-coral-wash text-coral',
}

export function RiskBadge({
  risk,
  showLevel = true,
  className,
}: {
  risk: RiskLevel
  /** 是否显示 R 符号 */
  showLevel?: boolean
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-chip px-2.5 text-[12px] font-medium',
        TONE[risk],
        className,
      )}
    >
      {RISK_PLAIN_LABEL[risk]}
      <span className="opacity-70">· 非保本</span>
      {showLevel && <span className="num opacity-70">{risk}</span>}
    </span>
  )
}

/** 投资者承受能力徽章 */
export function ToleranceBadge({
  level,
  className,
}: {
  level: RiskTolerance
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-chip border border-line bg-surface px-2.5 text-[12px] font-medium text-ink',
        className,
      )}
    >
      <span className="num opacity-70">{level}</span>
      {TOLERANCE_LABEL[level]}
    </span>
  )
}
