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
  const owner = state.loadDb(), payer = await state.findProfileByPhone('13600136000')
  const ownerBefore = owner.accounts[0].balance, payerBefore = payer.accounts[0].balance
  const row = await api.createSplitCollection({ title: '分项 AA', currency: 'CNY', confirmed: true, clientRequestId: 'aa-phone', members: [{ phone: payer.user.phone, amount: 301, memo: '聚餐2元＋活动1.01元' }] })
  assert.equal(row.participants[0].amount, 301); assert.equal(state.loadDb().accounts[0].balance, ownerBefore)
  state.activateDb(await state.findProfileByPhone(payer.user.phone))
  const [request] = await api.listSplitPaymentRequests()
  assert.equal(request.memo, '聚餐2元＋活动1.01元'); assert.equal(request.status, 'unpaid')
  const paid = await api.paySplitRequest(request.id, { version: request.version, confirmed: true, paymentPassword: '888888' })
  assert.equal(paid.status, 'paid')
  assert.equal(state.loadDb().accounts[0].balance, payerBefore - 301)
  const tx = await api.getTransaction(paid.transactionId)
  assert.equal(tx.detail.remark, request.memo); assert.equal(tx.memo, request.memo)
  await api.paySplitRequest(request.id, { version: request.version, confirmed: true, paymentPassword: '888888' })
  assert.equal(state.loadDb().accounts[0].balance, payerBefore - 301)
  state.activateDb(await state.findProfileByPhone(owner.user.phone))
  assert.equal(state.loadDb().accounts[0].balance, ownerBefore + 301)
  const [collection] = await api.listSplitCollections()
  assert.equal(collection.status, 'complete'); assert.equal(collection.participants[0].status, 'paid')
  assert(state.loadDb().transactions.some(tx => tx.direction === 'in' && tx.amount === 301 && tx.detail.remark === request.memo))
  state.persist()
  if (state.discardCache) state.discardCache()
  else state.activateDb(structuredClone(state.loadDb()))
  assert.equal((await api.listSplitCollections())[0].status, 'complete')
  console.log(`PASS ${target}: phone inbox → exact amount/memo → PIN transfer → balanced funds → no duplicate → both ledger remarks → reload`)
}
