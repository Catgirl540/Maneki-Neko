import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { fixture, ok, login, register, account, reconcile, testOptions, routes } from './testing/http-fixture.mjs'

test('merged AA allocation verifies computed phone amounts, preserves details across restart and cancels inbox requests', { ...testOptions, timeout: 120000 }, async t => {
  const app = await fixture()
  t.after(() => app.close())
  const owner = await register(app, '13900000073', '均分收款甲'), payer = await login(app, '13600136000'), other = await login(app, '13900000000')
  const allocation = { collectorName: owner.user.name, expenses: [
    { title: '聚餐', amount: 300, participants: [owner.user.name, payer.user.name, other.user.name] },
    { title: '活动', amount: 201, participants: [owner.user.name, payer.user.name] },
  ] }
  const input = { title: '均分清单', currency: 'CNY', confirmed: true, clientRequestId: randomUUID(), allocation, members: [
    { phone: payer.phone, amount: 200, memo: '聚餐和活动' }, { phone: other.phone, amount: 100, memo: '仅聚餐' },
  ] }
  const before = (await account(app, payer)).balance
  const bad = await app.call(routes.splitCollections(), { token: owner.token, method: 'POST', body: { ...input, members: [{ ...input.members[0], amount: 201 }, input.members[1]] } })
  assert.equal(bad.body.code, 'AA_ALLOCATION_MISMATCH')
  assert.deepEqual(ok(await app.call(routes.splitPaymentRequests(), { token: payer.token })), [])
  const created = ok(await app.call(routes.splitCollections(), { token: owner.token, method: 'POST', body: input }))
  assert.equal(created.selfAmount, 201); assert.equal(created.expenseTotal, 501)
  assert.deepEqual(created.participants.map(row => row.amount), [200, 100])
  await app.restart()
  const [stored] = ok(await app.call(routes.splitCollections(), { token: owner.token }))
  assert.deepEqual(stored.expenses, created.expenses)
  assert.equal(ok(await app.call(routes.splitPaymentRequests(), { token: payer.token }))[0].amount, 200)
  assert.equal((await account(app, payer)).balance, before)
  ok(await app.call(routes.splitCollection(stored.id), { token: owner.token, method: 'DELETE', body: { version: stored.version } }))
  assert.equal(ok(await app.call(routes.splitPaymentRequests(), { token: payer.token }))[0].status, 'cancelled')
  await reconcile(app)
})

test('AA phone notifications persist, isolate members, require PIN, preserve remarks and settle exactly once', { ...testOptions, timeout: 180000 }, async t => {
  const app = await fixture({ holdSeconds: 300 })
  t.after(() => app.close())
  const owner = await register(app, '13900000071', 'AA收款甲'), payer = await login(app, '13600136000'), stranger = await login(app, '13800138000')
  const beforeOwner = (await account(app, owner)).balance, beforePayer = (await account(app, payer)).balance
  const input = { title: '聚餐和后续活动', currency: 'CNY', confirmed: true, clientRequestId: randomUUID(), members: [{ phone: '13600136000', amount: 301, memo: '聚餐2元，后续活动1.01元' }] }
  const create = () => app.call(routes.splitCollections(), { token: owner.token, method: 'POST', body: input }).then(ok)
  const collection = await create(); assert.equal((await create()).id, collection.id)
  assert.equal((await account(app, owner)).balance, beforeOwner)
  assert.equal((await account(app, payer)).balance, beforePayer)
  assert.deepEqual(ok(await app.call(routes.splitPaymentRequests(), { token: stranger.token })), [])
  await app.restart()
  const list = token => app.call(routes.splitPaymentRequests(), { token }).then(ok)
  const [request] = await list(payer.token)
  assert.equal(request.amount, 301); assert.equal(request.memo, input.members[0].memo); assert.equal(request.collectorName, owner.user.name)
  assert.equal((await list(payer.token)).length, 1)
  const payment = { version: request.version, confirmed: true, paymentPassword: '888888' }
  assert.equal((await app.call(routes.splitPay(request.id), { token: stranger.token, method: 'POST', body: payment })).status, 404)
  const wrong = await app.call(routes.splitPay(request.id), { token: payer.token, method: 'POST', body: { ...payment, paymentPassword: '000000' } })
  assert.equal(wrong.body.code, 'BAD_PAY_PASSWORD')
  assert.equal((await account(app, payer)).balance, beforePayer)
  const results = await Promise.all([1, 2].map(() => app.call(routes.splitPay(request.id), { token: payer.token, method: 'POST', body: { ...payment, amount: 1, memo: '不得覆盖' } }).then(ok)))
  assert.equal(results[0].status, 'paid'); assert.equal(results[1].transactionId, results[0].transactionId)
  assert.equal((await account(app, payer)).balance, beforePayer - 301)
  assert.equal((await account(app, owner)).balance, beforeOwner + 301)
  const tx = ok(await app.call(routes.transaction(results[0].transactionId), { token: payer.token }))
  assert.equal(tx.amount, 301); assert.equal(tx.memo, input.members[0].memo); assert.equal(tx.detail.remark, input.members[0].memo)
  const [closed] = ok(await app.call(routes.splitCollections(), { token: owner.token }))
  assert.equal(closed.status, 'complete'); assert.equal(closed.participants[0].status, 'paid')
  await app.restart(); assert.equal((await list(payer.token))[0].status, 'paid')
  const dump = await app.database(async db => (await db.query('SELECT payload_cipher FROM customer_extension_state WHERE owner_id=$1', [payer.user.id])).rows)
  assert(!JSON.stringify(dump).includes('888888'))
  await reconcile(app)
})

test('AA cancellation reaches member inbox; large payments use existing held-transfer approvals and recall can be retried', { ...testOptions, timeout: 180000 }, async t => {
  const app = await fixture({ reviewThreshold: 1000, holdSeconds: 300 })
  t.after(() => app.close())
  const owner = await register(app, '13900000072', 'AA收款乙'), payer = await login(app, '13600136000')
  const create = async (amount, memo) => ok(await app.call(routes.splitCollections(), { token: owner.token, method: 'POST', body: { title: 'AA付款', currency: 'CNY', confirmed: true, clientRequestId: randomUUID(), members: [{ phone: '13600136000', amount, memo }] } }))
  const cancelled = await create(100, '取消测试')
  ok(await app.call(routes.splitCollection(cancelled.id), { token: owner.token, method: 'DELETE', body: { version: cancelled.version } }))
  let inbox = ok(await app.call(routes.splitPaymentRequests(), { token: payer.token }))
  const old = inbox.find(row => row.collectionId === cancelled.id)
  assert.equal(old.status, 'cancelled')
  assert.equal((await app.call(routes.splitPay(old.id), { token: payer.token, method: 'POST', body: { version: old.version, confirmed: true, paymentPassword: '888888' } })).body.code, 'SPLIT_CLOSED')
  const row = await create(1200, '大额AA备注')
  inbox = ok(await app.call(routes.splitPaymentRequests(), { token: payer.token }))
  const request = inbox.find(item => item.collectionId === row.id)
  const paid = ok(await app.call(routes.splitPay(request.id), { token: payer.token, method: 'POST', body: { version: request.version, confirmed: true, paymentPassword: '888888' } }))
  assert.equal(paid.status, 'processing'); assert.equal(paid.pendingReason, 'inflight')
  const approvals = await app.database(async db => (await db.query("SELECT biz_payload FROM approvals WHERE biz_type='transfer'")).rows)
  assert(approvals.some(item => JSON.stringify(item.biz_payload).includes(paid.transactionId)))
  assert.equal((await app.call(routes.splitCollection(row.id), { token: owner.token, method: 'DELETE', body: { version: 2 } })).body.code, 'AA_PAYMENT_PROCESSING')
  ok(await app.call(routes.transferRecall(paid.transactionId), { token: payer.token, method: 'POST', body: {} }))
  const retry = ok(await app.call(routes.splitPaymentRequests(), { token: payer.token })).find(item => item.id === request.id)
  assert.equal(retry.status, 'unpaid')
  assert(retry.version > request.version)
  await reconcile(app)
})
