import { findBalance, internalExchange } from './account-model.mjs'

const currencies = ['CNY', 'USD', 'HKD']
const fail = (message, code) => Object.assign(new Error(message), { status: 400, code })
const add = (a, b) => {
  if (!Number.isSafeInteger(b) || b < 0 || !Number.isSafeInteger(a + b)) throw fail('报表金额无效或超过精确整数范围', 'INVALID_STATISTICS_AMOUNT')
  return a + b
}
const shanghaiDate = time => new Date(time + 8 * 3_600_000).toISOString().slice(0, 10)

/** Full posted ledger, never the Agent's bounded review sample. Amounts remain integer minor units. */
export function billingReport(db, { period = 'month', value, currency = 'CNY' } = {}, labels = {}, now = Date.now()) {
  if (!currencies.includes(currency)) throw fail('报表币种无效', 'INVALID_CURRENCY')
  if (!Number.isFinite(now)) throw fail('报表查询时点无效', 'INVALID_STATISTICS_DATE')
  if (!['month', 'year'].includes(period)) throw fail('报表周期须为 month 或 year', 'INVALID_REPORT_PERIOD')
  value ??= shanghaiDate(now).slice(0, period === 'year' ? 4 : 7)
  if (typeof value !== 'string' || !(period === 'year' ? /^(19|20|21)\d{2}$/ : /^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/).test(value)) throw fail('报表年月无效', 'INVALID_REPORT_PERIOD')
  const report = { period, value, currency, timeZone: 'Asia/Shanghai', asOf: new Date(now).toISOString(),
    periodStatus: value < shanghaiDate(now).slice(0, value.length) ? 'complete' : value === shanghaiDate(now).slice(0, value.length) ? 'partial' : 'future',
    totalIncome: 0, totalExpense: 0, net: 0, transactionCount: 0, categories: [], months: [],
    ignoredDates: { invalidDate: 0, futureDate: 0 }, scope: '本人该币种全部已成功记账流水；排除账户内换汇和未成功交易' }
  const categoryAmounts = new Map()
  const months = new Map(Array.from({ length: period === 'year' ? 12 : 1 }, (_, i) => [period === 'year' ? `${value}-${String(i + 1).padStart(2, '0')}` : value, { income: 0, expense: 0, count: 0 }]))
  for (const tx of db.transactions) {
    if ((findBalance(db, tx.accountId)?.currency ?? tx.detail?.settleCurrency) !== currency || tx.status !== 'success' || internalExchange(tx)) continue
    const raw = tx.createdAt
    const time = typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(raw) ? Date.parse(raw) : NaN
    if (!Number.isFinite(time) || new Date(`${raw.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) !== raw.slice(0, 10)) { report.ignoredDates.invalidDate++; continue }
    if (time > now) { report.ignoredDates.futureDate++; continue }
    const day = shanghaiDate(time)
    if (!day.startsWith(value)) continue
    if (!['in', 'out'].includes(tx.direction)) throw fail('报表流水收支方向无效', 'INVALID_STATISTICS_AMOUNT')
    const field = tx.direction === 'in' ? 'totalIncome' : 'totalExpense'
    report[field] = add(report[field], tx.amount)
    const month = months.get(day.slice(0, 7))
    month[tx.direction === 'in' ? 'income' : 'expense'] = add(month[tx.direction === 'in' ? 'income' : 'expense'], tx.amount)
    month.count++; report.transactionCount++
    if (tx.direction === 'out') categoryAmounts.set(tx.category, add(categoryAmounts.get(tx.category) ?? 0, tx.amount))
  }
  report.net = report.totalIncome - report.totalExpense
  report.categories = [...categoryAmounts].sort((a, b) => b[1] - a[1]).map(([key, amount]) => ({ key, label: labels[key] ?? key, amount, ratio: report.totalExpense ? amount / report.totalExpense : 0 }))
  report.months = [...months].map(([month, row]) => ({ month, ...row }))
  return report
}

/** A report file contains the summary and twelve monthly rows for annual reports. */
export function exportBillingReport(db, query, labels, now = Date.now()) {
  const report = billingReport(db, query, labels, now)
  const money = cents => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`
  const row = (section, label, income = '', expense = '', count = '') => ({ section, label, currency: report.currency, income, expense, count, asOf: report.asOf, timeZone: report.timeZone })
  const rows = [row('汇总', `${report.value}（${report.periodStatus === 'complete' ? '完整周期' : '截至查询时点'}）`, money(report.totalIncome), money(report.totalExpense), String(report.transactionCount)),
    ...report.months.map(item => row('月度', item.month, money(item.income), money(item.expense), String(item.count))),
    ...report.categories.map(item => row('支出分类', item.label, '', money(item.amount)))]
  return { report, fileName: `账单${report.period === 'year' ? '年报' : '月报'}-${report.value}-${report.currency}.csv`, total: rows.length,
    batchNo: `report-${report.value}-${report.currency}-${now}`, columns: [{ key: 'section', label: '区段' }, { key: 'label', label: '统计项' }, { key: 'currency', label: '币种' }, { key: 'income', label: '收入（元）' }, { key: 'expense', label: '支出（元）' }, { key: 'count', label: '笔数' }, { key: 'asOf', label: '查询截止时点' }, { key: 'timeZone', label: '时区' }], rows }
}
