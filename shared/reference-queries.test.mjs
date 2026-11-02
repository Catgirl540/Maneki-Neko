import test from 'node:test'
import assert from 'node:assert/strict'
import { monthlyBudgetsOverview, saveMonthlyBudget, removeMonthlyBudget } from './monthly-budgets.mjs'
import { referenceExchangeRates } from './fx-rates.mjs'

const now = Date.parse('2026-11-02T12:00:00+08:00')
function fixture() {
  const tx = (id, amount, createdAt, extra = {}) => ({ id, accountId: 'cny', direction: 'out', category: 'dining', status: 'success', amount, createdAt, ...extra })
  return { accounts: [{ id: 'cny', currency: 'CNY', accountNo: '8820000000001234', balance: 100000, available: 100000 }], currencyBalances: [{ id: 'usd', currency: 'USD' }], transactions: [
    tx('included', 700, '2026-10-31T16:00:00Z'), tx('priorMonth', 900, '2026-10-31T15:59:59Z'), tx('future', 900, '2026-11-03T00:00:00Z'),
    tx('invalid', 900, 'invalid'), tx('pending', 900, '2026-11-01T00:00:00Z', { status: 'pending' }), tx('incoming', 900, '2026-11-01T00:00:00Z', { direction: 'in' }),
    tx('usd', 500, '2026-11-01T00:00:00Z', { accountId: 'usd' }), tx('fx', 900, '2026-11-01T00:00:00Z', { businessType: 'exchange' }),
  ] }
}
test('monthly category goals use Shanghai successful ledger statistics and versioned owner-local state', () => {
  const db = fixture(), ledger = JSON.stringify([db.accounts, db.transactions])
  const input = { month: '2026-11', category: 'dining', currency: 'CNY', limit: 1000, version: 0 }
  const goal = saveMonthlyBudget(db, input, now)
  assert.equal(goal.spent, 700); assert.equal(goal.remaining, 300); assert.equal(goal.version, 1)
  assert.throws(() => saveMonthlyBudget(db, input, now), { code: 'VERSION_CONFLICT' })
  const changed = saveMonthlyBudget(db, { ...input, version: 1, limit: 600 }, now)
  assert.equal(changed.overBy, 100); assert.equal(changed.remaining, 0)
  assert.equal(db.monthlyBudgets.length, 1)
  assert.equal(JSON.stringify([db.accounts, db.transactions]), ledger)
  assert.equal(monthlyBudgetsOverview(structuredClone(db), '2026-11', now).goals[0].limit, 600)
  assert.deepEqual(monthlyBudgetsOverview(fixture(), '2026-11', now).goals, [])
  assert.equal(monthlyBudgetsOverview(fixture(), undefined, Date.parse('2026-12-01T00:00:00+08:00')).month, '2026-12')
  for (const invalid of [{ month: '2026-13' }, { category: 'transfer' }, { limit: 1.1 }, { limit: -1 }, { currency: 'EUR' }, { version: '2' }]) assert.throws(() => saveMonthlyBudget(db, { ...input, ...invalid }, now))
})
test('rates return numerical directions without debit amounts, balances or market freshness claims', () => {
  const db = fixture(), before = JSON.stringify(db)
  const result = referenceExchangeRates(db, { CNY: 1, USD: 7.1562, HKD: 0.91547 }, 0.0035, now)
  assert.equal(result.source, 'sandbox-reference'); assert.equal(result.marketAsOf, null); assert.equal(result.rates.length, 6)
  const rate = result.rates.find(row => row.fromCurrency === 'CNY' && row.toCurrency === 'USD')
  assert.equal(rate.midRate, 1 / 7.1562); assert.equal(rate.rate, rate.midRate * (1 - rate.spread))
  assert(result.notice.includes('本行公布的换汇牌价')); assert(result.notice.includes('asOf 为查询时间'))
  assert.equal(JSON.stringify(db), before)
})

test('monthly deletion validates ownership and versions, keeps ledger and other goals, and never reuses a deleted identity', () => {
  const db = fixture(), other = fixture(), input = { month: '2026-11', category: 'dining', currency: 'CNY', limit: 1000, version: 0 }
  db.budgets = [{ id: 'daily', dailyLimit: 100 }]
  const unchanged = JSON.stringify([db.accounts, db.transactions, db.budgets])
  const goal = saveMonthlyBudget(db, input, now)
  const keep = saveMonthlyBudget(db, { ...input, category: 'other' }, now)
  const request = { id: goal.id, version: goal.version }
  for (const invalid of [null, {}, { ...request, version: 0 }, { ...request, version: '1' }]) assert.throws(() => removeMonthlyBudget(db, invalid), { code: 'INVALID_MONTHLY_BUDGET' })
  assert.throws(() => removeMonthlyBudget(other, request), { code: 'MONTHLY_BUDGET_NOT_FOUND' })
  const updated = saveMonthlyBudget(db, { ...input, version: 1, limit: 1500 }, now)
  assert.throws(() => removeMonthlyBudget(db, request), { code: 'VERSION_CONFLICT' })
  assert.deepEqual(removeMonthlyBudget(db, { id: updated.id, version: 2 }), { id: updated.id, deleted: true })
  assert.deepEqual(monthlyBudgetsOverview(structuredClone(db), input.month, now).goals.map(g => g.id), [keep.id])
  assert.throws(() => removeMonthlyBudget(db, request), { code: 'MONTHLY_BUDGET_NOT_FOUND' })
  const recreated = saveMonthlyBudget(db, input, now)
  assert.notEqual(recreated.id, goal.id)
  assert.throws(() => removeMonthlyBudget(db, request), { code: 'MONTHLY_BUDGET_NOT_FOUND' })
  assert.equal(db.monthlyBudgets.find(g => g.id === recreated.id).limit, 1000)
  assert.equal(JSON.stringify([db.accounts, db.transactions, db.budgets]), unchanged)
})
