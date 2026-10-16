/** 真实 Harness + 分段模型协议 fixture + 浏览器，验证先出正文、再完成，以及断线恢复。 */
import assert from 'node:assert/strict'
import { createServer, request } from 'node:http'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer as createVite } from '../app/node_modules/vite/dist/node/index.js'
import { chromium } from 'playwright-core'
import { createAssistantStream } from '../framework/bridge/assistant-stream.mjs'
import { visibleFrame } from '../framework/bridge/assistant-stream-plugin.mjs'
import { login } from './lib/session.mjs'

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const events = []
const projection = createAssistantStream('unit', event => events.push(event))
const start = (attemptId, step = 1) => ({ type: 'start', attemptId, turn: 1, step })
const chunk = (attemptId, text, index = 0) => ({ type: 'chunk', attemptId, chunk: { type: 'text-delta', index, text } })
projection.frame(start('a'))
projection.frame(chunk('a', '后段', 1)); projection.frame(chunk('a', '前段', 0))
await sleep(60)
assert.deepEqual(events.at(-1), { type: 'assistant-update', messageId: 'unit:1:1', text: '前段后段' })
projection.frame(chunk('a', '不该迟到'))
const final = projection.settle({ type: 'assistant/message', data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: '权威完成文本' }] } } })
assert.equal(final.text, '权威完成文本'); assert.equal(final.messageId, 'unit:1:1')
const count = events.length; await sleep(60); assert.equal(events.length, count)
projection.frame(start('b', 2)); projection.frame(chunk('b', '失败的草稿'))
assert.equal(projection.settle({ type: 'assistant/attempt', data: { turn: 1, step: 2 } }).type, 'assistant-reset')
projection.frame(start('c', 2)); projection.frame(chunk('c', '重试正文'))
await sleep(60); assert.equal(events.at(-1).text, '重试正文')
projection.frame({ type: 'end', attemptId: 'c', outcome: { kind: 'abandoned' } })
assert.equal(events.at(-1).type, 'assistant-reset')
projection.close()
assert(!visibleFrame({ type: 'chunk', chunk: { type: 'reasoning-delta' } }))
assert(!visibleFrame({ type: 'chunk', chunk: { type: 'tool-call-delta' } }))
console.log('PASS 正文块顺序、最终文本覆盖、失败草稿撤回；不转发推理或工具参数')

const root = fileURLToPath(new URL('../', import.meta.url))
const tmp = await mkdtemp(join(tmpdir(), 'agent-stream-'))
let bridge, vite, browser, log = '', modelRequests = 0, messagePosts = 0, polls = 0, mode = 'sse', behavior = 'text', cancelledRequests = 0
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))
const provider = createServer(async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk
  lastModelMessages = JSON.parse(body).messages
  modelRequests++
  res.on('close', () => { if (!res.writableEnded) cancelledRequests++ })
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  const send = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ id: 'test-stream', object: 'chat.completion.chunk', created: 1, model: 'stream-test', choices: [{ index: 0, delta, finish_reason }] })}\n\n`)
  send({ role: 'assistant' }); await sleep(100)
  if (behavior !== 'text') {
    const name = behavior === 'consent' ? 'bank_list_cards' : 'ask_user_question'
    const args = behavior === 'consent' ? {} : { questions: [{ id: 'target', question: '请选择要处理的卡片', options: [{ label: '卡片一' }, { label: '卡片二' }] }] }
    send({ tool_calls: [{ index: 0, id: 'fixture-call-' + modelRequests, type: 'function', function: { name, arguments: JSON.stringify(args) } }] })
    send({}, 'tool_calls'); res.end('data: [DONE]\n\n'); return
  }
  send({ content: '这是' }); await sleep(1500)
  send({ content: '流式' }); await sleep(1500)
  send({ content: '回复。' }); await sleep(700)
  send({}, 'stop'); res.end('data: [DONE]\n\n')
})
const fixture = createServer((req, res) => {
  if (req.url === '/api/cards') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('[]'); return }
  if (req.url.startsWith('/api/auth/profile')) {
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ id: 'a' })); return
  }
  if (req.url.endsWith('/stream') && mode === 'blocked') {
    res.writeHead(503, { 'content-type': 'application/json' }); res.end('{}'); return
  }
  if (req.url.endsWith('/events') || req.url.includes('/events?')) polls++
  if (req.url.endsWith('/messages') && req.method === 'POST') messagePosts++
  const upstream = request({ hostname: '127.0.0.1', port: bridgePort, path: req.url, method: req.method, headers: req.headers }, response => {
    res.writeHead(response.statusCode, response.headers)
    if (req.url.endsWith('/stream') && mode === 'drop') {
      response.on('data', body => {
        res.write(body)
        if (body.toString().includes('assistant-update')) { response.destroy(); res.end() }
      })
      response.on('end', () => res.end())
    } else response.pipe(res)
  })
  upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end() })
  req.pipe(upstream)
})
let bridgePort, lastModelMessages
try {
  const providerPort = await listen(provider)
  const fixturePort = await listen(fixture)
  const reservation = createServer(); bridgePort = await listen(reservation); await new Promise(r => reservation.close(r))
  const patch = join(tmp, 'provider.yml')
  await writeFile(patch, `- id: llm-pi-ai\n  config:\n    providers:\n      test:\n        apiKeyEnv: LUCKYCAT_TEST_KEY\n        api: openai-completions\n        baseURL: http://127.0.0.1:${providerPort}/v1\n        models:\n          - id: stream-test\n            name: Test\n            contextWindow: 128000\n- id: luckycat-rag\n  disabled: true\n- id: luckycat-embedding\n  disabled: true\n`)
  const launchBridge = async () => {
  bridge = spawn(process.execPath, ['framework/bridge/demo-server.mjs'], { cwd: root,
    env: { ...process.env, LUCKYCAT_SESSION_DIR: join(tmp, 'sessions'), LUCKYCAT_DEMO_PORT: String(bridgePort), LUCKYCAT_BANK_URL: `http://127.0.0.1:${fixturePort}`, LUCKYCAT_PROVIDER: 'test', LUCKYCAT_MODEL: 'stream-test', LUCKYCAT_TEST_KEY: 'test-only', LUCKYCAT_PATCHES: patch, LUCKYCAT_DISABLE_VOICE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
  bridge.stdout.on('data', data => { log += data }); bridge.stderr.on('data', data => { log += data })
  for (let n = 0; n < 100; n++) {
    try { if ((await fetch(`http://127.0.0.1:${bridgePort}/agent-api/health`, { headers: { authorization: 'Bearer tokenA' } })).ok) break } catch { /* starting */ }
    await sleep(100)
  }
  }
  await launchBridge()
  process.env.VITE_USE_MOCK = 'true'; process.env.VITE_AGENT_TARGET = `http://127.0.0.1:${fixturePort}`
  vite = await createVite({ root: root + 'app', appType: 'spa', server: { host: '127.0.0.1', port: 0 } }); await vite.listen()
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH })
  const page = await browser.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message))
  // Mock 网页不会带银行 token；测试代理仅给真实 bridge 的请求补固定 fixture 身份。
  await page.route('**/agent-api/**', route => route.continue({ headers: { ...route.request().headers(), authorization: 'Bearer tokenA' } }))
  await login(page, `http://127.0.0.1:${vite.httpServer.address().port}`, { to: '/support' })
  await page.locator('[data-agent-status="ready"]').waitFor()
  for (const transport of ['sse', 'blocked', 'drop']) {
    mode = transport
    if (transport !== 'sse') await page.getByRole('button', { name: '新对话', exact: true }).click()
    await page.getByLabel('聊天消息').fill('请按测试要求回答。')
    await page.getByRole('button', { name: '发送', exact: true }).click()
    const partial = page.locator('[data-message-kind="assistant"][data-streaming="true"]')
    await partial.waitFor({ timeout: 30000 })
    const id = await partial.getAttribute('data-message-id')
    const prefix = await partial.locator('.assistant-turn-answer').innerText()
    if (transport === 'sse') await page.screenshot({ path: '/tmp/maneki-streaming-partial.png' })
    assert(prefix.length > 0 && prefix.length < '这是流式回复。'.length, `没有在完成前显示正文：${prefix}\n${log}`)
    assert.equal(await partial.getByRole('button', { name: /朗读|重新生成/ }).count(), 0)
    const complete = page.locator(`[data-message-id="${id}"]:not([data-streaming])`)
    await complete.waitFor({ timeout: 15000 })
    assert((await complete.innerText()).includes('这是流式回复。'))
    assert.equal(await page.locator('[data-message-kind="assistant"]').count(), 1)
    assert.equal(await page.getByText(/发送失败|agent 运行失败/).count(), 0)
    console.log(`PASS 真实 Harness ${transport}：完成前显示「${prefix}」，最终更新同一气泡，无重复回复`)
  }
  assert.equal(modelRequests, 3); assert.equal(messagePosts, 3); assert(polls > 0); assert.deepEqual(errors, [])
  await page.screenshot({ path: '/tmp/maneki-streaming-test.png' })
  await page.reload(); await page.locator('[data-message-kind="assistant"]').waitFor()
  assert.equal(await page.locator('[data-streaming="true"]').count(), 0)
  assert.equal(await page.locator('[data-message-kind="assistant"]').count(), 1)
  console.log('PASS 每轮只提交一次、每轮只调用模型一次；历史刷新后保留完整回复')
  mode = 'sse'
  await page.getByRole('button', { name: '新对话', exact: true }).click()
  await page.getByLabel('聊天消息').fill('测试中断这一轮')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  const streaming = page.locator('[data-message-kind="assistant"][data-streaming="true"]')
  await streaming.waitFor({ timeout: 30000 })
  const partialId = await streaming.getAttribute('data-message-id')
  const partialText = await streaming.locator('.assistant-turn-answer').innerText()
  await page.getByRole('button', { name: '停止生成', exact: true }).click()
  await page.getByText('已停止生成', { exact: true }).waitFor({ timeout: 15000 })
  await page.getByRole('button', { name: '发送', exact: true }).waitFor()
  const retained = page.locator(`[data-message-id="${partialId}"]`)
  assert((await retained.innerText()).includes(partialText))
  assert.equal(await retained.getAttribute('data-streaming'), null)
  await sleep(4000)
  assert(!(await retained.innerText()).includes('这是流式回复。'), '停止后仍然写入了迟到正文')
  assert(cancelledRequests >= 1, '只是隐藏 UI，没有中断模型连接')
  await page.getByLabel('聊天消息').fill('停止后再问一次')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await page.locator('[data-message-kind="assistant"]', { hasText: '这是流式回复。' }).waitFor({ timeout: 15000 })
  await page.getByRole('button', { name: '发送', exact: true }).waitFor()
  console.log('PASS 停止会真正关闭模型请求、保留部分正文、屏蔽迟到事件，同一会话可继续发送')

  // 两个会话同时生成；只停止当前会话。
  await page.getByRole('button', { name: '新对话', exact: true }).click()
  await page.getByLabel('聊天消息').fill('并发会话 A')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await page.locator('[data-streaming="true"]').waitFor()
  await page.getByRole('button', { name: '新对话', exact: true }).click()
  await page.getByLabel('聊天消息').fill('并发会话 B')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await page.locator('[data-streaming="true"]').waitFor()
  await page.getByRole('button', { name: '停止生成', exact: true }).click()
  await page.getByText('已停止生成', { exact: true }).waitFor()
  await sleep(4000)
  const stored = await page.evaluate(() => Object.values(localStorage).filter(v => v.includes('并发会话 A')).join(''))
  assert(stored.includes('这是流式回复。'), '中断影响了另一个会话')
  console.log('PASS 并发会话互相隔离，中断不关闭共享运行时')

  for (const pending of ['consent', 'question']) {
    behavior = pending
    await page.getByRole('button', { name: '新对话', exact: true }).click()
    await page.getByLabel('聊天消息').fill('中断等待中的' + pending)
    await page.getByRole('button', { name: '发送', exact: true }).click()
    if (pending === 'consent') await page.getByText('本人银行卡、状态、支付开关与日限额', { exact: true }).waitFor({ timeout: 15000 })
    else await page.getByText('请选择要处理的卡片', { exact: true }).waitFor({ timeout: 15000 })
    await page.getByRole('button', { name: '停止生成', exact: true }).click()
    await page.getByText('已停止生成', { exact: true }).waitFor({ timeout: 15000 })
    await page.getByRole('button', { name: '发送', exact: true }).waitFor()
    assert.equal(await page.getByText(pending === 'consent' ? '本人银行卡、状态、支付开关与日限额' : '请选择要处理的卡片', { exact: true }).count(), 0)
    console.log(`PASS 等待 ${pending} 时停止：卡片移除、本轮退出，不继续执行`)
  }
  behavior = 'text'
  await page.getByRole('button', { name: '新对话', exact: true }).click()
  await page.getByLabel('聊天消息').fill('重启前记住青鸟方案')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await page.locator('[data-message-kind="assistant"]', { hasText: '这是流式回复。' }).waitFor({ timeout: 15000 })
  await page.getByRole('button', { name: '发送', exact: true }).waitFor({ timeout: 15000 })
  const exited = once(bridge, 'exit'); bridge.kill('SIGTERM'); await exited
  await launchBridge()
  await page.getByLabel('聊天消息').fill('继续刚才的方案')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('[data-message-kind="assistant"]').length === 2 && document.querySelectorAll('[data-streaming="true"]').length === 0, { timeout: 15000 })
  await page.getByRole('button', { name: '发送', exact: true }).waitFor({ timeout: 15000 })
  assert.equal(await page.locator('[data-message-kind="assistant"]').count(), 2)
  assert(JSON.stringify(lastModelMessages).includes('重启前记住青鸟方案'))
  assert.equal(await page.getByText(/发送失败|agent 运行失败|上下文已失效/).count(), 0)
  await page.reload()
  await page.locator('[data-message-kind="assistant"]').first().waitFor()
  assert.equal(await page.locator('[data-message-kind="assistant"]').count(), 2)
  console.log('PASS 网页保持打开时重启 Agent，原对话直接续聊；刷新仍保留同一对话及两轮回复')
  // 模拟部署前留下的本机记录：服务端没有可信归属索引，自动迁移文字。
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      if (!key.includes('agent.sessions')) continue
      const list = JSON.parse(localStorage.getItem(key));
      if (!Array.isArray(list)) continue
      const c = list.find(row => row.items.some(item => item.text === '重启前记住青鸟方案'))
      if (c) { c.agentSessionId = 'web-legacy-browser-test'; localStorage.setItem(key, JSON.stringify(list)) }
    }
  })
  await page.reload(); await page.locator('[data-message-kind="assistant"]').first().waitFor()
  await page.getByLabel('聊天消息').fill('沿用本机旧记录继续')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('[data-message-kind="assistant"]').length === 3 && document.querySelectorAll('[data-streaming="true"]').length === 0, { timeout: 15000 })
  await page.getByRole('button', { name: '发送', exact: true }).waitFor({ timeout: 15000 })
  assert.equal(await page.locator('[data-message-kind="assistant"]').count(), 3)
  assert(JSON.stringify(lastModelMessages).includes('重启前记住青鸟方案'))
  assert(JSON.stringify(lastModelMessages).includes('不是银行回执或业务授权'))
  assert.equal(await page.getByText(/发送失败|agent 运行失败|上下文已失效/).count(), 0)
  console.log('PASS 旧版网页历史自动迁移文字后继续回答，无需手动新建对话')
  assert.deepEqual(errors, [])

} catch (error) { console.error(log); throw error }
finally {
  await browser?.close(); await vite?.close()
  if (bridge && bridge.exitCode === null) { const exited = once(bridge, 'exit'); bridge.kill('SIGTERM'); await exited }
  for (const server of [provider, fixture]) { server.closeAllConnections(); await new Promise(r => server.close(r)) }
  await rm(tmp, { recursive: true, force: true })
}
