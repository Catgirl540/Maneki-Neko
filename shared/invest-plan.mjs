const fail = (message, code, status = 400) => { throw Object.assign(new Error(message), { status, code }) }
const DAY = 86_400_000
export const INVEST_CYCLES = ['每周', '每两周', '每月']

export function validateInvestPlan(product, risk, opened, amount, cycle) {
  if (!opened || risk?.done !== true || risk.expired !== false || !/^C[1-5]$/.test(risk.level)) fail('请先开立理财账户并完成有效风险测评', 'WEALTH_PREREQUISITE')
  if (!INVEST_CYCLES.includes(cycle)) fail('请选择每周、每两周或每月', 'INVALID_CYCLE')
  if (!product) fail('投资产品不存在', 'PRODUCT_NOT_FOUND', 404)
  if (!['low', 'medium', 'high'].includes(product.risk) || !Number.isSafeInteger(product.minAmount) || product.minAmount <= 0) fail('投资产品风险或起投数据不完整', 'INVALID_INVEST_PRODUCT')
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount < product.minAmount) fail('金额必须是达到产品起投额的正整数分', 'INVALID_AMOUNT')
  if ((product.risk === 'medium' && !['C3', 'C4', 'C5'].includes(risk.level)) || (product.risk === 'high' && !['C4', 'C5'].includes(risk.level))) fail('风险承受能力不匹配', 'RISK_MISMATCH')
}

// Proposed dates only: this module never executes a payment or schedules a job.
export function nextInvestDate(cycle, now = Date.now()) {
  const local = new Date(now + 8 * 60 * 60 * 1000)
  if (!Number.isFinite(local.getTime())) fail('计划时间无效', 'INVALID_PLAN_DATE')
  const start = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate())
  if (cycle === '每周' || cycle === '每两周') return new Date(start + (cycle === '每周' ? 7 : 14) * DAY).toISOString().slice(0, 10)
  const legacy = /^每月 ([1-9]|1\d|2[0-8]) 日$/.exec(cycle)
  if (cycle !== '每月' && !legacy) fail('现有计划周期不支持恢复，请核对计划', 'INVALID_CYCLE')
  const day = legacy ? Number(legacy[1]) : local.getUTCDate()
  const month = local.getUTCMonth() + (legacy && day > local.getUTCDate() ? 0 : 1)
  const lastDay = new Date(Date.UTC(local.getUTCFullYear(), month + 1, 0)).getUTCDate()
  return new Date(Date.UTC(local.getUTCFullYear(), month, Math.min(day, lastDay))).toISOString().slice(0, 10)
}

export function transitionInvestPlan(plan, request, now = Date.now()) {
  if (!plan) fail('定投计划不存在', 'INVEST_PLAN_NOT_FOUND', 404)
  if (!request || Object.keys(request).some(key => !['status', 'expectedRevision', 'paymentPassword'].includes(key)) || !['active', 'paused', 'terminated'].includes(request.status)) fail('定投状态参数无效', 'INVALID_PLAN_STATUS')
  if (!Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 0 || request.expectedRevision !== (plan.revision ?? 0)) fail('定投计划已变化，请重新查询确认', 'INVEST_PLAN_CHANGED', 409)
  if (!['active', 'paused', 'terminated'].includes(plan.status) || (plan.status === 'terminated' && request.status !== 'terminated')) fail('已终止或未知状态的计划不能恢复', 'INVALID_PLAN_TRANSITION', 409)
  if (plan.status === request.status) return { ...plan }
  const revision = (plan.revision ?? 0) + 1
  if (!Number.isSafeInteger(revision)) fail('定投版本号无效', 'INVEST_PLAN_CHANGED', 409)
  return { ...plan, status: request.status, revision, updatedAt: new Date(now).toISOString(),
    ...(request.status === 'active' ? { nextRunAt: nextInvestDate(plan.cycle, now) } : {}),
    ...(request.status === 'terminated' ? { terminatedAt: new Date(now).toISOString() } : {}) }
}
