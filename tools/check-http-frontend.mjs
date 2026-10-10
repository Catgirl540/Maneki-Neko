/**
 * 浏览器 + HTTP + SQLite 联调，所有写操作只触及临时数据库。
 * 需要 Node.js 24、app 与 tools 的 npm ci，以及 Playwright Chromium。
 * node tools/check-http-frontend.mjs
 * CHROME_PATH 可覆盖浏览器路径；--production 检查已构建的生产版本。
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir, homedir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createServer as netServer } from 'node:net'
import { createServer, preview } from '../app/node_modules/vite/dist/node/index.js'
import { chromium } from 'playwright-core'
import { login, gotoInApp } from './lib/session.mjs'

const root = path.resolve(import.meta.dirname, '..')
const temp = await mkdtemp(path.join(tmpdir(), 'luckycat-http-ui-'))
const probe = netServer()
const bankPort = await new Promise(resolve => probe.listen(0, '127.0.0.1', () => resolve(probe.address().port)))
await new Promise(resolve => probe.close(resolve))
const dbFile = path.join(temp, 'bank.sqlite')
const child = spawn(process.execPath, [path.join(root, 'server/index.mjs')], {
  cwd: root, env: { ...process.env, BANK_PORT: String(bankPort), BANK_DB_FILE: dbFile, BANK_STATE_FILE: path.join(temp, 'no-legacy.json') }, stdio: ['ignore', 'pipe', 'pipe'],
})
let logs = ''
child.stdout.on('data', chunk => { logs += chunk })
child.stderr.on('data', chunk => { logs += chunk })
let web, browser
const bankBase = `http://127.0.0.1:${bankPort}`
const endpoint = async (url, token, body) => {
  const response = await fetch(bankBase + url, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
  const data = await response.json()
  assert.equal(response.status, 200, JSON.stringify(data))
  return data
}
async function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH
  const cache = path.join(homedir(), '.cache/ms-playwright')
  const versions = (await readdir(cache)).filter(name => name.startsWith('chromium-')).sort()
  return path.join(cache, versions.at(-1), 'chrome-linux64', 'chrome')
}
async function waitFor(check, message) {
  for (let n = 0; n < 100; n++) {
    if (await check()) return
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(message)
}
try {
  await waitFor(async () => {
    if (child.exitCode !== null) throw new Error(logs)
    try { return (await (await fetch(bankBase + '/health')).json()).ok } catch { return false }
  }, '后端未启动：' + logs)
  process.env.VITE_USE_MOCK = 'false'
  process.env.VITE_PROXY_TARGET = bankBase
  const appRoot = path.join(root, 'app')
  const config = { root: appRoot, configFile: path.join(appRoot, 'vite.config.ts'), logLevel: 'error', server: { host: '127.0.0.1', port: 5180, strictPort: true }, preview: { host: '127.0.0.1', port: 5180, strictPort: true, proxy: { '/api': { target: bankBase } } } }
  web = process.argv.includes('--production') ? await preview(config) : await createServer(config)
  if (web.listen) await web.listen()
  browser = await chromium.launch({ executablePath: await chromePath() })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const pageErrors = [], requests = []
  page.on('pageerror', error => pageErrors.push(error.message))
  page.on('request', request => requests.push(request.url()))
  // 仅模拟独立助手健康检查；银行 API 全部经过真实后端。
  await page.route('**/agent-api/**', route => route.fulfill({ contentType: 'application/json', body: '{"ok":true,"bankDataSource":"demo"}' }))
  const base = 'http://127.0.0.1:5180'
  await page.goto(base + '/login')
  await page.getByPlaceholder('请输入密码').waitFor()
  await page.evaluate(() => {
    localStorage.setItem('luckycat.mock.db', JSON.stringify({ user: { name: '旧占位用户' } }))
    localStorage.setItem('luckycat.luckycat.mock.user-profiles.v1', '{}')
    localStorage.setItem('luckycat.support.history.v1', '[{"text":"旧占位消息"}]')
    localStorage.setItem('luckycat.ui.sidebarCollapsed', 'true')
    sessionStorage.setItem('luckycat.token', '"mock.old-token"')
    sessionStorage.setItem('luckycat.session.user', '{"name":"旧占位用户"}')
  })
  await page.goto(base + '/dashboard')
  await page.getByPlaceholder('请输入密码').waitFor()
  assert.equal(await page.getByLabel('手机号', { exact: true }).inputValue(), '')
  assert.equal(await page.getByLabel('密码', { exact: true }).inputValue(), '')
  const migrated = await page.evaluate(() => ({ mock: localStorage.getItem('luckycat.mock.db'), profiles: localStorage.getItem('luckycat.luckycat.mock.user-profiles.v1'), messages: localStorage.getItem('luckycat.support.history.v1'), preference: localStorage.getItem('luckycat.ui.sidebarCollapsed'), token: sessionStorage.getItem('luckycat.token') }))
  assert.deepEqual(migrated, { mock: null, profiles: null, messages: null, preference: 'true', token: null })
  console.log('PASS 清理旧占位缓存与令牌，保留界面偏好，登录不预填')

  await login(page, base)
  await page.getByText('储蓄账户余额', { exact: true }).waitFor()
  const token = await page.evaluate(() => JSON.parse(sessionStorage.getItem('luckycat.token')))
  assert(!token.startsWith('mock.'))
  const accounts = await endpoint('/api/accounts', token)
  await page.getByRole('button', { name: '显示', exact: true }).click()
  const amount = (accounts[0].balance / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  assert((await page.locator('main').innerText()).includes(amount), '页面金额与后端不一致')
  assert(requests.some(url => url.includes('/api/accounts')), '没有发起真实账户 HTTP 请求')
  await page.getByRole('button', { name: '转入', exact: true }).click()
  await page.getByRole('dialog', { name: '转入 · 收款信息' }).waitFor()
  assert.equal(await page.getByRole('button', { name: '模拟一笔转入', exact: true }).count(), 0)
  await page.keyboard.press('Escape')
  await page.getByRole('dialog').waitFor({ state: 'detached' })
  console.log('PASS HTTP 登录、账户余额与收款接口一致，无模拟入账按钮')

  for (const route of ['/transfer', '/cards', '/analysis', '/wealth', '/security', '/support']) {
    await gotoInApp(page, route)
    await page.getByRole('status', { name: '正在加载银行数据' }).waitFor({ state: 'detached' })
    await page.waitForTimeout(500)
    assert.equal(await page.getByText('数据暂时无法加载').count(), 0, route + ' 接口失败')
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), route + ' 手机溢出')
  }
  assert.equal(await page.locator('[data-agent-status]').getAttribute('data-agent-status'), 'off', '占位助手不应被启用')
  assert.equal(await page.evaluate(() => localStorage.getItem('luckycat.support.history.v1')), null)
  console.log('PASS 7 个主要页面使用后端数据，拒绝占位助手与本地客服缓存')

  await gotoInApp(page, '/cards')
  const update = page.waitForResponse(response => response.url().includes('/api/cards/') && response.request().method() === 'PATCH')
  await page.getByRole('button', { name: '¥5,000.00', exact: true }).click()
  assert.equal((await update).status(), 200)
  const profile = await endpoint('/api/auth/profile', token)
  const cards = await endpoint('/api/cards', token)
  const sqlite = new DatabaseSync(dbFile)
  try { assert.equal(sqlite.prepare('SELECT daily_limit_cents FROM virtual_cards WHERE owner_id = ? AND id = ?').get(profile.id, cards[0].id).daily_limit_cents, 500_000) } finally { sqlite.close() }
  await page.reload()
  await page.getByText('单日限额', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '¥5,000.00', exact: true }).count(), 1)
  console.log('PASS 浏览器修改卡限额写入 SQLite，刷新后会话和数据保留')

  // 有控制的错误注入仅验证错误 UI；此前成功路径未拦截银行请求。
  await page.route('**/api/accounts', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"测试后端暂不可用"}' }))
  await gotoInApp(page, '/dashboard')
  await page.getByText('测试后端暂不可用').waitFor()
  assert.equal(await page.getByText('储蓄账户余额', { exact: true }).count(), 0, '错误时不可展示伪造账户')
  await page.unroute('**/api/accounts')
  await page.getByRole('button', { name: '重新加载', exact: true }).click()
  await page.getByText('储蓄账户余额', { exact: true }).waitFor()
  await page.route('**/api/analysis/spending*', route => route.fulfill({ contentType: 'text/html', body: '<html>SPA fallback</html>' }))
  await gotoInApp(page, '/analysis')
  await page.getByText('银行接口返回了无效响应，请检查后端服务与 /api 代理配置').waitFor()
  await page.unroute('**/api/analysis/spending*')
  console.log('PASS 后端失败和 HTML 回落显示错误，可重试，不回退 mock')

  await endpoint('/api/auth/logout', token, {})
  await gotoInApp(page, '/security')
  await page.getByPlaceholder('请输入密码').waitFor()
  assert.equal(await page.evaluate(() => sessionStorage.getItem('luckycat.token')), null)
  console.log('PASS 失效 HTTP 会话清理并返回登录页')
  const newPhone = '13911223344'
  const sms = await endpoint('/api/auth/sms-code', null, { phone: newPhone })
  const face = await endpoint('/api/security/verify', null, { channel: 'face' })
  const fresh = await endpoint('/api/auth/register', null, {
    phone: newPhone, password: '123456', holderName: '联调新用户', idNumber: '110101199001011234',
    smsCode: sms.demoCode, faceTicket: face.ticket,
    pledge: '本人充分了解并清楚知晓出租、出借、出售、购买账户的相关法律责任和惩戒措施，承诺依法依规开立和使用本人账户',
  })
  const freshAccounts = await endpoint('/api/accounts', fresh.token)
  assert.equal(freshAccounts[0].balance, 0)
  const freshPage = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await freshPage.route('**/agent-api/**', route => route.fulfill({ status: 503, body: '{}' }))
  await login(freshPage, base, { phone: newPhone })
  await freshPage.getByText('储蓄账户余额', { exact: true }).waitFor()
  await freshPage.getByRole('button', { name: '显示', exact: true }).click()
  assert((await freshPage.locator('main').innerText()).includes('¥0.00'))
  await gotoInApp(freshPage, '/cards')
  await freshPage.getByRole('status', { name: '正在加载银行数据' }).waitFor({ state: 'detached' })
  assert.equal(await freshPage.getByText('尾号 8888').count(), 0)
  assert.equal((await endpoint('/api/cards', fresh.token)).length, 0)
  assert.equal((await endpoint('/api/payees', fresh.token)).length, 0)
  console.log('PASS 新开户用户显示后端零余额和空卡列表，不混入旧占位账户')
  assert(!requests.some(url => /\/src\/api\/mock\/|\/assets\/mock-/.test(url)), 'HTTP 页面加载了浏览器 mock 模块')
  assert.deepEqual(pageErrors, [])
  console.log('PASS HTTP 前端联调完成')
} finally {
  await browser?.close()
  if (web?.close) await web.close()
  else if (web) await new Promise(resolve => web.httpServer.close(resolve))
  const exited = new Promise(resolve => child.once('exit', resolve))
  if (child.exitCode === null) { child.kill('SIGTERM'); await exited }
  await rm(temp, { recursive: true, force: true })
}
