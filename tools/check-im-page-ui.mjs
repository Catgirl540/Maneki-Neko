/**
 * IM 连接页（`/reminders`）的浏览器回归：只启动网页前端，IM 与银行接口全用测试响应。
 *
 * 不启动桥接服务、不连微信、不连银行：`/agent-api/im/**` 由内存状态伪造（绑定码、
 * 绑定列表、提醒增删、未启用 503），壳层需要的 `/api/**` 只给最小集合。
 * 断言的是页面行为——绑定码核对与绑定、提醒创建与取消、解除绑定二次确认、
 * 未启用空态，以及全程没有页面运行异常。
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
const im = { codes: new Map(), bindings: [], reminders: [], disabled: false, outage: false, truncated: false, nextReminder: 0, qr: null, qrStarts: 0, writes: [] }
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
    if (method !== 'GET') im.writes.push({ method, path, body })
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
      return respond(pending)
    }
    if (method === 'POST' && path === '/claim') {
      const pending = im.codes.get(body.code)
      if (!pending || pending.expiresAt <= Date.now()) return respond({ error: '绑定码不存在或已过期' }, 404)
      im.codes.delete(body.code)
      const binding = { id: `im-fixture-${im.bindings.length + 1}`, label: pending.label, sessionId: `s-${im.bindings.length + 1}`, connected: true }
      im.bindings.push(binding)
      return respond({ id: binding.id, sessionId: binding.sessionId, label: binding.label })
    }
    if (path === '/reminders' && method === 'GET') return respond({
      bindings: im.bindings.map(({ id, label }) => ({ id, label })),
      reminders: im.reminders,
      limit: 100,
      historyMayBeTruncated: im.truncated,
    })
    if (path === '/reminders' && method === 'POST') {
      if (body.confirmed !== true) return respond({ error: '请先核对并确认提醒操作' }, 400)
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/.test(body.dueAt)) return respond({ error: '提醒时间须带东八区偏移' }, 400)
      const reminder = { id: `rem-fixture-${++im.nextReminder}`, title: body.title, dueAt: new Date(body.dueAt).toISOString(), status: 'scheduled' }
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

  const code = issueCode('微信私聊 · 8001')
  // 从微信里的链接打开：`#code=` 预填并自动核对。
  await page.goto(`${base}/reminders#code=${code}`)
  await page.getByRole('heading', { name: 'IM 连接', exact: true }).first().waitFor()
  await page.getByRole('heading', { name: '私聊绑定', exact: true }).waitFor()
  await page.getByRole('heading', { name: '提醒', exact: true }).waitFor()
  assert.equal(
    await page.getByRole('navigation', { name: '桌面主导航' }).getByRole('link', { name: 'IM 连接', exact: true }).getAttribute('aria-current'),
    'page',
  )
  const codeInput = page.getByLabel('绑定码', { exact: true })
  assert.equal(await codeInput.inputValue(), code)
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
  await mkdir(path.join(root, '.generated/local-postgres'), { recursive: true })
  await page.screenshot({ path: path.join(root, '.generated/local-postgres/weixin-inline-qr-20261021.png') })
  im.qr.status = 'needs_verification'
  await page.getByLabel('扫码验证码', { exact: true }).fill('123456')
  await page.getByRole('button', { name: '提交扫码验证码', exact: true }).click()
  await page.getByText('已扫码，请在微信中确认登录', { exact: true }).waitFor()
  im.qr.status = 'connected'
  await page.getByRole('button', { name: '确认绑定此微信到当前账户', exact: true }).waitFor()
  assert.equal(im.bindings.length, 0)
  await page.getByRole('button', { name: '确认绑定此微信到当前账户', exact: true }).click()
  await page.getByText('微信已绑定到当前银行账户', { exact: true }).waitFor()
  assert.equal(im.bindings.length, 1)
  assert.equal(im.writes.filter(w => w.path.endsWith('/confirm')).length, 1)
  assert.equal(im.writes.filter(w => w.path.startsWith('/admin/')).length, 0)
  console.log('PASS 本页展示真实生成的夹具二维码：扫码验证码 → 手机确认 → 银行绑定确认；不跳转、不使用运维权限，不提前绑定')
  // Reset only the memory fixture before exercising the independent legacy binding-code flow.
  im.bindings = []
  await page.goto(`${base}/reminders#code=${code}`)
  await page.getByText('来源：微信私聊 · 8001', { exact: true }).waitFor()
  console.log('PASS /reminders 渲染 IM 连接与提醒两块，侧栏一级入口高亮，hash 绑定码预填并自动核对来源')

  await page.getByRole('button', { name: '确认绑定到当前银行账户', exact: true }).click()
  await page.getByText('已连接', { exact: true }).waitFor()
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
  await titleInput.fill('查看理财到期情况')
  await page.getByRole('button', { name: '核对提醒', exact: true }).click()
  await page.getByText('请核对这条提醒', { exact: true }).waitFor()
  const reviewText = await page.locator('main').innerText()
  assert(reviewText.includes('查看理财到期情况'))
  assert(reviewText.includes('（北京时间）'))
  assert(reviewText.includes('微信私聊 · 8001'))
  assert(reviewText.includes('不查询账户或执行交易'))
  assert.equal(im.reminders.length, 0)
  await page.getByRole('button', { name: '确认创建', exact: true }).click()
  await page.getByText('等待发送', { exact: true }).waitFor()
  assert.equal(im.reminders.length, 1)
  const created = im.writes.find(write => write.method === 'POST' && write.path === '/reminders').body
  assert.equal(created.confirmed, true)
  assert.match(created.dueAt, /\+08:00$/)
  assert.match(created.requestId, /^[0-9a-f-]{36}$/)
  console.log('PASS 核对后确认创建：请求带 confirmed/requestId 与东八区时间，列表显示「等待发送」')

  // 机器人离线仍在等待：附注说明尚未发送；历史被截断时提示只显示最近 100 条。
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: 1100 })
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `/reminders 在 ${width}px 溢出`)
  }
  await page.setViewportSize({ width: 1440, height: 1100 })
  console.log('PASS 1440/1024px 无横向溢出')

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
  await page.getByRole('button', { name: '确认取消', exact: true }).click()
  await page.getByText('已取消', { exact: true }).waitFor()
  assert.equal(im.reminders[0].status, 'cancelled')
  const cancelled = im.writes.filter(write => write.method === 'DELETE' && write.path.startsWith('/reminders/')).at(-1)
  assert.equal(cancelled.body.confirmed, true)
  assert.match(cancelled.body.requestId, /^[0-9a-f-]{36}$/)
  console.log('PASS 取消提醒先出确认，二次确认后状态变「已取消」，DELETE 带 confirmed 与请求编号')

  await page.getByRole('button', { name: '解除绑定', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '解除 IM 绑定', exact: true })
  await dialog.waitFor()
  assert((await dialog.innerText()).includes('旧提醒也会停止发送'))
  assert.equal(im.bindings.length, 1)
  await dialog.getByRole('button', { name: '确认解除', exact: true }).click()
  await page.getByText('还没有绑定 IM 私聊', { exact: true }).waitFor()
  assert.equal(im.bindings.length, 0)
  await page.getByText('请先在上方绑定本人微信私聊，再创建提醒。', { exact: true }).waitFor()
  console.log('PASS 解除绑定需二次确认，确认后列表移除该私聊，提醒表单回到先绑定提示')

  im.disabled = true
  await page.goto(`${base}/reminders`)
  await page.getByText('提醒尚未启用', { exact: true }).waitFor()
  assert.equal(await page.getByRole('alert').count(), 0)
  assert((await page.locator('main').innerText()).includes('IM 连接'))
  console.log('PASS 提醒接口 503 时显示「提醒尚未启用」空态，不出现错误红条')

  im.disabled = false; im.outage = true
  await page.reload()
  await page.getByText('IM 服务暂时不可用，连接与提醒状态尚未确认。请稍后重试。', { exact: true }).waitFor()
  assert.equal(await page.getByText('IM 连接尚未启用', { exact: true }).count(), 0)
  assert.equal(await page.getByText('提醒尚未启用', { exact: true }).count(), 0)
  assert(await page.getByRole('button', { name: '生成微信连接二维码', exact: true }).isVisible())
  im.outage = false
  await page.reload()
  await page.getByRole('heading', { name: '私聊绑定', exact: true }).waitFor()
  await page.getByText('还没有绑定 IM 私聊', { exact: true }).waitFor()
  assert.equal(await page.getByText('IM 服务暂时不可用，连接与提醒状态尚未确认。请稍后重试。', { exact: true }).count(), 0)
  console.log('PASS 会话库 503 显示服务故障，保留扫码入口，不谎报未启用；恢复后可重新加载')

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

  assert.deepEqual(errors, [])
  console.log('ALL PASS IM 连接页：绑定码核对/绑定、提醒创建/取消、解除绑定、未启用空态，无页面运行异常')
  console.log('未连接桥接服务、微信或真实银行；全部接口为测试夹具。')
} finally {
  await browser?.close()
  await web.close()
}
