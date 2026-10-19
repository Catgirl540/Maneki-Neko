import './legacy-sqlite-fixture-disabled.mjs'
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
  const webPort = Number(process.env.HTTP_UI_PORT ?? 5180)
  const config = { root: appRoot, configFile: path.join(appRoot, 'vite.config.ts'), logLevel: 'error', server: { host: '127.0.0.1', port: webPort, strictPort: true }, preview: { host: '127.0.0.1', port: webPort, strictPort: true, proxy: { '/api': { target: bankBase } } } }
  web = process.argv.includes('--production') ? await preview(config) : await createServer(config)
  if (web.listen) await web.listen()
  browser = await chromium.launch({ executablePath: await chromePath() })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const pageErrors = [], requests = []
  page.on('pageerror', error => pageErrors.push(error.message))
  page.on('request', request => requests.push(request.url()))
  // 仅模拟独立助手健康检查；银行 API 全部经过真实后端。
  await page.route('**/agent-api/**', route => route.fulfill({ contentType: 'application/json', body: '{"ok":true,"bankDataSource":"demo"}' }))
  const base = `http://127.0.0.1:${webPort}`
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
  const receiving = page.getByRole('dialog', { name: '转入', exact: true })
  await receiving.getByRole('button', { name: '复制全部', exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '模拟一笔转入', exact: true }).count(), 0)
  assert((await receiving.innerText()).includes(accounts[0].accountNo))
  await receiving.getByRole('button', { name: '关闭弹窗', exact: true }).click()
  await receiving.waitFor({ state: 'detached' })
  console.log('PASS HTTP 登录、账户余额与收款接口一致，无模拟入账按钮')

  // 财务写操作仅使用本脚本创建的临时数据库。
  const transfer = page.getByRole('dialog', { name: '转出', exact: true })
  const target = accounts[1]
  assert(target, '演示用户缺少第二个账户')
  const holder = (await endpoint('/api/auth/profile', token)).name
  async function review(amount) {
    await transfer.getByLabel('转账金额', { exact: true }).fill(amount)
    await transfer.getByRole('button', { name: '下一步', exact: true }).click()
    await transfer.getByLabel('收款账户', { exact: true }).fill(target.accountNo)
    await transfer.getByLabel('收款人', { exact: true }).fill(holder)
    await transfer.getByRole('button', { name: '下一步', exact: true }).click()
    await transfer.getByRole('heading', { name: '信息确认', exact: true }).waitFor()
  }
  await page.getByRole('button', { name: '转出', exact: true }).click()
  await review('1')
  let submits = 0
  await page.route('**/api/transfers', async route => {
    if (route.request().method() === 'POST') {
      submits++
      await new Promise(resolve => setTimeout(resolve, 800))
    }
    await route.continue()
  })
  await transfer.getByRole('button', { name: '确认转账', exact: true }).click()
  await transfer.locator('[aria-label="关闭弹窗"][disabled]').waitFor()
  await page.keyboard.press('Escape')
  assert.equal(await transfer.count(), 1, '提交中 Escape 不应关闭')
  assert(await transfer.getByRole('button', { name: '确认转账', exact: true }).isDisabled())
  await transfer.getByRole('heading', { name: '转账成功', exact: true }).waitFor()
  assert.equal(submits, 1)
  await page.unroute('**/api/transfers')
  await transfer.getByRole('button', { name: '完成', exact: true }).click()
  await transfer.waitFor({ state: 'detached' })
  const afterTransfer = await endpoint('/api/accounts', token)
  assert.equal(afterTransfer[0].balance, accounts[0].balance - 100)
  assert.equal(afterTransfer[1].balance, accounts[1].balance + 100)
  const newBalance = (afterTransfer[0].balance / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  await page.getByRole('region', { name: '账户余额', exact: true }).getByText(`¥${newBalance}`, { exact: true }).first().waitFor()
  await page.locator('main a[href^="/transactions/"]').first().waitFor()
  console.log('PASS HTTP 转出同窗完成、提交期间禁止关闭及重复点击，余额与流水刷新')

  await page.getByRole('button', { name: '转出', exact: true }).click()
  await review('6000')
  await transfer.getByRole('button', { name: '确认转账', exact: true }).click()
  await transfer.getByText('请再次确认', { exact: true }).waitFor()
  assert.equal(await page.getByRole('dialog').count(), 1)
  await transfer.getByRole('button', { name: '确认转出', exact: true }).click()
  await transfer.getByRole('heading', { name: '转账处理中', exact: true }).waitFor()
  const frozen = await endpoint('/api/accounts', token)
  assert.equal(frozen[0].balance, afterTransfer[0].balance)
  assert.equal(frozen[0].available, afterTransfer[0].available - 600_000)
  await transfer.getByRole('button', { name: '撤销这笔转账', exact: true }).click()
  await transfer.getByLabel('转账金额', { exact: true }).waitFor()
  const recalled = await endpoint('/api/accounts', token)
  assert.equal(recalled[0].available, afterTransfer[0].available)
  assert.equal(recalled[1].balance, afterTransfer[1].balance)
  await transfer.getByRole('button', { name: '关闭弹窗', exact: true }).click()
  await transfer.waitFor({ state: 'detached' })
  console.log('PASS HTTP 大额二次确认与撤销同窗完成，临时数据库冻结与解冻正确')

  for (const route of ['/cards', '/analysis', '/analysis/statistics', '/analysis/autodebits', '/wealth', '/security', '/support']) {
    await gotoInApp(page, route)
    await page.getByRole('status', { name: '正在加载银行数据' }).waitFor({ state: 'detached' })
    await page.waitForTimeout(500)
    assert.equal(await page.getByText('数据暂时无法加载').count(), 0, route + ' 接口失败')
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), route + ' 手机溢出')
  }
  assert.equal(await page.locator('[data-agent-status]').getAttribute('data-agent-status'), 'off', '占位助手不应被启用')
  assert.equal(await page.evaluate(() => localStorage.getItem('luckycat.support.history.v1')), null)
  console.log('PASS 主要页面使用后端数据，拒绝占位助手与本地客服缓存')

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
  await page.route('**/api/accounts/*/transactions*', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"测试流水不可用"}' }))
  await gotoInApp(page, '/dashboard')
  await page.getByText('测试流水不可用', { exact: true }).waitFor()
  await page.getByText('储蓄账户余额', { exact: true }).waitFor()
  assert.equal(await page.getByText('还没有交易记录', { exact: true }).count(), 0)
  await page.unroute('**/api/accounts/*/transactions*')
  await page.getByRole('button', { name: '重新加载', exact: true }).click()
  await page.locator('main a[href^="/transactions/"]').first().waitFor()
  console.log('PASS 概览流水独立报错和重试，余额继续显示')

  await gotoInApp(page, '/cards')
  await page.route('**/api/accounts', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"测试后端暂不可用"}' }))
  await gotoInApp(page, '/dashboard')
  await page.getByText('测试后端暂不可用').waitFor()
  assert.equal(await page.getByText('储蓄账户余额', { exact: true }).count(), 0, '错误时不可展示伪造账户')
  await page.unroute('**/api/accounts')
  await page.getByRole('button', { name: '重新加载', exact: true }).click()
  await page.getByText('储蓄账户余额', { exact: true }).waitFor()
  await page.route('**/api/analysis/spending*', route => route.fulfill({ contentType: 'text/html', body: '<html>SPA fallback</html>' }))
  await gotoInApp(page, '/analysis/statistics')
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
    phone: newPhone, password: '123456', paymentPassword: '888888', holderName: '联调新用户', idNumber: '110101199001011234',
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
  // 从刚完成储蓄开户的用户继续开理财户，不再传姓名或身份证。
  const { WEALTH_INVESTMENT_AGREEMENT } = await import('../app/src/lib/wealth.ts')
  const wealthBefore = await endpoint('/api/wealth/overview', fresh.token)
  const otherWealthBefore = await endpoint('/api/wealth/overview', (await endpoint('/api/auth/login', null, {
    phone: '13800138000', password: '123456', smsCode: (await endpoint('/api/auth/sms-code', null, { phone: '13800138000' })).demoCode,
  })).token)
  async function rejectedWealth(body, expectedStatus, expectedCode, authToken = fresh.token) {
    const response = await fetch(bankBase + '/api/wealth/account/open', { method: 'POST', headers: { 'content-type': 'application/json', ...(authToken ? { authorization: `Bearer ${authToken}` } : {}) }, body: JSON.stringify(body) })
    const data = await response.json()
    assert.equal(response.status, expectedStatus, JSON.stringify(data))
    assert.equal(data.code, expectedCode)
  }
  const validSms = await endpoint('/api/auth/sms-code', fresh.token, { phone: newPhone })
  const validFace = await endpoint('/api/security/verify', fresh.token, { channel: 'face' })
  const application = { smsCode: validSms.demoCode, faceTicket: validFace.ticket, settlementAccountId: freshAccounts[0].id, agreement: WEALTH_INVESTMENT_AGREEMENT }
  await rejectedWealth(application, 401, 'UNAUTHORIZED', null)
  await rejectedWealth({ ...application, smsCode: '000000' }, 400, 'BAD_SMS_CODE')
  await rejectedWealth({ ...application, faceTicket: '' }, 400, 'FACE_REQUIRED')
  await rejectedWealth(application, 403, 'RISK_ASSESSMENT_REQUIRED')
  const wrongPhoneSms = await endpoint('/api/auth/sms-code', fresh.token, { phone: '13911223345' })
  await rejectedWealth({ ...application, smsCode: wrongPhoneSms.demoCode }, 400, 'SMS_PHONE_MISMATCH')
  assert.equal((await endpoint('/api/wealth/overview', fresh.token)).account.opened, false)
  console.log('PASS 理财开户拒绝未登录、错误短信、其它手机号短信、缺少人脸和未完成风险评估')

  freshPage.on('pageerror', error => pageErrors.push(error.message))
  await gotoInApp(freshPage, '/wealth')
  await freshPage.getByRole('button', { name: '开立理财账户', exact: true }).click()
  const wealthDialog = freshPage.getByRole('dialog')
  const questions = await endpoint('/api/wealth/risk/questions', fresh.token)
  for (let i = 0; i < questions.length; i++) {
    await wealthDialog.getByRole('button', { name: questions[i].options[0].label, exact: true }).click()
    await wealthDialog.getByRole('button', { name: i === questions.length - 1 ? '提交并继续' : '下一题', exact: true }).click()
  }
  await freshPage.getByRole('dialog', { name: '开立理财账户 · 身份核验', exact: true }).waitFor()
  assert.equal(await freshPage.getByRole('dialog').count(), 1, '开户测评后应直接进入身份核验')
  assert.equal(await wealthDialog.getByLabel('姓名', { exact: true }).count(), 0)
  assert.equal(await wealthDialog.getByLabel('身份证号', { exact: true }).count(), 0)
  assert.equal(await wealthDialog.getByRole('textbox').count(), 1, '身份核验只需短信输入')
  const next = wealthDialog.getByRole('button', { name: '下一步', exact: true })
  assert(await next.isDisabled())
  await wealthDialog.getByRole('button', { name: '获取验证码', exact: true }).click()
  const hint = wealthDialog.getByText(/演示环境验证码[：:]\s*\d{6}/)
  await hint.waitFor()
  const code = /\d{6}/.exec(await hint.innerText())[0]
  await wealthDialog.getByLabel('短信验证码', { exact: true }).fill(code)
  assert(await next.isDisabled(), '缺少人脸核身时不应继续')
  await wealthDialog.getByRole('button', { name: '开始核身', exact: true }).click()
  await wealthDialog.getByText('已通过核身', { exact: true }).waitFor()
  assert(await next.isEnabled())
  await freshPage.screenshot({ path: path.join(temp, 'wealth-identity.png') })
  await next.click()
  await freshPage.getByRole('dialog', { name: '开立理财账户 · 签署协议', exact: true }).waitFor()
  await rejectedWealth({ ...application, smsCode: code, agreement: '', holderName: '不能替换账户身份', idNumber: 'invalid' }, 400, 'AGREEMENT_REQUIRED')
  await rejectedWealth({ ...application, smsCode: code, settlementAccountId: accounts[0].id }, 400, 'SETTLEMENT_REQUIRED')
  const openRequest = freshPage.waitForRequest(request => request.url().endsWith('/api/wealth/account/open') && request.method() === 'POST')
  const openResponse = freshPage.waitForResponse(response => response.url().endsWith('/api/wealth/account/open') && response.request().method() === 'POST')
  await wealthDialog.getByRole('checkbox').check()
  await wealthDialog.getByRole('button', { name: '签署并开立', exact: true }).click()
  assert.deepEqual(Object.keys((await openRequest).postDataJSON()).sort(), ['agreement', 'faceTicket', 'settlementAccountId', 'smsCode'])
  assert.equal((await openResponse).status(), 200)
  await wealthDialog.waitFor({ state: 'detached' })
  const opened = await endpoint('/api/wealth/overview', fresh.token)
  assert.equal(wealthBefore.account.opened, false)
  assert.equal(opened.account.opened, true)
  assert.equal(opened.account.settlementAccountId, freshAccounts[0].id)
  assert.equal((await endpoint('/api/auth/profile', fresh.token)).name, '联调新用户')
  assert.equal((await endpoint('/api/accounts', fresh.token))[0].balance, 0)
  await rejectedWealth({ ...application, smsCode: code }, 400, 'ALREADY_OPENED')
  // 当前用户的开户不会改变另一用户的开户状态。
  const otherSms = await endpoint('/api/auth/sms-code', null, { phone: '13800138000' })
  const other = await endpoint('/api/auth/login', null, { phone: '13800138000', password: '123456', smsCode: otherSms.demoCode })
  assert.deepEqual((await endpoint('/api/wealth/overview', other.token)).account, otherWealthBefore.account)
  await freshPage.reload()
  await freshPage.getByText('理财总资产', { exact: true }).waitFor()
  console.log('PASS 储蓄开户后直接用短信与人脸开理财户，无姓名/身份证输入或传输，协议、账户归属和持久化正确')

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
