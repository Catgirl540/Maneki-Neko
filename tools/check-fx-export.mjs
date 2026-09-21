/**
 * 换汇 与 导出 的冒烟测试。
 *
 *   ① 转数快选港币 → 出换汇报价，且「预计到账 = 扣账金额 × 参考汇率」
 *   ② 锁价 30 秒到期后自动重新询价，并提示用户核对到账金额
 *   ③ 提交流转 → 交易详情按回单口径给出反向汇率与原交易金额
 *   ④ 导出流水 → CSV 带 UTF-8 BOM、列齐全、行数与条数一致
 *   ⑤ 电子回单接口 → 演示环境 url 为 null，退回浏览器打印并明确告知
 *
 *   node tools/check-fx-export.mjs [baseUrl]
 */
import { chromium } from 'playwright-core'
import { login, gotoInApp } from './lib/session.mjs'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

const BASE = process.argv[2] ?? 'http://127.0.0.1:5180'
const SKIP_TTL_WAIT = process.argv.includes('--fast')

async function findChrome() {
  const cache = path.join(os.homedir(), '.cache/ms-playwright')
  const dirs = (await readdir(cache)).filter((d) => d.startsWith('chromium-'))
  return path.join(cache, dirs.sort().at(-1), 'chrome-linux64', 'chrome')
}

const browser = await chromium.launch({ executablePath: await findChrome() })
const context = await browser.newContext({
  viewport: { width: 1440, height: 960 },
  locale: 'zh-CN',
  acceptDownloads: true,
})

let failures = 0
const report = (ok, title, lines = []) => {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${title}`)
  for (const line of lines) console.log(`      ${line}`)
}
const num = (text) => Number(String(text).replace(/[^\d.-]/g, ''))
const yuan = (text) => Math.round(num(text) * 100)

const tab = await context.newPage()
tab.on('pageerror', (e) => console.log('PAGEERROR:', e.message))

await login(tab, BASE)

const mainText = async () => (await tab.locator('main').innerText()).replace(/\s+/g, ' ')

// ============================================================ ① 换汇报价
await gotoInApp(tab, '/transfer')
await tab.waitForTimeout(900)
await tab.getByText('转数快 / 跨境支付通', { exact: true }).first().click()
await tab.waitForTimeout(400)
await tab.getByLabel('转账金额', { exact: false }).fill('1000')
await tab.waitForTimeout(1100)

let text = await mainText()
const rateMatch = text.match(/参考汇率 1 CNY = HKD ([\d.]+)/)
const gotMatch = text.match(/预计到账 HK\$([\d,.]+)/)
const spreadMatch = text.match(/换汇点差 ([\d.]+)%/)
const rate = rateMatch ? Number(rateMatch[1]) : null
const gotCents = gotMatch ? yuan(gotMatch[1]) : null
const expected = rate ? Math.round(100000 * rate) : null

report(
  rate != null && gotCents != null && Math.abs(gotCents - expected) <= 1 && spreadMatch?.[1] === '0.35',
  '① 转数快港币出换汇报价，且「预计到账 = 扣账金额 × 汇率」',
  [
    `参考汇率 1 CNY = HKD ${rate ?? '(未找到)'} · 点差 ${spreadMatch?.[1] ?? '?'}%`,
    `扣账 ¥1,000.00 → 预计到账 HK$${gotMatch?.[1] ?? '?'}`,
    `结算校验 100000 × ${rate} = ${expected} 分，页面写 ${gotCents} 分`,
  ],
)

const ttlNote = /换汇按实时汇率报价/
report(ttlNote.test(text), '①b 步骤一说明汇率是实时报价', [
  `页面提示：${text.match(/换汇按实时汇率报价[^。]*。/)?.[0] ?? '(未找到)'}`,
])

// ============================================================ ② 提交流转
await tab.getByLabel('收款账号', { exact: false }).fill('12345678')
await tab.getByLabel('收款户名', { exact: false }).fill('Wing Chan')
await tab.waitForTimeout(600)
await tab.getByRole('button', { name: '下一步' }).click()
await tab.waitForTimeout(900)

text = await mainText()
const reviewRate = text.match(/参考汇率 1 CNY = HKD ([\d.]+)/)
const reviewGot = text.match(/预计到账（港币） HK\$([\d,.]+)/)
const reviewTtl = text.match(/报价 (\d+) 秒内有效/)
report(
  reviewRate != null && reviewGot != null,
  '② 信息确认页把「扣多少 / 对方收到多少」并排讲清楚',
  [`参考汇率 ${reviewRate?.[1] ?? '?'}`, `预计到账 HK$${reviewGot?.[1] ?? '?'}`],
)
report(
  reviewTtl != null && Number(reviewTtl[1]) >= 25 && Number(reviewTtl[1]) <= 30,
  '②b 确认页显示锁价倒计时',
  [`页面显示「报价 ${reviewTtl?.[1] ?? '?'} 秒内有效」`],
)

// ============================================================ ③ 锁价到期重询
// 故意停在确认页不动 —— 用户在这里逗留是最危险的场景：不能拿过期汇率成交
if (SKIP_TTL_WAIT) {
  console.log('SKIP  ③ 锁价到期重询（--fast）')
} else {
  const toasts = new Set()
  let sawReset = false
  const deadline = Date.now() + 38_000
  while (Date.now() < deadline) {
    await tab.waitForTimeout(500)
    const status = await tab
      .locator('[role="status"]')
      .innerText()
      .catch(() => '')
    if (status.trim()) toasts.add(status.replace(/\s+/g, ' ').trim())
    const m = (await mainText()).match(/报价 (\d+) 秒内有效/)
    // 倒计时回到 25 秒以上 = 已经换了一份新报价
    if (m && Number(m[1]) >= 25) sawReset = true
  }
  const renewed = [...toasts].some((t) => t.includes('重新询价'))
  report(sawReset && renewed, '③ 停在确认页 30 秒：锁价到期自动重新询价', [
    `倒计时重新起算：${sawReset}`,
    `提示文案：${[...toasts].find((t) => t.includes('重新询价')) ?? '(未捕获)'}`,
  ])
}

// ============================================================ ④ 提交
await tab.getByRole('button', { name: '确认转账' }).click()
await tab.waitForTimeout(1500)
text = await mainText()
const doneAmount = text.match(/到账金额 HK\$([\d,.]+)/)
const doneRate = text.match(/成交汇率 1 CNY = HKD ([\d.]+)/)
report(
  doneAmount != null && doneRate != null,
  '④ 完成页给出到账金额与成交汇率',
  [`到账金额 HK$${doneAmount?.[1] ?? '?'}`, `成交汇率 ${doneRate?.[1] ?? '?'}`],
)

// ============================================================ ④b 回单口径
await gotoInApp(tab, '/analysis')
await tab.waitForTimeout(1000)
await tab.getByPlaceholder('搜索商户或备注').fill('Wing Chan')
await tab.waitForTimeout(900)
await tab.getByText('转账 · Wing Chan', { exact: true }).first().click()
await tab.waitForTimeout(1400)

text = await mainText()
const rcOrigin = text.match(/原交易金额 HKD ([\d,.]+)/)
const rcRate = text.match(/记账汇率 1 HKD = CNY ([\d.]+)/)
const rcBooked = text.match(/-¥([\d,.]+) 记账金额 · 人民币（CNY）/)
const rcBooking = rcRate ? Number(rcRate[1]) : null
const rcQuote = reviewRate ? Number(reviewRate[1]) : null
report(
  rcOrigin != null && rcBooking != null && rcQuote != null && Math.abs(rcBooking * rcQuote - 1) < 1e-4,
  '④b 交易详情按回单口径给出反向汇率（1 原币 = ? 记账币）',
  [
    `原始金额 HKD ${rcOrigin?.[1] ?? '?'} · 记账金额 -¥${rcBooked?.[1] ?? '?'}`,
    `记账汇率 ${rcBooking} × 报价汇率 ${rcQuote} = ${(rcBooking * rcQuote).toFixed(8)}（应为 1）`,
  ],
)

// ============================================================ ⑤ CSV 导出
await gotoInApp(tab, '/analysis')
await tab.waitForTimeout(1100)
const [download] = await Promise.all([
  tab.waitForEvent('download', { timeout: 15000 }),
  tab.getByRole('button', { name: '导出流水' }).click(),
])
const csvPath = await download.path()
const raw = await readFile(csvPath)
const csv = raw.toString('utf8')
const lines = csv.split('\r\n').filter((l) => l.length > 0)
const hasBom = raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf
const header = lines[0]?.replace(/^\uFEFF/, '') ?? ''
const expectedHeader =
  '交易时间,收支,交易金额,币种,原交易金额,记账汇率,对方户名,对方账号,对方机构,交易渠道,交易类型,交易状态,交易后余额,交易编号,附言'
const fxRow = lines.find((l) => l.includes('Wing Chan')) ?? ''
report(
  hasBom && header === expectedHeader && lines.length > 1,
  '④ 导出流水：CSV 带 UTF-8 BOM、列齐全',
  [
    `文件名 ${download.suggestedFilename()}`,
    `BOM ${hasBom ? '有（Excel 打开中文不乱码）' : '缺失'}`,
    `列数 ${header.split(',').length} · 数据行 ${lines.length - 1}`,
    `表头 ${header}`,
  ],
)
report(
  // 导出的是**对方户名**（Wing Chan），不是列表标签（转账 · Wing Chan）——
  // 银行流水上不该出现 UI 拼出来的前缀
  /,Wing Chan,/.test(fxRow) && /HKD 1,088/.test(fxRow) && /1 HKD = CNY/.test(fxRow),
  '④b 换汇那一笔在 CSV 里带原交易金额与记账汇率',
  [fxRow.slice(0, 190)],
)

// ============================================================ ⑤ 电子回单
await tab.goBack()
await tab.waitForTimeout(1400)
await tab.getByRole('button', { name: '下载电子回单' }).click()
await tab.waitForTimeout(900)
const receiptToast = await tab
  .locator('[role="status"]')
  .innerText()
  .catch(() => '')
report(receiptToast.includes('不生成服务端 PDF'), '⑤ 电子回单：演示环境退回打印并明确告知', [
  receiptToast.replace(/\s+/g, ' ').trim() || '(未捕获提示)',
])

await browser.close()
console.log(failures === 0 ? '\n全部通过 ✅' : `\n${failures} 项未通过 ❌`)
process.exit(failures === 0 ? 0 : 1)
