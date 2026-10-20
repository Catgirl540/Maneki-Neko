import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep, basename } from 'node:path'
import { randomBytes } from 'node:crypto'
import { createBankAgent } from './bank-agent.mjs'
import { createImBank } from './im-bank.mjs'
import { openImStore } from './im-store.mjs'

test('bound IM queries reuse login and exact one-use grants; writes, forged grants and other sessions still require confirmation', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'luckycat-im-query-'))
  const sessions = new Map(), bankToken = 'a'.repeat(43)
  const catalog = ['A', 'B'].map(code => ({ code, name: code, risk: 'R2', principalProtected: false,
    benchmark: { kind: 'range', low: 0.02, high: 0.03, basis: '测试产品说明' },
    minAmount: 100, stepAmount: 100, term: '90 天', openEnded: false, ongoingFees: [], transactionFees: [] }))
  let expired = false, queryCalls = 0, im, bank, count = 0
  let debitEnabled = true
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    if (expired || req.headers.authorization !== `Bearer ${bankToken}`) { res.writeHead(401); return res.end(JSON.stringify({ message: '请重新登录', code: 'UNAUTHORIZED' })) }
    if (req.url === '/api/auth/profile') return res.end(JSON.stringify({ id: 'alice' }))
    if (req.url === '/api/accounts') { queryCalls++; return res.end(JSON.stringify([{ id: 'a1', balance: 42 }])) }
    if (req.url === '/api/accounts/a1') return res.end(JSON.stringify({ id: 'a1', currency: 'CNY' }))
    if (req.url === '/api/accounts/a1/transactions?page=1&size=20') return res.end(JSON.stringify({ page: 1, size: 20, total: 2,
      items: ['tx1', 'tx2'].map((id, i) => ({ id, accountId: 'a1', amount: 1000, signedAmount: -1000, direction: 'out', status: 'success', category: 'shopping', counterparty: '测试商户', createdAt: new Date(Date.now() - 60000 + i * 10000).toISOString() })) }))
    if (req.url === '/api/cards') return res.end('[]')
    if (req.url === '/api/autodebits') return res.end(JSON.stringify([{ id: 'own-contract', merchant: '测试会员', amount: 2500, cycle: '每月', enabled: debitEnabled, nextRunAt: new Date().toISOString() }]))
    if (req.url === '/api/wealth/overview') return res.end(JSON.stringify({ holdings: [], account: {}, risk: {} }))
    if (req.url === '/api/wealth/products') return res.end(JSON.stringify(catalog))
    if (req.url === '/api/wealth/investments') return res.end(JSON.stringify({ executionMode: 'plan-only', products: [], plans: [] }))
    res.writeHead(404); res.end('{}')
  })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  t.after(async () => {
    await im?.close(); bank?.close()
    server.closeAllConnections(); await new Promise(done => server.close(done))
    assert(resolve(directory).startsWith(resolve(tmpdir()) + sep) && basename(directory).startsWith('luckycat-im-query-'))
    await rm(directory, { recursive: true, force: true })
  })
  bank = createBankAgent({ baseUrl: `http://127.0.0.1:${server.address().port}`, sessions, publish() {} })
  const store = await openImStore(join(directory, 'bindings.json'), randomBytes(32).toString('base64'))
  const challenge = (id, name = 'bank_get_balance', args = {}) => ({ sessionId: id, callId: `call-${++count}`, challengeId: `challenge-${count}`, toolName: name, arguments: args, expiresAt: Date.now() + 60_000 })
  im = createImBank({ store, publicUrl: 'https://bank.example.com', current: bank.current,
    createSession: async identity => { const id = `web-${sessions.size}`; sessions.set(id, { id, ownerId: identity.user.id, bankToken: identity.token }); return id },
    cancel: async id => { const entry = sessions.get(id); if (entry?.activity) entry.activity.cancelled = true; bank.forgetSession(id) }, deliver: async () => {},
    run: async (id, text) => {
      sessions.get(id).activity = { cancelled: false }
      const comparing = text === '对比产品'
      const renewals = text === '查续费'
      const plans = text === '查定投'
      const reviewing = text === '核查流水'
      const raw = comparing ? challenge(id, 'bank_wealth_compare', { firstProductCode: 'A', secondProductCode: 'B' }) : renewals ? challenge(id, 'bank_analyze_autodebits', { days: 7 }) : plans ? challenge(id, 'bank_list_investments', {}) : reviewing ? challenge(id, 'bank_review_transactions', { accountId: 'a1', limit: 20 }) : challenge(id)
      const prepared = await bank.prepare(raw)
      assert.equal(await bank.approveRoutineQuery({ ...prepared, challengeId: 'forged' }), false)
      assert.equal(await im.authorizeQuery({ ...prepared, sessionId: 'unbound' }, bank.approveRoutineQuery), false)
      assert.equal(await im.authorizeQuery(prepared, bank.approveRoutineQuery), true)
      const result = await bank.execute(raw)
      if (comparing) assert.deepEqual(result.result.products.map(p => p.code), ['A', 'B'])
      else if (reviewing) { assert.equal(result.result.coverage.returnedCount, 2); assert.equal(result.result.candidateCounts.duplicateGroups, 1) }
      else if (plans) { assert.equal(result.result.executionMode, 'plan-only'); assert.deepEqual(result.result.plans, []) }
      else if (renewals) {
        assert.equal(result.result.items[0].id, 'own-contract')
        assert.equal(result.result.items[0].status, debitEnabled ? 'upcoming' : 'disabled')
        assert.equal(result.result.reminderCreated, false)
      }
      else assert.equal(result.accounts[0].balance, 42)
      await assert.rejects(bank.execute(raw), /授权/)
      const write = challenge(id, 'bank_request_human_support', { reason: 'test issue' })
      const writePrepared = await bank.prepare(write)
      assert.equal(await im.authorizeQuery(writePrepared, bank.approveRoutineQuery), false)
      assert.equal(await bank.approveRoutineQuery({ ...writePrepared, toolName: 'bank_get_balance' }), false)
      await assert.rejects(bank.execute(write), /授权/)
      bank.forget(writePrepared)
      const toggle = challenge(id, 'bank_set_autodebit', { autoDebitId: 'own-contract', enabled: false })
      const togglePrepared = await bank.prepare(toggle)
      assert.equal(await im.authorizeQuery(togglePrepared, bank.approveRoutineQuery), false)
      await assert.rejects(bank.execute(toggle), /授权/)
      bank.forget(togglePrepared)
      im.observe(id, { type: 'assistant', messageId: `reply-${count}`, text: comparing ? '产品对比完成' : renewals ? '续费查询完成' : plans ? '定投查询完成' : reviewing ? '流水核查完成' : '余额查询完成' })
    },
  })
  const harness = im.harness('weixin', 'bot')
  const route = await harness.createSession({ conversationKey: 'p2p:person' })
  const session = harness.workspaceSession(route, 'p2p:person')
  const code = /#code=([\w-]+)/.exec(await session.ask('绑定'))[1]
  const bound = await im.claim(code, { user: { id: 'alice' }, token: bankToken })
  assert.equal(await session.ask('查余额'), '余额查询完成')
  assert.equal(await session.ask('再查余额'), '余额查询完成')
  assert.equal(await session.ask('对比产品'), '产品对比完成')
  assert.equal(await session.ask('查续费'), '续费查询完成')
  debitEnabled = false
  assert.equal(await session.ask('查续费'), '续费查询完成')
  assert.equal(await session.ask('查定投'), '定投查询完成')
  assert.equal(await session.ask('核查流水'), '流水核查完成')
  assert.equal(queryCalls, 2)
  const outsideTurn = await bank.prepare(challenge(bound.sessionId))
  assert.equal(await im.authorizeQuery(outsideTurn, bank.approveRoutineQuery), false)
  bank.forget(outsideTurn)
  expired = true
  assert.match(await session.ask('查余额'), /登录并绑定/)
  assert.equal(queryCalls, 2)
})
