import test from 'node:test'
import assert from 'node:assert/strict'
import { fixture, ok, login, register, transfer, account, financialState, reconcile, testOptions, routes } from './testing/http-fixture.mjs'

// /api/transfers verifies the payment PIN in the same serialized unit of work as
// the transfer. A missing or wrong PIN must leave balances and history untouched,
// while the verified PIN is stripped before the request is snapshotted for the
// in-flight hold and the staff approval.
test('transfer requires the payment password and never persists a missing or verified-in-clear PIN', { ...testOptions, timeout: 120000 }, async t => {
  const app = await fixture({ reviewThreshold: 1000 })
  t.after(() => app.close())
  const owner = await register(app, '13900000051', 'TEST ONLY transfer PIN')
  const recipient = await login(app, '13600136000')
  ok(await app.call(routes.deposit(owner.accounts[0].id), { method: 'POST', token: owner.token, body: { amount: 100000, channel: 'bank' } }), 'fund the sender')

  const requirements = ok(await app.call('/api/agent/transfer/requirements', { token: owner.token }))
  assert.equal(requirements.transferPaymentPassword, true, 'clients may only submit when the server declares the PIN protection')

  const ownerBefore = await account(app, owner)
  const recipientBefore = await account(app, recipient)
  const financialBefore = await financialState(app)
  const request = transfer(owner, recipient, 500, 'PIN enforcement')
  delete request.paymentPassword
  const post = body => app.call(routes.transfers(), { method: 'POST', token: owner.token, body })

  const missing = await post(request)
  assert.equal(missing.status, 400)
  assert.equal(missing.body.code, 'INVALID_PAY_PASSWORD')
  assert.deepEqual(await account(app, owner), ownerBefore, 'a missing PIN must not move money')
  assert.deepEqual(await financialState(app), financialBefore, 'a missing PIN must not write transactions')

  const wrong = await post({ ...request, paymentPassword: '000000' })
  assert.equal(wrong.status, 401)
  assert.equal(wrong.body.code, 'BAD_PAY_PASSWORD')
  assert.deepEqual(await account(app, owner), ownerBefore, 'a wrong PIN must not move money')
  assert.deepEqual(await financialState(app), financialBefore, 'a wrong PIN must not write transactions')

  const settled = ok(await post({ ...request, paymentPassword: '888888' }), 'correct PIN transfer')
  assert.equal(settled.settlementStatus, 'success')
  assert.equal(settled.fee, 0)
  const ownerAfter = await account(app, owner)
  assert.equal(ownerAfter.balance, ownerBefore.balance - 500)
  assert.equal(ownerAfter.available, ownerBefore.available - 500)
  assert.equal((await account(app, recipient)).balance, recipientBefore.balance + 500)

  // A second transfer above the review threshold becomes an in-flight hold.
  const held = ok(await post({ ...transfer(owner, recipient, 2000, 'PIN held'), paymentPassword: '888888' }), 'held transfer')
  assert.equal(held.pendingReason, 'inflight')
  const heldAccount = await account(app, owner)
  assert.equal(heldAccount.balance, ownerAfter.balance, 'a hold freezes available funds, not the balance')
  assert.equal(heldAccount.available, ownerAfter.available - (held.amount + held.fee))

  let heldRequest
  await app.editCustomer(owner.user.id, profile => {
    const record = profile.transactions.find(row => row.id === held.transactionId)
    assert.ok(record, 'the held transaction must exist in storage')
    assert.equal(record.pendingReason, 'inflight')
    heldRequest = record.heldRequest
  })
  assert.ok(heldRequest, 'the held request snapshot must exist')
  assert.equal(Object.hasOwn(heldRequest, 'paymentPassword'), false, 'heldRequest must not contain the PIN')
  assert.equal(JSON.stringify(heldRequest).includes('paymentPassword'), false, 'heldRequest must not contain a PIN field at all')

  const supervisor = await app.supervisorLogin()
  const approvals = ok(await app.call('/staff-api/approvals', { token: supervisor }))
  const approval = approvals.find(row => row.payload?.transactionId === held.transactionId)
  assert.ok(approval, 'the staff approval for the held transfer must exist')
  assert.equal(Object.hasOwn(approval.payload.request, 'paymentPassword'), false, 'staff approval must not receive the PIN')
  assert.equal(JSON.stringify(approval).includes('paymentPassword'), false, 'staff approval must not receive a PIN field at all')

  ok(await app.call(routes.transferRecall(held.transactionId), { method: 'POST', token: owner.token, body: {} }), 'recall the held transfer')
  const recalled = await account(app, owner)
  assert.equal(recalled.balance, ownerAfter.balance)
  assert.equal(recalled.available, ownerAfter.available)
  await reconcile(app)
})

// Idempotency must not turn a retry into a second transfer, and the idempotency
// record must not keep a PIN-derived digest: a six-digit PIN hash is guessable.
test('an idempotent replay returns the original transfer without moving money twice or persisting the PIN', { ...testOptions, timeout: 120000 }, async t => {
  const app = await fixture({ reviewThreshold: 1000 })
  t.after(() => app.close())
  const owner = await register(app, '13900000053', 'TEST ONLY transfer replay')
  const recipient = await login(app, '13600136000')
  ok(await app.call(routes.deposit(owner.accounts[0].id), { method: 'POST', token: owner.token, body: { amount: 100000, channel: 'bank' } }), 'fund the sender')

  const key = 'transfer-pin-replay-0001'
  const request = transfer(owner, recipient, 500, 'PIN replay')
  const post = (body, idempotencyKey) => app.call(routes.transfers(), { method: 'POST', token: owner.token, body, key: idempotencyKey })

  const first = ok(await post(request, key), 'first attempt')
  const ownerAfterFirst = await account(app, owner)
  const recipientAfterFirst = await account(app, recipient)
  const financialAfterFirst = await financialState(app)

  const replay = ok(await post({ ...request }, key), 'replayed attempt')
  assert.deepEqual(replay, first, 'a replay must return the stored response')
  assert.deepEqual(await account(app, owner), ownerAfterFirst, 'a replay must not debit twice')
  assert.deepEqual(await account(app, recipient), recipientAfterFirst, 'a replay must not credit twice')
  assert.deepEqual(await financialState(app), financialAfterFirst, 'a replay must not write a second transaction, journal or idempotency row')

  const stored = await app.database(db => db.query('SELECT request_hash, response_json FROM bank_idempotency WHERE key=$1', [key]))
  assert.equal(stored.rows.length, 1)
  assert.equal(JSON.stringify(stored.rows[0]).includes('paymentPassword'), false, 'the idempotency record must not contain the PIN')

  // A held transfer must freeze once and create exactly one staff approval.
  const supervisor = await app.supervisorLogin()
  const approvalsBefore = ok(await app.call('/staff-api/approvals', { token: supervisor })).length
  const heldKey = 'transfer-pin-replay-held-0001'
  const held = ok(await post(transfer(owner, recipient, 2000, 'PIN replay hold'), heldKey), 'first held attempt')
  assert.equal(held.pendingReason, 'inflight')
  const heldAccount = await account(app, owner)
  const heldReplay = ok(await post(transfer(owner, recipient, 2000, 'PIN replay hold'), heldKey), 'replayed held attempt')
  assert.deepEqual(heldReplay, held, 'a replayed hold must return the original instruction')
  assert.deepEqual(await account(app, owner), heldAccount, 'a replayed hold must freeze available funds only once')
  const approvals = ok(await app.call('/staff-api/approvals', { token: supervisor }))
  assert.equal(approvals.length, approvalsBefore + 1, 'a replayed hold must not create a second approval')
  assert.equal(approvals.filter(row => row.payload?.transactionId === held.transactionId).length, 1)
  await reconcile(app)
})

// Older snapshots may still carry the PIN. The staff approval path re-reads the
// held instruction through the domain layer, which must strip the credential.
test('staff approval creation strips a PIN left in a legacy held request snapshot', { ...testOptions, timeout: 120000 }, async t => {
  const app = await fixture({ reviewThreshold: 1000 })
  t.after(() => app.close())
  const owner = await register(app, '13900000054', 'TEST ONLY legacy held PIN')
  const recipient = await login(app, '13600136000')
  ok(await app.call(routes.deposit(owner.accounts[0].id), { method: 'POST', token: owner.token, body: { amount: 100000, channel: 'bank' } }), 'fund the sender')

  const held = ok(await app.call(routes.transfers(), { method: 'POST', token: owner.token, body: transfer(owner, recipient, 2000, 'legacy held PIN') }), 'held transfer')
  assert.equal(held.pendingReason, 'inflight')
  await app.editCustomer(owner.user.id, profile => {
    const record = profile.transactions.find(row => row.id === held.transactionId)
    assert.ok(record?.heldRequest, 'the held snapshot must exist')
    record.heldRequest.paymentPassword = '888888'
  })
  // Drop the approval created by the hold so the staff endpoint must rebuild it
  // from the (legacy) held snapshot through getHeldTransfer.
  await app.database(db => db.exec('DELETE FROM approvals'))

  const supervisor = await app.supervisorLogin()
  const created = await app.call('/staff-api/approvals', {
    method: 'POST', token: supervisor,
    body: { customerId: owner.user.id, bizType: 'transfer', transferId: held.transactionId },
  })
  assert.equal(created.status, 201, `staff approval from held snapshot: ${created.status} ${created.body.code ?? ''}`)
  const approvals = ok(await app.call('/staff-api/approvals', { token: supervisor }))
  const approval = approvals.find(row => row.payload?.transactionId === held.transactionId)
  assert.ok(approval, 'the rebuilt approval must exist')
  assert.equal(Object.hasOwn(approval.payload.request, 'paymentPassword'), false, 'the rebuilt approval must not receive the PIN')
  assert.equal(JSON.stringify(approval).includes('paymentPassword'), false, 'the rebuilt approval must not contain a PIN field at all')
  const row = await app.database(db => db.query('SELECT biz_payload FROM approvals WHERE id=$1', [approval.approvalId]))
  assert.equal(row.rows.length, 1)
  assert.equal(row.rows[0].biz_payload.includes('paymentPassword'), false, 'the stored approval payload must not contain the PIN')
  await reconcile(app)
})

// The failure counter lives on the customer profile. Five wrong PINs freeze only
// that customer; another customer keeps its own counter and can still transfer.
test('five wrong transfer payment passwords freeze only that customer and block even the correct PIN', { ...testOptions, timeout: 120000 }, async t => {
  const app = await fixture({ reviewThreshold: 1000 })
  t.after(() => app.close())
  const owner = await register(app, '13900000052', 'TEST ONLY frozen transfer')
  const other = await login(app, '13600136000')
  const recipient = await login(app, '13800138000')
  ok(await app.call(routes.deposit(owner.accounts[0].id), { method: 'POST', token: owner.token, body: { amount: 100000, channel: 'bank' } }), 'fund the sender')

  const ownerBefore = await account(app, owner)
  const financialBefore = await financialState(app)
  const request = transfer(owner, other, 500, 'freeze after five wrong PINs')
  const post = paymentPassword => app.call(routes.transfers(), { method: 'POST', token: owner.token, body: { ...request, paymentPassword } })

  for (let attempt = 1; attempt <= 5; attempt++) {
    const result = await post('000000')
    assert.equal(result.status, attempt < 5 ? 401 : 423, `attempt ${attempt} status`)
    assert.equal(result.body.code, attempt < 5 ? 'BAD_PAY_PASSWORD' : 'ACCOUNT_FROZEN', `attempt ${attempt} code`)
  }

  const overview = ok(await app.call(routes.security(), { token: owner.token })).accountSecurity
  assert.equal(overview.failedAttempts, 5)
  assert.equal(overview.frozen, true)

  const correctWhileFrozen = await post('888888')
  assert.equal(correctWhileFrozen.status, 423)
  assert.equal(correctWhileFrozen.body.code, 'ACCOUNT_FROZEN', 'a frozen customer cannot verify even the correct PIN')
  assert.deepEqual(await account(app, owner), ownerBefore, 'failed attempts must not move money')
  assert.deepEqual(await financialState(app), financialBefore, 'failed attempts must not write transactions')

  const otherOverview = ok(await app.call(routes.security(), { token: other.token })).accountSecurity
  assert.equal(otherOverview.frozen, false, 'freezing one customer must not freeze another')
  assert.equal(otherOverview.failedAttempts, 0)
  const otherBefore = await account(app, other)
  const isolated = ok(await app.call(routes.transfers(), {
    method: 'POST', token: other.token, body: { ...transfer(other, recipient, 500, 'unfrozen peer'), paymentPassword: '888888' },
  }), 'another customer transfer')
  assert.equal(isolated.settlementStatus, 'success')
  assert.equal((await account(app, other)).balance, otherBefore.balance - 500)
  await reconcile(app)
})
