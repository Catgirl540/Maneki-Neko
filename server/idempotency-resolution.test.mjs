import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { fixture, ok, login, transfer, account, reconcile, testOptions, routes } from './testing/http-fixture.mjs'

test('resolution seals absent keys or returns a committed result atomically, scoped to the customer', { ...testOptions, timeout: 120000 }, async t => {
  const app = await fixture({ reviewThreshold: 10000000 })
  t.after(() => app.close())
  const sender = await login(app, '13800138000')
  const recipient = await login(app, '13600136000')
  const makeRequest = () => ({ ...transfer(sender, recipient, 100, 'idempotency recovery'), paymentPassword: '888888' })
  const resolve = (key, token = sender.token) => app.call(`/api/idempotency/${key}/resolve`, { method: 'POST', token })
  const submit = (key, body) => app.call(routes.transfers(), { method: 'POST', token: sender.token, key, body })
  assert.equal((await app.call('/api/idempotency/capabilities')).status, 401)
  const capabilities = ok(await app.call('/api/idempotency/capabilities', { token: sender.token }))
  assert.equal(capabilities.version, 1)
  assert.equal(capabilities.atomicSeal, true)
  assert.equal(capabilities.ownerId, sender.user.id)

  const sealedKey = randomUUID()
  assert.deepEqual(ok(await resolve(sealedKey)), { status: 'sealed' })
  const rejected = await submit(sealedKey, makeRequest())
  assert.equal(rejected.status, 409)
  assert.equal(rejected.body.code, 'IDEMPOTENCY_SEALED')

  const completedKey = randomUUID()
  const completed = ok(await submit(completedKey, makeRequest()))
  const recovered = ok(await resolve(completedKey))
  assert.equal(recovered.status, 'completed')
  assert.equal(recovered.result.transactionId, completed.transactionId)
  assert.deepEqual(ok(await resolve(completedKey, recipient.token)), { status: 'sealed' }, 'another customer cannot read the result')
  await app.restart()
  assert.deepEqual(ok(await resolve(sealedKey)), { status: 'sealed' }, 'sealed keys survive restart')
  assert.equal(ok(await resolve(completedKey)).result.transactionId, completed.transactionId, 'completed results survive restart')

  const concurrentKey = randomUUID(), before = await account(app, sender)
  const [result, resolution] = await Promise.all([submit(concurrentKey, makeRequest()), resolve(concurrentKey)])
  const resolved = ok(resolution)
  const after = await account(app, sender)
  if (resolved.status === 'completed') {
    assert.equal(result.status, 200)
    assert.equal(resolved.result.transactionId, result.body.transactionId)
    assert.equal(after.balance, before.balance - 100)
  } else {
    assert.equal(resolved.status, 'sealed')
    assert.equal(result.status, 409)
    assert.equal(result.body.code, 'IDEMPOTENCY_SEALED')
    assert.equal(after.balance, before.balance)
  }

  // Simulate a mobile client losing the response while the server is working.
  // Resolution must serialize with the original request even if it arrives later.
  const lostKey = randomUUID(), lostBefore = await account(app, sender)
  await assert.rejects(fetch(app.base + routes.transfers(), {
    method: 'POST', signal: AbortSignal.timeout(20),
    headers: { 'content-type': 'application/json', authorization: `Bearer ${sender.token}`, 'idempotency-key': lostKey },
    body: JSON.stringify(makeRequest()),
  }))
  const lostResolution = ok(await resolve(lostKey))
  const lateRetry = await submit(lostKey, makeRequest())
  const lostAfter = await account(app, sender)
  if (lostResolution.status === 'completed') {
    assert.equal(lateRetry.status, 200)
    assert.equal(lateRetry.body.transactionId, lostResolution.result.transactionId)
    assert.equal(lostAfter.balance, lostBefore.balance - 100)
  } else {
    assert.equal(lostResolution.status, 'sealed')
    assert.equal(lateRetry.body.code, 'IDEMPOTENCY_SEALED')
    assert.equal(lostAfter.balance, lostBefore.balance)
  }
  await reconcile(app)
})
