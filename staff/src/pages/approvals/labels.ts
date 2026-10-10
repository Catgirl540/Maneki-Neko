import type { ApprovalBizType, ApprovalStatus, ExecutionStatus } from '@/api'

/** 处置展示字典。单独文件，组件文件只导出组件（Fast Refresh 要求）。 */

export const BIZ_TYPE_LABEL: Record<ApprovalBizType, string> = {
  transfer: '大额转账',
  card_lock: '锁卡',
  limit_adjust: '调额',
  wealth_subscribe: '理财申购',
  other: '其他',
}

/**
 * 状态字典。
 * transfer 类是「在途窗口」语义（§9.1）：pending=在途、settled=已到账、
 * intercepted=已拦截、recalled=用户已撤销。其他类仍是审批语义。
 */
export const APPROVAL_STATUS_LABEL: Record<ApprovalStatus, string> = {
  pending: '待裁决',
  approved: '已通过',
  rejected: '已驳回',
  settled: '已到账',
  intercepted: '已拦截',
  recalled: '用户已撤销',
}

/** 资金执行与处置结果分开显示（§9.4）：已通过但执行失败要能一眼看出来 */
export const EXECUTION_LABEL: Record<ExecutionStatus, string> = {
  pending: '待执行',
  succeeded: '已执行',
  failed: '执行失败',
}

export const APPROVAL_STATUS_CLASS: Record<ApprovalStatus, string> = {
  pending: 'bg-[var(--color-gold-wash)] text-[var(--color-gold-deep)]',
  approved: 'bg-[var(--color-blue-wash)] text-[var(--color-blue-deep)]',
  rejected: 'bg-[var(--color-coral-wash)] text-[var(--color-coral)]',
  settled: 'bg-[var(--color-blue-wash)] text-[var(--color-blue-deep)]',
  intercepted: 'bg-[var(--color-coral-wash)] text-[var(--color-coral)]',
  recalled: 'bg-[var(--color-sunk)] text-[var(--color-ink-mute)]',
}

export const EXECUTION_CLASS: Record<ExecutionStatus, string> = {
  pending: 'bg-[var(--color-sunk)] text-[var(--color-ink-mute)]',
  succeeded: 'bg-[var(--color-blue-wash)] text-[var(--color-blue-deep)]',
  failed: 'bg-[var(--color-coral-wash)] text-[var(--color-coral)]',
}

/** 转账类 payload 里的金额是整数分（¥5,000 = 500000），展示时换算 */
export function formatCents(cents: unknown) {
  if (typeof cents !== 'number' || !Number.isFinite(cents)) return null
  return `¥${(cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}`
}

/** 从冻结的 payload 里取在途窗口截止时刻（ISO），拿不到返回 null */
export function extractHoldUntil(payload: Record<string, unknown>): string | null {
  const v = payload.holdUntil
  return typeof v === 'string' && v ? v : null
}

/**
 * 倒计时文案：「还剩 3 分 12 秒」/「已到点，等待自动到账」/ null（无窗口）。
 * 返回 null 时调用方不渲染倒计时块。
 */
export function countdownText(holdUntil: string | null, nowMs: number): string | null {
  if (!holdUntil) return null
  const left = new Date(holdUntil).getTime() - nowMs
  if (!Number.isFinite(left)) return null
  if (left <= 0) return '窗口已到点，正在自动到账…'
  const totalSec = Math.ceil(left / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `还剩 ${m > 0 ? `${m} 分 ` : ''}${s} 秒`
}
