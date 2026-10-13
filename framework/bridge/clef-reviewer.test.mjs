import test from 'node:test'
import assert from 'node:assert/strict'
import { createClefReviewer, interpretClef, CLEF_MODEL, CLEF_ENDPOINT } from './clef-reviewer.mjs'
const response = (probabilities, choice = Object.keys(probabilities).sort((a, b) => probabilities[b] - probabilities[a])[0]) => ({ model: CLEF_MODEL, answers: { operation_risk: { type: 'choice', choice, probabilities } } })
test('Clef 使用决策协议和固定模型，不发送聊天 messages', async () => {
  let request
  const review = createClefReviewer({ apiKey: 'unit-test', fetchImpl: async (url, init) => { request = { url: url.href, init }; return { ok: true, json: async () => response({ read_only: .99, routine_change: .008, high_risk: .001, prohibited: .001 }) } } })
  assert.equal((await review({ operation: 'read README' })).action, 'allow')
  const body = JSON.parse(request.init.body)
  assert.equal(request.url, CLEF_ENDPOINT); assert.equal(body.model, CLEF_MODEL); assert.equal(body.messages, undefined)
  assert.equal(body.questions.operation_risk.type, 'choice'); assert.equal(Object.keys(body.questions.operation_risk.criteria).length, 4)
})
test('高危和低置信判断需人工确认，禁止操作不能以确认放行', () => {
  assert.equal(interpretClef(response({ read_only: .01, routine_change: .01, high_risk: .97, prohibited: .01 })).action, 'review')
  assert.equal(interpretClef(response({ read_only: .6, routine_change: .1, high_risk: .2, prohibited: .1 })).action, 'review')
  assert.equal(interpretClef(response({ read_only: .01, routine_change: .01, high_risk: .01, prohibited: .97 })).action, 'deny')
})
test('错误模型、退化结果、缺失/错误概率及赢家不一致不能自动放行', async () => {
  for (const data of [{ model: 'glm', choices: [] }, { ...response({ read_only: 1, routine_change: 0, high_risk: 0, prohibited: 0 }), degraded: true }, response({ read_only: .5 }), response({ read_only: 1.2, routine_change: -.2, high_risk: 0, prohibited: 0 }), response({ read_only: .9, routine_change: .1, high_risk: 0, prohibited: 0 }, 'routine_change')]) {
    const review = createClefReviewer({ apiKey: 'test', fetchImpl: async () => ({ ok: true, json: async () => data }) })
    assert.equal((await review('state')).action, 'review')
  }
})
test('超时、HTTP 错误和长输入不自动放行，也不把长状态截断传送', async () => {
  for (const fetchImpl of [async () => { throw Error('timeout') }, async () => ({ ok: false, status: 503 })]) assert.equal((await createClefReviewer({ apiKey: 'test', fetchImpl })('state')).action, 'review')
  let called = false
  const review = createClefReviewer({ apiKey: 'test', fetchImpl: async () => { called = true } })
  assert.equal((await review({ command: '字'.repeat(2000) })).action, 'review'); assert.equal(called, false)
})
test('拒绝把决策密钥发到未配置的外部网站', () => assert.throws(() => createClefReviewer({ endpoint: 'https://example.com/api', apiKey: 'test' })))
