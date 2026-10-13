/** Local model-protocol fixture → real Harness → employee confirmation → isolated SQLite. No external model calls. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createServer as netServer } from 'node:net'
import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
  send({ role: 'assistant', ...(first ? { tool_calls: [{ index: 0, id: `call_${marker}`, type: 'function', function: { name: tool.name, arguments: JSON.stringify(tool.args) } }] } : { content: '已取得业务处理结果，请以回执状态为准。' }) })
  send({}, first ? 'tool_calls' : 'stop'); res.end('data: [DONE]\n\n')
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
  await writeFile(patch, JSON.stringify([{ id: 'llm-pi-ai', config: { providers: { test: { apiKeyEnv: 'LUCKYCAT_TEST_KEY', api: 'openai-completions', baseURL: `http://127.0.0.1:${providerPort}/v1`, models: [{ id: 'staff-test', name: 'Test', contextWindow: 128000 }] } } } }]))
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
    vite = await createVite({ root: join(root, 'staff'), configFile: join(root, 'staff/vite.config.ts'), server: { host: '127.0.0.1', port: 0, proxy: { '/staff-api': { target: bank }, '/staff-agent-api': { target: agent, rewrite: p => p.replace(/^\/staff-agent-api/, '/agent-api') } } } })
    await vite.listen()
    browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    const errors = []; page.on('pageerror', e => errors.push(e.message))
    await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/assistant`)
    await page.getByLabel('员工姓名').fill('王小明'); await page.getByLabel('密码', { exact: true }).fill('123456'); await page.getByRole('button', { name: '登录', exact: true }).click()
    await page.getByRole('heading', { name: '工作人员助手', exact: true }).waitFor()
    fixtures.staff_fixture_browser_lock = { name: 'staff_customer_action', args: { customerId: customer.customerId, ticketId: ticket.ticketId, cardId: profile.cards[0].id, action: 'lockCard', reason: '客户来电要求锁卡' } }
    await page.getByLabel('业务请求').fill('staff_fixture_browser_lock'); await page.getByRole('button', { name: '发送', exact: true }).click()
    const card = page.getByRole('region', { name: '操作确认' }); await card.waitFor({ timeout: 40_000 })
    const confirm = card.getByRole('button', { name: '确认并办理' }); assert.equal(await confirm.isEnabled(), false)
    await card.getByRole('checkbox').check(); await confirm.click()
    await page.getByText('已取得业务处理结果，请以回执状态为准。', { exact: true }).waitFor({ timeout: 20_000 })
    assert.equal((await api(bank, `/staff-api/customers/${customer.customerId}/profile?reason=test`, csr.token)).data.cards.find(c => c.id === profile.cards[0].id).status, 'locked')
    fixtures.staff_fixture_browser_question = { name: 'ask_user_question', args: { questions: [{ id: 'purpose', question: '请选择业务类型', options: [{ label: '客户查询', description: '查看概要' }, { label: '工单处理', description: '查看工单' }] }] } }
    await page.getByLabel('业务请求').fill('staff_fixture_browser_question'); await page.getByRole('button', { name: '发送', exact: true }).click()
    const question = page.getByRole('region', { name: '补充信息' }); await question.waitFor({ timeout: 30_000 }); await question.getByRole('radio', { name: /^客户查询/ }).check(); await question.getByRole('button', { name: '提交回答' }).click(); await question.waitFor({ state: 'hidden' })
    assert.deepEqual(errors, [])
    await page.screenshot({ path: join(root, 'server/data/staff-agent-preview.png'), fullPage: true })
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
