// 支出预算：把「某类商户的钱」装进一个每日限额的罐子里。
// 纯计算与校验放在这里，服务端业务与前端 mock 共用同一套口径，避免两边对不上。
import { SPEND_PLATFORMS, findSpendPlatform } from './spend-platforms.mjs'

/** 一个客户最多建几个预算 */
export const BUDGET_MAX_COUNT = 6
export const BUDGET_NAME_MAX = 20
export const BUDGET_MIN_DAILY_LIMIT = 100
export const BUDGET_MAX_DAILY_LIMIT = 5_000_000
export const BUDGET_MIN_POINT_THRESHOLD = 0
export const BUDGET_MAX_POINT_THRESHOLD = 5_000_000
/** 日消费低于该阈值（含 0）记 1 分；单位分 */
export const BUDGET_DEFAULT_POINT_THRESHOLD = 1_000
/** 兑换一次额度奖励需要的积分 */
export const BUDGET_POINTS_PER_PASS = 30
/** 一次额度奖励把一个预算当天的限额抬高多少（分） */
export const BUDGET_PASS_EXTRA_CENTS = 2_000
export const BUDGET_PASS_MAX_FUTURE_DAYS = 30
/** 积分补算最多往前看多少天，避免新档案一次算一年 */
export const BUDGET_POINT_LOOKBACK_DAYS = 90

const DAY = 86_400_000
const SHANGHAI_OFFSET = 8 * 60 * 60 * 1000

/** 上海自然日：统计口径与 docs/api/spend.md 一致，不用服务器本地时区 */
export const shanghaiDay = (time = Date.now()) => new Date(time + SHANGHAI_OFFSET).toISOString().slice(0, 10)
export const shanghaiDayStart = time => Date.parse(`${shanghaiDay(time)}T00:00:00+08:00`)
export const addDays = (day, count) => new Date(Date.parse(`${day}T00:00:00Z`) + count * DAY).toISOString().slice(0, 10)
export const isDayKey = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)

export class BudgetError extends Error {
  constructor(message, code, status = 400) {
    super(message)
    this.name = 'BudgetError'
    this.code = code
    this.status = status
  }
}

const fail = (message, code, status) => { throw new BudgetError(message, code, status) }
const singleLine = text => [...text].every(ch => (ch.codePointAt(0) ?? 0) >= 32 && ch.codePointAt(0) !== 127)

/** 预算覆盖的商户号集合：预设平台按 merchantId 匹配，分类器结果不参与判定 */
export function budgetMerchantIds(budget) {
  const ids = new Set()
  for (const id of budget?.platforms ?? []) {
    const platform = findSpendPlatform(id)
    if (platform) ids.add(platform.merchantId)
  }
  return ids
}

export function budgetPlatformNames(budget) {
  return (budget?.platforms ?? []).map(id => findSpendPlatform(id)?.name ?? id)
}

/** 某预算在某个上海自然日已经花掉多少（只算成功的支出，退款/冲正按 spendOnCard 口径不计） */
export function budgetSpentCents(transactions, budget, day) {
  const merchantIds = budgetMerchantIds(budget)
  if (!merchantIds.size) return 0
  let total = 0
  for (const tx of transactions ?? []) {
    if (tx.direction !== 'out' || tx.status !== 'success') continue
    if (!Number.isSafeInteger(tx.amount) || tx.amount <= 0) continue
    if (!merchantIds.has(tx.detail?.merchantId)) continue
    if (shanghaiDay(Date.parse(tx.createdAt)) !== day) continue
    total += tx.amount
  }
  return total
}

/** 某个预算在某天的额度奖励合计 */
export function budgetPassExtra(passes, budgetId, day) {
  return (passes ?? [])
    .filter(pass => pass.budgetId === budgetId && pass.day === day)
    .reduce((sum, pass) => sum + (Number.isSafeInteger(pass.extra) ? pass.extra : 0), 0)
}

export function budgetEffectiveLimit(budget, passes, day) {
  return budget.dailyLimit + budgetPassExtra(passes, budget.id, day)
}

/** 积分：已结算的达标日 − 已兑换的奖励，最低 0 */
export function budgetPoints(pointDays, passes, budgetId) {
  const awarded = (pointDays ?? []).filter(row => row.budgetId === budgetId).length
  const used = (passes ?? []).filter(pass => pass.budgetId === budgetId).length * BUDGET_POINTS_PER_PASS
  return { awarded, used, available: Math.max(0, awarded - used) }
}

function validateName(name) {
  const value = typeof name === 'string' ? name.trim() : ''
  if (value.length < 1 || value.length > BUDGET_NAME_MAX || !singleLine(value))
    fail(`预算名称需为 1–${BUDGET_NAME_MAX} 字的单行文本`, 'INVALID_BUDGET_NAME')
  return value
}

function validatePlatforms(platforms) {
  if (!Array.isArray(platforms) || platforms.length === 0)
    fail('至少要选择一个消费平台', 'INVALID_BUDGET_PLATFORMS')
  const list = [...new Set(platforms)]
  if (list.length > SPEND_PLATFORMS.length) fail('消费平台数量超出范围', 'INVALID_BUDGET_PLATFORMS')
  for (const id of list) {
    if (typeof id !== 'string' || !findSpendPlatform(id))
      fail('消费平台不存在；预算只能选预设平台，不能选自定义收单', 'INVALID_BUDGET_PLATFORMS')
  }
  return list
}

function validateCents(value, min, max, label, code) {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    fail(`${label}需为 ${min / 100}–${max / 100} 元之间的整数分`, code)
  return value
}

export function validateBudgetInput(input) {
  return {
    name: validateName(input?.name),
    platforms: validatePlatforms(input?.platforms),
    dailyLimit: validateCents(input?.dailyLimit, BUDGET_MIN_DAILY_LIMIT, BUDGET_MAX_DAILY_LIMIT, '每日限额', 'INVALID_BUDGET_LIMIT'),
    pointThreshold: input?.pointThreshold === undefined || input?.pointThreshold === null
      ? BUDGET_DEFAULT_POINT_THRESHOLD
      : validateCents(input.pointThreshold, BUDGET_MIN_POINT_THRESHOLD, BUDGET_MAX_POINT_THRESHOLD, '积分门槛', 'INVALID_BUDGET_THRESHOLD'),
  }
}

export function validateBudgetPatch(patch, current) {
  const next = { ...current }
  if (patch?.name !== undefined) next.name = validateName(patch.name)
  if (patch?.platforms !== undefined) next.platforms = validatePlatforms(patch.platforms)
  if (patch?.dailyLimit !== undefined)
    next.dailyLimit = validateCents(patch.dailyLimit, BUDGET_MIN_DAILY_LIMIT, BUDGET_MAX_DAILY_LIMIT, '每日限额', 'INVALID_BUDGET_LIMIT')
  if (patch?.pointThreshold !== undefined)
    next.pointThreshold = validateCents(patch.pointThreshold, BUDGET_MIN_POINT_THRESHOLD, BUDGET_MAX_POINT_THRESHOLD, '积分门槛', 'INVALID_BUDGET_THRESHOLD')
  if (patch?.enabled !== undefined) {
    if (typeof patch.enabled !== 'boolean') fail('启用状态必须是布尔值', 'INVALID_BUDGET_ENABLED')
    next.enabled = patch.enabled
  }
  return next
}

/** 拦截：命中任一启用预算且超出当日额度就拒绝，报最先被撑爆的那个 */
export function checkBudgetLimit(budgets, passes, transactions, merchantId, amount, day) {
  for (const budget of budgets ?? []) {
    if (!budget.enabled) continue
    if (!budgetMerchantIds(budget).has(merchantId)) continue
    const limit = budgetEffectiveLimit(budget, passes, day)
    const used = budgetSpentCents(transactions, budget, day)
    if (used + amount > limit)
      fail(`「${budget.name}」今日额度 ¥${(limit / 100).toFixed(2)} 已用 ¥${(used / 100).toFixed(2)}，这笔 ¥${(amount / 100).toFixed(2)} 超出预算限额`,
        'BUDGET_LIMIT_EXCEEDED', 409)
  }
}

/** 把「昨天及更早、还没结算」的达标日补记成积分。只写不删，天然幂等 */
export function settleBudgetPoints(db, now = Date.now()) {
  const today = shanghaiDay(now)
  db.budgetPointDays ??= []
  const known = new Set(db.budgetPointDays.map(row => `${row.budgetId}|${row.day}`))
  const floor = addDays(today, -BUDGET_POINT_LOOKBACK_DAYS)
  let added = 0
  for (const budget of db.budgets ?? []) {
    const start = shanghaiDay(Date.parse(budget.createdAt ?? new Date(now).toISOString()))
    const from = start > floor ? start : floor
    for (let day = from; day < today; day = addDays(day, 1)) {
      const key = `${budget.id}|${day}`
      if (known.has(key)) continue
      const spent = budgetSpentCents(db.transactions, budget, day)
      if (spent >= (budget.pointThreshold ?? BUDGET_DEFAULT_POINT_THRESHOLD)) continue
      db.budgetPointDays.push({ budgetId: budget.id, day, spent, awardedAt: new Date(now).toISOString() })
      known.add(key)
      added++
    }
  }
  return added
}

/** 列表视图：带上今日用量、额度、积分与已兑换的奖励 */
export function budgetsOverview(db, now = Date.now()) {
  const today = shanghaiDay(now)
  settleBudgetPoints(db, now)
  return (db.budgets ?? []).map(budget => {
    const used = budgetSpentCents(db.transactions, budget, today)
    const limit = budgetEffectiveLimit(budget, db.budgetPasses, today)
    return {
      ...budget,
      merchantNames: budgetPlatformNames(budget),
      today: { day: today, used, limit, remaining: Math.max(0, limit - used) },
      points: budgetPoints(db.budgetPointDays, db.budgetPasses, budget.id),
      passes: (db.budgetPasses ?? []).filter(pass => pass.budgetId === budget.id).sort((a, b) => a.day.localeCompare(b.day)),
    }
  })
}

export function validatePassDay(day, now = Date.now()) {
  if (!isDayKey(day)) fail('额度奖励日期格式应为 YYYY-MM-DD', 'INVALID_PASS_DAY')
  const today = shanghaiDay(now)
  if (day < today) fail('额度奖励不能兑换到已经过去的日期', 'INVALID_PASS_DAY')
  if (day > addDays(today, BUDGET_PASS_MAX_FUTURE_DAYS))
    fail(`额度奖励最多兑换到 ${BUDGET_PASS_MAX_FUTURE_DAYS} 天内`, 'INVALID_PASS_DAY')
  return day
}
