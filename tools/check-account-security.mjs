/** Customer security rules against both actual business implementations; in-memory data only. */
import assert from 'node:assert/strict'
import { unfreezeAccount } from '../shared/account-security.mjs'
import { ACCOUNT_OPENING_PLEDGE } from '../server/lib/account-opening.mjs'

class MemoryStorage {
  values = new Map()
  getItem(key) { return this.values.get(key) ?? null }
  setItem(key, value) { this.values.set(key, String(value)) }
  removeItem(key) { this.values.delete(key) }
  setItemsAtomically(entries) { for (const [key, value] of entries) this.setItem(key, value) }
}
globalThis.window = { localStorage: new MemoryStorage(), sessionStorage: new MemoryStorage() }
const serverState = await import('../server/domain/state.mjs')
const server = await import('../server/domain/index.mjs')
const browserState = await import('../app/src/api/mock/db.ts')
const browser = await import('../app/src/api/mock/index.ts')
const reject = (promise, code) => assert.rejects(promise, error => error.code === code)
const financial = db => structuredClone({ accounts: db.accounts, balances: db.currencyBalances, cards: db.cards, transactions: db.transactions })

for (const [name, state, module, create] of [
  ['server', serverState, server, server.createBankBusinessApi],
  ['browser', browserState, browser, browser.createMockApi],
]) {
  state.resetDb()
  const api = create({ security: { verifySms: async () => {} } })
  const initialPassword = state.loadDb().passwordDigest
  for (const password of ['Abc!def', 'abcdefgh!', 'ABCDEFGH!', 'Abcdefgh', 'Abcdefg ']) {
    await reject(api.changePassword('123456', password), 'WEAK_PASSWORD')
    assert.equal(state.loadDb().passwordDigest, initialPassword, `${name}: rejected password must not be saved`)
    await reject(api.register({ phone: '13900000991', password }), 'WEAK_PASSWORD')
  }
  await api.changePassword('123456', 'Abcdefg!') // Exactly eight, no digit requirement.
  const owner = state.loadDb().user
  const login = async () => {
    state.loadDb().pendingSms = { phone: owner.phone, code: '456789', expiresAt: new Date(Date.now() + 60000).toISOString() }
    state.persist()
    return api.login(owner.phone, 'Abcdefg!', '456789')
  }
  await login()

  const verify = module.verifyPayPassword
  const failed = count => {
    assert.throws(() => verify('000000'), error => error.code === (count === 5 ? 'ACCOUNT_FROZEN' : 'BAD_PAY_PASSWORD') && error.status === (count === 5 ? 423 : 401))
    assert.equal(state.loadDb().payPasswordFailures, count)
  }
  failed(1); failed(2)
  verify('888888')
  assert.equal(state.loadDb().payPasswordFailures, 0, `${name}: successful payment verification resets consecutive errors`)
  for (let attempt = 1; attempt <= 4; attempt++) failed(attempt)
  const originalPin = state.loadDb().payPassword
  await reject(api.changePaymentPassword({ oldPassword: '888888', newPassword: 'bad-pin' }), 'INVALID_PAY_PASSWORD')
  assert.equal(state.loadDb().payPasswordFailures, 0, `${name}: correct PIN resets failures even when the later business validation fails`)
  assert.equal(state.loadDb().payPassword, originalPin, `${name}: rejected new PIN is never saved`)
  failed(1)
  verify('888888')
  assert.equal(state.loadDb().payPasswordFailures, 0)
  for (let attempt = 1; attempt <= 4; attempt++) failed(attempt)
  await api.logout(); await login()
  assert.equal(state.loadDb().payPasswordFailures, 4, `${name}: relogin preserves pre-freeze attempts`)
  const baseline = financial(state.loadDb())
  failed(5)
  assert.equal((await api.getSecurityOverview()).accountSecurity.frozen, true)
  await api.logout(); await login()
  assert.equal(state.loadDb().payPasswordFailures, 5, `${name}: relogin cannot unlock a frozen account`)
  assert.throws(() => verify('888888'), error => error.code === 'ACCOUNT_FROZEN' && (name !== 'browser' || error.name === 'ApiError'))
  assert.throws(() => verify('000000'), error => error.code === 'ACCOUNT_FROZEN')
  assert.equal(state.loadDb().payPasswordFailures, 5, `${name}: frozen attempts stay bounded`)
  await reject(api.changePaymentPassword({ oldPassword: '888888', newPassword: '246810' }), 'ACCOUNT_FROZEN')
  await reject(api.changePaymentPassword({ faceTicket: 'test-face-ticket', newPassword: '246810' }), 'ACCOUNT_FROZEN')
  await reject(api.spendOnCard(state.loadDb().cards[0].id, { platform: 'meituan', amount: 100 }), 'ACCOUNT_FROZEN')
  await reject(api.setCardLock(state.loadDb().cards[0].id, false), 'ACCOUNT_FROZEN')
  assert.deepEqual(financial(state.loadDb()), baseline, `${name}: freezing/rejected writes do not change funds, cards or transactions`)
  assert.equal((await api.profile()).id, owner.id)
  assert.equal((await api.listAccounts()).length, 1)
  assert(Array.isArray(await api.listSupportMessages()))
  if (state.discardCache) state.discardCache()
  assert.equal(state.loadDb().payPasswordFailures, 5, `${name}: committed lock survives profile reload`)

  // The privileged staff hook calls this helper after authorization; no customer API exposes it.
  unfreezeAccount(state.loadDb()); state.persist()
  verify('888888')
  assert.equal((await api.getSecurityOverview()).accountSecurity.frozen, false)
  assert.equal(state.loadDb().payPasswordFailures, 0)
  assert.deepEqual(financial(state.loadDb()), baseline, `${name}: staff unfreeze only clears credential failures`)

  const phone = '13900000991'
  state.loadDb().pendingSms = { phone, code: '456789', expiresAt: new Date(Date.now() + 60000).toISOString() }
  state.persist()
  const registered = await api.register({ phone, password: 'Another!Password', paymentPassword: '246810', holderName: '安全测试客户',
    idNumber: '310101199001011234', smsCode: '456789', faceTicket: 'test-face-ticket', pledge: ACCOUNT_OPENING_PLEDGE })
  assert.equal(registered.user.phone, phone)
  assert.equal(state.loadDb().payPasswordFailures, 0)
  assert.equal(state.loadDb().accounts.length, 1)
  console.log(`PASS ${name}: strong login passwords, five consecutive payment errors, persistent account freeze, blocked bypasses and privileged recovery`)
}
