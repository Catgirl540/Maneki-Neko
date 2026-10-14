/** 给模型的测评状态。银行 expired 也用于阻止未测评客户申购，不能据此推断测评历史。 */
export function summarizeRiskAssessment(risk) {
  const empty = { level: null, score: null, assessedAt: null, expiresAt: null }
  if (risk?.done === false) return {
    status: 'unassessed', statusLabel: '尚未完成风险测评', done: false, expired: false, ...empty,
  }
  if (risk?.done !== true || typeof risk.expired !== 'boolean') return {
    status: 'unknown', statusLabel: '暂无法确认风险测评状态', done: null, expired: null, ...empty,
  }
  return {
    status: risk.expired ? 'expired' : 'valid',
    statusLabel: risk.expired ? '风险测评已完成但已过期' : '风险测评已完成且未过期',
    done: true, expired: risk.expired,
    level: /^C[1-5]$/.test(risk.level) ? risk.level : null,
    score: typeof risk.score === 'number' && Number.isFinite(risk.score) ? risk.score : null,
    assessedAt: typeof risk.assessedAt === 'string' && Number.isFinite(Date.parse(risk.assessedAt)) ? risk.assessedAt : null,
    expiresAt: typeof risk.expiresAt === 'string' && Number.isFinite(Date.parse(risk.expiresAt)) ? risk.expiresAt : null,
  }
}
