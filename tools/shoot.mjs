/**
 * 视觉走查脚本：用本机已有的 Chromium 打开 dev server，
 * 注入登录态后逐页截图，输出到 design/shots/。
 *
 *   node tools/shoot.mjs [baseUrl]
 */
import { chromium } from 'playwright-core'
import { mkdir, readdir } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

const BASE = process.argv[2] ?? 'http://127.0.0.1:5180'
const OUT = path.resolve(import.meta.dirname, '../design/shots')

const PAGES = [
  { name: '01-login', path: '/login', auth: false },
  { name: '02-dashboard', path: '/', auth: true },
  { name: '03-transfer', path: '/transfer', auth: true },
  { name: '04-cards', path: '/cards', auth: true },
  { name: '05-analysis', path: '/analysis', auth: true },
  { name: '06-security', path: '/security', auth: true },
  { name: '07-support', path: '/support', auth: true },
  // 只截视口：用来检查长页面下侧栏是否仍然只有一屏高
  { name: '08-sidebar-viewport', path: '/security', auth: true, viewportOnly: true },
  {
    name: '09-sidebar-collapsed',
    path: '/security',
    auth: true,
    viewportOnly: true,
    collapsed: true,
  },
  { name: '10-dashboard-collapsed', path: '/', auth: true, collapsed: true },
  // 转账两条通道
  { name: '11-transfer-fps', path: '/transfer', auth: true, clicks: ['转数快 / 跨境支付通'] },
  {
    name: '12-transfer-fps-mobile',
    path: '/transfer',
    auth: true,
    clicks: ['转数快 / 跨境支付通', '手机号'],
  },
  {
    name: '13-transfer-bank-account',
    path: '/transfer',
    auth: true,
    clicks: ['陈嘉禾'],
  },
  {
    name: '14-transfer-fps-review',
    path: '/transfer',
    auth: true,
    clicks: ['转数快 / 跨境支付通', '梁乐怡'],
    fill: { 转账金额: '800' },
    clicksAfter: ['下一步'],
    settleMs: 1800,
  },
  // 乐观更新后的轻提示
  { name: '15-toast-optimistic', path: '/analysis', auth: true, clickSwitch: true, settleMs: 500 },
  // 交易详情（电子回单）：外币 / 转账 / 港币三种字段组合
  { name: '16-tx-detail-fx-usd', path: '/analysis', auth: true, clicks: ['FIRWWORKS.AI'], settleMs: 900 },
  {
    name: '17-tx-detail-transfer',
    path: '/analysis',
    auth: true,
    // 顺序是 clicks → fill → clicksAfter，所以先填搜索、再点结果行
    fill: { 搜索商户或备注: '陈嘉禾' },
    clicksAfter: ['转账 · 陈嘉禾'],
    settleMs: 900,
  },
  {
    name: '18-tx-detail-fx-hkd',
    path: '/analysis',
    auth: true,
    fill: { 搜索商户或备注: '香港' },
    clicksAfter: ['Apple Store 香港'],
    settleMs: 900,
  },
  // 打印视图：验证侧栏 / 顶栏 / 操作按钮确实被 @media print 隐藏
  {
    name: '19-tx-detail-print',
    path: '/analysis',
    auth: true,
    clicks: ['FIRWWORKS.AI'],
    printMedia: true,
    settleMs: 900,
  },
  // 错误边界：故意把一条台账的明细打成 null，验证白屏已被兜成可读的错误页
  {
    name: '20-error-boundary',
    path: '/analysis',
    auth: true,
    corruptFirstTx: true,
    settleMs: 900,
  },
  // 换汇：扣账币种 CNY → 收款币种 HKD
  {
    name: '21-transfer-fx',
    path: '/transfer',
    auth: true,
    clicks: ['转数快 / 跨境支付通'],
    fill: { 转账金额: '1000' },
    settleMs: 1500,
  },
  {
    name: '22-transfer-fx-review',
    path: '/transfer',
    auth: true,
    clicks: ['转数快 / 跨境支付通'],
    fill: { 转账金额: '1000', 收款账号: '12345678', 收款户名: 'Wing Chan' },
    clicksAfter: ['下一步'],
    settleMs: 1600,
  },
]

/**
 * 点击页面上匹配文本的元素。
 * 先精确匹配，避免点到含相同词组的标题 / 副标题（例如页头那句
 * 「…转数快 / 跨境支付通支持…」会抢在通道卡片之前被 substring 命中）。
 */
async function runClicks(tab, clicks = []) {
  for (const text of clicks) {
    let target = tab.getByText(text, { exact: true }).first()
    if ((await target.count()) === 0) {
      target = tab.getByText(text, { exact: false }).first()
    }
    await target.waitFor({ state: 'visible', timeout: 5000 })
    await target.click()
    await tab.waitForTimeout(450)
  }
}

/** 按 label 填表单；没有 <label> 的输入框（如搜索框）退回按 placeholder 找 */
async function runFills(tab, fills = {}) {
  for (const [label, value] of Object.entries(fills)) {
    let input = tab.getByLabel(label, { exact: false }).first()
    if ((await input.count()) === 0) {
      input = tab.getByPlaceholder(label).first()
    }
    await input.waitFor({ state: 'visible', timeout: 5000 })
    await input.fill(String(value))
    await tab.waitForTimeout(500)
  }
}

async function findChrome() {
  const cache = path.join(os.homedir(), '.cache/ms-playwright')
  const dirs = (await readdir(cache)).filter((d) => d.startsWith('chromium-'))
  if (!dirs.length) throw new Error('no playwright chromium found')
  return path.join(cache, dirs.sort().at(-1), 'chrome-linux64', 'chrome')
}

const executablePath = await findChrome()
await mkdir(OUT, { recursive: true })

const browser = await chromium.launch({ executablePath })
const context = await browser.newContext({
  viewport: { width: 1440, height: 960 },
  deviceScaleFactor: 2,
  locale: 'zh-CN',
})

for (const page of PAGES) {
  const tab = await context.newPage()
  await tab.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await tab.evaluate(
    ({ auth, collapsed }) => {
      if (auth) {
        localStorage.setItem('luckycat.token', JSON.stringify('shot.token'))
        localStorage.setItem(
          'luckycat.session.user',
          JSON.stringify({
            id: 'u_0001',
            name: '林小满',
            phone: '13800138000',
            memberLevel: '金卡会员',
            avatarInitial: '林',
          }),
        )
        localStorage.setItem('luckycat.ui.sidebarCollapsed', JSON.stringify(!!collapsed))
      } else {
        localStorage.clear()
      }
    },
    { auth: page.auth, collapsed: page.collapsed },
  )

  await tab.goto(`${BASE}${page.path}`, { waitUntil: 'networkidle' })
  await tab.waitForTimeout(900)

  // 破坏数据后必须整页重新加载：mock 库在模块内还有一份内存缓存，
  // 只做 SPA 跳转拿到的仍是破坏前的数据
  if (page.corruptFirstTx) {
    const id = await tab.evaluate(() => {
      const db = JSON.parse(localStorage.getItem('luckycat.mock.db'))
      db.transactions[0].detail = null
      localStorage.setItem('luckycat.mock.db', JSON.stringify(db))
      return db.transactions[0].id
    })
    await tab.goto(`${BASE}/transactions/${id}`, { waitUntil: 'networkidle' })
    await tab.waitForTimeout(900)
  }

  await runClicks(tab, page.clicks)
  await runFills(tab, page.fill)
  await runClicks(tab, page.clicksAfter)
  if (page.clickSwitch) {
    const sw = tab.getByRole('switch').first()
    await sw.waitFor({ state: 'visible', timeout: 5000 })
    await sw.click()
  }
  // 等异步的转数快解析 / 报价 debounce 落定
  await tab.waitForTimeout(page.settleMs ?? 300)
  if (page.printMedia) await tab.emulateMedia({ media: 'print' })
  await tab.screenshot({
    path: path.join(OUT, `${page.name}.png`),
    fullPage: !page.viewportOnly,
  })
  console.log('shot', page.name)
  await tab.close()
}

await browser.close()
console.log('done ->', OUT)