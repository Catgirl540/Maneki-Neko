/** Transparent catalog matching only; no return forecasts or purchase authorization. */
export function recommendWealthProducts(catalog, overview, { amountCents, liquidity = 'any', maxTermDays, limit = 5 } = {}, now = Date.now()) {
  const fail = message => { throw Object.assign(new Error(message), { status: 400, code: 'INVALID_WEALTH_PREFERENCES' }) }
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) fail('请提供拟投入的正整数分金额')
  if (!['any', 'open'].includes(liquidity)) fail('流动性条件必须为 any 或 open')
  if (maxTermDays !== undefined && (!Number.isSafeInteger(maxTermDays) || maxTermDays <= 0 || maxTermDays > 36500)) fail('资金期限必须为 1–36500 天')
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10) fail('推荐数量必须为 1–10')
  if (!Array.isArray(catalog) || new Set(catalog.map(product => product?.code)).size !== catalog.length) fail('产品目录无效，请稍后重试')
  const risk = overview?.risk
  const eligible = risk?.done === true && risk.expired === false && /^C[1-5]$/.test(risk.level) && Number.isFinite(Date.parse(risk.expiresAt)) && now < Date.parse(risk.expiresAt)
  const riskAssessment = { status: !risk?.done ? 'unassessed' : !eligible ? 'expired-or-unknown' : 'valid', level: eligible ? risk.level : null }
  const matches = [], excluded = []
  for (const product of catalog) {
    if (typeof product?.code !== 'string' || !product.code || typeof product.name !== 'string' || !/^R[1-5]$/.test(product.risk)
      || !Number.isSafeInteger(product.minAmount) || product.minAmount <= 0 || !Number.isSafeInteger(product.stepAmount) || product.stepAmount <= 0
      || typeof product.openEnded !== 'boolean' || !Array.isArray(product.transactionFees) || !Array.isArray(product.ongoingFees)
      || [...product.transactionFees, ...product.ongoingFees].some(fee => !Number.isFinite(fee.rate) || fee.rate < 0 || fee.rate > 1)) fail('产品数据不完整，暂不能推荐')
    const reasons = []
    if (!eligible) reasons.push('需要有效风险测评')
    else if (Number(product.risk.slice(1)) > Number(risk.level.slice(1))) reasons.push('超出风险承受等级')
    if (amountCents < product.minAmount) reasons.push('未达到起购金额')
    if (amountCents % product.stepAmount !== 0) reasons.push('不满足金额递增规则')
    if (liquidity === 'open' && !product.openEnded) reasons.push('不符合开放式赎回要求')
    const termDays = product.openEnded ? 0 : /^\d+\s*天$/.test(product.term) ? Number(product.term.replace(/\D/g, '')) : null
    if (maxTermDays !== undefined && (termDays === null || termDays > maxTermDays)) reasons.push('超过可接受资金期限')
    if (product.priorityRestricted) reasons.push('当前会员优先购窗口限制')
    if (reasons.length) { excluded.push({ code: product.code, reasons }); continue }
    const annualFeeRate = product.ongoingFees.reduce((sum, fee) => sum + fee.rate, 0)
    const subscriptionRate = product.transactionFees.find(fee => fee.label.startsWith('申购'))?.rate ?? 0
    matches.push({ code: product.code, name: product.name, risk: product.risk, openEnded: product.openEnded, termDays,
      minAmountCents: product.minAmount, annualFeeRate, subscriptionRate, estimatedSubscriptionFeeCents: Math.round(amountCents * subscriptionRate),
      reasons: ['符合当前风险测评', '符合拟投入金额及递增规则', product.openEnded ? '开放式产品' : `封闭期 ${termDays ?? product.term} 天`] })
  }
  matches.sort((a, b) => Number(a.risk.slice(1)) - Number(b.risk.slice(1)) || a.annualFeeRate - b.annualFeeRate || a.subscriptionRate - b.subscriptionRate || a.code.localeCompare(b.code))
  return { source: 'bank-product-catalog', asOf: new Date(now).toISOString(), criteria: { amountCents, liquidity, maxTermDays: maxTermDays ?? null },
    ranking: '风险等级由低到高，其次年度费用率、申购费率及产品代码', riskAssessment, wealthAccountOpened: overview?.account?.opened === true,
    matches: matches.slice(0, limit), totalMatches: matches.length, excluded,
    notice: '按你提供的金额、期限与当前风险测评做透明规则筛选；排序不预测收益，不代表个性化投资建议或申购批准。目录为虚构演示产品，申购仍需独立确认、余额、适当性与支付密码验证。' }
}
