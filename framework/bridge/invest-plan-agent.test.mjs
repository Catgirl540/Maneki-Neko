import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createBankAgent } from './bank-agent.mjs'

test('investment tools require exact consent, passwords for create/resume, fresh snapshots and one-use grants', async t => {
  const token = 'a'.repeat(43), calls = [], events = [], sessions = new Map([['s', { ownerId: 'alice', bankToken: token, activity: {} }]])
  const product = { code: 'BOND-A', name: '测试债券', risk: 'low', minAmount: 10000 }
  const investments = { executionMode: 'plan-only', products: [product], plans: [] }
  const server = createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json')
    if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401); return res.end('{}') }
    let raw = ''; for await (const chunk of req) raw += chunk
    const body = raw ? JSON.parse(raw) : undefined
    calls.push({ path: req.url, method: req.method, body, key: req.headers['idempotency-key'] })
    const send = (value, status = 200) => { res.writeHead(status); res.end(JSON.stringify(value)) }
    if (req.url === '/api/auth/profile') return send({ id: 'alice' })
    if (req.url === '/api/auth/payment-password/verify') return body.paymentPassword === '888888' ? send({ verified: true }) : send({ message: '支付密码错误' }, 401)
    if (req.url === '/api/accounts/a1') return send({ id: 'a1', currency: 'CNY', label: '储蓄账户', accountNo: '8820000000001234' })
    if (req.url === '/api/wealth/overview') return send({ account: { opened: true }, risk: { done: true, expired: false, level: 'C3' } })
    if (req.url === '/api/wealth/investments') return send(investments)
    if (req.url === '/api/wealth/investments/plan' && req.method === 'POST') {
      assert.equal(body.paymentPassword, '888888')
      investments.plans.push({ id: 'p1', productCode: product.code, productName: product.name, amount: body.amount, cycle: body.cycle, status: 'active', revision: 0 })
      return send(investments.plans[0])
    }
    if (req.url === '/api/wealth/investments/plan/p1' && req.method === 'PATCH') {
      const plan = investments.plans[0]
      assert.equal(body.expectedRevision, plan.revision)
      if (body.status === 'active') assert.equal(body.paymentPassword, '888888')
      else assert.equal(body.paymentPassword, undefined)
      Object.assign(plan, { status: body.status, revision: plan.revision + 1 })
      return send(plan)
    }
    send({}, 404)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const bank = createBankAgent({ baseUrl: `http://127.0.0.1:${server.address().port}`, sessions, publish: (_id, event) => events.push(event) })
  t.after(async () => { bank.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) })
  let seq = 0
  const challenge = (toolName, args) => ({ sessionId: 's', callId: `c${++seq}`, challengeId: `h${seq}`, toolName, arguments: args, expiresAt: Date.now() + 60000 })
  const raw = challenge('bank_create_invest_plan', { productCode: product.code, accountId: 'a1', amountCents: 10000, cycle: '每周' })
  const card = await bank.prepare(raw)
  assert.equal(card.verification, 'payment-password')
  assert.equal(card.arguments, undefined)
  assert(card.fields.some(field => field.value.includes('自动扣款尚未开放')))
  assert.equal(await bank.approveRoutineQuery(card), false)
  await assert.rejects(bank.execute(raw), /授权/)
  await assert.rejects(bank.approve(card, '000000'), /密码错误/)
  assert.equal(investments.plans.length, 0)
  await bank.approve(card, '888888')
  const created = await bank.execute(raw)
  assert.equal(created.result.status, 'active')
  assert.match(created.notice, /不代表已投资/)
  assert.match(calls.find(call => call.method === 'POST' && call.path.endsWith('/plan')).key, /^agent_[a-f0-9]{64}$/)
  await assert.rejects(bank.execute(raw), /授权/)

  const stale = challenge('bank_update_invest_plan', { planId: 'p1', status: 'paused' })
  await bank.approve(await bank.prepare(stale))
  investments.plans[0].revision++
  await assert.rejects(bank.execute(stale), /计划已变化/)
  assert.equal(calls.filter(call => call.method === 'PATCH').length, 0)
  for (const status of ['paused', 'active', 'terminated']) {
    const change = challenge('bank_update_invest_plan', { planId: 'p1', status })
    const prepared = await bank.prepare(change)
    assert.equal(prepared.verification, status === 'active' ? 'payment-password' : undefined)
    assert.equal(await bank.approveRoutineQuery(prepared), false)
    await bank.approve(prepared, status === 'active' ? '888888' : undefined)
    assert.equal((await bank.execute(change)).result.status, status)
  }
  await assert.rejects(bank.prepare(challenge('bank_update_invest_plan', { planId: 'p1', status: 'active' })), /不能恢复/)
  await assert.rejects(bank.prepare(challenge('bank_update_invest_plan', { planId: 'someone-else', status: 'paused' })), /不属于/)
  assert.equal(events.filter(event => event.type === 'bank-updated').length, 4)
  assert.equal(calls.filter(call => call.path === '/api/wealth/investments/plan' && call.method === 'POST').length, 1)
})
