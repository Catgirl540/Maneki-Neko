import test from 'node:test'
import assert from 'node:assert/strict'
import { validateInvestPlan, nextInvestDate, transitionInvestPlan } from '../shared/invest-plan.mjs'
const now = Date.parse('2026-01-31T01:00:00Z')
const product = { code: 'BOND-A', risk: 'low', minAmount: 10000 }
const risk = { done: true, expired: false, level: 'C3' }

test('proposed investment dates follow weeks and calendar months in Shanghai, including leap years and legacy monthly day', () => {
  assert.equal(nextInvestDate('每周', now), '2026-02-07')
  assert.equal(nextInvestDate('每两周', now), '2026-02-14')
  assert.equal(nextInvestDate('每月', now), '2026-02-28')
  assert.equal(nextInvestDate('每月', Date.parse('2028-01-31T01:00:00Z')), '2028-02-29')
  assert.equal(nextInvestDate('每周', Date.parse('2026-10-19T17:00:00Z')), '2026-10-27')
  assert.equal(nextInvestDate('每月 8 日', Date.parse('2026-10-01T01:00:00Z')), '2026-10-08')
  assert.equal(nextInvestDate('每月 8 日', Date.parse('2026-10-08T01:00:00Z')), '2026-11-08')
  assert.throws(() => nextInvestDate('每年', now), error => error.code === 'INVALID_CYCLE')
})

test('unknown product risk, incomplete assessments and invalid amounts cannot bypass suitability', () => {
  validateInvestPlan(product, risk, true, 10000, '每月')
  for (const state of [{ ...risk, done: false }, { ...risk, expired: true }, { ...risk, level: 'C9' }, { ...risk, level: null }]) assert.throws(() => validateInvestPlan(product, state, true, 10000, '每月'), error => error.code === 'WEALTH_PREREQUISITE')
  for (const amount of [0, -1, 1, 10000.1, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => validateInvestPlan(product, risk, true, amount, '每月'), error => error.code === 'INVALID_AMOUNT')
  assert.throws(() => validateInvestPlan({ ...product, risk: 'unrated' }, risk, true, 10000, '每月'), error => error.code === 'INVALID_INVEST_PRODUCT')
  assert.throws(() => validateInvestPlan({ ...product, risk: 'high' }, risk, true, 10000, '每月'), error => error.code === 'RISK_MISMATCH')
})

test('plan transitions are versioned, termination is terminal, history is preserved and no-op does not advance revision', () => {
  const original = { id: 'owned', status: 'active', cycle: '每周', executedRuns: 3, totalInvested: 30000, nextRunAt: '2025-12-20' }
  const paused = transitionInvestPlan(original, { status: 'paused', expectedRevision: 0 }, now)
  assert.equal(paused.revision, 1)
  assert.equal(paused.nextRunAt, original.nextRunAt)
  assert.equal(original.status, 'active')
  assert.throws(() => transitionInvestPlan(paused, { status: 'active', expectedRevision: 0 }, now), error => error.code === 'INVEST_PLAN_CHANGED')
  const resumed = transitionInvestPlan(paused, { status: 'active', expectedRevision: 1 }, now)
  assert.equal(resumed.nextRunAt, '2026-02-07')
  assert.equal(resumed.executedRuns, 3); assert.equal(resumed.totalInvested, 30000)
  assert.deepEqual(transitionInvestPlan(resumed, { status: 'active', expectedRevision: 2 }, now), resumed)
  const terminated = transitionInvestPlan(resumed, { status: 'terminated', expectedRevision: 2 }, now)
  assert.equal(terminated.status, 'terminated')
  assert.ok(terminated.terminatedAt)
  assert.throws(() => transitionInvestPlan(terminated, { status: 'active', expectedRevision: 3 }, now), error => error.code === 'INVALID_PLAN_TRANSITION')
  assert.throws(() => transitionInvestPlan(terminated, { status: 'paused', expectedRevision: 3, amount: 1 }, now), error => error.code === 'INVALID_PLAN_STATUS')
  assert.throws(() => transitionInvestPlan(resumed, { status: 'cancelled', expectedRevision: 2 }, now), error => error.code === 'INVALID_PLAN_STATUS')
})
