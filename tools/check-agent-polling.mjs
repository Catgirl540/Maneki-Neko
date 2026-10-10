/** 本地验证 SSE 首帧被缓冲、连接中断后的短请求兼容；不调用外部模型。 */
import assert from 'node:assert/strict'
import { createServer as http } from 'node:http'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { once } from 'node:events'
import { createServer } from '../app/node_modules/vite/dist/node/index.js'
import { chromium } from 'playwright-core'
import { createEventPolling } from '../framework/bridge/event-polling.mjs'
import { login } from './lib/session.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const inbox = createEventPolling()
const entry = { eventSeq: 2, events: [{ id: '1', event: { type: 'assistant', text: 'first' } }, { id: '2', event: { type: 'status', status: 'idle' } }] }
try {
  assert.deepEqual(inbox.read(entry, null, [{ type: 'hello' }]), { cursor: '2', events: [{ type: 'hello' }] })
  assert.deepEqual(inbox.read(entry, '1', []).events, [{ type: 'status', status: 'idle' }])
  for (const cursor of ['-1', 'NaN', '3', '9007199254740992']) assert.throws(() => inbox.read(entry, cursor, []))
  const secret = { type: 'card-secret', value: 'test-only-secret', expiresAt: Date.now() + 1000 }
  inbox.remember(entry, secret)
  assert.equal(inbox.read(entry, '2', []).events[0], secret)
  assert.deepEqual(inbox.read(entry, '2', []).events, [])
  assert(!JSON.stringify(entry).includes('test-only-secret'))
  inbox.remember(entry, { ...secret, expiresAt: Date.now() + 15 })
  await new Promise(r => setTimeout(r, 30))
  assert.deepEqual(inbox.read(entry, '2', []).events, [])
  console.log('PASS 事件游标、单次领取卡密、过期清除，卡密不进入重放缓冲')
} finally { inbox.close() }

const server = http(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  const json = (data, status = 200) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(data)) }
  if (url.pathname === '/api/auth/profile') {
    const id = { 'Bearer tokenA': 'a', 'Bearer tokenB': 'b' }[req.headers.authorization]
    return json(id ? { id } : { message: 'expired', code: 'UNAUTHORIZED' }, id ? 200 : 401)
  }
  if (url.pathname === '/agent-api/health') return json({ ok: true, bankDataSource: 'http' })
  if (url.pathname === '/agent-api/sessions') {
    const id = randomUUID(); sessions.set(id, { events: [], streams: new Set(), seq: 0 })
    return json({ sessionId: id })
  }
  const [, , , id, action] = url.pathname.split('/')
  const current = sessions.get(id)
  if (!current) return json({ error: 'missing' }, 404)
  if (action === 'stream') {
    res.writeHead(200, { 'content-type': 'text/event-stream' }); res.flushHeaders()
    current.streams.add(res); res.on('close', () => current.streams.delete(res))
    if (!stall) res.write('id: 0\ndata: ' + JSON.stringify({ type: 'hello', sessionId: id }) + '\n\n')
    return
  }
  if (action === 'events') {
    pollRequests++
    const after = url.searchParams.get('after')
    return json({ cursor: String(current.seq), events: after === null
      ? [{ type: 'hello', sessionId: id }, { type: 'status', status: 'idle' }]
      : current.events.filter(item => item.id > Number(after)).map(item => item.event) })
  }
  if (action === 'messages') {
    for await (const chunk of req) { void chunk }
    messagePosts++
    // 模拟消息被接受后 SSE 断开，回复在接收方式切换期间产生。
    if (dropAfterSend) for (const stream of current.streams) stream.end()
    for (const event of [{ type: 'status', status: 'running' }, { type: 'assistant', text: '兼容通道测试回复' }, { type: 'status', status: 'idle' }]) {
      const id = ++current.seq; current.events.push({ id, event })
      if (!dropAfterSend) for (const stream of current.streams) stream.write('id: ' + id + '\ndata: ' + JSON.stringify(event) + '\n\n')
    }
    return json({ accepted: true }, 202)
  }
  return json({ known: true, started: true, busy: false })
})
const sessions = new Map()
let stall = true, dropAfterSend = false, messagePosts = 0, pollRequests = 0
let vite, browser, bridge
const wait = async (check, message) => {
  for (let n = 0; n < 100; n++) { if (await check()) return; await new Promise(r => setTimeout(r, 50)) }
  assert.fail(message)
}
try {
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const fixture = 'http://127.0.0.1:' + server.address().port
  // 实际桥接路由的登录、会话归属及 Cache-Control 校验；不启动 Harness。
  const portServer = http(); await new Promise(r => portServer.listen(0, '127.0.0.1', r))
  const port = portServer.address().port; await new Promise(r => portServer.close(r))
  bridge = spawn(process.execPath, ['framework/bridge/demo-server.mjs'], {
    cwd: root, env: { ...process.env, LUCKYCAT_DEMO_PORT: String(port), LUCKYCAT_BANK_URL: fixture, LUCKYCAT_BANK_MODE: 'http', LUCKYCAT_DISABLE_VOICE: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''; bridge.stdout.on('data', x => { log += x }); bridge.stderr.on('data', x => { log += x })
  const base = 'http://127.0.0.1:' + port
  await wait(async () => { try { return (await fetch(base + '/agent-api/health')).status === 401 } catch { return false } }, log)
  const request = (path, token = 'tokenA', init = {}) => fetch(base + path, { ...init, headers: { authorization: 'Bearer ' + token } })
  const sid = (await (await request('/agent-api/sessions', 'tokenA', { method: 'POST' })).json()).sessionId
  const endpoint = '/agent-api/sessions/' + sid + '/events'
  assert.equal((await request(endpoint, '')).status, 401)
  assert.equal((await request(endpoint, 'tokenB')).status, 404)
  const response = await request(endpoint)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const initial = await response.json(); assert.equal(initial.events[0].type, 'hello')
  assert.deepEqual((await (await request(endpoint + '?after=0')).json()).events, [])
  assert.equal((await request(endpoint + '?after=-1')).status, 400)
  const controller = new AbortController()
  const stream = await request('/agent-api/sessions/' + sid + '/stream', 'tokenA', { signal: controller.signal })
  assert(stream.headers.get('cache-control').includes('no-transform'))
  const frame = new TextDecoder().decode((await stream.body.getReader().read()).value)
  assert(frame.startsWith(':')); assert(frame.includes('id: 0\ndata:')); assert(frame.includes('"type":"hello"'))
  controller.abort()
  console.log('PASS 实际桥接短请求路由：银行登录、会话归属、游标校验、禁止缓存')

  process.env.VITE_USE_MOCK = 'true'; process.env.VITE_AGENT_TARGET = fixture
  vite = await createServer({ root: root + 'app', appType: 'spa', server: { host: '127.0.0.1', port: 0 } }); await vite.listen()
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH })
  const page = await browser.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message))
  await login(page, 'http://127.0.0.1:' + vite.httpServer.address().port, { to: '/support' })
  await page.locator('[data-agent-status="ready"]').waitFor()
  const send = async text => { await page.getByLabel('聊天消息').fill(text); await page.getByRole('button', { name: '发送', exact: true }).click() }
  await send('首帧一直被缓冲')
  await page.locator('[data-message-kind="assistant"]').waitFor({ timeout: 12000 })
  assert.equal(messagePosts, 1); assert(pollRequests > 0)
  await wait(() => [...sessions.values()].every(s => s.streams.size === 0), '超时 SSE 未释放')
  assert.equal(await page.getByText(/发送失败/).count(), 0)
  console.log('PASS SSE 首帧一直被缓冲时自动切换；回复成功且消息只提交一次')
  await page.getByRole('button', { name: '新对话', exact: true }).click()
  const stopped = pollRequests; await page.waitForTimeout(2800); assert.equal(pollRequests, stopped)
  stall = false; dropAfterSend = true
  await send('握手后断线，恢复事件')
  await page.locator('[data-message-kind="assistant"]').waitFor({ timeout: 12000 })
  assert.equal(messagePosts, 2)
  assert.equal(await page.locator('[data-message-kind="assistant"]').count(), 1)
  console.log('PASS SSE 握手后断开，按游标恢复切换期间的回复，无重复提交或重复消息')
  await page.getByRole('navigation', { name: '桌面主导航' }).getByRole('link', { name: '账户', exact: true }).click()
  const left = pollRequests; await page.waitForTimeout(2800); assert.equal(pollRequests, left)
  assert.deepEqual(errors, [])
  console.log('PASS 新建对话和离开助手停止轮询，浏览器没有异常')
} finally {
  await browser?.close(); await vite?.close()
  if (bridge && bridge.exitCode === null) { const exited = once(bridge, 'exit'); bridge.kill('SIGTERM'); await exited }
  server.closeAllConnections(); await new Promise(r => server.close(r))
}
