/**
 * 交易详情（电子回单）冒烟测试：
 *   1. 流水行可点进详情
 *   2. 交易前余额 + 交易金额 = 交易后余额 —— 回单必须能对上账
 *   3. 复制交易编号拿到的就是页面上显示的那串号
 *   4. 打印视图里侧栏 / 顶栏 / 操作按钮全部隐藏
 *   5. 不存在的交易编号给空状态，而不是白屏
 *
 *   node tools/check-tx-detail.mjs [baseUrl]
 */
import { chromium } from 'playwright-core'
import { login, gotoInApp } from './lib/session.mjs'
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
const context = await browser.newContext({
  viewport: { width: 1440, height: 960 },
  locale: 'zh-CN',
  permissions: ['clipboard-read', 'clipboard-write'],
})

async function openTab() {
  const tab = await context.newPage()
  // 走真实登录流程：手机号 + 密码 + 短信验证码（登录态存 sessionStorage，关标签页即失效）
  await login(tab, BASE)
  return tab
}

let failures = 0
const report = (ok, title, lines = []) => {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${title}`)
  for (const line of lines) console.log(`      ${line}`)
}

/** 读「账户与余额」卡里的三条：交易前 / 交易金额 / 交易后 */
function readBalances(tab) {
  return tab.evaluate(() => {
    const dl = Array.from(document.querySelectorAll('main dl')).find((d) =>
      d.textContent.includes('交易前余额'),
    )
    if (!dl) return null
    const out = {}
    for (const row of Array.from(dl.children)) {
      const label = row.querySelector('dt')?.textContent?.trim()
      const value = row.querySelector('dd')?.textContent?.trim()
      if (label) out[label] = value
    }
    return out
  })
}

const cents = (text) =>
  text == null ? null : Math.round(Number(text.replace(/[^\d.-]/g, '')) * 100)

const tab = await openTab()

// —— 1. 从流水点进详情 ——
await gotoInApp(tab, '/analysis')
await tab.waitForTimeout(1200)
await tab.getByText('FIRWWORKS.AI', { exact: true }).first().click()
await tab.waitForTimeout(1400)
const url = new URL(tab.url())
report(/^\/transactions\/.+/.test(url.pathname), '① 流水行点进交易详情', [
  `落地路由 ${url.pathname}`,
  `页头标题 ${(await tab.locator('main h1').first().innerText()).trim()}`,
])

// —— 2. 对账恒等式 ——
const balances = await readBalances(tab)
const before = cents(balances?.['交易前余额'])
const amount = cents(balances?.['交易金额'])
const after = cents(balances?.['交易后余额'])
report(before != null && before + amount === after, '② 交易前余额 + 交易金额 = 交易后余额', [
  `${balances?.['交易前余额']} + ${balances?.['交易金额']} = ${balances?.['交易后余额']}`,
  `${before} + ${amount} = ${before + amount}（页面写的是 ${after}）`,
])

// —— 3. 复制交易编号 ——
const shownRef = (await tab.getByLabel('复制交易编号').locator('xpath=../span').innerText()).trim()
await tab.getByRole('button', { name: '复制交易编号' }).click()
await tab.waitForTimeout(400)
const clipboard = (await tab.evaluate(() => navigator.clipboard.readText())).trim()
report(clipboard === shownRef, '③ 复制交易编号', [
  `页面显示 ${shownRef}（${shownRef.length} 位）`,
  `剪贴板   ${clipboard}`,
])

// —— 4. 打印视图 ——
const onScreen = {
  aside: await tab.locator('aside').isVisible(),
  topbar: await tab.locator('header').first().isVisible(),
  button: await tab.getByRole('button', { name: '下载电子回单' }).isVisible(),
}
await tab.emulateMedia({ media: 'print' })
await tab.waitForTimeout(300)
const inPrint = {
  aside: await tab.locator('aside').isVisible(),
  topbar: await tab.locator('header').first().isVisible(),
  button: await tab.getByRole('button', { name: '下载电子回单' }).isVisible(),
}
report(
  onScreen.aside && onScreen.topbar && onScreen.button && !inPrint.aside && !inPrint.topbar && !inPrint.button,
  '④ 打印视图只留回单本体',
  [
    `屏幕：侧栏 ${onScreen.aside} / 顶栏 ${onScreen.topbar} / 打印按钮 ${onScreen.button}`,
    `打印：侧栏 ${inPrint.aside} / 顶栏 ${inPrint.topbar} / 打印按钮 ${inPrint.button}`,
  ],
)
await tab.emulateMedia({ media: 'screen' })

// —— 5. 不存在的交易 ——
await gotoInApp(tab, '/transactions/txn_9999')
/*
 * 等空状态**出现**，不能只 sleep 一个固定时长。
 * 取数是 stale-while-revalidate：换 id 时会先保留上一笔的数据、等新的回来才替换。
 * 整页加载时初值是空的，所以立刻就是对的；换成应用内换页之后会先看到上一笔，
 * 固定 sleep 会读到那份旧内容（实测踩到：断言看到的是 txn_0007 的正文）。
 */
await tab.getByText('这笔交易查不到了').waitFor({ state: 'visible', timeout: 8_000 }).catch(() => {})
const emptyText = (await tab.locator('main').innerText()).replace(/\s+/g, ' ')
report(emptyText.includes('这笔交易查不到了') && emptyText.includes('返回流水'), '⑤ 不存在的交易给空状态', [
  emptyText.slice(0, 90),
])
report(
  (await tab.locator('main a[href], main button').count()) > 0,
  '⑤b 空状态里有回到流水的出口',
  [],
)

await browser.close()
console.log(failures === 0 ? '\n全部通过 ✅' : `\n${failures} 项未通过 ❌`)
process.exit(failures === 0 ? 0 : 1)
