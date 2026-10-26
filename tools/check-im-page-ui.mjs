/**
 * 助手内 IM 视图（`/assistant?view=im`）的浏览器回归，`/reminders` 保留深链兼容跳转。
 * 只启动网页前端，IM 与银行接口全用测试响应。
 *
 * 不启动桥接服务、不连微信、不连银行：`/agent-api/im/**` 由内存状态伪造（绑定码、
 * 绑定列表、提醒增删、未启用 503），壳层需要的 `/api/**` 只给最小集合。
 * 断言页面行为：扫码断点续扫、绑定码核对与绑定、提醒创建与取消、多绑定逐条解除、
 * 未启用/故障状态；不把连接状态读取失败谎报为未连接，全程没有页面运行异常。
 *
 *   CHROME_PATH=/snap/bin/chromium node tools/check-im-page-ui.mjs
 */

import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdir } from 'node:fs/promises'
import { loadImVendor } from '../framework/bridge/im-channels.mjs'
import { createServer } from '../app/node_modules/vite/dist/node/index.js'
import { chromium } from 'playwright-core'

const root = path.resolve(import.meta.dirname, '..')
Object.assign(process.env, {
  VITE_USE_MOCK: 'false',
  VITE_BASE_PATH: '/',
  VITE_API_BASE_URL: '',
  VITE_AGENT_URL: '/agent-api',
})
const web = await createServer({
  root: path.join(root, 'app'),
  configFile: path.join(root, 'app/vite.config.ts'),
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 0, hmr: false },
})

const fixtureQrImage = await (await loadImVendor()).qrImage('fixture:weixin-test-only')
const user = { id: 'fixture-user', name: '测试客户', phone: '13900139000', memberTier: 'standard', avatarInitial: '测' }
/** 内存里的 IM 状态：绑定码 → 来源、绑定列表、提醒列表。 */
const im = { codes: new Map(), bindings: [], reminders: [], disabled: false, outage: false, truncated: false, nextReminder: 0, qr: null, qrStarts: 0, writes: [], reads: [], failures: new Map(), previewGates: new Map() }
const issueCode = label => {
  const code = `fixture-code-${im.codes.size + 1}`
  im.codes.set(code, { label, expiresAt: Date.now() + 600_000 })
  return code
}
let browser
const errors = []
try {
  await web.listen()
  const base = `http://127.0.0.1:${web.httpServer.address().port}`
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
  page.setDefaultTimeout(12000)
  async function capture(name, section) {
    await page.locator('main .business-scroll:visible').first().evaluate((element, section) => {
      const target = section ? document.querySelector(section) : null
      element.scrollTop = target ? element.scrollTop + target.getBoundingClientRect().top - element.getBoundingClientRect().top : 0
    }, section)
    await page.screenshot({ path: path.join(root, `.generated/local-postgres/${name}-20261023.png`), animations: 'disabled' })
  }
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(user => {
    sessionStorage.setItem('luckycat.token', JSON.stringify('fixture-token'))
    sessionStorage.setItem('luckycat.session.user', JSON.stringify(user))
  }, user)

  // 除 IM 之外的 agent 通道（助手探测、语音等）在纯前端部署里就是不可用。
  await page.route('**/agent-api/**', route =>
    route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'agent 未启动' }) }))

  await page.route('**/agent-api/im/**', async route => {
    const request = route.request()
    const method = request.method()
    const path = new URL(request.url()).pathname.replace(/^\/agent-api\/im/, '')
    assert.equal(request.headers().authorization, 'Bearer fixture-token')
    // DELETE 可以没有正文，`postDataJSON()` 在空正文上会直接抛错。
    const raw = method === 'GET' ? null : request.postData()
    let body = null
    if (raw) {
      try { body = JSON.parse(raw) }
      catch { body = null }
    }
    const respond = (data, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    if (im.outage) return respond({ error: '会话持久化服务不可用，请稍后重试', code: 'SESSION_STORE_UNAVAILABLE' }, 503)
    if (method === 'GET') im.reads.push(path)
    if (method !== 'GET') im.writes.push({ method, path, body })
    const failureKey = `${method} ${path}`
    if (im.failures.has(failureKey)) {
      const message = im.failures.get(failureKey)
      im.failures.delete(failureKey)
      return respond({ error: message, code: 'FIXTURE_TEMPORARY_FAILURE' }, 503)
    }
    if (path === '/weixin/qr' && method === 'POST') {
      im.qr = { attemptId: 'fixture-qr-' + ++im.qrStarts, status: 'pending', qrImage: fixtureQrImage, expiresAt: Date.now() + 300000 }
      return respond(im.qr)
    }
    if (path.startsWith('/weixin/qr/')) {
      if (!im.qr || !path.startsWith('/weixin/qr/' + im.qr.attemptId)) return respond({ error: '扫码任务不存在' }, 404)
      if (path.endsWith('/verify')) { assert.equal(body.code, '123456'); im.qr.status = 'scanned' }
      if (path.endsWith('/cancel')) im.qr.status = 'cancelled'
      if (path.endsWith('/confirm')) {
        assert.equal(body.confirmed, true); assert.equal(im.qr.status, 'connected')
        const binding = { id: 'im-fixture-qr', label: '微信私聊 · QR01', sessionId: 's-qr', connected: true }
        im.bindings.push(binding); im.qr.binding = binding; return respond(binding)
      }
      return respond(im.qr)
    }
    if (im.disabled && path.startsWith('/reminders')) return respond({ error: '微信提醒尚未启用' }, 503)
    if (method === 'GET' && path === '/bindings') return respond(im.bindings)
    if (method === 'DELETE' && path.startsWith('/bindings/')) {
      const id = decodeURIComponent(path.slice('/bindings/'.length))
      im.bindings = im.bindings.filter(binding => binding.id !== id)
      return respond({ ok: true })
    }
    if (method === 'POST' && path === '/preview') {
      const pending = im.codes.get(body.code)
      if (!pending || pending.expiresAt <= Date.now()) return respond({ error: '绑定码不存在或已过期' }, 404)
      // 调用方可控制旧核对响应何时抵达，验证它不能覆盖新 hash 来源。
      if (im.previewGates.has(body.code)) await im.previewGates.get(body.code)
      return respond(pending)
    }
    if (method === 'POST' && path === '/claim') {
      const pending = im.codes.get(body.code)
      if (!pending || pending.expiresAt <= Date.now()) return respond({ error: '绑定码不存在或已过期' }, 404)
      im.codes.delete(body.code)
      const binding = { id: `im-fixture-${im.bindings.length + 1}`, label: pending.label, sessionId: `s-${im.bindings.length + 1}`, connected: true }
      if (pending.request) binding.continuation = { token: 'r'.repeat(32), request: pending.request, expiresAt: Date.now() + 600000 }
      im.bindings.push(binding)
      return respond({ id: binding.id, sessionId: binding.sessionId, label: binding.label, ...(binding.continuation ? { continuation: binding.continuation } : {}) })
    }
    if (method === 'POST' && path === '/continue') {
      assert.equal(body.confirmed, true)
      const binding = im.bindings.find(item => item.continuation?.token === body.token)
      if (!binding) return respond({ error: '请求已处理或已过期' }, 404)
      delete binding.continuation
      return respond({ id: binding.id, sessionId: binding.sessionId, started: true })
    }
    if (path === '/reminders' && method === 'GET') return respond({
      bindings: im.bindings.filter(binding => binding.connected).map(({ id, label }) => ({ id, label })),
      reminders: im.reminders,
      limit: 100,
      historyMayBeTruncated: im.truncated,
    })
    if (path === '/reminders' && method === 'POST') {
      if (body.confirmed !== true) return respond({ error: '请先核对并确认提醒操作' }, 400)
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/.test(body.dueAt)) return respond({ error: '提醒时间须带东八区偏移' }, 400)
      const reminder = { id: `rem-fixture-${++im.nextReminder}`, title: body.title, dueAt: new Date(body.dueAt).toISOString(), status: 'scheduled', bindingId: body.bindingId }
      im.reminders.unshift(reminder)
      return respond(reminder)
    }
    if (method === 'DELETE' && path.startsWith('/reminders/')) {
      const reminder = im.reminders.find(item => item.id === decodeURIComponent(path.slice('/reminders/'.length)))
      if (!reminder) return respond({ error: '提醒不存在或不属于当前客户' }, 404)
      if (body?.confirmed !== true || typeof body?.requestId !== 'string') return respond({ error: '请先核对并确认提醒操作' }, 400)
      reminder.status = 'cancelled'
      return respond(reminder)
    }
    return respond({ error: '测试未提供此接口' }, 404)
  })

  // 壳层（侧栏通知、底部助手）需要的最小银行接口。
  await page.route('**/api/**', route => {
    const request = route.request()
    // 只看真正的 `/api/` 接口：Vite 开发服务器的模块路径里也有 `src/api/`。
    if (!new URL(request.url()).pathname.startsWith('/api/')) return route.continue()
    const respond = (data, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    switch (new URL(request.url()).pathname) {
      case '/api/security/overview': return respond({ logs: [], devices: [], riskRules: [], score: 80, level: '基础防护' })
      case '/api/support/messages': return respond([])
      default: return respond({ message: '测试未提供此接口' }, 404)
    }
  })

  await mkdir(path.join(root, '.generated/local-postgres'), { recursive: true })
  await page.goto(`${base}/reminders`)
  await page.waitForURL(url => url.pathname === '/assistant' && url.searchParams.get('view') === 'im')
  assert.equal(new URL(page.url()).pathname, '/assistant')
  assert.equal(new URL(page.url()).searchParams.get('view'), 'im')
  await page.getByRole('heading', { name: '连接状态', exact: true }).waitFor()
  await page.getByRole('heading', { name: '微信扫码连接', exact: true }).waitFor()
  await page.getByRole('heading', { name: '提醒', exact: true }).waitFor()
  assert.equal(await page.getByRole('tab', { name: 'IM 连接', exact: true }).getAttribute('aria-selected'), 'true')
  assert.equal(
    await page.getByRole('navigation', { name: '桌面主导航' }).getByRole('link', { name: '智能助手', exact: true }).getAttribute('aria-current'),
    'page',
  )
  const manualToggle = page.getByRole('button', { name: '使用绑定码连接', exact: false })
  assert.equal(await manualToggle.getAttribute('aria-expanded'), 'false')
  assert.equal(await page.getByLabel('绑定码', { exact: true }).isVisible(), false)
  assert(await page.getByRole('button', { name: '生成微信连接二维码', exact: true }).isVisible())
  assert.equal(im.qrStarts, 0)
  await capture('im-ui-idle')
  await manualToggle.press('Enter')
  assert(await page.getByLabel('绑定码', { exact: true }).isVisible())
  await manualToggle.press('Space')
  assert.equal(await page.getByLabel('绑定码', { exact: true }).isVisible(), false)
  console.log('PASS /reminders 兼容跳转助手 IM 视图，助手入口高亮；绑定码默认折叠且支持键盘，不自动创建二维码')

  const code = issueCode('微信私聊 · 8001')
  // 从微信里的链接打开：`#code=` 预填并自动核对。
  await page.goto(`${base}/reminders#code=${code}`)
  await page.waitForURL(url => url.pathname === '/assistant' && url.searchParams.get('view') === 'im' && url.hash === `#code=${code}`)
  assert.equal(new URL(page.url()).pathname, '/assistant')
  assert.equal(new URL(page.url()).hash, `#code=${code}`)
  await page.getByRole('heading', { name: '连接状态', exact: true }).waitFor()
  await page.getByRole('heading', { name: '私聊绑定', exact: true }).waitFor()
  await page.getByRole('heading', { name: '提醒', exact: true }).waitFor()
  assert.equal(
    await page.getByRole('navigation', { name: '桌面主导航' }).getByRole('link', { name: '智能助手', exact: true }).getAttribute('aria-current'),
    'page',
  )
  const codeInput = page.getByLabel('绑定码', { exact: true })
  assert.equal(await codeInput.inputValue(), code)
  assert.equal(await manualToggle.getAttribute('aria-expanded'), 'true')
  await page.getByText('来源：微信私聊 · 8001', { exact: true }).waitFor()
  const previewText = await page.locator('main').innerText()
  assert(previewText.includes('有效至'))
  assert(previewText.includes('（北京时间）'))
  assert(previewText.includes('还没有绑定 IM 私聊'))
  assert.equal(im.bindings.length, 0)
  assert.equal(im.qrStarts, 0)
  await page.getByRole('button', { name: '生成微信连接二维码', exact: true }).click()
  const image = page.getByRole('img', { name: '微信连接二维码', exact: true })
  await image.waitFor()
  assert((await image.getAttribute('src')).startsWith('data:image/png;base64,'))
  assert.equal(page.context().pages().length, 1)
  assert.equal(im.bindings.length, 0)
  await manualToggle.click()
  await mkdir(path.join(root, '.generated/local-postgres'), { recursive: true })
  await capture('weixin-inline-qr')
  await manualToggle.click()
  assert.equal(await codeInput.inputValue(), code)

  // IM 并入助手后，切换视图会卸载扫码组件：恢复必须取回原任务，不能消耗新的扫码额度。
  const originalAttempt = im.qr.attemptId
  const startsBeforeViewChange = im.qrStarts
  await page.getByRole('tab', { name: '对话', exact: true }).click()
  await image.waitFor({ state: 'hidden' })
  assert.equal(await image.count(), 0)
  assert.equal(await page.getByRole('tab', { name: '对话', exact: true }).getAttribute('aria-selected'), 'true')
  await page.getByRole('tab', { name: 'IM 连接', exact: true }).click()
  await image.waitFor()
  assert.equal(im.qr.attemptId, originalAttempt)
  assert.equal(im.qrStarts, startsBeforeViewChange)
  await page.reload()
  await image.waitFor()
  assert.equal(im.qr.attemptId, originalAttempt)
  assert.equal(im.qrStarts, startsBeforeViewChange)
  console.log('PASS 扫码期间切换对话/IM 与刷新均恢复原二维码任务，不重新生成或自动绑定')

  im.qr.status = 'needs_verification'
  await page.getByLabel('扫码验证码', { exact: true }).fill('123456')
  await page.getByRole('button', { name: '提交扫码验证码', exact: true }).click()
  await page.getByText('已扫码，请在微信中确认登录', { exact: true }).waitFor()
  im.qr.status = 'connected'
  await page.getByRole('button', { name: '确认绑定此微信到当前账户', exact: true }).waitFor()
  assert.equal(im.bindings.length, 0)
  await page.getByRole('button', { name: '确认绑定此微信到当前账户', exact: true }).click()
  await page.locator('.im-status-line').filter({ hasText: '微信私聊 · QR01' }).waitFor()
  assert.equal(await page.getByRole('heading', { name: '微信扫码连接', exact: true }).count(), 0)
  assert.equal(im.bindings.length, 1)
  assert.equal(im.writes.filter(w => w.path.endsWith('/confirm')).length, 1)
  assert.equal(im.writes.filter(w => w.path.startsWith('/admin/')).length, 0)
  await capture('im-ui-bound')
  console.log('PASS 本页展示真实生成的夹具二维码：扫码验证码 → 手机确认 → 银行绑定确认；不跳转、不使用运维权限，不提前绑定')
  // Reset only the memory fixture before exercising the independent legacy binding-code flow.
  im.bindings = []
  await page.goto(`${base}/reminders#code=${code}`)
  await page.getByText('来源：微信私聊 · 8001', { exact: true }).waitFor()
  await page.getByRole('button', { name: '生成微信连接二维码', exact: true }).waitFor()
  console.log('PASS 旧 /reminders 深链保留 hash，集成视图包含私聊绑定和提醒，绑定码预填并自动核对来源')

  await page.getByRole('button', { name: '确认绑定到当前银行账户', exact: true }).click()
  await page.locator('.im-status-line').filter({ hasText: '微信私聊 · 8001' }).waitFor()
  assert.equal(im.bindings.length, 1)
  assert.equal(await codeInput.inputValue(), '')
  assert(!page.url().includes('code='))
  await page.getByLabel('接收微信', { exact: true }).waitFor()
  assert.equal(await page.getByLabel('接收微信', { exact: true }).locator('option').count(), 1)
  console.log('PASS 确认绑定后列表出现该私聊，绑定码被清空且不留在地址栏，提醒表单随绑定出现')

  await codeInput.fill('expired-fixture-code')
  await page.getByRole('button', { name: '核对来源', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: '此绑定码已使用或已过期' }).waitFor()
  assert.equal(im.bindings.length, 1)
  console.log('PASS 无效绑定码就地提示已使用或已过期，不产生绑定')

  const titleInput = page.getByLabel('提醒内容', { exact: true })
  const whenInput = page.getByLabel('提醒时间（北京时间）', { exact: true })
  assert.match(await whenInput.inputValue(), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
  const futureWhen = await whenInput.inputValue()
  await titleInput.fill('查看理财到期情况')
  await whenInput.fill('2020-01-01T09:00')
  await page.getByRole('button', { name: '核对提醒', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: '提醒时间需在 15 秒后至未来 365 天内' }).waitFor()
  assert.equal(await page.getByText('请核对这条提醒', { exact: true }).count(), 0)
  assert.equal(im.writes.filter(write => write.method === 'POST' && write.path === '/reminders').length, 0)
  await whenInput.fill(futureWhen)
  await page.getByRole('button', { name: '核对提醒', exact: true }).click()
  await page.getByText('请核对这条提醒', { exact: true }).waitFor()
  const reviewText = await page.locator('main').innerText()
  assert(reviewText.includes('查看理财到期情况'))
  assert(reviewText.includes('（北京时间）'))
  assert(reviewText.includes('微信私聊 · 8001'))
  assert(reviewText.includes('不查询账户或执行交易'))
  assert.equal(im.reminders.length, 0)
  im.failures.set('POST /reminders', '测试：提醒创建暂不可用')
  await page.getByRole('button', { name: '确认创建', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: '测试：提醒创建暂不可用' }).waitFor()
  assert.equal(im.reminders.length, 0)
  assert(await page.getByText('请核对这条提醒', { exact: true }).isVisible())
  await page.getByRole('button', { name: '确认创建', exact: true }).click()
  await page.getByText('等待发送', { exact: true }).waitFor()
  assert.equal(im.reminders.length, 1)
  const created = im.writes.find(write => write.method === 'POST' && write.path === '/reminders').body
  assert.equal(created.confirmed, true)
  assert.match(created.dueAt, /\+08:00$/)
  assert.match(created.requestId, /^[0-9a-f-]{36}$/)
  const createRequests = im.writes.filter(write => write.method === 'POST' && write.path === '/reminders')
  assert.equal(createRequests.length, 2)
  assert.equal(createRequests[0].body.requestId, createRequests[1].body.requestId)
  console.log('PASS 过去时间本地拒绝，核对后创建携 confirmed/requestId/东八区时间；失败保留核对与相同请求编号，成功才显示等待发送')
  await page.getByRole('heading', { name: '提醒', exact: true }).scrollIntoViewIfNeeded()
  await capture('im-ui-reminder', '.im-reminders-card')

  // 机器人离线仍在等待：附注说明尚未发送；历史被截断时提示只显示最近 100 条。
  for (const width of [1920, 1440, 1280, 1024]) {
    await page.setViewportSize({ width, height: 1100 })
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `/assistant?view=im 在 ${width}px 溢出`)
  }
  await page.setViewportSize({ width: 1440, height: 1100 })
  console.log('PASS 1920/1440/1280/1024px 无横向溢出')

  im.reminders[0].errorCode = 'BOT_OFFLINE'
  im.truncated = true
  await page.reload()
  await page.getByText('机器人离线，等待恢复；尚未发送。', { exact: true }).waitFor()
  await page.getByText('仅显示最近 100 条提醒。', { exact: true }).waitFor()
  await page.getByText('等待发送', { exact: true }).waitFor()
  console.log('PASS 机器人离线附注「尚未发送」，截断字段提示只显示最近 100 条')

  await page.getByRole('button', { name: '取消提醒', exact: true }).click()
  await page.getByText('确认取消这条未发送的提醒？此操作不取消银行交易或商户订阅。', { exact: true }).waitFor()
  assert.equal(im.reminders[0].status, 'scheduled')
  im.failures.set(`DELETE /reminders/${im.reminders[0].id}`, '测试：取消提醒暂不可用')
  await page.getByRole('button', { name: '确认取消', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: '测试：取消提醒暂不可用' }).waitFor()
  assert.equal(im.reminders[0].status, 'scheduled')
  assert(await page.getByRole('button', { name: '确认取消', exact: true }).isVisible())
  await page.getByRole('button', { name: '确认取消', exact: true }).click()
  await page.getByText('已取消', { exact: true }).waitFor()
  assert.equal(im.reminders[0].status, 'cancelled')
  const cancelled = im.writes.filter(write => write.method === 'DELETE' && write.path.startsWith('/reminders/')).at(-1)
  assert.equal(cancelled.body.confirmed, true)
  assert.match(cancelled.body.requestId, /^[0-9a-f-]{36}$/)
  console.log('PASS 取消提醒先确认，接口失败保留等待发送和重试入口；成功后才变已取消，DELETE 带 confirmed 与请求编号')

  // 服务端可能同时返回历史微信/企微及失效会话，页面不能只展示仍在线的一条。
  im.bindings.push(
    { id: 'im-fixture-other', label: '微信私聊 · 第二连接', sessionId: 's-other', connected: true },
    { id: 'im-fixture-stale', label: '企微私聊 · 已失效', sessionId: 's-stale', connected: false },
  )
  await page.reload()
  const otherRow = page.locator('.im-status-line').filter({ hasText: '微信私聊 · 第二连接' })
  const staleRow = page.locator('.im-status-line').filter({ hasText: '企微私聊 · 已失效' })
  await otherRow.waitFor()
  await staleRow.waitFor()
  assert.equal(await page.getByRole('button', { name: '解除绑定', exact: true }).count(), 3)
  assert.equal(await page.getByLabel('接收微信', { exact: true }).locator('option').count(), 2)
  assert.equal(await page.getByRole('heading', { name: '微信扫码连接', exact: true }).count(), 0)
  await page.getByRole('button', { name: '添加/重新连接', exact: true }).click()
  await page.getByRole('heading', { name: '微信扫码连接', exact: true }).waitFor()
  await page.getByRole('button', { name: '收起扫码', exact: true }).click()
  await page.getByRole('heading', { name: '微信扫码连接', exact: true }).waitFor({ state: 'hidden' })
  assert.equal(await page.getByRole('heading', { name: '微信扫码连接', exact: true }).count(), 0)
  const beforeRevoke = im.writes.filter(write => write.method === 'DELETE' && write.path.startsWith('/bindings/')).length
  await staleRow.getByRole('button', { name: '解除绑定', exact: true }).click()
  const staleDialog = page.getByRole('dialog', { name: '解除 IM 绑定', exact: true })
  await staleDialog.waitFor()
  assert((await staleDialog.innerText()).includes('企微私聊 · 已失效'))
  await staleDialog.getByRole('button', { name: '关闭弹窗', exact: true }).click()
  await staleDialog.waitFor({ state: 'hidden' })
  assert.equal(im.bindings.length, 3)
  assert.equal(im.writes.filter(write => write.method === 'DELETE' && write.path.startsWith('/bindings/')).length, beforeRevoke)
  await staleRow.getByRole('button', { name: '解除绑定', exact: true }).click()
  await staleDialog.getByRole('button', { name: '确认解除', exact: true }).click()
  await staleRow.waitFor({ state: 'hidden' })
  assert.equal(im.bindings.length, 2)
  assert.equal(im.writes.filter(write => write.method === 'DELETE' && write.path.startsWith('/bindings/')).at(-1).path, '/bindings/im-fixture-stale')
  await otherRow.getByRole('button', { name: '解除绑定', exact: true }).click()
  const otherDialog = page.getByRole('dialog', { name: '解除 IM 绑定', exact: true })
  await otherDialog.waitFor()
  assert((await otherDialog.innerText()).includes('微信私聊 · 第二连接'))
  await otherDialog.getByRole('button', { name: '确认解除', exact: true }).click()
  await otherRow.waitFor({ state: 'hidden' })
  assert.equal(im.bindings.length, 1)
  await page.getByLabel('接收微信', { exact: true }).locator('option').filter({ hasText: '微信私聊 · 第二连接' }).waitFor({ state: 'hidden' })
  assert.equal(await page.getByLabel('接收微信', { exact: true }).locator('option').count(), 1)
  console.log('PASS 多条连接逐条管理，失效绑定仍可解除；取消弹窗不写接口，解除只移除所选绑定并刷新提醒接收目标')

  await page.getByRole('button', { name: '解除绑定', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '解除 IM 绑定', exact: true })
  await dialog.waitFor()
  assert((await dialog.innerText()).includes('旧提醒也会停止发送'))
  assert.equal(im.bindings.length, 1)
  im.failures.set(`DELETE /bindings/${im.bindings[0].id}`, '测试：解除绑定暂不可用')
  await dialog.getByRole('button', { name: '确认解除', exact: true }).click()
  await dialog.getByRole('alert').filter({ hasText: '测试：解除绑定暂不可用' }).waitFor()
  assert.equal(im.bindings.length, 1)
  assert(await dialog.isVisible())
  await dialog.getByRole('button', { name: '确认解除', exact: true }).click()
  await page.getByText('还没有绑定 IM 私聊', { exact: true }).waitFor()
  assert.equal(im.bindings.length, 0)
  await page.getByText('请先在上方绑定本人微信私聊，再创建提醒。', { exact: true }).waitFor()
  console.log('PASS 解除绑定需二次确认，失败保留绑定和重试弹窗；成功才移除私聊，提醒表单回到先绑定提示')

  im.bindings = [{ id: 'im-only-stale', label: '微信私聊 · 仅余失效连接', sessionId: 's-stale-only', connected: false }]
  await page.reload()
  const onlyStaleRow = page.locator('.im-status-line').filter({ hasText: '微信私聊 · 仅余失效连接' })
  await onlyStaleRow.waitFor()
  await page.getByRole('heading', { name: '微信扫码连接', exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '解除绑定', exact: true }).count(), 1)
  assert.equal(await page.getByLabel('接收微信', { exact: true }).count(), 0)
  await onlyStaleRow.getByRole('button', { name: '解除绑定', exact: true }).click()
  const onlyStaleDialog = page.getByRole('dialog', { name: '解除 IM 绑定', exact: true })
  await onlyStaleDialog.waitFor()
  await onlyStaleDialog.getByRole('button', { name: '确认解除', exact: true }).click()
  await onlyStaleRow.waitFor({ state: 'hidden' })
  assert.equal(im.bindings.length, 0)
  console.log('PASS 仅余失效连接仍显示解绑和重新扫码，不把它当作可接收提醒的在线私聊')

  im.disabled = true
  await page.goto(`${base}/reminders`)
  await page.getByText('提醒尚未启用', { exact: true }).waitFor()
  assert.equal(await page.getByRole('alert').count(), 0)
  assert(await page.getByRole('heading', { name: '连接状态', exact: true }).isVisible())
  console.log('PASS 提醒接口 503 时显示「提醒尚未启用」空态，不出现错误红条')

  im.disabled = false; im.outage = true
  await page.reload()
  await page.getByText('IM 服务暂时不可用，连接与提醒状态尚未确认。请稍后重试。', { exact: true }).waitFor()
  assert.equal(await page.getByText('IM 连接尚未启用', { exact: true }).count(), 0)
  assert.equal(await page.getByText('提醒尚未启用', { exact: true }).count(), 0)
  assert.equal(await page.getByRole('button', { name: '生成微信连接二维码', exact: true }).count(), 0)
  im.outage = false
  await page.getByRole('alert').filter({ hasText: 'IM 服务暂时不可用，连接与提醒状态尚未确认。请稍后重试。' }).getByRole('button', { name: '重新加载', exact: true }).click()
  await page.getByRole('heading', { name: '私聊绑定', exact: true }).waitFor()
  await page.getByText('还没有绑定 IM 私聊', { exact: true }).waitFor()
  assert.equal(await page.getByText('IM 服务暂时不可用，连接与提醒状态尚未确认。请稍后重试。', { exact: true }).count(), 0)
  console.log('PASS 会话库 503 显示服务故障，不谎报未启用或创建未知连接；点击重试恢复后可继续扫码')

  await page.getByRole('button', { name: '生成微信连接二维码', exact: true }).click()
  await page.getByRole('img', { name: '微信连接二维码', exact: true }).waitFor()
  await page.getByRole('button', { name: '取消扫码', exact: true }).click()
  await page.getByText('本次扫码已取消', { exact: true }).waitFor()
  await page.getByRole('button', { name: '重新生成二维码', exact: true }).click()
  im.qr.expiresAt = Date.now() - 1000
  await page.getByText('二维码已过期，请重新生成', { exact: true }).waitFor()
  assert.equal(await page.getByRole('img', { name: '微信连接二维码', exact: true }).count(), 0)
  assert.equal(im.bindings.length, 0)
  console.log('PASS 取消与过期均停止展示旧二维码，可重新生成，不产生银行绑定')

  const pendingSession = 'fixture-pending-session'
  await page.goto(`${base}/reminders#session=${pendingSession}`)
  const portalLink = page.getByRole('link', { name: '打开业务确认', exact: true })
  await portalLink.waitFor()
  assert.equal(await portalLink.getAttribute('href'), `/agent-api/im#session=${pendingSession}`)
  assert.equal(im.bindings.length, 0)
  console.log('PASS 微信 #session 待确认深链保留独立业务确认入口，不误导成重新扫码绑定')

  const anotherAttempt = 'fixture-private-qr-owned-by-another-user'
  await page.evaluate(id => {
    sessionStorage.setItem('luckycat.im.wx-attempt:fixture-other-user', id)
    sessionStorage.setItem('luckycat.im.wx-attempt', 'fixture-legacy-unscoped-qr')
  }, anotherAttempt)
  await page.goto(`${base}/assistant?view=im`)
  const generateButton = page.getByRole('button', { name: '生成微信连接二维码', exact: true })
  await generateButton.waitFor()
  assert.equal(await generateButton.isEnabled(), true)
  assert.equal(await page.getByRole('img', { name: '微信连接二维码', exact: true }).count(), 0)
  assert(!im.reads.some(path => path.includes(anotherAttempt) || path.includes('fixture-legacy-unscoped-qr')))
  assert.equal(await page.evaluate(() => sessionStorage.getItem('luckycat.im.wx-attempt')), null)
  console.log('PASS 扫码断点按银行客户隔离：忽略其他客户任务，清理无归属旧缓存，不读取或展示别人的二维码')

  const claimCount = im.writes.filter(write => write.path === '/claim').length
  const hashA = issueCode('微信私聊 · 同页来源 A')
  const hashB = issueCode('微信私聊 · 同页来源 B')
  await page.goto(`${base}/assistant?view=im#code=${hashA}`)
  await page.getByText('来源：微信私聊 · 同页来源 A', { exact: true }).waitFor()
  await page.evaluate(code => { window.location.hash = `code=${code}` }, hashB)
  await page.getByText('来源：微信私聊 · 同页来源 B', { exact: true }).waitFor()
  assert.equal(await codeInput.inputValue(), hashB)
  assert.equal(await page.getByText('来源：微信私聊 · 同页来源 A', { exact: true }).count(), 0)

  const slowHashA = issueCode('微信私聊 · 旧慢响应 A')
  const fastHashB = issueCode('微信私聊 · 新即时来源 B')
  let releaseOldPreview
  im.previewGates.set(slowHashA, new Promise(resolve => { releaseOldPreview = resolve }))
  const isOldPreview = request => new URL(request.url()).pathname === '/agent-api/im/preview'
    && request.method() === 'POST' && request.postDataJSON()?.code === slowHashA
  const oldPreviewRequest = page.waitForRequest(isOldPreview)
  await page.goto(`${base}/assistant?view=im#code=${slowHashA}`)
  await oldPreviewRequest
  await page.evaluate(code => { window.location.hash = `code=${code}` }, fastHashB)
  await page.getByText('来源：微信私聊 · 新即时来源 B', { exact: true }).waitFor()
  assert.equal(await codeInput.inputValue(), fastHashB)
  const oldPreviewResponse = page.waitForResponse(response => isOldPreview(response.request()))
  releaseOldPreview()
  await (await oldPreviewResponse).finished()
  // 让已完成 fetch 的 React 更新经过绘制，再断言慢响应没有把当前来源倒退为 A。
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  assert(await page.getByText('来源：微信私聊 · 新即时来源 B', { exact: true }).isVisible())
  assert.equal(await page.getByText('来源：微信私聊 · 旧慢响应 A', { exact: true }).count(), 0)
  assert.equal(await codeInput.inputValue(), fastHashB)
  assert.equal(im.writes.filter(write => write.path === '/claim').length, claimCount)
  assert.equal(im.bindings.length, 0)
  console.log('PASS 同页 hash A→B 自动重核对新来源；旧 A 慢响应晚到不覆盖 B，不提前绑定或使用过期预览')

  const handoffCode = 'handoff-fixture-code'
  im.codes.set(handoffCode, { label: '微信私聊 · 待续请求', expiresAt: Date.now() + 600000, request: '查看我当前订阅情况' })
  await page.goto(`${base}/reminders#code=${handoffCode}`)
  await page.getByText('本次微信请求：查看我当前订阅情况（尚未开始办理）', { exact: true }).waitFor()
  await page.getByRole('button', { name: '确认绑定到当前银行账户', exact: true }).click()
  await page.getByRole('heading', { name: '继续这次微信请求', exact: true }).waitFor()
  assert.equal(im.writes.filter(item => item.path === '/continue').length, 0)
  await page.reload()
  await page.getByRole('button', { name: '继续这次请求', exact: true }).waitFor()
  await page.route('**/agent-api/im', route => route.fulfill({ contentType: 'text/html', body: '<main>夹具业务确认门户</main>' }))
  await page.getByRole('button', { name: '继续这次请求', exact: true }).click()
  await page.waitForURL(url => url.pathname === '/agent-api/im' && url.hash.startsWith('#session='))
  const continued = im.writes.filter(item => item.path === '/continue')
  assert.equal(continued.length, 1); assert.equal(continued[0].body.confirmed, true)
  console.log('PASS 微信登录恢复请求展示原文，绑定不自动执行；刷新保留本人待续请求，明确继续后才进入原业务确认门户')

  assert(!im.reads.includes('/pending'), 'withdrawn pending-action sync must not be requested')
  assert.deepEqual(errors, [])
  console.log('ALL PASS 助手 IM 集成视图：旧深链、扫码/续扫、绑定码核对/绑定、提醒创建/取消、多绑定/失效绑定解除、未启用/故障状态，无页面运行异常')
  console.log('未连接桥接服务、微信或真实银行；全部接口为测试夹具。')
} finally {
  await browser?.close()
  await web.close()
}
