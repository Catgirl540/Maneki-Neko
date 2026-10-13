/** Agent 测评状态回归：真实确认/执行通道 + 本地 HTTP 夹具，无银行数据库及外部模型。 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { createBankAgent } from '../framework/bridge/bank-agent.mjs'
import { summarizeRiskAssessment } from '../framework/bridge/wealth-risk.mjs'

const account = { id: 'account', accountNo: '8820000000000000001', currency: 'CNY', balance: 0, available: 0 }
const sample = { done: true, expired: false, level: 'C3', score: 60, assessedAt: '2026-10-13T00:00:00Z', expiresAt: '2027-10-13T00:00:00Z' }
let risk, failing = false
const requests = [], published = []
const server = createServer((req, res) => {
  requests.push({ path: req.url, method: req.method })
  assert.equal(req.headers.authorization, 'Bearer fixture_token')
  res.setHeader('content-type', 'application/json')
  switch (req.url) {
    case '/api/auth/profile': return res.end(JSON.stringify({ id: 'owner' }))
    case '/api/accounts': return res.end(JSON.stringify([account]))
    case '/api/accounts/account': return res.end(JSON.stringify(account))
    case '/api/cards': return res.end('[]')
    case '/api/wealth/overview':
      if (failing) { res.statusCode = 503; return res.end(JSON.stringify({ message: '测评服务暂不可用' })) }
      return res.end(JSON.stringify({ account: { opened: false }, holdings: [], risk }))
    default: res.statusCode = 404; res.end('{}')
  }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const sessions = new Map([['session', { ownerId: 'owner', bankToken: 'fixture_token' }]])
const agent = createBankAgent({ baseUrl: `http://127.0.0.1:${server.address().port}`, sessions, publish: (_, event) => published.push(event) })
async function prepare(args = {}) {
  const challenge = { sessionId: 'session', callId: randomUUID(), challengeId: randomUUID(), toolName: 'bank_get_balance', arguments: args, createdAt: Date.now(), expiresAt: Date.now() + 60000 }
  return { challenge: await agent.prepare(challenge), input: { sessionId: 'session', callId: challenge.callId, toolName: challenge.toolName, arguments: args } }
}
async function query(args) {
  const p = await prepare(args)
  await agent.approve(p.challenge)
  return agent.execute(p.input)
}
try {
  // 连旧默认等级、日期也要清除，不能制造客户测评历史。
  for (const expired of [true, false]) {
    risk = { ...sample, done: false, expired }
    const before = structuredClone(risk)
    const result = await query()
    assert.deepEqual(result.accounts, [account])
    assert.equal(result.dataSource, 'http')
    assert.deepEqual(result.risk, { status: 'unassessed', statusLabel: '尚未完成风险测评', done: false, expired: false, level: null, score: null, assessedAt: null, expiresAt: null })
    assert.deepEqual(risk, before)
  }
  console.log('PASS 未完成优先于 expired 标志，默认等级/分数/日期不作为个人测评结果返回')

  for (const expired of [true, false]) {
    risk = { ...sample, expired }
    const result = await query({ accountId: 'account' })
    assert.deepEqual(result.accounts, [account])
    assert.equal(result.risk.status, expired ? 'expired' : 'valid')
    for (const key of Object.keys(sample)) assert.deepEqual(result.risk[key], risk[key])
  }
  console.log('PASS 已完成测评才区分有效/过期，真实等级和日期保留，单账户查询同样处理')

  for (const invalid of [null, undefined, {}, { done: 'false', expired: true }, { done: true }, { done: true, expired: 'false' }]) {
    risk = invalid
    const result = await query()
    assert.equal(result.risk.status, 'unknown')
    for (const key of ['done', 'expired', 'level', 'score', 'assessedAt', 'expiresAt']) assert.equal(result.risk[key], null)
  }
  assert.equal(summarizeRiskAssessment({ ...sample, level: 'C9', score: '60', assessedAt: 'bad date', expiresAt: '' }).level, null)
  assert.equal(summarizeRiskAssessment({ ...sample, score: '60' }).score, null)
  assert.equal(summarizeRiskAssessment({ ...sample, assessedAt: 'bad date' }).assessedAt, null)
  console.log('PASS 缺失/错误字段显示未知，不补造等级、分数或日期')

  const p = await prepare()
  await assert.rejects(agent.execute(p.input), e => e.code === 'CONSENT_REQUIRED')
  await agent.approve(p.challenge)
  await agent.execute(p.input)
  await assert.rejects(agent.execute(p.input), e => e.code === 'CONSENT_REQUIRED')
  failing = true
  await assert.rejects(query(), e => e.status === 503 && /暂不可用/.test(e.message))
  assert(requests.every(r => r.method === 'GET'))
  assert.deepEqual(published, [])
  console.log('PASS 查询仍需确认且不能重放；银行服务失败不伪造状态，不写入银行数据')
} finally {
  agent.close()
  await new Promise(resolve => server.close(resolve))
}
