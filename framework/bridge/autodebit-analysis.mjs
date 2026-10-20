import { bankError } from './bank-error.mjs'

const DAY = 86_400_000
const zoneOffset = 8 * 60 * 60 * 1000
const dayNumber = timestamp => Math.floor((timestamp + zoneOffset) / DAY)
const dateLabel = day => new Date(day * DAY).toISOString().slice(0, 10)

// A date-only bank value denotes a Shanghai calendar date, not a UTC instant.
function bankDay(value) {
  if (typeof value !== 'string') return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = Date.parse(value + 'T00:00:00+08:00')
    return Number.isFinite(parsed) && dateLabel(dayNumber(parsed)) === value ? dayNumber(parsed) : null
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null
  const parsed = Date.parse(value)
  // Date.parse normalizes impossible dates such as February 30. Reject those too.
  const date = value.slice(0, 10)
  if (!Number.isFinite(parsed) || new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date) return null
  return dayNumber(parsed)
}

export function validateReminderDays(days = 30) {
  if (![7, 30, 90].includes(days)) throw bankError('续费清单仅支持 7、30 或 90 个自然日')
  return days
}

/** Read-only snapshot of actual bank contracts, never a merchant subscription inference or scheduler. */
export function analyzeAutoDebits(contracts, { days = 30 } = {}, now = Date.now()) {
  validateReminderDays(days)
  if (!Number.isFinite(now) || !Number.isFinite(new Date(now).getTime())) throw bankError('查询时间无效')
  if (!Array.isArray(contracts)) throw bankError('银行扣款合约数据不完整', 502)
  const today = dayNumber(now), ids = new Set(), totals = new Map(), groups = new Map()
  const items = contracts.map(source => {
    if (!source || typeof source.id !== 'string' || !source.id.trim() || ids.has(source.id) ||
        typeof source.merchant !== 'string' || !source.merchant.trim() || typeof source.enabled !== 'boolean' ||
        !Number.isSafeInteger(source.amount) || source.amount < 0) throw bankError('银行扣款合约数据不完整或编号不唯一', 502)
    ids.add(source.id)
    // The current AutoDebit contract is CNY-only (also used by the bank page).
    // Respect an explicit currency if a future backend supplies it; never relabel it as CNY.
    const currency = source.currency === undefined ? 'CNY' : source.currency
    if (!['CNY', 'HKD', 'USD'].includes(currency)) throw bankError('银行扣款合约币种未知', 502)
    const dueDay = bankDay(source.nextRunAt), daysUntil = dueDay === null ? null : dueDay - today
    const status = !source.enabled ? 'disabled' : dueDay === null ? 'unknown-date' : daysUntil < 0 ? 'past-date' : daysUntil < days ? 'upcoming' : 'later'
    if (status === 'upcoming') {
      const total = (totals.get(currency) ?? 0) + source.amount
      if (!Number.isSafeInteger(total)) throw bankError('扣款合计金额超出支持范围', 502)
      totals.set(currency, total)
    }
    if (source.enabled) {
      const key = JSON.stringify([currency, source.merchant.trim().toLocaleLowerCase('en-US')])
      groups.set(key, [...(groups.get(key) ?? []), source.id])
    }
    return { id: source.id, merchant: source.merchant, amountCents: source.amount, currency,
      cycle: typeof source.cycle === 'string' ? source.cycle : null, enabled: source.enabled,
      nextRunAt: typeof source.nextRunAt === 'string' ? source.nextRunAt : null,
      nextRunDate: dueDay === null ? null : dateLabel(dueDay), daysUntil, status }
  }).sort((a, b) => (a.daysUntil ?? Infinity) - (b.daysUntil ?? Infinity) || a.id.localeCompare(b.id))
  return {
    scope: 'owned-bank-autodebit-contracts', asOf: new Date(now).toISOString(), timeZone: 'Asia/Shanghai',
    window: { days, startDateInclusive: dateLabel(today), endDateExclusive: dateLabel(today + days) },
    items, counts: Object.fromEntries(['upcoming', 'past-date', 'unknown-date', 'disabled', 'later'].map(status => [status, items.filter(item => item.status === status).length])),
    upcomingAmountCentsByCurrency: Object.fromEntries([...totals].sort(([a], [b]) => a.localeCompare(b))),
    possibleOverlapContractIds: [...groups.values()].filter(group => group.length > 1),
    reminderCreated: false,
    notice: '仅查询本人银行已有合约；金额合计每份启用合约在窗口内记录的下一次扣款，不展开周期、不等于月度支出或商户全部订阅。过去日期不证明欠费或扣款失败；同名合约仅提示核对。未创建后台提醒，未停用扣款、取消商户订阅或退款。当前未提供币种字段的合约按银行接口约定为 CNY。',
  }
}
