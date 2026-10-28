/** 单账户/多卡/币种余额迁移；仅内存夹具，不触碰客户数据库。 */
import assert from 'node:assert/strict'
class MemoryStorage {
  values = new Map()
  getItem(key) { return this.values.get(key) ?? null }
  setItem(key, value) { this.values.set(key, String(value)) }
  removeItem(key) { this.values.delete(key) }
}
globalThis.window = { localStorage: new MemoryStorage(), sessionStorage: new MemoryStorage() }
const { createMockApi } = await import('../app/src/api/mock/index.ts')
const { loadDb, resetDb, migrateProfile, ledgerBalances, CARD_PRODUCTS } = await import('../app/src/api/mock/db.ts')
const { ACCOUNT_OPENING_PLEDGE } = await import('../app/src/lib/account-opening.ts')
resetDb()
const api = createMockApi()
const sms = await api.sendSmsCode('13800138000')
await api.login('13800138000', '123456', sms.demoCode)
const original = loadDb()
assert.equal(original.accounts.length, 1)
assert.equal(original.cards.length, 3)
assert(original.cards.every(card => card.accountId === original.accounts[0].id))
// 名额口径：1 张在用 Visa + 2 张历史卡（replaced 不占名额）；银联名额空着
const occupying = original.cards.filter(c => ['active', 'locked', 'pending'].includes(c.status))
assert.equal(occupying.length, 1)
assert.equal(occupying[0].network, 'visa')
assert(original.cards.filter(c => c.network === 'unionpay').every(c => c.status === 'replaced'))
console.log('PASS 三张初始卡共享一个资金账户；每个卡组织至多一张在用卡')

const old = structuredClone(original); old.schema = 18
const main = old.accounts[0]
old.accounts.push({ ...main, id: 'legacy-card', accountNo: 'legacy-no', balance: 12345, available: 10000 })
old.accounts.push({ ...main, id: 'legacy-usd', accountNo: 'legacy-usd-no', currency: 'USD', balance: 2000, available: 1700 })
old.cards[1].accountId = 'legacy-card'
old.transactions[0].accountId = 'legacy-card'
old.transactions[0].detail.accountNo = 'legacy-no'
old.transactions[0].heldRequest = { fromAccountId: 'legacy-card' }
const expected = main.balance + 12345
const migrated = migrateProfile(old)
assert.equal(old.accounts.length, 3)
assert.equal(old.accounts[0].balance, main.balance)
assert.equal(migrated.accounts.length, 1)
assert.equal(migrated.accounts[0].balance, expected)
assert.equal(migrated.accounts[0].available, main.available + 10000)
assert.equal(migrated.currencyBalances[0].balance, 2000)
assert.equal(migrated.currencyBalances[0].available, 1700)
assert(migrated.cards.every(card => card.accountId === main.id))
assert.equal(migrated.transactions[0].accountId, main.id)
assert.equal(migrated.transactions[0].heldRequest.fromAccountId, main.id)
assert.equal(migrated.transactions[0].detail.accountNo, 'legacy-no')
assert.deepEqual(migrateProfile(structuredClone(migrated)), migrated)
console.log('PASS 旧同币种资金合并，冻结金额/外币资金/流水快照保留，重复迁移不重复加钱')

const before = (await api.listAccounts())[0]
const exchange = async (id, toCurrency, amount) => {
  const quote = await api.quoteExchange({ fromAccountId: id, toCurrency, amount })
  assert.equal(quote.toAccountNo, before.accountNo)
  const req = { fromAccountId: id, toCurrency, amount, quoteId: quote.quoteId }
  const balances = structuredClone(ledgerBalances(loadDb()))
  await assert.rejects(api.submitExchange({ ...req, paymentPassword: 'wrong' }))
  assert.deepEqual(ledgerBalances(loadDb()), balances)
  return api.submitExchange({ ...req, paymentPassword: '888888' })
}
const first = await exchange(before.id, 'USD', 10000)
let accounts = await api.listAccounts()
assert.equal(accounts.length, 1)
assert.equal(accounts[0].accountNo, before.accountNo)
assert.equal(accounts[0].currencyBalances.length, 2)
const usd = accounts[0].currencyBalances.find(row => row.currency === 'USD')
assert.equal(usd.accountNo, before.accountNo)
assert.equal(usd.balance, first.fx.toAmount)
assert.equal(accounts[0].balance, before.balance - 10000)
await exchange(usd.id, 'CNY', Math.min(100, usd.available))
accounts = await api.listAccounts()
assert.equal(accounts.length, 1)
assert.equal(loadDb().currencyBalances.length, 1)
const history = await api.listTransactions(usd.id, { size: 100 })
assert.equal(history.total, 2)
console.log('PASS 双向换汇仅新增币种余额，同一账户号；支付密码失败不扣款；币种流水可查')

const product = CARD_PRODUCTS[0]
assert.equal(product.network, 'unionpay')
const cardCount = (await api.listCards()).length
await api.openCard({ productCode: product.code, address: { recipient: '林小满', phone: '13800138000', region: '上海市', city: '上海市', detail: '浦东新区测试路100号', postalCode: '200120' }, paymentPassword: '888888' })
assert.equal((await api.listCards()).length, cardCount + 1)
assert.equal((await api.listAccounts()).length, 1)
assert((await api.listCards()).every(card => card.accountId === before.id))
// 名额占满后：同组织再申请被拒且不收费，Visa 侧更早就被占住
const balanceAfterUnionpay = (await api.listAccounts())[0].balance
const addr = { recipient: '林小满', phone: '13800138000', region: '上海市', city: '上海市', detail: '浦东新区测试路100号', postalCode: '200120' }
for (const code of [CARD_PRODUCTS[0].code, CARD_PRODUCTS.find(p => p.network === 'visa').code]) {
  await assert.rejects(api.openCard({ productCode: code, address: addr, paymentPassword: '888888' }), (e) => e.code === 'CARD_NETWORK_LIMIT')
}
assert.equal((await api.listCards()).length, cardCount + 1)
assert.equal((await api.listAccounts())[0].balance, balanceAfterUnionpay)
console.log('PASS 申请新卡只增加卡片，所有卡共享账户；同组织重复申请被拒且不收费')

const newSms = await api.sendSmsCode('13900139099')
const face = await api.verifyIdentity('face')
await api.register({ phone: '13900139099', password: 'SafeBank!123', paymentPassword: '888888', holderName: '隔离测试', idNumber: '310101199001011234', smsCode: newSms.demoCode, faceTicket: face.ticket, pledge: ACCOUNT_OPENING_PLEDGE })
const fresh = await api.listAccounts()
assert.equal(fresh.length, 1)
assert.equal(fresh[0].balance, 0)
assert.equal(fresh[0].currencyBalances.length, 1)
assert.deepEqual(loadDb().accountAliases, {})
console.log('PASS 新用户不会继承上一用户的外币余额或旧账户映射')
