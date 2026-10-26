import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openImStore } from './im-store.mjs'
import { createImBank } from './im-bank.mjs'
import { createImHttp } from './im-http.mjs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
const codeOf = text => /#code=([\w-]+)/.exec(text)[1]
const alice = { user: { id: 'alice' }, token: 'fixture' }
async function fixture(t, run) {
  const directory = await mkdtemp(join(tmpdir(), 'im-handoff-'))
  let now = Date.now(), bank, next = 0
  const store = await openImStore(join(directory, 'bindings.enc.json'), randomBytes(32).toString('base64'))
  const sessions = new Map(), calls = [], deliveries = []
  bank = createImBank({ store, clock: () => now, publicUrl: 'https://bank.test',
    createSession: async identity => { const id = 'session-' + ++next; sessions.set(id, { owner: identity.user.id }); return id },
    current: async id => { if (!sessions.has(id) || sessions.get(id).expired) throw Error('expired') },
    cancel: async () => {}, deliver: async (route, text) => deliveries.push({ route, text }),
    run: async (id, text) => { calls.push({ id, text }); if (run) await run(bank, id, text); else bank.observe(id, { type: 'assistant', text: '本人实际查询结果' }) },
  })
  const harness = bank.harness('weixin', 'fixture-bot'), id = await harness.createSession({ conversationKey: 'p2p:alice' }), chat = harness.workspaceSession(id, 'p2p:alice')
  t.after(async () => { await bank.close(); await rm(directory, { recursive: true, force: true }) })
  return { bank, chat, id, store, sessions, calls, deliveries, advance: ms => { now += ms } }
}
const flush = () => new Promise(resolve => setTimeout(resolve, 15))

test('login-required bank request remains visible and resumes only after explicit authenticated continuation, exactly once', async t => {
  const f = await fixture(t)
  const code = codeOf(await f.chat.ask('查看我当前余额'))
  assert.equal(f.bank.preview(code).request, undefined, 'no identity means no request text')
  assert.equal(f.bank.preview(code, 'alice').request, '查看我当前余额')
  const binding = await f.bank.claim(code, alice)
  assert.equal(f.calls.length, 0, 'binding does not execute the request')
  assert.equal(binding.continuation.request, '查看我当前余额')
  assert.equal(f.bank.list('alice')[0].continuation.token, binding.continuation.token, 'owned page can restore its unconsumed request after refresh')
  assert.deepEqual(f.bank.list('bob'), [])
  await assert.rejects(f.bank.continueRequest(binding.continuation.token, 'bob'), /不存在或已过期/)
  const result = await f.bank.continueRequest(binding.continuation.token, 'alice')
  assert.equal(result.sessionId, binding.sessionId); await flush()
  assert.equal(f.bank.list('alice')[0].continuation, undefined)
  assert.equal(f.calls.length, 1); assert.equal(f.deliveries.length, 1)
  assert.equal(f.deliveries[0].route.id, f.id)
  await assert.rejects(f.bank.continueRequest(binding.continuation.token, 'alice'), /不存在或已过期/)
  assert.equal(f.calls.length, 1)
})

test('reauthentication preserves reminder binding revision but never restores old financial session or pending grants', async t => {
  const f = await fixture(t)
  const first = await f.bank.claim(codeOf(await f.chat.ask('绑定')), alice)
  const revision = f.store.snapshot().routes[f.id].bindingRevision
  f.sessions.get(first.sessionId).expired = true
  const code = codeOf(await f.chat.ask('查看当前订阅情况'))
  assert.throws(() => f.bank.preview(code, 'bob'), /本人账户/)
  const fresh = await f.bank.claim(code, alice)
  assert.notEqual(fresh.sessionId, first.sessionId)
  assert.equal(f.store.snapshot().routes[f.id].bindingRevision, revision)
  assert.equal(f.calls.length, 0)
  await f.bank.continueRequest(fresh.continuation.token, 'alice'); await flush()
  assert.deepEqual(f.calls.map(row => row.id), [fresh.sessionId])
})

test('a fresh instruction sent from WeChat supersedes the unstarted recovery request rather than allowing duplicate replay', async t => {
  const f = await fixture(t)
  const bound = await f.bank.claim(codeOf(await f.chat.ask('查询余额')), alice)
  await f.chat.ask('查询余额')
  assert.equal(f.calls.length, 1)
  assert.equal(f.bank.list('alice')[0].continuation, undefined)
  await assert.rejects(f.bank.continueRequest(bound.continuation.token, 'alice'), /不存在或已过期/)
  assert.equal(f.calls.length, 1)
})

test('continuation expires or is invalidated by revoke/rebind; sensitive or binding-only messages are never resumed', async t => {
  const f = await fixture(t)
  let binding = await f.bank.claim(codeOf(await f.chat.ask('查询余额')), alice)
  f.advance(600001)
  await assert.rejects(f.bank.continueRequest(binding.continuation.token, 'alice'), /已过期/)
  f.sessions.get(binding.sessionId).expired = true
  binding = await f.bank.claim(codeOf(await f.chat.ask('查询余额')), alice)
  await f.bank.revoke(f.id, 'alice')
  await assert.rejects(f.bank.continueRequest(binding.continuation.token, 'alice'), /不存在或已过期/)
  const sensitive = codeOf(await f.chat.ask('查余额，支付密码888888'))
  assert.equal(f.bank.preview(sensitive, 'alice').request, undefined)
  assert.equal((await f.bank.claim(sensitive, alice)).continuation, undefined)
  f.sessions.get(f.bank.list('alice')[0].sessionId).expired = true
  assert.equal((await f.bank.claim(codeOf(await f.chat.ask('绑定')), alice)).continuation, undefined)
  assert.equal(f.calls.length, 0)
})

test('continuing a financial instruction opens its normal consent; no financial work is performed by login/claim/continue', async t => {
  let finish, mutations = 0
  const gate = new Promise(resolve => { finish = resolve })
  const f = await fixture(t, async (bank, id) => {
    bank.observe(id, { type: 'consent', challenge: { challengeId: 'fixture-consent' } })
    const approved = await gate
    if (approved) mutations++
    bank.observe(id, { type: 'assistant', text: approved ? '模拟银行回执' : '已取消' })
  })
  t.after(() => finish(false))
  const binding = await f.bank.claim(codeOf(await f.chat.ask('转账一百元')), alice)
  assert.equal(mutations, 0)
  await f.bank.continueRequest(binding.continuation.token, 'alice'); await flush()
  assert.equal(mutations, 0); assert.equal(f.calls.length, 1)
  assert(f.deliveries.some(row => row.text.includes('#session=' + binding.sessionId)))
  finish(true); await flush(); assert.equal(mutations, 1)
})

test('browser: lost-login request survives login, binding and refresh; deep link renders live consent absent from event history', { skip: process.env.LUCKYCAT_IM_BROWSER !== '1' }, async t => {
  let pending, resolveConsent, writes = 0, sequence = 0
  const history = []
  const record = event => history.push({ id: ++sequence, event })
  const f = await fixture(t, async (bank, id, text) => {
    if (text.includes('转账')) {
      const gate = new Promise(resolve => { resolveConsent = resolve })
      pending = { challengeId: 'handoff-consent', sessionId: id, kind: '核对转账', expiresAt: Date.now() + 180000, verification: 'payment-password', fields: [{ label: '收款账号', value: '1234567890123456' }, { label: '金额', value: 'CNY 100.00' }] }
      // Deliberately absent from history: only the live snapshot may display this consent.
      bank.observe(id, { type: 'consent', challenge: pending })
      const approved = await gate
      if (approved) writes++
      pending = undefined; record({ type: 'consent-resolved', challengeId: 'handoff-consent' })
    }
    const event = { type: 'assistant', messageId: 'answer-' + sequence, text: text.includes('转账') ? '模拟银行已受理本次转账' : '已读取本人订阅清单' }
    record(event); bank.observe(id, event)
  })
  t.after(() => resolveConsent?.(false))
  const http = createImHttp({ bank: f.bank, channels: {}, bankUrl: 'https://fixture.test', fetchImpl: async () => Response.json({ token: 'alice-fixture', user: { name: '隔离客户' } }) })
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost'), pathname = url.pathname
    const identity = req.headers.authorization === 'Bearer alice-fixture' ? alice : undefined
    const readJson = async () => { let raw = ''; for await (const chunk of req) raw += chunk; return JSON.parse(raw || '{}') }
    const sendJson = async (response, status, body) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(body)) }
    try {
      if (await http.handle(req, res, { pathname, identity, readJson, sendJson })) return
      if (!identity) return await sendJson(res, 401, { error: '请登录' })
      if (pathname.endsWith('/events')) {
        const id = pathname.split('/')[3]
        if (!f.bank.list('alice').some(row => row.sessionId === id)) throw Object.assign(Error('会话不属于本人'), { status: 404 })
        const after = url.searchParams.get('after')
        const events = after === null ? [...(pending?.sessionId === id ? [{ type: 'consent', challenge: pending }] : []), { type: 'status', status: pending ? 'running' : 'idle' }]
          : history.filter(row => row.id > Number(after)).map(row => row.event)
        return await sendJson(res, 200, { cursor: String(sequence), events })
      }
      if (pathname === '/agent-api/consent/handoff-consent') {
        const body = await readJson()
        if (body.paymentPassword !== 'fixture-pay') return await sendJson(res, 401, { error: '支付密码不正确', code: 'INVALID_PAYMENT_PASSWORD' })
        resolveConsent(body.decision === 'approve'); return await sendJson(res, 200, { ok: true })
      }
      await sendJson(res, 404, { error: '没有此夹具接口' })
    } catch (error) { await sendJson(res, error.status ?? 500, { error: error.message }) }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  const { chromium } = createRequire(new URL('../../tools/package.json', import.meta.url))('playwright-core')
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true }); t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 412, height: 915 }, isMobile: true })
  const failures = []; page.on('pageerror', error => failures.push(error.message))
  const base = `http://127.0.0.1:${server.address().port}`
  const login = async () => { if (await page.locator('#customer-panel').isVisible()) return; await page.locator('#identity').fill('13800138000'); await page.locator('#password').fill('fixture-login'); await page.getByRole('button', { name: '登录', exact: true }).click(); await page.locator('#customer-panel').waitFor({ state: 'visible' }) }
  const code = codeOf(await f.chat.ask('查看我当前订阅情况'))
  await page.goto(base + '/agent-api/im#code=' + code)
  await page.getByRole('heading', { name: '恢复微信银行连接', exact: true }).waitFor()
  await login(); await page.locator('#handoff-request').getByText('查看我当前订阅情况', { exact: true }).waitFor()
  assert.equal(f.calls.length, 0)
  await page.getByRole('button', { name: '确认绑定到当前银行账户', exact: true }).click()
  await page.getByRole('button', { name: '继续这次请求', exact: true }).waitFor()
  assert.equal(f.calls.length, 0)
  await page.reload(); await login()
  await page.getByRole('button', { name: '继续这次请求', exact: true }).click()
  await page.getByText('已读取本人订阅清单', { exact: true }).waitFor()
  assert.equal(f.calls.length, 1); assert.equal(writes, 0)
  const sessionId = f.bank.list('alice')[0].sessionId
  for (let i = 0; i < 35; i++) record({ type: 'assistant', messageId: 'earlier-' + i, text: '同一私聊以前的查询回复 ' + i })
  await f.chat.ask('给指定收款人转账100元')
  await page.goto(base + '/agent-api/im#session=' + sessionId); await login()
  await page.locator('#pending').getByText('CNY 100.00', { exact: true }).waitFor()
  await page.waitForFunction(() => { const y = document.querySelector('#pending').getBoundingClientRect().top; return y >= -1 && y < innerHeight })
  assert.equal(writes, 0)
  await page.locator('#pending input[type=password]').fill('wrong')
  await page.getByRole('button', { name: '确认操作', exact: true }).click()
  await page.getByText('支付密码不正确', { exact: true }).waitFor(); assert.equal(writes, 0)
  await page.locator('#pending input[type=password]').fill('fixture-pay')
  await page.getByRole('button', { name: '确认操作', exact: true }).click()
  await page.getByText('模拟银行已受理本次转账', { exact: true }).waitFor(); assert.equal(writes, 1)
  // A customer already signed in to the main web app goes straight to the owned session.
  await page.evaluate(() => sessionStorage.setItem('luckycat.token', JSON.stringify('alice-fixture')))
  await page.goto(base + '/agent-api/im#session=' + sessionId)
  await page.reload()
  await page.locator('#customer-panel').waitFor({ state: 'visible' }); assert(await page.locator('#login-panel').isHidden())
  assert.equal(await page.getByRole('button', { name: '确认操作', exact: true }).count(), 0, 'resolved history must never recreate a confirmation')
  assert.deepEqual(failures, [])
})
