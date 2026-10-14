/** issue #4：真实 HTTP + 临时 SQLite，验证结果页/详情刷新，不调用外部模型。 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer as viteServer } from '../app/node_modules/vite/dist/node/index.js'
import { chromium } from 'playwright-core'
import { login, gotoInApp } from './lib/session.mjs'

const root = path.resolve(import.meta.dirname, '..')
const temp = await mkdtemp(path.join(tmpdir(), 'transfer-status-ui-'))
async function port() {
  const server = createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const value = server.address().port
  await new Promise(resolve => server.close(resolve))
  return value
}
const bankPort = await port()
const child = spawn(process.execPath, [path.join(root, 'server/index.mjs')], {
  cwd: root,
  env: { ...process.env, BANK_HOST: '127.0.0.1', BANK_PORT: String(bankPort),
    BANK_DB_FILE: path.join(temp, 'bank.sqlite'), BANK_STATE_FILE: path.join(temp, 'none.json'),
    BANK_TRANSFER_REVIEW_CENTS: '500000', BANK_TRANSFER_HOLD_SECONDS: '12' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let logs = '', web, browser
child.stdout.on('data', b => { logs += b }); child.stderr.on('data', b => { logs += b })
const bankBase = `http://127.0.0.1:${bankPort}`
async function call(route, token, body) {
  const response = await fetch(bankBase + route, { method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) })
  const value = await response.json()
  assert.equal(response.status, 200, JSON.stringify(value))
  return value
}
try {
  for (let attempt = 0; ; attempt++) {
    try { if ((await (await fetch(bankBase + '/health')).json()).ok) break } catch { /* 启动中 */ }
    if (attempt > 100 || child.exitCode !== null) throw new Error(logs)
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  Object.assign(process.env, { VITE_USE_MOCK: 'false', VITE_PROXY_TARGET: bankBase,
    VITE_BASE_PATH: '/', VITE_API_BASE_URL: '' })
  const webPort = await port()
  web = await viteServer({ root: path.join(root, 'app'), configFile: path.join(root, 'app/vite.config.ts'),
    logLevel: 'error', server: { host: '127.0.0.1', port: webPort, strictPort: true, hmr: false } })
  await web.listen()
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
  page.setDefaultTimeout(20_000)
  const errors = [], posts = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', req => { if (req.method() === 'POST' && new URL(req.url()).pathname === '/api/transfers') posts.push(req.url()) })
  await page.route('**/agent-api/**', route => route.fulfill({ status: 503, body: '{}' }))
  await login(page, `http://127.0.0.1:${webPort}`)
  const token = await page.evaluate(() => JSON.parse(sessionStorage.getItem('luckycat.token')))
  const accounts = await call('/api/accounts', token)
  const user = await call('/api/auth/profile', token)
  const own = { fromAccountId: accounts[0].id, channel: 'bank', scope: 'domestic',
    payeeName: user.name, payeeAccountNo: accounts[1].accountNo,
    payeeBankCode: 'LCB', payeeBankRegion: 'CN', amount: 600_000, memo: '状态刷新回归' }
  const dialog = page.getByRole('dialog', { name: '转出', exact: true })
  async function transferToOwn(amount = '6000', external = false) {
    await gotoInApp(page, '/dashboard')
    await page.getByRole('button', { name: '转出', exact: true }).click()
    await dialog.getByLabel('转账金额', { exact: true }).fill(amount)
    await dialog.getByRole('button', { name: '下一步', exact: true }).click()
    await dialog.getByRole('button', { name: /云闪付联名卡/ }).click()
    if (external) {
      await dialog.getByRole('button', { name: '选择收款银行', exact: true }).click()
      await dialog.getByRole('option', { name: /中国工商银行/ }).click()
    }
    await dialog.getByRole('button', { name: '下一步', exact: true }).click()
    await dialog.getByRole('button', { name: '确认转账', exact: true }).click()
    if (Number(amount) >= 5000) await dialog.getByRole('button', { name: '确认转出', exact: true }).click()
    await dialog.getByRole('heading', { name: external ? '已提交模拟清算' : '转账处理中', exact: true }).waitFor()
  }
  await transferToOwn()
  await dialog.getByRole('heading', { name: '转账成功', exact: true }).waitFor()
  assert.equal(await dialog.getByRole('button', { name: '撤销这笔转账' }).count(), 0)
  const successPosts = posts.length
  await page.waitForTimeout(2600)
  assert.equal(posts.length, successPosts, '状态查询不得重发资金指令')
  await dialog.getByRole('button', { name: '完成', exact: true }).click()
  console.log('PASS 在途结果页自动转成功，关闭撤销入口，不重发转账')

  const pending = await call('/api/transfers', token, own)
  let failQueries = true
  await page.route(`**/api/transactions/${pending.transactionId}`, route =>
    failQueries ? route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"临时不可用"}' }) : route.continue())
  // 先成功打开详情，再让轮询失败，不能在窗口到点时自行宣称成功。
  failQueries = false
  await gotoInApp(page, `/transactions/${pending.transactionId}`)
  await page.getByRole('button', { name: '撤销转账', exact: true }).waitFor()
  failQueries = true
  await page.waitForTimeout(13_000)
  assert.equal(await page.getByRole('button', { name: '撤销转账', exact: true }).count(), 0)
  assert((await page.locator('main').innerText()).includes('在途·延迟到账'))
  failQueries = false
  await page.getByText('交易成功', { exact: true }).first().waitFor()
  assert.equal((await call(`/api/transactions/${pending.transactionId}`, token)).status, 'success')
  console.log('PASS 详情页到点关闭撤销；查询失败保持未确认状态，恢复后显示实际结果，原链接有效')

  await transferToOwn()
  const list = await call(`/api/accounts/${accounts[0].id}/transactions?size=50`, token)
  const held = list.items.find(tx => tx.pendingReason === 'inflight')
  const staff = await call('/staff-api/login', null, { name: '李主管', password: '123456' })
  const approvals = await call('/staff-api/approvals', staff.token)
  const rows = approvals.approvals ?? approvals
  const approval = rows.find(row => row.payload?.transactionId === held.id && row.status === 'pending')
  assert(approval)
  await call(`/staff-api/approvals/${approval.approvalId}/decide`, staff.token, { decision: 'intercept', reasonCode: '疑似诈骗' })
  await dialog.getByRole('heading', { name: '转账未完成', exact: true }).waitFor()
  assert((await dialog.innerText()).includes('已拦截'))
  assert.equal(await dialog.getByRole('button', { name: '撤销这笔转账' }).count(), 0)
  await dialog.getByRole('button', { name: '完成', exact: true }).click()
  console.log('PASS 员工拦截自动反馈到结果页，不误显示成功')
  await transferToOwn('100', true)
  assert.equal(await dialog.getByRole('button', { name: '撤销这笔转账' }).count(), 0)
  await dialog.getByRole('heading', { name: '转账成功', exact: true }).waitFor()
  console.log('PASS 普通外行清算与大额在途分开显示，清算完成自动刷新且不可撤销')
  assert.deepEqual(errors, [])
} finally {
  await browser?.close()
  await web?.close()
  child.kill()
  await new Promise(resolve => { if (child.exitCode !== null) resolve(); else child.once('exit', resolve) })
  await rm(temp, { recursive: true, force: true })
}
