/** 理财页面业务口径回归；纯数据夹具，不连接客户数据库。 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DEFAULT_WEALTH_FILTERS, filterWealthProducts, filterWealthHoldings, hasValidWealthRisk, wealthRecordQuery, WEALTH_ROUTES } from '../app/src/lib/wealth-workspace.ts'
import { activeServiceTarget, serviceGroups } from '../app/src/components/layout/navigation.ts'
import { serviceForPath } from '../app/src/components/layout/services.ts'
const valid = { done: true, expired: false, level: 'C2' }
const products = [
  { code: 'CASH', name: '灵活产品', issuer: '甲公司', category: 'cash', risk: 'R1', openEnded: true, minAmount: 100 },
  { code: 'FIX', name: '期限产品', issuer: '乙公司', category: 'fixed', risk: 'R2', openEnded: false, minAmount: 1000000 },
  { code: 'EQ', name: '权益产品', issuer: '甲公司', category: 'equity', risk: 'R5', openEnded: true, minAmount: 10000 },
]
const filter = patch => filterWealthProducts(products, { ...DEFAULT_WEALTH_FILTERS, ...patch }, valid).map(product => product.code)
assert.deepEqual(filter({}), ['CASH', 'FIX', 'EQ'])
assert.deepEqual(filter({ category: 'cash' }), ['CASH'])
assert.deepEqual(filter({ keyword: '  甲公司  ' }), ['CASH', 'EQ'])
assert.deepEqual(filter({ keyword: 'cash' }), ['CASH'])
assert.deepEqual(filter({ risk: 'R2' }), ['FIX'])
assert.deepEqual(filter({ liquidity: 'closed' }), ['FIX'])
assert.deepEqual(filter({ liquidity: 'open' }), ['CASH', 'EQ'])
assert.deepEqual(filter({ maxMinimum: 10000 }), ['CASH', 'EQ'])
assert.deepEqual(filter({ matchedOnly: true }), ['CASH', 'FIX'])
assert.deepEqual(filter({ keyword: '权益', matchedOnly: true }), [])
for (const risk of [{ done: false, expired: false, level: null }, { done: false, expired: true, level: 'C5' }, { done: true, expired: true, level: 'C5' }, { done: true, expired: false, level: null }]) {
  assert.equal(hasValidWealthRisk(risk), false)
  assert.deepEqual(filterWealthProducts(products, { ...DEFAULT_WEALTH_FILTERS, matchedOnly: true }, risk), [])
}
assert.equal(hasValidWealthRisk(valid), true)
const holdings = [{ id: 'a', closed: true, redeemableAt: '2020-01-01' }, { id: 'b', closed: false, redeemableAt: '2099-01-01' }]
assert.deepEqual(filterWealthHoldings(holdings, 'closed').map(holding => holding.id), ['a'], '封闭状态以服务端为准，不按客户端日期推算')
assert.deepEqual(filterWealthHoldings(holdings, 'open').map(holding => holding.id), ['b'])
assert.deepEqual(wealthRecordQuery('redeem', 3), { category: 'other', keyword: '赎回 · ', page: 3, size: 10 })
assert.equal(wealthRecordQuery('subscribe', 1).keyword, '申购 · ')
assert.equal(new Set(WEALTH_ROUTES.map(route => route.to)).size, 5)
assert.deepEqual(serviceGroups.find(group => group.title === '理财与储蓄').items.map(item => item.to), WEALTH_ROUTES.map(route => route.to))
for (const route of WEALTH_ROUTES) {
  assert.equal(activeServiceTarget(route.to, ''), route.to)
  assert.equal(serviceForPath(route.to)?.id, route.to === '/wealth/plans' ? 'savings' : 'wealth')
}
assert.equal(serviceForPath('/wealth/plans', '?tab=invest')?.id, 'wealth')
assert.equal(activeServiceTarget('/wealth/cash-management', ''), '/wealth/products')
assert.equal(activeServiceTarget('/wealth/insurance', ''), '/wealth/insurance')
const source = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
assert.match(source('app/src/App.tsx'), /path="\/dashboard\/savings" element={<Navigate to="\/wealth\/plans"/)
assert.match(source('app/src/App.tsx'), /path="\/wealth\/investments" element={<Navigate to="\/wealth\/plans\?tab=invest"/)
assert.match(source('app/src/pages/WealthRecordsPage.tsx'), /records\.data\?\.queryKey === queryKey/, '筛选后不能显示旧页缓存')
assert.match(source('framework/knowledge/06-wealth.md'), /不是独立理财委托订单/)
assert.match(source('framework/skills/bank-wealth/SKILL.md'), /不能依据记账成功声称份额确认或赎回到账/)
assert.match(source('docs/product/account-model.md'), /不加总储蓄余额、存钱目标或计划金额/)
console.log('PASS 理财筛选与适当性、封闭期、分页查询、五入口映射、旧链兼容、账户与知识口径')

// 用隔离内存档案验证真实 API 申购 → 持仓 → 部分赎回 → 相关资金流水；不操作浏览器客户库。
class Storage {
  data = new Map()
  getItem(key) { return this.data.get(key) ?? null }
  setItem(key, value) { this.data.set(key, String(value)) }
  removeItem(key) { this.data.delete(key) }
}
globalThis.window = { localStorage: new Storage(), sessionStorage: new Storage() }
const { createMockApi } = await import('../app/src/api/mock/index.ts')
const { resetDb } = await import('../app/src/api/mock/db.ts')
const { RISK_ACKNOWLEDGEMENT, WEALTH_INVESTMENT_AGREEMENT } = await import('../app/src/lib/wealth.ts')
resetDb()
const api = createMockApi()
const account = (await api.listAccounts())[0]
const profile = await api.profile()
const sms = await api.sendSmsCode(profile.phone)
const face = await api.verifyIdentity('face')
const questions = await api.listRiskQuestions()
await api.submitRiskAssessment(questions.map(question => question.options.reduce((best, option, index, all) => option.score > all[best].score ? index : best, 0)))
await api.openWealthAccount({ smsCode: sms.demoCode, faceTicket: face.ticket, agreement: WEALTH_INVESTMENT_AGREEMENT, settlementAccountId: account.id })
const product = (await api.listWealthProducts()).find(row => row.category === 'cash')
assert(product)
const amount = Math.max(product.minAmount, 100000)
const request = { productCode: product.code, amount, paymentPassword: '888888', riskAcknowledgement: RISK_ACKNOWLEDGEMENT }
const overviewBefore = await api.getWealthOverview()
const subscription = await api.subscribeWealth(request)
const afterSubscription = (await api.listAccounts())[0]
assert.equal(afterSubscription.available, account.available - amount)
assert.equal(afterSubscription.accountNo, account.accountNo)
assert.equal((await api.listAccounts()).length, 1)
const beforeShares = overviewBefore.holdings.find(row => row.productCode === product.code)?.shares ?? 0
assert.equal((await api.getWealthOverview()).holdings.find(row => row.productCode === product.code).shares, beforeShares + subscription.shares)
const redemption = await api.redeemWealth({ holdingId: subscription.holding.id, shares: subscription.shares / 2 })
assert.equal((await api.listAccounts())[0].available, afterSubscription.available + redemption.estimatedAmount)
const subscribeRows = await api.listTransactions(account.id, wealthRecordQuery('subscribe', 1))
const redeemRows = await api.listTransactions(account.id, wealthRecordQuery('redeem', 1))
assert(subscribeRows.items.some(row => row.counterparty === `申购 · ${product.name}` && row.amount === amount && row.direction === 'out'))
assert(redeemRows.items.some(row => row.counterparty === `赎回 · ${product.name}` && row.amount === redemption.estimatedAmount && row.direction === 'in'))
const closed = (await api.getWealthOverview()).holdings.find(row => row.closed)
if (closed) {
  const beforeRejected = (await api.listAccounts())[0].available
  await assert.rejects(api.redeemWealth({ holdingId: closed.id }), error => error.code === 'IN_CLOSED_PERIOD')
  assert.equal((await api.listAccounts())[0].available, beforeRejected)
}
console.log('PASS 隔离内存申购/持仓/部分赎回/资金流水闭环；封闭期拒绝赎回，唯一资金账户不变')
