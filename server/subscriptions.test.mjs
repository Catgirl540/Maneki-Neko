import test from 'node:test'
import assert from 'node:assert/strict'
import { analyzeSubscriptionCandidates, renewalReminderDraft } from '../shared/subscriptions.mjs'

const account = { id: 'one-funding-cny', currency: 'CNY' }
const now = Date.parse('2026-10-27T09:00:00+08:00')
const row = (id, date, extra = {}) => ({ id, accountId: account.id, amount: 2500, signedAmount: -2500, counterparty: '视频会员', direction: 'out', status: 'success', category: 'subscription', createdAt: date + 'T10:00:00+08:00', ...extra })
const page = items => ({ items, page: 1, size: 200, total: items.length })
test('subscription candidates require consistent observed dates and amounts, with actual evidence', () => {
  const items = [row('a', '2026-08-15'), row('b', '2026-09-15'), row('c', '2026-10-15'), row('pending', '2026-10-16', { status: 'pending' }), row('income', '2026-10-16', { direction: 'in', signedAmount: 2500 }), row('transfer', '2026-10-16', { category: 'transfer' })]
  const result = analyzeSubscriptionCandidates(account, { ...page(items), total: 250 }, now)
  assert.equal(result.candidates.length, 1)
  assert.equal(result.candidates[0].cycle, 'monthly')
  assert.deepEqual(result.candidates[0].evidence.map(item => item.transactionId), ['a', 'b', 'c'])
  assert.equal(result.coverage.truncated, true)
  assert.equal(result.reminderCreated, false)
  assert.equal(analyzeSubscriptionCandidates(account, page(items.slice(0, 2)), now).candidates.length, 0)
  assert.equal(analyzeSubscriptionCandidates(account, page(items.slice(0, 3).map((item, index) => ({ ...item, amount: 2500 + index, signedAmount: -2500 - index }))), now).candidates.length, 0)
})
test('same-day retries are not subscription cadence; ownership, currency and exact money fail closed', () => {
  assert.equal(analyzeSubscriptionCandidates(account, page([row('a', '2026-10-15'), row('b', '2026-10-15'), row('c', '2026-10-15')]), now).candidates.length, 0)
  for (const extra of [{ accountId: 'other-customer' }, { currency: 'USD' }, { amount: 25.5 }, { signedAmount: 2500 }, { amount: Number.MAX_SAFE_INTEGER + 1 }]) assert.throws(() => analyzeSubscriptionCandidates(account, page([row('a', '2026-10-15', extra)]), now))
  assert.throws(() => analyzeSubscriptionCandidates(account, page([row('a', '2026-10-15'), row('a', '2026-10-16')]), now))
  assert.throws(() => analyzeSubscriptionCandidates(account, { ...page([]), page: 2 }, now))
})
test('renewal suggestion is Shanghai time, one-time and read-only, and rejects past/invalid dates', () => {
  const contract = { id: 'contract-1', merchant: '视频会员', amount: 2500, enabled: true, nextRunAt: '2026-11-01' }
  const draft = renewalReminderDraft(contract, now)
  assert.equal(draft.time, '2026-10-30T09:00')
  assert(draft.title.includes('CNY 25.00'))
  assert.equal(draft.reminderCreated, false)
  assert.equal(renewalReminderDraft({ ...contract, nextRunAt: '2026-10-31T18:00:00Z' }, now).time, '2026-10-30T09:00')
  for (const extra of [{ enabled: false }, { nextRunAt: '2026-02-30' }, { nextRunAt: '2026-10-28' }, { amount: -1 }, { currency: '???' }]) assert.throws(() => renewalReminderDraft({ ...contract, ...extra }, now))
})
