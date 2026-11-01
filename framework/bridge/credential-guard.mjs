import { hasExplicitCredential } from '../../shared/credential-guard.mjs'

const BLOCKED = '请勿在对话中发送密码或银行卡安全码，请使用安全验证窗口。'
const UNAVAILABLE = '安全检查暂时不可用，请稍后重试。'
export class CredentialGuardError extends Error {
  constructor(code) {
    super(code === 'CREDENTIAL_BLOCKED' ? BLOCKED : UNAVAILABLE)
    this.code = code
    this.status = code === 'CREDENTIAL_BLOCKED' ? 400 : 503
  }
}

// Only explicitly configured loopback inference services receive unredacted text.
export function decisionEndpoints(raw = process.env.LUCKYCAT_CREDENTIAL_GUARD_ENDPOINTS ?? '') {
  if (!raw.trim()) return []
  let endpoints
  try { endpoints = JSON.parse(raw) } catch { throw new Error('Invalid credential guard configuration') }
  if (!Array.isArray(endpoints) || endpoints.length > 5) throw new Error('Invalid credential guard configuration')
  return endpoints.map(item => {
    if (!item || typeof item.url !== 'string' || typeof item.model !== 'string' || !item.model.trim()) throw new Error('Invalid credential guard configuration')
    let url
    try { url = new URL(item.url) } catch { throw new Error('Invalid credential guard configuration') }
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash) throw new Error('Credential guard requires a local inference endpoint')
    return { url: url.href, model: item.model }
  })
}

export function openRouterEndpoints(models = 'respan/span-02,perplexity/pplx-decider-v1.2') {
  const names = models.split(',').map(value => value.trim()).filter(Boolean)
  if (!names.length || names.length > 5 || names.some(name => !/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*$/i.test(name))) throw new Error('Invalid credential guard models')
  return names.map(model => ({ url: 'https://openrouter.ai/api/alpha/decisions', model, openrouter: true }))
}

export function createCredentialGuard({ endpoints, apiKey = process.env.OPENROUTER_API_KEY, fetcher = fetch, timeoutMs = 3000, threshold = 0.5 } = {}) {
  endpoints ??= process.env.LUCKYCAT_CREDENTIAL_GUARD_PROVIDER === 'openrouter'
    ? openRouterEndpoints(process.env.LUCKYCAT_CREDENTIAL_GUARD_MODELS)
    : decisionEndpoints()
  return async function check(text, { image = false } = {}) {
    if (image) throw new CredentialGuardError('CREDENTIAL_CHECK_UNAVAILABLE')
    if (typeof text !== 'string' || !text.trim()) return
    if (hasExplicitCredential(text)) throw new CredentialGuardError('CREDENTIAL_BLOCKED')
    for (const endpoint of endpoints) {
      try {
        if (endpoint.openrouter && !apiKey) continue
        const response = await fetcher(endpoint.url, {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
          headers: { 'content-type': 'application/json', ...(endpoint.openrouter ? { authorization: `Bearer ${apiKey}` } : {}) },
          body: JSON.stringify({ model: endpoint.model, state: { message: text }, questions: {
            credentials: { type: 'choice', instructions: '判断消息是否在提供实际的登录密码、支付密码、银行卡安全码或 PIN。提问、忘记密码、金额、订单号不是提供密码。无法确定时选择 uncertain。', criteria: {
              safe: '不包含实际密码或安全码', blocked: '正在提供或透露密码或安全码', uncertain: '无法确定是否在提供凭据',
            } },
          } }),
        })
        if (!response.ok) continue
        const data = await response.json()
        const answer = data?.answers?.credentials
        const probabilities = answer?.probabilities
        const values = ['safe', 'blocked', 'uncertain'].map(k => probabilities?.[k])
        if (answer?.type !== 'choice' || !['safe', 'blocked', 'uncertain'].includes(answer.choice) || values.some(v => typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) || Math.abs(values.reduce((a, b) => a + b, 0) - 1) > 0.02) continue
        if (answer.choice !== 'safe' || probabilities.safe < threshold || probabilities.blocked >= threshold || probabilities.uncertain >= threshold) throw new CredentialGuardError('CREDENTIAL_BLOCKED')
        return
      } catch (error) {
        if (error instanceof CredentialGuardError) throw error
      }
    }
    throw new CredentialGuardError('CREDENTIAL_CHECK_UNAVAILABLE')
  }
}
