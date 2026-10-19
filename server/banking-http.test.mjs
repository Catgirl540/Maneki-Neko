import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { ACCOUNT_OPENING_PLEDGE } from './lib/account-opening.mjs'
import { fixture, ok, login, register, transfer, account, reconcile, financialState, testOptions, routes } from './testing/http-fixture.mjs'

test('bank HTTP transactions and security preserve customer funds and balanced accounting', { ...testOptions, timeout: 180000 }, async t => {
  const app = await fixture()
  t.after(() => app.close())
  const sender = await login(app, '13800138000')
  const recipient = await login(app, '13600136000')
  const limited = await register(app, '13900139001', '集成测试客户')
  assert.equal(ok(await app.call('/health')).database, 'postgresql')
  await reconcile(app)

  await t.test('authentication and ownership isolate account and transaction access', async () => {
    assert.equal((await app.call('/api/accounts')).status, 401)
    assert.equal((await app.call('/api/accounts', { token: 'forged' })).status, 401)
    assert.equal((await app.call(`/api/accounts/${sender.accounts[0].id}`, { token: recipient.token })).status, 404)
    assert.equal((await app.call(`/api/accounts/${sender.accounts[0].id}/transactions`, { token: recipient.token })).status, 404)
    const previous = await financialState(app)
    const attempt = await app.call('/api/transfers', { method: 'POST', token: recipient.token, body: transfer(sender, limited, 100) })
    assert.equal(attempt.status, 404)
    assert.deepEqual(await financialState(app), previous)
    await reconcile(app)
  })

  await t.test('cross-customer internal transfer conserves funds and posts both histories', async () => {
    const before = await Promise.all([account(app, sender), account(app, recipient)])
    const result = ok(await app.call('/api/transfers', { method: 'POST', token: sender.token, body: transfer(sender, recipient, 137) }))
    assert.equal(result.settlementStatus, 'success')
    const after = await Promise.all([account(app, sender), account(app, recipient)])
    assert.equal(after[0].balance, before[0].balance - 137)
    assert.equal(after[1].balance, before[1].balance + 137)
    assert.equal(after[0].balance + after[1].balance, before[0].balance + before[1].balance)
    const rows = ok(await app.call(`/api/accounts/${recipient.accounts[0].id}/transactions?size=100`, { token: recipient.token }))
    assert(rows.items.some(row => row.amount === 137 && row.direction === 'in'))
    assert.equal((await app.call(`/api/transactions/${result.transactionId}`, { token: recipient.token })).status, 404)
    await reconcile(app)
  })

  await t.test('idempotent retries return the original response and conflicting reuse is rejected', async () => {
    const before = await Promise.all([account(app, sender), account(app, recipient)])
    const body = transfer(sender, recipient, 211, 'idempotent transfer'), key = `http-${randomUUID()}`
    const first = await app.call('/api/transfers', { method: 'POST', token: sender.token, body, key })
    ok(first)
    const repeated = await app.call('/api/transfers', { method: 'POST', token: sender.token, body: { memo: body.memo, ...body }, key })
    assert.deepEqual(repeated, first)
    const conflict = await app.call('/api/transfers', { method: 'POST', token: sender.token, body: { ...body, amount: 212 }, key })
    assert.equal(conflict.status, 409)
    assert.equal(conflict.body.code, 'IDEMPOTENCY_CONFLICT')
    const after = await Promise.all([account(app, sender), account(app, recipient)])
    assert.equal(after[0].balance, before[0].balance - 211)
    assert.equal(after[1].balance, before[1].balance + 211)
    await reconcile(app)
  })

  await t.test('concurrent debit requests cannot overdraw a newly funded account', async () => {
    ok(await app.call('/api/transfers', { method: 'POST', token: sender.token, body: transfer(sender, limited, 500) }))
    const before = await account(app, recipient)
    const results = await Promise.all(Array.from({ length: 6 }, (_, index) => app.call('/api/transfers', {
      method: 'POST', token: limited.token, body: transfer(limited, recipient, 200, `concurrent ${index}`),
    })))
    assert.equal(results.filter(result => result.status === 200).length, 2)
    assert.equal(results.filter(result => result.status === 400 && result.body.code === 'INSUFFICIENT_FUNDS').length, 4)
    const remaining = await account(app, limited)
    assert.equal(remaining.balance, 100)
    assert.equal(remaining.available, 100)
    assert.equal((await account(app, recipient)).balance, before.balance + 400)
    await reconcile(app)
  })

  await t.test('invalid amounts and mismatched recipients cannot change balances or journals', async () => {
    const before = await financialState(app)
    for (const amount of [0, -1, 0.5, '100', null, Number.MAX_SAFE_INTEGER + 1]) {
      const result = await app.call('/api/transfers', { method: 'POST', token: sender.token, body: transfer(sender, recipient, amount) })
      assert.equal(result.status, 400)
      assert.equal(result.body.code, 'INVALID_AMOUNT')
    }
    const mismatch = await app.call('/api/transfers', { method: 'POST', token: sender.token,
      body: { ...transfer(sender, recipient, 100), payeeName: '不匹配的户名' } })
    assert.equal(mismatch.status, 400)
    assert.deepEqual(await financialState(app), before)
    await reconcile(app)
  })

  await t.test('card settings reject mass assignment without altering the card', async () => {
    const cards = ok(await app.call('/api/cards', { token: sender.token }))
    const card = cards.find(row => row.status === 'active')
    assert(card)
    const result = await app.call(`/api/cards/${card.id}/settings`, { method: 'PATCH', token: sender.token,
      body: { onlinePayment: false, accountId: recipient.accounts[0].id, status: 'replaced' } })
    assert.equal(result.status, 400)
    assert.equal(result.body.code, 'INVALID_CARD_SETTINGS')
    assert.deepEqual(ok(await app.call('/api/cards', { token: sender.token })), cards)
    await reconcile(app)
  })

  await t.test('consumed SMS codes and forged identity tickets cannot be reused', async () => {
    const reused = await app.call('/api/auth/login', { method: 'POST', body: sender.loginBody })
    assert.equal(reused.status, 400)
    assert.equal(reused.body.code, 'SMS_NOT_SENT')
    const before = await financialState(app)
    const forged = await app.call('/api/auth/register', { method: 'POST', body: {
      phone: '13900139002', password: '123456', paymentPassword: '888888', holderName: '伪造核验测试', smsCode: '000000',
      faceTicket: 'verify.face.1234567890', idNumber: '330106199203047234', pledge: ACCOUNT_OPENING_PLEDGE,
    } })
    assert.equal(forged.status, 403)
    assert.equal(forged.body.code, 'IDENTITY_REQUIRED')
    assert.deepEqual(await financialState(app), before)
    await reconcile(app)
  })

  await t.test('five wrong SMS attempts persist across business rollbacks and lock the challenge', async () => {
    const newPhone = '13900139003'
    const sms = ok(await app.call('/api/auth/sms-code', { method: 'POST', token: limited.token, body: { phone: newPhone } }))
    const face = ok(await app.call('/api/security/verify', { method: 'POST', token: limited.token, body: { channel: 'face' } }))
    const wrong = sms.demoCode === '000000' ? '000001' : '000000'
    for (let i = 0; i < 5; i++) {
      const result = await app.call('/api/auth/phone', { method: 'PATCH', token: limited.token,
        body: { newPhone, smsCode: wrong, faceTicket: face.ticket } })
      assert.equal(result.status, 400)
      assert.equal(result.body.code, 'BAD_SMS_CODE')
    }
    const locked = await app.call('/api/auth/phone', { method: 'PATCH', token: limited.token,
      body: { newPhone, smsCode: sms.demoCode, faceTicket: face.ticket } })
    assert.equal(locked.status, 429)
    assert.equal(locked.body.code, 'SMS_LOCKED')
    assert.equal(ok(await app.call('/api/auth/profile', { token: limited.token })).phone, limited.phone)
    const cooldown = await app.call('/api/auth/sms-code', { method: 'POST', token: limited.token, body: { phone: newPhone } })
    assert.equal(cooldown.status, 429)
    assert.equal(cooldown.body.code, 'SMS_TOO_FREQUENT')
    await reconcile(app)
  })

  await t.test('database failure rolls back both customers, histories, idempotency and journal entries', async () => {
    const before = await financialState(app), marker = `fault-${randomUUID()}`
    await app.database(db => db.exec(`CREATE FUNCTION http_test_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.memo='${marker}' THEN RAISE EXCEPTION 'injected failure'; END IF; RETURN NEW; END; $$; CREATE TRIGGER http_test_fault BEFORE INSERT ON bank_transactions FOR EACH ROW EXECUTE FUNCTION http_test_fault();`))
    try {
      const result = await app.call('/api/transfers', { method: 'POST', token: sender.token,
        body: transfer(sender, recipient, 123, marker), key: `failure-${randomUUID()}` })
      assert.equal(result.status, 500)
      assert.deepEqual(await financialState(app), before)
      await reconcile(app)
    } finally { await app.database(db => db.exec('DROP TRIGGER IF EXISTS http_test_fault ON bank_transactions; DROP FUNCTION IF EXISTS http_test_fault()')) }
    ok(await app.call('/api/transfers', { method: 'POST', token: sender.token, body: transfer(sender, recipient, 1, 'recovered request') }))
    await reconcile(app)
  })

  await t.test('failed staff interception preserves a pending approval and reservation until a successful retry', async () => {
    const supervisor = await app.supervisorLogin()
    const before = await Promise.all([account(app, sender), account(app, recipient)])
    const held = ok(await app.call('/api/transfers', { method: 'POST', token: sender.token,
      body: transfer(sender, recipient, 1300, 'staff interception rollback') }))
    assert.equal(held.pendingReason, 'inflight')
    const approvals = ok(await app.call('/staff-api/approvals', { token: supervisor }))
    const approval = approvals.find(row => row.payload.transactionId === held.transactionId)
    assert(approval)
    const frozen = await financialState(app)
    const decision = { decision: 'intercept', reasonCode: '客户来电要求叫停' }
    await app.database(db => db.exec(`CREATE FUNCTION http_test_intercept_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.id='${held.transactionId}' AND NEW.status='failed' THEN RAISE EXCEPTION 'injected interception failure'; END IF; RETURN NEW; END; $$; CREATE TRIGGER http_test_intercept_fault BEFORE UPDATE OF status ON bank_transactions FOR EACH ROW EXECUTE FUNCTION http_test_intercept_fault();`))
    try {
      const rejected = await app.call(`/staff-api/approvals/${approval.approvalId}/decide`, {
        method: 'POST', token: supervisor, body: decision,
      })
      assert.equal(rejected.status, 503)
      const pending = ok(await app.call(`/staff-api/approvals/${approval.approvalId}`, { token: supervisor }))
      assert.equal(pending.status, 'pending')
      assert.equal(pending.executionStatus, 'pending')
      assert(pending.executionError)
      assert.deepEqual(await financialState(app), frozen)
      const transaction = ok(await app.call(`/api/transactions/${held.transactionId}`, { token: sender.token }))
      assert.equal(transaction.status, 'pending')
      assert.equal(transaction.pendingReason, 'inflight')
      await reconcile(app)
    } finally { await app.database(db => db.exec('DROP TRIGGER IF EXISTS http_test_intercept_fault ON bank_transactions; DROP FUNCTION IF EXISTS http_test_intercept_fault()')) }
    const intercepted = ok(await app.call(`/staff-api/approvals/${approval.approvalId}/decide`, {
      method: 'POST', token: supervisor, body: decision,
    }))
    assert.equal(intercepted.status, 'intercepted')
    assert.equal(intercepted.decidedBy, 'staff_li')
    const audit = await app.database(db => db.prepare("SELECT actor_type,actor_id FROM audit_logs WHERE target_id=? AND action='approval.intercepted' ORDER BY created_at DESC,id DESC LIMIT 1").get(approval.approvalId))
    assert.equal(audit.actor_type, 'staff')
    assert.equal(audit.actor_id, 'staff_li')
    const after = await Promise.all([account(app, sender), account(app, recipient)])
    for (let i = 0; i < 2; i++) {
      assert.equal(after[i].balance, before[i].balance)
      assert.equal(after[i].available, before[i].available)
    }
    await reconcile(app)
  })

  await t.test('pending internal transfer freezes funds then settles once with the original transaction identity', async () => {
    const before = await Promise.all([account(app, sender), account(app, recipient)])
    const result = ok(await app.call('/api/transfers', { method: 'POST', token: sender.token,
      body: transfer(sender, recipient, 1500, 'automatic hold settlement') }))
    assert.equal(result.pendingReason, 'inflight')
    const frozen = await Promise.all([account(app, sender), account(app, recipient)])
    assert.equal(frozen[0].balance, before[0].balance)
    assert.equal(frozen[0].available, before[0].available - 1500)
    assert.equal(frozen[1].balance, before[1].balance)
    await reconcile(app)
    let record
    for (let i = 0; i < 80; i++) {
      record = ok(await app.call(`/api/transactions/${result.transactionId}`, { token: sender.token }))
      if (record.status !== 'pending') break
      await delay(200)
    }
    assert.equal(record.status, 'success')
    assert.equal(record.id, result.transactionId)
    assert.equal(record.detail.referenceNo, result.referenceNo)
    const settled = await Promise.all([account(app, sender), account(app, recipient)])
    assert.equal(settled[0].balance, before[0].balance - 1500)
    assert.equal(settled[0].available, before[0].available - 1500)
    assert.equal(settled[1].balance, before[1].balance + 1500)
    await reconcile(app)
  })

  await t.test('recall releases the reservation without moving money and cannot be executed twice', async () => {
    const before = await Promise.all([account(app, sender), account(app, recipient)])
    const result = ok(await app.call('/api/transfers', { method: 'POST', token: sender.token,
      body: transfer(sender, recipient, 1200, 'customer recall') }))
    assert.equal(result.pendingReason, 'inflight')
    ok(await app.call(`/api/transfers/${result.transactionId}/recall`, { method: 'POST', token: sender.token, body: {} }))
    assert.equal((await app.call(`/api/transfers/${result.transactionId}/recall`, { method: 'POST', token: sender.token, body: {} })).status, 409)
    const after = await Promise.all([account(app, sender), account(app, recipient)])
    for (let i = 0; i < 2; i++) {
      assert.equal(after[i].balance, before[i].balance)
      assert.equal(after[i].available, before[i].available)
    }
    const record = ok(await app.call(`/api/transactions/${result.transactionId}`, { token: sender.token }))
    assert.equal(record.status, 'failed')
    assert.equal(record.pendingReason, undefined)
    await delay(5200)
    assert.equal((await account(app, sender)).balance, before[0].balance)
    assert.equal((await account(app, sender)).available, before[0].available)
    assert.equal((await account(app, recipient)).balance, before[1].balance)
    assert.equal(ok(await app.call(`/api/transactions/${result.transactionId}`, { token: sender.token })).status, 'failed')
    await reconcile(app)
  })

  await t.test('large transfer to a nonexistent internal recipient cannot freeze funds or create an approval', async () => {
    const before = await financialState(app)
    const approvalCount = await app.database(async db => (await db.prepare('SELECT COUNT(*) AS n FROM approvals').get()).n)
    const rejected = await app.call('/api/transfers', { method: 'POST', token: sender.token,
      body: { ...transfer(sender, recipient, 1600, 'nonexistent large recipient'), payeeAccountNo: '8820009999999999999' } })
    assert.equal(rejected.status, 404)
    assert.equal(rejected.body.code, 'RECIPIENT_NOT_FOUND')
    assert.deepEqual(await financialState(app), before)
    assert.equal(await app.database(async db => (await db.prepare('SELECT COUNT(*) AS n FROM approvals').get()).n), approvalCount)
    await reconcile(app)
  })

  await t.test('recipient rename during a hold fails settlement, releases funds and rejects the approval atomically', async () => {
    const supervisor = await app.supervisorLogin()
    const before = await Promise.all([account(app, sender), account(app, recipient)])
    const journalBefore = await app.database(async db => (await db.prepare('SELECT COUNT(*) AS n FROM journal_entries').get()).n)
    const held = ok(await app.call('/api/transfers', { method: 'POST', token: sender.token,
      body: transfer(sender, recipient, 1800, 'recipient changed during hold') }))
    assert.equal(held.pendingReason, 'inflight')
    assert.equal((await account(app, sender)).available, before[0].available - 1800)
    try {
      await app.renameCustomer(recipient.user.id, '集成测试更名收款人')
      const approvals = ok(await app.call('/staff-api/approvals', { token: supervisor }))
      const approval = approvals.find(row => row.payload.transactionId === held.transactionId)
      assert(approval)
      let record
      for (let i = 0; i < 80; i++) {
        record = ok(await app.call(`/api/transactions/${held.transactionId}`, { token: sender.token }))
        if (record.status !== 'pending') break
        await delay(200)
      }
      assert.equal(record.status, 'failed')
      assert.equal(record.pendingReason, undefined)
      const rejected = ok(await app.call(`/staff-api/approvals/${approval.approvalId}`, { token: supervisor }))
      assert.equal(rejected.status, 'rejected')
      assert.equal(rejected.executionStatus, 'failed')
      assert(rejected.executionError)
      assert(rejected.decidedAt)
      const after = await Promise.all([account(app, sender), account(app, recipient)])
      for (let i = 0; i < 2; i++) {
        assert.equal(after[i].balance, before[i].balance)
        assert.equal(after[i].available, before[i].available)
      }
      assert.equal(await app.database(async db => (await db.prepare('SELECT COUNT(*) AS n FROM journal_entries').get()).n), journalBefore)
      await reconcile(app)
    } finally { await app.renameCustomer(recipient.user.id, recipient.user.name) }
  })

  await t.test('all persisted batches balance per currency and account balances are reconstructible', async () => {
    await reconcile(app)
    await app.database(async db => {
      assert((await db.prepare('SELECT COUNT(*) AS n FROM journal_batches').get()).n > 0)
      assert((await db.prepare("SELECT COUNT(*) AS n FROM journal_batches WHERE kind='balance-change'").get()).n > 0)
      assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM journal_batches WHERE state<>'posted'").get()).n, 0)
    })
  })
})

test('single funding HTTP migration, currency transfers and fees remain atomic and idempotent', { ...testOptions, timeout: 90000 }, async t => {
  const app = await fixture({ reviewThreshold: 100000 })
  t.after(() => app.close())
  const sender = await login(app, '13800138000'), recipient = await login(app, '13600136000')
  const legacyId = 'test_legacy_cny', legacyNo = '8820999988880001'
  await t.test('retired IDs accept writes and retired account numbers resolve to the same funding account', async () => {
    const before = await account(app, sender)
    await app.editCustomer(sender.user.id, profile => {
      profile.schema = 18
      profile.accounts.push({ ...profile.accounts[0], id: legacyId, accountNo: legacyNo, balance: 3000, available: 2500 })
    })
    const accounts = ok(await app.call('/api/accounts', { token: sender.token }))
    assert.equal(accounts.length, 1)
    assert.equal(accounts[0].balance, before.balance + 3000)
    assert.equal(accounts[0].available, before.available + 2500)
    assert.equal((await account(app, sender, legacyId)).id, sender.accounts[0].id)
    const deposit = ok(await app.call(routes.deposit(legacyId), { method: 'POST', token: sender.token, body: { amount: 200, channel: 'salary' } }))
    assert.equal(deposit.id, sender.accounts[0].id)
    const receipt = ok(await app.call('/api/transfers', { method: 'POST', token: recipient.token,
      body: { ...transfer(recipient, sender, 100), payeeAccountNo: legacyNo } }))
    assert.equal(receipt.settlementStatus, 'success')
    assert.equal((await account(app, sender)).balance, before.balance + 3300)
    await reconcile(app)
  })
  const exchange = async (customer, currency) => {
    const body = { fromAccountId: customer.accounts[0].id, toCurrency: currency, amount: 10000 }
    const quote = ok(await app.call(routes.exchangeQuote(), { method: 'POST', token: customer.token, body }))
    ok(await app.call(routes.exchange(), { method: 'POST', token: customer.token, body: { ...body, quoteId: quote.quoteId, paymentPassword: '888888' } }))
    const accounts = ok(await app.call('/api/accounts', { token: customer.token }))
    assert.equal(accounts.length, 1)
    assert(accounts[0].currencyBalances.every(row => row.accountNo === accounts[0].accountNo))
    return accounts[0].currencyBalances.find(row => row.currency === currency)
  }
  await t.test('cross-currency FPS credits the registered HKD partition exactly once and staff sees the currency', async () => {
    const hkd = await exchange(recipient, 'HKD')
    ok(await app.call(routes.fpsRegistration(), { method: 'POST', token: recipient.token,
      body: { accountId: hkd.id, region: 'HK', currency: 'HKD', idType: 'fpsid', id: '9199911', paymentPassword: '888888' } }))
    const registration = ok(await app.call(routes.fpsResolve(), { method: 'POST', token: sender.token, body: { idType: 'fpsid', fpsId: '9199911' } }))
    const body = { fromAccountId: sender.accounts[0].id, channel: 'fps', scope: 'overseas', fpsMethod: 'fpsid', fpsId: '9199911',
      payeeName: registration.name, payeeBankCode: 'LCB', payeeBankRegion: 'HK', payeeCurrency: 'HKD', amount: 100, memo: 'cross-currency FPS fixture' }
    const quote = ok(await app.call(routes.transferQuote(), { method: 'POST', token: sender.token, body }))
    body.confirmedQuote = { version: 1, submitBefore: Date.now() + 30000, fromCurrency: 'CNY', fee: quote.fee, fx: quote.fx }
    const before = await account(app, sender), key = `fps-${randomUUID()}`
    const result = ok(await app.call(routes.transfers(), { method: 'POST', token: sender.token, body, key }))
    assert.equal(result.fx.toCurrency, 'HKD')
    assert.deepEqual(ok(await app.call(routes.transfers(), { method: 'POST', token: sender.token, body, key })), result)
    assert.equal((await account(app, sender)).balance, before.balance - 100)
    assert.equal((await account(app, recipient, hkd.id)).balance, hkd.balance + result.fx.toAmount)
    const staff = await app.supervisorLogin()
    const profile = ok(await app.call(`/staff-api/customers/${recipient.user.id}/profile?reason=currency-regression`, { token: staff }))
    assert.equal(profile.accounts.length, 1)
    assert(profile.recentTransactions.some(row => row.currency === 'HKD' && row.amount === result.fx.toAmount))
    await reconcile(app)
  })
  await t.test('CNY-only savings rejects foreign currency without modifying balances', async () => {
    const usd = await exchange(sender, 'USD'), before = await financialState(app)
    const result = await app.call(routes.savingsRoundup(), { method: 'PATCH', token: sender.token,
      body: { enabled: false, roundupTo: 100, dailyCap: 1000, accountId: usd.id, goalId: null } })
    assert.equal(result.status, 400)
    assert.equal(result.body.code, 'CURRENCY_MISMATCH')
    assert.deepEqual(await financialState(app), before)
  })
  await t.test('overseas principal, fee, payee and idempotency record commit or roll back together', async () => {
    const body = { fromAccountId: sender.accounts[0].id, channel: 'bank', scope: 'overseas',
      payeeBankCode: '004', payeeBankRegion: 'HK', payeeAccountNo: '6217000000000000123', payeeName: 'TEST ONLY external', amount: 100, memo: 'fee transaction fixture' }
    const before = await account(app, sender), key = `fee-${randomUUID()}`
    const result = ok(await app.call(routes.transfers(), { method: 'POST', token: sender.token, body, key }))
    assert.equal(result.fee, 5000)
    const first = await financialState(app)
    assert.deepEqual(ok(await app.call(routes.transfers(), { method: 'POST', token: sender.token, body, key })), result)
    assert.deepEqual(await financialState(app), first)
    assert.equal((await account(app, sender)).balance, before.balance - result.amount - result.fee)
    await app.database(db => db.exec(`CREATE FUNCTION reject_fee_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.counterparty='手续费' THEN RAISE EXCEPTION 'TEST ONLY fee failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_fee_fixture BEFORE INSERT ON bank_transactions FOR EACH ROW EXECUTE FUNCTION reject_fee_fixture()`))
    try {
      const failed = await app.call(routes.transfers(), { method: 'POST', token: sender.token, body: { ...body, payeeName: 'TEST ONLY failed payee' }, key: `fail-fee-${randomUUID()}` })
      assert.equal(failed.status, 500)
      assert.deepEqual(await financialState(app), first)
    } finally { await app.database(db => db.exec('DROP TRIGGER reject_fee_fixture ON bank_transactions; DROP FUNCTION reject_fee_fixture()')) }
    assert(!ok(await app.call(routes.payees(), { token: sender.token })).some(row => row.name === 'TEST ONLY failed payee'))
    await reconcile(app)
  })
})

test('explicit live mode in an isolated production fixture rejects unavailable SMS and identity providers', { ...testOptions, timeout: 60000 }, async t => {
  const app = await fixture({ production: true, mode: 'live' })
  t.after(() => app.close())
  assert.equal(ok(await app.call('/health')).integrationMode, 'live')
  for (const [path, body] of [
    ['/api/auth/sms-code', { phone: '13900139004' }],
    ['/api/security/verify', { channel: 'face' }],
  ]) {
    const result = await app.call(path, { method: 'POST', body })
    assert.equal(result.status, 503)
    assert.equal(result.body.code, 'INTEGRATION_NOT_CONFIGURED')
    assert.equal(result.body.demoCode, undefined)
    assert.equal(result.body.ticket, undefined)
  }
  assert.equal(await app.database(async db => (await db.prepare('SELECT COUNT(*) AS n FROM bank_sms_challenges').get()).n), 0)
  const customer = await app.database(async db => (await db.query('SELECT id,phone FROM customers ORDER BY seq LIMIT 1')).rows[0])
  assert(customer, 'the isolated fixture must contain its explicit test-only legacy customer')
  const token = randomBytes(32).toString('base64url'), sessionId = createHash('sha256').update(token).digest('hex')
  await app.database(db => db.query(`INSERT INTO customer_sessions(id,owner_id,phone,device,created_at,expires_at,ended_at)
    VALUES($1,$2,$3,'TEST ONLY direct session',$4,$5,NULL)`, [sessionId, customer.id, customer.phone, new Date().toISOString(), Date.now() + 3_600_000]))
  const supervisor = await app.supervisorLogin(), transactionId = `txn_live_${randomUUID()}`, approvalId = `A_live_${randomUUID()}`
  const recipient = { name: 'TEST ONLY live hold recipient', accountNo: '8820999999990001' }
  let cardId, mandateId, request, holdUntil
  // Persist an actual executable legacy hold. Without the live bankHooks guard,
  // staff settlement would move these balances rather than merely returning 404.
  await app.editCustomer(customer.id, (profile, _connection, profiles) => {
    const from = profile.accounts.find(row => row.currency === 'CNY' && row.available >= 1200)
    assert(from, 'the disposable fixture needs one funded CNY account')
    assert.equal(profile.accounts.length, 1, 'live rejection must also hold under the single funding account model')
    // Explicitly seed a different fixture owner. Production may contain only the
    // bootstrap customer and must never create a second account for that owner.
    const target = structuredClone(profile)
    target.user = { ...target.user, id: 'test_live_recipient', phone: '13900139088', name: recipient.name }
    target.accounts = [{ ...from, accountNo: recipient.accountNo, balance: 0, available: 0 }]
    Object.assign(target, { currencyBalances: [], retiredBalances: [], accountAliases: {}, accountNumberAliases: {},
      transactions: [], cards: [], cardSecrets: {}, fpsRegistrations: [], payees: [], autoDebits: [] })
    profiles[target.user.phone] = target
    cardId = profile.cards.find(row => row.status === 'active')?.id
    mandateId = profile.autoDebits?.[0]?.id ?? 'test-only-missing-mandate'
    holdUntil = new Date(Date.now() + 60_000).toISOString()
    request = { fromAccountId: from.id, channel: 'bank', scope: 'domestic', payeeName: recipient.name,
      payeeAccountNo: recipient.accountNo, payeeBankCode: 'LCB', payeeBankRegion: 'CN', amount: 1200, memo: 'TEST ONLY blocked live settlement' }
    from.available -= 1200
    profile.transactions.unshift({ id: transactionId, accountId: from.id, direction: 'out', amount: 1200, signedAmount: -1200,
      counterparty: recipient.name, memo: request.memo, category: 'transfer', status: 'pending', pendingReason: 'inflight',
      createdAt: new Date().toISOString(), holdUntil, heldRequest: request, heldFrozenAmount: 1200,
      detail: { referenceNo: `TEST-${transactionId}`, channel: 'transfer', settleCurrency: 'CNY', balanceBefore: from.balance, balanceAfter: from.balance } })
  })
  await app.database(db => db.query(`INSERT INTO approvals(id,biz_type,biz_payload,risk_summary,applicant_id,status,execution_status,created_at)
    VALUES($1,'transfer',$2,'TEST ONLY existing legacy hold',NULL,'pending','pending',$3)`, [approvalId, JSON.stringify({ customerId: customer.id, transactionId, request, amount: 1200, holdUntil }), new Date().toISOString()]))
  const before = await financialState(app)
  await t.test('every legacy financial contract route refuses live demo reads and writes', async () => {
    const safe = new Set(['login','register','logout','profile','smsCode','verifyIdentity','changePhone','changePassword','paymentPassword','security','supportHistory','supportChat','supportTickets','supportTicket','supportTicketMessages'])
    const posts = new Set(['deposit','fpsRegistration','cardBin','fpsResolve','transferQuote','transferRecipient','transfers','transferRecall','cardOpen','cardLock','cardReplace','cardSecrets','wealthAccountOpen','wealthRiskAssess','wealthSubscribe','wealthRedeem','exchangeQuote','exchange','savingsGoals','virtualCard','identityOcr','identityLiveness','overdraftActivate','creditApply','creditInstallment','investPlan','insuranceEnroll'])
    const patches = new Set(['cardSettings','autoDebit','securityRule','savingsGoal','savingsRoundup','salaryPlan','cashManagementSweep'])
    for (const [name, build] of Object.entries(routes)) {
      if (safe.has(name)) continue
      const method = posts.has(name) ? 'POST' : patches.has(name) ? 'PATCH' : 'GET'
      const result = await app.call(build(randomUUID()), { method, token, ...(method === 'GET' ? {} : { body: {} }) })
      assert.equal(result.status, 503, `${name} must refuse live legacy data`)
      assert.equal(result.body.code, 'BANK_NOT_CONNECTED', name)
    }
    for (const path of ['/api/agent/transfer/requirements','/api/agent/wealth/requirements']) assert.equal((await app.call(path, { token })).status, 503, path)
    assert.equal((await app.call(`/api/savings/goals/${randomUUID()}`, { method: 'DELETE', token })).status, 503)
    assert.deepEqual(await financialState(app), before)
  })
  await t.test('staff and staff-agent API channels cannot mutate live legacy cards or reservations', async () => {
    const actions = [['lockCard',{ cardId }],['unlockCard',{ cardId }],['updateCardSettings',{ cardId,dailyLimit:500_000 }],['patchAutodebit',{ autoDebitId:mandateId,enabled:false }]]
    for (const [action, payload] of actions) {
      const result = await app.call(`/staff-api/customers/${customer.id}/actions/${action}`, { method: 'POST', token: supervisor,
        body: { ticketId:'TEST-LIVE-BLOCK',verificationMethod:'phone',verificationResult:'passed',reason:'TEST ONLY live rejection',...payload } })
      assert.equal(result.status, 503, action); assert.equal(result.body.code, 'BANK_NOT_CONNECTED', action)
    }
    for (const decision of [{ decision:'settle' },{ decision:'intercept',reasonCode:'客户来电要求叫停' }]) {
      const result = await app.call(`/staff-api/approvals/${approvalId}/decide`, { method:'POST',token:supervisor,body:decision })
      assert.equal(result.status, 503, `live ${decision.decision} must not execute a local hold`)
      assert.equal(result.body.code, 'SETTLEMENT_FAILED')
    }
    const pending = ok(await app.call(`/staff-api/approvals/${approvalId}`, { token: supervisor }))
    assert.equal(pending.status, 'pending'); assert.equal(pending.executionStatus, 'pending')
    assert.equal((await app.call(`/staff-api/customers/${customer.id}/profile?reason=TEST-live-block`, { token: supervisor })).status, 503)
    assert.deepEqual(await financialState(app), before)
  })
  await t.test('unconfigured native payments, account reads and receipt endpoints cannot create bank evidence', async () => {
    const payment = await app.call('/api/bank-payments', { method:'POST',token,key:`live-no-bank-${randomUUID()}`, body:{
      sourceAccountId:randomUUID(),consentId:randomUUID(),amountCents:100,currency:'CNY',payee:{name:'TEST ONLY',accountNumber:'6217000000000000123',bankCode:'TEST_ONLY',bankRegion:'CN'} } })
    assert.equal(payment.status, 503)
    assert.equal((await app.call('/api/bank-connections', { token })).status, 503)
    assert.equal((await app.call(`/api/bank-webhooks/${randomUUID()}`, { method:'POST',body:{verified:true,type:'payment.succeeded'} })).status, 503)
    for (const table of ['banking.receipts','banking.payment_intents','banking.payment_events']) assert.equal(await app.database(async db => (await db.query(`SELECT COUNT(*) n FROM ${table}`)).rows[0].n), 0)
    assert.deepEqual(await financialState(app), before)
  })
  await reconcile(app)
})
