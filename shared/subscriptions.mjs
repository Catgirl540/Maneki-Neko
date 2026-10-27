/** Evidence-based candidates from one bank page; no merchant account access or cancellation. */
const DAY = 86400000
const moneyCurrencies = new Set(['CNY', 'USD', 'HKD'])
function invalid(message) { const error = new Error(message); error.code = 'INVALID_SUBSCRIPTION_DATA'; error.status = 400; throw error }
function time(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return NaN
  const parsed = Date.parse(value), day = value.slice(0, 10)
  return Number.isFinite(parsed) && new Date(day + 'T00:00:00Z').toISOString().slice(0, 10) === day ? parsed : NaN
}
const nameKey = value => value.trim().toLocaleLowerCase('en-US')

export function analyzeSubscriptionCandidates(account, page, now = Date.now()) {
  if (!account || typeof account.id !== 'string' || !account.id || !moneyCurrencies.has(account.currency) || !Number.isFinite(now)) invalid('账户或查询时间无效')
  if (!page || page.page !== 1 || !Number.isSafeInteger(page.size) || page.size < 1 || page.size > 200 || !Array.isArray(page.items) || page.items.length > page.size || !Number.isSafeInteger(page.total) || page.total < page.items.length) invalid('订阅识别须使用本人账户第一页至多 200 条流水')
  const ids = new Set(), groups = new Map(), ignored = { invalidDate: 0, futureDate: 0, notSettledExpense: 0 }
  for (const row of page.items) {
    if (!row || typeof row.id !== 'string' || !row.id || ids.has(row.id) || row.accountId !== account.id || !['in', 'out'].includes(row.direction) || !['success', 'pending', 'failed'].includes(row.status) || !Number.isSafeInteger(row.amount) || row.amount < 0 || row.signedAmount !== (row.direction === 'in' ? row.amount : -row.amount) || typeof row.counterparty !== 'string' || (row.currency !== undefined && row.currency !== account.currency)) invalid('流水编号、归属、币种或金额不一致')
    ids.add(row.id)
    const timestamp = time(row.createdAt)
    if (!Number.isFinite(timestamp)) { ignored.invalidDate++; continue }
    if (timestamp > now) { ignored.futureDate++; continue }
    if (row.direction !== 'out' || row.status !== 'success' || row.amount === 0 || !nameKey(row.counterparty) || ['salary', 'transfer'].includes(row.category)) { ignored.notSettledExpense++; continue }
    const key = JSON.stringify([nameKey(row.counterparty), row.amount])
    const group = groups.get(key) ?? []
    group.push({ ...row, timestamp }); groups.set(key, group)
  }
  const candidates = []
  for (const rows of groups.values()) {
    rows.sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id))
    const dates = [...new Map(rows.map(row => [new Date(row.timestamp + 8 * 3600000).toISOString().slice(0, 10), row])).values()]
    // Require at least three dates and two consistent intervals, never a single keyword hit.
    if (dates.length < 3) continue
    let match
    for (const cycle of [{ kind: 'weekly', min: 6, max: 8, days: 7 }, { kind: 'monthly', min: 26, max: 33, days: 30 }, { kind: 'annual', min: 363, max: 367, days: 365 }]) {
      const tail = dates.slice(-3), gaps = [1, 2].map(index => (tail[index].timestamp - tail[index - 1].timestamp) / DAY)
      if (gaps.every(gap => gap >= cycle.min && gap <= cycle.max)) { match = { cycle, tail }; break }
    }
    if (!match) continue
    const last = match.tail.at(-1)
    candidates.push({ merchant: last.counterparty, currency: account.currency, amountCents: last.amount, cycle: match.cycle.kind, confidence: 'candidate', evidence: match.tail.map(row => ({ transactionId: row.id, createdAt: row.createdAt, amountCents: row.amount })), lastObservedAt: last.createdAt, approximateNextAt: new Date(last.timestamp + match.cycle.days * DAY).toISOString(), notice: '同商户同金额的重复间隔候选，须向商户核对；预测日期不是已签约扣款日。' })
  }
  return { scope: 'owned-account-transaction-sample', accountId: account.id, currency: account.currency, asOf: new Date(now).toISOString(), coverage: { returnedCount: page.items.length, bankTotal: page.total, truncated: page.items.length < page.total, ignored }, candidates: candidates.slice(0, 20), findingsTruncated: candidates.length > 20, reminderCreated: false, notice: '仅识别本人账户第一页样本中的周期支出候选，不能识别全部订阅，也不能证明仍在续费。未创建提醒、停用代扣、取消商户订阅或退款。' }
}

/** Return an editable reminder suggestion; creation remains separately confirmed. */
export function renewalReminderDraft(contract, now = Date.now(), leadDays = 2) {
  if (!contract || !contract.enabled || typeof contract.id !== 'string' || typeof contract.merchant !== 'string' || !contract.merchant.trim() || !Number.isSafeInteger(contract.amount) || contract.amount < 0 || ![1, 2, 3, 7].includes(leadDays) || !Number.isFinite(now)) invalid('请先选择一份已启用且金额完整的本人代扣合约')
  const dateOnly = typeof contract.nextRunAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(contract.nextRunAt)
  const parsed = dateOnly ? Date.parse(contract.nextRunAt + 'T00:00:00+08:00') : time(contract.nextRunAt)
  const date = Number.isFinite(parsed) ? new Date(parsed + 8 * 3600000).toISOString().slice(0, 10) : ''
  if (!date || (dateOnly && date !== contract.nextRunAt)) invalid('银行下一次扣款日期不完整，请先核对合约')
  const proposed = Date.parse(date + 'T09:00:00+08:00') - leadDays * DAY
  if (proposed < now + 15000) invalid('提前提醒时间已过，请到助手的提醒页选择新的提醒时间')
  if (proposed > now + 365 * DAY) invalid('该续费日期超过一次性提醒的 365 天范围')
  const currency = contract.currency ?? 'CNY'
  if (!moneyCurrencies.has(currency)) invalid('代扣币种未知，请先核对合约')
  return { title: `核对${contract.merchant.trim()}续费：预计${date}扣款 ${currency} ${(contract.amount / 100).toFixed(2)}，可到商户管理订阅`.slice(0, 160), time: new Date(proposed + 8 * 3600000).toISOString().slice(0, 16), contractId: contract.id, nextRunDate: date, leadDays, reminderCreated: false }
}
