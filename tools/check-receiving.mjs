/**
 * 「转入 · 收款信息」的检查。
 *
 * 「转入」在真实银行 App 里不是把余额改大的按钮，而是**把你的收款信息给对方**。
 * 这件事要保的性质是：展示的字段与复制出去的内容**一致且够用** ——
 * 对方照着抄能填完收款人（户名 / 账户 / 转数快标识），少一项就转不成。
 *
 * 顺带守住两条容易回退的点：
 *   · 收款账号**不该被隐藏**（它是收款项，遮起来反而妨碍用）
 *   · 余额那种真敏感的仍然要遮 —— 别把这两件事混成一件
 *
 *   node tools/check-receiving.mjs [baseUrl]
 */
import { chromium } from 'playwright-core'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

const BASE = process.argv[2] ?? 'http://127.0.0.1:5180'
const ROOT = path.resolve(import.meta.dirname, '..')

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

/* ------------------------------------------------ 静态：界面与「复制全部」同源

   receivingRows 与 receivingText 分头拼的话，界面上改了个标题、复制出去的还是旧文案，
   而且没人会发现。所以断言 receivingText 的每一行都能在 rows 里找到。 */
const lib = await readFile(path.join(ROOT, 'app/src/lib/receiving.ts'), 'utf8')
report(
  lib.includes('receivingRows(info)') &&
    /receivingText[\s\S]*?return receivingRows\(info\)/.test(lib),
  '⓪ 「复制全部」的文本由同一份 rows 生成（不会与界面各说各话）',
  ['receivingText() 直接 map receivingRows()，没有第二份字段清单'],
)

const browser = await chromium.launch({ executablePath: await findChrome() })
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 1100 },
  locale: 'zh-CN',
  permissions: ['clipboard-read', 'clipboard-write'],
})
const tab = await ctx.newPage()

await tab.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
await tab.evaluate(() => {
  localStorage.setItem('luckycat.token', JSON.stringify('check.token'))
  localStorage.setItem(
    'luckycat.session.user',
    JSON.stringify({ id: 'u_0001', name: '林小满', phone: '13800138000', memberLevel: '金卡会员', avatarInitial: '林' }),
  )
})
await tab.goto(`${BASE}/`, { waitUntil: 'networkidle' })
await tab.waitForTimeout(700)

const readClipboard = () => tab.evaluate(() => navigator.clipboard.readText())

/* ------------------------------------------------ ① 账号不遮、余额仍遮 */
const dash = await tab.locator('main').innerText()
report(
  /8820\d{15}/.test(dash) && dash.includes('¥••••••'),
  '① 收款账号明文显示，余额仍然遮住',
  [
    `账号明文：${/8820\d{15}/.test(dash)}`,
    `余额遮住：${dash.includes('¥••••••')}`,
  ],
)

// 首页原来有个「收款」按钮，点了跳到消费分析 —— 与「收款」毫无关系，是个占位符写错的链接。
// 「转入」现在已经承担了收款信息的职责，这个按钮没有存在意义。这条断言防它再回来。
const strayCollect = await tab.getByRole('button', { name: '收款', exact: true }).count()
report(strayCollect === 0, '①′ 首页没有语义对不上的「收款」按钮', [
  `名为「收款」的按钮数：${strayCollect}`,
])

/* ------------------------------------------------ ② 转入弹出的是收款信息 */
await tab.getByRole('button', { name: '转入' }).click()
const dialog = tab.locator('div[role="dialog"]')
await dialog.waitFor({ timeout: 5000 })
await tab.waitForTimeout(500)
const text = await dialog.innerText()
const need = ['收款户名', '收款账户', '收款银行', '转数快手机号', 'FPS ID']
const missing = need.filter((k) => !text.includes(k))
report(missing.length === 0, '② 转入展示的是收款信息，五项齐全', [
  `缺失：${missing.length ? missing.join('、') : '无'}`,
])

/* ------------------------------------------------ ③ 每条都能单独复制 */
const accountNo = text.match(/\b(8820\d{15})\b/)?.[1] ?? null
await dialog.getByRole('button', { name: '复制收款账户' }).click()
await tab.waitForTimeout(400)
const one = await readClipboard()
report(
  accountNo !== null && one === accountNo,
  '③ 单项复制复制的就是那一项的值',
  [`剪贴板 = ${one}（页面显示 ${accountNo}）`],
)

/* ------------------------------------------------ ④ 复制全部内容完整 */
await dialog.getByRole('button', { name: '复制全部' }).click()
await tab.waitForTimeout(400)
const all = await readClipboard()
const lines = all.split('\n')
report(
  need.every((k) => all.includes(k)) && lines.length === 5 && accountNo !== null && all.includes(accountNo),
  '④ 「复制全部」给出的是一段能直接粘的完整信息',
  [`${lines.length} 行：${lines.map((l) => l.split('：')[0]).join(' / ')}`],
)

/* ------------------------------------------------ ⑤ 演示用的入账还在 */
await dialog.getByRole('button', { name: '模拟一笔转入' }).click()
await tab.waitForTimeout(400)
const demo = await dialog.innerText()
report(
  demo.includes('转入金额') && demo.includes('绑定银行卡'),
  '⑤ 演示用的「模拟一笔转入」仍在，且与收款信息分开',
  ['第二次点击才进入演示表单，首屏不会被误当成真功能'],
)

await browser.close()
console.log(failures === 0 ? '\n全部通过 ✅' : `\n${failures} 项未通过 ❌`)
process.exit(failures === 0 ? 0 : 1)
