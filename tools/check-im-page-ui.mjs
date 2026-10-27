/**
 * 当前助手 IM 视图（`/assistant?view=im`）的浏览器回归，含 `/reminders` 跳转。
 *
 * 所有 IM/银行接口使用内存夹具，验证扫码恢复、单独绑定确认、提醒核对/创建/取消、
 * 换绑入口、未启用/服务故障、XSS文字和桌面布局，不连接真实渠道。
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
const im = { bindings: [], reminders: [], disabled: false, outage: false, truncated: false, nextReminder: 0, qr: null, qrStarts: 0, writes: [] }
let browser
const errors = []
try {
  await web.listen()
  const base = `http://127.0.0.1:${web.httpServer.address().port}`
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
  page.setDefaultTimeout(12000)
  async function capture(name, section) {
    await page.locator('.business-scroll').evaluate((element, section) => {
      const target = section ? document.querySelector(section) : null
      element.scrollTop = target ? element.scrollTop + target.getBoundingClientRect().top - element.getBoundingClientRect().top : 0
    }, section)
    await page.screenshot({ path: path.join(root, `.generated/local-postgres/${name}-20261021.png`), animations: 'disabled' })
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

  await mkdir(path.join(root, '.generated/local-postgres'), { recursive: true })
  await page.goto(base + '/reminders')
  await page.waitForURL(base + '/assistant?view=im')
  assert.equal(await page.getByRole('tab', { name: 'IM 连接', exact: true }).getAttribute('aria-selected'), 'true')
  await page.getByRole('heading', { name: '微信扫码连接', exact: true }).waitFor()
  await page.getByRole('heading', { name: '提醒', exact: true }).waitFor()
  assert.equal(im.qrStarts, 0)
  assert(await page.getByRole('button', { name: '核对提醒', exact: true }).isDisabled())
  console.log('PASS 当前 /assistant?view=im 路由，未连接不能建提醒，不自动创建扫码任务')
  await page.getByRole('button', { name: '生成微信连接二维码', exact: true }).click()
  const qr = page.getByRole('img', { name: '微信连接二维码', exact: true })
  await qr.waitFor()
  assert((await qr.getAttribute('src')).startsWith('data:image/png;base64,'))
  await page.reload()
  await qr.waitFor()
  assert.equal(im.qrStarts, 1)
  im.qr.status = 'needs_verification'
  await page.getByLabel('扫码验证码', { exact: true }).fill('123456')
  await page.getByRole('button', { name: '提交扫码验证码', exact: true }).click()
  await page.getByText('已扫码，请在微信中确认登录', { exact: true }).waitFor()
  im.qr.status = 'connected'
  const bind = page.getByRole('button', { name: '确认绑定此微信到当前账户', exact: true })
  await bind.waitFor()
  assert.equal(im.bindings.length, 0)
  await bind.click()
  await page.getByText('微信私聊 · QR01', { exact: true }).first().waitFor()
  assert.equal(im.bindings.length, 1)
  assert.equal(im.writes.filter(w => w.path.endsWith('/confirm')).length, 1)
  assert.equal(im.writes.filter(w => w.path.startsWith('/admin/')).length, 0)
  console.log('PASS 二维码断点恢复、扫码验证、手机确认后仍需银行绑定确认')

  const title = '<img src=x onerror=alert(1)> 核对续费'
  await page.getByLabel('提醒内容', { exact: true }).fill(title)
  await page.getByRole('button', { name: '核对提醒', exact: true }).click()
  const review = page.getByRole('dialog', { name: '请核对这条提醒', exact: true })
  await review.waitFor()
  assert((await review.innerText()).includes(title))
  assert((await review.innerText()).includes('北京时间'))
  assert.equal(im.reminders.length, 0)
  await review.getByRole('button', { name: '返回修改', exact: true }).click()
  assert.equal(im.reminders.length, 0)
  await page.getByRole('button', { name: '核对提醒', exact: true }).click()
  await review.getByRole('button', { name: '确认创建', exact: true }).click()
  await page.getByText('等待发送', { exact: true }).waitFor()
  assert.equal(im.reminders.length, 1)
  assert.equal(await page.locator('.im-reminder-row img').count(), 0)
  const created = im.writes.find(w => w.method === 'POST' && w.path === '/reminders').body
  assert.equal(created.confirmed, true)
  assert.match(created.dueAt, /\+08:00$/)
  assert.match(created.requestId, /^[0-9a-f-]{36}$/)
  await page.reload()
  await page.getByText(title, { exact: true }).waitFor()
  assert.equal(im.writes.filter(w => w.method === 'POST' && w.path === '/reminders').length, 1)
  console.log('PASS 核对不写入、确认携带时区及幂等编号，标签按文字展示，刷新不重复创建')
  im.reminders[0].errorCode = 'BOT_OFFLINE'; im.truncated = true
  await page.getByRole('button', { name: '刷新提醒', exact: true }).click()
  await page.getByText('机器人离线，尚未发送；服务恢复后将有限重试。', { exact: true }).waitFor()
  await page.getByText('仅显示最近 100 条提醒，较早记录未显示。', { exact: true }).waitFor()
  await page.getByRole('button', { name: '取消提醒', exact: true }).click()
  const cancel = page.getByRole('dialog', { name: '取消这条提醒', exact: true })
  await cancel.waitFor()
  assert.equal(im.reminders[0].status, 'scheduled')
  await cancel.getByRole('button', { name: '确认取消', exact: true }).click()
  await page.getByText('已取消', { exact: true }).waitFor()
  assert.equal(im.reminders[0].status, 'cancelled')
  const cancelled = im.writes.filter(w => w.method === 'DELETE' && w.path.startsWith('/reminders/')).at(-1)
  assert.equal(cancelled.body.confirmed, true)
  assert.match(cancelled.body.requestId, /^[0-9a-f-]{36}$/)
  console.log('PASS 离线与历史截断提示、取消独立确认')
  await page.getByRole('button', { name: '换绑', exact: true }).click()
  await page.getByRole('button', { name: '生成微信连接二维码', exact: true }).waitFor()
  assert.equal(im.bindings.length, 1)
  assert.equal(im.qrStarts, 1)
  await page.getByRole('button', { name: '取消换绑', exact: true }).click()
  for (const width of [1024, 1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1100 })
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'IM 在 ' + width + 'px 溢出')
  }
  await page.screenshot({ path: path.join(root, '.generated/local-postgres/im-current-reminders-20261027.png'), animations: 'disabled' })
  im.disabled = true
  await page.reload()
  await page.getByText('微信提醒尚未启用，请稍后重试或联系客服。', { exact: true }).waitFor()
  im.disabled = false; im.outage = true
  await page.reload()
  await page.getByText('会话持久化服务不可用，请稍后重试', { exact: true }).waitFor()
  assert.equal(await page.getByText('尚未连接微信', { exact: true }).count(), 0)
  im.outage = false
  await page.getByRole('button', { name: '重试', exact: true }).click()
  await page.getByRole('heading', { name: '提醒', exact: true }).waitFor()
  assert.deepEqual(errors, [])
  assert.equal(page.context().pages().length, 1)
  console.log('PASS 换绑不提前写入，桌面宽度无溢出，故障与未启用可区分，恢复后可重试')
} finally { await browser?.close(); await web.close() }
