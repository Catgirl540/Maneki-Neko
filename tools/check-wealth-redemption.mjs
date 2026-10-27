/** Both maintained business APIs; temporary in-memory profiles only. */
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
const { createBankBusinessApi, RISK_ACKNOWLEDGEMENT } = await import('../server/domain/index.mjs')
const browserState = await import('../app/src/api/mock/db.ts')
const { createMockApi } = await import('../app/src/api/mock/index.ts')
for (const [name, state, factory] of [['server', serverState, createBankBusinessApi], ['browser', browserState, createMockApi]]) {
  state.resetDb()
  const db = state.loadDb(), api = factory(), account = db.accounts[0]
  db.wealthAccount.opened = true; db.wealthAccount.settlementAccountId = account.id
  db.riskAssessment = { done: true, expired: false, level: 'C5', assessedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString() }
  db.holdings = []
  state.persist()
  const subscribe = async code => {
    const item = await api.getWealthProduct(code)
    return api.subscribeWealth({ productCode: code, amount: Math.max(item.minAmount, 100000), paymentPassword: '888888', riskAcknowledgement: RISK_ACKNOWLEDGEMENT })
  }
  const old = await subscribe('LCB-EQUITY-300')
  const h = db.holdings.find(row => row.id === old.holding.id)
  h.lots[0].purchasedAt = new Date(Date.now() - 8 * 86400000).toISOString()
  await subscribe('LCB-EQUITY-300')
  assert.equal(h.lots.length, 2)
  const product = await api.getWealthProduct(h.productCode)
  const oldShares = h.lots[0].shares, youngHalf = h.lots[1].shares / 2
  const before = account.available
  const receipt = await api.redeemWealth({ holdingId: h.id, shares: oldShares + youngHalf })
  assert.equal(receipt.fees, Math.round(youngHalf * product.nav * 0.005))
  assert.equal(account.available, before + receipt.estimatedAmount)
  assert.equal(receipt.settlementMode, 'sandbox-immediate'); assert.equal(receipt.etaText, '演示资金已即时到账')
  assert.equal(h.lots.length, 1); assert.equal(h.shares, youngHalf)
  const rejectedBefore = account.available, sharesBefore = h.shares
  for (const shares of [NaN, Infinity, -1, 0]) await assert.rejects(api.redeemWealth({ holdingId: h.id, shares }), error => error.code === 'INVALID_SHARES')
  assert.equal(account.available, rejectedBefore); assert.equal(h.shares, sharesBefore)
  const fixed = await subscribe('LCB-FIXED-090')
  const closed = db.holdings.find(row => row.id === fixed.holding.id)
  closed.lots[0].redeemableAt = new Date(Date.now() - 1000).toISOString()
  await subscribe('LCB-FIXED-090')
  const derived = (await api.getWealthOverview()).holdings.find(row => row.id === closed.id)
  assert.equal(derived.closed, false); assert.equal(derived.redeemableShares, fixed.shares)
  await assert.rejects(api.redeemWealth({ holdingId: closed.id }), error => error.code === 'IN_CLOSED_PERIOD')
  await api.redeemWealth({ holdingId: closed.id, shares: fixed.shares })
  assert.equal((await api.getWealthOverview()).holdings.find(row => row.id === closed.id).closed, true)
  assert.equal(db.accounts.length, 1)
  const beforeInvalidHolding = { available: account.available, transactions: db.transactions.length, shares: h.shares }
  h.lots[0].shares += 1
  await assert.rejects(subscribe('LCB-EQUITY-300'), error => error.code === 'INVALID_HOLDING_DATA')
  assert.equal(account.available, beforeInvalidHolding.available); assert.equal(db.transactions.length, beforeInvalidHolding.transactions); assert.equal(h.shares, beforeInvalidHolding.shares)
  console.log(`PASS ${name}: actual subscription lots, mixed-age redemption fee, immediate receipt, invalid shares and independent closed periods`)
}
