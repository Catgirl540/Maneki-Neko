/**
 * 切换栏目后回到页面顶部的检查。
 *
 * 浏览器的默认行为是**保留滚动位置**：从一个滚到一半的页面点侧栏跳到另一个栏目，
 * 新页面会从同样的高度开始，看起来像「跳到了下面去」。
 *
 * 这条 bug 的特点是**不稳定复现** —— 只有当前页面足够长、而且确实滚下去过才会显形。
 * 所以检查不能只「点一下看看」，必须先把页面滚到底再切，否则永远是绿的。
 *
 *   node tools/check-scroll-top.mjs [baseUrl]
 */
import { chromium } from 'playwright-core'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

const BASE = process.argv[2] ?? 'http://127.0.0.1:5180'

async function findChrome() {
  const cache = path.join(os.homedir(), '.cache/ms-playwright')
  const dirs = (await readdir(cache)).filter((d) => d.startsWith('chromium-'))
  return path.join(cache, dirs.sort().at(-1), 'chrome-linux64', 'chrome')
}

let failures = 0
const report = (ok, title, lines = []) => {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${title}`)
  for (const line of lines) console.log(`      ${line}`)
}

const browser = await chromium.launch({ executablePath: await findChrome() })
const tab = await (await browser.newContext({ viewport: { width: 1280, height: 560 }, locale: 'zh-CN' })).newPage()

await tab.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
await tab.evaluate(() => {
  localStorage.setItem('luckycat.token', JSON.stringify('check.token'))
  localStorage.setItem(
    'luckycat.session.user',
    JSON.stringify({ id: 'u_0001', name: '林小满', phone: '13800138000', memberLevel: '金卡会员', avatarInitial: '林' }),
  )
})

const scrollY = () => tab.evaluate(() => Math.round(window.scrollY))
/**
 * 滚到底，并确认真的滚下去了 —— 页面不够长的话这条检查会退化成一个假的绿灯。
 *
 * 要重试：刚跳过去的页面可能还在加载（骨架屏只有一屏高），这时 scrollHeight 还没长开，
 * 量到的可滚距离是 0，栏目就被静默跳过了 —— 表面上「全部通过」，其实什么都没测。
 */
async function scrollToBottom() {
  for (let attempt = 0; attempt < 4; attempt++) {
    await tab.waitForTimeout(500)
    const y = await tab.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight)
      return Math.round(window.scrollY)
    })
    await tab.waitForTimeout(250)
    if (y >= 100) return y
  }
  return 0
}
async function clickNav(name) {
  await tab.getByRole('link', { name, exact: true }).first().click()
  await tab.waitForTimeout(600)
}

/** 逐个栏目检查：先把当前页滚到底，再切过去 */
const NAVS = ['转账', '银行卡', '消费分析', '理财', '安全中心']

// 视口取 1280×560：实测这个高度下几个栏目都超过一屏，每条都能真的滚下去再切

await tab.goto(`${BASE}/`, { waitUntil: 'networkidle' })
await tab.waitForTimeout(600)

const rows = []
const skipped = []
let allZero = true
for (const name of NAVS) {
  const before = await scrollToBottom()
  const testable = before >= 100
  // **无论这一轮能不能测，都要跳过去**：不然没测到的这一页会把后面几轮全连坐
  // （一直停在同一个页面上量，于是后面每个栏目都「没测到」）
  await clickNav(name)
  const after = await scrollY()
  if (!testable) {
    // 不静默跳过：真的测不到就说出来，否则这条检查会变成「永远绿」
    rows.push(`⚠️ ${name}: 出发页只有 ${before}px 可滚，没测到`)
    skipped.push(name)
    continue
  }
  rows.push(`滚到 ${before}px → 点「${name}」→ 落地 ${after}px`)
  if (after !== 0) allZero = false
}

report(allZero, '① 从滚到底的页面切栏目，落地都在顶部', rows)
report(
  skipped.length <= 1,
  '①′ 五个栏目里至少测到了四个（别让检查退化成永远绿）',
  [skipped.length ? `没测到：${skipped.join('、')}` : '全部测到'],
)

/* ------------------------------------------------ ② 详情页也要回到顶部 */
await tab.goto(`${BASE}/analysis`, { waitUntil: 'networkidle' })
await tab.waitForTimeout(700)
const beforeDetail = await scrollToBottom()
const firstTx = tab.locator('a[href^="/transactions/"]').first()
await firstTx.click()
await tab.waitForTimeout(700)
const afterDetail = await scrollY()
report(
  beforeDetail < 100 || afterDetail === 0,
  '② 从滚到底的流水列表点进交易详情，也在顶部',
  [`列表滚到 ${beforeDetail}px → 详情页 ${afterDetail}px`],
)

/* ------------------------------------------------ ③ 返回时**恢复**原位置
 *
 * 这条与 ①② 相反，是刻意的：从交易详情返回流水列表，本来就该回到原来那一行。
 * 一律滚到顶反而是帮倒忙。实现上靠 `useNavigationType()` 把 POP 让给浏览器，
 * 而不是「先滚到顶、再被浏览器恢复」那种碰巧对上的顺序。
 */
await tab.goBack()
await tab.waitForTimeout(800)
const afterBack = await scrollY()
report(
  afterBack > 100,
  '③ 返回上一页恢复原来的滚动位置（返回 ≠ 切换栏目）',
  [`返回后 ${afterBack}px（应回到离开时的位置，而不是 0）`],
)

/* ------------------------------------------------ ④ 页内 query 变化不该被拽回顶部 */
await tab.goto(`${BASE}/analysis`, { waitUntil: 'networkidle' })
await tab.waitForTimeout(700)
const kept = await tab.evaluate(async () => {
  window.scrollTo(0, 320)
  await new Promise((r) => setTimeout(r, 120))
  const before = Math.round(window.scrollY)
  history.pushState(null, '', '/analysis?month=2026-08')
  window.dispatchEvent(new PopStateEvent('popstate'))
  await new Promise((r) => setTimeout(r, 300))
  return { before, after: Math.round(window.scrollY) }
})
report(kept.after === kept.before, '④ 只是 query 变化时不动滚动位置', [
  `${kept.before}px → ${kept.after}px（应保持不变）`,
])

await browser.close()
console.log(failures === 0 ? '\n全部通过 ✅' : `\n${failures} 项未通过 ❌`)
process.exit(failures === 0 ? 0 : 1)
