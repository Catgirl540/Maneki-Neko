/**
 * 统一客户会员等级；仅内存夹具，不触碰客户数据库。
 *
 * 规则：四档（白银/黄金/铂金/钻石）按上月日均储蓄资产评定本月等级；
 * 评级资产仅含资金账户折人民币余额；旧月费套餐收进 legacy 只读。
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
const { loadDb, resetDb, migrateProfile, FX_SPREAD } = await import('../app/src/api/mock/db.ts')
const { ACCOUNT_OPENING_PLEDGE } = await import('../app/src/lib/account-opening.ts')
resetDb()
const api = createMockApi()
const sms = await api.sendSmsCode('13800138000')
await api.login('13800138000', '123456', sms.demoCode)

// 演示档案：种子快照日均 ≈ ¥1,284,640 → 钻石档
const m = await api.getMembership()
assert.equal(m.tier, 'diamond')
assert.equal(m.tierName, '钻石会员')
assert(m.evaluation && m.evaluation.coveredDays > 0)
assert.equal(m.evaluation.daysInMonth >= 28, true)
assert.equal(m.nextTierName, null)
assert.equal(m.benefits.cardFeeWaiversPerYear, 2)
assert.equal(m.benefits.cardFeeWaiversUsed, 0)
assert.equal(m.benefits.includeShipping, true)
assert.equal(m.benefits.fxFeeRate, 0.7)
assert(m.benefits.plannedPerks.length > 0)
// 旧月费套餐只读保留
assert(m.legacy && m.legacy.current && Array.isArray(m.legacy.plans) && m.legacy.plans.length > 0)
console.log('PASS 演示档案评定为钻石档，权益与旧套餐历史口径正确')

// memberLevel 与等级同源，不允许两处各写各的
assert.equal((await api.profile()).memberLevel, '钻石会员')
// 评定幂等：重复读取不产生第二条评定记录
const records = loadDb().membership.records.filter(r => r.label.includes('会员评级')).length
await api.getMembership(); await api.getMembership()
assert.equal(loadDb().membership.records.filter(r => r.label.includes('会员评级')).length, records)
console.log('PASS memberLevel 投影一致，月度评定幂等')

// 换汇点差按等级打折：钻石 0.7 折 → 有效点差 = 0.0035 × 0.7
const account = (await api.listAccounts())[0]
const quote = await api.quoteExchange({ fromAccountId: account.id, toCurrency: 'USD', amount: 10000 })
assert.equal(quote.fx.spread, FX_SPREAD * 0.7)
console.log('PASS 换汇报价按会员等级折算点差')

// 迁移幂等：老档案结构补默认后再次迁移不变化
const db = structuredClone(loadDb())
db.schema = 20
delete db.assetSnapshots
db.membership = { current: { planId: 'gold', planName: '招财金卡会员', status: 'active', price: 1900, period: '每月', startedAt: '2026-10-01T00:00:00.000Z', renewAt: null }, plans: [{ id: 'gold', name: '招财金卡会员', price: 1900, period: '每月', perks: [] }], records: [] }
const migrated = migrateProfile(db)
assert.equal(migrated.membership.tier, 'silver')
assert.equal(migrated.membership.legacy.current.planName, '招财金卡会员')
assert.equal(migrated.membership.legacy.current.status, 'active')
assert.deepEqual(migrated.assetSnapshots, [])
assert.deepEqual(migrateProfile(structuredClone(migrated)), migrated)
console.log('PASS 旧订阅档案幂等迁移：套餐收进 legacy，新字段补默认')

// 新客户：白银档、零权益额度、标准点差
const newSms = await api.sendSmsCode('13900139098')
const face = await api.verifyIdentity('face')
await api.register({ phone: '13900139098', password: 'safe123', paymentPassword: '888888', holderName: '新客测试', idNumber: '310101199001011234', smsCode: newSms.demoCode, faceTicket: face.ticket, pledge: ACCOUNT_OPENING_PLEDGE })
const fresh = await api.getMembership()
assert.equal(fresh.tier, 'silver')
assert.equal(fresh.tierName, '白银会员')
assert.equal(fresh.benefits.cardFeeWaiversPerYear, 0)
assert.equal(fresh.benefits.fxFeeRate, 1)
assert.equal(fresh.nextTierName, '黄金会员')
assert.equal((await api.profile()).memberLevel, '白银会员')
const freshAccount = (await api.listAccounts())[0]
await api.deposit(freshAccount.id, 50000, 'manual')
const freshQuote = await api.quoteExchange({ fromAccountId: freshAccount.id, toCurrency: 'USD', amount: 10000 })
assert.equal(freshQuote.fx.spread, FX_SPREAD)
console.log('PASS 新客户白银档：无减免、标准点差、memberLevel 同步')
