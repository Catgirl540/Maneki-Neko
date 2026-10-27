/**
 * 卡数量限制 + 会员制卡费减免；仅内存夹具，不触碰客户数据库。
 *
 * 规则（docs/product/cards-and-membership-proposal.md 已确认口径）：
 * - 每位客户每个卡组织（Visa / 银联）至多一张；active/locked/pending 占名额，replaced 不占。
 * - 换卡在同一笔操作里旧卡失效、新卡接替名额，不额外占名额。
 * - 演示档案当前按 AUM 评白金；本检查专门覆盖「钻石 2 次全免（含寄送）」路径，
 *   所以把上月快照抬到钻石门槛（评定只读快照，不看当前余额）。
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
const { loadDb, resetDb, persist, CARD_PRODUCTS } = await import('../app/src/api/mock/db.ts')
resetDb()
const api = createMockApi()
const sms = await api.sendSmsCode('13800138000')
await api.login('13800138000', '123456', sms.demoCode)

// 上月快照抬到钻石门槛（¥310 万）→ 首次评定落钻石，覆盖 2 次全免额度
loadDb().assetSnapshots = loadDb().assetSnapshots.map((s) => ({ ...s, assets: 310_000_000 }))
persist()

const addr = { recipient: '林小满', phone: '13800138000', region: '上海市', city: '上海市', detail: '浦东新区世纪大道 100 号', postalCode: '200120' }
const unionpay = CARD_PRODUCTS.find(p => p.network === 'unionpay')
const visa = CARD_PRODUCTS.find(p => p.network === 'visa')
const balance = () => loadDb().accounts[0].balance
const occupying = (network) => loadDb().cards.filter(c => c.network === network && ['active', 'locked', 'pending', 'lost'].includes(c.status))
const networkLimit = (e) => e.code === 'CARD_NETWORK_LIMIT'

// 演示档案：在用 Visa 一张（active），银联历史卡已换发（不占名额），Visa 另有一张 replaced 历史卡
const products = await api.listCardProducts()
assert.equal(products.find(p => p.network === 'visa').held, true)
assert.equal(products.find(p => p.network === 'unionpay').held, false)
// 钻石会员实付报价：两次全免额度内 payable = 0
assert.equal(products.find(p => p.network === 'unionpay').feeQuote.payable, 0)
assert.equal(products.find(p => p.network === 'visa').feeQuote.payable, 0)
console.log('PASS 产品目录按名额与会员等级返回 held / feeQuote')

// 已占名额的组织：申请直接 409，不验密、不收费、不造卡
const beforeVisaReject = balance()
const cardCount0 = loadDb().cards.length
await assert.rejects(api.openCard({ productCode: visa.code, address: addr, paymentPassword: '000000' }), networkLimit)
assert.equal(balance(), beforeVisaReject)
assert.equal(loadDb().cards.length, cardCount0)
console.log('PASS Visa 名额被占用时申请被拒：密码错也先拦名额，不收费不造卡')

// 空着名额的组织：正常申请；钻石会员第一次减免 → 实付 0，余额不动
const openTxBefore = loadDb().transactions.length
const created = await api.openCard({ productCode: unionpay.code, address: addr, paymentPassword: '888888' })
assert.equal(created.network, 'unionpay')
assert.equal(created.status, 'pending')
assert.equal(created.replacedFromId, null)
assert.equal(created.accountId, loadDb().accounts[0].id)
assert.equal(balance(), beforeVisaReject)
assert.equal(loadDb().transactions.length, openTxBefore)
assert.equal(loadDb().membership.benefitUsage.cardFeeWaiversUsed, 1)
assert(loadDb().membership.records.some(r => r.label.includes('制卡/换卡费减免')))
console.log('PASS 空名额可申卡：会员减免核销一次，实付 0 不产生扣款流水')

// pending 卡占名额：银联名额已满，再申请被拒且不收费
await assert.rejects(api.openCard({ productCode: unionpay.code, address: addr, paymentPassword: '888888' }), networkLimit)
assert.equal(balance(), beforeVisaReject)
console.log('PASS pending（寄送中）状态占用名额，重复申请被拒')

// 锁定也占名额：把刚开的银联卡锁住，名额不释放
await assert.rejects(api.setCardLock(created.id, true), error => error.code === 'CARD_NOT_DELIVERED')
await api.activateCard(created.id, '888888')
await api.setCardLock(created.id, true)
assert.equal(loadDb().cards.find(c => c.id === created.id).status, 'locked')
await assert.rejects(api.openCard({ productCode: unionpay.code, address: addr, paymentPassword: '888888' }), networkLimit)
console.log('PASS locked 状态占用名额，锁卡不释放名额')

// 换卡：旧 Visa active → replaced，新 Visa pending 接替名额；第二次减免 → 实付 0
const oldVisa = loadDb().cards.find(c => c.network === 'visa' && c.status === 'active')
const replaced = await api.replaceCard(oldVisa.id, { address: addr, paymentPassword: '888888' })
assert.equal(replaced.network, 'visa')
assert.equal(replaced.status, 'pending')
assert.equal(replaced.replacedFromId, oldVisa.id)
assert.equal(loadDb().cards.find(c => c.id === oldVisa.id).status, 'replaced')
assert.equal(occupying('visa').length, 1)
assert.equal(occupying('visa')[0].id, replaced.id)
assert.equal(balance(), beforeVisaReject)
assert.equal(loadDb().membership.benefitUsage.cardFeeWaiversUsed, 2)
await assert.rejects(api.openCard({ productCode: visa.code, address: addr, paymentPassword: '888888' }), networkLimit)
console.log('PASS 换卡原子接替名额：旧卡停用新卡 pending，新卡仍占用名额')

// 年度减免耗尽后：再换银联卡按标价全额扣费（银联产品 制卡费¥10 寄送免费）
const before3 = balance()
const paid = await api.replaceCard(created.id, { address: addr, paymentPassword: '888888' })
assert.equal(paid.issuingFee, unionpay.issuingFee + unionpay.deliveryFee)
assert.equal(balance(), before3 - unionpay.issuingFee - unionpay.deliveryFee)
assert.equal(loadDb().membership.benefitUsage.cardFeeWaiversUsed, 2)
console.log('PASS 减免次数用完后按标价收费，不再核销')

// 已换发的旧卡不能重复换卡；占用中的卡仍各一张
await assert.rejects(api.replaceCard(oldVisa.id, { address: addr, paymentPassword: '888888' }), (e) => e.code === 'CARD_REPLACED')
assert.equal(occupying('visa').length, 1)
assert.equal(occupying('unionpay').length, 1)
assert(loadDb().cards.every(c => c.accountId === loadDb().accounts[0].id))
// 历史 replaced 卡全部保留在列表里，未被删除
assert.equal(loadDb().cards.length, cardCount0 + 3)
console.log('PASS 历史卡保留、占用卡各一张、所有卡仍共享同一资金账户')
