/** Internal demo shares retain the existing cents-based convention. */
const DAY = 86_400_000
const EPSILON = 0.000001
const fail = (message, code) => { throw Object.assign(new Error(message), { status: 400, code }) }

export function wealthHoldingLots(holding) {
  if (!Number.isFinite(holding.shares) || holding.shares <= 0 || !Number.isSafeInteger(Math.round(holding.shares * 100))) fail('持仓总份额无效，请联系客服核对', 'INVALID_HOLDING_DATA')
  if (holding.lots !== undefined && (!Array.isArray(holding.lots) || !holding.lots.length)) fail('持仓批次数据无效，请联系客服核对', 'INVALID_HOLDING_DATA')
  const lots = holding.lots === undefined
    ? [{ shares: holding.shares, purchasedAt: holding.purchasedAt, redeemableAt: holding.redeemableAt ?? null }]
    : holding.lots.map(lot => ({ ...lot }))
  if (lots.some(lot => !Number.isFinite(lot.shares) || lot.shares <= 0 || !Number.isFinite(Date.parse(lot.purchasedAt)) || (lot.redeemableAt != null && !Number.isFinite(Date.parse(lot.redeemableAt))))) fail('持仓批次数据无效，请联系客服核对', 'INVALID_HOLDING_DATA')
  if (Math.abs(lots.reduce((sum, lot) => sum + lot.shares, 0) - holding.shares) > EPSILON) fail('持仓批次与总份额不一致，请联系客服核对', 'INVALID_HOLDING_DATA')
  return lots
}

export function wealthHoldingState(holding, now = Date.now()) {
  const lots = wealthHoldingLots(holding)
  const available = lot => lot.redeemableAt == null || (Number.isFinite(Date.parse(lot.redeemableAt)) && now >= Date.parse(lot.redeemableAt))
  const redeemableShares = Number(lots.filter(available).reduce((sum, lot) => sum + lot.shares, 0).toFixed(8))
  const dates = lots.filter(lot => !available(lot)).map(lot => lot.redeemableAt).filter(Boolean).sort()
  return { lots, redeemableShares, closed: redeemableShares <= 0, redeemableAt: redeemableShares > 0 ? null : dates[0] ?? holding.redeemableAt ?? null }
}

/** FIFO redemption: each subscription keeps its own holding and closed period. */
export function wealthRedemptionQuote(product, holding, shares = holding.shares, now = Date.now()) {
  if (!Number.isFinite(shares) || shares <= 0 || !Number.isSafeInteger(Math.round(shares * 100))) fail('赎回份额必须是有效的正数', 'INVALID_SHARES')
  if (shares > holding.shares) fail('赎回份额超过持有份额', 'EXCEED_SHARES')
  const state = wealthHoldingState(holding, now)
  if (shares > state.redeemableShares) fail('赎回份额超过已开放份额，请等待对应批次封闭期结束', 'IN_CLOSED_PERIOD')
  const item = product.transactionFees.find(fee => fee.label.startsWith('赎回'))
  let needed = shares, taxableShares = 0
  const remainingLots = []
  const lots = state.lots.sort((a, b) => Date.parse(a.purchasedAt) - Date.parse(b.purchasedAt))
  for (const lot of lots) {
    const available = lot.redeemableAt == null || now >= Date.parse(lot.redeemableAt)
    const taken = available ? Math.min(needed, lot.shares) : 0
    const age = now - Date.parse(lot.purchasedAt)
    if (item && (item.holdingDaysLessThan == null || !Number.isFinite(age) || age < item.holdingDaysLessThan * DAY)) taxableShares += taken
    needed = Math.max(0, needed - taken)
    const remaining = Number((lot.shares - taken).toFixed(8))
    if (remaining > 0) remainingLots.push({ ...lot, shares: remaining })
  }
  const gross = Math.round(shares * product.nav)
  if (!Number.isSafeInteger(gross) || gross <= 0) fail('赎回金额不足一分或超过有效范围', 'INVALID_SHARES')
  const fee = Math.min(gross, Math.round(taxableShares * product.nav * (item?.rate ?? 0)))
  return { shares, gross, fee, net: gross - fee, remainingLots, redeemableShares: state.redeemableShares }
}
