/**
 * 多币种转账回归：付款币种分区、本行外币收款自动开立同账户分区。
 *
 * 只跑浏览器模拟后端（内存 localStorage），不触碰任何数据库。
 * 断言的是账户模型：收款人始终只有一个资金账户、一个对客账户号，
 * 外币入账只多一条币种分区，不是第二个账户。
 */
import assert from 'node:assert/strict'

class MemoryStorage {
  values = new Map()
  getItem(key) { return this.values.get(key) ?? null }
  setItem(key, value) { this.values.set(key, String(value)) }
  removeItem(key) { this.values.delete(key) }
}
globalThis.window = { localStorage: new MemoryStorage(), sessionStorage: new MemoryStorage() }

const { createMockApi } = await import('../app/src/api/mock/index.ts')
const { loadDb, resetDb, findProfileByPhone, ledgerBalances } = await import('../app/src/api/mock/db.ts')

resetDb()
const api = createMockApi()
const sms = await api.sendSmsCode('13800138000')
await api.login('13800138000', '123456', sms.demoCode)

/** 种子里的人民币收款人：只有一个资金账户、没有外币分区 */
const RECIPIENT = { phone: '13600136000', name: '陈嘉禾', accountNo: '8820000000124471' }
const recipientSeed = findProfileByPhone(RECIPIENT.phone)
assert(recipientSeed, '演示收款人应在种子数据里')
assert.equal(recipientSeed.accounts.length, 1)
assert.equal(recipientSeed.accounts[0].accountNo, RECIPIENT.accountNo)
assert.equal(recipientSeed.currencyBalances?.length ?? 0, 0, '收款人初始没有外币分区')

const funding = (await api.listAccounts())[0]
assert.equal(funding.currency, 'CNY')

// —— 付款方先换汇出美元分区：同一资金账户，账户号不变 ——
const quote = await api.quoteExchange({ fromAccountId: funding.id, toCurrency: 'USD', amount: 200000 })
assert.equal(quote.toAccountNo, funding.accountNo)
await api.submitExchange({ fromAccountId: funding.id, toCurrency: 'USD', amount: 200000, quoteId: quote.quoteId, paymentPassword: '888888' })
const mine = (await api.listAccounts())[0]
assert.equal(mine.accountNo, funding.accountNo)
assert.equal(mine.currencyBalances.length, 2)
const usd = mine.currencyBalances.find(row => row.currency === 'USD')
assert(usd, '换汇后应有美元分区')
assert.equal(usd.accountNo, mine.accountNo, '币种分区共享对客账户号')
assert.equal(mine.balance, funding.balance - 200000, '人民币主分区只被换汇扣走')
const cnyAfterExchange = mine.balance

const transferUsd = (amount, memo = '') => api.submitTransfer({
  fromAccountId: usd.id, channel: 'bank', scope: 'domestic',
  payeeName: RECIPIENT.name, payeeAccountNo: RECIPIENT.accountNo,
  payeeBankCode: 'LCB', payeeBankRegion: 'CN', amount, memo,
  paymentPassword: '888888',
})

// —— 美元转给只有人民币的收款人：同一账户下自动开立美元分区 ——
const first = await transferUsd(5000)
assert.equal(first.settlementStatus, 'success')
assert.equal(first.fx, undefined, '同币种不应产生换汇')
let recipient = findProfileByPhone(RECIPIENT.phone)
assert.equal(recipient.accounts.length, 1, '收款人仍只有一个资金账户')
assert.equal(recipient.accounts[0].accountNo, RECIPIENT.accountNo, '对客账户号不变')
assert.equal(recipient.currencyBalances.length, 1, '只多一条币种分区')
const usdRow = recipient.currencyBalances[0]
assert.equal(usdRow.currency, 'USD')
assert.equal(usdRow.balance, 5000)
assert.equal(usdRow.available, 5000)
assert.match(usdRow.accountNo, /^ledger:/, '分区内部号不能冒充对客账户号')
const incoming = recipient.transactions[0]
assert.equal(incoming.accountId, usdRow.id, '入账落在美元分区')
assert.equal(incoming.amount, 5000)
assert.equal(incoming.detail.settleCurrency, 'USD')
assert.equal(incoming.detail.accountNo, RECIPIENT.accountNo, '回单账户号仍是对客账户号')
assert.equal(incoming.memo, `本行转入自尾号 ${funding.accountNo.slice(-4)}`, '摘要用对客账户号尾号')
console.log('PASS 本行外币收款在同一资金账户下开立币种分区，账户号与卡片归属不变')

// —— 再收一笔：沿用同一分区，不重复开立 ——
await transferUsd(2500)
recipient = findProfileByPhone(RECIPIENT.phone)
assert.equal(recipient.currencyBalances.length, 1, '重复收款不重复开分区')
assert.equal(recipient.currencyBalances[0].balance, 7500)
const outgoing = loadDb().transactions[0]
assert.equal(outgoing.memo, `本行转账至尾号 ${RECIPIENT.accountNo.slice(-4)}`, '付款摘要用收款人对客账户号尾号')
assert.equal(loadDb().accounts.length, 1, '付款方仍只有一个资金账户')
assert.equal(loadDb().accounts[0].balance, cnyAfterExchange, '美元转出不动人民币主分区')
console.log('PASS 重复收款沿用原分区；付款方只扣所选币种分区')

// —— 跨币种：人民币付、港币到账 ——
const cny = (await api.listAccounts())[0]
const cross = await api.submitTransfer({
  fromAccountId: cny.id, channel: 'bank', scope: 'domestic',
  payeeName: RECIPIENT.name, payeeAccountNo: RECIPIENT.accountNo,
  payeeBankCode: 'LCB', payeeBankRegion: 'CN', amount: 100000,
  payeeCurrency: 'HKD', memo: '人民币付、港币到',
  paymentPassword: '888888',
})
assert.equal(cross.fx.fromCurrency, 'CNY')
assert.equal(cross.fx.toCurrency, 'HKD')
recipient = findProfileByPhone(RECIPIENT.phone)
assert.equal(recipient.accounts.length, 1)
assert.equal(recipient.accounts[0].accountNo, RECIPIENT.accountNo)
const hkdRow = recipient.currencyBalances.find(row => row.currency === 'HKD')
assert(hkdRow, '跨币种收款应开立港币分区')
assert.equal(hkdRow.balance, cross.fx.toAmount, '到账金额按报价折算')
assert.equal(recipient.currencyBalances.find(row => row.currency === 'USD').balance, 7500, '其他币种分区不变')
console.log('PASS 跨币种本行转账按报价贷记到账币种分区，不新建账户')

// —— 非法币种：拒绝且不动任何余额 ——
const senderBefore = structuredClone(ledgerBalances(loadDb()))
const recipientBefore = structuredClone(findProfileByPhone(RECIPIENT.phone).currencyBalances)
await assert.rejects(
  () => api.submitTransfer({
    fromAccountId: cny.id, channel: 'bank', scope: 'domestic',
    payeeName: RECIPIENT.name, payeeAccountNo: RECIPIENT.accountNo,
    payeeBankCode: 'LCB', payeeBankRegion: 'CN', amount: 100, payeeCurrency: 'EUR', memo: '',
    paymentPassword: '888888',
  }),
  error => error.code === 'INVALID_CURRENCY',
)
assert.deepEqual(ledgerBalances(loadDb()), senderBefore, '非法币种不改付款方余额')
assert.deepEqual(findProfileByPhone(RECIPIENT.phone).currencyBalances, recipientBefore, '非法币种不给收款人开分区')
console.log('PASS 非法到账币种被拒且两侧余额不变')

// —— 自己转自己仍然拒绝 ——
await assert.rejects(
  () => api.submitTransfer({
    fromAccountId: cny.id, channel: 'bank', scope: 'domestic',
    payeeName: RECIPIENT.name, payeeAccountNo: funding.accountNo,
    payeeBankCode: 'LCB', payeeBankRegion: 'CN', amount: 100, memo: '',
    paymentPassword: '888888',
  }),
  error => error.code === 'SAME_ACCOUNT',
)
console.log('PASS 付款与收款为同一资金账户仍被拒绝')

// —— 人民币转账回归：入主分区，不开新分区 ——
const cnyRecipientBefore = findProfileByPhone(RECIPIENT.phone).accounts[0].balance
await api.submitTransfer({
  fromAccountId: cny.id, channel: 'bank', scope: 'domestic',
  payeeName: RECIPIENT.name, payeeAccountNo: RECIPIENT.accountNo,
  payeeBankCode: 'LCB', payeeBankRegion: 'CN', amount: 12345, memo: '',
  paymentPassword: '888888',
})
recipient = findProfileByPhone(RECIPIENT.phone)
assert.equal(recipient.accounts[0].balance, cnyRecipientBefore + 12345, '人民币入主分区')
assert.equal(recipient.currencyBalances.length, 2, '人民币入账不新增币种分区')
assert.equal(recipient.accounts.length, 1)
console.log('PASS 人民币转账仍入主分区，账户数量不变')
