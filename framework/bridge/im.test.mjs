import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { basename, join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { EventEmitter } from 'node:events'
import { createServer } from 'node:http'
import { openImStore } from './im-store.mjs'
import { createImBank } from './im-bank.mjs'
import { createImChannels, loadImVendor } from './im-channels.mjs'
import { createImHttp } from './im-http.mjs'

const sleep = ms => new Promise(done => setTimeout(done, ms))
async function waitFor(predicate) { for (let i = 0; i < 300; i++) { const value = predicate(); if (value) return value; await sleep(10) } throw Error('IM fixture timed out') }
function deferred() { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'luckycat-im-'))
  t.after(async () => {
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep) || !basename(directory).startsWith('luckycat-im-')) throw Error('Refusing to remove an unexpected fixture directory')
    await rm(directory, { recursive: true, force: true })
  })
  const key = randomBytes(32).toString('base64'), path = join(directory, 'bindings.enc.json')
  const store = await openImStore(path, key)
  const sessions = new Map(), deliveries = [], calls = []
  let bank
  const run = options.run ?? (async (id, text) => { bank.observe(id, { type: 'tool-result', text: 'not-an-IM-message' }); bank.observe(id, { type: 'assistant', messageId: 'm1', text: `已办理：${text}` }) })
  const deps = {
    store, publicUrl: 'https://bank.example.com',
    createSession: async identity => { const id = `web-${sessions.size + 1}`; sessions.set(id, { ownerId: identity.user.id, token: identity.token }); return id },
    current: async id => { const session = sessions.get(id); if (!session || session.expired) throw Error('Login expired'); return session },
    cancel: async id => { calls.push(['cancel', id]); options.onCancel?.(id) },
    deliver: async (route, text) => { deliveries.push({ route, text }) },
    run: async (id, text) => { calls.push(['run', id, text]); await run(id, text) },
    ...options.dependencies,
  }
  bank = createImBank(deps)
  t.after(() => bank.close())
  return { bank, deps, directory, key, path, store, sessions, deliveries, calls }
}
const customer = id => ({ user: { id, name: id }, token: `bank-token-${id}` })
const pairCode = text => /#code=([\w-]+)/.exec(text)?.[1]
async function conversation(bank, channel = 'weixin', botId = 'bot-a', key = channel === 'weixin' ? 'p2p:person-a' : 'direct:person-a') {
  const harness = bank.harness(channel, botId)
  const id = await harness.createSession({ conversationKey: key })
  return { id, session: harness.workspaceSession(id, key), harness }
}

test('credentials and account routing persist encrypted; wrong key and corruption fail closed', async t => {
  const f = await fixture(t)
  await f.store.credentials.set('fixture-secret-ref', 'bot-secret-fixture')
  const route = await conversation(f.bank)
  const code = pairCode(await route.session.ask('查余额'))
  assert.match(code, /^[\w-]{32}$/)
  await f.bank.claim(code, customer('alice'))
  const file = await readFile(f.path, 'utf8')
  for (const secret of ['alice', 'bot-secret-fixture', 'bank-token-alice', 'person-a']) assert(!file.includes(secret))
  const reopened = await openImStore(f.path, f.key)
  assert.equal((await reopened.credentials.resolve('fixture-secret-ref')).value, 'bot-secret-fixture')
  assert.equal(reopened.snapshot().routes[route.id].ownerId, 'alice')
  assert(!JSON.stringify(reopened.snapshot()).includes('bank-token-alice'))
  await assert.rejects(openImStore(f.path, randomBytes(32).toString('base64')), /cannot be decrypted/)
})

test('binding codes expire, are single-use and cannot reassign another customer; chats and bots are isolated', async t => {
  let time = 10_000
  const f = await fixture(t, { dependencies: { clock: () => time } })
  const a = await conversation(f.bank), b = await conversation(f.bank, 'wecom', 'bot-b')
  const codeA = pairCode(await a.session.ask('查余额')), codeB = pairCode(await b.session.ask('查余额'))
  assert.notEqual(codeA, codeB)
  const boundA = await f.bank.claim(codeA, customer('alice'))
  await assert.rejects(f.bank.claim(codeA, customer('bob')), /不存在或已过期/)
  await f.bank.claim(codeB, customer('bob'))
  assert.equal(f.bank.list('alice').length, 1)
  await assert.rejects(f.bank.revoke(a.id, 'bob'), /连接不存在/)
  assert.throws(() => b.harness.workspaceSession(a.id, 'direct:person-a').isRunning(), /不存在/)
  assert.match(await a.session.ask('查余额'), /已办理/)
  assert.equal(f.calls.filter(call => call[0] === 'run').length, 1)
  assert(!f.deliveries.some(item => item.text.includes('not-an-IM-message')))
  f.sessions.get(boundA.sessionId).expired = true
  const replacement = pairCode(await a.session.ask('再次查询'))
  await assert.rejects(f.bank.claim(replacement, customer('bob')), /其他银行账户/)
  time += 600_001
  assert.throws(() => f.bank.preview(replacement), /已过期/)
  await assert.rejects(a.harness.createSession({ conversationKey: 'group:team' }), /仅支持本人私聊/)
})

test('bank confirmation hands off to the authenticated portal; completion is delivered once to the originating private chat', async t => {
  const gate = deferred(), entered = deferred()
  let f
  f = await fixture(t, { run: async id => {
    f.bank.observe(id, { type: 'consent', challenge: { challengeId: 'approval-a' } }); entered.resolve()
    await gate.promise
    f.bank.observe(id, { type: 'question', question: { questionId: 'question-a' } })
    f.bank.observe(id, { type: 'assistant', messageId: 'm1', text: '银行已受理，回执 123。' })
  }, onCancel: () => gate.resolve() })
  const route = await conversation(f.bank)
  const bound = await f.bank.claim(pairCode(await route.session.ask('绑定')), customer('alice'))
  const pending = await route.session.ask('转账')
  assert(pending.includes(`#session=${bound.sessionId}`))
  assert(!pending.includes('bank-token'))
  await entered.promise
  assert.match(await route.session.ask('确认'), /银行页面/)
  assert.equal(f.calls.filter(call => call[0] === 'run').length, 1)
  gate.resolve()
  await waitFor(() => f.deliveries.some(item => item.text.includes('回执 123')))
  assert.equal(f.deliveries.filter(item => item.text.includes('回执 123')).length, 1)
  assert(f.deliveries.every(item => item.route.id === route.id))
})

test('revocation and login expiry suppress late private results; restart requires fresh bank authentication', async t => {
  const gate = deferred()
  let f
  f = await fixture(t, { run: async id => {
    f.bank.observe(id, { type: 'consent', challenge: { challengeId: 'c' } })
    await gate.promise
    f.bank.observe(id, { type: 'assistant', messageId: 'm', text: 'private-bank-result' })
  }, onCancel: () => gate.resolve() })
  const route = await conversation(f.bank)
  const bound = await f.bank.claim(pairCode(await route.session.ask('绑定')), customer('alice'))
  await route.session.ask('转账')
  await f.bank.revoke(route.id, 'alice')
  await sleep(30)
  assert.equal(f.deliveries.length, 0)
  assert(f.calls.some(call => call[0] === 'cancel' && call[1] === bound.sessionId))
  const newCode = pairCode(await route.session.ask('绑定'))
  await f.bank.claim(newCode, customer('alice'))
  const restart = createImBank({ ...f.deps, store: await openImStore(f.path, f.key) })
  t.after(() => restart.close())
  const restored = restart.harness('weixin', 'bot-a').workspaceSession(route.id, 'p2p:person-a')
  assert.match(await restored.ask('查余额'), /先在银行页面登录/)
})

test('revocation during an in-flight identity check prevents starting a bank task', async t => {
  const gate = deferred(), entered = deferred()
  let block = false
  const f = await fixture(t, { dependencies: { current: async () => { if (block) { entered.resolve(); await gate.promise } return {} } } })
  const route = await conversation(f.bank)
  await f.bank.claim(pairCode(await route.session.ask('绑定')), customer('alice'))
  block = true
  const reply = route.session.ask('查询余额')
  await entered.promise
  await f.bank.revoke(route.id, 'alice')
  gate.resolve()
  assert.match(await reply, /连接已更改/)
  assert.equal(f.calls.filter(call => call[0] === 'run').length, 0)
})

test('revocation during outbound reauthentication suppresses the completed private result', async t => {
  const gate = deferred(), checked = deferred(), model = deferred()
  let block = false, f
  f = await fixture(t, {
    dependencies: { current: async () => { if (block) { checked.resolve(); await gate.promise } return {} } },
    run: async id => { f.bank.observe(id, { type: 'consent', challenge: { challengeId: 'c' } }); await model.promise; f.bank.observe(id, { type: 'assistant', messageId: 'm', text: 'private-result' }) },
    onCancel: () => model.resolve(),
  })
  const route = await conversation(f.bank)
  await f.bank.claim(pairCode(await route.session.ask('绑定')), customer('alice'))
  await route.session.ask('查询余额')
  block = true; model.resolve()
  await checked.promise
  await f.bank.revoke(route.id, 'alice')
  gate.resolve(); await sleep(30)
  assert.equal(f.deliveries.length, 0)
})

test('actual pinned dsh-im WeChat and WeCom runtimes route messages through the bank adapter and block native commands/groups', async t => {
  const f = await fixture(t)
  const vendor = await loadImVendor(), wxReplies = [], wcReplies = [], waiting = [], incoming = []
  let client
  const weixinApi = {
    beginLogin: async () => ({ qrcode: 'fixture-qr', qrcodeUrl: 'https://ilinkai.weixin.qq.com/fixture' }),
    pollLogin: async () => ({ status: 'confirmed', bot_token: 'fixture-weixin-secret', ilink_bot_id: 'fixture-account', ilink_user_id: 'wx-user', baseurl: 'https://ilinkai.weixin.qq.com/' }),
    notifyStart: async () => ({}), notifyStop: async () => ({}),
    getConfig: async () => ({}), sendTyping: async () => ({}),
    sendText: async message => { wxReplies.push(message); return { providerMessageIds: [`out-${wxReplies.length}`] } },
    getUpdates: ({ signal }) => {
      if (incoming.length) return Promise.resolve({ msgs: incoming.splice(0), get_updates_buf: 'fixture-cursor' })
      return new Promise(resolve => {
        const finish = messages => { signal.removeEventListener('abort', abort); resolve({ msgs: messages, get_updates_buf: 'fixture-cursor' }) }
        const abort = () => { waiting.splice(waiting.indexOf(finish), 1); finish([]) }
        waiting.push(finish); signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort()
      })
    },
  }
  const pushWx = (id, text) => {
    const message = { message_id: id, from_user_id: 'wx-user', message_type: 1, context_token: 'fixture-context', item_list: [{ type: 1, text_item: { text } }] }
    const receive = waiting.shift(); if (receive) receive([message]); else incoming.push(message)
  }
  class Client extends EventEmitter {
    connect() { queueMicrotask(() => this.emit('authenticated')) }
    disconnect() {}
    async replyStream(frame, id, text, finish) { if (finish) wcReplies.push(text); return {} }
    async sendMessage(id, body) { wcReplies.push(body.markdown?.content); return {} }
  }
  const channels = await createImChannels({ directory: join(f.directory, 'channels'), credentials: f.store.credentials, harness: f.bank.harness, vendor, weixinApi, createWecomClient: () => { client = new Client(); return client } })
  t.after(async () => { await f.bank.close(); await channels.close() })
  await channels.initialize()
  const attempt = await channels.provision('weixin')
  assert.match(attempt.qrImage, /^data:image\/png;base64,/)
  await waitFor(() => channels.status().channels.weixin.bots.some(bot => bot.connected))
  pushWx('wx-1', '查余额')
  await waitFor(() => wxReplies.find(item => pairCode(item.text)))
  await f.bank.claim(pairCode(wxReplies.find(item => pairCode(item.text)).text), customer('alice'))
  pushWx('wx-2', '查询我的余额')
  await waitFor(() => wxReplies.find(item => item.text.includes('已办理：查询我的余额')))
  const wxRoute = Object.values(f.store.snapshot().routes).find(route => route.channel === 'weixin')
  await channels.deliver(wxRoute, '银行页面确认后的微信回执。')
  assert(wxReplies.some(item => item.toUserId === 'wx-user' && item.text === '银行页面确认后的微信回执。'))
  const before = f.calls.filter(item => item[0] === 'run').length
  pushWx('wx-command', '/workspace C:/')
  await waitFor(() => wxReplies.some(item => item.text.includes('权限')))
  assert.equal(f.calls.filter(item => item[0] === 'run').length, before)
  await channels.bindWecom({ botId: 'fixture-remote-bot', secret: 'fixture-wecom-secret' })
  assert(channels.status().channels.wecom.bots.some(bot => bot.connected))
  const frame = (id, text, chattype = 'single') => ({ headers: { req_id: id }, body: { msgid: id, chattype, chatid: 'fixture-group', from: { userid: 'wc-user' }, msgtype: 'text', text: { content: text } } })
  client.emit('message', frame('wc-1', '查余额'))
  await waitFor(() => wcReplies.find(text => pairCode(text)))
  await f.bank.claim(pairCode(wcReplies.find(text => pairCode(text))), customer('bob'))
  client.emit('message', frame('wc-2', '查询工单'))
  await waitFor(() => wcReplies.some(text => text?.includes('已办理：查询工单')))
  const wcRoute = Object.values(f.store.snapshot().routes).find(route => route.channel === 'wecom')
  await channels.deliver(wcRoute, '银行页面确认后的企微回执。')
  assert(wcReplies.includes('银行页面确认后的企微回执。'))
  const beforeGroup = f.calls.filter(item => item[0] === 'run').length
  client.emit('message', frame('wc-group', '@机器人 查询余额', 'group'))
  await sleep(30)
  assert.equal(f.calls.filter(item => item[0] === 'run').length, beforeGroup)
  assert(!JSON.stringify(channels.status()).includes('fixture-wecom-secret'))
  assert(!JSON.stringify(channels.status()).includes('fixture-weixin-secret'))
})

test('IM management requires live ops authentication; customer binding requires the bank identity; public portal has CSP', async t => {
  const f = await fixture(t), channelCalls = []
  const channels = { status: () => ({ version: '5.1.0', channels: {} }), provision: async name => { channelCalls.push(name); return { status: 'pending' } } }
  const http = createImHttp({ bank: f.bank, channels, bankUrl: 'https://bank.internal/', fetchImpl: async (url, options) => {
    const role = options.headers.authorization === 'Bearer ops-token' ? 'ops' : 'csr'
    return Response.json({ id: role, role })
  } })
  const server = createServer(async (req, res) => {
    const readJson = async () => { let body = ''; for await (const chunk of req) body += chunk; return JSON.parse(body || '{}') }
    const sendJson = async (response, status, body) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(body)) }
    try {
      const handled = await http.handle(req, res, { pathname: new URL(req.url, 'http://localhost').pathname, identity: req.headers.authorization === 'Bearer alice-token' ? customer('alice') : undefined, readJson, sendJson })
      if (!handled) await sendJson(res, 401, { error: 'Bank login required' })
    } catch (error) { await sendJson(res, error.status ?? 500, { error: error.message }) }
  })
  await new Promise(done => server.listen(0, '127.0.0.1', done)); t.after(() => new Promise(done => { server.closeAllConnections(); server.close(done) }))
  const base = `http://127.0.0.1:${server.address().port}`
  const page = await fetch(base + '/agent-api/im')
  assert.equal(page.status, 200); assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/)
  assert((await page.text()).includes('IM 连接'))
  assert.equal((await fetch(base + '/agent-api/im/admin/status')).status, 403)
  assert.equal((await fetch(base + '/agent-api/im/admin/status', { headers: { authorization: 'Bearer csr-token' } })).status, 403)
  assert.equal((await fetch(base + '/agent-api/im/admin/status', { headers: { authorization: 'Bearer ops-token' } })).status, 200)
  assert.equal((await fetch(base + '/agent-api/im/claim', { method: 'POST', body: '{}' })).status, 401)
  assert.equal(channelCalls.length, 0)
})

test('real installed DSH 0.2.1 runtime answers a bound IM session through a local model protocol', { skip: process.env.LUCKYCAT_IM_BROWSER !== '1' }, async t => {
  let harness, f
  const provider = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk
    const request = JSON.parse(body)
    assert.equal(request.model, 'im-test')
    assert(!body.includes('bank-token-alice'))
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const chunk = (delta, reason = null) => `data: ${JSON.stringify({ id: 'im-fixture', object: 'chat.completion.chunk', created: 1, model: 'im-test', choices: [{ index: 0, delta, finish_reason: reason }] })}\n\n`
    res.end(chunk({ role: 'assistant', content: 'IM运行时连接成功。' }) + chunk({}, 'stop') + 'data: [DONE]\n\n')
  })
  await new Promise(done => provider.listen(0, '127.0.0.1', done))
  t.after(() => new Promise(done => { provider.closeAllConnections(); provider.close(done) }))
  f = await fixture(t, { run: async id => {
    const result = await harness.session(id).run('请用中文确认连接。')
    f.bank.observe(id, { type: 'assistant', messageId: 'harness-answer', text: result.finalResponse })
  } })
  const root = fileURLToPath(new URL('../', import.meta.url))
  const patch = join(f.directory, 'im-provider.json')
  await writeFile(patch, JSON.stringify([
    { id: 'sessions', config: { root: join(f.directory, 'sessions'), compression: 'none' } },
    { id: 'luckycat-rag', disabled: true }, { id: 'luckycat-embedding', disabled: true },
    { id: 'llm-pi-ai', config: { providers: { 'im-fixture': { apiKeyEnv: 'LUCKYCAT_IM_FIXTURE_KEY', api: 'openai-completions', baseURL: `http://127.0.0.1:${provider.address().port}/v1`, retryPolicy: { mode: 'normal', maxRetries: 0 }, models: [{ id: 'im-test', name: 'IM test', contextWindow: 128000 }] } } } },
  ]))
  const { DeepSeekHarness } = await import('@deepseek-ai/dsh-sdk-client')
  harness = new DeepSeekHarness({ dshBin: join(root, 'node_modules/@deepseek-ai/dsh/lib/bin.js'), profile: 'luckycat', provider: 'im-fixture', model: 'im-test', initializeTimeoutMs: 30_000, patches: [patch], env: { ...process.env, DSH_HOME: join(root, '.dsh-home'), LUCKYCAT_IM_FIXTURE_KEY: 'fixture-only', LUCKYCAT_BANK_MODE: 'http' } })
  t.after(() => harness.close())
  const route = await conversation(f.bank)
  await f.bank.claim(pairCode(await route.session.ask('绑定')), customer('alice'))
  assert.equal(await route.session.ask('确认连接'), 'IM运行时连接成功。')
})

test('browser: bind a private chat, inspect bank confirmation, correct a password, receive the result and manage bots', { skip: process.env.LUCKYCAT_IM_BROWSER !== '1' }, async t => {
  const gate = deferred(), events = []
  let f
  f = await fixture(t, { run: async id => {
    const consent = { type: 'consent', challenge: { challengeId: 'browser-consent', kind: '转账', expiresAt: Date.now() + 180_000, verification: 'payment-password', fields: [{ label: '收款账号', value: '1234567890123456' }, { label: '转账金额', value: '¥100.00' }], consequence: '核对后提交银行服务。' } }
    events.push(consent); f.bank.observe(id, consent)
    await gate.promise
    events.push({ type: 'consent-resolved', challengeId: 'browser-consent' })
    const answer = { type: 'assistant', messageId: 'browser-answer', text: '银行已受理，回执 browser-123。' }
    events.push(answer); f.bank.observe(id, answer)
  }, onCancel: () => gate.resolve() })
  const route = await conversation(f.bank)
  const code = pairCode(await route.session.ask('绑定'))
  const channels = { status: () => ({ version: '5.1.0', channels: { weixin: { bots: [] }, wecom: { bots: [] } } }), bindWecom: async () => ({ ok: true }) }
  const http = createImHttp({ bank: f.bank, channels, bankUrl: 'https://bank.internal/', fetchImpl: async (url, options) => {
    if (url.pathname.endsWith('/sms-code')) return Response.json({ demoCode: '123456' })
    if (url.pathname === '/api/auth/login') return Response.json({ token: 'browser-customer-token', user: { name: '测试客户' } })
    if (url.pathname === '/staff-api/login') return Response.json({ token: 'browser-ops-token', staff: { role: 'ops', name: '测试运维' } })
    if (url.pathname === '/staff-api/me') return Response.json({ role: options.headers.authorization === 'Bearer browser-ops-token' ? 'ops' : 'csr' })
    return Response.json({ error: 'fixture unavailable' }, { status: 404 })
  } })
  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname
    const identity = req.headers.authorization === 'Bearer browser-customer-token' ? customer('alice') : undefined
    const readJson = async () => { let body = ''; for await (const chunk of req) body += chunk; return JSON.parse(body || '{}') }
    const sendJson = async (response, status, body) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(body)) }
    try {
      if (await http.handle(req, res, { pathname, identity, readJson, sendJson })) return
      if (!identity) return await sendJson(res, 401, { error: '请登录' })
      if (/^\/agent-api\/sessions\/web-\d+\/events$/.test(pathname)) return await sendJson(res, 200, { cursor: String(events.length), events: events.slice(Number(new URL(req.url, 'http://localhost').searchParams.get('after') ?? 0)) })
      if (pathname === '/agent-api/consent/browser-consent') {
        const body = await readJson()
        if (body.paymentPassword !== 'fixture-payment') return await sendJson(res, 401, { error: '支付密码不正确', code: 'INVALID_PAYMENT_PASSWORD' })
        gate.resolve(); return await sendJson(res, 200, { ok: true })
      }
      await sendJson(res, 404, { error: 'Not found' })
    } catch (error) { await sendJson(res, error.status ?? 500, { error: error.message }) }
  })
  await new Promise(done => server.listen(0, '127.0.0.1', done)); t.after(() => new Promise(done => { server.closeAllConnections(); server.close(done) }))
  const { chromium } = createRequire(new URL('../../tools/package.json', import.meta.url))('playwright-core')
  const executablePath = process.env.CHROME_PATH ?? ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync)
  const browser = await chromium.launch({ executablePath, headless: true }); t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1000, height: 1000 } })
  const failures = []; page.on('pageerror', error => failures.push(error.message))
  await page.goto(`http://127.0.0.1:${server.address().port}/agent-api/im#code=${code}`)
  assert.equal(new URL(page.url()).hash, '')
  await page.locator('#identity').fill('13800138000'); await page.locator('#password').fill('fixture-login')
  await page.locator('#sms-button').click()
  await page.getByText('演示环境验证码：123456（5 分钟内有效，已填入）', { exact: true }).waitFor()
  assert.equal(await page.locator('#sms-code').inputValue(), '123456')
  assert(await page.locator('#sms-button').isDisabled())
  await page.locator('#identity').fill('13800138001')
  assert.equal(await page.locator('#sms-code').inputValue(), '')
  assert(await page.locator('#sms-hint').isHidden())
  assert(await page.locator('#sms-button').isEnabled())
  await page.locator('#identity').fill('13800138000')
  assert(await page.locator('#sms-button').isDisabled())
  await page.locator('#sms-code').fill('123456')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await page.locator('#customer-panel').waitFor({ state: 'visible' })
  await page.getByRole('button', { name: '确认绑定到当前银行账户' }).click()
  await page.locator('#session-panel').waitFor({ state: 'visible' })
  assert(await page.locator('#preview-button').isDisabled())
  await route.session.ask('给指定收款人转账100元')
  await page.getByRole('button', { name: '确认操作', exact: true }).waitFor()
  assert((await page.locator('#pending').innerText()).includes('1234567890123456'))
  const screenshots = fileURLToPath(new URL('../.generated/im-browser/', import.meta.url))
  await mkdir(screenshots, { recursive: true })
  await page.screenshot({ path: join(screenshots, 'desktop.png'), fullPage: true })
  await page.locator('#pending input[type=password]').fill('wrong-fixture')
  await page.getByRole('button', { name: '确认操作', exact: true }).click()
  await page.getByText('支付密码不正确', { exact: true }).waitFor()
  assert(await page.locator('#customer-panel').isVisible())
  await page.locator('#pending input[type=password]').fill('fixture-payment')
  await page.getByRole('button', { name: '确认操作', exact: true }).click()
  await page.getByText('银行已受理，回执 browser-123。', { exact: true }).waitFor()
  await waitFor(() => f.deliveries.length === 1)
  await page.setViewportSize({ width: 390, height: 844 })
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await page.screenshot({ path: join(screenshots, 'mobile.png'), fullPage: true })
  await page.locator('#pair-code').fill(code)
  await page.getByRole('button', { name: '核对来源' }).click()
  await page.getByText(/此绑定链接已使用或已过期/).waitFor()
  assert(await page.locator('#claim-button').isHidden())
  await page.getByRole('button', { name: '解除连接', exact: true }).click()
  assert.equal(f.bank.list('alice')[0].connected, true)
  await page.getByRole('button', { name: '保留连接', exact: true }).click()
  assert.equal(f.bank.list('alice')[0].connected, true)
  await page.getByRole('button', { name: '解除连接', exact: true }).click()
  await page.getByRole('button', { name: '确认解除此私聊', exact: true }).click()
  await page.getByText('已解除连接。如需重新绑定，请回到原微信私聊发送“绑定”，使用新链接。', { exact: true }).waitFor()
  assert.equal(f.bank.list('alice').length, 0)
  const freshCode = pairCode(await route.session.ask('绑定'))
  assert.notEqual(freshCode, code)
  await page.locator('#pair-code').fill(freshCode)
  await page.getByRole('button', { name: '核对来源' }).click()
  await page.getByRole('button', { name: '确认绑定到当前银行账户' }).click()
  await page.getByText('绑定成功，请回到 IM 发送需求。', { exact: true }).waitFor()
  assert.equal(f.bank.list('alice')[0].connected, true)
  await page.getByRole('button', { name: '机器人管理', exact: true }).click()
  await page.locator('#identity').fill('测试运维'); await page.locator('#password').fill('fixture-ops')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await page.locator('#admin-panel').waitFor({ state: 'visible' })
  await page.locator('#bot-id').fill('fixture-bot'); await page.locator('#bot-secret').fill('fixture-secret')
  await page.getByRole('button', { name: '保存并连接', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('#bot-secret').value === '')
  assert.deepEqual(failures, [])
})
