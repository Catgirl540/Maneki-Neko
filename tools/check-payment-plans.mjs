/** Real domain and browser mock parity with isolated in-memory profiles; no database or external transaction. */
import assert from 'node:assert/strict'
await import('./ts-resolve-hook.mjs')
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
  const sender = state.loadDb(), before = sender.accounts[0].balance
  const recipient = await state.findProfileByPhone('13600136000'), recipientBefore = recipient.accounts[0].balance
  const request = { fromAccountId: sender.accounts[0].id, channel: 'bank', scope: 'domestic', payeeBankCode: 'LCB', payeeBankRegion: 'CN', payeeName: recipient.user.name, payeeAccountNo: recipient.accounts[0].accountNo,
    amount: 101, memo: '定时入账测试', executeAt: new Date(Date.now() + 120_000).toISOString(), paymentPassword: '888888', confirmed: true, clientRequestId: `${target}-one` }
  const schedule = await api.createScheduledTransfer(request)
  assert.equal(sender.accounts[0].balance, before); assert.equal(sender.accounts[0].available, before)
  sender.scheduledTransfers.find(row => row.id === schedule.id).executeAt = new Date(Date.now() - 1000).toISOString()
  state.persist()
  const settled = await domain.settleScheduledTransfers()
  assert.equal(settled[0].status, 'executed')
  assert.equal(sender.accounts[0].balance, before - 101)
  assert.equal((await state.findProfileByPhone('13600136000')).accounts[0].balance, recipientBefore + 101)
  assert.equal(sender.accounts.length, 1)
  assert.deepEqual(await domain.settleScheduledTransfers(), [])
  const transaction = await api.getTransaction(settled[0].transactionId)
  assert.equal(transaction.amount, 101); assert.equal(transaction.status, 'success')
  const saved = await api.listPayees('定时入账测试')
  assert(saved.some(row => row.name === recipient.user.name && row.accountNo === recipient.accounts[0].accountNo))
  const originalId = schedule.id
  if (state.discardCache) state.discardCache()
  else state.activateDb(structuredClone(state.loadDb()))
  assert.equal((await api.listScheduledTransfers())[0].transactionId, transaction.id)
  const created = await api.createScheduledTransfer({ ...request, clientRequestId: `${target}-two` })
  assert.notEqual(created.id, originalId)
  const report = await api.getBillingReport({ period: 'year', value: new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 4), currency: 'CNY' })
  assert(report.totalExpense >= 101); assert.equal(report.months.length, 12)
  console.log(`PASS ${target}: schedule → durable instruction → exact own debit/recipient credit → one execution → saved payee memo search → reload → unique IDs → annual report`)
}
