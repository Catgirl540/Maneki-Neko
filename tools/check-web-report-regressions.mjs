/** 2026-10-13 客户端报告回归：仅前端 + 拦截式接口夹具，不连接银行/Agent 服务。 */
import assert from 'node:assert/strict'
import path from 'node:path'
import { createServer } from '../app/node_modules/vite/dist/node/index.js'
import { chromium } from 'playwright-core'

const root = path.resolve(import.meta.dirname, '..')
Object.assign(process.env, { VITE_USE_MOCK: 'false', VITE_BASE_PATH: '/', VITE_API_BASE_URL: '', VITE_AGENT_URL: '/agent-api' })
const web = await createServer({ root: path.join(root, 'app'), configFile: path.join(root, 'app/vite.config.ts'),
  logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false, allowedHosts: ['web-report.test'] } })
const user = { id: 'report-fixture', name: '测试客户', phone: '13900139000', memberTier: 'standard', avatarInitial: '测' }
const account = { id: 'a0', kind: 'savings', label: '储蓄账户', currency: 'CNY', accountNo: '8820000000000000001', balance: 1000000, available: 1000000, interestRate: 0, monthNetChange: 0 }
const receiving = { holder: user.name, accountNo: account.accountNo, accountLabel: account.label, bankName: '测试银行', bankRegion: 'CN', fpsMobile: user.phone, fpsId: '2046881' }
const products = ['R1', 'R5'].map((risk, i) => ({ code: `P${i}`, name: `测试产品${i}`, issuer: '测试理财公司', category: 'fixed', risk, principalProtected: false,
  benchmark: { kind: 'range', low: .01, high: .03, basis: '测试基准' }, nav: 1, navDate: '2026-10-13', sinceInception: .01, volatility: .01, minAmount: 10000, stepAmount: 100, term: '随时赎回', openEnded: true, ongoingFees: [], transactionFees: [], navHistory: [], topHoldings: [] }))
let risk = { done: false, expired: true, level: 'C1', score: 0, assessedAt: '', expiresAt: '' }
const voiceAvailable = true
let transactionFailure = false
const transactions = Array.from({ length: 7 }, (_, i) => ({ id: `tx${i}`, accountId: account.id, counterparty: `报告流水0${i + 1}`, category: i === 6 ? 'shopping' : 'dining', direction: 'out', signedAmount: -100, amount: 100, createdAt: '2026-10-13T08:00:00.000Z', status: 'success' }))
const requests = [], errors = [], unexpected = []
let browser
try {
  await web.listen()
  const base = `http://web-report.test:${web.httpServer.address().port}`
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH,
    args: ['--host-resolver-rules=MAP web-report.test 127.0.0.1', '--no-proxy-server'] })
  async function prepare(page, signedIn = true) {
    page.setDefaultTimeout(10000)
    page.on('pageerror', e => errors.push(e.message))
    if (signedIn) await page.addInitScript(user => {
      sessionStorage.setItem('luckycat.token', JSON.stringify('fixture-token'))
      sessionStorage.setItem('luckycat.session.user', JSON.stringify(user))
    }, user)
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url())
      // 禁止夹具漏接后穿透到真实 API、代理或其它外部服务。
      const respond = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
      if (url.origin !== base) { unexpected.push(url.origin + url.pathname); return respond({}, 502) }
      if (url.pathname.startsWith('/agent-api/')) {
        if (url.pathname === '/agent-api/health') return respond({ ok: true, bankDataSource: 'http', voice: { asr: voiceAvailable, tts: voiceAvailable, stream: true } })
        unexpected.push(url.pathname); return respond({}, 404)
      }
      if (!url.pathname.startsWith('/api/')) return route.continue()
      requests.push({ method: request.method(), path: url.pathname, body: request.postData() })
      switch (url.pathname) {
        case '/api/auth/profile': return respond(user)
        case '/api/auth/login': return respond({ token: 'fixture-token', user })
        case '/api/accounts': return respond([account])
        case '/api/accounts/a0/transactions': {
          if (transactionFailure) return respond({ message: '流水暂不可用' }, 503)
          const page = Number(url.searchParams.get('page') ?? 1), size = Number(url.searchParams.get('size') ?? 5)
          const keyword = url.searchParams.get('keyword') ?? '', category = url.searchParams.get('category')
          const filtered = transactions.filter(tx => tx.counterparty.includes(keyword) && (!category || category === 'all' || tx.category === category))
          return respond({ items: filtered.slice((page - 1) * size, page * size), total: filtered.length, page, size })
        }
        case '/api/security/overview': return respond({ score: 80, level: '基础防护', riskRules: [], devices: [], logs: [] })
        case '/api/analysis/cashflow': return respond({ totalIncome: 0, totalExpense: 0, points: [] })
        case '/api/receiving': return respond(receiving)
        case '/api/cards': case '/api/payees': case '/api/banks': case '/api/wealth/risk/questions': case '/api/support/messages': return respond([])
        case '/api/membership': return respond({ tier: 'standard', tierLabel: '普通会员', aum: 0,
          nextTier: 'gold', nextThreshold: 10000000, benefits: ['基础银行服务'],
          entitlements: { freeTransferFee: false, freeOverseasRemit: false, vipChannel: false, birthdayGift: false,
            dedicatedManager: false, dedicatedAdvisor: false, wealthPriority: false, loungePassesPerYear: 0,
            cardFeeWaiversPerYear: 0, cardFeeRate: 1, includeShipping: false, fxFeeRate: 1 },
          since: null, evaluation: null, downgradeWarning: null,
          lounge: { year: 2026, perYear: 0, used: 0, remaining: 0 }, records: [] })
        case '/api/transfers/quote': return respond({ fee: 0, singleLimit: 1000000, dailyLimit: 1000000, dailyUsed: 0, totalDebit: JSON.parse(request.postData()).amount, arrivalLabel: '测试报价' })
        case '/api/wealth/products': return respond(products)
        case '/api/wealth/overview': return respond({ account: { opened: false }, totalValue: 0, totalPrincipal: 0, totalProfit: 0, yesterdayProfit: 0, holdings: [], risk })
        default: unexpected.push(url.pathname); return respond({ message: '测试未提供此接口' }, 404)
      }
    })
  }
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
  await prepare(page)
  async function visit(url) { await page.goto(base + url) }
  await visit('/accounts?flow=in')
  assert.equal(await page.evaluate(() => isSecureContext), false, '测试必须运行在真实 HTTP 非安全上下文')
  const incoming = page.getByRole('dialog', { name: '转入', exact: true })
  await incoming.getByRole('button', { name: '复制全部', exact: true }).waitFor()
  assert.equal(await page.evaluate(() => navigator.clipboard), undefined)
  assert(!(await incoming.innerText()).includes('2046881'))
  assert(!(await incoming.innerText()).includes(user.phone))
  assert((await incoming.innerText()).includes('FPS 登记状态待确认'))
  const texts = await incoming.locator('p').allTextContents()
  assert(texts.includes(account.accountNo))
  console.log('PASS 非安全 HTTP 环境，未确认归属的 FPS 标识不展示')

  // 自动复制可用时实际检查内容，不仅断言点击成功；仍拦截系统剪贴板避免污染本机。
  await page.evaluate(() => {
    window.fixtureCopies = []
    document.execCommand = command => {
      const field = document.activeElement
      if (command !== 'copy' || !(field instanceof HTMLTextAreaElement) || field.selectionStart !== 0 || field.selectionEnd !== field.value.length) return false
      window.fixtureCopies.push(field.value)
      return true
    }
  })
  await incoming.getByRole('button', { name: '复制收款账户', exact: true }).click()
  await page.getByText('已复制收款账户', { exact: true }).waitFor()
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), '复制收款账户')
  await incoming.getByRole('button', { name: '复制全部', exact: true }).click()
  await page.getByText('已复制收款信息', { exact: true }).waitFor()
  assert.deepEqual(await page.evaluate(() => window.fixtureCopies), [account.accountNo, `收款户名：${user.name}\n收款账户：${account.accountNo}\n收款银行：测试银行（内地）`])
  assert.equal(await page.getByRole('dialog').count(), 1)
  console.log('PASS HTTP 兼容复制：单项/全部内容一致、焦点恢复，无未登记 FPS 标识')

  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('权限受限')) } })
  })
  await incoming.getByRole('button', { name: '复制收款账户', exact: true }).click()
  await page.waitForFunction(() => window.fixtureCopies.length === 3)
  await page.evaluate(() => { document.execCommand = () => false })
  await incoming.getByRole('button', { name: '复制全部', exact: true }).click()
  const manual = page.getByRole('dialog', { name: '手动复制收款信息', exact: true })
  await manual.waitFor()
  const complete = manual.getByRole('textbox', { name: '收款信息', exact: true })
  assert.equal(await complete.inputValue(), await page.evaluate(() => window.fixtureCopies[1]))
  await complete.focus()
  assert(await complete.evaluate(el => el.selectionStart === 0 && el.selectionEnd === el.value.length))
  await manual.getByRole('button', { name: '完成', exact: true }).click()
  await manual.waitFor({ state: 'detached' })
  await incoming.getByRole('button', { name: '复制收款账户', exact: true }).click()
  const single = page.getByRole('dialog', { name: '手动复制收款账户', exact: true })
  await single.waitFor()
  assert.equal(await single.getByRole('textbox', { name: '收款账户', exact: true }).inputValue(), account.accountNo)
  console.log('PASS 现代剪贴板拒绝时可降级；全部复制失败后可选择完整单项/全部文本')

  await visit('/accounts?flow=out')
  const outgoing = page.getByRole('dialog', { name: '转出', exact: true })
  const amount = outgoing.getByLabel('转账金额', { exact: true })
  await amount.waitFor()
  for (const invalid of ['-100', '1.2.3', '12abc', '1e3', '10.001']) {
    await amount.fill(invalid)
    assert.equal(await amount.inputValue(), invalid)
    await outgoing.getByRole('button', { name: '下一步', exact: true }).click()
    await outgoing.getByText('请输入有效转账金额，最多两位小数', { exact: true }).waitFor()
  }
  await amount.fill('0')
  await outgoing.getByRole('button', { name: '下一步', exact: true }).click()
  await outgoing.getByText('请输入转账金额', { exact: true }).waitFor()
  assert(!requests.some(r => r.path.startsWith('/api/transfers')))
  await amount.fill('100.01')
  await outgoing.getByRole('button', { name: '下一步', exact: true }).click()
  await outgoing.getByLabel('收款人', { exact: true }).waitFor()
  console.log('PASS 转账保留原输入、负数/格式错误不询价不提交，合法小数可进入下一步')

  await visit('/analysis?account=a0')
  await page.getByRole('link').filter({ hasText: '报告流水01' }).waitFor()
  await page.getByRole('button', { name: '下一页', exact: true }).click()
  await page.getByRole('link').filter({ hasText: '报告流水07' }).waitFor()
  assert.equal(await page.getByRole('link').filter({ hasText: '报告流水01' }).count(), 0)
  assert(await page.getByRole('button', { name: '下一页', exact: true }).isDisabled())
  assert.equal(new URL(page.url()).searchParams.get('account'), 'a0')
  assert.equal(new URL(page.url()).searchParams.get('page'), '2')
  await page.getByRole('button', { name: '上一页', exact: true }).click()
  await page.getByRole('link').filter({ hasText: '报告流水01' }).waitFor()
  transactionFailure = true
  await page.getByRole('button', { name: '下一页', exact: true }).click()
  await page.getByText('流水暂不可用', { exact: true }).waitFor()
  assert.equal(await page.getByRole('link').filter({ hasText: '报告流水01' }).count(), 0)
  transactionFailure = false
  await page.getByRole('button', { name: '重新加载流水', exact: true }).click()
  await page.getByRole('link').filter({ hasText: '报告流水07' }).waitFor()
  await page.getByLabel('交易搜索', { exact: true }).fill('报告流水01')
  await page.getByLabel('交易搜索', { exact: true }).press('Enter')
  await page.getByRole('link').filter({ hasText: '报告流水01' }).waitFor()
  assert.equal(new URL(page.url()).searchParams.get('page'), null)
  assert.equal(new URL(page.url()).searchParams.get('q'), '报告流水01')
  await page.getByRole('button', { name: '清除关键词', exact: true }).click()
  await page.getByRole('button', { name: '下一页', exact: true }).click()
  await page.getByRole('link').filter({ hasText: '报告流水07' }).waitFor()
  await page.getByRole('tab', { name: '购物', exact: true }).click()
  await page.getByRole('link').filter({ hasText: '报告流水07' }).waitFor()
  assert.equal(new URL(page.url()).searchParams.get('page'), null)
  await page.goto(base + '/analysis?account=a0&page=99')
  await page.getByRole('button', { name: '回到第一页', exact: true }).click()
  await page.getByRole('link').filter({ hasText: '报告流水01' }).waitFor()
  console.log('PASS 第七笔流水可翻页查看，换筛选重置页码，失败可重试且不冒用旧页结果')

  await visit('/security')
  await page.getByRole('heading', { name: '我的', exact: true }).waitFor()
  await page.getByText('暂无安全日志', { exact: true }).waitFor()
  assert.equal(await page.getByText('暂无设备记录', { exact: true }).count(), 2)
  assert(!(await page.locator('main').innerText()).includes('台设备可访问此账户'))
  console.log('PASS 登录设备/审计日志为空显示真实空态，不虚构设备与日志')

  for (const [done, expired, expected] of [[false, true, '需先完成风险测评'], [true, true, '测评已过期，需重新评估'], [true, false, '超出你的风险承受能力']]) {
    risk = { ...risk, done, expired }
    await visit('/wealth/products')
    await page.getByRole('row').filter({ hasText: products[1].name }).getByText(expected, { exact: true }).waitFor()
    if (done && !expired) await page.getByRole('row').filter({ hasText: products[0].name }).getByText('风险匹配', { exact: true }).waitFor()
    else assert.equal(await page.getByText('超出你的风险承受能力', { exact: true }).count(), 0)
  }
  console.log('PASS 未测评、已过期、超风险、风险匹配四种理财产品状态分开显示')

  await visit('/support')
  const voice = page.getByRole('button', { name: '语音输入', exact: true })
  await voice.waitFor()
  assert(await voice.isDisabled())
  assert.equal(await voice.getAttribute('title'), '当前连接不支持录音，请使用 HTTPS 地址。')
  console.log('PASS HTTP 语音入口显示禁用原因，不请求麦克风权限')

  const anon = await browser.newPage()
  await prepare(anon, false)
  for (const destination of ['/accounts?flow=out#payment', '/security?source=history#devices']) {
    await anon.goto(base + destination)
    await anon.getByRole('heading', { name: '登录您的账户', exact: true }).waitFor()
    await anon.getByLabel('手机号', { exact: true }).fill(user.phone)
    await anon.getByLabel('密码', { exact: true }).fill('FixturePassword!')
    await anon.getByLabel('短信验证码', { exact: true }).fill('123456')
    await anon.getByRole('button', { name: '登入', exact: true }).click()
    await anon.waitForURL(base + destination)
    if (destination.includes('flow=out')) await anon.getByRole('dialog', { name: '转出', exact: true }).waitFor()
    await anon.evaluate(() => sessionStorage.clear())
  }
  console.log('PASS 登录后恢复来源的路径、查询参数、锚点，转出深链自动打开')

  for (const width of [1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    for (const url of ['/accounts?flow=in', '/accounts?flow=out', '/analysis', '/security', '/wealth/products', '/support']) {
      await visit(url)
      if (url.includes('flow=in')) await page.getByRole('dialog', { name: '转入', exact: true }).getByRole('button', { name: '复制全部', exact: true }).waitFor()
      else if (url.includes('flow=out')) await page.getByLabel('转账金额', { exact: true }).waitFor()
      else if (url === '/analysis') await page.getByRole('link').filter({ hasText: '报告流水01' }).waitFor()
      else if (url === '/wealth/products') await page.getByRole('row').filter({ hasText: products[1].name }).waitFor()
      else if (url === '/support') await page.getByRole('button', { name: '语音输入', exact: true }).waitFor()
      else await page.getByText('暂无安全日志', { exact: true }).waitFor()
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${url} 在 ${width}px 溢出`)
    }
  }
  assert.deepEqual(errors, [])
  assert.deepEqual(unexpected, [])
  assert(!requests.some(r => r.method !== 'GET' && r.path !== '/api/auth/login' && r.path !== '/api/transfers/quote'))
  console.log('PASS 六个页面/弹窗在 1024/1280/1440px 无横向溢出，无运行异常，无真实服务请求')
} finally { await browser?.close(); await web.close() }
