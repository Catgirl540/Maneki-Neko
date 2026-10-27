/** Actual server and browser BankApi password/preview/hold parity; disposable in-memory profiles only. */
import assert from 'node:assert/strict'
class MemoryStorage {
  values = new Map()
  getItem(key) { return this.values.get(key) ?? null }
  setItem(key, value) { this.values.set(key, String(value)) }
  removeItem(key) { this.values.delete(key) }
  setItemsAtomically(entries) { for (const [key, value] of entries) this.setItem(key, value) }
}
for (const target of ['server', 'browser']) {
  globalThis.window = { localStorage: new MemoryStorage(), sessionStorage: new MemoryStorage() }
  const state = await import(target === 'server' ? '../server/domain/state.mjs' : '../app/src/api/mock/db.ts')
  const domain = await import(target === 'server' ? '../server/domain/index.mjs' : '../app/src/api/mock/index.ts')
  state.resetDb()
  const api = target === 'server' ? domain.createBankBusinessApi() : domain.createMockApi()
  const db = state.loadDb(), account = db.accounts[0], balance = account.balance, accountNo = account.accountNo
  account.available -= 50000
  state.persist()
  const baseline = account.available
  const request = { contactName: '已明确的生日联系人', relationship: '配偶', eventDate: new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10), amountCents: 100000, accountId: account.id, currency: 'CNY', requestId: target + '-birthday-request' }
  const preview = await api.previewBirthdayPlan(request)
  assert.equal(preview.amountCents, 100000)
  assert.equal((await api.listBirthdayPlans()).length, 0)
  assert.equal(account.available, baseline)
  await assert.rejects(api.createBirthdayPlan({ ...request, confirmed: false, paymentPassword: '888888' }), error => error.code === 'CONFIRMATION_REQUIRED')
  await assert.rejects(api.createBirthdayPlan({ ...request, confirmed: true, paymentPassword: '000000' }), error => error.code === 'BAD_PAY_PASSWORD')
  assert.equal(account.available, baseline)
  assert.equal((await api.listBirthdayPlans()).length, 0)
  const first = await api.createBirthdayPlan({ ...request, confirmed: true, paymentPassword: '888888' })
  assert.equal(first.reservation.status, 'held')
  assert.equal(account.available, baseline - 100000)
  assert.equal(account.balance, balance)
  assert.equal((await api.createBirthdayPlan({ ...request, confirmed: true, paymentPassword: '888888' })).id, first.id)
  assert.equal(account.available, baseline - 100000)
  if (state.discardCache) state.discardCache()
  else state.activateDb(structuredClone(state.loadDb()))
  assert.equal((await api.listBirthdayPlans())[0].reservation.status, 'held')
  assert.equal(state.loadDb().accounts[0].available, baseline - 100000)
  await assert.rejects(api.confirmBirthdayOrder(first.id, { confirmed: false }), error => error.code === 'CONFIRMATION_REQUIRED')
  const order = await api.confirmBirthdayOrder(first.id, { confirmed: true })
  assert.equal(order.order.status, 'awaiting_merchant_connection')
  assert.equal(order.order.merchantOrderId, null)
  assert.equal(state.loadDb().accounts[0].balance, balance)
  await assert.rejects(api.cancelBirthdayPlan(first.id, { confirmed: false }), error => error.code === 'CONFIRMATION_REQUIRED')
  await api.cancelBirthdayPlan(first.id, { confirmed: true })
  await api.cancelBirthdayPlan(first.id, { confirmed: true })
  assert.equal(state.loadDb().accounts[0].available, baseline)
  assert.equal(state.loadDb().accounts[0].balance - state.loadDb().accounts[0].available, 50000)
  assert.equal(state.loadDb().accounts.length, 1)
  assert.equal(state.loadDb().accounts[0].accountNo, accountNo)
  console.log(`PASS ${target}: read-only preview → explicit consent/payment password → one real hold → reload → separate order intent with no merchant order → confirmed idempotent release preserving other frozen funds`)
}
