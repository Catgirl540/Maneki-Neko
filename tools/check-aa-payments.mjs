import { prepareExtendedBankOperation } from '../framework/bridge/extended-bank-tools.mjs'
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
  const row = await api.createSplitCollection({ title: '分项 AA', currency: 'CNY', confirmed: true, clientRequestId: 'aa-phone', members: [{ name: payer.user.name, phone: payer.user.phone, amount: 301, memo: '聚餐2元＋活动1.01元' }] })
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
  if (!await state.findProfileByPhone('13900000000')) {
    const third = structuredClone(payer)
    third.user = { ...third.user, id: 'fixture_third_payer', phone: '13900000000', name: '第三位测试客户' }
    third.accounts = [{ ...third.accounts[0], id: 'fixture_third_balance', accountNo: '8820000000129999' }]
    third.cards = []; third.cardSecrets = {}; third.transactions = []; third.aaPaymentRequests = []; third.splitCollections = []
    state.persistRelatedProfiles([third])
  }
  // 成员姓名必须与户名一致，所以按档案里的真实姓名来填。
  const second = await state.findProfileByPhone('13900000000')
  const pair = [{ name: payer.user.name, phone: '13600136000', amount: 100, memo: '两元AA测试' }, { name: second?.user.name ?? '第三位测试客户', phone: '13900000000', amount: 100, memo: '两元AA测试' }]
  const review = await prepareExtendedBankOperation('bank_create_split_collection', {
    title: '两位成员各一元', currency: 'CNY', members: target === 'server' ? pair : JSON.stringify(pair),
    // 参加者必须带手机号或账号：只写名字无法区分同名的人，也无法确定钱发给谁。
    allocation: { amount: 200, participants: [{ name: payer.user.name, phone: '13600136000' }, { name: second?.user.name ?? '第三位测试客户', phone: '13900000000' }] },
  }, { requestId: target + '-two-member-agent' })
  const beforePair = state.loadDb().accounts[0].balance
  const created = await api.createSplitCollection(review.body)
  assert.equal(created.delivery, 'account-inbox')
  assert.deepEqual(created.participants.map(row => row.phone), pair.map(row => row.phone))
  for (const member of pair) {
    state.activateDb(await state.findProfileByPhone(member.phone))
    const inbox = (await api.listSplitPaymentRequests()).find(row => row.collectionId === created.id)
    assert(inbox)
    assert.equal(inbox.amount, 100)
    assert.equal(inbox.memo, member.memo)
    const payerBeforePair = state.loadDb().accounts[0].balance
    const paidPair = await api.paySplitRequest(inbox.id, { version: inbox.version, confirmed: true, paymentPassword: '888888' })
    assert.equal(paidPair.status, 'paid')
    await api.paySplitRequest(inbox.id, { version: inbox.version, confirmed: true, paymentPassword: '888888' })
    assert.equal(state.loadDb().accounts[0].balance, payerBeforePair - 100)
    assert.equal((await api.getTransaction(paidPair.transactionId)).detail.remark, member.memo)
  }
  state.activateDb(await state.findProfileByPhone(owner.user.phone))
  assert.equal(state.loadDb().accounts[0].balance, beforePair + 200)
  const complete = (await api.listSplitCollections()).find(row => row.id === created.id)
  assert.equal(complete.status, 'complete')
  assert.equal(complete.participants.filter(row => row.status === 'paid').length, 2)
  console.log(`PASS ${target}: phone inbox → exact amount/memo → PIN transfer → balanced funds → no duplicate → both ledger remarks → reload → Agent two members × 1 yuan receive 2 yuan`)
}
