import test from 'node:test'
import assert from 'node:assert/strict'
import { createAaPayments } from '../shared/aa-payments.mjs'

function fixture() {
  const profile = (id, phone) => ({ user: { id, phone, name: id }, accounts: [{ id: id + '-balance', accountNo: '882000000000000' + id.length, currency: 'CNY', balance: 100000, available: 100000 }], transactions: [] })
  const owner = profile('owner', '13800138000'), payer = profile('payer', '13600136000'), other = profile('stranger', '13900000000')
  const all = [owner, payer, other]; let current = owner, writes = 0, transfers = 0, seq = 0, pending = false
  const api = createAaPayments({ getDb: () => current, findProfileByPhone: async phone => all.find(row => row.user.phone === phone), findProfileByUserId: async id => all.find(row => row.user.id === id), nextId: prefix => prefix + ++seq,
    persistRelatedProfiles: () => { writes++ }, verifyPassword: password => { if (password !== '888888') throw Object.assign(Error('密码错误'), { code: 'BAD_PAY_PASSWORD' }) },
    executeTransfer: async req => {
      transfers++; const tx = { id: 'tx-' + transfers, direction: 'out', amount: req.amount, accountId: payer.accounts[0].id, status: pending ? 'pending' : 'success', memo: req.memo, createdAt: new Date().toISOString() }
      payer.transactions.push(tx)
      if (!pending) { payer.accounts[0].balance -= req.amount; owner.accounts[0].balance += req.amount }
      return { transactionId: tx.id }
    } })
  const input = { title: '聚餐', currency: 'CNY', confirmed: true, clientRequestId: 'aa1', members: [{ phone: payer.user.phone, amount: 20000, memo: '聚餐100元＋后续活动100元' }] }
  return { api, input, owner, payer, other, all, activate: profile => { current = profile }, setPending: () => { pending = true }, get writes() { return writes }, get transfers() { return transfers } }
}

test('AA phone request delivers exact amount/memo only to member; payment requires confirmation/PIN and cannot be duplicated or tampered', async () => {
  const f = fixture(), balances = f.all.map(p => structuredClone(p.accounts))
  const collection = await f.api.createCollection(f.input)
  assert.equal(collection.delivery, 'account-inbox'); assert.equal(f.transfers, 0)
  assert.deepEqual(f.all.map(p => p.accounts), balances)
  assert.equal((await f.api.createCollection(f.input)).id, collection.id)
  assert.equal(f.payer.aaPaymentRequests.length, 1)
  await assert.rejects(f.api.createCollection({ ...f.input, members: [{ ...f.input.members[0], memo: '改备注' }] }), { code: 'IDEMPOTENCY_CONFLICT' })
  f.activate(f.other); assert.deepEqual(await f.api.listRequests(), [])
  await assert.rejects(f.api.payRequest(f.payer.aaPaymentRequests[0].id, { confirmed: true }), { code: 'AA_REQUEST_NOT_FOUND' })
  f.activate(f.payer); const [request] = await f.api.listRequests()
  assert.equal(request.amount, 20000); assert.equal(request.memo, f.input.members[0].memo)
  await assert.rejects(f.api.payRequest(request.id, { version: 1, paymentPassword: '888888' }), { code: 'CONFIRMATION_REQUIRED' })
  await assert.rejects(f.api.payRequest(request.id, { version: 1, confirmed: true, paymentPassword: '000000' }), { code: 'BAD_PAY_PASSWORD' })
  assert.equal(f.transfers, 0)
  const result = await f.api.payRequest(request.id, { version: 1, confirmed: true, paymentPassword: '888888', amount: 1, memo: '伪造金额' })
  assert.equal(result.status, 'paid'); assert.equal(f.payer.transactions[0].amount, 20000); assert.equal(f.payer.transactions[0].memo, request.memo)
  assert.equal(f.owner.accounts[0].balance + f.payer.accounts[0].balance, 200000)
  await f.api.payRequest(request.id, { version: 1, confirmed: true, paymentPassword: '888888' })
  assert.equal(f.transfers, 1); assert.equal(f.owner.splitCollections[0].status, 'complete')
})

test('AA validates all members before delivery and cancellation withdraws only unpaid notifications', async () => {
  const f = fixture()
  for (const patch of [{ confirmed: false }, { members: [] }, { amount: 5 }, { members: [{ phone: '1', amount: 1, memo: 'a' }] }, { members: [{ ...f.input.members[0], memo: '' }] }, { members: [f.input.members[0], f.input.members[0]] }, { members: [f.input.members[0], { phone: '13700137000', amount: 1, memo: '未注册' }] }]) await assert.rejects(f.api.createCollection({ ...f.input, ...patch }))
  assert.equal(f.writes, 0); assert.equal(f.payer.aaPaymentRequests, undefined)
  const collection = await f.api.createCollection(f.input)
  await f.api.cancelCollection(f.owner.splitCollections[0])
  f.activate(f.payer); const [request] = await f.api.listRequests()
  assert.equal(request.status, 'cancelled')
  await assert.rejects(f.api.payRequest(request.id, { version: request.version, confirmed: true, paymentPassword: '888888' }), { code: 'SPLIT_CLOSED' })
  assert.equal(f.transfers, 0); assert.equal(collection.status, 'open')
})

test('AA pending transfer cannot be paid twice/cancelled and follows authoritative completion or recall', async () => {
  const f = fixture(); await f.api.createCollection(f.input); f.activate(f.payer); f.setPending()
  const [request] = await f.api.listRequests()
  assert.equal((await f.api.payRequest(request.id, { version: 1, confirmed: true, paymentPassword: '888888' })).status, 'processing')
  await f.api.payRequest(request.id, { version: 1, confirmed: true, paymentPassword: '888888' }); assert.equal(f.transfers, 1)
  f.activate(f.owner)
  await assert.rejects(f.api.cancelCollection(f.owner.splitCollections[0]), { code: 'AA_PAYMENT_PROCESSING' })
  f.payer.transactions[0].status = 'failed'
  await f.api.refreshCollection(f.owner.splitCollections[0]); assert.equal(f.owner.splitCollections[0].participants[0].status, 'unpaid')
  f.payer.transactions[0].status = 'success'
  f.activate(f.payer); assert.equal((await f.api.listRequests())[0].status, 'paid')
  assert.equal(f.owner.splitCollections[0].status, 'complete')
})


test('AA equal-split list binds computed shares to phone notifications and preserves activity/self breakdown', async () => {
  const f = fixture()
  const allocation = { collectorName: 'owner', expenses: [
    { title: '聚餐', amount: 300, participants: ['owner', 'payer', 'stranger'] },
    { title: '活动', amount: 201, participants: ['owner', 'payer'] },
  ] }
  const input = { ...f.input, allocation, members: [{ phone: f.payer.user.phone, amount: 200, memo: '聚餐100分＋活动100分' }, { phone: f.other.user.phone, amount: 100, memo: '仅聚餐' }] }
  await assert.rejects(f.api.createCollection({ ...input, members: [{ ...input.members[0], amount: 201 }, input.members[1]] }), { code: 'AA_ALLOCATION_MISMATCH' })
  await assert.rejects(f.api.createCollection({ ...input, members: input.members.slice(0, 1) }), { code: 'AA_ALLOCATION_MISMATCH' })
  assert.equal(f.writes, 0)
  const collection = await f.api.createCollection(input)
  assert.equal(collection.amount, 300); assert.equal(collection.selfAmount, 201); assert.equal(collection.expenseTotal, 501)
  assert.deepEqual(collection.participants.map(row => row.splitName), ['payer', 'stranger'])
  assert.deepEqual(collection.expenses[1].shares, [{ name: 'owner', amount: 101 }, { name: 'payer', amount: 100 }])
  assert.equal(f.payer.aaPaymentRequests[0].amount, 200); assert.equal(f.other.aaPaymentRequests[0].amount, 100)
  await assert.rejects(f.api.createCollection({ ...input, allocation: { ...allocation, expenses: allocation.expenses.map(row => ({ ...row, title: row.title + '修改' })) } }), { code: 'IDEMPOTENCY_CONFLICT' })
  const equal = await f.api.createCollection({ ...f.input, clientRequestId: 'equal', allocation: { amount: 101, participants: ['payer', 'stranger'] }, members: [{ phone: f.payer.user.phone, amount: 51, memo: '均分' }, { phone: f.other.user.phone, amount: 50, memo: '均分' }] })
  assert.deepEqual(equal.participants.map(row => row.amount), [51, 50])
})
