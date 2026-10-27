import test from 'node:test'
import assert from 'node:assert/strict'
import { wealthHoldingState, wealthRedemptionQuote } from '../shared/wealth-redemption.mjs'
import { recommendWealthProducts } from '../shared/wealth-recommendation.mjs'
const now = Date.parse('2026-10-27T04:00:00Z'), day = 86400000
const product = { code: 'EQ', name: '演示权益', risk: 'R4', openEnded: true, term: '随时赎回', minAmount: 100, stepAmount: 100, nav: 1,
  ongoingFees: [{ label: '管理费', rate: 0.003 }], transactionFees: [{ label: '赎回费（持有不满 7 天）', rate: 0.005, holdingDaysLessThan: 7 }] }
const holding = age => ({ shares: 10000, purchasedAt: new Date(now - age).toISOString(), redeemableAt: null })
test('redemption holding-period fee switches at exactly seven full days, with legacy holding compatibility', () => {
  assert.equal(wealthRedemptionQuote(product, holding(7 * day - 1), 10000, now).fee, 50)
  assert.equal(wealthRedemptionQuote(product, holding(7 * day), 10000, now).fee, 0)
  assert.equal(wealthRedemptionQuote(product, holding(30 * day), 10000, now).fee, 0)
  for (const shares of [NaN, Infinity, -1, 0, '100', 0.001]) assert.throws(() => wealthRedemptionQuote(product, holding(day), shares, now), error => error.code === 'INVALID_SHARES')
})
test('mixed-age subscription lots redeem FIFO and never waive the new subscription fee', () => {
  const h = { ...holding(30 * day), shares: 20000, lots: [{ shares: 10000, purchasedAt: new Date(now - 30 * day).toISOString(), redeemableAt: null }, { shares: 10000, purchasedAt: new Date(now - day).toISOString(), redeemableAt: null }] }
  const before = structuredClone(h), quote = wealthRedemptionQuote(product, h, 15000, now)
  assert.equal(quote.fee, 25); assert.equal(quote.net, 14975)
  assert.equal(quote.remainingLots.length, 1); assert.equal(quote.remainingLots[0].shares, 5000)
  assert.equal(wealthRedemptionQuote(product, { ...h, shares: 5000, lots: quote.remainingLots }, 5000, now).fee, 25)
  assert.deepEqual(h, before)
  assert.throws(() => wealthRedemptionQuote(product, { ...h, shares: 1 }, 1, now), error => error.code === 'INVALID_HOLDING_DATA')
})
test('each additional closed subscription retains its own maturity and blocks redemption of unopened shares', () => {
  const h = { ...holding(100 * day), shares: 20000, lots: [{ shares: 10000, purchasedAt: new Date(now - 100 * day).toISOString(), redeemableAt: new Date(now - day).toISOString() }, { shares: 10000, purchasedAt: new Date(now - day).toISOString(), redeemableAt: new Date(now + 89 * day).toISOString() }] }
  assert.equal(wealthHoldingState(h, now).redeemableShares, 10000)
  assert.equal(wealthHoldingState(h, now).closed, false)
  assert.throws(() => wealthRedemptionQuote(product, h, 15000, now), error => error.code === 'IN_CLOSED_PERIOD')
  const quote = wealthRedemptionQuote(product, h, 10000, now)
  const remaining = { ...h, shares: 10000, lots: quote.remainingLots }
  assert.equal(wealthHoldingState(remaining, now).closed, true)
  assert.equal(wealthHoldingState(remaining, now).redeemableAt, h.lots[1].redeemableAt)
})
test('rule recommendations enforce actual risk, amount, term and bank priority constraints without mutation', () => {
  const overview = { account: { opened: true }, risk: { done: true, expired: false, level: 'C2', expiresAt: new Date(now + day).toISOString() } }
  const catalog = [{ ...product, code: 'CASH', risk: 'R1', transactionFees: [] }, { ...product, code: 'FIX', risk: 'R2', openEnded: false, term: '90 天' }, product, { ...product, code: 'VIP', risk: 'R1', priorityRestricted: true }]
  const before = structuredClone({ overview, catalog })
  const result = recommendWealthProducts(catalog, overview, { amountCents: 10000, liquidity: 'open' }, now)
  assert.deepEqual(result.matches.map(item => item.code), ['CASH'])
  assert.equal(result.totalMatches, 1)
  assert(result.excluded.find(item => item.code === 'EQ').reasons.includes('超出风险承受等级'))
  assert.equal(recommendWealthProducts(catalog, overview, { amountCents: 10000, maxTermDays: 30 }, now).matches.length, 1)
  assert.equal(recommendWealthProducts(catalog, { ...overview, risk: { ...overview.risk, expired: true } }, { amountCents: 10000 }, now).matches.length, 0)
  assert.equal(recommendWealthProducts(catalog, overview, { amountCents: 99 }, now).matches.length, 0)
  assert.throws(() => recommendWealthProducts(catalog, overview, { amountCents: Infinity }, now))
  assert.deepEqual({ overview, catalog }, before)
})
