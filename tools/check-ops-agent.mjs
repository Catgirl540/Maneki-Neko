import './legacy-sqlite-fixture-disabled.mjs'
/** Real DSH native plugins + role authentication + typed Clef fixture + human confirmation. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createServer as net } from 'node:net'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CLEF_MODEL } from '../framework/bridge/clef-reviewer.mjs'
const root = fileURLToPath(new URL('../', import.meta.url)), dir = await mkdtemp(join(tmpdir(), 'ops-native-runtime-'))
const workspace = join(dir, 'workspace'); await mkdir(workspace); await writeFile(join(workspace, 'README.md'), '原生 DSH 运维诊断测试\n')
const free = async () => { const s = net(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const p = s.address().port; await new Promise(r => s.close(r)); return p }
const [bankPort, agentPort, providerPort, clefPort] = await Promise.all([free(), free(), free(), free()])
const bank = `http://127.0.0.1:${bankPort}`, agent = `http://127.0.0.1:${agentPort}`
const children = [], requests = [], fixtures = {}, counters = {}; let log = '', browser, vite
const jsonBody = async req => { let body = ''; for await (const chunk of req) body += chunk; return JSON.parse(body) }
const provider = createServer(async (req, res) => {
  const body = await jsonBody(req); requests.push(body)
  const fixture = Object.keys(fixtures).reverse().find(k => JSON.stringify(body.messages).includes(k))
  if (!fixture) { res.writeHead(400); res.end('{}'); return }
  const first = (counters[fixture] = (counters[fixture] ?? 0) + 1) === 1, tool = fixtures[fixture]
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  const send = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ id: 'chatcmpl-ops', object: 'chat.completion.chunk', created: 1, model: 'ops-test', choices: [{ index: 0, delta, finish_reason }] })}\n\n`)
  send({ role: 'assistant', ...(first ? { tool_calls: [{ index: 0, id: `call_${fixture}`, type: 'function', function: { name: tool.name, arguments: JSON.stringify(tool.args) } }] } : { content: '已取得本次运维请求的执行回执。' }) }); send({}, first ? 'tool_calls' : 'stop'); res.end('data: [DONE]\n\n')
})
const decisions = []
const clef = createServer(async (req, res) => {
  const body = await jsonBody(req); decisions.push(body)
  assert.equal(body.model, CLEF_MODEL); assert(!body.messages); assert.equal(body.questions.operation_risk.type, 'choice')
  const category = body.state.operation.tool === 'write' ? 'high_risk' : 'read_only'
  res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ model: CLEF_MODEL, answers: { operation_risk: { type: 'choice', choice: category, probabilities: Object.fromEntries(['read_only', 'routine_change', 'high_risk', 'prohibited'].map(k => [k, k === category ? .997 : .001])) } } }))
})
const start = (file, env) => { const c = spawn(process.execPath, [join(root, file)], { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }); c.stdout.on('data', x => log += x); c.stderr.on('data', x => log += x); children.push(c) }
const api = async (base, path, token, body) => { const r = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); return { status: r.status, data: await r.json() } }
const ready = async (base, path, token) => { for (let i = 0; i < 100; i++) { try { if ((await api(base, path, token)).status === 200) return } catch {} await new Promise(r => setTimeout(r, 100)) } throw Error(log) }
try {
  await new Promise(r => provider.listen(providerPort, '127.0.0.1', r)); await new Promise(r => clef.listen(clefPort, '127.0.0.1', r))
  start('server/index.mjs', { BANK_PORT: String(bankPort), BANK_DB_FILE: join(dir, 'bank.sqlite'), BANK_STATE_FILE: join(dir, 'empty.json') }); await ready(bank, '/health')
  const ops = (await api(bank, '/staff-api/login', null, { name: '运维人员', password: '123456' })).data
  const csr = (await api(bank, '/staff-api/login', null, { name: '王小明', password: '123456' })).data
  const patch = join(dir, 'provider.yml'); await writeFile(patch, JSON.stringify([{ id: 'llm-pi-ai', config: { providers: { test: { apiKeyEnv: 'LUCKYCAT_TEST_KEY', api: 'openai-completions', baseURL: `http://127.0.0.1:${providerPort}/v1`, models: [{ id: 'ops-test', name: 'Test', contextWindow: 128000 }] } } } }]))
  start('framework/bridge/ops-server.mjs', { LUCKYCAT_DEMO_PORT: String(agentPort), LUCKYCAT_BANK_URL: bank, LUCKYCAT_PROVIDER: 'test', LUCKYCAT_MODEL: 'ops-test', LUCKYCAT_TEST_KEY: 'test-only', OPENROUTER_API_KEY: 'scrub-test-only', OPS_TEST_SECRET: 'fixture-secret-never-output', CLEF_FLASH_URL: `http://127.0.0.1:${clefPort}/decisions`, LUCKYCAT_PATCHES: patch, LUCKYCAT_SESSION_DIR: join(dir, 'ops-context'), LUCKYCAT_OPS_WORKSPACE: workspace })
  await ready(agent, '/agent-api/health', ops.token)
  assert.equal((await api(agent, '/agent-api/sessions', csr.token, {})).status, 403)
  assert.equal((await api(agent, '/internal/ops-tool/prepare', null, {})).status, 403)
  const run = async (marker, tool, action) => {
    fixtures[marker] = tool
    const id = (await api(agent, '/agent-api/sessions', ops.token, {})).data.sessionId
    assert.equal((await api(agent, `/agent-api/sessions/${id}/messages`, ops.token, { text: marker })).status, 202)
    let cursor = '0', card; const events = []; const handled = new Set()
    for (let i = 0; i < 500; i++) {
      const page = await api(agent, `/agent-api/sessions/${id}/events?after=${cursor}`, ops.token); assert.equal(page.status, 200); cursor = page.data.cursor
      for (const event of page.data.events) {
        events.push(event)
        if (event.type === 'error') throw Error(JSON.stringify(events) + '\n' + log)
        if (event.type === 'consent' && !handled.has(event.challenge.challengeId)) {
          card = event.challenge; handled.add(card.challengeId)
          assert.equal(action, 'approve' === action ? 'approve' : 'reject', '低风险操作不应要求确认')
          assert.equal(card.toolName, tool.name); assert(card.fields.some(f => f.label === '完整操作参数'))
          assert.equal((await api(agent, `/agent-api/consent/${card.challengeId}`, csr.token, { decision: 'approve' })).status, 403)
          assert.equal((await api(agent, `/agent-api/consent/${card.challengeId}`, ops.token, { decision: action })).status, 200)
        }
      }
      if (events.some(e => e.type === 'status' && e.status === 'idle')) {
        const result = events.find(e => e.type === 'tool-result'); assert(result, JSON.stringify(events))
        assert.equal(result.isError, action === 'reject' || action === 'deny', JSON.stringify(result)); return { events, result, card }
      }
      await new Promise(r => setTimeout(r, 100))
    } throw Error(JSON.stringify(events) + '\n' + log)
  }
  const read = await run('ops_fixture_read', { name: 'read', args: { file_path: 'README.md' } })
  assert(read.result.text.includes('原生 DSH 运维诊断测试')); assert.equal(read.card, undefined)
  console.log('PASS 原生 DSH read 执行，Clef 低风险自动通过，员工业务账户不能进入运维运行时')
  const shellName = process.platform === 'win32' ? 'pwsh' : 'bash'
  await run('ops_fixture_protected_env', { name: shellName, args: { command: process.platform === 'win32' ? '$env:OPENROUTER_API_KEY' : 'echo "$OPENROUTER_API_KEY"', description: '受保护密钥访问应被拒绝' } }, 'deny')
  // 密钥名访问会在执行前被策略拒绝；用无业务含义的夹具变量验证子进程环境剥离。
  const shell = await run('ops_fixture_shell', { name: shellName, args: { command: process.platform === 'win32' ? "Get-Date -Format yyyy; if (Test-Path Env:OPS_TEST_SECRET) { Write-Output 'SECRET_PRESENT' } else { Write-Output 'SECRET_ABSENT' }" : "date +%Y; if printenv OPS_TEST_SECRET >/dev/null; then echo SECRET_PRESENT; else echo SECRET_ABSENT; fi", description: '检查系统时间及子进程环境隔离' } })
  assert(shell.result.text.includes('SECRET_ABSENT')); assert(!shell.result.text.includes('SECRET_PRESENT'))
  console.log('PASS 原生 PowerShell/bash 沙箱执行；子进程没有继承模型 API 密钥')
  await run('ops_fixture_write_cancel', { name: 'write', args: { file_path: 'cancelled.txt', content: '不应落盘' } }, 'reject')
  assert.equal(await readFile(join(workspace, 'cancelled.txt')).then(() => true, () => false), false)
  await run('ops_fixture_write_confirm', { name: 'write', args: { file_path: 'confirmed.txt', content: '员工批准的文件修改\n' } }, 'approve')
  assert.equal(await readFile(join(workspace, 'confirmed.txt'), 'utf8'), '员工批准的文件修改\n')
  await run('ops_fixture_secret', { name: 'read', args: { file_path: '.env' } }, 'deny')
  console.log('PASS 高危操作取消不落盘，确认后真实写入，凭据文件硬拒绝且不发给 Clef')
  if (process.argv.includes('--browser')) {
    const { chromium } = await import('playwright-core'), { createServer: createVite } = await import('../staff/node_modules/vite/dist/node/index.js')
    process.env.VITE_USE_MOCK = 'false'
    vite = await createVite({ root: join(root, 'staff'), configFile: join(root, 'staff/vite.config.ts'), server: { host: '127.0.0.1', port: 0, proxy: { '/staff-api': { target: bank }, '/staff-ops-agent-api': { target: agent, rewrite: p => p.replace(/^\/staff-ops-agent-api/, '/agent-api') } } } }); await vite.listen()
    browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
    const page = await browser.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message))
    await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/assistant`); await page.getByLabel('员工姓名').fill('运维人员'); await page.getByLabel('密码', { exact: true }).fill('123456'); await page.getByRole('button', { name: '登录', exact: true }).click(); await page.getByRole('link', { name: '工作人员助手', exact: true }).click()
    fixtures.ops_fixture_browser_write = { name: 'write', args: { file_path: 'browser.txt', content: '浏览器确认原生运维工具\n' } }
    await page.getByLabel('聊天消息').fill('ops_fixture_browser_write'); await page.getByRole('button', { name: '发送', exact: true }).click()
    const card = page.getByRole('region', { name: '操作确认' }); await card.waitFor({ timeout: 40_000 }); assert((await card.innerText()).includes('browser.txt')); await card.getByRole('button', { name: '确认', exact: true }).click()
    await page.getByText('已取得本次运维请求的执行回执。', { exact: true }).waitFor({ timeout: 20_000 }); assert.equal(await readFile(join(workspace, 'browser.txt'), 'utf8'), '浏览器确认原生运维工具\n'); assert.deepEqual(errors, [])
    console.log('PASS 运维浏览器自动选择独立运行时、展示完整高危操作参数并经确认写入，无页面异常')
  }
  const audit = (await readFile(join(dir, 'ops-context/native-audit.jsonl'), 'utf8')).trim().split('\n').map(x => JSON.parse(x))
  assert(audit.some(a => a.phase === 'finished')); assert(audit.every(a => a.employeeId === ops.staff.id))
  assert(decisions.every(d => !JSON.stringify(d).includes(ops.token)))
  const names = requests[0].tools.map(t => t.function.name); assert(names.includes('read')); assert(names.includes('write')); assert(names.includes('pwsh') || names.includes('bash')); assert(!names.includes('staff_customer_action'))
  console.log('ALL PASS：原生工具、Clef 决策协议、执行前确认、角色隔离和审计')
} finally {
  await browser?.close(); await vite?.close()
  for (const child of children.reverse()) { child.kill(); if (child.exitCode === null) await new Promise(r => child.once('exit', r)) }
  provider.closeAllConnections(); clef.closeAllConnections(); await new Promise(r => provider.close(r)); await new Promise(r => clef.close(r)); await rm(dir, { recursive: true, force: true })
}
