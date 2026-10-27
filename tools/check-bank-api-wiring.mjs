/**
 * Actual createBankApi + real loopback HTTP + transactional memory adapter.
 * Authentication/security and SQL audit are explicit test doubles. This checks
 * route/argument wiring, customer selection, scanner and rollback boundaries;
 * it does NOT replace PostgreSQL integration, production auth or live banking.
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { createBankApi } from '../server/bank-api.mjs'
import { routes } from '../server/api/contract.mjs'

const CURRENT = 'luckycat.mock.db', PROFILES = 'luckycat.luckycat.mock.user-profiles.v1'
class TransactionalMemoryStorage {
  committed = new Map()
  staged = null
  failNextCommit = false
  commits = 0
  rollbacks = 0
  view() { return this.staged ?? this.committed }
  getItem(key) { return this.view().get(key) ?? null }
  setItem(key, value) { assert(this.staged, 'fixture writes require a unit of work'); this.staged.set(key, String(value)) }
  removeItem(key) { assert(this.staged, 'fixture writes require a unit of work'); this.staged.delete(key) }
  setItemsAtomically(entries) { for (const [key, value] of entries) this.setItem(key, value) }
  async beginUnitOfWork() { assert.equal(this.staged, null, 'no overlapping bank transaction'); this.staged = new Map(this.committed) }
  async commitUnitOfWork() {
    assert(this.staged)
    if (this.failNextCommit) { this.failNextCommit = false; throw Object.assign(Error('TEST ONLY commit rejected'), { status: 503, code: 'FIXTURE_COMMIT_FAILED' }) }
    this.committed = this.staged; this.staged = null; this.commits++
  }
  async rollbackUnitOfWork() { this.staged = null; this.rollbacks++ }
  releaseProjection() { assert.equal(this.staged, null) }
  json(key) { return JSON.parse(this.committed.get(key) ?? 'null') }
  profiles() { const all = this.json(PROFILES) ?? {}, current = this.json(CURRENT); if (current) all[current.user.phone] = current; return all }
  profile(phone) { return this.profiles()[phone] }
  money() { return Object.values(this.profiles()).map(profile => ({ owner: profile.user.id, accounts: [...profile.accounts, ...(profile.currencyBalances ?? [])].map(row => ({ id: row.id, currency: row.currency, balance: row.balance, available: row.available })).sort((a, b) => a.id.localeCompare(b.id)), transactions: profile.transactions.map(row => ({ id: row.id, amount: row.amount, signedAmount: row.signedAmount, status: row.status, accountId: row.accountId })).sort((a, b) => a.id.localeCompare(b.id)) })).sort((a, b) => a.owner.localeCompare(b.owner)) }
}

const storage = new TransactionalMemoryStorage(), tokens = new Map()
const auth = {
  async resolve(req) {
    const phone = tokens.get(req.headers.authorization)
    if (!phone) throw Object.assign(Error('TEST ONLY authentication required'), { status: 401, code: 'UNAUTHORIZED' })
    return phone
  },
}
const security = { mode: 'sandbox', run: (req, work) => work(), async before() {}, async afterRollback() {}, async idempotent() { return null } }
const database = { db: { prepare() { return { async run() { return { changes: 1 } } } } } }
const heldEvents = []
const bank = await createBankApi({ storage, auth, security, database, reviewThreshold: 50_000_000, onTransferHeld: async event => { heldEvents.push(event) } })
const initial = storage.json(CURRENT), recipient = storage.profile('13600136000')
assert(initial && recipient, 'isolated seed must have two separate funding owners')
tokens.set('Bearer fixture-owner', initial.user.phone); tokens.set('Bearer fixture-recipient', recipient.user.phone)
const ownerToken = 'fixture-owner', otherToken = 'fixture-recipient'
const server = createServer(async (req, res) => {
  try {
    const handled = await bank.handle(req, res, new URL(req.url, 'http://127.0.0.1'))
    if (!handled) { res.writeHead(404); res.end('{}') }
  } catch (error) { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ message: error.message })) }
})
const originalNow = Date.now
let clockOffset = 0
Date.now = () => originalNow() + clockOffset
try {
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const base = `http://127.0.0.1:${server.address().port}`
  async function call(path, { method = 'GET', token = ownerToken, body } = {}) {
    const response = await fetch(base + path, { method, signal: AbortSignal.timeout(10_000), headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    return { status: response.status, data: await response.json() }
  }
  const ok = result => { assert.equal(result.status, 200, JSON.stringify(result.data)); return result.data }
  const accounts = ok(await call(routes.accounts())), otherAccounts = ok(await call(routes.accounts(), { token: otherToken }))
  assert.equal(accounts.length, 1); assert.equal(otherAccounts.length, 1); assert.notEqual(accounts[0].id, otherAccounts[0].id)
  assert.equal((await call(routes.accounts(), { token: null })).status, 401)
  assert.equal((await call(routes.account(accounts[0].id), { token: otherToken })).status, 404)
  const financialBefore = storage.money()
  const request = { fromAccountId: accounts[0].id, channel: 'bank', scope: 'domestic', payeeBankCode: 'LCB', payeeBankRegion: 'CN', payeeName: recipient.user.name, payeeAccountNo: otherAccounts[0].accountNo, amount: 101, memo: 'HTTP 定时接线', executeAt: new Date(Date.now() + 120_000).toISOString(), paymentPassword: '888888', confirmed: true, clientRequestId: 'http-schedule-one' }
  const plan = ok(await call(routes.scheduledTransfers(), { method: 'POST', body: request }))
  assert.equal(plan.status, 'scheduled'); assert.equal(plan.amount, 101); assert.equal(plan.fundsReserved, false)
  assert.deepEqual(storage.money(), financialBefore)
  assert.equal(ok(await call(routes.scheduledTransfers())).length, 1)
  assert.deepEqual(ok(await call(routes.scheduledTransfers(), { token: otherToken })), [])
  assert.equal((await call(routes.scheduledTransfer(plan.id), { token: otherToken, method: 'DELETE', body: { version: plan.version } })).status, 404)
  assert.equal((await call(routes.scheduledTransfer(plan.id), { method: 'DELETE', body: { version: plan.version + 1 } })).data.code, 'VERSION_CONFLICT')
  const cancelled = ok(await call(routes.scheduledTransfer(plan.id), { method: 'DELETE', body: { version: plan.version } }))
  assert.equal(cancelled.status, 'cancelled'); assert.deepEqual(storage.money(), financialBefore)
  console.log('PASS HTTP: actual createBankApi routes initialize; one account/customer isolation; create/list; DELETE reads JSON version and rejects stale/cross-customer cancellation')

  const executing = ok(await call(routes.scheduledTransfers(), { method: 'POST', body: { ...request, clientRequestId: 'http-schedule-execute' } }))
  const beforeExecution = storage.money(), senderBefore = storage.profile(initial.user.phone).accounts[0].balance, receiverBefore = storage.profile(recipient.user.phone).accounts[0].balance
  clockOffset = 180_000
  storage.failNextCommit = true
  await assert.rejects(bank.tickHolds(), { code: 'FIXTURE_COMMIT_FAILED' })
  assert.deepEqual(storage.money(), beforeExecution, 'both customers ledger/balances must roll back after scan commit failure')
  assert.equal(ok(await call(routes.scheduledTransfers())).find(row => row.id === executing.id).status, 'scheduled')
  await bank.tickHolds()
  const executed = ok(await call(routes.scheduledTransfers())).find(row => row.id === executing.id)
  assert.equal(executed.status, 'executed'); assert.equal(executed.settlementStatus, 'success')
  assert.equal(storage.profile(initial.user.phone).accounts[0].balance, senderBefore - 101)
  assert.equal(storage.profile(recipient.user.phone).accounts[0].balance, receiverBefore + 101)
  const afterExecution = storage.money(); await bank.tickHolds(); assert.deepEqual(storage.money(), afterExecution)
  assert.equal(ok(await call(routes.transaction(executed.transactionId))).amount, 101)
  assert.equal((await call(routes.transaction(executed.transactionId), { token: otherToken })).status, 404)
  console.log('PASS scanner: commit failure rolls back both customers and keeps instruction scheduled; retry debits/credits exactly once; replay scan leaves all ledgers unchanged')

  const payees = ok(await call(routes.payees() + '?keyword=' + encodeURIComponent('HTTP 定时接线')))
  assert(payees.some(row => row.name === recipient.user.name))
  const payee = payees.find(row => row.name === recipient.user.name)
  const updated = ok(await call(routes.payee(payee.id), { method: 'PATCH', body: { remark: '家人 HTTP 测试' } }))
  assert.equal(updated.remark, '家人 HTTP 测试')
  assert.equal(ok(await call(routes.payees() + '?keyword=' + encodeURIComponent('家人 HTTP'))).length, 1)
  assert.equal((await call(routes.payee(payee.id), { token: otherToken, method: 'PATCH', body: { remark: '禁止跨客户编辑' } })).status, 404)
  const split = ok(await call(routes.splitCollections(), { method: 'POST', body: { title: 'HTTP AA', amount: 101, currency: 'CNY', participants: ['张三', '李四'], clientRequestId: 'http-split-one' } }))
  assert.deepEqual(split.participants.map(row => row.amount), [51, 50])
  assert.equal(ok(await call(routes.splitCollections())).length, 1)
  const reminder = ok(await call(routes.splitReminder(split.id), { method: 'POST', body: { version: split.version, participantId: split.participants[0].id } }))
  assert.equal(reminder.delivered, false); assert(reminder.text.includes('0.51 CNY'))
  assert.equal((await call(routes.splitPayment(split.id), { method: 'POST', body: { version: reminder.collection.version, participantId: split.participants[0].id, transactionId: executed.transactionId } })).data.code, 'SPLIT_PAYMENT_NOT_MATCHED')
  assert.equal((await call(routes.splitCollection(split.id), { token: otherToken, method: 'DELETE', body: { version: reminder.collection.version } })).status, 404)
  assert.equal(ok(await call(routes.splitCollection(split.id), { method: 'DELETE', body: { version: reminder.collection.version } })).status, 'cancelled')
  const year = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 4), query = '?period=year&value=' + year + '&currency=CNY'
  const report = ok(await call(routes.billingReport() + query)), exported = ok(await call(routes.billingReportExport() + query))
  assert.equal(report.months.length, 12); assert(report.totalExpense >= 101); assert.equal(exported.report.totalExpense, report.totalExpense)
  assert(exported.rows.some(row => row.section === '月度')); assert(exported.fileName.endsWith('-CNY.csv'))
  console.log('PASS HTTP: saved payee PATCH/search ownership, AA create/list/reminder/evidence rejection/DELETE version, annual full report and export query wiring')

  const eventDate = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10)
  const birthdayInput = { contactName: '本人明确提供的联系人', relationship: '爱人', eventDate, amountCents: 100_000, currency: 'CNY', accountId: accounts[0].id }
  const birthdayBefore = storage.money(), balanceBefore = storage.profile(initial.user.phone).accounts[0]
  const preview = ok(await call(routes.birthdayPlanPreview(), { method: 'POST', body: birthdayInput }))
  assert.equal(preview.merchantConnected, false); assert.deepEqual(storage.money(), birthdayBefore)
  const birthday = ok(await call(routes.birthdayPlans(), { method: 'POST', body: { ...birthdayInput, confirmed: true, paymentPassword: '888888', requestId: 'http-birthday-one' } }))
  assert.equal(birthday.reservation.status, 'held'); assert.equal(birthday.order.merchantOrderId, null)
  assert.equal(storage.profile(initial.user.phone).accounts[0].balance, balanceBefore.balance)
  assert.equal(storage.profile(initial.user.phone).accounts[0].available, balanceBefore.available - 100_000)
  assert.deepEqual(ok(await call(routes.birthdayPlans(), { token: otherToken })), [])
  assert.equal((await call(routes.birthdayPlanCancel(birthday.id), { token: otherToken, method: 'POST', body: { confirmed: true } })).status, 404)
  const order = ok(await call(routes.birthdayPlanOrder(birthday.id), { method: 'POST', body: { confirmed: true } }))
  assert.equal(order.order.status, 'awaiting_merchant_connection'); assert.equal(order.order.merchantOrderId, null)
  const ended = ok(await call(routes.birthdayPlanCancel(birthday.id), { method: 'POST', body: { confirmed: true } }))
  assert.equal(ended.status, 'cancelled'); assert.deepEqual(storage.money(), birthdayBefore, 'release only own hold with no bank debit or merchant order')
  console.log('PASS birthday HTTP: preview without reserve; confirmed create holds available only; owner isolation; order remains unconnected; cancellation releases exact reservation')

  const beforeRejectedCommit = storage.money()
  storage.failNextCommit = true
  const failedTransfer = await call(routes.transfers(), { method: 'POST', body: { fromAccountId: accounts[0].id, channel: 'bank', scope: 'domestic', payeeBankCode: 'LCB', payeeBankRegion: 'CN', payeeName: recipient.user.name, payeeAccountNo: otherAccounts[0].accountNo, amount: 123, memo: 'TEST ONLY commit rollback' } })
  assert.equal(failedTransfer.status, 503); assert.equal(failedTransfer.data.code, 'FIXTURE_COMMIT_FAILED')
  assert.deepEqual(storage.money(), beforeRejectedCommit, 'HTTP transfer commit failure must roll back sender, recipient and both ledgers')
  assert(storage.rollbacks >= 7); assert.equal(heldEvents.length, 0)
  console.log(`PASS HTTP rollback: commit rejection returns failure, all customers and ledger rows unchanged; ${bank.stats().routes} route bindings initialized`)
  console.log('LIMIT: transactional memory, stub authentication/security/audit; PostgreSQL persistence, real auth and live bank integrations still require their dedicated integration gate.')
} finally {
  Date.now = originalNow
  await new Promise(resolve => server.close(resolve))
  server.closeAllConnections?.()
}
