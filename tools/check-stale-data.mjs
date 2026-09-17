/**
 * 本地数据过期 / 渲染崩溃的回归测试。
 *
 * 起因：交易详情页在「浏览器里存着旧结构模拟库」时白屏 —— 页面读 `detail.accountNo`
 * 拿到 undefined，`undefined.replace()` 抛出，React 卸载整棵树。
 * 只测新装、不测升级，就会漏掉这类问题，所以把它固化成检查项。
 *
 *   1. 全新安装                        → 正常渲染
 *   2. localStorage 里残留旧键的脏数据 → 键被清理，正常渲染
 *   3. 同一个键但结构版本对不上        → 自动重建，正常渲染
 *   4. 结构版本正确但字段缺失（真崩溃）→ 出可读的错误页 + 能一键恢复，而不是白屏
 *
 *   node tools/check-stale-data.mjs [baseUrl]
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

const browser = await chromium.launch({ executablePath: await findChrome() })
const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, locale: 'zh-CN' })

let failures = 0
const report = (ok, title, lines = []) => {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${title}`)
  for (const line of lines) console.log(`      ${line}`)
}

const tab = await context.newPage()
const crashes = []
const consoleErrors = []
tab.on('pageerror', (e) => crashes.push(e.message))
tab.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text())
})

const login = () =>
  tab.evaluate(() => {
    localStorage.setItem('luckycat.token', JSON.stringify('check.token'))
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
  })

/** 打开交易详情，返回页面可见文本（main 不存在时返回空串） */
async function openDetail(id = 'txn_0005') {
  await tab.goto(`${BASE}/transactions/${id}`, { waitUntil: 'networkidle' })
  await tab.waitForTimeout(1300)
  const main = tab.locator('main')
  const hasMain = (await main.count()) > 0
  return hasMain ? (await main.innerText()).replace(/\s+/g, ' ') : ''
}

// —— 1. 全新安装 ——
await tab.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
await tab.evaluate(() => localStorage.clear())
await login()
{
  const text = await openDetail()
  report(text.includes('Manner Coffee') && text.includes('交易编号'), '① 全新安装能正常打开交易详情', [
    text.slice(0, 74),
  ])
}

// —— 2. 残留的旧键脏数据（缺 accountLabel / accountNo / counterpartyName）——
{
  await tab.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('luckycat.mock.db'))
    for (const tx of db.transactions) {
      delete tx.detail.accountLabel
      delete tx.detail.accountNo
      delete tx.detail.counterpartyName
    }
    // 模拟今天真实发生的事：旧结构留在一个旧 key 下
    localStorage.setItem('luckycat.mock.db.v2', JSON.stringify(db))
  })
  const text = await openDetail()
  const leftover = await tab.evaluate(() => ({
    v1: localStorage.getItem('luckycat.mock.db.v1'),
    v2: localStorage.getItem('luckycat.mock.db.v2'),
  }))
  report(
    text.includes('Manner Coffee') && leftover.v1 === null && leftover.v2 === null,
    '② 旧键脏数据被清理且页面不受影响',
    [`遗留键 mock.db.v1=${leftover.v1} / mock.db.v2=${leftover.v2}`, text.slice(0, 74)],
  )
}

// —— 3. 同一个键、结构版本对不上 ——
{
  await tab.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('luckycat.mock.db'))
    for (const tx of db.transactions) delete tx.detail.accountNo
    db.schema = 1
    localStorage.setItem('luckycat.mock.db', JSON.stringify(db))
  })
  const text = await openDetail()
  const schema = await tab.evaluate(
    () => JSON.parse(localStorage.getItem('luckycat.mock.db')).schema,
  )
  report(text.includes('Manner Coffee') && schema !== 1, '③ 结构版本过期自动重建', [
    `重建后 schema=${schema}`,
    text.slice(0, 74),
  ])
}

// —— 4. 真的崩了：结构版本正确但字段缺失，兜底必须是错误页而不是白屏 ——
{
  await tab.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('luckycat.mock.db'))
    db.transactions[0].detail = null
    localStorage.setItem('luckycat.mock.db', JSON.stringify(db))
  })
  crashes.length = 0
  consoleErrors.length = 0
  const id = await tab.evaluate(
    () => JSON.parse(localStorage.getItem('luckycat.mock.db')).transactions[0].id,
  )
  await tab.goto(`${BASE}/transactions/${id}`, { waitUntil: 'networkidle' })
  await tab.waitForTimeout(1300)
  const body = (await tab.locator('body').innerText()).replace(/\s+/g, ' ')
  // 错误边界会「吃掉」异常（这正是它的职责），所以 window 的 pageerror 是空的，
  // 真正发生过的证据在 componentDidCatch 的 console.error 里
  const logged = consoleErrors.some((t) => t.includes('页面渲染失败'))
  const okCaught =
    body.includes('页面出错了') && body.includes("reading 'replace'") && logged
  report(okCaught, '④ 渲染崩溃时给可读的错误页，不是白屏', [
    `页面文案：${body.slice(0, 74)}`,
    `异常已被 componentDidCatch 记录：${logged}`,
    `未捕获到 window.pageerror：${crashes.length === 0}（预期为空，边界已拦截）`,
  ])

  // 恢复路径
  await tab.getByRole('button', { name: '重置演示数据' }).click()
  await tab.waitForTimeout(1500)
  const recovered = new URL(tab.url()).pathname
  const loginVisible = (await tab.locator('body').innerText()).includes('登录')
  report(recovered === '/login' || loginVisible, '④b 错误页的「重置演示数据」能恢复', [
    `跳转到 ${recovered}`,
  ])
}

await browser.close()
console.log(failures === 0 ? '\n全部通过 ✅' : `\n${failures} 项未通过 ❌`)
process.exit(failures === 0 ? 0 : 1)
