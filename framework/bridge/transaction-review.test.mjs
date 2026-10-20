import test from 'node:test'
import assert from 'node:assert/strict'
import { reviewTransactions, validateReviewLimit } from './transaction-review.mjs'
const account = { id: 'a', currency: 'CNY' }, now = Date.parse('2026-10-20T12:00:00Z')
const row = (id, date, amount = 1000, extra = {}) => ({ id, accountId: 'a', amount, signedAmount: -amount, direction: 'out', status: 'success', category: 'shopping', counterparty: '测试商户', createdAt: date, ...extra })
const review = (items, total = items.length, acc = account) => reviewTransactions(acc, { items, page: 1, size: 100, total }, {}, now)

test('same-merchant/amount duplicates include five-minute boundary and evidence, not a chained wider window', () => {
  const rows = [row('a', '2026-10-20T01:00:00Z'), row('b', '2026-10-20T01:05:00Z'), row('c', '2026-10-20T01:09:00Z'), row('d', '2026-10-20T01:09:01Z', 2000)]
  const original = structuredClone(rows), result = review(rows, 200)
  assert.deepEqual(result.duplicateCandidates[0].transactions.map(item => item.transactionId), ['a', 'b'])
  assert.equal(result.duplicateCandidates[0].spanSeconds, 300)
  assert.equal(result.coverage.truncated, true)
  assert.equal(result.coverage.bankTotal, 200)
  assert.equal(result.coverage.returnedCount, 4)
  assert.deepEqual(rows, original)
})

test('spikes use only strictly earlier merchant history on three distinct Shanghai days, never later transactions', () => {
  const rows = [row('future-history', '2026-10-20T04:00:00Z', 1000000), row('spike', '2026-10-20T03:00:00Z', 10000),
    row('x', '2026-10-01T01:00:00Z'), row('y', '2026-10-02T01:00:00Z'), row('z', '2026-10-03T01:00:00Z')]
  const result = review(rows)
  const spike = result.amountSpikeCandidates.find(item => item.transaction.transactionId === 'spike')
  assert.equal(spike.baselineMedianCents, 1000)
  assert.equal(spike.priorSampleCount, 3)
  assert.equal(spike.ratio, 10)
  assert(!spike.priorEvidence.some(item => item.transactionId === 'future-history'))
  assert.equal(review(rows.slice(1, 4)).candidateCounts.amountSpikes, 0)
  const sameDay = ['01:00:00', '02:00:00', '03:00:00'].map((time, i) => row(String(i), `2026-10-19T${time}Z`))
  assert.equal(review([...sameDay, rows[1]]).candidateCounts.amountSpikes, 0)
  const utcDaysButTwoShanghaiDays = ['2026-10-01T17:00:00Z', '2026-10-02T01:00:00Z', '2026-10-03T01:00:00Z'].map((date, i) => row(`tz${i}`, date))
  assert.equal(review([...utcDaysButTwoShanghaiDays, rows[1]]).candidateCounts.amountSpikes, 0)
  const baseline = ['2026-10-01', '2026-10-02', '2026-10-03'].map((date, i) => row(`boundary${i}`, `${date}T01:00:00Z`, 5000))
  assert.equal(review([...baseline, row('below-ratio', '2026-10-20T01:00:00Z', 14999)]).candidateCounts.amountSpikes, 0)
  assert.equal(review([...baseline, row('at-ratio', '2026-10-20T01:00:00Z', 15000)]).candidateCounts.amountSpikes, 1)
  assert.equal(review([...rows.slice(2), row('below-floor', '2026-10-20T01:00:00Z', 9999)]).candidateCounts.amountSpikes, 0)
})

test('pending/failed/income/transfers/other, invalid and future dates never become payment anomalies', () => {
  const base = '2026-10-20T01:00:00Z'
  const result = review([row('pending', base, 1000, { status: 'pending' }), row('failed', base, 1000, { status: 'failed' }),
    row('income', base, 1000, { direction: 'in', signedAmount: 1000 }), row('transfer', base, 1000, { category: 'transfer' }),
    row('other', base, 1000, { category: 'other' }), row('bad', '2026-02-30T01:00:00Z'), row('future', '2027-01-01T01:00:00Z')])
  assert.equal(result.coverage.analyzedExpenseCount, 0)
  assert.deepEqual(result.coverage.ignored, { notSettledExpense: 3, excludedCategory: 2, missingMerchant: 0, invalidDate: 1, futureDate: 1 })
  assert.deepEqual(result.coverage.invalidDateTransactionIds, ['bad'])
  assert.deepEqual(result.candidateCounts, { duplicateGroups: 0, amountSpikes: 0 })
  assert.match(result.notice, /未发现候选不代表安全/)
})

test('currency derives from authoritative account, unknown currencies and cross-account/malformed data fail', () => {
  const tx = row('a', '2026-10-20T01:00:00Z')
  assert.equal(review([tx], 1, { ...account, currency: 'USD' }).currency, 'USD')
  for (const extra of [{ accountId: 'someone-else' }, { currency: 'USD' }, { amount: 0.5 }, { signedAmount: 1000 }, { amount: Number.MAX_SAFE_INTEGER + 1 }, { status: 'reversed' }]) assert.throws(() => review([{ ...tx, ...extra }]), /不一致/)
  assert.throws(() => review([tx, tx]), /不一致/)
  assert.throws(() => review([tx], 1, { ...account, currency: 'EUR' }), /币种/)
  for (const limit of [0, 19, 201, 20.5, '100']) assert.throws(() => validateReviewLimit(limit), /整数/)
  assert.throws(() => review([tx], 0), /分页/)
  assert.equal(review([]).coverage.observedRange, null)
})

test('history outside ninety days is excluded and output limits disclose full candidate counts', () => {
  const old = ['2026-01-01', '2026-01-02', '2026-01-03'].map((date, i) => row(`old${i}`, `${date}T01:00:00Z`))
  assert.equal(review([...old, row('large', '2026-10-20T01:00:00Z', 100000)]).candidateCounts.amountSpikes, 0)
  const many = Array.from({ length: 21 }, (_, i) => [row(`a${i}`, '2026-10-20T01:00:00Z', 1000, { counterparty: `merchant${i}` }), row(`b${i}`, '2026-10-20T01:01:00Z', 1000, { counterparty: `merchant${i}` })]).flat()
  const result = review(many)
  assert.equal(result.candidateCounts.duplicateGroups, 21)
  assert.equal(result.duplicateCandidates.length, 20)
  assert.equal(result.findingsTruncated, true)
  const cluster = review(Array.from({ length: 7 }, (_, i) => row(String(i), `2026-10-20T01:00:0${i}Z`))).duplicateCandidates[0]
  assert.equal(cluster.count, 7)
  assert.equal(cluster.transactions.length, 5)
  assert.equal(cluster.evidenceTruncated, true)
})
