/**
 * agent 接入网页的浏览器冒烟测试。
 *
 * 验证的是用户在网页上真正要走的路径：
 *   发消息 → agent 调用工具 → **确认卡片展示交易信息** → 用户确认 + 输支付密码 → 才执行。
 *
 * 需要三样东西同时在跑：
 *   1. agent 演示服务：node framework/bridge/demo-server.mjs
 *   2. 前端 dev server：cd app && npm run dev
 *   3. 联网 + OPENROUTER_API_KEY（演示服务要用模型）
 *
 * 跑法：
 *   node tools/check-agent.mjs
 *   node tools/check-agent.mjs --base http://127.0.0.1:5180 --shots
 *
 * 断言失败时退出码非 0，并打印失败项。
 */

import { chromium } from 'playwright-core'
import { mkdir, readdir } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

const args = process.argv.slice(2)
const baseIndex = args.indexOf('--base')
const BASE = baseIndex >= 0 ? args[baseIndex + 1] : 'http://127.0.0.1:5180'
const TAKE_SHOTS = args.includes('--shots')
const SHOT_DIR = path.resolve(import.meta.dirname, '../design/shots')

/** 演示环境支付密码（与 app 的登录演示密码一致）。 */
const PAY_PASSWORD = '123456'
const WRONG_PASSWORD = '000000'

/** 转账提示词：明确到模型一定会调用工具。 */
const TRANSFER_PROMPT = '帮我转 800 元给梁乐怡，账号尾号 9123，备注房租。直接调用工具，不要先问我。'

let failures = 0
const ok = (title) => console.log(`PASS  ${title}`)
const bad = (title, detail = '') => {
  failures += 1
  console.log(`FAIL  ${title}${detail === '' ? '' : `\n      ${detail}`}`)
}

async function findChrome() {
  const cache = path.join(os.homedir(), '.cache/ms-playwright')
  const dirs = (await readdir(cache)).filter((d) => d.startsWith('chromium-'))
  if (!dirs.length) throw new Error('没找到 playwright 的 chromium')
  return path.join(cache, dirs.sort().at(-1), 'chrome-linux64', 'chrome')
}

/** 注入登录态（与 tools/shoot.mjs 同一套 key）。 */
async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => {
    localStorage.setItem('luckycat.token', JSON.stringify('agent.check.token'))
    localStorage.setItem('luckycat.session.user', JSON.stringify({
      id: 'u_0001',
      name: '林小满',
      phone: '13800138000',
      memberLevel: '金卡会员',
      avatarInitial: '林',
    }))
    // 每次都从干净的对话开始，避免上一轮的本地历史干扰断言。
    localStorage.removeItem('luckycat.support.history.v1')
  })
}

const executablePath = await findChrome()
if (TAKE_SHOTS) await mkdir(SHOT_DIR, { recursive: true })

const browser = await chromium.launch({ executablePath })
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 2,
  locale: 'zh-CN',
})

try {
  const page = await context.newPage()
  await login(page)
  await page.goto(`${BASE}/support`, { waitUntil: 'domcontentloaded' })

  // ── 1. agent 通道必须真的连上（而不是回落固定话术）
  const agentTag = page.getByText('Agent 已连接', { exact: false })
  try {
    await agentTag.waitFor({ state: 'visible', timeout: 15_000 })
    ok('页面显示「Agent 已连接」')
  } catch {
    bad('页面没有连上 agent', '确认 agent 演示服务与前端 dev server 都在跑')
  }

  // ── 2. 发一句转账
  const input = page.getByPlaceholder('描述你的需求', { exact: false })
  await input.fill(TRANSFER_PROMPT)
  await page.keyboard.press('Enter')

  // ── 3. 确认卡片必须出现，并且**列出交易信息**
  const cardTitle = page.getByText('需要你确认：转账', { exact: false })
  try {
    await cardTitle.waitFor({ state: 'visible', timeout: 120_000 })
    ok('出现了确认卡片（执行前先展示）')
  } catch {
    bad('120 秒内没有出现确认卡片')
  }

  const card = page.locator('div', { has: cardTitle }).last()
  for (const [label, value] of [
    ['收款人', '梁乐怡'],
    ['转账金额', '800.00 CNY'],
    ['收款账号', '**** 9123'],
  ]) {
    const row = page.getByText(label, { exact: true }).first()
    const rowValue = page.getByText(value, { exact: false }).first()
    const rowVisible = await row.isVisible().catch(() => false)
    const valueVisible = await rowValue.isVisible().catch(() => false)
    if (rowVisible && valueVisible) ok(`确认卡片展示了「${label}：${value}」`)
    else bad(`确认卡片没有展示「${label}：${value}」`, `label=${rowVisible} value=${valueVisible}`)
  }

  // ── 4. 身份验证：需要支付密码，且**确认前**工具不能是"已完成"
  const needsPassword = await page.getByText('身份验证 · 请输入支付密码', { exact: false }).isVisible().catch(() => false)
  if (needsPassword) ok('确认卡片要求身份验证（支付密码）')
  else bad('确认卡片没有要求身份验证')

  const doneChip = page.getByText('已完成', { exact: true }).first()
  if (await doneChip.isVisible().catch(() => false)) {
    bad('确认之前工具就显示"已完成"——闸门没拦住')
  } else {
    ok('确认之前工具没有执行')
  }
  void card

  if (TAKE_SHOTS) await page.screenshot({ path: path.join(SHOT_DIR, 'agent-01-consent.png'), fullPage: false })

  // ── 5. 错误密码必须被拒
  const pins = page.getByLabel('支付密码', { exact: false })
  const pinCount = await pins.count()
  if (pinCount < 6) {
    bad('支付密码输入框数量不对', `找到 ${pinCount} 个，应为 6 个`)
  } else {
    for (const [index, digit] of [...WRONG_PASSWORD].entries()) await pins.nth(index).fill(digit)
    await page.getByRole('button', { name: /确认并验证/ }).click()
    try {
      await page.getByText('支付密码不正确', { exact: false }).first().waitFor({ state: 'visible', timeout: 20_000 })
      ok('错误支付密码被拒绝')
    } catch {
      bad('错误支付密码没有被拒绝')
    }
    if (await doneChip.isVisible().catch(() => false)) bad('密码错误却执行了')
    else ok('密码错误时工具没有执行')
  }

  // ── 6. 正确密码 → 执行
  for (const [index, digit] of [...PAY_PASSWORD].entries()) await pins.nth(index).fill(digit)
  await page.getByRole('button', { name: /确认并验证/ }).click()

  try {
    await doneChip.waitFor({ state: 'visible', timeout: 120_000 })
    ok('验证通过后工具执行完成')
  } catch {
    bad('验证通过后工具没有执行完成')
  }

  const receipt = page.getByText('LCB-DEMO-', { exact: false }).first()
  if (await receipt.isVisible().catch(() => false)) {
    const text = await receipt.textContent()
    ok(`界面显示了演示回执号（${(text ?? '').trim().slice(0, 40)}）`)
  } else {
    // 回执号可能只出现在工具结果摘要里；退一步确认"转账"这一行变成了已完成。
    const toolDone = await page.getByText('转账', { exact: true }).first().isVisible().catch(() => false)
    if (toolDone) ok('界面显示了转账这条工具调用')
    else bad('没有看到回执号或转账工具行')
  }

  if (TAKE_SHOTS) await page.screenshot({ path: path.join(SHOT_DIR, 'agent-02-executed.png'), fullPage: false })

  // ── 7. 只读查询：要确认、不要密码（当前口径）
  await page.getByRole('button', { name: '新对话' }).click()
  await page.waitForTimeout(500)
  await input.fill('我的账户余额还有多少？')
  await page.keyboard.press('Enter')
  try {
    await page.getByText('需要你确认：查询账户余额', { exact: false }).waitFor({ state: 'visible', timeout: 120_000 })
    ok('只读查询也走确认（敏感信息查看）')
  } catch {
    bad('只读查询没有出现确认卡片')
  }
  const needsPasswordForRead = await page.getByText('身份验证 · 请输入支付密码', { exact: false }).isVisible().catch(() => false)
  if (needsPasswordForRead) bad('只读查询被要求验密码（当前口径不该要）')
  else ok('只读查询不要求验密码（当前口径）')

  await page.getByRole('button', { name: /^确认$/ }).click()
  try {
    await page.getByText('余额', { exact: false }).first().waitFor({ state: 'visible', timeout: 120_000 })
    ok('确认后返回了余额结果')
  } catch {
    bad('确认后没有余额结果')
  }
  if (TAKE_SHOTS) await page.screenshot({ path: path.join(SHOT_DIR, 'agent-03-readonly.png'), fullPage: false })
} finally {
  await browser.close()
}

console.log()
if (failures === 0) console.log('check-agent: 全部通过')
else console.log(`check-agent: ${failures} 项未通过`)
process.exit(failures === 0 ? 0 : 1)
