/** Real portal UI + real workbench storage; isolated bank auth and fake delivery only. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright-core'
import { createBankReminders } from '../framework/bridge/bank-reminders.mjs'
import { createImHttp } from '../framework/bridge/im-http.mjs'

const directory = await mkdtemp(join(tmpdir(), 'bank-reminders-ui-'))
const route = { id: 'r1', ownerId: 'alice', channel: 'weixin', botId: 'one', key: 'p2p:alice', sessionId: 's1', bindingRevision: 'v1' }
let now = Date.now(), service, portal, browser
const sent = [], errors = []
const options = { directory, clock: () => now, routes: () => ({ r1: structuredClone(route) }), deliver: async (r, text) => { sent.push({ key: r.key, text }) } }
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname
  const json = async (_r, status, value) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)) }
  const readJson = async () => { let body = ''; for await (const chunk of req) body += chunk; return JSON.parse(body || '{}') }
  try {
    if (pathname === '/api/auth/sms-code') return json(res, 200, { demoCode: '123456' })
    if (pathname === '/api/auth/login') return json(res, 200, { token: 'alice-token', user: { id: 'alice', name: '测试客户' } })
    if (await portal.handle(req, res, { pathname, readJson, sendJson: json })) return
    if (req.headers.authorization !== 'Bearer alice-token') return json(res, 401, { error: 'UNAUTHORIZED' })
    if (!await portal.handle(req, res, { pathname, readJson, sendJson: json, identity: { user: { id: 'alice' }, token: 'alice-token' } })) return json(res, 404, { error: 'not found' })
  } catch (error) { await json(res, error.status ?? 500, { error: error.message }) }
})
try {
  service = await createBankReminders(options)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  portal = createImHttp({ bankUrl: base, channels: {}, bank: { list: () => [{ id: 'r1', sessionId: 's1', label: '微信私聊 · 测试', connected: false }] }, reminders: () => service })
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true })
  const page = await browser.newPage({ viewport: { width: 1200, height: 920 } })
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(base + '/agent-api/im')
  await page.locator('#identity').fill('13800138000')
  await page.locator('#password').fill('fixture-only')
  await page.locator('#sms-button').click()
  await page.locator('#login-form button[type=submit]').click()
  await page.locator('#reminder-binding option').waitFor({ state: 'attached' })
  const fill = async title => {
    await page.locator('#reminder-title').fill(title)
    await page.locator('#reminder-time').fill(new Date(now + 120000 + 8 * 3600000).toISOString().slice(0, 16))
    await page.locator('#reminder-preview-button').click()
  }
  await fill('查看理财 <script>')
  assert.equal(service.list('alice').reminders.length, 0)
  assert((await page.locator('#reminder-preview').innerText()).includes('北京时间'))
  await page.locator('#reminder-submit').click()
  await page.locator('#reminder-list').getByText('查看理财 <script>', { exact: true }).waitFor()
  assert.equal(await page.locator('#reminder-list script').count(), 0)
  assert.equal(service.list('alice').reminders.length, 1)
  await page.locator('#reminder-list').getByRole('button', { name: '取消提醒', exact: true }).click()
  assert.equal(service.list('alice').reminders[0].status, 'scheduled')
  await page.locator('#reminder-list').getByRole('button', { name: '确认取消提醒', exact: true }).click()
  await page.locator('#reminder-list').getByText(/已取消/).waitFor()
  now += 180000; await service.tick(); assert.equal(sent.length, 0)
  await fill('微信提醒投递验证')
  await page.locator('#reminder-submit').click()
  await page.locator('#reminder-list').getByText('微信提醒投递验证', { exact: true }).waitFor()
  now += 180000; await service.tick(); await service.tick()
  assert.equal(sent.length, 1); assert.equal(sent[0].key, 'p2p:alice')
  await page.locator('#reminder-refresh').click()
  await page.locator('#reminder-list').getByText(/已提交微信（不代表已读）/).waitFor()
  await service.close(); service = await createBankReminders(options)
  await service.tick(); assert.equal(sent.length, 1)
  const output = resolve('.generated/local-postgres/reminders-20261020.png')
  await mkdir(resolve('.generated/local-postgres'), { recursive: true })
  await page.locator('#reminder-panel').screenshot({ path: output })
  await page.locator('#logout-button').click()
  assert.equal(await page.locator('#reminder-list').innerText(), '')
  assert.deepEqual(errors, [])
  console.log('ALL PASS portal login → preview without write → confirm → cancel → due fake delivery → one send → restart → logout isolation')
  console.log('Screenshot: ' + output + '; no real bank, model, or WeChat message used')
} finally {
  await browser?.close(); await service?.close(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true })
}
