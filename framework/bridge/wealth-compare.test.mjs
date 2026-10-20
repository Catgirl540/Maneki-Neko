import test from 'node:test'
import assert from 'node:assert/strict'
import { compareWealthProducts } from './wealth-compare.mjs'

const product = (code, extra = {}) => ({ code, name: code, issuer: '测试发行方', category: 'fixed-income', risk: 'R2', principalProtected: false,
  benchmark: { kind: 'range', low: 0.02, high: 0.03, basis: '测试产品说明' }, nav: 1.01, navDate: '2026-10-20',
  minAmount: 10000, stepAmount: 100, term: '90 天', openEnded: false,
  ongoingFees: [{ label: '管理费', rate: 0.002 }], transactionFees: [{ label: '申购费', rate: 0.01 }], ...extra })
const products = [product('A'), product('B', { risk: 'R4', minAmount: 100000, term: '365 天' })]
const options = { firstProductCode: 'A', secondProductCode: 'B', amountCents: 10001 }
const overview = { account: { opened: true }, risk: { done: true, expired: false, level: 'C2' } }

test('comparison uses actual risk, fees and amount rules without authorizing or ranking a purchase', () => {
  const result = compareWealthProducts(products, overview, options)
  assert.deepEqual(result.products.map(p => p.code), ['A', 'B'])
  assert.equal(result.products[0].riskMatch.matched, true)
  assert.equal(result.products[1].riskMatch.matched, false)
  assert.equal(result.products[0].amountCheck.minimumMet, true)
  assert.equal(result.products[0].amountCheck.stepMet, false)
  assert.equal(result.products[1].amountCheck.minimumMet, false)
  assert.equal(result.products[0].amountCheck.estimatedSubscriptionFeeCents, 100)
  assert.equal(result.products[0].amountCheck.netAmountAfterEstimatedFeeCents, 9901)
  assert.equal(result.wealthAccountOpened, true)
  assert.equal(result.differences.risk, true)
  assert(!('recommendedProduct' in result) && !('purchaseApproved' in result))
  result.products[0].ongoingFees[0].rate = 0.9
  assert.equal(products[0].ongoingFees[0].rate, 0.002)
})

test('unassessed, expired and unknown risk remain distinct and cannot imply a match', () => {
  for (const [risk, status] of [[{ done: false, expired: true, level: 'C5' }, 'unassessed'], [{ done: true, expired: true, level: 'C5' }, 'expired'], [undefined, 'unknown'], [{ done: true, expired: false, level: null }, 'unknown']]) {
    const result = compareWealthProducts(products, { account: { opened: false }, risk }, { firstProductCode: 'A', secondProductCode: 'B' })
    assert.equal(result.products[0].riskMatch.status, status)
    assert.equal(result.products[0].riskMatch.matched, null)
    assert.equal(result.products[0].amountCheck, null)
    assert.equal(result.wealthAccountOpened, false)
  }
})

test('fee item order does not imply an economic difference', () => {
  const charges = [{ label: '管理费', rate: 0.002 }, { label: '托管费', rate: 0.001 }]
  const result = compareWealthProducts([product('A', { ongoingFees: charges }), product('B', { ongoingFees: [...charges].reverse() })], overview, options)
  assert.equal(result.differences.fees, false)
})

test('missing, duplicate and malformed catalog entries or amounts fail rather than fabricate values', () => {
  assert.throws(() => compareWealthProducts(products, overview, { ...options, secondProductCode: 'missing' }), /不存在/)
  assert.throws(() => compareWealthProducts(products, overview, { ...options, secondProductCode: 'A' }), /不同/)
  assert.throws(() => compareWealthProducts([...products, products[0]], overview, options), /不唯一/)
  for (const amountCents of [0, -1, 0.5, NaN, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => compareWealthProducts(products, overview, { ...options, amountCents }), /整数分/)
  for (const extra of [{ principalProtected: true }, { risk: 'R9' }, { minAmount: undefined }, { stepAmount: 0 }, { transactionFees: [{ label: '申购费', rate: NaN }] }, { benchmark: { kind: 'range', low: 0.1, high: 0.02, basis: '依据' } }]) {
    assert.throws(() => compareWealthProducts([product('A', extra), products[1]], overview, options), /不完整|基准/)
  }
})
