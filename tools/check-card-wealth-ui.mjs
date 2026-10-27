/** Current desktop pages through HTTP adapter and isolated in-memory bank rules. */
import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdir } from 'node:fs/promises'
import { createServer } from '../app/node_modules/vite/dist/node/index.js'
import { chromium } from 'playwright-core'
class MemoryStorage { values = new Map(); getItem(k) { return this.values.get(k) ?? null } setItem(k, v) { this.values.set(k, String(v)) } removeItem(k) { this.values.delete(k) } setItemsAtomically(entries) { for (const [k, v] of entries) this.setItem(k, v) } }
globalThis.window = { localStorage: new MemoryStorage(), sessionStorage: new MemoryStorage() }
const state = await import('../server/domain/state.mjs'), { createBankBusinessApi } = await import('../server/domain/index.mjs')
state.resetDb()
const api = createBankBusinessApi(), user = await api.profile(), db = state.loadDb()
const product = (await api.listCardProducts()).find(row => !row.held)
const pending = await api.openCard({ productCode: product.code, paymentPassword: '888888', address: { recipient: '网页测试客户', phone: '13800138000', region: '上海市', city: '上海市', detail: '浦东新区测试路 100 号', postalCode: '200120' } })
db.wealthAccount.opened = true; db.wealthAccount.settlementAccountId = db.accounts[0].id
db.riskAssessment = { done: true, expired: false, level: 'C5', assessedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString() }
const equity = (await api.listWealthProducts()).find(row => row.code === 'LCB-EQUITY-300')
db.holdings = [{ id: 'ui-holding', productCode: equity.code, productName: equity.name, category: equity.category, risk: equity.risk, shares: 20000, principal: 20000, costNav: equity.nav, purchasedAt: new Date(Date.now() - 8 * 86400000).toISOString(), redeemableAt: null, lots: [{ shares: 10000, purchasedAt: new Date(Date.now() - 8 * 86400000).toISOString(), redeemableAt: null }, { shares: 10000, purchasedAt: new Date(Date.now() - 86400000).toISOString(), redeemableAt: null }] }]
state.persist()
const root = path.resolve(import.meta.dirname, '..'), output = path.join(root, '.generated', 'card-wealth-ui')
await mkdir(output, { recursive: true })
Object.assign(process.env, { VITE_USE_MOCK: 'false', VITE_BASE_PATH: '/', VITE_API_BASE_URL: '', VITE_AGENT_URL: '/agent-api' })
const web = await createServer({ root: path.join(root, 'app'), configFile: path.join(root, 'app/vite.config.ts'), logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false } })
let browser
const errors = [], mutations = []
try {
  await web.listen()
  const base = `http://127.0.0.1:${web.httpServer.address().port}`
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
  page.setDefaultTimeout(12000); page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(user => { sessionStorage.setItem('luckycat.token', JSON.stringify('fixture-token')); sessionStorage.setItem('luckycat.session.user', JSON.stringify(user)) }, user)
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method(), pathname = url.pathname
    const respond = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    if (url.origin !== base) return respond({ message: 'External calls blocked' }, 502)
    if (pathname.startsWith('/agent-api/')) return respond({ ok: true, bankDataSource: 'http' })
    if (!pathname.startsWith('/api/')) return route.continue()
    const body = request.postData() ? JSON.parse(request.postData()) : {}
    if (method !== 'GET') mutations.push({ method, pathname, body })
    try {
      if (pathname === '/api/auth/profile') return respond(user)
      if (pathname === '/api/accounts') return respond(await api.listAccounts())
      if (pathname === '/api/membership') return respond(await api.getMembership())
      if (pathname === '/api/security/overview') return respond(await api.getSecurityOverview())
      if (pathname === '/api/cards') return respond(await api.listCards())
      if (pathname === '/api/cards/products') return respond(await api.listCardProducts())
      if (pathname === '/api/support/messages') return respond([])
      if (pathname === '/api/wealth/products') return respond(await api.listWealthProducts())
      if (pathname === '/api/wealth/overview') return respond(await api.getWealthOverview())
      if (pathname === '/api/wealth/redeem') return respond(await api.redeemWealth(body))
      const match = /^\/api\/cards\/([^/]+)\/(lost|recover|activate|lock|settings)$/.exec(pathname)
      if (match) {
        const [, id, action] = match
        if (action === 'lost') return respond(await api.reportCardLost(id, body.paymentPassword))
        if (action === 'recover') return respond(await api.recoverCard(id, body.paymentPassword))
        if (action === 'activate') return respond(await api.activateCard(id, body.paymentPassword))
        if (action === 'lock') return respond(await api.setCardLock(id, body.locked))
        return respond(await api.updateCardSettings(id, body))
      }
      errors.push(`Unhandled fixture ${method} ${pathname}`); return respond({ message: 'No fixture' }, 404)
    } catch (error) { return respond({ message: error.message, code: error.code }, error.status ?? 500) }
  })
  const pin = async (dialog, digit) => { for (let i = 1; i <= 6; i++) await dialog.getByLabel(`支付密码第 ${i} 位`, { exact: true }).fill(digit) }
  const balance = db.accounts[0].available
  await page.goto(base + '/cards')
  await page.getByRole('button', { name: `${pending.productName} 尾号 ${pending.last4} · 待激活`, exact: true }).click()
  assert(await page.getByRole('button', { name: '立即锁卡', exact: true }).isDisabled())
  await page.getByRole('button', { name: '正式挂失', exact: true }).click()
  let dialog = page.getByRole('dialog', { name: '正式挂失', exact: true })
  await pin(dialog, '0'); await dialog.getByRole('button', { name: '确认挂失', exact: true }).click()
  await dialog.getByRole('alert').waitFor(); assert.equal(pending.status, 'pending')
  await pin(dialog, '8'); await dialog.getByRole('button', { name: '确认挂失', exact: true }).click()
  await page.getByRole('button', { name: '找回解挂', exact: true }).waitFor()
  await dialog.waitFor({ state: 'hidden' })
  assert.equal(pending.status, 'lost'); assert.equal(pending.onlinePayment, false)
  await page.screenshot({ path: path.join(output, 'lost.png'), fullPage: true })
  await page.getByRole('button', { name: '找回解挂', exact: true }).click()
  dialog = page.getByRole('dialog', { name: '找回解挂', exact: true })
  await pin(dialog, '8'); await dialog.getByRole('button', { name: '确认找回并解挂', exact: true }).click()
  await page.getByRole('button', { name: '激活卡片', exact: true }).waitFor()
  assert.equal(pending.status, 'pending'); assert.equal(db.accounts[0].available, balance)
  assert(await page.getByRole('button', { name: '立即锁卡', exact: true }).isDisabled())
  console.log('PASS 卡片UI：待激活锁卡禁用→挂失验密失败不写→正式挂失→验密解挂仍待激活，余额不变')
  await page.goto(base + '/wealth/products')
  await page.getByRole('button', { name: '匹配推荐', exact: true }).click()
  dialog = page.getByRole('dialog', { name: '匹配推荐', exact: true })
  await dialog.getByRole('button', { name: '按条件匹配', exact: true }).click()
  await dialog.getByText(/匹配 1 款/).waitFor()
  await dialog.getByText(/符合当前风险测评/).waitFor()
  assert.equal(mutations.filter(row => row.pathname === '/api/wealth/subscribe').length, 0)
  await dialog.screenshot({ path: path.join(output, 'recommend.png') })
  await page.goto(base + '/wealth/holdings')
  await page.getByRole('button', { name: '赎回', exact: true }).click()
  dialog = page.getByRole('dialog', { name: '赎回', exact: true })
  const fees = Math.round(10000 * equity.nav * 0.005), gross = Math.round(20000 * equity.nav)
  await dialog.getByText(`¥${(fees / 100).toFixed(2)}`, { exact: true }).waitFor()
  await dialog.getByRole('button', { name: '确认赎回', exact: true }).click()
  dialog = page.getByRole('dialog', { name: '演示赎回已完成', exact: true })
  await dialog.getByText('演示资金已即时到账', { exact: true }).waitFor()
  assert.equal(db.accounts[0].available, balance + gross - fees); assert.equal(db.holdings.length, 0)
  await dialog.screenshot({ path: path.join(output, 'redeemed.png') })
  for (const width of [1440, 1024]) { await page.setViewportSize({ width, height: 1100 }); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `overflow at ${width}`) }
  assert.deepEqual(errors, [])
  console.log('PASS 理财UI：透明推荐理由→不产生申购→按批次收正确赎回费→即时到账回执与余额一致；1440/1024无溢出')
} finally { await browser?.close(); await web.close() }
