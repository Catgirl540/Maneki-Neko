/** Web reminders mirror changes from another channel; isolated API fixtures, no real IM/model. */
import assert from 'node:assert/strict'
import { createServer } from '../app/node_modules/vite/dist/node/index.js'
import { chromium } from 'playwright-core'

const root = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
Object.assign(process.env, { VITE_USE_MOCK: 'false', VITE_AGENT_ENABLED: 'false', VITE_BASE_PATH: '/', VITE_API_BASE_URL: '', VITE_AGENT_URL: '/agent-api' })
const web = await createServer({ root: decodeURIComponent(root) + 'app', configFile: decodeURIComponent(root) + 'app/vite.config.ts', logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false } })
const users = {
  alice: { id: 'alice', name: '本地甲', phone: '13800138000', memberTier: 'standard' },
  bob: { id: 'bob', name: '本地乙', phone: '13900139000', memberTier: 'standard' },
}
const bindings = owner => [{ id: `im-${owner}`, label: `微信私聊 · ${owner}`, sessionId: `session-${owner}`, connected: true }]
const reminder = (id, title) => ({ id, title, bindingId: 'im-alice', dueAt: new Date(Date.now() + 3600000).toISOString(), status: 'scheduled' })
const state = { alice: [reminder('rem-alice', '甲初始提醒')], bob: [reminder('rem-bob', '乙自己的提醒')] }
const active = new Map(), maximum = new Map(), reads = [], writes = [], gates = new Map()
let browser, closing = false, reminderFailure = false
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
try {
  await web.listen()
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
  page.setDefaultTimeout(15000)
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.clock.install()
  await page.addInitScript(user => {
    if (!sessionStorage.getItem('luckycat.token')) {
      sessionStorage.setItem('luckycat.token', JSON.stringify('alice-token'))
      sessionStorage.setItem('luckycat.session.user', JSON.stringify(user))
    }
  }, users.alice)
  await page.route('**/agent-api/**', async route => {
    if (closing) return route.abort()
    const request = route.request(), path = new URL(request.url()).pathname
    const respond = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    if (!path.startsWith('/agent-api/im/')) return respond({ error: 'fixture agent disabled' }, 503)
    const owner = request.headers().authorization === 'Bearer alice-token' ? 'alice' : request.headers().authorization === 'Bearer bob-token' ? 'bob' : undefined
    if (!owner) return respond({ error: 'login required' }, 401)
    if (request.method() !== 'GET') { writes.push(path); return respond({ error: 'fixture does not allow writes' }, 400) }
    assert(!path.endsWith('/pending'), 'withdrawn pending-action interface must not be called')
    const key = `${owner}:${path}`
    reads.push(key); active.set(key, (active.get(key) ?? 0) + 1); maximum.set(key, Math.max(maximum.get(key) ?? 0, active.get(key)))
    try {
      if (path.endsWith('/bindings')) return await respond(bindings(owner))
      if (path.endsWith('/reminders')) {
        const snapshot = structuredClone(state[owner]), fail = reminderFailure
        const gate = gates.get(key)
        if (gate) { gates.delete(key); gate.entered.resolve(); await gate.release.promise }
        if (gate?.unauthorized) return await respond({ error: '旧客户令牌失效', code: 'UNAUTHORIZED' }, 401)
        if (fail) return await respond({ error: '临时读取失败', code: 'SESSION_STORE_UNAVAILABLE' }, 503)
        return await respond({ bindings: bindings(owner), reminders: snapshot, historyMayBeTruncated: false, limit: 100 })
      }
      return await respond({ error: 'unexpected fixture route' }, 404)
    } catch (error) { if (!closing) throw error }
    finally { active.set(key, active.get(key) - 1) }
  })
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (!path.startsWith('/api/')) return route.continue()
    const respond = data => route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) })
    if (path === '/api/auth/login') return respond({ token: 'bob-token', user: users.bob })
    if (path === '/api/auth/sms-code') return respond({ sent: true, demoCode: '123456' })
    if (path === '/api/security/overview') return respond({ logs: [], devices: [], riskRules: [] })
    if (path === '/api/support/messages') return respond([])
    if (path === '/api/auth/profile') return respond(route.request().headers().authorization === 'Bearer bob-token' ? users.bob : users.alice)
    return respond({})
  })
  const base = `http://127.0.0.1:${web.httpServer.address().port}`
  await page.goto(base + '/assistant?view=im', { waitUntil: 'domcontentloaded' })
  const history = page.getByRole('region', { name: '提醒记录', exact: true })
  await history.getByText('甲初始提醒', { exact: true }).waitFor()
  assert.equal(await page.getByRole('heading', { name: '待确认事项', exact: true }).count(), 0)
  const title = page.getByLabel('提醒内容', { exact: true }), time = page.getByLabel('提醒时间（北京时间）', { exact: true })
  await title.fill('尚未提交的网页草稿')
  const originalTime = await time.inputValue()
  state.alice.push(reminder('rem-wechat', '微信新建的提醒'))
  await page.clock.fastForward(15001)
  await history.getByText('微信新建的提醒', { exact: true }).waitFor()
  assert.equal(await title.inputValue(), '尚未提交的网页草稿'); assert.equal(await time.inputValue(), originalTime)
  state.alice.find(r => r.id === 'rem-wechat').status = 'cancelled'
  await page.clock.fastForward(15001)
  await history.getByText('已取消', { exact: true }).waitFor()
  console.log('PASS 微信侧创建/取消由定时读取自动同步，网页草稿和时间不被覆盖，不挂载撤回的待确认面板')

  state.alice.push(reminder('rem-focus', '返回页面后显示'))
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await history.getByText('返回页面后显示', { exact: true }).waitFor()
  const gate = { entered: deferred(), release: deferred() }
  gates.set('alice:/agent-api/im/reminders', gate)
  await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await gate.entered.promise
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')); document.dispatchEvent(new Event('visibilitychange')) })
  state.alice.push(reminder('rem-after-gate', '串行刷新最新提醒'))
  await page.getByRole('button', { name: '刷新提醒记录', exact: true }).click()
  gate.release.resolve()
  await history.getByText('串行刷新最新提醒', { exact: true }).waitFor()
  assert([...maximum.values()].every(n => n <= 1))
  console.log('PASS 返回前台立即读取，焦点/网络/手工刷新并发触发时同一接口不重叠，手工刷新读取最新数据')

  reminderFailure = true
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await page.getByText(/提醒同步失败：临时读取失败/).waitFor()
  assert.equal(await title.inputValue(), '尚未提交的网页草稿')
  assert(await history.getByText('串行刷新最新提醒', { exact: true }).isVisible())
  assert(await page.getByRole('button', { name: '核对提醒', exact: true }).isDisabled())
  reminderFailure = false
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await page.getByText(/提醒同步失败：临时读取失败/).waitFor({ state: 'hidden' })
  assert.equal(await title.inputValue(), '尚未提交的网页草稿')
  assert(await page.getByRole('button', { name: '核对提醒', exact: true }).isEnabled())
  console.log('PASS 后台读取失败显示上次结果和真实错误、禁用未同步操作；恢复后草稿仍在且可继续操作')

  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')) })
  const readsWhileHidden = reads.length
  state.alice.push(reminder('rem-visible', '重新可见的提醒'))
  await page.clock.fastForward(45001)
  assert.equal(reads.length, readsWhileHidden)
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')) })
  await history.getByText('重新可见的提醒', { exact: true }).waitFor()
  console.log('PASS 后台隐藏页不轮询，恢复可见时立即获取新提醒')

  const stale = { entered: deferred(), release: deferred(), unauthorized: true }
  gates.set('alice:/agent-api/im/reminders', stale)
  await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await stale.entered.promise
  await page.evaluate(() => window.dispatchEvent(new Event('luckycat:auth-expired')))
  await page.getByRole('textbox', { name: '手机号', exact: true }).fill(users.bob.phone)
  await page.locator('input[autocomplete="current-password"]').fill('123456')
  await page.getByRole('textbox', { name: '短信验证码', exact: true }).fill('123456')
  await page.getByRole('button', { name: '登入', exact: true }).click()
  await history.getByText('乙自己的提醒', { exact: true }).waitFor()
  stale.release.resolve()
  await page.waitForTimeout(80)
  assert.equal(await history.getByText('甲初始提醒', { exact: true }).count(), 0)
  assert.equal(await title.inputValue(), '')
  assert.equal(await history.getByText('乙自己的提醒', { exact: true }).count(), 1)
  assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem('luckycat.token'))), 'bob-token')
  assert.equal(writes.length, 0); assert.deepEqual(errors, [])
  console.log('PASS 换登录客户后清空上一个客户草稿，旧客户晚到401不能覆盖或登出新客户；仅自动GET，零页面异常')
} finally {
  closing = true
  await browser?.close(); await web.close()
}
