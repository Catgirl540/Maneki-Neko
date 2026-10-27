import test from 'node:test'
import assert from 'node:assert/strict'
import { advanceBirthdayPlans, cancelBirthdayPlan, confirmBirthdayOrder, createBirthdayPlan, listBirthdayPlans, previewBirthdayPlan } from '../shared/linked-plans.mjs'

const instant = value => Date.parse(value + '+08:00')
const now = instant('2026-10-27T10:00:00')
const profile = () => ({ user: { id: 'alice' }, accounts: [{ id: 'funding-cny', accountNo: '10001', currency: 'CNY', balance: 800000, available: 750000 }], currencyBalances: [{ id: 'alice-usd', currency: 'USD', balance: 100000, available: 90000 }], accountAliases: { legacy: 'funding-cny' }, transactions: [] })
const input = extra => ({ contactName: '爱人', relationship: '配偶', eventDate: '2026-10-31', amountCents: 100000, currency: 'CNY', accountId: 'legacy', confirmed: true, requestId: 'birthday-request-1', ...extra })

test('birthday reserve is real available-funds isolation and request/cancel/advance are idempotent', () => {
  const db = profile(), identities = structuredClone(db.accounts.map(row => ({ id: row.id, accountNo: row.accountNo })))
  const plan = createBirthdayPlan(db, input(), now)
  assert.equal(plan.reservation.status, 'held')
  assert.equal(plan.accountId, 'funding-cny')
  assert.equal(db.accounts[0].available, 650000)
  assert.equal(db.accounts[0].balance, 800000)
  assert.equal(createBirthdayPlan(db, input(), now + 1000).id, plan.id)
  assert.equal(db.accounts[0].available, 650000)
  assert.deepEqual(advanceBirthdayPlans(db, now + 1000), [])
  assert.throws(() => createBirthdayPlan(db, input({ amountCents: 100001 }), now), error => error.code === 'IDEMPOTENCY_CONFLICT')
  assert.throws(() => cancelBirthdayPlan(db, plan.id, {}, now), error => error.code === 'CONFIRMATION_REQUIRED')
  cancelBirthdayPlan(db, plan.id, { confirmed: true }, now)
  cancelBirthdayPlan(db, plan.id, { confirmed: true }, now + 1000)
  assert.equal(db.accounts[0].available, 750000, 'the unrelated transfer hold of 50000 remains')
  assert.equal(db.currencyBalances[0].available, 90000)
  assert.equal(db.transactions.length, 0)
  assert.deepEqual(db.accounts.map(row => ({ id: row.id, accountNo: row.accountNo })), identities)
})
test('future month reserve, reminder due and merchant confirmation use real states without invented orders', () => {
  const db = profile()
  const plan = createBirthdayPlan(db, input({ eventDate: '2026-11-10' }), now)
  assert.equal(plan.status, 'scheduled'); assert.equal(db.accounts[0].available, 750000)
  advanceBirthdayPlans(db, instant('2026-11-01T00:00:00'))
  assert.equal(listBirthdayPlans(db)[0].reservation.status, 'held'); assert.equal(db.accounts[0].available, 650000)
  assert.throws(() => confirmBirthdayOrder(db, plan.id, { confirmed: true }, instant('2026-11-07T09:00:00')), error => error.code === 'ORDER_NOT_DUE')
  advanceBirthdayPlans(db, instant('2026-11-08T09:00:00'))
  assert.equal(listBirthdayPlans(db)[0].order.status, 'awaiting_confirmation')
  assert.throws(() => confirmBirthdayOrder(db, plan.id, {}, instant('2026-11-08T09:00:00')), error => error.code === 'CONFIRMATION_REQUIRED')
  const confirmed = confirmBirthdayOrder(db, plan.id, { confirmed: true }, instant('2026-11-08T09:00:00'))
  assert.equal(confirmed.order.status, 'awaiting_merchant_connection'); assert.equal(confirmed.order.merchantOrderId, null)
  assert.equal(confirmed.merchantConnected, false); assert.equal(db.accounts[0].balance, 800000)
  // A persisted profile restores the hold and must never apply it a second time.
  const restored = JSON.parse(JSON.stringify(db))
  advanceBirthdayPlans(restored, instant('2026-11-08T10:00:00'))
  assert.equal(restored.accounts[0].available, 650000)
  assert.equal(listBirthdayPlans(restored)[0].status, 'awaiting_merchant', 'scan after merchant confirmation must not regress to reserved')
  advanceBirthdayPlans(restored, instant('2026-11-11T00:00:00'))
  advanceBirthdayPlans(restored, instant('2026-11-11T00:00:00'))
  assert.equal(restored.accounts[0].available, 750000); assert.equal(listBirthdayPlans(restored)[0].status, 'expired')
  assert.equal(createBirthdayPlan(restored, input({ eventDate: '2026-11-10' }), instant('2026-11-12T00:00:00')).id, plan.id)
  assert.equal(restored.accounts[0].available, 750000, 'retry after expiry cannot reserve again')
})
test('insufficient funds wait without debit; date, integer, owner and currency validation fail closed', () => {
  const db = profile(); db.accounts[0].available = 100
  const plan = createBirthdayPlan(db, input(), now)
  assert.equal(plan.status, 'needs_funds'); assert.equal(db.accounts[0].available, 100)
  assert.throws(() => confirmBirthdayOrder(db, plan.id, { confirmed: true }, instant('2026-10-29T09:00:00')), error => error.code === 'RESERVATION_REQUIRED')
  db.accounts[0].available = 300000
  advanceBirthdayPlans(db, instant('2026-10-29T09:00:00'))
  assert.equal(db.accounts[0].available, 200000)
  assert.equal(listBirthdayPlans(db)[0].status, 'awaiting_order')
  for (const extra of [{ confirmed: false }, { eventDate: '2026-02-30' }, { eventDate: '2026-10-26' }, { amountCents: 1.5 }, { amountCents: Number.MAX_SAFE_INTEGER }, { currency: 'USD' }, { accountId: 'someone-else' }]) assert.throws(() => createBirthdayPlan(profile(), input(extra), now))
  assert.throws(() => cancelBirthdayPlan({ ...profile(), user: { id: 'bob' }, birthdayPlans: db.birthdayPlans }, plan.id, { confirmed: true }, now), error => error.status === 404)
})
test('month-boundary birthdays show explicit earlier reservation timing before any mutation', () => {
  const db = profile(), preview = previewBirthdayPlan(db, input({ eventDate: '2026-11-01' }), now)
  assert.equal(preview.reserveAt, '2026-10-30T01:00:00.000Z')
  assert.equal(preview.orderAt, preview.reserveAt)
  assert.equal(db.birthdayPlans, undefined)
  assert.equal(db.accounts[0].available, 750000)
})

test('multiple reservations release only their own currency and leave unrelated holds intact', () => {
  const db = profile()
  const one = createBirthdayPlan(db, input(), now)
  const two = createBirthdayPlan(db, input({ requestId: 'birthday-request-2', contactName: '家人', amountCents: 200000 }), now)
  const usd = createBirthdayPlan(db, input({ requestId: 'birthday-request-3', currency: 'USD', accountId: 'alice-usd', amountCents: 5000 }), now)
  assert.equal(db.accounts[0].available, 450000)
  assert.equal(db.currencyBalances[0].available, 85000)
  cancelBirthdayPlan(db, two.id, { confirmed: true }, now)
  assert.equal(db.accounts[0].available, 650000)
  assert.equal(listBirthdayPlans(db).find(plan => plan.id === one.id).reservation.status, 'held')
  cancelBirthdayPlan(db, usd.id, { confirmed: true }, now)
  assert.equal(db.currencyBalances[0].available, 90000)
  advanceBirthdayPlans(db, instant('2026-11-01T00:00:00'))
  assert.equal(db.accounts[0].available, 750000)
  assert.equal(db.accounts[0].balance - db.accounts[0].available, 50000)
})

test('a corrupted original reservation cannot release unrelated funds or change availability', () => {
  for (const malformed of [-100000, 200000, 0.5, Number.MAX_SAFE_INTEGER]) {
    const db = profile(), plan = createBirthdayPlan(db, input(), now)
    db.birthdayPlans[0].reservation.amountCents = malformed
    assert.throws(() => cancelBirthdayPlan(db, plan.id, { confirmed: true }, now), error => error.code === 'INVALID_RESERVATION')
    assert.equal(db.accounts[0].available, 650000)
    assert.equal(db.birthdayPlans[0].reservation.status, 'held')
  }
})
