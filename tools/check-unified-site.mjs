import './legacy-sqlite-fixture-disabled.mjs'
/** Same-origin client/staff smoke: isolated SQLite, random ports, no model calls. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { createServer as createVite } from '../app/node_modules/vite/dist/node/index.js'
import { login } from './lib/session.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const dir = await mkdtemp(join(tmpdir(), 'luckycat-unified-'))
const savedViteEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith('VITE_')))
const errors = [], websockets = [], requests = [], agentPaths = []
let browser, vite, bankProcess, bankLog = '', bankError
const freePort = async () => {
  const server = createNetServer()
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}
// Only exercises the two staff proxy rewrites and unauthenticated responses.
// Real Harness authorization has its own integration checks.
const gate = createServer((req, res) => {
  agentPaths.push(req.url)
  res.writeHead(req.url === '/agent-api/health' ? 401 : 404, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ message: '本地匿名通道夹具', code: 'UNAUTHORIZED' }))
})
const api = async (base, path, token) => {
  const response = await fetch(base + path, { headers: token ? { authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(5000) })
  return { status: response.status, data: await response.json() }
}
const waitFor = async (condition, detail) => {
  for (let n = 0; n < 150; n++) {
    if (bankError) throw bankError
    if (bankProcess && bankProcess.exitCode !== null) throw Error(bankLog)
    try { if (await condition()) return } catch {}
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw Error(`${detail}\n${bankLog}`)
}
const track = page => {
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => {
    const url = new URL(request.url())
    if (/^\/(api|staff-api)\//.test(url.pathname)) requests.push({ origin: url.origin, path: url.pathname, auth: request.headers().authorization })
  })
  page.on('websocket', socket => {
    socket.on('framereceived', ({ payload }) => {
      if (String(payload).includes('"type":"connected"')) websockets.push(socket.url())
    })
  })
}
const staffLogin = async (page, name, destination) => {
  const response = page.waitForResponse(res => new URL(res.url()).pathname === '/staff-api/login' && res.ok())
  await page.getByLabel('员工姓名', { exact: true }).fill(name)
  await page.getByLabel('密码', { exact: true }).fill('123456')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await page.waitForURL(url => url.pathname === `/staff/${destination}`)
  return (await (await response).json()).token
}

try {
  await new Promise((resolve, reject) => { gate.once('error', reject); gate.listen(0, '127.0.0.1', resolve) })
  const agent = `http://127.0.0.1:${gate.address().port}`
  const bankPort = await freePort(), bank = `http://127.0.0.1:${bankPort}`
  // Ignore inherited VITE settings, including absolute API URLs and base paths.
  // Each script process has its own environment; restore it when closing Vite.
  for (const key of Object.keys(process.env)) if (key.startsWith('VITE_')) delete process.env[key]
  Object.assign(process.env, {
    VITE_USE_MOCK: 'false', VITE_BASE_PATH: '/', VITE_API_BASE_URL: '',
    VITE_PROXY_TARGET: bank, VITE_AGENT_ENABLED: 'false', VITE_AGENT_URL: '/agent-api',
    VITE_AGENT_TARGET: agent, VITE_STAFF_AGENT_TARGET: agent, VITE_OPS_AGENT_TARGET: agent,
  })
  vite = await createVite({ root: join(root, 'app'), configFile: join(root, 'app/vite.config.ts'), cacheDir: join(dir, 'vite-cache'), server: { host: '127.0.0.1', port: 0 } })
  await vite.listen()
  const base = `http://127.0.0.1:${vite.httpServer.address().port}`
  const bankEnv = { ...process.env }
  for (const key of Object.keys(bankEnv)) if (key.startsWith('BANK_')) delete bankEnv[key]
  bankProcess = spawn(process.execPath, [join(root, 'server/index.mjs')], {
    cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...bankEnv, BANK_HOST: '127.0.0.1', BANK_PORT: String(bankPort), BANK_DB_FILE: join(dir, 'bank.sqlite'), BANK_STATE_FILE: join(dir, 'absent.json'), BANK_BACKUP_DIR: join(dir, 'backups'), BANK_OPS_PASSWORD: '123456', BANK_CLIENT_HEALTH_URL: `${base}/`, BANK_STAFF_HEALTH_URL: `${base}/staff/`, BANK_AGENT_HEALTH_URL: `${agent}/agent-api/health` },
  })
  bankProcess.stdout.on('data', data => bankLog += data)
  bankProcess.stderr.on('data', data => bankLog += data)
  bankProcess.on('error', error => bankError = error)
  await waitFor(async () => (await api(bank, '/health')).status === 200, '临时银行后端未就绪')
  browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
  track(page)
  await page.goto(`${base}/login`)
  const entry = page.getByRole('link', { name: '工作人员端', exact: true })
  assert.equal(new URL(await entry.getAttribute('href'), page.url()).href, `${base}/staff/login`)
  await entry.click()
  await page.getByLabel('员工姓名', { exact: true }).waitFor()
  assert.equal(page.url(), `${base}/staff/login`)
  console.log('PASS 登录页工作人员入口在同一网站打开 /staff/login')

  const customerResponse = page.waitForResponse(res => new URL(res.url()).pathname === '/api/auth/login' && res.ok())
  await login(page, base)
  const customerToken = (await (await customerResponse).json()).token
  assert(customerToken)
  assert.equal((await api(base, '/api/auth/profile', customerToken)).status, 200)
  await page.goto(`${base}/staff/login`)
  await page.getByLabel('员工姓名', { exact: true }).waitFor()
  const staffToken = await staffLogin(page, '王小明', 'workbench')
  await page.getByRole('heading', { name: '工作台', exact: true }).waitFor()
  const customersResponse = page.waitForResponse(res => new URL(res.url()).pathname === '/staff-api/customers' && res.ok())
  await page.getByRole('link', { name: '客户查询', exact: true }).click()
  await page.getByRole('heading', { name: '客户查询', exact: true }).waitFor()
  const customers = await (await customersResponse).json()
  assert(customers.length > 0)
  await page.getByRole('cell', { name: customers[0].customerId, exact: true }).waitFor()
  assert.equal(new URL(page.url()).pathname, '/staff/customers')
  assert.notEqual(customerToken, staffToken)
  assert.equal((await api(base, '/staff-api/me', staffToken)).status, 200)
  assert.equal((await api(base, '/staff-api/me', customerToken)).status, 401)
  assert.equal((await api(base, '/api/auth/profile', staffToken)).status, 401)
  assert.equal((await api(base, '/staff-api/ops/overview', staffToken)).status, 403)
  console.log('PASS 客户与客服真实登录、工作台及客户数据；两端令牌互不授权')

  await page.getByRole('button', { name: '退出', exact: true }).click()
  await page.waitForURL(url => url.pathname === '/staff/login')
  assert.equal((await api(base, '/staff-api/me', staffToken)).status, 401)
  assert.equal((await api(base, '/api/auth/profile', customerToken)).status, 200)
  await page.goto(`${base}/dashboard`)
  await page.waitForURL(url => url.pathname === '/dashboard')
  await page.getByRole('heading', { name: '账户概览', exact: true }).waitFor()
  await page.goto(`${base}/staff/customers`)
  await page.getByLabel('员工姓名', { exact: true }).waitFor()
  await page.reload()
  await page.getByLabel('员工姓名', { exact: true }).waitFor()
  assert.equal(new URL(page.url()).pathname, '/staff/login')
  assert.equal(await page.getByPlaceholder('请输入 11 位手机号').count(), 0)
  console.log('PASS 员工退出保留客户会话；员工深链接刷新仍显示员工登录')

  const operationsResponse = page.waitForResponse(res => new URL(res.url()).pathname === '/staff-api/ops/overview' && res.ok())
  const opsToken = await staffLogin(page, '运维人员', 'operations')
  await page.getByRole('heading', { name: '运行事件', exact: true }).waitFor()
  const overview = await (await operationsResponse).json()
  assert(overview.services.some(service => service.id === 'database' && service.status === 'up'))
  assert.equal(await page.getByRole('link', { name: '客户查询', exact: true }).count(), 0)
  assert.equal((await api(base, '/api/auth/profile', opsToken)).status, 401)
  const customerLogout = await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { authorization: `Bearer ${customerToken}` }, signal: AbortSignal.timeout(5000) })
  assert.equal(customerLogout.status, 200)
  assert.equal((await api(base, '/api/auth/profile', customerToken)).status, 401)
  assert.equal((await api(base, '/staff-api/me', opsToken)).status, 200, '客户退出影响了员工会话')
  for (const path of ['/staff-agent-api/health', '/staff-ops-agent-api/health']) {
    const before = agentPaths.length
    assert.equal((await api(base, path)).status, 401)
    assert.deepEqual(agentPaths.slice(before), ['/agent-api/health'])
  }
  assert.equal((await api(base, '/staff-api/me')).status, 401)
  await waitFor(() => websockets.some(url => new URL(url).pathname.endsWith('/__staff_hmr')), '员工 HMR 未连接到共享服务')
  for (const url of websockets) assert.equal(new URL(url).host, new URL(base).host, 'HMR 另开了端口')
  assert(requests.every(request => request.origin === base), '业务请求离开了临时统一网站')
  assert(requests.filter(request => request.path.startsWith('/staff-api/')).every(request => request.auth !== `Bearer ${customerToken}`))
  assert(requests.filter(request => request.path.startsWith('/api/')).every(request => ![staffToken, opsToken].some(token => request.auth === `Bearer ${token}`)))
  assert.deepEqual(errors, [], '页面出现运行错误')
  console.log('PASS 运维登录与 SQLite 状态、匿名 Agent 代理及 rewrite、业务接口与员工 HMR 共用网站端口；页面无异常')
} finally {
  const cleanup = await Promise.allSettled([
    browser?.close(), vite?.close(),
    (async () => {
      if (bankProcess?.pid && bankProcess.exitCode === null) {
        const exited = new Promise(resolve => bankProcess.once('exit', resolve))
        bankProcess.kill()
        await exited
      }
    })(),
    (async () => { gate.closeAllConnections(); await new Promise(resolve => gate.close(resolve)) })(),
  ])
  for (const key of Object.keys(process.env)) if (key.startsWith('VITE_')) delete process.env[key]
  Object.assign(process.env, savedViteEnv)
  await rm(dir, { recursive: true, force: true })
  const failures = cleanup.filter(result => result.status === 'rejected').map(result => result.reason)
  if (failures.length) throw new AggregateError(failures, '统一网站检查资源关闭失败')
}
