import test from 'node:test'
import assert from 'node:assert/strict'
import { createBankAgent } from './bank-agent.mjs'

const password = '888888'
const bankArgs = { fromAccountId: 'a1', amountCents: 100, payeeName: '测试收款人', payeeAccountNo: '6222000000000001', payeeBankCode: 'LCB', payeeBankRegion: 'CN', memo: '测试转账' }
const fpsArgs = { fromAccountId: 'a1', amountCents: 100, fpsMethod: 'mobile', fpsIdentifier: '91234567', payeeCurrency: 'HKD', memo: '测试 FPS' }
const challenge = (toolName, args, callId = 'c1', sessionId = 's1') => ({ sessionId, callId, challengeId: `h-${sessionId}-${callId}`, toolName, arguments: structuredClone(args), expiresAt: Date.now() + 60_000 })

async function fixture(t) {
  const calls = [], events = [], receipts = new Map(), agents = []
  const quotedAt = new Date().toISOString()
  const state = { committed: 0, rejectFinalPassword: false }
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(new URL(url).origin, 'https://bank.example.invalid')
    const req = { url: new URL(url).pathname, method: options.method, headers: new Headers(options.headers) }
    const send = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
    if (req.headers.get('authorization') !== 'Bearer fixture-token') return send({ message: '未登录', code: 'UNAUTHORIZED' }, 401)
    const body = options.body === undefined ? undefined : JSON.parse(options.body)
    calls.push({ path: req.url, method: req.method, body, key: req.headers.get('idempotency-key') })
    if (req.url === '/api/auth/profile') return send({ id: 'alice' })
    if (req.url === '/api/agent/transfer/requirements') return send({ confirmedQuoteVersion: 1, confirmedRecipient: true, transferPaymentPassword: true })
    if (req.url === '/api/auth/payment-password/verify') return body.paymentPassword === password
      ? send({ verified: true }) : send({ message: '支付密码错误', code: 'BAD_PAYMENT_PASSWORD' }, 400)
    if (req.url === '/api/accounts/a1') return send({ id: 'a1', label: '储蓄账户', accountNo: '8820000000001234', currency: 'CNY', available: 1_000_000 })
    if (req.url === '/api/banks') return send([{ code: 'LCB', region: 'CN', name: '本行', internal: true }, { code: '004', region: 'HK', name: '测试香港银行', internal: false }])
    if (req.url === '/api/transfers/recipient') return send({ kind: 'internal', name: bankArgs.payeeName })
    if (req.url === '/api/fps/resolve') return send({ registered: true, name: '测*人', bankCode: '004', bankRegion: 'HK' })
    if (req.url === '/api/transfers/quote') return send({
      fee: 0, singleLimit: 100_000, maxAmount: 1_000_000, etaText: '即时',
      ...(body.payeeCurrency === 'HKD' ? { fx: { fromCurrency: 'CNY', toCurrency: 'HKD', rate: 1.1, fromAmount: body.amount, toAmount: Math.round(body.amount * 1.1), spread: 0, quotedAt, quoteTtlSeconds: 120 } } : {}),
    })
    if (req.url === '/api/transfers' && req.method === 'POST') {
      const key = req.headers.get('idempotency-key')
      if (typeof key !== 'string' || !/^[\w.:-]{8,128}$/.test(key)) return send({ message: '此操作必须携带幂等键', code: 'IDEMPOTENCY_KEY_REQUIRED' }, 400)
      // A successful standalone verification must not replace verification at submission.
      if (body.paymentPassword !== password || state.rejectFinalPassword) return send({ message: '支付密码错误', code: 'BAD_PAYMENT_PASSWORD' }, 400)
      const { paymentPassword, ...businessBody } = body
      const fingerprint = JSON.stringify(businessBody), previous = receipts.get(key)
      if (previous) return previous.fingerprint === fingerprint
        ? send(previous.result) : send({ message: '幂等键已用于不同请求', code: 'IDEMPOTENCY_CONFLICT' }, 409)
      const result = { transactionId: `tx-${++state.committed}`, settlementStatus: 'success', amount: body.amount, fee: 0 }
      receipts.set(key, { fingerprint, result })
      return send(result)
    }
    return send({ message: `未处理的测试接口：${req.url}` }, 404)
  })
  t.after(() => { for (const agent of agents) agent.close() })
  const createAgent = () => {
    const sessions = new Map(['s1', 's2'].map(id => [id, { ownerId: 'alice', bankToken: 'fixture-token', activity: {} }]))
    const agent = createBankAgent({ baseUrl: 'https://bank.example.invalid', sessions, publish: (_session, event) => events.push(event) })
    agents.push(agent)
    return agent
  }
  return { bank: createAgent(), createAgent, state, calls, events, submissions: () => calls.filter(call => call.path === '/api/transfers') }
}

for (const [toolName, args, channel] of [['bank_transfer', bankArgs, 'bank'], ['bank_fps_transfer', fpsArgs, 'fps']]) {
  test(`${toolName} submits an idempotency key and transaction password only after exact consent`, async t => {
    const f = await fixture(t)
    await assert.rejects(f.bank.prepare(challenge(toolName, { ...args, paymentPassword: password }, 'credential')), /凭据/)
    const input = challenge(toolName, args), review = await f.bank.prepare(input)
    assert.equal(review.arguments, undefined)
    assert.equal(review.verification, 'payment-password')
    assert.equal(await f.bank.approveRoutineQuery(review), false)
    assert(!JSON.stringify(review).includes(password))
    assert.equal(f.submissions().length, 0)
    await assert.rejects(f.bank.execute(input), { code: 'CONSENT_REQUIRED' })
    await assert.rejects(f.bank.approve(review, '000000'), { code: 'BAD_PAYMENT_PASSWORD' })
    assert.equal(f.submissions().length, 0)
    await f.bank.approve(review, password)
    await assert.rejects(f.bank.execute({ ...input, arguments: { ...input.arguments, amountCents: args.amountCents + 1 } }), { code: 'CONSENT_REQUIRED' })
    const executions = await Promise.allSettled([f.bank.execute(input), f.bank.execute(input)])
    assert.equal(executions.filter(result => result.status === 'fulfilled').length, 1)
    assert.equal(executions.find(result => result.status === 'rejected').reason.code, 'CONSENT_REQUIRED')
    const result = executions.find(result => result.status === 'fulfilled').value
    assert.equal(result.result.settlementStatus, 'success')
    assert.equal(f.submissions().length, 1)
    const submission = f.submissions()[0]
    assert.match(submission.key, /^[\w.:-]{8,128}$/)
    assert.equal(submission.body.paymentPassword, password)
    assert.equal(submission.body.channel, channel)
    assert.equal(submission.body.amount, args.amountCents)
    assert.equal(submission.body.fromAccountId, args.fromAccountId)
    assert.equal(submission.body.confirmedQuote.version, 1)
    if (channel === 'fps') {
      assert.equal(submission.body.confirmedQuote.fx.toCurrency, 'HKD')
      assert.equal(submission.body.confirmedRecipient.bankCode, '004')
    }
    assert(!Object.hasOwn(input.arguments, 'paymentPassword'))
    assert(!JSON.stringify(result).includes(password))
    assert(!JSON.stringify(f.events).includes(password))
    assert.equal(f.events.filter(event => event.type === 'bank-updated').length, 1)
    await assert.rejects(f.bank.execute(input), { code: 'CONSENT_REQUIRED' })
    assert.equal(f.submissions().length, 1)
    assert.equal(f.state.committed, 1)
  })
}

test('the same FPS authorization retains its key across workers while separate calls, sessions and tools use separate keys', async t => {
  const f = await fixture(t), secondWorker = f.createAgent()
  const input = challenge('bank_fps_transfer', fpsArgs)
  const firstReview = await f.bank.prepare(input), secondReview = await secondWorker.prepare(input)
  await f.bank.approve(firstReview, password)
  await secondWorker.approve(secondReview, password)
  const first = await f.bank.execute(input), replay = await secondWorker.execute(input)
  assert.equal(first.result.transactionId, replay.result.transactionId)
  assert.equal(f.submissions().length, 2)
  assert.equal(f.submissions()[0].key, f.submissions()[1].key)
  assert.equal(f.state.committed, 1)
  for (const [callId, sessionId] of [['c2', 's1'], ['c1', 's2']]) {
    const next = challenge('bank_fps_transfer', fpsArgs, callId, sessionId)
    await f.bank.approve(await f.bank.prepare(next), password)
    await f.bank.execute(next)
  }
  const differentTool = challenge('bank_transfer', bankArgs)
  await f.bank.approve(await f.bank.prepare(differentTool), password)
  await f.bank.execute(differentTool)
  assert.equal(new Set(f.submissions().map(call => call.key)).size, 4)
  assert.equal(f.state.committed, 4)
})

test('a final transaction password failure is surfaced even after standalone verification succeeds', async t => {
  const f = await fixture(t), input = challenge('bank_transfer', bankArgs)
  await f.bank.approve(await f.bank.prepare(input), password)
  f.state.rejectFinalPassword = true
  await assert.rejects(f.bank.execute(input), { code: 'BAD_PAYMENT_PASSWORD' })
  assert.equal(f.submissions().length, 1)
  assert.equal(f.submissions()[0].body.paymentPassword, password)
  assert.equal(f.state.committed, 0)
  assert.equal(f.events.filter(event => event.type === 'bank-updated').length, 0)
  await assert.rejects(f.bank.execute(input), { code: 'CONSENT_REQUIRED' })
  assert.equal(f.submissions().length, 1)
})
