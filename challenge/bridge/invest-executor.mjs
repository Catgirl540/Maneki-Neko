/**
 * 定投执行引擎纯逻辑：到点判定、状态推进、周期滚动。
 *
 * 不动资金、不调 HTTP、不触碰共享模块。资金变动由调用方
 * （scheduled-api.mjs 的 runDue）走 createBankBusinessApi 的业务路完成。
 */

/** 格式化本地日期为 YYYY-MM-DD（避免 toISOString 的 UTC 时区偏移）。 */
function localDate(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * 计算定投计划的下一个执行日。
 *
 * @param {string} cycle  周期描述，如「每月 8 日」「每周」「每两周」
 * @param {number} fromMs 起算时间戳
 * @returns {string} ISO 日期字符串（YYYY-MM-DD）
 */
export function nextRunDate(cycle, fromMs = Date.now()) {
  const d = new Date(fromMs)
  if (cycle.startsWith('每月')) {
    // 「每月 N 日」→ 下个月 N 日
    const day = Number(cycle.match(/(\d+)/)?.[1] ?? 8)
    const next = new Date(d.getFullYear(), d.getMonth() + 1, Math.min(day, 28))
    return localDate(next)
  }
  if (cycle === '每周') {
    const next = new Date(d.getTime() + 7 * 86_400_000)
    return localDate(next)
  }
  if (cycle === '每两周') {
    const next = new Date(d.getTime() + 14 * 86_400_000)
    return localDate(next)
  }
  // 未知周期 → 默认下月同日
  const next = new Date(d.getFullYear(), d.getMonth() + 1, d.getDate())
  return localDate(next)
}

/**
 * 判断定投计划是否到点。
 *
 * @param {object} plan  InvestPlan
 * @param {number} [now] 毫秒时间戳
 * @returns {boolean}
 */
export function isInvestDue(plan, now = Date.now()) {
  if (plan.status !== 'active') return false
  const t = Date.parse(`${plan.nextRunAt}T09:00:00`)
  return Number.isFinite(t) && t <= now
}

/**
 * 推进定投计划状态（纯函数，返回新对象）。
 *
 * @param {object} plan  当前 InvestPlan
 * @param {number} [now] 毫秒时间戳
 * @returns {object} 更新后的 plan（executedRuns + 1, totalInvested + amount, nextRunAt 前进）
 */
export function advanceInvestPlan(plan, now = Date.now()) {
  return {
    ...plan,
    executedRuns: plan.executedRuns + 1,
    totalInvested: plan.totalInvested + plan.amount,
    nextRunAt: nextRunDate(plan.cycle, now),
  }
}

/**
 * 暂停定投计划（纯函数）。
 * @param {object} plan
 */
export function pauseInvestPlan(plan) {
  if (plan.status !== 'active') {
    throw Object.assign(new Error(`状态 ${plan.status} 不可暂停`), { status: 409, code: 'CONFLICT' })
  }
  return { ...plan, status: 'paused' }
}

/**
 * 恢复定投计划（纯函数）。
 * @param {object} plan
 */
export function resumeInvestPlan(plan) {
  if (plan.status !== 'paused') {
    throw Object.assign(new Error(`状态 ${plan.status} 不可恢复`), { status: 409, code: 'CONFLICT' })
  }
  return { ...plan, status: 'active' }
}

/**
 * 终止定投计划（纯函数）——终态，不可逆。
 * @param {object} plan
 */
export function terminateInvestPlan(plan) {
  if (plan.status === 'terminated') {
    throw Object.assign(new Error('计划已终止'), { status: 409, code: 'CONFLICT' })
  }
  return { ...plan, status: 'terminated', terminatedAt: new Date().toISOString() }
}
