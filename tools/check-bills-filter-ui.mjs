/**
 * 账单页（`/analysis`）筛选抽屉的浏览器回归：只启动网页前端，银行接口全用测试响应。
 *
 * 断言的是**筛选条件真的走到了请求上**：抽屉能开能关、四组各只选一项、重置回到默认、
 * 应用后角标计数正确、URL search params 写入、列表请求带上 `direction`/`category`/
 * `from`/`to`/`currency` 且清掉 `page`，以及全程没有页面运行异常。
 *
 * 收支方向没有在前端过滤：夹具返回的数据里同时有收入和支出，如果实现是"对当前页
 * 过滤"，第一次请求就不会带 `direction`，这里能直接抓出来。
 *
 *   CHROME_PATH=/snap/bin/chromium node tools/check-bills-filter-ui.mjs
 */

import assert from 'node:assert/strict'
import path from 'node:path'
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

const user = { id: 'fixture-user', name: '测试客户', phone: '13900139000', memberTier: 'standard', avatarInitial: '测' }
const accountNo = '8888888888888821'
const cny = { id: 'acc-cny', kind: 'current', label: '人民币活期', accountNo, currency: 'CNY', balance: 1_280_000, available: 1_280_000, interestRate: 0.0155, monthNetChange: -320_00 }
const hkd = { id: 'acc-hkd', kind: 'current', label: 'HKD 余额', accountNo, currency: 'HKD', balance: 520_000, available: 520_000, interestRate: 0.0125, monthNetChange: 0 }
const accounts = [{ ...cny, currencyBalances: [cny, hkd] }]

/** 本地日 YYYY-MM-DD —— 夹具算「近 7 天」的边界也用本地日，和页面同一口径。 */
const localDay = (date) => {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
const daysAgo = (n) => {
  const now = new Date()
  return localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - n))
}

const transaction = (id, direction, category, day, amount) => ({
  id,
  accountId: cny.id,
  direction,
  amount,
  signedAmount: direction === 'in' ? amount : -amount,
  counterparty: `${category}-${direction}`,
  memo: '',
  category,
  createdAt: `${day}T12:00:00+08:00`,
  status: 'success',
})

const allTransactions = [
  transaction('tx-1', 'out', 'dining', daysAgo(1), 3800),
  transaction('tx-2', 'in', 'salary', daysAgo(2), 1_800_000),
  transaction('tx-3', 'out', 'shopping', daysAgo(20), 12_650),
  transaction('tx-4', 'in', 'transfer', daysAgo(200), 500_000),
  transaction('tx-5', 'out', 'dining', daysAgo(100), 5_200),
  // 第 7 笔让列表有 2 页（每页 6 条），用来验证筛选不会把分页弄坏。
  transaction('tx-6', 'out', 'transport', daysAgo(3), 600),
  transaction('tx-7', 'in', 'salary', daysAgo(4), 1_800_000),
]

/**
 * 按查询参数过滤 —— 与后端 `listTransactions` 同口径。
 * 记录每次请求的 query，供断言"筛选真的传给了接口"。
 */
const requests = []
function listTransactions(searchParams, partitionCurrency) {
  const query = Object.fromEntries(searchParams)
  requests.push(query)
  const direction = query.direction ?? 'all'
  const category = query.category ?? 'all'
  const currency = query.currency ?? 'all'
  const page = Number(query.page ?? '1')
  const size = Number(query.size ?? '6')
  // 记账分区是单币种的：请求的币种和这个分区对不上就没有可对账的流水。
  if (currency !== 'all' && currency !== partitionCurrency) {
    return { items: [], page, size, total: 0 }
  }
  const partition = accounts[0].currencyBalances.find(row => row.currency === partitionCurrency)
  let rows = allTransactions.filter(row => row.accountId === partition.id)
  if (direction !== 'all') rows = rows.filter(row => row.direction === direction)
  if (category !== 'all') rows = rows.filter(row => row.category === category)
  if (query.from) rows = rows.filter(row => localDay(new Date(row.createdAt)) >= query.from)
  if (query.to) rows = rows.filter(row => localDay(new Date(row.createdAt)) <= query.to)
  const start = (page - 1) * size
  return { items: rows.slice(start, start + size), page, size, total: rows.length }
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

  await page.route('**/agent-api/**', route =>
    route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'agent 未启动' }) }))

  await page.route('**/api/**', route => {
    const request = route.request()
    // 只看真正的 `/api/` 接口：Vite 开发服务器的模块路径里也有 `src/api/`。
    if (!new URL(request.url()).pathname.startsWith('/api/')) return route.continue()
    const url = new URL(request.url())
    const respond = (data, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    switch (url.pathname) {
      case '/api/accounts': return respond(accounts)
      case `/api/accounts/${cny.id}/transactions`: return respond(listTransactions(url.searchParams, cny.currency))
      case `/api/accounts/${hkd.id}/transactions`: return respond(listTransactions(url.searchParams, hkd.currency))
      case '/api/security/overview': return respond({ logs: [], devices: [], riskRules: [], score: 80, level: '基础防护' })
      case '/api/support/messages': return respond([])
      default: return respond({ message: '测试未提供此接口' }, 404)
    }
  })

  await page.goto(`${base}/analysis`)
  const main = page.locator('main')
  await main.getByRole('heading', { name: '交易流水', exact: true }).waitFor()
  await main.getByText('共 7 笔', { exact: true }).waitFor()
  assert.equal(requests.at(-1).direction, undefined)
  assert.equal(requests.at(-1).from, undefined)
  console.log('PASS /analysis 首次加载不带收支方向与时间范围，列表显示 7 笔')

  // 分页先过一遍：加了筛选之后这条路径不能被弄坏。
  await main.getByRole('navigation', { name: '流水分页' }).getByRole('button', { name: '下一页', exact: true }).click()
  await main.getByText('第 2 页 / 共 2 页', { exact: true }).waitFor()
  assert.equal(requests.at(-1).page, '2')
  assert.equal(new URL(page.url()).searchParams.get('page'), '2')
  await main.getByRole('navigation', { name: '流水分页' }).getByRole('button', { name: '上一页', exact: true }).click()
  await main.getByText('第 1 页 / 共 2 页', { exact: true }).waitFor()
  console.log('PASS 分页照旧：第 2 页请求带 page=2，上一页回到第 1 页')

  // —— 抽屉：开 → 四组各单选 → 重置 → 应用 ——
  const trigger = main.getByRole('button', { name: /^筛选/ })
  assert.equal(await trigger.getAttribute('aria-expanded'), 'false')
  await trigger.click()
  const drawer = page.getByRole('dialog', { name: '筛选', exact: true })
  await drawer.waitFor()
  assert.equal(await trigger.getAttribute('aria-expanded'), 'true')
  // 作用域化到抽屉内：遮罩按钮、卡片里的 chips 都不会被误命中
  for (const group of ['收支', '分类', '时间范围', '币种']) {
    await drawer.getByRole('group', { name: group, exact: true }).waitFor()
  }
  console.log('PASS 点「筛选」打开右侧抽屉，四组条件都在（收支 / 分类 / 时间范围 / 币种）')

  const group = name => drawer.getByRole('group', { name, exact: true })
  const pressed = async (name, label) => group(name).getByRole('button', { name: label, exact: true }).getAttribute('aria-pressed')

  // 每组默认项已选中
  assert.equal(await pressed('收支', '全部'), 'true')
  assert.equal(await pressed('时间范围', '不限'), 'true')
  assert.equal(await pressed('币种', '全部'), 'true')

  // 收支：单选（选支出再选收入，支出必须让位）
  await group('收支').getByRole('button', { name: '支出', exact: true }).click()
  assert.equal(await pressed('收支', '支出'), 'true')
  assert.equal(await pressed('收支', '全部'), 'false')
  await group('收支').getByRole('button', { name: '收入', exact: true }).click()
  assert.equal(await pressed('收支', '收入'), 'true')
  assert.equal(await pressed('收支', '支出'), 'false')
  await group('收支').getByRole('button', { name: '支出', exact: true }).click()
  console.log('PASS 收支组单选：选中的项唯一，切换时上一项取消选中')

  // 分类：8 类 + 全部，同样单选
  for (const label of ['餐饮', '购物', '房租', '交通', '订阅服务', '转账', '工资入账', '其他']) {
    await group('分类').getByRole('button', { name: label, exact: true }).waitFor()
  }
  await group('分类').getByRole('button', { name: '餐饮', exact: true }).click()
  assert.equal(await pressed('分类', '餐饮'), 'true')
  assert.equal(await pressed('分类', '全部'), 'false')

  await group('时间范围').getByRole('button', { name: '近 7 天', exact: true }).click()
  assert.equal(await pressed('时间范围', '近 7 天'), 'true')
  assert.equal(await pressed('时间范围', '不限'), 'false')

  await group('币种').getByRole('button', { name: '港币 HKD', exact: true }).click()
  assert.equal(await pressed('币种', '港币 HKD'), 'true')
  assert.equal(await pressed('币种', '全部'), 'false')
  console.log('PASS 分类 / 时间范围 / 币种三组单选生效，分类组含 8 个分类 + 全部')

  // 还没按「应用」：URL 与请求都不该变
  assert(!page.url().includes('direction='))
  assert.equal(requests.at(-1).direction, undefined)
  console.log('PASS 抽屉内改动先停在草稿：未点「应用」前 URL 与列表请求都不变')

  // 重置：四组回默认，抽屉不关
  await drawer.getByRole('button', { name: '重置', exact: true }).click()
  assert.equal(await pressed('收支', '全部'), 'true')
  assert.equal(await pressed('分类', '全部'), 'true')
  assert.equal(await pressed('时间范围', '不限'), 'true')
  assert.equal(await pressed('币种', '全部'), 'true')
  assert.equal(await drawer.isVisible(), true)
  console.log('PASS 「重置」把四组恢复默认且不关闭抽屉')

  // 关掉再开：草稿重新从 URL 起算，不保留上次未应用的改动
  await drawer.getByRole('button', { name: '关闭抽屉', exact: true }).click()
  await drawer.waitFor({ state: 'detached' })
  assert.equal(await trigger.getAttribute('aria-expanded'), 'false')
  assert.equal(await trigger.locator('span[aria-hidden="true"]').count(), 0)
  console.log('PASS 「关闭抽屉」关闭面板，无筛选时漏斗按钮不显示角标')

  await trigger.click()
  await drawer.waitFor()
  await group('收支').getByRole('button', { name: '支出', exact: true }).click()
  await group('分类').getByRole('button', { name: '餐饮', exact: true }).click()
  await group('时间范围').getByRole('button', { name: '近 7 天', exact: true }).click()
  await group('币种').getByRole('button', { name: '人民币 CNY', exact: true }).click()
  await drawer.getByRole('button', { name: '应用', exact: true }).click()
  await drawer.waitFor({ state: 'detached' })
  console.log('PASS 点「应用」后抽屉关闭')

  // —— URL 写入 ——
  const params = new URL(page.url()).searchParams
  assert.equal(params.get('direction'), 'out')
  assert.equal(params.get('category'), 'dining')
  assert.equal(params.get('range'), '7d')
  assert.equal(params.get('currency'), 'CNY')
  assert.equal(params.get('page'), null)
  console.log(`PASS 应用后 URL 写入 ${params.toString()}`)

  // —— 角标：四组非默认项各算 1 ——
  const badge = trigger.locator('span[aria-hidden="true"]')
  await badge.waitFor()
  assert.equal(await badge.innerText(), '4')
  assert.match(await trigger.innerText(), /已选 4 项/)
  console.log('PASS 角标显示已选条件数 4，且按钮可读文本带「已选 4 项」')

  // —— 请求参数：方向 / 分类 / 时间范围 / 币种都到了接口上 ——
  const filtered = requests.at(-1)
  assert.equal(filtered.direction, 'out')
  assert.equal(filtered.category, 'dining')
  assert.equal(filtered.currency, 'CNY')
  assert.equal(filtered.from, daysAgo(6))
  assert.equal(filtered.to, daysAgo(0))
  // `page` 从 URL 里摘掉了（上面断言过），请求本身带的是第一页。
  assert.equal(filtered.page, '1')
  await main.getByText('共 1 笔', { exact: true }).waitFor()
  console.log(`PASS 列表请求带 direction=out&category=dining&from=${filtered.from}&to=${filtered.to}&currency=CNY，URL 已清空 page，结果 1 笔`)

  // 换到只命中支出的分类会得到空态；清空筛选按钮同时摘掉四组条件
  await main.getByRole('button', { name: /^筛选/ }).click()
  await drawer.waitFor()
  await group('分类').getByRole('button', { name: '工资入账', exact: true }).click()
  await drawer.getByRole('button', { name: '应用', exact: true }).click()
  await drawer.waitFor({ state: 'detached' })
  await main.getByText('没有匹配的流水', { exact: true }).waitFor()
  await main.getByRole('button', { name: '清空筛选', exact: true }).click()
  await main.getByText('共 7 笔', { exact: true }).waitFor()
  const cleared = new URL(page.url()).searchParams
  for (const key of ['direction', 'category', 'range', 'currency', 'page']) {
    assert.equal(cleared.get(key), null, `清空筛选后不应残留 ${key}`)
  }
  assert.equal(await trigger.locator('span[aria-hidden="true"]').count(), 0)
  console.log('PASS 「清空筛选」摘掉四组条件与分页，角标消失，列表回到 7 笔')

  // —— 刷新后筛选可恢复 ——
  await page.goto(`${base}/analysis?direction=out&category=dining&range=7d&currency=CNY`)
  await main.getByText('共 1 笔', { exact: true }).waitFor()
  await main.getByRole('button', { name: /^筛选/ }).click()
  await drawer.waitFor()
  assert.equal(await pressed('收支', '支出'), 'true')
  assert.equal(await pressed('分类', '餐饮'), 'true')
  assert.equal(await pressed('时间范围', '近 7 天'), 'true')
  assert.equal(await pressed('币种', '人民币 CNY'), 'true')
  console.log('PASS 直接打开带筛选参数的 URL：抽屉回填四组条件，列表按条件请求')

  // —— Esc 关闭 ——
  await page.keyboard.press('Escape')
  await drawer.waitFor({ state: 'detached' })
  console.log('PASS Esc 关闭抽屉')

  // —— 币种组与上方 chips 不打架：点 chips 清掉抽屉的币种条件 ——
  await page.goto(`${base}/analysis?currency=HKD`)
  await main.getByText('共 0 笔', { exact: true }).waitFor()
  await main.getByRole('button', { name: '人民币 · CNY', exact: true }).click()
  await main.getByText('共 7 笔', { exact: true }).waitFor()
  assert.equal(new URL(page.url()).searchParams.get('currency'), null)
  console.log('PASS 点币种 chips 选回人民币分区时清掉抽屉的 currency 条件，列表恢复 7 笔')

  // —— 布局 ——
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: 1100 })
    await main.getByRole('button', { name: /^筛选/ }).click()
    await drawer.waitFor()
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `/analysis 在 ${width}px 溢出`)
    await page.keyboard.press('Escape')
    await drawer.waitFor({ state: 'detached' })
  }
  console.log('PASS 1440/1024px 抽屉打开时无横向溢出')

  assert.deepEqual(errors, [])
  console.log('ALL PASS 账单筛选抽屉：开关、四组单选、重置、应用、角标、URL 与请求参数、刷新恢复，无页面运行异常')
  console.log('未启动后端服务；账户与流水接口全部为测试夹具。')
} finally {
  await browser?.close()
  await web.close()
}
