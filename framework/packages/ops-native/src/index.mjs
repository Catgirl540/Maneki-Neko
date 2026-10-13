import { OPS_NATIVE_TOOLS } from './names.mjs'
export const name = 'ops-native'
export const inject = ['tools', 'approval', 'subprocess']
export function apply(ctx) {
  if (process.env.LUCKYCAT_STAFF_MODE !== 'ops') throw Error('原生运维工具只能在独立运维运行时启用')
  const executions = new Map(), requests = new Map()
  const requestKey = (sessionId, callId) => `${sessionId}\0${callId}`
  const native = name => OPS_NATIVE_TOOLS.includes(name)
  const send = async (path, data, signal) => {
    const response = await fetch(`${process.env.LUCKYCAT_OPS_GATE_URL}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-luckycat-internal': process.env.LUCKYCAT_INTERNAL_TOKEN }, body: JSON.stringify(data), signal })
    const result = await response.json()
    if (!response.ok) throw Error(result.error ?? '运维权限校验失败')
    return result
  }
  ctx.on('tools/pre-execute', async (exec, next) => {
    const previous = await next()
    if (!native(exec.name) || previous.kind === 'deny' || previous.kind === 'cancel') return previous
    const sessionId = String(exec.agent?.session.id ?? '')
    if (!sessionId) return { kind: 'deny', reason: '运维工具缺少员工会话' }
    try {
      const challenge = await send('/prepare', { sessionId, callId: String(exec.callId), toolName: exec.name, arguments: exec.arguments, forceReview: previous.kind === 'ask' }, exec.signal)
      if (challenge.risk.action === 'deny') return { kind: 'deny', reason: '操作被运维安全策略拒绝，不能通过确认绕过' }
      const record = { challenge, input: { sessionId, callId: String(exec.callId), toolName: exec.name, arguments: exec.arguments }, ready: true }
      executions.set(exec.token, record); requests.set(requestKey(sessionId, exec.callId), record)
      return challenge.risk.action === 'review' ? { kind: 'ask', reason: '该操作需运维员工确认' } : previous
    } catch (error) { return { kind: 'deny', reason: error.message } }
  }, { prepend: true })
  ctx.tools.guard(exec => native(exec.name) && !executions.get(exec.token)?.ready ? '原生工具未通过本次运维身份和风险检查' : undefined)
  ctx.on('approval/request', async (request, next) => {
    if (!native(request.toolName)) return next()
    const record = requests.get(requestKey(String(request.agent.session.id), String(request.callId)))
    if (!record || record.challenge.risk.action !== 'review') return 'rejected'
    try {
      const response = await fetch(process.env.LUCKYCAT_CONSENT_URL, { method: 'POST', headers: { 'content-type': 'application/json', 'x-luckycat-internal': process.env.LUCKYCAT_INTERNAL_TOKEN }, body: JSON.stringify(record.challenge), signal: request.signal })
      const answer = await response.json()
      return response.ok && answer.challengeId === record.challenge.challengeId && answer.decision === 'approve' ? 'allowed-once' : 'rejected'
    } catch { return 'unavailable' }
  })
  ctx.on('tools/execute', async (exec, next) => {
    if (!native(exec.name)) return next()
    const record = executions.get(exec.token)
    if (!record) throw Error('缺少本次原生工具风险授权')
    await send('/consume', { ...record.input, arguments: exec.arguments }, exec.signal)
    const result = await next()
    await send('/result', { ...record.input, arguments: undefined, isError: result.isError === true }, exec.signal)
    return result
  }, { prepend: true })
  ctx.on('tools/result', exec => {
    executions.delete(exec.token)
    requests.delete(requestKey(String(exec.agent?.session.id ?? ''), String(exec.callId)))
  })
  ctx.on('dispose', () => { executions.clear(); requests.clear() })
}
