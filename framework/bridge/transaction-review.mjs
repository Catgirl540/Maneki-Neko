import { bankError } from './bank-error.mjs'

const DAY = 86_400_000
const categories = new Set(['dining', 'shopping', 'housing', 'transport', 'subscription'])
const nameKey = name => name.trim().toLocaleLowerCase('en-US')
const evidence = row => ({ transactionId: row.id, counterparty: row.counterparty, amountCents: row.amount, createdAt: row.createdAt, category: row.category })
const median = values => {
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : sorted[middle - 1] + (sorted[middle] - sorted[middle - 1]) / 2
}
function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return NaN
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return NaN
  const date = value.slice(0, 10)
  return new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) === date ? time : NaN
}

export function validateReviewLimit(limit = 100) {
  if (!Number.isSafeInteger(limit) || limit < 20 || limit > 200) throw bankError('流水核查样本条数须为 20–200 的整数')
  return limit
}

/** Heuristic review of one actual, bounded bank page. No writes, scoring or financial decisions. */
export function reviewTransactions(account, page, { limit = 100 } = {}, now = Date.now()) {
  validateReviewLimit(limit)
  if (typeof account?.id !== 'string' || !account.id.trim() || !['CNY', 'USD', 'HKD'].includes(account.currency)) throw bankError('账户币种数据不完整', 502)
  if (!Number.isFinite(now) || !Number.isFinite(new Date(now).getTime())) throw bankError('查询时间无效')
  if (!page || !Array.isArray(page.items) || page.items.length > limit || page.page !== 1 || page.size !== limit || !Number.isSafeInteger(page.total) || page.total < page.items.length) throw bankError('流水分页数据不完整', 502)
  const ids = new Set(), eligible = [], dated = [], ignored = { notSettledExpense: 0, excludedCategory: 0, missingMerchant: 0, invalidDate: 0, futureDate: 0 }
  const invalidDateTransactionIds = []
  for (const row of page.items) {
    if (!row || typeof row.id !== 'string' || !row.id.trim() || ids.has(row.id) || row.accountId !== account.id ||
        !['in', 'out'].includes(row.direction) || !['success', 'pending', 'failed'].includes(row.status) ||
        !Number.isSafeInteger(row.amount) || row.amount < 0 || row.signedAmount !== (row.direction === 'in' ? row.amount : -row.amount) ||
        typeof row.counterparty !== 'string' || (row.currency !== undefined && row.currency !== account.currency)) throw bankError('流水金额、归属、币种或编号数据不一致', 502)
    ids.add(row.id)
    const time = timestamp(row.createdAt)
    if (!Number.isFinite(time)) { ignored.invalidDate++; invalidDateTransactionIds.push(row.id); continue }
    if (time > now) { ignored.futureDate++; continue }
    dated.push(time)
    if (row.direction !== 'out' || row.status !== 'success' || row.amount === 0) { ignored.notSettledExpense++; continue }
    if (!categories.has(row.category)) { ignored.excludedCategory++; continue }
    if (!nameKey(row.counterparty)) { ignored.missingMerchant++; continue }
    eligible.push({ ...row, time })
  }
  eligible.sort((a, b) => a.time - b.time || a.id.localeCompare(b.id))
  const duplicates = [], spikes = [], groups = new Map(), history = new Map()
  for (const row of eligible) {
    const merchant = nameKey(row.counterparty), key = JSON.stringify([merchant, row.amount])
    groups.set(key, [...(groups.get(key) ?? []), row])
    const earlier = (history.get(merchant) ?? []).filter(previous => previous.time < row.time && previous.time >= row.time - 90 * DAY)
    const days = new Set(earlier.map(previous => new Date(previous.time + 8 * 3600000).toISOString().slice(0, 10)))
    if (earlier.length >= 3 && days.size >= 3) {
      const baseline = median(earlier.map(previous => previous.amount))
      if (row.amount >= 10000 && row.amount / baseline >= 3) spikes.push({ transaction: evidence(row), baselineMedianCents: baseline,
        priorSampleCount: earlier.length, priorDistinctDays: days.size, ratio: Math.round(row.amount / baseline * 100) / 100,
        priorEvidence: earlier.slice(-5).map(evidence), priorEvidenceTruncated: earlier.length > 5 })
    }
    history.set(merchant, [...(history.get(merchant) ?? []), row])
  }
  for (const rows of groups.values()) {
    let cluster = []
    const flush = () => {
      if (cluster.length >= 2) duplicates.push({ count: cluster.length, spanSeconds: (cluster.at(-1).time - cluster[0].time) / 1000,
        transactions: cluster.slice(0, 5).map(evidence), evidenceTruncated: cluster.length > 5 })
    }
    for (const row of rows) {
      if (cluster.length && row.time - cluster[0].time > 300000) { flush(); cluster = [] }
      cluster.push(row)
    }
    flush()
  }
  return { scope: 'owned-account-transaction-sample', accountId: account.id, currency: account.currency, asOf: new Date(now).toISOString(), timeZone: 'Asia/Shanghai',
    coverage: { requestedLimit: limit, returnedCount: page.items.length, bankTotal: page.total, truncated: page.items.length < page.total,
      order: 'bank-return-order', analyzedExpenseCount: eligible.length, ignored, invalidDateTransactionIds,
      observedRange: dated.length ? { fromInclusive: new Date(Math.min(...dated)).toISOString(), toInclusive: new Date(Math.max(...dated)).toISOString() } : null },
    rules: { duplicateWindowSeconds: 300, spikeMinimumCents: 10000, spikeMinimumRatio: 3, baselineLookbackDays: 90, baselineMinimumDistinctDays: 3 },
    candidateCounts: { duplicateGroups: duplicates.length, amountSpikes: spikes.length },
    duplicateCandidates: duplicates.slice(0, 20), amountSpikeCandidates: spikes.slice(-20), findingsTruncated: duplicates.length > 20 || spikes.length > 20,
    notice: '仅核查银行返回的第一页样本，按账户币种分别处理；不声明这是最近记录或完整月度/年度报告。只纳入已成功的餐饮、购物、住房、交通及订阅支出，排除收入、在途/失败、零金额、转账、工资和其他分类。相同商户按去首尾空白/忽略大小写匹配，候选附真实交易依据，不能认定重复收费或欺诈；未发现候选不代表安全。没有锁卡、退款、停用合约或报案。需要进一步核对时按交易编号查看回单或联系人工。',
  }
}
