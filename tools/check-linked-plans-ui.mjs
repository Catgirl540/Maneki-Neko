/** Current desktop renewal/birthday flows against isolated HTTP fixtures; no bank, merchant or IM delivery. */
import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdir } from 'node:fs/promises'
import { createServer } from '../app/node_modules/vite/dist/node/index.js'
import { chromium } from 'playwright-core'
import { previewBirthdayPlan, createBirthdayPlan, cancelBirthdayPlan, confirmBirthdayOrder, listBirthdayPlans } from '../shared/linked-plans.mjs'

const root = path.resolve(import.meta.dirname, '..')
Object.assign(process.env, { VITE_USE_MOCK: 'false', VITE_BASE_PATH: '/', VITE_API_BASE_URL: '', VITE_AGENT_URL: '/agent-api' })
const web = await createServer({ root: path.join(root, 'app'), configFile: path.join(root, 'app/vite.config.ts'), logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false } })
const user = { id: 'linked-ui-customer', name: '夹具客户', phone: '13900139000', memberTier: 'standard', avatarInitial: '夹' }
const profile = { user, accounts: [{ id: 'linked-cny', kind: 'savings', label: '储蓄账户', accountNo: '882000000000000001', currency: 'CNY', balance: 800000, available: 750000, interestRate: 0, monthNetChange: 0 }], transactions: [] }
const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
const futureDate = new Date(Date.now() + 10 * 86400000 + 8 * 3600000).toISOString().slice(0, 10)
const contract = { id: 'linked-contract', merchant: '视频会员', category: 'subscription', amount: 2500, cycle: '每月', nextRunAt: futureDate, enabled: true }
const transactions = [71, 43, 15].map((days, index) => ({ id: `subscription-evidence-${index}`, accountId: 'linked-cny', direction: 'out', amount: 2500, signedAmount: -2500, counterparty: '视频会员', memo: '', category: 'subscription', status: 'success', createdAt: new Date(Date.now() - days * 86400000).toISOString() }))
const writes = [], errors = [], unexpected = [], reminders = []
let browser
try {
  await web.listen()
  const base = `http://127.0.0.1:${web.httpServer.address().port}`
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
  page.setDefaultTimeout(12000)
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(user => { sessionStorage.setItem('luckycat.token', JSON.stringify('fixture-token')); sessionStorage.setItem('luckycat.session.user', JSON.stringify(user)) }, user)
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method()
    const respond = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    if (url.origin !== base) { unexpected.push(url.origin + url.pathname); return respond({}, 502) }
    if (!url.pathname.startsWith('/api/') && !url.pathname.startsWith('/agent-api/')) return route.continue()
    const body = method === 'GET' ? {} : request.postDataJSON() ?? {}
    if (method !== 'GET') writes.push({ path: url.pathname, method, body })
    if (url.pathname === '/agent-api/health') return respond({ ok: true, bankDataSource: 'http' })
    if (url.pathname === '/agent-api/im/reminders' && method === 'GET') return respond({ bindings: [{ id: 'bound-self', label: '本人微信 · 1001' }], reminders })
    if (url.pathname === '/agent-api/im/reminders' && method === 'POST') {
      assert.equal(body.confirmed, true); assert.equal(body.bindingId, 'bound-self'); assert.match(body.requestId, /^[0-9a-f-]{36}$/)
      const reminder = { id: 'renewal-ui-1', title: body.title, dueAt: body.dueAt, status: 'scheduled' }; reminders.push(reminder); return respond(reminder)
    }
    switch (url.pathname) {
      case '/api/auth/profile': return respond(user)
      case '/api/security/overview': return respond({ logs: [], devices: [], riskRules: [], score: 80, level: '基础防护' })
      case '/api/support/messages': return respond([])
      case '/api/accounts': return respond(profile.accounts)
      case '/api/membership': return respond({ tier: 'standard', tierLabel: '普通会员', aum: 0, nextTier: 'gold', nextThreshold: 10000000, benefits: ['基础银行服务'],
        entitlements: { freeTransferFee: false, freeOverseasRemit: false, vipChannel: false, birthdayGift: false, dedicatedManager: false, dedicatedAdvisor: false, wealthPriority: false, loungePassesPerYear: 0, cardFeeWaiversPerYear: 0, cardFeeRate: 1, includeShipping: false, fxFeeRate: 1 },
        since: null, evaluation: null, downgradeWarning: null, lounge: { year: 2026, perYear: 0, used: 0, remaining: 0 }, records: [] })
      case '/api/accounts/linked-cny/transactions': return respond({ items: transactions, total: 500, page: 1, size: Number(url.searchParams.get('size')) })
      case '/api/autodebits': return respond([contract])
      case '/api/autodebits/linked-contract': contract.enabled = body.enabled; return respond(contract)
      case '/api/linked/birthdays/preview': return respond(previewBirthdayPlan(profile, body))
      case '/api/linked/birthdays': {
        if (method === 'GET') return respond(listBirthdayPlans(profile))
        if (body.paymentPassword !== '123456') return respond({ message: '支付密码不正确', code: 'BAD_PAY_PASSWORD' }, 401)
        return respond(createBirthdayPlan(profile, body))
      }
      default: {
        const match = /^\/api\/linked\/birthdays\/([^/]+)\/(cancel|order)$/.exec(url.pathname)
        if (match) return respond(match[2] === 'cancel' ? cancelBirthdayPlan(profile, decodeURIComponent(match[1]), body) : confirmBirthdayOrder(profile, decodeURIComponent(match[1]), body))
        unexpected.push(url.pathname); return respond({ message: '夹具未提供接口' }, 404)
      }
    }
  })

  await page.goto(base + '/analysis/autodebits')
  await page.getByRole('heading', { name: '流水中的订阅候选' }).waitFor()
  await page.getByText('CNY · 已检查 3 / 500 条', { exact: true }).waitFor()
  await page.getByText('视频会员 · CNY 25.00', { exact: true }).waitFor()
  assert((await page.locator('.subscription-candidates').innerText()).includes('subscription-evidence-0'))
  assert.equal(reminders.length, 0)
  await page.getByRole('button', { name: '设置「视频会员」续费提醒', exact: true }).click()
  const renewal = page.getByRole('dialog', { name: '续费提醒', exact: true })
  await renewal.getByLabel('接收微信', { exact: true }).waitFor()
  assert((await renewal.getByLabel('提醒内容', { exact: true }).inputValue()).includes(futureDate))
  assert.equal(reminders.length, 0, 'opening renewal suggestion does not create a reminder')
  await renewal.getByRole('button', { name: '核对提醒', exact: true }).click()
  const reminderReview = page.getByRole('dialog', { name: '请核对这条提醒', exact: true })
  await reminderReview.waitFor(); assert.equal(reminders.length, 0)
  await reminderReview.getByRole('button', { name: '确认创建', exact: true }).click()
  await renewal.getByText('等待发送', { exact: true }).waitFor()
  assert.equal(reminders.length, 1); assert.match(reminders[0].dueAt, /\+08:00$/)
  await renewal.getByRole('button', { name: '关闭弹窗', exact: true }).click()
  console.log('PASS subscription sample evidence and separate renewal review/confirmation, without automatic recurring tasks')

  await page.getByRole('switch', { name: '视频会员 自动扣款', exact: true }).click()
  const stop = page.getByRole('dialog', { name: '停用本行代扣', exact: true })
  await stop.waitFor(); assert.equal(contract.enabled, true)
  await stop.getByRole('button', { name: '确认停用', exact: true }).click()
  await stop.waitFor({ state: 'hidden' })
  assert.equal(await page.getByRole('switch', { name: '视频会员 自动扣款', exact: true }).getAttribute('aria-checked'), 'false')
  console.log('PASS stopping bank direct debit requires confirmation and explains merchant subscription boundary')

  await page.goto(base + '/wealth/plans?tab=birthday')
  await page.getByRole('heading', { name: '生日联动计划', exact: true }).waitFor()
  await page.getByLabel('生日联系人', { exact: true }).fill('家人 <img src=x onerror=alert(1)>')
  await page.getByLabel('本次生日日期', { exact: true }).fill(today)
  await page.getByRole('button', { name: '核对生日计划', exact: true }).click()
  const birthdayReview = page.getByRole('dialog', { name: '确认生日预留计划', exact: true })
  await birthdayReview.waitFor()
  assert.equal(profile.birthdayPlans, undefined, 'preview does not persist or reserve'); assert.equal(profile.accounts[0].available, 750000)
  await birthdayReview.getByLabel('支付密码', { exact: true }).fill('000000')
  await birthdayReview.getByRole('button', { name: '确认预留计划', exact: true }).click()
  await birthdayReview.getByRole('alert').filter({ hasText: '支付密码不正确' }).waitFor()
  assert.equal(profile.birthdayPlans, undefined)
  await birthdayReview.getByLabel('支付密码', { exact: true }).fill('123456')
  await birthdayReview.getByRole('button', { name: '确认预留计划', exact: true }).click()
  await page.getByText('已冻结可用余额', { exact: false }).waitFor()
  assert.equal(profile.accounts[0].available, 650000); assert.equal(profile.accounts[0].balance, 800000); assert.equal(profile.birthdayPlans.length, 1)
  assert.equal(await page.locator('main img[src="x"]').count(), 0)
  const creation = writes.filter(write => write.path === '/api/linked/birthdays' && write.method === 'POST')
  assert.equal(creation[0].body.requestId, creation[1].body.requestId, 'same review keeps one request key while retrying')
  await page.getByRole('button', { name: '查看订购待办', exact: true }).click()
  const order = page.getByRole('dialog', { name: '确认订购待办', exact: true })
  assert((await order.innerText()).includes('不生成订单'))
  await order.getByRole('button', { name: '确认订购待办', exact: true }).click()
  await page.getByText('等待商户接入', { exact: true }).waitFor()
  assert.equal(profile.birthdayPlans[0].order.merchantOrderId, null); assert.equal(profile.accounts[0].balance, 800000)
  await page.getByRole('button', { name: '取消生日计划', exact: true }).click()
  const cancel = page.getByRole('dialog', { name: '取消生日计划', exact: true })
  await cancel.waitFor(); assert.equal(profile.accounts[0].available, 650000)
  await cancel.getByRole('button', { name: '确认取消并解冻', exact: true }).click()
  await page.getByText('已取消', { exact: true }).waitFor()
  assert.equal(profile.accounts[0].available, 750000, 'the existing unrelated 50000 hold stays intact'); assert.equal(profile.accounts.length, 1)
  console.log('PASS birthday preview, password rejection/retry, actual hold, unconnected order state and confirmed isolated release')

  for (const width of [1440, 1024]) { await page.setViewportSize({ width, height: 1100 }); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)) }
  await mkdir(path.join(root, '.generated/local-postgres'), { recursive: true })
  await page.screenshot({ path: path.join(root, '.generated/local-postgres/linked-plans-20261027.png'), animations: 'disabled', fullPage: true })
  assert.deepEqual(errors, []); assert.deepEqual(unexpected, [])
  console.log('ALL PASS renewal/birthday current desktop UI: isolated fixtures, no live messages, payments or orders')
} finally { await browser?.close(); await web.close() }
