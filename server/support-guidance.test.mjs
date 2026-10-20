import test from 'node:test'
import assert from 'node:assert/strict'
import { supportGuidance } from '../shared/support-guidance.mjs'
import { fixture, ok, login, financialState, testOptions } from './testing/http-fixture.mjs'

test('fallback guidance discloses no live query or execution and never supplies financial numbers or echoes credentials', () => {
  for (const text of ['余额多少钱', '当前利率收益', '转账费率和到账时间', '银行卡额度', '帮我锁卡', '取消订阅', '转人工', '登录密码 secret-test-8294', '未知问题']) {
    const reply = supportGuidance(text)
    assert(reply.text.startsWith('当前为固定引导，未实时查询账户或执行业务。'))
    assert(!/\d/.test(reply.text), 'static reply must not invent current financial numbers or thresholds')
    assert(!reply.text.includes('secret-test-8294'))
    assert.equal(reply.actions.length, 1)
  }
})

test('fallback navigation reaches the intended current pages and returned actions do not mutate later replies', () => {
  for (const [input, path] of [['查余额', '/accounts'], ['消费账单', '/analysis/statistics'], ['自动扣款', '/analysis/autodebits'], ['锁卡', '/cards'], ['重置密码', '/security'], ['FPS', '/transfer']]) {
    const first = supportGuidance(input)
    assert.equal(first.actions[0].to, path)
    first.actions[0].to = '/invalid'; first.actions.push({ label: 'invalid', to: '/invalid' })
    assert.deepEqual(supportGuidance(input).actions.map(action => action.to), [path])
  }
  assert.match(supportGuidance('锁卡').text, /资金账户转账不因此停用/)
  assert.match(supportGuidance('取消订阅').text, /不等于取消商户订阅/)
  assert.match(supportGuidance('转人工').text, /尚未创建工单/)
})

test('fallback HTTP replies authenticate the customer, disclose static scope and cannot change bank funds', { ...testOptions, timeout: 30000 }, async t => {
  const app = await fixture()
  t.after(() => app.close())
  assert.equal((await app.call('/api/support/chat', { method: 'POST', body: { text: '查余额' } })).status, 401)
  const owner = await login(app, '13800138000')
  const before = await financialState(app)
  for (const text of ['查余额', '当前利率', '转账并立即到账', '停用自动扣款', '锁卡', '转人工']) {
    const reply = ok(await app.call('/api/support/chat', { method: 'POST', token: owner.token, body: { text } }))
    assert.equal(reply.canned, true); assert.equal(reply.message.role, 'agent')
    assert(reply.message.id); assert(Number.isFinite(Date.parse(reply.message.createdAt)))
    assert.equal(reply.message.text, supportGuidance(text).text)
    assert.deepEqual(reply.message.actions, supportGuidance(text).actions)
  }
  assert.deepEqual(await financialState(app), before)
  assert.equal(ok(await app.call('/api/support/tickets', { token: owner.token })).total, 0)
})
