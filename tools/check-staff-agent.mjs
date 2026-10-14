/** Local model-protocol fixture → real Harness → employee confirmation → isolated SQLite. No external model calls. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createServer as netServer } from 'node:net'
import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rampFrames } from './lib/ttsFixture.mjs'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const dir = await mkdtemp(join(tmpdir(), 'staff-harness-'))
const free = async () => { const s = netServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const port = s.address().port; await new Promise(r => s.close(r)); return port }
const [bankPort, agentPort, providerPort] = await Promise.all([free(), free(), free()])
const bank = `http://127.0.0.1:${bankPort}`, agent = `http://127.0.0.1:${agentPort}`
const children = [], modelRequests = [], fixtures = {}, counters = {}
let log = '', browser, vite
const start = (file, env) => {
  const child = spawn(process.execPath, [join(root, file)], { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  child.stdout.on('data', x => log += x); child.stderr.on('data', x => log += x); children.push(child); return child
}
const api = async (base, path, token, body) => {
  const res = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  return { status: res.status, data: await res.json() }
}
const ready = async (base, path, token) => { for (let i = 0; i < 100; i++) { try { if ((await api(base, path, token)).status === 200) return } catch {} await new Promise(r => setTimeout(r, 100)) } throw Error(log) }
const provider = createServer(async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk
  const data = JSON.parse(body); modelRequests.push(data)
  const marker = Object.keys(fixtures).reverse().find(k => JSON.stringify(data.messages).includes(k))
  if (!marker) { res.writeHead(400); res.end(JSON.stringify({ error: { message: 'unknown fixture' } })); return }
  const first = (counters[marker] = (counters[marker] ?? 0) + 1) === 1
  const tool = fixtures[marker]
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  const send = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ id: 'chatcmpl-test', object: 'chat.completion.chunk', created: 1, model: 'staff-test', choices: [{ index: 0, delta, finish_reason }] })}\n\n`)
  send({ role: 'assistant', ...(first && tool.name ? { tool_calls: [{ index: 0, id: `call_${marker}`, type: 'function', function: { name: tool.name, arguments: JSON.stringify(tool.args) } }] } : { content: tool.reply ?? '已取得业务处理结果，请以回执状态为准。' }) })
  send({}, first && tool.name ? 'tool_calls' : 'stop'); res.end('data: [DONE]\n\n')
})
try {
  await new Promise(r => provider.listen(providerPort, '127.0.0.1', r))
  start('server/index.mjs', { BANK_PORT: String(bankPort), BANK_DB_FILE: join(dir, 'bank.sqlite'), BANK_STATE_FILE: join(dir, 'empty.json') }); await ready(bank, '/health')
  const csr = (await api(bank, '/staff-api/login', null, { name: '王小明', password: '123456' })).data
  const supervisor = (await api(bank, '/staff-api/login', null, { name: '李主管', password: '123456' })).data
  const customer = (await api(bank, '/staff-api/customers?keyword=13800138000', csr.token)).data[0]
  const profile = (await api(bank, `/staff-api/customers/${customer.customerId}/profile?reason=回归测试`, csr.token)).data
  const ticket = (await api(bank, '/staff-api/tickets', csr.token, { customerId: customer.customerId, channel: 'web', reason: '本地 Agent 浏览器测试' })).data
  const patch = join(dir, 'provider.patch.yml')
  await writeFile(patch, JSON.stringify([{ id: 'llm-pi-ai', config: { providers: { test: { apiKeyEnv: 'LUCKYCAT_TEST_KEY', api: 'openai-completions', baseURL: `http://127.0.0.1:${providerPort}/v1`, models: [{ id: 'staff-test', name: 'Test', contextWindow: 128000, input: ['text', 'image'] }] } } } }]))
  start('framework/bridge/staff-server.mjs', { LUCKYCAT_DEMO_PORT: String(agentPort), LUCKYCAT_BANK_URL: bank, LUCKYCAT_PROVIDER: 'test', LUCKYCAT_MODEL: 'staff-test', LUCKYCAT_TEST_KEY: 'test-only', LUCKYCAT_PATCHES: patch, LUCKYCAT_SESSION_DIR: join(dir, 'staff-context') })
  await ready(agent, '/agent-api/health', csr.token)
  assert.equal((await api(agent, '/agent-api/health')).status, 401)
  assert.equal((await api(agent, '/internal/bank-tool', null, {})).status, 403)
  const run = async (marker, tool, decide = 'approve') => {
    fixtures[marker] = tool
    const id = (await api(agent, '/agent-api/sessions', csr.token, {})).data.sessionId
    assert.equal((await api(agent, `/agent-api/sessions/${id}`, supervisor.token)).status, 404)
    assert.equal((await api(agent, `/agent-api/sessions/${id}/messages`, csr.token, { text: marker })).status, 202)
    let cursor = '0'; const events = []
    const wait = async predicate => {
      for (let i = 0; i < 400; i++) {
        const found = events.find(predicate); if (found) return found
        const result = await api(agent, `/agent-api/sessions/${id}/events?after=${cursor}`, csr.token)
        assert.equal(result.status, 200); cursor = result.data.cursor; events.push(...result.data.events)
        if (events.some(e => e.type === 'error')) throw Error(JSON.stringify(events) + '\n' + log)
        await new Promise(r => setTimeout(r, 100))
      } throw Error('Timeout: ' + JSON.stringify(events) + '\n' + log)
    }
    if (tool.name === 'ask_user_question') {
      const q = (await wait(e => e.type === 'question')).question
      assert.equal((await api(agent, `/agent-api/questions/${q.questionId}/answer`, csr.token, { answers: [{ id: 'purpose', selected: ['客户查询'] }] })).status, 200)
    } else {
      const c = (await wait(e => e.type === 'consent')).challenge
      assert(c.fields.some(f => f.label === '操作员工' && f.value.includes('王小明')))
      assert(!JSON.stringify(c).includes(csr.token)); assert.equal(c.arguments, undefined)
      assert.equal((await api(agent, `/agent-api/consent/${c.challengeId}`, supervisor.token, { decision: 'approve' })).status, 404)
      assert.equal((await api(agent, `/agent-api/consent/${c.challengeId}`, csr.token, { decision: decide })).status, 200)
    }
    const result = await wait(e => e.type === 'tool-result')
    assert.equal(result.isError, decide === 'reject'); await wait(e => e.type === 'status' && e.status === 'idle')
    return result
  }
  const threshold = await run('staff_fixture_threshold', { name: 'staff_get_transfer_threshold', args: {} })
  assert.equal(JSON.parse(threshold.text).audience, 'staff')
  console.log('PASS 真实 Harness / 员工归属 / 角色上下文 / 确认卡 / HTTP 工具 / 事件轮询')
  await run('staff_fixture_cancel', { name: 'staff_post_ticket_message', args: { ticketId: ticket.ticketId, text: '取消的回复' } }, 'reject')
  assert.equal((await api(bank, `/staff-api/tickets/${ticket.ticketId}`, csr.token)).data.messages.length, 0)
  await run('staff_fixture_reply', { name: 'staff_post_ticket_message', args: { ticketId: ticket.ticketId, text: '已收到客户诉求' } })
  assert.equal((await api(bank, `/staff-api/tickets/${ticket.ticketId}`, csr.token)).data.messages.length, 1)
  await run('staff_fixture_question', { name: 'ask_user_question', args: { questions: [{ id: 'purpose', question: '请选择要办理的业务', options: [{ label: '客户查询', description: '查看客户概要' }, { label: '工单处理', description: '查看工单' }] }] } })
  console.log('PASS 员工取消不写入、确认回复落库、补充问题可以答复')
  if (process.argv.includes('--browser')) {
    const { chromium } = await import('playwright-core')
    const { createServer: createVite } = await import('../staff/node_modules/vite/dist/node/index.js')
    process.env.VITE_USE_MOCK = 'false'
    process.env.VITE_BASE_PATH = '/staff/'
    vite = await createVite({ root: join(root, 'staff'), configFile: join(root, 'staff/vite.config.ts'), server: { host: '127.0.0.1', port: 0, proxy: { '/staff-api': { target: bank }, '/staff-agent-api': { target: agent, rewrite: p => p.replace(/^\/staff-agent-api/, '/agent-api') } } } })
    await vite.listen()
    browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] })
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, permissions: ['microphone'] })
    const errors = [], customerCalls = [], mediaCalls = []
    page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) customerCalls.push(request.url()) })
    // 本地语音夹具：真正录音和播放；上游转写/合成不产生网络计费。
    await page.route('**/staff-agent-api/health', async route => {
      const response = await route.fetch()
      const health = await response.json()
      await route.fulfill({ response, json: { ...health, voice: { asr: true, tts: true, stream: true, maxSeconds: 60 } } })
    })
    await page.route('**/staff-agent-api/asr', async route => {
      const request = route.request(), data = request.postDataJSON()
      mediaCalls.push({ path: 'asr', auth: request.headers().authorization, data })
      await route.fulfill({ json: { text: 'staff_fixture_voice', seconds: 1 } })
    })
    await page.route('**/staff-agent-api/tts/stream', async route => {
      const request = route.request()
      mediaCalls.push({ path: 'tts', auth: request.headers().authorization, data: request.postDataJSON() })
      const frames = rampFrames(1)
      const body = `event: start\ndata: {"format":"pcm","sampleRate":24000}\n\n` + frames.map(frame => `event: audio\ndata: ${frame.toString('base64')}\n\n`).join('') + `event: end\ndata: {"frames":${frames.length},"bytes":48000,"truncated":false}\n\n`
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body })
    })
    page.on('pageerror', e => errors.push(e.message))
    await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/staff/assistant`)
    await page.getByLabel('员工姓名').fill('王小明'); await page.getByLabel('密码', { exact: true }).fill('123456'); await page.getByRole('button', { name: '登录', exact: true }).click()
    await page.getByRole('heading', { name: '工作人员助手', exact: true }).waitFor()
    fixtures.staff_fixture_browser_lock = { name: 'staff_customer_action', args: { customerId: customer.customerId, ticketId: ticket.ticketId, cardId: profile.cards[0].id, action: 'lockCard', reason: '客户来电要求锁卡' } }
    await page.getByLabel('聊天消息').fill('staff_fixture_browser_lock'); await page.getByRole('button', { name: '发送', exact: true }).click()
    const card = page.getByRole('region', { name: '操作确认' }); await card.waitFor({ timeout: 40_000 })
    const confirm = card.getByRole('button', { name: '确认并办理' }); assert.equal(await confirm.isEnabled(), false)
    await card.getByRole('checkbox').check(); await confirm.click()
    await page.getByText('已取得业务处理结果，请以回执状态为准。', { exact: true }).waitFor({ timeout: 20_000 })
    assert.equal((await api(bank, `/staff-api/customers/${customer.customerId}/profile?reason=test`, csr.token)).data.cards.find(c => c.id === profile.cards[0].id).status, 'locked')
    fixtures.staff_fixture_browser_question = { name: 'ask_user_question', args: { questions: [{ id: 'purpose', question: '请选择业务类型', options: [{ label: '客户查询', description: '查看概要' }, { label: '工单处理', description: '查看工单' }] }] } }
    await page.getByLabel('聊天消息').fill('staff_fixture_browser_question'); await page.getByRole('button', { name: '发送', exact: true }).click()
    const question = page.locator('[data-question-card]'); await question.waitFor({ timeout: 30_000 }); await question.getByRole('radio', { name: /^客户查询/ }).check(); await question.getByRole('button', { name: '提交', exact: true }).click(); await question.waitFor({ state: 'hidden' })
    fixtures.staff_fixture_browser_cancel = { name: 'staff_get_transfer_threshold', args: {} }
    await page.getByLabel('聊天消息').fill('staff_fixture_browser_cancel')
    await page.getByRole('button', { name: '发送', exact: true }).click()
    const cancelCard = page.getByRole('region', { name: '操作确认' })
    await cancelCard.waitFor()
    await page.route('**/staff-agent-api/consent/*', route => route.fulfill({ status: 503, json: { error: '本地确认网络失败夹具' } }), { times: 1 })
    await cancelCard.getByRole('button', { name: '取消', exact: true }).click()
    await cancelCard.getByRole('alert').filter({ hasText: '本地确认网络失败夹具' }).waitFor()
    await cancelCard.getByRole('button', { name: '取消', exact: true }).click()
    await cancelCard.waitFor({ state: 'hidden' })
    console.log('PASS 取消失败保留确认卡、显示错误并允许重试')

    // 图片经过共用的压缩/缩略图管道，真实 Harness 必须收到视觉输入。
    await page.getByRole('button', { name: '新对话', exact: true }).click()
    fixtures.staff_fixture_image = { reply: '**图片已收到**，请核对工单信息。' }
    const image = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 80; canvas.height = 40; const ctx = canvas.getContext('2d'); ctx.fillStyle = '#c8973c'; ctx.fillRect(0, 0, 80, 40); return canvas.toDataURL('image/png').split(',')[1] })
    await page.locator('[data-image-input]').setInputFiles({ name: '工单截图.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') })
    await page.locator('[data-pending-image]').waitFor({ state: 'visible' })
    await page.getByLabel('聊天消息').fill('staff_fixture_image')
    await page.getByRole('button', { name: '发送', exact: true }).click()
    await page.locator('strong').filter({ hasText: '图片已收到' }).waitFor({ timeout: 30_000 })
    assert(modelRequests.some(request => JSON.stringify(request.messages).includes('data:image/')), '图片没有进入真实模型协议请求')
    assert.equal(await page.locator('[data-message-kind="user"] img').count(), 1)
    await page.screenshot({ path: join(root, 'server/data/staff-agent-preview.png'), fullPage: true })
    console.log('PASS 员工图片压缩、预览、发送、视觉附件接线及 Markdown 渲染')

    await page.getByRole('button', { name: '新对话', exact: true }).click()
    fixtures.staff_fixture_voice = { reply: '语音测试回复已完成。' }
    const voice = page.getByRole('button', { name: '语音', exact: true })
    await voice.click()
    const mic = page.getByRole('button', { name: '按住说话', exact: true })
    const box = await mic.boundingBox(); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down(); await page.waitForTimeout(1200); await page.mouse.up()
    await page.getByText('语音测试回复已完成。', { exact: true }).waitFor({ timeout: 30_000 })
    await page.waitForFunction(() => document.querySelector('[data-speech-progress]'), null, { timeout: 15_000 })
    assert.equal(mediaCalls.filter(call => call.path === 'asr').length, 1)
    assert(mediaCalls.find(call => call.path === 'asr').data.audio.length > 100, '录音没有产生真实数据')
    assert(mediaCalls.some(call => call.path === 'tts'))
    assert(mediaCalls.every(call => /^Bearer .+/.test(call.auth ?? '')), '语音请求漏带员工身份')
    assert.equal(new Set(mediaCalls.map(call => call.auth)).size, 1)
    assert(!mediaCalls.some(call => call.auth === `Bearer ${csr.token}`), '误用了测试脚本另一个登录会话')
    console.log('PASS 真麦克风录音、员工通道转写、自动朗读及语音请求鉴权')

    // 历史抽屉、响应式布局、员工切换及离线边界。
    await voice.click()
    await page.getByRole('button', { name: /历史对话/ }).click()
    assert(await page.getByRole('complementary', { name: '历史对话', exact: true }).isVisible())
    await page.getByRole('button', { name: /历史对话/ }).click()
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 })
      const geometry = await page.evaluate(() => {
        const input = document.querySelector('[aria-label="聊天消息"]').getBoundingClientRect()
        return { overflow: document.documentElement.scrollWidth > innerWidth, bottom: input.bottom, height: innerHeight }
      })
      assert(!geometry.overflow, `员工页面 ${width}px 横向溢出`)
      assert(geometry.bottom <= geometry.height, `员工页面 ${width}px 输入栏超出视口`)
    }
    await page.screenshot({ path: join(root, 'server/data/staff-agent-mobile-preview.png'), fullPage: true })
    const keys = await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('luckycat.agent.sessions')))
    assert(keys.some(key => key.includes('staff.csr.')), '历史没有按员工账号及角色隔离')
    await page.getByRole('button', { name: '退出', exact: true }).click()
    await page.getByLabel('员工姓名').fill('李主管'); await page.getByLabel('密码', { exact: true }).fill('123456'); await page.getByRole('button', { name: '登录', exact: true }).click()
    await page.getByRole('link', { name: '工作人员助手', exact: true }).click()
    await page.locator('[data-agent-status="ready"]').waitFor()
    assert.equal(await page.locator('[data-message-kind]').count(), 0, '主管看到了客服历史')
    await page.unroute('**/staff-agent-api/health')
    await page.route('**/staff-agent-api/health', route => route.fulfill({ status: 503, json: { error: '本地离线夹具' } }))
    await page.getByRole('link', { name: '工作台', exact: true }).click()
    await page.getByRole('link', { name: '工作人员助手', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: '工作人员助手暂时不可用' }).waitFor()
    assert.equal(await page.getByLabel('聊天消息').isEnabled(), false)
    assert.deepEqual(customerCalls, [], '员工页面调用了客户银行接口')
    console.log('PASS 历史记录、320/390/1440 布局、员工切换隔离和服务离线边界')
    assert.deepEqual(errors, [])
    await page.setViewportSize({ width: 1280, height: 900 })
    console.log('PASS 浏览器登录、助手入口、实时卡片、客户核验勾选、真实锁卡及补充问题，无页面异常')
  }
  const requests = JSON.stringify(modelRequests)
  assert(requests.includes('客服专员')); assert(requests.includes('招财猫银行工作人员助手'))
  assert(!requests.includes(csr.token)); assert(!requests.includes(supervisor.token))
  const toolNames = modelRequests[0].tools.map(t => t.function.name)
  assert(toolNames.includes('staff_get_transfer_threshold')); assert(!toolNames.some(n => n.startsWith('bank_')))
  console.log('PASS 员工提示词与独立工具生效，员工令牌不进入模型请求，无客户银行工具')
} finally {
  await browser?.close(); await vite?.close(); await new Promise(r => provider.close(r))
  for (const child of children.reverse()) { child.kill(); if (child.exitCode === null) await new Promise(r => child.once('exit', r)) }
  await rm(dir, { recursive: true, force: true })
}
