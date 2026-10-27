/** Both business implementations; only disposable in-memory profiles. */
import assert from 'node:assert/strict'
class MemoryStorage {
  values = new Map()
  getItem(key) { return this.values.get(key) ?? null }
  setItem(key, value) { this.values.set(key, String(value)) }
  removeItem(key) { this.values.delete(key) }
  setItemsAtomically(entries) { for (const [key, value] of entries) this.setItem(key, value) }
}
globalThis.window = { localStorage: new MemoryStorage(), sessionStorage: new MemoryStorage() }
const serverState = await import('../server/domain/state.mjs')
const { createBankBusinessApi } = await import('../server/domain/index.mjs')
const browserState = await import('../app/src/api/mock/db.ts')
const { createMockApi } = await import('../app/src/api/mock/index.ts')
const address = { recipient: '内存测试客户', phone: '13800138000', region: '上海市', city: '上海市', detail: '浦东新区测试路 100 号', postalCode: '200120' }
for (const [name, state, factory] of [['server', serverState, createBankBusinessApi], ['browser', browserState, createMockApi]]) {
  state.resetDb()
  const api = factory()
  const product = (await api.listCardProducts()).find(row => !row.held)
  const card = await api.openCard({ productCode: product.code, address, paymentPassword: '888888' })
  const db = state.loadDb(), before = db.accounts[0].available, accountNo = db.accounts[0].accountNo
  const reject = (promise, code) => assert.rejects(promise, error => error.code === code)
  const spend = () => api.spendOnCard(card.id, { platform: 'meituan', amount: 100 })
  assert.equal(card.status, 'pending')
  await reject(api.activateCard(card.id, '000000'), 'BAD_PAY_PASSWORD')
  for (const locked of [false, true, false]) await reject(api.setCardLock(card.id, locked), 'CARD_NOT_DELIVERED')
  await reject(api.setCardLock(card.id, 'false'), 'INVALID_CARD_LOCK')
  await reject(api.updateCardSettings(card.id, { onlinePayment: true }), 'CARD_NOT_DELIVERED')
  await reject(spend(), 'CARD_NOT_DELIVERED')
  assert.equal(db.accounts[0].available, before)
  assert.equal(card.status, 'pending')
  await reject(api.reportCardLost(card.id, '000000'), 'BAD_PAY_PASSWORD')
  assert.equal((await api.reportCardLost(card.id, '888888')).status, 'lost')
  assert.equal(card.lostFromStatus, 'pending')
  for (const locked of [true, false]) await reject(api.setCardLock(card.id, locked), 'CARD_LOST')
  await reject(api.activateCard(card.id, '888888'), 'CARD_LOST')
  await reject(api.updateCardSettings(card.id, { onlinePayment: true }), 'CARD_LOST')
  await reject(api.revealCardSecrets(card.id, '888888'), 'CARD_LOST')
  await reject(spend(), 'CARD_LOST')
  await reject(api.openCard({ productCode: product.code, address, paymentPassword: '888888' }), 'CARD_NETWORK_LIMIT')
  await reject(api.recoverCard(card.id, '000000'), 'BAD_PAY_PASSWORD')
  assert.equal((await api.recoverCard(card.id, '888888')).status, 'pending')
  await reject(spend(), 'CARD_NOT_DELIVERED')
  await api.activateCard(card.id, '888888')
  assert.equal(card.onlinePayment, false)
  await api.updateCardSettings(card.id, { onlinePayment: true, overseasPayment: true })
  await api.setCardLock(card.id, true)
  const lockedBefore = { balance: db.accounts[0].balance, available: db.accounts[0].available, transactions: db.transactions.length }
  await api.updateCardSettings(card.id, { dailyLimit: 500000, onlinePayment: false, overseasPayment: false, paymentEnabled: false,
    channelLimits: { online: 500000, offline: 200000, overseas: 100000 }, merchantLimits: { dining: 200000, shopping: 200000, other: 100000 } })
  assert.equal(card.status, 'locked'); assert.equal(card.dailyLimit, 500000); assert.equal(card.paymentEnabled, false)
  const safeSettings = structuredClone(card)
  for (const key of ['onlinePayment', 'overseasPayment', 'paymentEnabled']) {
    await reject(api.updateCardSettings(card.id, { [key]: true, dailyLimit: 1000000 }), 'CARD_LOCKED')
    assert.deepEqual(card, safeSettings, 'rejected enable must not partially apply limits or switches')
  }
  assert.deepEqual({ balance: db.accounts[0].balance, available: db.accounts[0].available, transactions: db.transactions.length }, lockedBefore)
  await reject(spend(), 'CARD_LOCKED')
  await api.reportCardLost(card.id, '888888')
  assert.equal((await api.recoverCard(card.id, '888888')).status, 'locked')
  await api.setCardLock(card.id, false)
  assert.equal(card.onlinePayment, false); assert.equal(card.overseasPayment, false)
  await reject(api.updateCardSettings(card.id, { status: 'active' }), 'INVALID_CARD_SETTINGS')
  await api.updateCardSettings(card.id, { onlinePayment: true, paymentEnabled: true })
  await spend()
  assert.equal(db.accounts[0].available, before - 100)
  await api.reportCardLost(card.id, '888888')
  const fresh = await api.replaceCard(card.id, { address, paymentPassword: '888888' })
  assert.equal(card.status, 'replaced'); assert.equal(fresh.status, 'pending'); assert.equal(fresh.lostFromStatus, null)
  await reject(api.recoverCard(card.id, '888888'), 'CARD_NOT_LOST')
  await reject(api.setCardLock(card.id, false), 'CARD_REPLACED')
  await reject(api.setCardLock(fresh.id, false), 'CARD_NOT_DELIVERED')
  assert.equal(db.accounts.length, 1); assert.equal(db.accounts[0].accountNo, accountNo); assert.equal(fresh.accountId, card.accountId)
  console.log(`PASS ${name}: applied pending card cannot bypass activation; typed locks, formal loss/recovery, payment settings, spend and replacement preserve account and state`)
}
