/** Browser → HTTP adapter → isolated in-memory domain. No external calls or customer database. */
import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdir } from 'node:fs/promises'
import { createServer } from '../app/node_modules/vite/dist/node/index.js'
import { chromium } from 'playwright-core'
class MemoryStorage { values = new Map(); getItem(k) { return this.values.get(k) ?? null } setItem(k, v) { this.values.set(k, String(v)) } removeItem(k) { this.values.delete(k) } setItemsAtomically(entries) { for (const [k, v] of entries) this.setItem(k, v) } }
globalThis.window = { localStorage: new MemoryStorage(), sessionStorage: new MemoryStorage() }
const state = await import('../server/domain/state.mjs'), { createBankBusinessApi } = await import('../server/domain/index.mjs')
state.resetDb()
const api = createBankBusinessApi(), user = await api.profile()
let currentUser = user, displayedCollections
const root = path.resolve(import.meta.dirname, '..'), output = path.join(root, '.generated', 'aa-payments')
await mkdir(output, { recursive: true })
Object.assign(process.env, { VITE_USE_MOCK: 'false', VITE_BASE_PATH: '/', VITE_API_BASE_URL: '', VITE_AGENT_URL: '/agent-api' })
const web = await createServer({ root: path.join(root, 'app'), configFile: path.join(root, 'app/vite.config.ts'), logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false } })
let browser
const errors = [], requests = []
try {
  await web.listen()
  const base = process.env.AA_PUBLIC_URL ?? `http://127.0.0.1:${web.httpServer.address().port}`
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
  page.setDefaultTimeout(12000); page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(user => { sessionStorage.setItem('luckycat.token', JSON.stringify('fixture-token')); sessionStorage.setItem('luckycat.session.user', JSON.stringify(user)) }, user)
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method()
    const respond = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    if (url.origin !== base) return respond({ message: 'External call blocked in fixture' }, 502)
    if (url.pathname.startsWith('/agent-api/')) return respond({ ok: true, bankDataSource: 'http' })
    if (!url.pathname.startsWith('/api/')) return route.continue()
    const body = request.postData() ? JSON.parse(request.postData()) : {}, pathname = url.pathname
    requests.push({ method, pathname, body, query: Object.fromEntries(url.searchParams) })
    try {
      if (pathname === '/api/auth/profile') return respond(currentUser)
      if (pathname === '/api/accounts') return respond(await api.listAccounts())
      if (pathname === '/api/membership') return respond(await api.getMembership())
      if (pathname === '/api/banks') return respond(await api.listBanks())
      if (pathname === '/api/payees') return respond(await api.listPayees())
      if (pathname === '/api/security/overview') return respond(await api.getSecurityOverview())
      if (pathname === '/api/support/messages') return respond([])
      if (pathname === '/api/transfers/scheduled') return respond(method === 'POST' ? await api.createScheduledTransfer(body) : await api.listScheduledTransfers())
      if (pathname.startsWith('/api/transfers/scheduled/')) return respond(await api.cancelScheduledTransfer(pathname.split('/').at(-1), body.version))
      if (pathname === '/api/transfers/aa-payments') return respond(await api.listSplitPaymentRequests())
      if (/^\/api\/transfers\/aa-payments\/[^/]+\/pay$/.test(pathname)) return respond(await api.paySplitRequest(pathname.split('/').at(-2), body))
      if (pathname === '/api/transfers/splits') return respond(method === 'POST' ? await api.createSplitCollection(body) : displayedCollections ?? await api.listSplitCollections())
      if (pathname.endsWith('/reminders')) return respond(await api.remindSplitParticipant(pathname.split('/').at(-2), body))
      if (pathname === '/api/statistics/report') return respond(await api.getBillingReport(Object.fromEntries(url.searchParams)))
      if (pathname === '/api/statistics/report/export') return respond(await api.exportBillingReport(Object.fromEntries(url.searchParams)))
      if (pathname === '/api/analysis/spending') return respond(await api.getSpending(url.searchParams.get('month')))
      if (pathname === '/api/analysis/cashflow') return respond(await api.getCashFlow(Number(url.searchParams.get('days') ?? 7)))
      errors.push(`Unhandled fixture ${method} ${pathname}`); return respond({ message: 'No fixture' }, 404)
    } catch (error) { return respond({ message: error.message, code: error.code }, error.status ?? 500) }
  })

  await page.goto(base + '/transfer')
  await page.getByRole('tab', { name: 'AA 收款', exact: true }).click()
  const form = page.getByRole('region', { name: 'AA 收款管理' })
  await form.getByLabel('收款事由', { exact: true }).fill('聚餐与活动')
  // 默认是均分，分项 AA 要显式切换。
  await form.getByRole('tab', { name: '分项 AA', exact: true }).click()
  assert.equal(await page.getByRole('tab', { name: '手机号收款', exact: true }).count(), 0)
  const payerName = (await state.findProfileByPhone('13600136000')).user.name
  const otherName = (await state.findProfileByPhone('13900000000')).user.name
  // 参与者身份表：每人姓名 + 手机号或账号。本人也在其中，按登录户名自动识别，不再单独填。
  const identities = [[user.name, '13800138000'], [payerName, '13600136000'], [otherName, '13900000000']]
  for (const [index, [name, identity]] of identities.entries()) {
    if (index > 0) await form.getByRole('button', { name: '添加参与者', exact: true }).click()
    await form.getByLabel(`第 ${index + 1} 位参与者姓名`, { exact: true }).fill(name)
    await form.getByLabel(`第 ${index + 1} 位参与者手机号或本行账号`, { exact: true }).fill(identity)
  }
  await form.getByLabel('第 1 项消费事由', { exact: true }).fill('聚餐')
  await form.getByLabel('第 1 项消费全额（人民币元）', { exact: true }).fill('6.03')
  const first = form.getByRole('group', { name: '第 1 项消费的参加者' })
  for (const name of [user.name, payerName, otherName]) await first.getByText(name, { exact: true }).click()
  await form.getByRole('button', { name: '添加消费', exact: true }).click()
  await form.getByLabel('第 2 项消费事由', { exact: true }).fill('活动')
  await form.getByLabel('第 2 项消费全额（人民币元）', { exact: true }).fill('2.01')
  const second = form.getByRole('group', { name: '第 2 项消费的参加者' })
  for (const name of [user.name, payerName]) await second.getByText(name, { exact: true }).click()
  await form.getByLabel(payerName + '转账备注', { exact: true }).fill('聚餐2.01元，活动1元')
  await form.getByLabel(otherName + '转账备注', { exact: true }).fill('仅聚餐')
  await form.getByRole('table', { name: /AA 参与人清单/ }).screenshot({ path: path.join(output, 'aa-merged-member.png') })
  await form.getByRole('button', { name: '核对并发起 AA 收款', exact: true }).click()
  assert.equal((await state.findProfileByPhone('13600136000')).aaPaymentRequests, undefined)
  await form.getByRole('button', { name: '确认发送付款通知', exact: true }).click()
  await form.getByText('AA 收款已发起，付款通知已送达成员账号。', { exact: true }).waitFor()
  const owner = state.loadDb(), ownerBefore = owner.accounts[0].balance
  const payer = await state.findProfileByPhone('13600136000'), payerBefore = payer.accounts[0].balance
  assert.equal(payer.aaPaymentRequests.length, 1)
  assert.equal(owner.splitCollections[0].selfAmount, 302)
  assert.equal(owner.splitCollections[0].expenses.length, 2)
  assert.deepEqual(owner.splitCollections[0].participants.map(row => row.amount), [301, 201])
  await form.screenshot({ path: path.join(output, 'aa-notification-sent.png') })
  state.activateDb(payer)
  currentUser = await api.profile()
  await page.evaluate(user => { sessionStorage.setItem('luckycat.session.user', JSON.stringify(user)) }, currentUser)
  await page.reload()
  await page.getByRole('tab', { name: 'AA 付款', exact: true }).click()
  const payable = page.getByRole('region', { name: 'AA 付款', exact: true })
  await payable.getByText('待付款（1）', { exact: true }).waitFor()
  await payable.getByText('转账备注：聚餐2.01元，活动1元', { exact: true }).waitFor()
  await payable.getByRole('button', { name: '查看并付款', exact: true }).click()
  const confirm = payable.getByRole('form', { name: '确认 AA 付款', exact: true })
  const pay = confirm.getByRole('button', { name: '确认支付', exact: true })
  assert(await pay.isDisabled())
  for (let i = 1; i <= 6; i++) await confirm.getByLabel(`AA 付款支付密码第 ${i} 位`, { exact: true }).fill('8')
  assert(await pay.isDisabled())
  await confirm.getByRole('checkbox').check()
  await confirm.screenshot({ path: path.join(output, 'aa-pay-confirm.png') })
  await pay.click()
  await payable.getByText('AA 付款成功，转账备注已写入双方流水。', { exact: true }).waitFor()
  await payable.getByText('待付款（0）', { exact: true }).waitFor()
  assert.equal(state.loadDb().accounts[0].balance, payerBefore - 301)
  assert.equal((await state.findProfileByPhone(owner.user.phone)).accounts[0].balance, ownerBefore + 301)
  const tx = state.loadDb().transactions.find(tx => tx.amount === 301 && tx.direction === 'out')
  assert.equal(tx.detail.remark, '聚餐2.01元，活动1元')
  await payable.screenshot({ path: path.join(output, 'aa-paid.png') })
  // Keep the collector's view at the genuine first-payment snapshot, then
  // expose the second real payment and verify polling updates the mounted view.
  state.activateDb(await state.findProfileByPhone(owner.user.phone))
  displayedCollections = structuredClone(await api.listSplitCollections())
  assert.equal(displayedCollections[0].participants.filter(row => row.status === 'paid').length, 1)
  state.activateDb(await state.findProfileByPhone('13900000000'))
  const otherRequest = (await api.listSplitPaymentRequests())[0]
  await api.paySplitRequest(otherRequest.id, { version: otherRequest.version, confirmed: true, paymentPassword: '888888' })
  state.activateDb(await state.findProfileByPhone(owner.user.phone))
  currentUser = await api.profile()
  await page.evaluate(user => sessionStorage.setItem('luckycat.session.user', JSON.stringify(user)), currentUser)
  await page.reload()
  await page.getByRole('tab', { name: 'AA 收款', exact: true }).click()
  await form.getByText(/已收 1\/2/).waitFor()
  let navigations = 0
  page.on('framenavigated', () => navigations++)
  displayedCollections = undefined
  await form.getByText(/已收 2\/2/).waitFor()
  await form.getByText(/已收齐/).waitFor()
  assert.equal(navigations, 0, 'collector must update without page navigation or manual refresh')
  assert.equal(state.loadDb().accounts[0].balance, ownerBefore + 502)
  await form.screenshot({ path: path.join(output, 'aa-collected-automatically.png') })
  for (const width of [1440, 1024]) { await page.setViewportSize({ width, height: 1100 }); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)) }
  assert.deepEqual(errors, [])
  console.log('PASS AA UI: phone + exact amount + memo → explicit notification confirmation → recipient pending inbox → PIN/consent → balanced payment → ledger memo → collector auto-refresh from 1/2 to 2/2 without navigation → desktop layout')

} finally { await browser?.close(); await web.close() }
