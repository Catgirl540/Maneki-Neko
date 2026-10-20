/** 只启动网页前端，API 全用测试响应；不启动银行、Agent 或远程服务。 */
import assert from 'node:assert/strict'
import path from 'node:path'
import { createServer } from '../app/node_modules/vite/dist/node/index.js'
import { chromium } from 'playwright-core'

const root = path.resolve(import.meta.dirname, '..')
Object.assign(process.env, { VITE_USE_MOCK: 'false', VITE_BASE_PATH: '/', VITE_API_BASE_URL: '' })
const web = await createServer({ root: path.join(root, 'app'), configFile: path.join(root, 'app/vite.config.ts'),
  logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false } })
let browser
const user = { id: 'fixture-user', name: '测试客户', phone: '13900139000', memberLevel: '普通会员', avatarInitial: '测' }
const date = '2026-10-13T08:00:00.000Z'
const accounts = ['CNY', 'USD', 'HKD'].map((currency, i) => ({ id: `a${i}`, kind: 'savings', label: `${currency} 储蓄账户`,
  currency, accountNo: `882000000000000${i}`, balance: 1000000, available: 1000000, interestRate: 0, monthNetChange: 0 }))
const loanProduct = { id: 'loan', name: '测试借款', description: '借款产品', minAmount: 10000, maxAmount: 1000000,
  minTermMonths: 3, maxTermMonths: 12, apr: .04, disbursement: '以办理结果为准', tags: [] }
const investProduct = { id: 'fund', code: 'FUND', name: '测试基金', category: 'fund', nav: 1, risk: 'low', oneYearReturn: 0, minAmount: 10000 }
const membership = { current: { planId: 'gold', planName: '金卡', status: 'canceled', price: 1900, period: '每月', startedAt: date, renewAt: null },
  plans: [{ id: 'gold', name: '金卡', price: 1900, period: '每月', perks: [] }], records: [{ id: 'record', label: '订阅设置', amount: 1900, createdAt: date }] }
let rate = .14, ttl = 30, accountFailure = false, showOcr = true, holdQuote = false, releaseQuote
let roundup = { enabled: false, roundupTo: 100, dailyCap: 1000, accountId: 'a0', goalId: null }
const goals = []
let holdSavingsReload = false, releaseSavingsReload, holdRoundup = false, releaseRoundup, roundupFailure = false
const quotes = [], submitted = [], writes = [], errors = []
try {
  await web.listen()
  const base = `http://127.0.0.1:${web.httpServer.address().port}`
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
  page.setDefaultTimeout(12000)
  page.on('pageerror', e => errors.push(e.message))
  await page.addInitScript(user => {
    sessionStorage.setItem('luckycat.token', JSON.stringify('fixture-token'))
    sessionStorage.setItem('luckycat.session.user', JSON.stringify(user))
  }, user)
  await page.route('**/agent-api/**', r => r.fulfill({ status: 503, body: '{}' }))
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method()
    if (!url.pathname.startsWith('/api/')) return route.continue()
    const body = method === 'POST' || method === 'PATCH' ? request.postDataJSON() : null
    const respond = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    if (method !== 'GET') writes.push({ path: url.pathname, body })
    switch (url.pathname) {
      case '/api/auth/profile': return respond(user)
      case '/api/accounts': return accountFailure ? respond({ message: '账户暂不可用' }, 503) : respond(accounts)
      case '/api/security/overview': return respond({ logs: [], devices: [], riskRules: [], score: 80, level: '基础防护' })
      case '/api/exchange/quote': {
        const quoteId = `fixture-fx-${quotes.length + 1}`
        quotes.push({ ...body, quoteId })
        const fx = { fromCurrency: accounts.find(a => a.id === body.fromAccountId).currency, toCurrency: body.toCurrency,
          fromAmount: body.amount, toAmount: Math.round(body.amount * rate), rate, spread: .002, quoteTtlSeconds: ttl, quotedAt: date }
        if (holdQuote) { holdQuote = false; await new Promise(r => { releaseQuote = r }) }
        return respond({ quoteId, fx, toAccountNo: accounts[1].accountNo, toAvailableAfter: fx.toAmount })
      }
      case '/api/exchange': {
        submitted.push(body)
        await new Promise(r => setTimeout(r, 350))
        return respond({ transactionId: 'exchange', referenceNo: 'FX-TEST', fromAccountId: body.fromAccountId, toAccountId: 'a1', createdAt: date,
          fx: { fromCurrency: 'CNY', toCurrency: body.toCurrency, fromAmount: body.amount, toAmount: Math.round(body.amount * rate), rate, spread: .002, quoteTtlSeconds: ttl, quotedAt: date } })
      }
      case '/api/identity/status': return respond({ level: 'basic', idType: '居民身份证', maskedIdNumber: '330106199203047234',
        verifiedAt: date, livenessVerified: false, steps: [], ocr: showOcr ? { holderName: user.name, idNumber: '330106199203047234', birthDate: '1992-03-04', expiryDate: '2031-06-30', address: '测试地址', confidence: .98 } : null })
      case '/api/cashflow/salary': return respond({ salaryDay: 8, amount: 100000, employer: '测试单位', accountId: 'a0', nextPayday: '2026-11-08', history: [] })
      case '/api/cashflow/overdraft': return respond({ active: false, creditLimit: 100000, used: 0, available: 100000, apr: .05, activatedAt: null, interestNote: '' })
      case '/api/wealth/cash-management': return respond({ balance: 0, totalYield: 0, sevenDayYield: .02, accountId: 'a0', sweepEnabled: false, sweepThreshold: 10000, products: [] })
      case '/api/credit/overview': return respond({ creditLimit: 1000000, availableCredit: 1000000, products: [loanProduct], loans: [], installments: [], builder: { score: 700, level: '良好', streakMonths: 0, nextMilestone: '', tips: [] } })
      case '/api/wealth/investments': return respond({ holding: 0, totalReturn: 0, plans: [], products: [investProduct] })
      case '/api/savings/overview': {
        const overview = structuredClone({ totalSaved: 0, goals, roundup, streak: { days: 0, longestDays: 0, lastSavedAt: '', badges: [] }, rewards: [] })
        if (holdSavingsReload) { holdSavingsReload = false; await new Promise(r => { releaseSavingsReload = r }) }
        return respond(overview)
      }
      case '/api/savings/goals': {
        const goal = { ...body, id: `goal-${goals.length}`, savedAmount: 0, sweep: null, createdAt: date }
        goals.push(goal)
        holdSavingsReload = true
        return respond(goal)
      }
      case '/api/savings/roundup': {
        // 服务端返回的权威值与请求不同，页面必须采用响应。
        if (holdRoundup) { holdRoundup = false; await new Promise(r => { releaseRoundup = r }) }
        await new Promise(r => setTimeout(r, 200))
        if (roundupFailure) return respond({ message: '设置暂不可用' }, 503)
        roundup = { ...roundup, enabled: false }; return respond(roundup)
      }
      case '/api/membership': return respond(membership)
      default: return respond({ message: '测试未提供此接口' }, 404)
    }
  })
  async function visit(path, heading) {
    await page.goto(base + path)
    try { await page.getByRole('heading', { name: heading, exact: true }).first().waitFor() }
    catch (error) { throw new Error(`${error.message}\n${page.url()}\n${JSON.stringify(errors)}\n${(await page.locator('body').innerText()).slice(0, 2000)}`) }
  }
  async function pin(dialog) { for (let i = 1; i <= 6; i++) await dialog.getByLabel(`支付密码第 ${i} 位`, { exact: true }).fill('8') }

  await visit('/exchange', '多币种换汇')
  assert.equal(await page.getByRole('navigation', { name: '桌面主导航' }).getByRole('link', { name: '多币种换汇', exact: true }).getAttribute('aria-current'), 'page')
  const input = page.getByLabel('换汇金额', { exact: true })
  for (const invalid of ['1.2.3', '-100', '12abc']) {
    await input.fill(invalid); await page.getByRole('button', { name: '获取报价', exact: true }).click()
    await page.getByText('请输入有效金额，最多两位小数', { exact: true }).waitFor()
  }
  assert.equal(quotes.length, 0)
  holdQuote = true
  await input.fill('100'); await page.getByRole('button', { name: '获取报价', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('button') !== null)
  for (let i = 0; !releaseQuote && i < 100; i++) await new Promise(r => setTimeout(r, 10))
  assert(releaseQuote)
  await input.fill('200'); await page.getByRole('tab', { name: '港币', exact: true }).click()
  await page.getByRole('button', { name: '获取报价', exact: true }).click()
  await page.getByRole('button', { name: '确认换汇', exact: true }).waitFor()
  releaseQuote(); await page.waitForTimeout(150)
  await page.getByRole('button', { name: '确认换汇', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '确认换汇', exact: true })
  assert((await dialog.innerText()).includes('200.00'))
  await pin(dialog); rate = .15
  await dialog.getByRole('button', { name: '确认换汇', exact: true }).click()
  await dialog.getByRole('alert').filter({ hasText: '参考报价已更新' }).waitFor()
  const confirmedQuoteId = quotes.at(-1).quoteId
  assert.equal(submitted.length, 0)
  assert.equal(await dialog.getByLabel('支付密码第 1 位', { exact: true }).inputValue(), '')
  await pin(dialog)
  await dialog.getByRole('button', { name: '确认换汇', exact: true }).click()
  await page.keyboard.press('Escape')
  assert.equal(await dialog.count(), 1)
  await page.getByRole('dialog', { name: '换汇成功', exact: true }).waitFor()
  assert.equal(submitted.length, 1)
  assert.deepEqual(submitted[0], { fromAccountId: 'a0', toCurrency: 'HKD', amount: 20000, quoteId: confirmedQuoteId, paymentPassword: '888888' })
  console.log('PASS 换汇旧请求丢弃、报价变化重新确认、提交绑定已确认报价 ID、提交期间禁止关闭，账户导航正确')

  ttl = 1
  await visit('/exchange', '多币种换汇')
  await input.fill('100'); await page.getByRole('button', { name: '获取报价', exact: true }).click()
  await page.getByRole('button', { name: '确认换汇', exact: true }).click()
  await dialog.getByRole('button', { name: '重新获取报价', exact: true }).waitFor()
  const before = submitted.length
  await dialog.getByRole('button', { name: '重新获取报价', exact: true }).click()
  await dialog.waitFor({ state: 'detached' })
  assert.equal(submitted.length, before)
  ttl = 30
  console.log('PASS 确认框过期可重新获取报价，过期不提交换汇')

  await visit('/security/identity', '身份认证')
  assert(!(await page.locator('body').innerText()).includes('330106199203047234'))
  assert((await page.locator('main').innerText()).includes('330***********7234'))
  assert(await page.getByRole('button', { name: '人脸核验暂未开放' }).isDisabled())
  showOcr = false
  await visit('/security/identity', '身份认证')
  assert(await page.getByRole('button', { name: '证件识别暂未开放' }).isDisabled())
  assert(!writes.some(w => w.path === '/api/identity/ocr' || w.path === '/api/identity/liveness'))
  console.log('PASS 两处证件号均遮罩，未开放核验不发请求或伪报通过')

  await visit('/cashflow', '工资与备用金')
  assert(!(await page.locator('main').innerText()).includes('每月发薪自动入账'))
  await page.getByRole('button', { name: '修改', exact: true }).click()
  await page.getByLabel('预计月薪', { exact: true }).fill('2.3.4')
  await page.getByRole('dialog').getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: '有效月薪' }).waitFor()
  assert(!writes.some(w => w.path === '/api/cashflow/salary'))
  await visit('/wealth/cash-management', '现金管理')
  await page.getByRole('button', { name: '修改', exact: true }).click()
  await page.getByLabel('活期保留金额', { exact: true }).fill('')
  await page.getByRole('dialog').getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: '有效金额' }).waitFor()
  assert(!writes.some(w => w.path === '/api/wealth/cash-management/sweep'))
  console.log('PASS 工资和活钱设置不承诺自动执行，非法/空金额不发请求')

  await visit('/dashboard/savings', '存钱计划')
  await page.getByRole('button', { name: '新建目标', exact: true }).first().click()
  await page.getByLabel('目标名称', { exact: true }).fill('旅行')
  await page.getByLabel('目标金额', { exact: true }).fill('9'.repeat(30))
  await page.getByRole('dialog').getByRole('button', { name: '创建', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: '有效目标金额' }).waitFor()
  assert(!writes.some(w => w.path === '/api/savings/goals'))
  await page.keyboard.press('Escape')
  await page.getByRole('switch', { name: '消费凑整转存', exact: true }).click()
  await page.waitForTimeout(350)
  assert.equal(await page.getByRole('switch', { name: '消费凑整转存', exact: true }).getAttribute('aria-checked'), 'false')
  console.log('PASS 目标金额溢出拦截，凑整设置采用接口响应值')

  // 新建后的总览刷新先返回，随后设置成功/失败，不能拿设置前的快照盖掉新目标。
  for (const failure of [false, true]) {
    releaseSavingsReload = undefined; releaseRoundup = undefined
    roundupFailure = failure; holdRoundup = true
    const name = failure ? '失败请求仍保留的目标' : '并发刷新后保留的目标'
    await page.getByRole('button', { name: '新建目标', exact: true }).first().click()
    await page.getByLabel('目标名称', { exact: true }).fill(name)
    await page.getByLabel('目标金额', { exact: true }).fill('100')
    await page.getByRole('dialog').getByRole('button', { name: '创建', exact: true }).click()
    for (let i = 0; !releaseSavingsReload && i < 100; i++) await new Promise(r => setTimeout(r, 10))
    assert(releaseSavingsReload)
    await page.getByRole('switch', { name: '消费凑整转存', exact: true }).click()
    for (let i = 0; !releaseRoundup && i < 100; i++) await new Promise(r => setTimeout(r, 10))
    assert(releaseRoundup)
    releaseSavingsReload()
    await page.getByText(name, { exact: true }).waitFor()
    const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/savings/roundup')
    releaseRoundup(); await response
    await page.getByText(failure ? '设置暂不可用' : '凑整规则已保存', { exact: true }).last().waitFor()
    await page.waitForTimeout(250)
    for (const goal of goals) assert(await page.getByText(goal.name, { exact: true }).isVisible())
    assert.equal(await page.getByRole('switch', { name: '消费凑整转存', exact: true }).getAttribute('aria-checked'), 'false')
  }
  roundupFailure = false
  console.log('PASS 新建目标刷新与凑整设置并发：成功和失败均不覆盖新目标')

  accountFailure = true
  await visit('/wealth/investments', '数据暂时无法加载')
  await page.getByText('账户暂不可用', { exact: true }).waitFor()
  accountFailure = false
  await page.getByRole('button', { name: '重新加载', exact: true }).click()
  await page.getByRole('heading', { name: '投资与定投', exact: true }).waitFor()
  await page.getByRole('button', { name: '新建计划', exact: true }).click()
  await page.getByLabel('每期金额', { exact: true }).fill('1.2.3')
  await page.getByRole('button', { name: '确认创建', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: '有效金额' }).waitFor()
  assert(!writes.some(w => w.path === '/api/wealth/investments/plan'))
  await visit('/credit', '借款与分期')
  await page.getByRole('button', { name: '立即借款', exact: true }).click()
  await page.getByLabel('借款金额', { exact: true }).fill('100.001')
  await page.getByRole('button', { name: '确认借款', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: '有效金额' }).waitFor()
  assert(!writes.some(w => w.path === '/api/credit/loans/apply'))
  console.log('PASS 定投账户加载失败可重试，定投/借款金额错误不发办理请求')

  await visit('/security/membership', '会员与订阅')
  const membershipText = await page.locator('main').innerText()
  assert(membershipText.includes('自动续费设置已关闭'))
  assert(!membershipText.includes('尚未开通付费会员'))
  assert(!membershipText.includes('-¥'))
  assert(membershipText.includes('扣费与权益暂未开放'))
  console.log('PASS 取消续费状态与套餐记录不伪装为实际扣款')

  const views = [['/exchange','多币种换汇'],['/security/identity','身份认证'],['/cashflow','工资与备用金'],
    ['/wealth/cash-management','现金管理'],['/credit','借款与分期'],['/wealth/investments','投资与定投'],
    ['/dashboard/savings','存钱计划'],['/security/membership','会员与订阅']]
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    for (const [url, title] of views) {
      await visit(url, title)
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${url} 在 ${width}px 溢出`)
    }
  }
  assert.deepEqual(errors, [])
  console.log('PASS 八个页面在 320/390/1440px 无横向溢出，无页面运行异常')
} finally { await browser?.close(); await web.close() }
