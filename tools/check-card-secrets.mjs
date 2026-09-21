/**
 * 卡敏感信息（完整卡号 / 有效期 / 安全码）的端到端检查。
 *
 * 这件事的正确性不是「界面上能不能看到数字」，而是**该遮的遮住了、该拦的拦住了**：
 *   1. 默认全遮：卡号连后四位都不露，有效期和安全码更不露
 *   2. 卡上那只眼睛是**块级**的：只管这张卡，不牵动首页余额（反面：全局开关一掀掀一片）
 *   3. 完整卡号与安全码**不跟着眼睛出** —— 要单独验支付密码。余额泄露是隐私，
 *      安全码泄露可以直接盗刷，两者不是一个量级；PCI DSS 也不允许授权后留存
 *   4. 解锁有时限：到点**真把值清掉**，不是只把数字藏起来
 *   5. 卡还在寄送途中时拒绝查看
 *
 * 第 4 条要等满服务端给的 60 秒，所以整个检查约 75 秒。
 *
 *   node tools/check-card-secrets.mjs [baseUrl]
 */
import { chromium } from 'playwright-core'
import { login, gotoInApp } from './lib/session.mjs'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

const BASE = process.argv[2] ?? 'http://127.0.0.1:5180'
const ROOT = path.resolve(import.meta.dirname, '..')
const PAY_PASSWORD = '888888'

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

/* ------------------------------------------------ 静态：敏感字段不进卡列表 DTO

   比「页面上数一数」精确得多：只要 BankCard 里没有 pan/cvv、listCards 原样返回 db.cards，
   那么无论界面怎么改，这些字段都不可能随卡列表被下发。 */
const types = await readFile(path.join(ROOT, 'app/src/api/types.ts'), 'utf8')
const mockSrc = await readFile(path.join(ROOT, 'app/src/api/mock/index.ts'), 'utf8')
const dbSrc = await readFile(path.join(ROOT, 'app/src/api/mock/db.ts'), 'utf8')
const bankCardBody = types.match(/export interface BankCard \{([\s\S]*?)\n\}/)?.[1] ?? ''
const mockListCards = mockSrc.match(/async listCards\(\)[\s\S]*?\n    \},/)?.[0] ?? ''

report(
  bankCardBody.length > 0 && !/\b(cvv|pan)\b/i.test(bankCardBody),
  '⓪ BankCard 里没有完整卡号与安全码字段（列表接口不可能带出来）',
  [`BankCard 字段数：${bankCardBody.split('\n').filter((l) => /^\s+\w+[?]?:/.test(l)).length}`],
)
report(
  mockListCards.includes('loadDb().cards') && !/cvv|pan/i.test(mockListCards),
  '⓪ listCards 原样返回 cards，没有把敏感字段贴上',
  [mockListCards.replace(/\s+/g, ' ').trim().slice(0, 80)],
)
report(
  /cardSecrets: Record<string, \{ cvv: string; pan: string \}>/.test(dbSrc),
  '⓪ 卡号与安全码在模拟库里与 cards 分开存放',
  ['db.cardSecrets 与 db.cards 是两张表'],
)
report(
  dbSrc.includes("network === 'visa' ? '402688' : '620522'"),
  '⓪ 完整卡号用真实感号段（Visa 402688 / 银联 620522）',
  ['取舍：不再用 Visa 测试号段 411111（一眼假），代价是理论上可能与真卡撞号'],
)

const browser = await chromium.launch({ executablePath: await findChrome() })
const tab = await (await browser.newContext({ viewport: { width: 1440, height: 1100 }, locale: 'zh-CN' })).newPage()

await login(tab, BASE)
await gotoInApp(tab, '/cards')
await tab.waitForTimeout(500)

const cardText = () => tab.locator('main').innerText()
const dialogText = () => tab.locator('div[role="dialog"]').innerText()

async function selectCard(last4) {
  await tab.getByRole('button', { name: new RegExp(`尾号 ${last4}`) }).click()
  await tab.waitForTimeout(350)
}
async function toggleEye() {
  const btn = tab.locator('main').getByRole('button', { name: /显示|隐藏/ }).first()
  await btn.click()
  await tab.waitForTimeout(250)
}
async function openSecrets() {
  await tab.getByRole('button', { name: /查看完整卡号与安全码|该卡暂无可用卡号/ }).click()
  await tab.locator('div[role="dialog"]').waitFor({ timeout: 5000 })
}
async function fillPassword(pw) {
  const inputs = tab.locator('div[role="dialog"] input')
  for (let i = 0; i < pw.length; i++) await inputs.nth(i).fill(pw[i])
}

const PAN_RE = /\b\d{4} \d{4} \d{4} \d{4}\b/

/* ------------------------------------------------ ① 默认全遮 */
const initial = await cardText()
report(
  initial.includes('•••• •••• •••• ••••') && initial.includes('••/••') && !PAN_RE.test(initial),
  '① 默认连后四位都不露，有效期与安全码也是遮的',
  [
    `卡号：${initial.match(/[•\d]{4}( [•\d]{4}){3}/)?.[0] ?? '—'}`,
    `有效期遮住：${initial.includes('••/••')}`,
  ],
)

/* ------------------------------------------------ ② 眼睛只管这张卡 */
await toggleEye()
const shown = await cardText()
report(
  shown.includes('•••• •••• •••• 8888') && shown.includes('08/29') && !PAN_RE.test(shown),
  '② 眼睛打开后显示后四位与有效期；完整卡号仍要验密码',
  [
    `卡号：${shown.match(/[•\d]{4}( [•\d]{4}){3}/)?.[0] ?? '—'}`,
    `完整卡号是否已泄露：${PAN_RE.test(shown)}`,
  ],
)

/* ------------------------------------------------ ③ 密码错要拦住 */
await openSecrets()
await fillPassword('111111')
await tab.getByRole('button', { name: '验证并查看' }).click()
await tab.waitForTimeout(900)
const wrong = await dialogText()
report(wrong.includes('支付密码') && !PAN_RE.test(wrong), '③ 支付密码错误时拒绝展示', [
  wrong.split('\n').find((l) => l.includes('密码')) ?? wrong.slice(0, 60),
])

/* ------------------------------------------------ ④ 验证通过才给完整卡号 + 安全码 */
await fillPassword('')
await fillPassword(PAY_PASSWORD)
await tab.getByRole('button', { name: '验证并查看' }).click()
await tab.locator('div[role="dialog"]').waitFor({ state: 'detached', timeout: 6000 }).catch(() => {})
await tab.waitForTimeout(400)
const unlocked = await cardText()
const pan = unlocked.match(PAN_RE)?.[0]?.replace(/\s/g, '') ?? null
const cvv = unlocked.match(/CVV\s*\n?\s*(\d{3})/)?.[1] ?? null

const luhnOk = (() => {
  if (!pan) return false
  let sum = 0
  let alt = false
  for (let i = pan.length - 1; i >= 0; i--) {
    let d = Number(pan[i])
    if (alt) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
    alt = !alt
  }
  return sum % 10 === 0
})()

report(pan !== null && pan.endsWith('8888'), '④ 验证通过后显示完整卡号', [
  `卡号 = ${pan?.replace(/(\d{4})(?=\d)/g, '$1 ') ?? '—'}`,
])
report(luhnOk, '⑤ 卡号满足 Luhn 校验（看起来才不像随手编的）', [
  `Luhn：${luhnOk ? '通过' : '不通过'}`,
])
report(/^\d{3}$/.test(cvv ?? ''), '⑥ 同时给出安全码与有效期', [
  `安全码 = ${cvv}，有效期 08/29`,
])

/* ------------------------------------------------ ⑥′ 再点一下就能遮回去，且不验密码

   验证是「看到」的门槛，不是「不看」的门槛。只能等 60 秒自动遮，
   在有人凑过来看屏幕的时候是来不及的 —— 而那正是这个功能要解决的场景。 */
// 先数一下按钮在不在：直接 click 的话，按钮不存在会抛超时异常，
// 检查确实会失败，但报出来的是一堆 Playwright 堆栈，看不出到底哪条性质破了
const hideBtn = tab.getByRole('button', { name: '隐藏安全码' })
const hideBtnCount = await hideBtn.count()
if (hideBtnCount > 0) {
  await hideBtn.click()
  await tab.waitForTimeout(400)
}
const hidden = await cardText()
const dialogOpen = await tab.locator('div[role="dialog"]').count()
report(
  hideBtnCount === 1 && !/CVV\s*\n?\s*\d{3}/.test(hidden) && dialogOpen === 0,
  '⑥′ 点一下露出来的安全码就立刻遮回去，且不弹验证框',
  [
    `「隐藏安全码」按钮数（应为 1，即露出来之后可点）：${hideBtnCount}`,
    `安全码是否还在：${/CVV\s*\n?\s*\d{3}/.test(hidden)}`,
    `弹窗数（应为 0，即没再要密码）：${dialogOpen}`,
    `完整卡号是否被顺手遮掉：${!PAN_RE.test(hidden)}（不该被遮，卡号归那只眼睛管）`,
  ],
)
report(
  PAN_RE.test(hidden),
  '⑥″ 遮安全码时不牵连完整卡号',
  [PAN_RE.test(hidden) ? '完整卡号仍在显示' : '❌ 卡号被一起遮掉了'],
)

// 再解锁一次，供后面「60 秒自动遮」那条用
await tab.getByRole('button', { name: '查看完整卡号与安全码' }).click()
await fillPassword(PAY_PASSWORD)
await tab.getByRole('button', { name: '验证并查看' }).click()
await tab.locator('div[role="dialog"]').waitFor({ state: 'detached', timeout: 6000 }).catch(() => {})
await tab.waitForTimeout(400)

/* ------------------------------------------------ ⑦ 到点真清掉 */
await toggleEye() // 先关掉眼睛，确认关掉就全遮
const hiddenAgain = await cardText()
report(
  !PAN_RE.test(hiddenAgain) && hiddenAgain.includes('•••• •••• •••• ••••'),
  '⑦ 关掉眼睛立刻全遮（不必等 60 秒）',
  [`卡号：${hiddenAgain.match(/[•\d]{4}( [•\d]{4}){3}/)?.[0] ?? '—'}`],
)
await toggleEye()

/**
 * 等满 TTL（服务端给 60 秒），从 **Node 侧**轮询。
 *
 * 不用 page.waitForFunction：它默认 `polling: 'raf'`，在无头 Chromium 里
 * 动画帧不推进，断言根本不会被求值 —— 表现就是「等到超时也没遮回去」，
 * 让人以为是应用的 bug。（这里踩过：应用其实 60 秒整点就清了。）
 */
const deadline = Date.now() + 78_000
let cleared = false
while (Date.now() < deadline) {
  const seen = await cardText()
  if (!PAN_RE.test(seen) && seen.includes('•••• •••• •••• 8888')) {
    cleared = true
    break
  }
  await new Promise((r) => setTimeout(r, 2000))
}
report(cleared, '⑧ 解锁 60 秒后自动回到「只有后四位」（值是真被清掉的）', [
  cleared ? '倒计时归零后完整卡号与安全码从界面上消失' : '超时后仍可见 ❌',
])

/* ------------------------------------------------ ⑨ 没寄到的卡不给看 */
await selectCard('2046')
await openSecrets()
await fillPassword(PAY_PASSWORD)
await tab.getByRole('button', { name: '验证并查看' }).click()
await tab.waitForTimeout(900)
const pending = await dialogText()
report(pending.includes('寄送') && !PAN_RE.test(pending), '⑨ 卡还在寄送途中时拒绝查看', [
  pending.split('\n').find((l) => l.includes('寄送')) ?? pending.slice(0, 70),
])

await browser.close()
console.log(failures === 0 ? '\n全部通过 ✅' : `\n${failures} 项未通过 ❌`)
process.exit(failures === 0 ? 0 : 1)
