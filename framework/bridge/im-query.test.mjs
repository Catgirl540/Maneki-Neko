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
  let expired = false, queryCalls = 0, im, bank, count = 0
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    if (expired || req.headers.authorization !== `Bearer ${bankToken}`) { res.writeHead(401); return res.end(JSON.stringify({ message: '请重新登录', code: 'UNAUTHORIZED' })) }
    if (req.url === '/api/auth/profile') return res.end(JSON.stringify({ id: 'alice' }))
    if (req.url === '/api/accounts') { queryCalls++; return res.end(JSON.stringify([{ id: 'a1', balance: 42 }])) }
    if (req.url === '/api/cards') return res.end('[]')
    if (req.url === '/api/wealth/overview') return res.end(JSON.stringify({ holdings: [], account: {}, risk: {} }))
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
    run: async id => {
      sessions.get(id).activity = { cancelled: false }
      const raw = challenge(id), prepared = await bank.prepare(raw)
      assert.equal(await bank.approveRoutineQuery({ ...prepared, challengeId: 'forged' }), false)
      assert.equal(await im.authorizeQuery({ ...prepared, sessionId: 'unbound' }, bank.approveRoutineQuery), false)
      assert.equal(await im.authorizeQuery(prepared, bank.approveRoutineQuery), true)
      const result = await bank.execute(raw)
      assert.equal(result.accounts[0].balance, 42)
      await assert.rejects(bank.execute(raw), /授权/)
      const write = challenge(id, 'bank_request_human_support', { reason: 'test issue' })
      const writePrepared = await bank.prepare(write)
      assert.equal(await im.authorizeQuery(writePrepared, bank.approveRoutineQuery), false)
      assert.equal(await bank.approveRoutineQuery({ ...writePrepared, toolName: 'bank_get_balance' }), false)
      await assert.rejects(bank.execute(write), /授权/)
      bank.forget(writePrepared)
      im.observe(id, { type: 'assistant', messageId: `reply-${count}`, text: '余额查询完成' })
    },
  })
  const harness = im.harness('weixin', 'bot')
  const route = await harness.createSession({ conversationKey: 'p2p:person' })
  const session = harness.workspaceSession(route, 'p2p:person')
  const code = /#code=([\w-]+)/.exec(await session.ask('绑定'))[1]
  const bound = await im.claim(code, { user: { id: 'alice' }, token: bankToken })
  assert.equal(await session.ask('查余额'), '余额查询完成')
  assert.equal(await session.ask('再查余额'), '余额查询完成')
  assert.equal(queryCalls, 2)
  const outsideTurn = await bank.prepare(challenge(bound.sessionId))
  assert.equal(await im.authorizeQuery(outsideTurn, bank.approveRoutineQuery), false)
  bank.forget(outsideTurn)
  expired = true
  assert.match(await session.ask('查余额'), /登录并绑定/)
  assert.equal(queryCalls, 2)
})
