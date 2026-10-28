import test from 'node:test'
import assert from 'node:assert/strict'
import { fixture, ok, login, register, transfer, account, financialState, reconcile, testOptions, routes } from './testing/http-fixture.mjs'

test('foreign currency transfer holds release the exact partition, preserve other holds and settle atomically', { ...testOptions, timeout: 90000 }, async t => {
  const app = await fixture({ reviewThreshold: 1000, holdSeconds: 300 })
  t.after(() => app.close())
  // A low-AUM new customer keeps this a real fee-reservation test; seeded VIPs now have fee waivers.
  const owner = await register(app,'13900000031','TEST ONLY fee reservation'), other = await login(app, '13600136000')
  ok(await app.call(routes.deposit(owner.accounts[0].id),{method:'POST',token:owner.token,body:{amount:800000,channel:'bank'}}))
  const supervisor = await app.supervisorLogin()
  const exchange = { fromAccountId: owner.accounts[0].id, toCurrency: 'USD', amount: 250000 }
  const quote = ok(await app.call(routes.exchangeQuote(), { method: 'POST', token: owner.token, body: exchange }))
  ok(await app.call(routes.exchange(), { method: 'POST', token: owner.token, body: { ...exchange, quoteId: quote.quoteId, paymentPassword: '888888' } }))
  const funding = ok(await app.call(routes.accounts(), { token: owner.token }))[0], usd = funding.currencyBalances.find(row => row.currency === 'USD')
  assert(usd && usd.available >= 28000)
  const baseline = await account(app, owner, usd.id)
  const cnyHold = ok(await app.call(routes.transfers(), { method: 'POST', token: owner.token, body: transfer(owner, other, 2000, 'unrelated CNY hold') }))
  const cnyFrozen = await account(app, owner)
  const request = { fromAccountId: usd.id, channel: 'bank', scope: 'overseas', payeeBankCode: '004', payeeBankRegion: 'HK',
    payeeAccountNo: '6217000000000000123', payeeName: 'TEST ONLY USD recipient', payeeCurrency: 'USD', amount: 2000, memo: 'USD hold regression' }
  const hold = async () => {
    const value = ok(await app.call(routes.transfers(), { method: 'POST', token: owner.token, body: request }))
    assert.equal(value.pendingReason, 'inflight'); assert.equal(value.fee, 5000)
    const record = ok(await app.call(routes.transaction(value.transactionId), { token: owner.token }))
    assert.equal(record.accountId, usd.id); assert.equal(record.detail.settleCurrency, 'USD')
    assert.equal(record.heldFrozenAmount, value.amount + value.fee)
    return value
  }
  const decide = async (held, decision) => {
    const approvals = ok(await app.call('/staff-api/approvals', { token: supervisor }))
    const row = approvals.find(row => row.payload.transactionId === held.transactionId)
    assert(row)
    return app.call(`/staff-api/approvals/${row.approvalId}/decide`, { method: 'POST', token: supervisor,
      body: { decision, ...(decision === 'intercept' ? { reasonCode: '客户来电要求叫停' } : {}) } })
  }
  const cnyUnchanged = async () => {
    const current = await account(app, owner)
    assert.equal(current.balance, cnyFrozen.balance); assert.equal(current.available, cnyFrozen.available)
    assert.equal(ok(await app.call(routes.accounts(), { token: owner.token }))[0].currencyBalances.length, funding.currencyBalances.length)
    assert.equal(ok(await app.call(routes.transaction(cnyHold.transactionId), { token: owner.token })).pendingReason, 'inflight')
  }
  const first = await hold(), second = await hold(), frozenTotal = first.amount + first.fee
  await t.test('customer recall returns principal and fee only to USD, with cross-customer and replay rejection', async () => {
    const frozen = await financialState(app)
    assert.equal((await app.call(routes.transferRecall(first.transactionId), { method: 'POST', token: other.token, body: {} })).status, 404)
    assert.deepEqual(await financialState(app), frozen)
    ok(await app.call(routes.transferRecall(first.transactionId), { method: 'POST', token: owner.token, body: {} }))
    const current = await account(app, owner, usd.id)
    assert.equal(current.balance, baseline.balance)
    assert.equal(current.available, baseline.available - frozenTotal, 'only the second USD hold remains frozen')
    const record = ok(await app.call(routes.transaction(first.transactionId), { token: owner.token }))
    assert.equal(record.status, 'failed'); assert.equal(record.heldFrozenAmount, undefined)
    const recalled = await financialState(app)
    assert.equal((await app.call(routes.transferRecall(first.transactionId), { method: 'POST', token: owner.token, body: {} })).status, 409)
    assert.deepEqual(await financialState(app), recalled)
    await cnyUnchanged(); await reconcile(app)
  })
  await t.test('staff interception releases the remaining USD hold without changing the CNY reservation', async () => {
    assert.equal(ok(await decide(second, 'intercept')).status, 'intercepted')
    const current = await account(app, owner, usd.id)
    assert.equal(current.balance, baseline.balance); assert.equal(current.available, baseline.available)
    await cnyUnchanged(); await reconcile(app)
  })
  await t.test('staff settlement releases USD before charging principal and fee once under the original identity', async () => {
    const held = await hold()
    assert.equal(ok(await decide(held, 'settle')).status, 'settled')
    const current = await account(app, owner, usd.id)
    assert.equal(current.balance, baseline.balance - frozenTotal); assert.equal(current.available, baseline.available - frozenTotal)
    const record = ok(await app.call(routes.transaction(held.transactionId), { token: owner.token }))
    assert.equal(record.status, 'success'); assert.equal(record.detail.referenceNo, held.referenceNo)
    assert.equal(record.pendingReason, undefined)
    const settled = await financialState(app)
    assert.notEqual((await decide(held, 'settle')).status, 200)
    assert.deepEqual(await financialState(app), settled)
    await cnyUnchanged(); await reconcile(app)
  })
  await t.test('fee posting failure retains the exact USD reservation until a successful retry', async () => {
    const held = await hold(), frozen = await financialState(app)
    await app.database(db => db.exec(`CREATE FUNCTION reject_usd_hold_fee() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.counterparty='手续费' AND NOT EXISTS(SELECT 1 FROM bank_transactions WHERE id=NEW.id)
      THEN RAISE EXCEPTION 'TEST ONLY fee posting failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_usd_hold_fee BEFORE INSERT ON bank_transactions FOR EACH ROW EXECUTE FUNCTION reject_usd_hold_fee()`))
    try {
      assert.equal((await decide(held, 'settle')).status, 503)
      assert.deepEqual(await financialState(app), frozen)
      assert.equal(ok(await app.call(routes.transaction(held.transactionId), { token: owner.token })).pendingReason, 'inflight')
      await reconcile(app)
    } finally { await app.database(db => db.exec('DROP TRIGGER reject_usd_hold_fee ON bank_transactions; DROP FUNCTION reject_usd_hold_fee()')) }
    assert.equal(ok(await decide(held, 'settle')).status, 'settled')
    const current = await account(app, owner, usd.id)
    assert.equal(current.balance, baseline.balance - frozenTotal * 2); assert.equal(current.available, baseline.available - frozenTotal * 2)
    await cnyUnchanged(); await reconcile(app)
  })
})

test('internal foreign-currency transfer credits the pay currency into the recipient single funding account', { ...testOptions, timeout: 90000 }, async t => {
  const app = await fixture({ reviewThreshold: 100000 })
  t.after(() => app.close())
  // A low-AUM new customer keeps the sender side a real (non-VIP) fee case.
  const sender = await register(app, '13900000032', 'TEST ONLY fx sender')
  const recipient = await login(app, '13600136000')
  ok(await app.call(routes.deposit(sender.accounts[0].id), { method: 'POST', token: sender.token, body: { amount: 900000, channel: 'bank' } }))
  const exchange = { fromAccountId: sender.accounts[0].id, toCurrency: 'USD', amount: 300000 }
  const quote = ok(await app.call(routes.exchangeQuote(), { method: 'POST', token: sender.token, body: exchange }))
  ok(await app.call(routes.exchange(), { method: 'POST', token: sender.token, body: { ...exchange, quoteId: quote.quoteId, paymentPassword: '888888' } }))
  const funding = ok(await app.call(routes.accounts(), { token: sender.token }))[0]
  const usd = funding.currencyBalances.find(row => row.currency === 'USD')
  assert(usd, 'sender needs a USD partition')

  // The recipient only holds CNY: a USD transfer must open the partition, not fail.
  const before = ok(await app.call(routes.accounts(), { token: recipient.token }))[0]
  assert.equal(before.currencyBalances.some(row => row.currency === 'USD'), false)
  const body = { fromAccountId: usd.id, channel: 'bank', scope: 'domestic', payeeName: recipient.user.name,
    payeeAccountNo: recipient.accounts[0].accountNo, payeeBankCode: 'LCB', payeeBankRegion: 'CN', amount: 1200, memo: 'USD into a CNY-only customer' }
  const result = ok(await app.call(routes.transfers(), { method: 'POST', token: sender.token, body }))
  assert.equal(result.settlementStatus, 'success')
  assert.equal(result.fx, undefined, 'same currency must not quote an exchange')

  const after = ok(await app.call(routes.accounts(), { token: recipient.token }))
  assert.equal(after.length, 1, 'still exactly one funding account')
  assert.equal(after[0].accountNo, before.accountNo, 'customer-facing account number is unchanged')
  assert.equal(after[0].balance, before.balance, 'CNY partition is untouched')
  const usdRow = after[0].currencyBalances.find(row => row.currency === 'USD')
  assert(usdRow, 'USD partition is opened on the same funding account')
  assert.equal(usdRow.balance, 1200)
  assert.equal(usdRow.available, 1200)
  assert.equal(usdRow.accountNo, before.accountNo, 'partitions share the funding account number')

  // Repeating the transfer reuses the partition instead of opening a second one.
  ok(await app.call(routes.transfers(), { method: 'POST', token: sender.token, body: { ...body, amount: 800 } }))
  const again = ok(await app.call(routes.accounts(), { token: recipient.token }))
  assert.equal(again[0].currencyBalances.filter(row => row.currency === 'USD').length, 1)
  assert.equal(again[0].currencyBalances.find(row => row.currency === 'USD').balance, 2000)

  // Both sides list the flow under its own currency, and the incoming row belongs to the new partition.
  const incoming = ok(await app.call(`${routes.transactions(usdRow.id)}?size=10`, { token: recipient.token }))
  assert.equal(incoming.items[0].accountId, usdRow.id)
  assert.equal(incoming.items[0].currency, 'USD')
  assert.equal(incoming.items[0].amount, 800)
  const outgoing = ok(await app.call(`${routes.transactions(usd.id)}?size=10`, { token: sender.token }))
  assert.equal(outgoing.items[0].currency, 'USD')

  await reconcile(app)
})
