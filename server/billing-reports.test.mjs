import test from 'node:test'
import assert from 'node:assert/strict'
import { billingReport, exportBillingReport } from '../shared/billing-reports.mjs'
import { searchPayees, updatePayeeRemark } from '../shared/payee-search.mjs'

const now = Date.parse('2027-01-01T00:30:00Z')
const tx = (id, createdAt, amount, extra = {}) => ({ id, accountId: 'cn', createdAt, amount, direction: 'out', status: 'success', category: 'shopping', ...extra })
const db = { accounts: [{ id: 'cn', currency: 'CNY' }], currencyBalances: [{ id: 'usd', currency: 'USD' }], transactions: [
  tx('2026-start', '2025-12-31T16:00:00Z', 100), tx('2026-end', '2026-12-31T15:59:59Z', 200), tx('2027-start', '2026-12-31T16:00:00Z', 300),
  tx('old', '2025-12-31T15:59:59Z', 999), tx('usd', '2026-01-01T00:00:00Z', 777, { accountId: 'usd' }),
  tx('income', '2026-05-01T00:00:00Z', 500, { direction: 'in', category: 'salary' }),
  tx('fx', '2026-05-01T00:00:00Z', 10000, { businessType: 'exchange' }), tx('clearing', '2026-05-01T00:00:00Z', 10000, { status: 'pending', pendingReason: 'clearing' }),
  tx('future', '2027-01-01T01:00:00Z', 10000), tx('invalid', '2026-02-30T00:00:00Z', 10000),
] }
test('annual and monthly reports use full Shanghai periods and keep currency/posted-state boundaries', () => {
  const before = structuredClone(db), report = billingReport(db, { period: 'year', value: '2026', currency: 'CNY' }, { shopping: '购物' }, now)
  assert.equal(report.totalExpense, 300); assert.equal(report.totalIncome, 500); assert.equal(report.net, 200); assert.equal(report.transactionCount, 3)
  assert.equal(report.months.length, 12); assert.deepEqual(report.months[0], { month: '2026-01', income: 0, expense: 100, count: 1 })
  assert.equal(report.months[11].expense, 200); assert.equal(report.periodStatus, 'complete'); assert.equal(report.timeZone, 'Asia/Shanghai')
  assert.deepEqual(report.categories, [{ key: 'shopping', label: '购物', amount: 300, ratio: 1 }]); assert.deepEqual(report.ignoredDates, { invalidDate: 1, futureDate: 1 })
  assert.equal(billingReport(db, { period: 'year', value: '2026', currency: 'USD' }, {}, now).totalExpense, 777)
  const current = billingReport(db, { period: 'month', value: '2027-01', currency: 'CNY' }, {}, now)
  assert.equal(current.totalExpense, 300); assert.equal(current.periodStatus, 'partial'); assert.equal(current.months.length, 1)
  assert.deepEqual(db, before)
})
test('annual report exceeds bounded review sample and CSV exposes amounts/period/as-of without mixed currency', () => {
  const all = { ...db, transactions: Array.from({ length: 501 }, (_, index) => tx(String(index), '2026-02-01T00:00:00Z', 3)) }
  const exported = exportBillingReport(all, { period: 'year', value: '2026', currency: 'CNY' }, { shopping: '购物' }, now)
  assert.equal(exported.report.totalExpense, 1503); assert.equal(exported.report.transactionCount, 501)
  assert.equal(exported.rows[0].expense, '15.03'); assert.equal(exported.rows[0].currency, 'CNY'); assert(exported.fileName.includes('年报-2026-CNY'))
  assert.equal(exported.rows.filter(row => row.section === '月度').length, 12)
  for (const amount of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => billingReport({ ...db, transactions: [tx('bad', '2026-02-01T00:00:00Z', amount)] }, { period: 'year', value: '2026', currency: 'CNY' }, {}, now), { code: 'INVALID_STATISTICS_AMOUNT' })
  assert.throws(() => billingReport(db, { period: 'year', value: '2026-01', currency: 'CNY' }, {}, now), { code: 'INVALID_REPORT_PERIOD' })
  assert.throws(() => billingReport(db, { period: 'month', value: '2026-13', currency: 'CNY' }, {}, now), { code: 'INVALID_REPORT_PERIOD' })
})
test('saved recipient search reads owned remarks and editing is bounded, never a phone registration resolver', () => {
  const rows = [{ id: 'mine', name: '王明', accountNo: '6222000000000000', lastUsedAt: '2026-10-27T00:00:00Z' }]
  updatePayeeRemark(rows, 'mine', '爱人 房租')
  assert.equal(searchPayees(rows, '爱人')[0].id, 'mine'); assert.equal(searchPayees(rows, '房租').length, 1)
  assert.equal(searchPayees(rows, '王明').length, 1); assert.equal(searchPayees(rows, '13900139000').length, 0)
  assert.throws(() => updatePayeeRemark(rows, 'someone-elses-payee', '备注'), { code: 'PAYEE_NOT_FOUND' })
  assert.throws(() => updatePayeeRemark(rows, 'mine', '长'.repeat(141)), { code: 'INVALID_PAYEE_REMARK' })
})
