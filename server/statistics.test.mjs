import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { spendingStatistics, cashFlowStatistics } from '../shared/account-model.mjs'
const now = Date.parse('2026-10-31T16:30:00Z') // Shanghai Nov 1, 00:30
const tx = (id, date, amount, extra = {}) => ({ id, accountId: 'cn', createdAt: date, amount, direction: 'out', status: 'success', category: 'shopping', ...extra })
const db = { accounts: [{ id: 'cn', currency: 'CNY' }], currencyBalances: [{ id: 'usd', currency: 'USD' }], transactions: [
  tx('oct-end', '2026-10-31T15:59:00Z', 100), tx('nov-start', '2026-10-31T16:00:00Z', 200),
  tx('oct-start', '2026-09-30T16:00:00Z', 400), tx('sep-end', '2026-09-30T15:59:00Z', 500),
  tx('future', '2026-10-31T17:00:00Z', 10000), tx('invalid', 'not-a-date', 10000),
  tx('fx', '2026-10-31T16:00:00Z', 50000, { businessType: 'exchange', category: 'transfer' }),
  tx('normal-transfer', '2026-10-31T16:01:00Z', 50, { category: 'transfer' }),
  tx('clearing', '2026-10-31T16:02:00Z', 70, { status: 'pending', pendingReason: 'clearing' }),
  tx('hold', '2026-10-31T16:03:00Z', 90, { status: 'pending', pendingReason: 'inflight' }),
  tx('failed', '2026-10-31T16:04:00Z', 30, { status: 'failed' }),
  tx('income', '2026-10-31T16:05:00Z', 500, { direction: 'in', category: 'salary' }),
  tx('usd', '2026-10-31T16:06:00Z', 999, { accountId: 'usd' }),
] }
const labels = { shopping: '购物', transfer: '转账' }

test('spending uses Shanghai month boundaries, selected-month comparison, separate currencies and no invented zero-base comparison', () => {
  const original = structuredClone(db)
  const october = spendingStatistics(db, '2026-10', labels, now)
  assert.equal(october.total, 500); assert.equal(october.previousTotal, 500)
  assert.equal(october.previousMonth, '2026-09'); assert.equal(october.monthOverMonth, 0)
  assert.equal(october.monthOverMonthComparable, true); assert.equal(october.periodStatus, 'complete')
  assert.equal(october.trend.at(-1).month, '2026-10'); assert.equal(october.trend.at(-1).amount, 500)
  const current = spendingStatistics(db, undefined, labels, now)
  assert.equal(current.month, '2026-11'); assert.equal(current.total, 250)
  assert.equal(current.monthOverMonth, -0.5); assert.equal(current.periodStatus, 'partial')
  assert.equal(current.byCurrency.USD.total, 999)
  assert.equal(current.byCurrency.USD.monthOverMonthComparable, false)
  assert.equal(current.byCurrency.USD.previousTotal, 0)
  assert.deepEqual(current.ignoredDates, { invalidDate: 1, futureDate: 1 })
  assert.equal(current.timeZone, 'Asia/Shanghai')
  assert.deepEqual(db, original)
})

test('cash flow groups by Shanghai day, respects as-of time and preserves clearing vs hold policy', () => {
  const result = cashFlowStatistics(db, 2, now)
  assert.deepEqual(result.points, [{ date: '2026-10-31', income: 0, expense: 100 }, { date: '2026-11-01', income: 500, expense: 320 }])
  assert.equal(result.totalIncome, 500); assert.equal(result.totalExpense, 420)
  assert.equal(result.byCurrency.USD.totalExpense, 999)
  assert.deepEqual(result.ignoredDates, { invalidDate: 1, futureDate: 1 })
  const dates = ['2026-02-30T00:00:00Z', '2026-10-31T24:00:00Z', '2026-11-01T00:00:00', '2026-11-01']
  const invalid = cashFlowStatistics({ ...db, transactions: dates.map((date, index) => tx(String(index), date, 100)) }, 2, now)
  assert.deepEqual(invalid.ignoredDates, { invalidDate: 4, futureDate: 0 })
  const offset = cashFlowStatistics({ ...db, transactions: [tx('offset', '2026-11-01T00:00:00+08:00', 200)] }, 2, now)
  assert.deepEqual(offset.points, [{ date: '2026-10-31', income: 0, expense: 0 }, { date: '2026-11-01', income: 0, expense: 200 }])
})

test('statistics are identical in UTC and New York processes and fail on unsafe money', () => {
  const module = new URL('../shared/account-model.mjs', import.meta.url).href
  const source = `import {spendingStatistics,cashFlowStatistics} from ${JSON.stringify(module)}; const db=${JSON.stringify(db)}; console.log(JSON.stringify([spendingStatistics(db,undefined,{},${now}),cashFlowStatistics(db,2,${now})]));`
  const outputs = ['UTC', 'America/New_York'].map(TZ => {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], { env: { ...process.env, TZ }, encoding: 'utf8', windowsHide: true })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout
  })
  assert.equal(outputs[0], outputs[1])
  for (const amount of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => spendingStatistics({ ...db, transactions: [tx('bad', '2026-10-31T16:00:00Z', amount)] }, undefined, labels, now), error => error.code === 'INVALID_STATISTICS_AMOUNT')
  assert.throws(() => cashFlowStatistics({ ...db, transactions: [tx('max', '2026-10-31T16:00:00Z', Number.MAX_SAFE_INTEGER), tx('one', '2026-10-31T16:01:00Z', 1)] }, 1, now), error => error.code === 'INVALID_STATISTICS_AMOUNT')
})
