import { spendingStatistics } from './account-model.mjs'

export const MONTHLY_BUDGET_CATEGORIES = { dining: '餐饮', shopping: '购物', housing: '住房', transport: '交通', subscription: '订阅', other: '其他' }
const fail = (message, code = 'INVALID_MONTHLY_BUDGET', status = 400) => Object.assign(new Error(message), { code, status })
const monthKey = now => new Date(now + 8 * 3600000).toISOString().slice(0, 7)
const validateMonth = month => { if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw fail('请提供 YYYY-MM 格式的预算月份') }
function goalView(goal, statistics) {
  const spent = statistics.byCurrency[goal.currency].categories.find(row => row.key === goal.category)?.amount ?? 0
  return { ...goal, categoryLabel: MONTHLY_BUDGET_CATEGORIES[goal.category], spent, remaining: Math.max(0, goal.limit - spent), overBy: Math.max(0, spent - goal.limit), status: spent > goal.limit ? 'over' : 'within' }
}
export function monthlyBudgetsOverview(db, month, now = Date.now()) {
  month ??= monthKey(now)
  validateMonth(month)
  const statistics = spendingStatistics(db, month, MONTHLY_BUDGET_CATEGORIES, now)
  return {
    month, timeZone: 'Asia/Shanghai', asOf: statistics.asOf, mode: 'monthly-category-target',
    notice: '月度分类目标按北京时间、原记账币种统计成功支出；不冻结或转移资金、不阻止支付。分类尚未完成或后续更新时，实际支出会变化。',
    goals: (db.monthlyBudgets ?? []).filter(row => row.month === month).map(row => goalView(row, statistics)),
  }
}
/** Versioned set by month/currency/category; never changes the spending ledger or daily caps. */
export function saveMonthlyBudget(db, input, now = Date.now()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('请提供月度分类预算')
  validateMonth(input.month)
  if (!Object.hasOwn(MONTHLY_BUDGET_CATEGORIES, input.category) || !['CNY', 'USD', 'HKD'].includes(input.currency)) throw fail('预算类别或币种无效')
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100000000) throw fail('月度目标须为 1 至 100000000 整数分')
  if (!Number.isSafeInteger(input.version) || input.version < 0) throw fail('请提供预算版本，新建为 0')
  const rows = db.monthlyBudgets ?? []
  const old = rows.find(row => row.month === input.month && row.category === input.category && row.currency === input.currency)
  if ((old?.version ?? 0) !== input.version) throw fail('月度预算已变化，请重新查询并确认', 'VERSION_CONFLICT', 409)
  if (!old && rows.length >= 120) throw fail('最多保存 120 项月度预算', 'MONTHLY_BUDGET_LIMIT', 409)
  const timestamp = new Date(now).toISOString()
  const goal = { id: old?.id ?? `monthly:${input.month}:${input.currency}:${input.category}`, month: input.month, currency: input.currency, category: input.category, limit: input.limit, version: input.version + 1, createdAt: old?.createdAt ?? timestamp, updatedAt: timestamp }
  const view = goalView(goal, spendingStatistics(db, input.month, MONTHLY_BUDGET_CATEGORIES, now))
  db.monthlyBudgets = [...rows.filter(row => row !== old), goal]
  return view
}
