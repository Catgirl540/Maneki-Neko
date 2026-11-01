import test from 'node:test'
import assert from 'node:assert/strict'
import { hasExplicitCredential } from '../../shared/credential-guard.mjs'
import { createCredentialGuard, decisionEndpoints } from './credential-guard.mjs'

const endpoint = { url: 'http://127.0.0.1:8123/v1/systemone', model: 'span-02' }
const answer = (choice, probabilities) => ({ ok: true, json: async () => ({ answers: { credentials: { type: 'choice', choice, probabilities } } }) })
const safe = () => answer('safe', { safe: 0.96, blocked: 0.02, uncertain: 0.02 })

test('明确密码表达本地拦截，不调用模型；咨询和金额不被规则直接拦截', async () => {
  assert.equal(hasExplicitCredential('我的支付密码是 123456'), true)
  assert.equal(hasExplicitCredential('忘记支付密码怎么办'), false)
  assert.equal(hasExplicitCredential('转账 123456 元'), false)
  let calls = 0
  const guard = createCredentialGuard({ endpoints: [endpoint], fetcher: async () => { calls++; return safe() } })
  await assert.rejects(guard('我的支付密码是 123456'), { code: 'CREDENTIAL_BLOCKED' })
  assert.equal(calls, 0)
  await guard('忘记支付密码怎么办')
  assert.equal(calls, 1)
})

test('主模型故障时调用备用模型，返回有效安全结果后才放行', async () => {
  const seen = []
  const guard = createCredentialGuard({ endpoints: [endpoint, { ...endpoint, model: 'backup' }], fetcher: async (_url, request) => {
    const body = JSON.parse(request.body); seen.push(body.model)
    if (body.model === 'span-02') throw new Error('unavailable')
    return safe()
  } })
  await guard('我的订单号是 123456')
  assert.deepEqual(seen, ['span-02', 'backup'])
})

test('不确定、风险判断、无效响应和全部服务不可用均不放行', async () => {
  for (const response of [answer('blocked', { safe: 0.1, blocked: 0.8, uncertain: 0.1 }), answer('uncertain', { safe: 0.2, blocked: 0.2, uncertain: 0.6 })]) {
    await assert.rejects(createCredentialGuard({ endpoints: [endpoint], fetcher: async () => response })('敏感内容'), { code: 'CREDENTIAL_BLOCKED' })
  }
  await assert.rejects(createCredentialGuard({ endpoints: [endpoint], fetcher: async () => ({ ok: true, json: async () => ({}) }) })('普通消息'), { code: 'CREDENTIAL_CHECK_UNAVAILABLE' })
  await assert.rejects(createCredentialGuard({ endpoints: [] })('普通消息'), { code: 'CREDENTIAL_CHECK_UNAVAILABLE' })
  await assert.rejects(createCredentialGuard({ endpoints: [endpoint], fetcher: async () => safe() })('', { image: true }), { code: 'CREDENTIAL_CHECK_UNAVAILABLE' })
})

test('推理端点只允许本机地址，不接受远程或 URL 凭据', () => {
  assert.deepEqual(decisionEndpoints(JSON.stringify([endpoint])), [endpoint])
  for (const url of ['https://example.com/v1/systemone', 'http://127.0.0.1.evil.test/', 'http://user:pass@localhost/']) {
    assert.throws(() => decisionEndpoints(JSON.stringify([{ url, model: 'x' }])))
  }
})
