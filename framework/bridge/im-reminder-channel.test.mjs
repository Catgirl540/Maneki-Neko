import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import { randomBytes } from 'node:crypto'
import { openImStore } from './im-store.mjs'
import { createImBank } from './im-bank.mjs'

function deferred() { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const alice = { user: { id: 'alice' }, token: 'alice-token' }
async function fixture(t, handleReminder, { audience = 'customer' } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'im-reminder-channel-'))
  const path = join(directory, 'bindings.enc.json'), key = randomBytes(32).toString('base64')
  let store = await openImStore(path, key), bank, reads = 0, runs = 0, next = 0, expired = false
  const deps = () => ({ store, publicUrl: 'https://bank.example.com', audience, handleReminder,
    createSession: async () => `bank-session-${++next}`,
    current: async () => { reads++; if (expired) throw Error('bank login expired'); return { ownerId: 'alice' } },
    run: async id => { runs++; bank.observe(id, { type: 'assistant', text: 'bank-path' }) }, cancel: async () => {}, deliver: async () => {},
  })
  bank = createImBank(deps())
  t.after(async () => {
    await bank.close()
    assert(resolve(directory).startsWith(resolve(tmpdir()) + sep) && basename(directory).startsWith('im-reminder-channel-'))
    await rm(directory, { recursive: true, force: true })
  })
  async function privateChat(channel = 'weixin', key = channel === 'weixin' ? 'p2p:alice' : 'direct:alice') {
    const h = bank.harness(channel, 'bot-one'), id = await h.createSession({ conversationKey: key })
    return { id, h, session: h.workspaceSession(id, key) }
  }
  async function bind(chat, identity = alice) {
    const code = /#code=([\w-]+)/.exec(await chat.session.ask('绑定'))[1]
    return bank.claim(code, identity)
  }
  return { get bank() { return bank }, get store() { return store }, privateChat, bind,
    get reads() { return reads }, get runs() { return runs }, expire() { expired = true },
    async restart() { await bank.close(); store = await openImStore(path, key); bank = createImBank(deps()) },
  }
}

test('verified persistent WeChat reminder route survives bank expiry and Bridge restart without restoring bank login', async t => {
  const owners = [], guards = []
  const f = await fixture(t, (route, content, options) => {
    if (!content.startsWith('提醒')) return
    assert(options.isCurrent()); owners.push(route.ownerId); guards.push(options.isCurrent)
    return '提醒已保存'
  })
  let chat = await f.privateChat()
  await f.bind(chat)
  const original = f.store.snapshot().routes[chat.id]
  f.expire()
  const reads = f.reads
  assert.equal(await chat.session.ask('提醒我明天九点买花'), '提醒已保存')
  assert.equal(f.reads, reads); assert.equal(f.runs, 0)
  assert.equal(guards[0](), false, 'a completed handler cannot authorize late work')
  await f.restart(); chat = await f.privateChat()
  assert.equal(f.store.snapshot().routes[chat.id].ownerId, original.ownerId)
  assert.equal(f.bank.list('alice')[0].connected, false, 'reminders must not restore financial login')
  assert.equal(await chat.session.ask('提醒我后天九点买花'), '提醒已保存')
  assert.equal(f.reads, reads); assert.deepEqual(owners, ['alice', 'alice'])
  assert.match(await chat.session.ask('转账一百元'), /请先在银行页面登录/)
  assert.equal(f.runs, 0)
})

test('unbound, foreign channel, staff and unverifiable old bindings never enter reminder handler', async t => {
  let calls = 0
  const f = await fixture(t, () => { calls++; return 'must not run' })
  const chat = await f.privateChat()
  assert.match(await chat.session.ask('提醒我明天买花'), /请先在银行页面登录/)
  assert.equal(calls, 0)
  await f.bind(chat)
  await f.store.update(draft => { delete draft.routes[chat.id].bindingRevision })
  assert.equal(await chat.session.ask('提醒我明天买花'), 'bank-path')
  assert.equal(calls, 0)
  const wecom = await f.privateChat('wecom')
  await f.bind(wecom)
  assert.equal(await wecom.session.ask('提醒我明天买花'), 'bank-path'); assert.equal(calls, 0)
  const staff = await fixture(t, () => { calls++; return 'must not run' }, { audience: 'staff' })
  const staffChat = await staff.privateChat()
  await staff.bind(staffChat, { user: { id: 'alice', role: 'csr' }, token: 'staff-token' })
  assert.equal(await staffChat.session.ask('提醒我明天买花'), 'bank-path'); assert.equal(calls, 0)
})

test('same-route reminders serialize; revocation aborts awaited work before commit and prevents stale replies', async t => {
  const entered = deferred(), release = deferred()
  let commits = 0, handlerSignal, handlerGuard
  const f = await fixture(t, async (_route, _content, { signal, isCurrent }) => {
    handlerSignal = signal; handlerGuard = isCurrent; entered.resolve()
    await release.promise
    if (isCurrent()) { commits++; return '提醒已保存' }
    return '未保存'
  })
  const chat = await f.privateChat(); await f.bind(chat)
  const first = chat.session.ask('提醒我明天买花')
  await entered.promise
  assert.equal(chat.session.isRunning(), true)
  assert.match(await chat.session.ask('提醒我后天买花'), /上一条消息正在处理/)
  await f.bank.revoke(chat.id, 'alice')
  assert.equal(handlerSignal.aborted, true); assert.equal(handlerGuard(), false)
  assert.match(await first, /已取消或连接已更改/)
  assert.equal(chat.session.isRunning(), false)
  release.resolve(); await Promise.resolve(); await Promise.resolve()
  assert.equal(commits, 0); assert.equal(f.runs, 0)
  assert.match(await chat.session.ask('提醒我明天买花'), /请先在银行页面登录/)
})

test('reminder guards reject owner/session/revision changes and caller cancellation without banking fallback', async t => {
  for (const change of ['ownerId', 'sessionId', 'bindingRevision']) {
    await t.test(change, async t => {
      const entered = deferred(), release = deferred(); let guard, owner
      const f = await fixture(t, async (route, _content, options) => { owner = route.ownerId; guard = options.isCurrent; entered.resolve(); await release.promise; return options.isCurrent() ? 'saved' : 'not saved' })
      const chat = await f.privateChat(); await f.bind(chat)
      const ask = chat.session.ask('提醒我明天买花'); await entered.promise
      await f.store.update(draft => { draft.routes[chat.id][change] = 'replacement' })
      assert.equal(guard(), false); assert.equal(owner, 'alice')
      release.resolve(); assert.match(await ask, /已取消或连接已更改/); assert.equal(f.runs, 0)
    })
  }
  const entered = deferred(), release = deferred(), controller = new AbortController()
  const f = await fixture(t, async () => { entered.resolve(); await release.promise; return 'must not display' })
  const chat = await f.privateChat(); await f.bind(chat)
  const ask = chat.session.ask('提醒我明天买花', { signal: controller.signal }); await entered.promise; controller.abort()
  assert.match(await ask, /已取消或连接已更改/); release.resolve(); assert.equal(f.runs, 0)
})

test('non-reminder instructions retain the ordinary bank gate and parser errors never run bank tools', async t => {
  const f = await fixture(t, (_route, content) => { if (content.startsWith('提醒')) throw Error('internal secret'); return undefined })
  const chat = await f.privateChat(); await f.bind(chat)
  assert.equal(await chat.session.ask('查余额'), 'bank-path'); assert.equal(f.runs, 1)
  const result = await chat.session.ask('提醒我明天买花')
  assert.match(result, /提醒未能完成/); assert(!result.includes('secret')); assert.equal(f.runs, 1)
  await f.bank.close()
  assert.match(await chat.session.ask('提醒我明天买花'), /服务正在停止/)
})
