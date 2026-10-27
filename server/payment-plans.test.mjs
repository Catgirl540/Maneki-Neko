import test from 'node:test'
import assert from 'node:assert/strict'
import { createPaymentPlans } from '../shared/payment-plans.mjs'

function fixture() {
  let time = Date.parse('2026-10-27T00:00:00Z'), seq = 0, writes = 0, executed = 0
  let db = { user: { id: 'owner' }, accounts: [{ id: 'cn', accountNo: '8820000000000001', currency: 'CNY', balance: 9999, available: 9999 }], currencyBalances: [{ id: 'usd', currency: 'USD' }], banks: [{ code: '102', region: 'CN' }], transactions: [] }
  const build = () => createPaymentPlans({ getDb: () => db, persist: () => { writes++ }, nextId: prefix => `${prefix}_${++seq}`, now: () => time,
    verifyPassword: password => { if (password !== '888888') throw Object.assign(Error('密码错误'), { status: 400, code: 'BAD_PAY_PASSWORD' }) }, resolveRecipient: async () => ({ sameOwner: false }),
    executeTransfer: async req => {
      if (req.amount > db.accounts[0].available) throw Object.assign(Error('余额不足'), { status: 400, code: 'INSUFFICIENT_FUNDS' })
      executed++; db.accounts[0].available -= req.amount; db.accounts[0].balance -= req.amount
      return { transactionId: `tx-${executed}`, settlementStatus: 'success' }
    } })
  const request = { fromAccountId: 'cn', channel: 'bank', scope: 'domestic', payeeBankCode: '102', payeeBankRegion: 'CN', payeeName: '王明', payeeAccountNo: '6222000000000000', amount: 100, memo: '房租', executeAt: new Date(time + 120_000).toISOString(), confirmed: true, paymentPassword: '888888', clientRequestId: 'one' }
  return { get db() { return db }, api: build(), build, request, advance: () => { time += 180_000 }, restart: () => { db = JSON.parse(JSON.stringify(db)); return build() }, get writes() { return writes }, get executed() { return executed } }
}

test('scheduled instruction requires explicit consent/password, excludes FX, invalid dates and unsafe amounts without writes', async () => {
  const f = fixture(), initial = structuredClone(f.db)
  for (const [patch, code] of [[{ confirmed: false }, 'CONFIRMATION_REQUIRED'], [{ paymentPassword: '000000' }, 'BAD_PAY_PASSWORD'], [{ scope: 'overseas' }, 'SCHEDULE_UNSUPPORTED'], [{ payeeCurrency: 'USD' }, 'SCHEDULE_UNSUPPORTED'], [{ executeAt: '2026-02-30T00:00:00Z' }, 'INVALID_EXECUTION_TIME'], [{ executeAt: '2026-10-27T24:00:00Z' }, 'INVALID_EXECUTION_TIME'], [{ amount: Number.MAX_SAFE_INTEGER + 1 }, 'INVALID_AMOUNT'], [{ payeeAccountNo: '12345678901' }, 'INVALID_ACCOUNT_NO']]) await assert.rejects(f.api.createScheduledTransfer({ ...f.request, ...patch }), { code })
  assert.deepEqual(f.db, initial); assert.equal(f.writes, 0)
})

test('scheduling reserves no funds, persists no password, binds idempotency and executes exactly once across restart', async () => {
  const f = fixture(), balance = structuredClone(f.db.accounts)
  const plan = await f.api.createScheduledTransfer(f.request)
  assert.equal(plan.status, 'scheduled'); assert.equal(plan.fundsReserved, false)
  assert.deepEqual(f.db.accounts, balance); assert(!JSON.stringify(f.db).includes('888888'))
  assert.equal((await f.api.createScheduledTransfer(f.request)).id, plan.id)
  await assert.rejects(f.api.createScheduledTransfer({ ...f.request, amount: 101 }), { code: 'IDEMPOTENCY_CONFLICT' })
  assert.deepEqual(await f.api.settleScheduledTransfers(), [])
  f.advance(); const restarted = f.restart()
  assert.equal((await restarted.createScheduledTransfer(f.request)).id, plan.id, 'retry after due time returns accepted instruction')
  const [result] = await restarted.settleScheduledTransfers()
  assert.equal(result.status, 'executed'); assert.equal(result.transactionId, 'tx-1')
  assert.equal(f.db.accounts[0].balance, balance[0].balance - 100)
  assert.deepEqual(await restarted.settleScheduledTransfers(), []); assert.equal(f.executed, 1)
})

test('cancel is version-bound and failed due execution is visible without deduction or automatic retry', async () => {
  const f = fixture(), plan = await f.api.createScheduledTransfer(f.request)
  await assert.rejects(f.api.cancelScheduledTransfer(plan.id, 9), { code: 'VERSION_CONFLICT' })
  assert.equal((await f.api.cancelScheduledTransfer(plan.id, plan.version)).status, 'cancelled')
  await assert.rejects(f.api.cancelScheduledTransfer(plan.id, 2), { code: 'SCHEDULE_NOT_CANCELLABLE' })
  await f.api.createScheduledTransfer({ ...f.request, amount: 99999, clientRequestId: 'insufficient' })
  f.advance(); const balance = f.db.accounts[0].balance
  const [failed] = await f.api.settleScheduledTransfers()
  assert.equal(failed.status, 'failed'); assert.equal(failed.failureCode, 'INSUFFICIENT_FUNDS'); assert.equal(f.db.accounts[0].balance, balance)
  assert.deepEqual(await f.api.settleScheduledTransfers(), []); assert.equal(f.executed, 0)
})

test('AA exact remainder, duplicate request protection, evidence-bound collection and no fabricated money', async () => {
  const f = fixture(), balance = structuredClone(f.db.accounts), request = { title: '晚餐', amount: 100, currency: 'CNY', participants: ['张三', '李四', '王五'], clientRequestId: 'aa-one' }
  const split = await f.api.createSplitCollection(request)
  assert.deepEqual(split.participants.map(row => row.amount), [34, 33, 33]); assert.deepEqual(f.db.accounts, balance)
  assert.equal((await f.api.createSplitCollection(request)).id, split.id)
  await assert.rejects(f.api.createSplitCollection({ ...request, participants: ['张三', '李四'] }), { code: 'IDEMPOTENCY_CONFLICT' })
  const first = split.participants[0], args = { version: split.version, participantId: first.id, transactionId: 'in-one' }
  f.db.transactions.push({ id: 'in-one', direction: 'in', status: 'success', amount: 34, accountId: 'usd', detail: { counterpartyName: '张三' }, createdAt: '2026-10-27T00:00:00Z' })
  await assert.rejects(f.api.confirmSplitPayment(split.id, args), { code: 'SPLIT_PAYMENT_NOT_MATCHED' })
  f.db.transactions[0].accountId = 'cn'
  const collected = await f.api.confirmSplitPayment(split.id, args)
  assert.equal(collected.participants[0].status, 'paid'); assert.deepEqual(f.db.accounts, balance)
  await assert.rejects(f.api.cancelSplitCollection(split.id, split.version), { code: 'VERSION_CONFLICT' })
  const other = await f.api.createSplitCollection({ ...request, clientRequestId: 'aa-two' })
  await assert.rejects(f.api.confirmSplitPayment(other.id, { ...args, participantId: other.participants[0].id }), { code: 'SPLIT_PAYMENT_REUSED' })
  const reminder = await f.api.remindSplitParticipant(split.id, { version: collected.version, participantId: collected.participants[1].id })
  assert.equal(reminder.delivered, false); assert(reminder.text.includes('0.33 CNY'))
  const cancelled = await f.api.cancelSplitCollection(split.id, reminder.collection.version)
  assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.participants[0].status, 'paid'); assert.deepEqual(f.db.accounts, balance)
})

test('AA closes only after each distinct actual inbound payment, rejects malformed participants and customer-local IDs', async () => {
  const f = fixture(), request = { title: '晚餐', amount: 3, currency: 'CNY', participants: ['张三', '李四'], clientRequestId: 'aa-one' }
  for (const participants of [['张三'], ['张三', '张三'], ['张三', '']]) await assert.rejects(f.api.createSplitCollection({ ...request, participants }), error => error.status === 400)
  let split = await f.api.createSplitCollection(request)
  for (const participant of split.participants) {
    const id = `tx-${participant.id}`
    f.db.transactions.push({ id, direction: 'in', status: 'success', amount: participant.amount, accountId: 'cn', detail: { counterpartyName: participant.name }, createdAt: '2026-10-27T00:00:00Z' })
    split = await f.api.confirmSplitPayment(split.id, { participantId: participant.id, transactionId: id, version: split.version })
  }
  assert.equal(split.status, 'complete')
  const other = fixture()
  await assert.rejects(other.api.cancelSplitCollection(split.id, split.version), { code: 'SPLIT_NOT_FOUND' })
  await assert.rejects(other.api.cancelScheduledTransfer('someone-elses-plan', 1), { code: 'SCHEDULE_NOT_FOUND' })
})

test('execution errors including 4xx propagate to the bank transaction instead of committing partial mutations as failed', async () => {
  const f = fixture()
  const plan = await f.api.createScheduledTransfer(f.request)
  f.advance()
  let persisted = 0
  const api = createPaymentPlans({ getDb: () => f.db, persist: () => { persisted++ }, nextId: () => 'unused',
    verifyPassword: () => {}, resolveRecipient: async () => ({}), now: () => Date.parse(f.request.executeAt) + 1,
    executeTransfer: async () => { f.db.accounts[0].balance -= 100; throw Object.assign(Error('收款余额溢出'), { status: 400, code: 'INVALID_AMOUNT' }) } })
  await assert.rejects(api.settleScheduledTransfers(), { code: 'INVALID_AMOUNT' })
  assert.equal(persisted, 0, 'partial execution must never be persisted by scheduler')
  assert.equal((await api.listScheduledTransfers()).find(row => row.id === plan.id).status, 'scheduled')
})
