import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { isValidLoginPassword } from '../shared/password-policy.mjs'
import { protectAccountApi } from '../shared/account-security.mjs'
import { fixture, ok, login, register, account, reconcile, testOptions, routes } from './testing/http-fixture.mjs'

test('new login password policy requires eight code points, mixed ASCII case and a symbol', () => {
  for (const value of [undefined, null, 12345678, '', 'Abc!def', 'abcdefgh!', 'ABCDEFGH!', 'Abcdefgh', 'Abcdefg ', 'Ab中中中中中中']) {
    assert.equal(isValidLoginPassword(value), false, `reject ${String(value)}`)
  }
  for (const value of ['Abcdefg!', 'Abcdefg_', 'Abcdefg。', 'Abcdefg💳', 'LongPasswordWithoutDigits!']) {
    assert.equal(isValidLoginPassword(value), true, `accept ${value}`)
  }
  assert.equal(isValidLoginPassword('Abcde💳!'), false, 'surrogate pairs do not turn seven characters into eight')
  assert.equal(isValidLoginPassword(`Ab!${'x'.repeat(1022)}`), false, 'preserve the password hashing byte bound')
})

test('account protection retains method receivers for business methods that call this', async () => {
  const profile = { payPasswordFailures: 0 }
  const api = protectAccountApi({
    getReceivingInfo() { return { registered: true } },
    async registerFps() { return this.getReceivingInfo() },
  }, () => profile)
  assert.deepEqual(await api.registerFps(), { registered: true })
  profile.payPasswordFailures = 5
  await assert.rejects(api.registerFps(), { code: 'ACCOUNT_FROZEN' })
})

test('HTTP payment freeze persists across rejected transactions, simultaneous attempts, sessions and restart', {
  ...testOptions,
  skip: testOptions.skip ? 'BANK_HTTP_TEST_DATABASE_URL is not configured; PostgreSQL persistence and native HTTP checks require a disposable test database' : false,
  timeout: 120000,
}, async t => {
  const app = await fixture()
  t.after(() => app.close())
  const owner = await register(app, '13900000992', 'TEST ONLY account security')
  const other = await login(app, '13600136000')
  const post = (path, body, token = owner.token) => app.call(path, { method: 'POST', token, body })
  const overview = async (token = owner.token) => ok(await app.call(routes.security(), { token })).accountSecurity
  const pinChange = oldPassword => post(routes.paymentPassword(), { oldPassword, newPassword: '888888' })
  const baseline = await account(app, owner)

  assert.equal((await pinChange('000000')).body.code, 'BAD_PAY_PASSWORD')
  assert.equal((await overview()).failedAttempts, 1)
  ok(await pinChange('888888'))
  assert.equal((await overview()).failedAttempts, 0)
  for (let attempt = 1; attempt <= 4; attempt++) {
    assert.equal((await pinChange('000000')).body.code, 'BAD_PAY_PASSWORD')
    assert.equal((await overview()).failedAttempts, attempt)
  }
  const rejectedNewPin = await post(routes.paymentPassword(), { oldPassword: '888888', newPassword: 'bad-pin' })
  assert.equal(rejectedNewPin.status, 400)
  assert.equal(rejectedNewPin.body.code, 'INVALID_PAY_PASSWORD')
  assert.equal((await overview()).failedAttempts, 0, 'successful PIN validation survives rollback of the rejected password change')
  await app.restart()
  assert.equal((await overview()).failedAttempts, 0, 'the reset event is persisted before reporting the business validation error')
  assert.equal((await pinChange('000000')).body.code, 'BAD_PAY_PASSWORD')
  assert.equal((await overview()).failedAttempts, 1)
  ok(await pinChange('888888')) // The rejected new PIN must not replace the original.
  assert.equal((await overview()).failedAttempts, 0)
  const failures = await Promise.all(Array.from({ length: 5 }, () => pinChange('000000')))
  assert.equal(failures.filter(result => result.status === 401 && result.body.code === 'BAD_PAY_PASSWORD').length, 4)
  assert.equal(failures.filter(result => result.status === 423 && result.body.code === 'ACCOUNT_FROZEN').length, 1)
  assert.equal((await overview()).failedAttempts, 5)
  assert.equal((await overview()).frozen, true)
  assert.equal((await overview(other.token)).frozen, false)
  assert.deepEqual(await account(app, owner), baseline)
  const nativePayment = await app.call('/api/bank-payments', { method: 'POST', token: owner.token, key: `frozen-native-${randomUUID()}`, body: {
    sourceAccountId: randomUUID(), consentId: randomUUID(), amountCents: 100, currency: 'CNY',
    payee: { name: 'TEST ONLY frozen customer', accountNumber: '6217000000000000123', bankCode: 'TEST_ONLY', bankRegion: 'CN' },
  } })
  assert.equal(nativePayment.status, 423)
  assert.equal(nativePayment.body.code, 'ACCOUNT_FROZEN', 'native payments must enforce the same customer freeze before provider access')
  for (const table of ['banking.payment_intents', 'banking.payment_events']) {
    assert.equal(Number(await app.database(async db => (await db.query(`SELECT COUNT(*) AS n FROM ${table}`)).rows[0].n)), 0)
  }
  await app.restart()
  assert.equal((await overview()).frozen, true)
  assert.equal((await pinChange('888888')).body.code, 'ACCOUNT_FROZEN')
  assert.equal((await post(routes.paymentPassword(), { faceTicket: 'forged-ticket', newPassword: '246810' })).body.code, 'ACCOUNT_FROZEN')
  ok(await post(routes.logout(), {}))
  const sms = ok(await post(routes.smsCode(), { phone: owner.phone }, undefined))
  const relogin = ok(await post(routes.login(), { phone: owner.phone, password: 'TestBank!123', smsCode: sms.demoCode }, undefined))
  assert.equal((await overview(relogin.token)).frozen, true)
  assert.equal((await post(routes.deposit(owner.accounts[0].id), { amount: 100, channel: 'bank' }, relogin.token)).body.code, 'ACCOUNT_FROZEN')

  // Recover through the real staff endpoint, then prove the original PIN works again.
  const employee = await app.staffLogin('王小明')
  const ticketResponse = await post('/staff-api/tickets', { customerId: owner.user.id, channel: 'phone', reason: '客户核验后申请账号解冻' }, employee.token)
  assert.equal(ticketResponse.status, 201)
  const actionPath = `/staff-api/customers/${owner.user.id}/actions/unfreezeAccount`
  const action = { ticketId: ticketResponse.body.ticketId, verificationMethod: 'phone', verificationResult: 'passed', reason: '已核验客户身份并确认支付密码误输' }
  assert.equal((await post(actionPath, action, relogin.token)).status, 401)
  assert.equal((await post(actionPath, { ...action, verificationResult: 'failed' }, employee.token)).status, 403)
  assert.equal((await overview(relogin.token)).frozen, true)
  ok(await post(actionPath, action, employee.token))
  assert.equal((await overview(relogin.token)).frozen, false)
  ok(await post(routes.paymentPassword(), { oldPassword: '888888', newPassword: '246810' }, relogin.token))
  assert.equal((await overview(relogin.token)).failedAttempts, 0)
  assert.deepEqual(await account(app, { ...owner, token: relogin.token }), baseline)
  await app.restart()
  assert.equal((await overview(relogin.token)).frozen, false)
  await reconcile(app)
})
