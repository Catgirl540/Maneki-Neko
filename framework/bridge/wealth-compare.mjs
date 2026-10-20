import { bankError } from './bank-error.mjs'
import { summarizeRiskAssessment } from './wealth-risk.mjs'

const fail = message => { throw bankError(message, 502, 'INVALID_PRODUCT_DATA') }
const cents = n => Number.isSafeInteger(n) && n >= 0
const feeSignature = value => JSON.stringify([...value].sort((a, b) => a.label.localeCompare(b.label) || a.rate - b.rate))
function fees(value) {
  if (!Array.isArray(value) || value.some(x => typeof x?.label !== 'string' || !x.label.trim() || !Number.isFinite(x.rate) || x.rate < 0 || x.rate > 1)) fail('产品费率数据不完整，暂不能比较')
  return value.map(({ label, rate }) => ({ label, rate }))
}
function benchmark(value) {
  if (typeof value?.basis !== 'string' || !value.basis.trim()) fail('产品业绩基准缺少依据，暂不能比较')
  if (value.kind === 'range' && Number.isFinite(value.low) && Number.isFinite(value.high) && value.low <= value.high) return { kind: 'range', low: value.low, high: value.high, basis: value.basis }
  if (value.kind === 'formula' && typeof value.formula === 'string' && value.formula.trim()) return { kind: 'formula', formula: value.formula, basis: value.basis }
  fail('产品业绩基准数据不完整，暂不能比较')
}

/** Side-effect free comparison of actual catalog entries. No forecasts or purchase authorization. */
export function compareWealthProducts(catalog, overview, { firstProductCode, secondProductCode, amountCents } = {}) {
  const codes = [firstProductCode, secondProductCode].map(code => typeof code === 'string' ? code.trim() : '')
  if (codes.some(code => !code || code.length > 80)) throw bankError('请提供两个明确的理财产品代码')
  if (codes[0] === codes[1]) throw bankError('请选择两个不同的理财产品')
  if (amountCents !== undefined && (!cents(amountCents) || amountCents === 0)) throw bankError('比较金额必须为大于零的整数分')
  if (!Array.isArray(catalog)) fail('银行产品列表返回格式无效')
  const riskAssessment = summarizeRiskAssessment(overview?.risk)
  const maximumRisk = riskAssessment.status === 'valid' && riskAssessment.level ? Number(riskAssessment.level.slice(1)) : null
  const products = codes.map(code => {
    const matches = catalog.filter(p => p?.code === code)
    if (matches.length === 0) throw bankError(`产品 ${code} 不存在，请重新查询产品目录`, 404, 'NOT_FOUND')
    if (matches.length !== 1) fail('产品代码不唯一，暂不能比较')
    const p = matches[0]
    if (typeof p.name !== 'string' || !p.name.trim() || !/^R[1-5]$/.test(p.risk)
        || p.principalProtected !== false || !cents(p.minAmount) || !Number.isSafeInteger(p.stepAmount) || p.stepAmount <= 0
        || typeof p.term !== 'string' || !p.term.trim() || typeof p.openEnded !== 'boolean') fail('产品风险、金额或期限数据不完整，暂不能比较')
    const ongoingFees = fees(p.ongoingFees), transactionFees = fees(p.transactionFees)
    const riskMatched = maximumRisk === null ? null : Number(p.risk.slice(1)) <= maximumRisk
    const subscriptionRate = transactionFees.find(f => f.label.startsWith('申购'))?.rate ?? 0
    const estimatedFee = amountCents === undefined ? null : Math.round(amountCents * subscriptionRate)
    return {
      code: p.code, name: p.name, issuer: p.issuer ?? null, category: p.category ?? null,
      risk: p.risk, principalProtected: false, benchmark: benchmark(p.benchmark),
      nav: Number.isFinite(p.nav) ? p.nav : null, navDate: p.navDate ?? null,
      sevenDayYield: Number.isFinite(p.sevenDayYield) ? p.sevenDayYield : null,
      sinceInception: Number.isFinite(p.sinceInception) ? p.sinceInception : null,
      volatility: Number.isFinite(p.volatility) ? p.volatility : null,
      minAmountCents: p.minAmount, stepAmountCents: p.stepAmount, term: p.term, openEnded: p.openEnded,
      ongoingFees, transactionFees,
      riskMatch: { status: maximumRisk === null ? riskAssessment.status === 'valid' ? 'unknown' : riskAssessment.status : riskMatched ? 'matched' : 'exceeds-customer-risk', matched: riskMatched },
      amountCheck: amountCents === undefined ? null : {
        amountCents, minimumMet: amountCents >= p.minAmount, stepMet: amountCents % p.stepAmount === 0,
        estimatedSubscriptionFeeCents: estimatedFee, netAmountAfterEstimatedFeeCents: amountCents - estimatedFee,
      },
    }
  })
  return {
    source: 'bank-product-catalog', products, riskAssessment,
    wealthAccountOpened: typeof overview?.account?.opened === 'boolean' ? overview.account.opened : null,
    differences: {
      risk: products[0].risk !== products[1].risk,
      term: products[0].term !== products[1].term || products[0].openEnded !== products[1].openEnded,
      minimumAmount: products[0].minAmountCents !== products[1].minAmountCents,
      fees: feeSignature(products[0].ongoingFees) !== feeSignature(products[1].ongoingFees) || feeSignature(products[0].transactionFees) !== feeSignature(products[1].transactionFees),
    },
    notice: '仅比较银行当次返回的产品与风险状态，不排序推荐、不作投资决定；业绩基准和历史表现不承诺收益。金额检查不代表余额足够或申购获批，实际申购仍需适当性、金额、账户、风险确认和支付密码验证。',
  }
}
