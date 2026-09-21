/**
 * 金额必须带货币单位的检查。
 *
 * 金额散落在很多地方（余额、收支小结、图例、柱状标签、列表行…），每一处都是手写的模板串，
 * 于是「漏一个 ¥」这种问题只会被眼睛偶然发现 —— 首页的「本月收入/支出/结余」就漏了很久。
 *
 * 规则：带 `.num` 的数值元素里，**不允许出现「纯数字形态的金额」**。
 * 判据是形如 `+23,720.00` / `-12,262.14` / `6,500.00` 这种「可选符号 + 千分位 + 两位小数」——
 * 真正的金额都会带 ¥ / HK$ / US$ 前缀，所以不会命中。
 *
 * **坐标轴刻度是有意不带的**：图表 Y 轴用 `maximumFractionDigits: 0` 输出整数（6,500 / 0），
 * 单位由图表标题与图例承担 —— 那条不属于「漏单位」，也不落在这个判据里（没有两位小数）。
 *
 *   node tools/check-amounts.mjs [baseUrl]
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

let failures = 0
const report = (ok, title, lines = []) => {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${title}`)
  for (const line of lines) console.log(`      ${line}`)
}

const browser = await chromium.launch({ executablePath: await findChrome() })
const tab = await (await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })).newPage()

await login(tab, BASE)

const PAGES = [
  // 「总览」从 `/` 挪到了 `/dashboard`（`/` 现在是公开的官网首页）
  ['总览', '/dashboard'],
  // 官网也纳入：那几个界面示意图是**照着真实界面画的**，金额该和真实界面一样带 ¥，
  // 不带就是示意图和产品对不上（实测：漏改过一次，这条断言把它抓出来了）
  ['官网', '/'],
  ['消费分析', '/analysis'],
  ['转账', '/transfer'],
  ['银行卡', '/cards'],
  ['理财', '/wealth'],
  ['安全中心', '/security'],
]

const offenders = []
for (const [name, url] of PAGES) {
  // 应用内换页：不用整页重载，省掉重新拉一遍接口（见 tools/lib/session.mjs）
  await gotoInApp(tab, url)
  await tab.waitForTimeout(900)
  // 有些金额默认被「眼睛」遮住，先全部掀开再扫，否则遮住的那些扫不到
  const eyes = await tab.locator('main').getByRole('button', { name: /^显示/ }).all()
  for (const eye of eyes) await eye.click().catch(() => {})
  await tab.waitForTimeout(300)

  const found = await tab.evaluate(() =>
    Array.from(document.querySelectorAll('.num'))
      .map((el) => ({ text: el.textContent.trim(), around: (el.parentElement?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 30) }))
      // 纯数字形态的金额：可选符号 + 千分位 + 两位小数。带 ¥ / HK$ 的不会命中
      .filter((x) => /^[+-]?\d{1,3}(,\d{3})*\.\d{2}$/.test(x.text)),
  )
  for (const f of found) offenders.push(`${name}：${f.text}（附近文案：${f.around}）`)
}

report(offenders.length === 0, '① 各页面的金额都带货币单位', [
  offenders.length ? `裸金额 ${offenders.length} 处：\n        ${offenders.slice(0, 10).join('\n        ')}` : `${PAGES.length} 个页面扫描完毕，无裸金额`,
])

await browser.close()
console.log(failures === 0 ? '\n全部通过 ✅' : `\n${failures} 项未通过 ❌`)
process.exit(failures === 0 ? 0 : 1)
