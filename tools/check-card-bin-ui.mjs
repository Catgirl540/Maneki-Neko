/**
 * 转账「卡 BIN 识别」的端到端检查（真实浏览器 + 真实 mock 接口）。
 *
 * 两个方向都要验，因为它们是同一份数据的两面：
 *   A. 选收款行 → 卡号前缀自动补全（用银行记录里的 primaryBin）
 *   B. 输卡号前缀 → 收款行自动切换（走 resolveCardBin 接口）
 * 以及三种「查不到」在界面上的差别 —— 这三种要说的话完全不同，混成一句就是误导：
 *   位数不够 / 前缀没收录（「暂不支持该银行」）/ 香港根本没有 BIN 这回事
 *
 * 顺带守住一个曾经真实存在的 bug：本行（招财猫银行）收款人账号写成 622202…
 * （工商银行的真实号段），从常用收款人一点就会把收款行翻成工商银行。
 *
 *   node tools/check-card-bin-ui.mjs [baseUrl]
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
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })

const tab = await context.newPage()
await login(tab, BASE)

/** 收款账户输入框：placeholder 随市场变化 */
const accountInput = () => tab.locator('input[placeholder*="银行"]').first()

/** 读收款账户那一行的 input 值与下方提示（Field 把 input 和提示包在同一个 <label> 里） */
function readField() {
  return tab.evaluate(() => {
    const input = document.querySelector('input[placeholder*="银行"]')
    if (!input) return null
    const label = input.closest('label')
    const spans = Array.from(label.querySelectorAll(':scope > span'))
    return {
      value: input.value,
      note: spans.length >= 3 ? spans[spans.length - 1].textContent.trim() : '',
    }
  })
}

/** 收款银行下拉当前选中的行名 */
const selectedBankName = () =>
  tab.locator('button[aria-label="选择收款银行"] span span').first().textContent()

async function pickBank(keyword, name) {
  await tab.locator('button[aria-label="选择收款银行"]').click()
  const search = tab.locator('input[aria-label="搜索收款银行"]')
  await search.fill(keyword)
  await tab.locator('ul[role="listbox"] button[role="option"]', { hasText: name }).first().click()
  await tab.waitForTimeout(120)
}

/** 等卡 BIN 查询落地（防抖 320ms + mock 140ms，留足余量） */
const settle = () => tab.waitForTimeout(900)

await gotoInApp(tab, '/transfer')
await accountInput().waitFor({ timeout: 15000 })

/* ------------------------------------------- A. 选收款行 → 补全卡号前缀 */
await pickBank('工商', '中国工商银行')
const seeded = await readField()
report(
  seeded.value.replace(/\s/g, '').startsWith('622202'),
  '① 选定收款行后自动补全卡号前缀',
  [`选中 中国工商银行 后卡号栏 = "${seeded.value}"（该行主号段 622202）`],
)

await settle()
const afterSeed = await readField()
report(
  afterSeed.note.includes('中国工商银行') && !afterSeed.note.includes('至少'),
  '② 补全后立刻回显发卡行，且不把半截号段标红',
  [`提示：${afterSeed.note}`],
)

/* ------------------------------------------- B. 输卡号前缀 → 自动选收款行 */
await accountInput().fill('6225 8800 0000 0000')
await settle()
const switched = await selectedBankName()
report(switched.includes('招商银行'), '③ 输入他行号段后收款行自动切换', [
  `输入 622588… → 收款行 = ${switched.trim()}（招商银行的号段）`,
])

/* ------------------------------------------- C. 没收录的号段 */
await accountInput().fill('9999 9900 0000 0000')
await settle()
const unknown = await readField()
report(unknown.note.includes('暂不支持该银行'), '④ 没收录的号段明确说「暂不支持该银行」', [
  `提示：${unknown.note}`,
])

// 而且不能等到填完金额才失败
await tab.locator('input[placeholder="请输入收款人姓名"]').fill('测试收款人')
await tab.getByRole('button', { name: '下一步' }).click()
await tab.waitForTimeout(400)
const blocked = await tab.locator('main').innerText()
report(blocked.includes('暂不支持该银行'), '⑤ 「下一步」被拦住，不是填到一半才失败', [
  blocked.includes('暂不支持该银行') ? '页面给出「暂不支持该银行」并停在第一步' : '未被拦住 ❌',
])

/* ------------------------------------------- D. 位数不够不算错误 */
await accountInput().fill('6225')
await settle()
const partial = await readField()
report(
  !partial.note.includes('暂不支持') && !partial.note.includes('至少'),
  '⑥ 位数不够只提示继续输，不报错',
  [`输入 "6225" → 提示：${partial.note}`],
)

/* ------------------------------------------- E. 香港方向没有 BIN 这回事 */
await tab.getByRole('tab', { name: '境外' }).click()
await tab.waitForTimeout(300)
await accountInput().fill('004123456789118')
await settle()
const hk = await readField()
report(
  hk.note.includes('香港') && !hk.note.includes('暂不支持'),
  '⑦ 香港方向说明账户号不含发卡行信息，不误报不支持',
  [`提示：${hk.note}`],
)

/* ------------------------------------------- F. 本行也要有自己的前缀 */
await tab.getByRole('tab', { name: '境内' }).click()
await tab.waitForTimeout(300)

// 曾经的真 bug：从别家切回本行时没有前缀可补，卡号栏留着别家的号段 ——
// 界面上写着「招财猫银行」、卡号却是工商的 622202，转出去必然失败
await pickBank('工商', '中国工商银行')
await pickBank('招财猫', '招财猫银行')
const own = await readField()
report(
  own.value.replace(/\s/g, '').startsWith('882000'),
  '⑧ 从别家切回本行时，前缀换成本行自己的（不再留着别家的号段）',
  [`切回招财猫银行后卡号栏 = "${own.value}"（本行前缀 882000）`],
)

// 本行账号用内部格式（8820…），要被认出来，而不是谁都不认
await accountInput().fill('8820 0000 0001 2447 1')
await settle()
const internal = await readField()
report(
  internal.note.includes('招财猫银行') && !internal.note.includes('暂不支持'),
  '⑨ 本行账号能被识别回本行，不报「暂不支持该银行」',
  [`提示：${internal.note}`],
)

/* ------------------------------------------- G. 常用收款人不会被认到别家 */
await gotoInApp(tab, '/transfer')
await accountInput().waitFor({ timeout: 15000 })
await tab.getByRole('button', { name: /陈嘉禾/ }).first().click()
await settle()
const payeeBank = (await selectedBankName()).trim()
const payeeField = await readField()
report(
  payeeBank.includes('招财猫') && !payeeField.note.includes('工商银行'),
  '⑩ 本行常用收款人不会被卡号识别翻成工商银行（回归）',
  [`收款行 = ${payeeBank}，卡号 = ${payeeField.value}`, `提示：${payeeField.note}`],
)

await browser.close()
console.log(failures === 0 ? '\n全部通过 ✅' : `\n${failures} 项未通过 ❌`)
process.exit(failures === 0 ? 0 : 1)
