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
    // 历史对话也清掉：第 9 段要数"这一页开了几段"，带着旧记录会数不准。
    localStorage.removeItem('luckycat.agent.sessions.v1')
    localStorage.removeItem('luckycat.ui.agentHistoryOpen')
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

  // ── 1b. 快捷入口不许有一键发起资金操作的按钮
  const quickAsks = await page.locator('button.rounded-chip').allTextContents()
  const oneClickOps = quickAsks.filter((text) => /帮我转|转 ?\d|转账给|打款给/.test(text))
  if (oneClickOps.length === 0) ok('快捷问题里没有"一键转账"这类操作入口')
  else bad('快捷问题里出现了一键资金操作', oneClickOps.join(' / '))

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
  // 卡片没出来时不要在这里抛异常：抛了整轮就断，后面的会话管理检查一条都跑不到，
  // 而"为什么没出来"的线索反而更少。
  if (pinCount < 6) {
    bad('跳过"正确密码 → 执行"：支付密码框没出现')
    bad('跳过"验证通过后工具执行完成"')
  } else {
    for (const [index, digit] of [...PAY_PASSWORD].entries()) await pins.nth(index).fill(digit)
    await page.getByRole('button', { name: /确认并验证/ }).click()

    try {
      await doneChip.waitFor({ state: 'visible', timeout: 120_000 })
      ok('验证通过后工具执行完成')
    } catch {
      bad('验证通过后工具没有执行完成')
    }
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
  // ── 8. 助手回复必须是**渲染后**的：Markdown 源码不该出现在屏幕上
  // 这是客户直接看到的问题（`**粗体**`、`|---|` 原样显示），所以单独断言。
  const bubbles = await page.locator('.bg-sunk').allInnerTexts()
  const rawMarkdown = bubbles.filter((text) => /\*\*|\|\s*-{2,}\s*\|/.test(text))
  if (rawMarkdown.length === 0) ok('助手气泡里没有残留 Markdown 源码（** / |---|）')
  else bad('助手气泡里还看得见 Markdown 源码', rawMarkdown[0].slice(0, 120))

  const katexCss = await page.evaluate(() =>
    [...document.styleSheets].some((sheet) => {
      try {
        return [...sheet.cssRules].some((rule) => rule.cssText.includes('.katex'))
      } catch {
        return false
      }
    }))
  if (katexCss) ok('KaTeX 样式已生效（公式能正常排版）')
  else bad('页面里没有 KaTeX 样式（公式会挤成一堆字符）')

  // 工具结果摘要不许泄漏内部结构：绝对路径、内部字段名都曾经直接显示给客户过。
  const toolLabels = await page.locator('span.px-3.py-1\\.5').allInnerTexts()
  const leaky = toolLabels.filter((text) => /\/home\/|corpusPath|indexedChunks|degradedReason|\{"|\[\{/.test(text))
  if (toolLabels.length === 0) {
    // 选择器抓不到东西时 leaky 一定为空，上面那条会**空转通过**。
    // 所以先断言"确实抓到了工具摘要"，否则这条检查等于没做。
    bad('没抓到任何工具摘要标签，泄漏检查会空转', '检查一下页面结构或选择器')
  } else if (leaky.length === 0) {
    ok(`工具摘要没有泄漏内部路径/字段（检查了 ${toolLabels.length} 条）`)
  } else {
    bad('工具摘要里出现了内部结构', leaky[0].slice(0, 120))
  }

  if (TAKE_SHOTS) await page.screenshot({ path: path.join(SHOT_DIR, 'agent-03-readonly.png'), fullPage: false })

  /* ══════════════════════════════════════════════════════════════════════
     9. 会话管理：列表 / 切换 / 不受打扰 / 改名 / 刷新不丢 / 删除
     ══════════════════════════════════════════════════════════════════════ */

  // 注意选择器要**精确**：页面左边的主导航也是一个 <aside>，
  // 用 `page.locator('aside')` 会同时匹配到它，waitFor/isVisible 的行为就全乱了。
  const drawer = page.locator('aside[aria-label="历史对话"]')
  const historyToggle = page.getByRole('button', { name: /历史对话/ })
  const rows = () => drawer.locator('div.group > button')
  /** 页面上用户自己说的话。 */
  const userBubbles = async () =>
    (await page.locator('div.bg-ink.text-ink-invert').allInnerTexts()).map(t => t.trim()).filter(t => t !== '')

  await historyToggle.click()
  try {
    await drawer.waitFor({ state: 'visible', timeout: 5_000 })
    ok('点「历史对话」打开了会话抽屉')
  } catch {
    bad('会话抽屉没有打开')
  }

  // ── 9a. 每一段都记下来了，标题按第一句话自动起名
  const rowCount = await rows().count()
  if (rowCount >= 2) ok(`抽屉里列了 ${rowCount} 段对话（这一页开过的都在）`)
  else bad('抽屉里的对话条数不对', `找到 ${rowCount} 段，应该有 2 段以上`)

  const titles = await rows().allInnerTexts()
  const hasTransfer = titles.some(t => t.includes('帮我转 800 元'))
  const hasBalance = titles.some(t => t.includes('我的账户余额还有多少'))
  if (hasTransfer && hasBalance) ok('两段对话各自按第一句话自动起了标题')
  else bad('自动标题不对', titles.map(t => t.split('\n')[0]).join(' | '))

  // ── 9b. 切换：内容跟着换，而且**不许串**
  await rows().filter({ hasText: '帮我转 800 元' }).first().click()
  await page.waitForTimeout(600)
  const onTransfer = await userBubbles()
  const transferIsolated = onTransfer.length === 1 && onTransfer[0].includes('帮我转 800 元')
    && !onTransfer.some(t => t.includes('余额'))
  if (transferIsolated) ok('切到转账那段：只显示那一段的内容，没有和余额那段串在一起')
  else bad('切换对话之后内容串了', JSON.stringify(onTransfer).slice(0, 200))

  await rows().filter({ hasText: '我的账户余额还有多少' }).first().click()
  await page.waitForTimeout(600)
  const onBalance = await userBubbles()
  if (onBalance.length === 1 && onBalance[0] === '我的账户余额还有多少？') {
    ok('切回余额那段：内容也各归各的')
  } else {
    bad('切回之后内容不对', JSON.stringify(onBalance).slice(0, 200))
  }

  // ── 9c. 切走**不能打断**正在回答的那一段（会话管理最容易做错的地方）
  // 用"数到 30"当提示词：生成要花一阵子，切换一定能落在它还没答完的窗口里。
  // 抽屉开着的时候「新对话」有两个（顶栏一个、抽屉里一个），取第一个就行——两个做的是同一件事。
  await page.getByRole('button', { name: '新对话' }).first().click()
  await page.waitForTimeout(300)
  const SLOW_PROMPT = '请从 1 数到 30，每个数字单独一行，一个都不许省略。'
  await input.fill(SLOW_PROMPT)
  await page.keyboard.press('Enter')
  // 立刻切走：这时它应该还在回答
  await rows().filter({ hasText: '我的账户余额还有多少' }).first().click()
  await page.waitForTimeout(700)

  const busyRow = drawer.locator('div.group', { hasText: '请从 1 数到 30' }).first()
  const busySeen = (await busyRow.innerText().catch(() => '')).includes('回答中')
  if (busySeen) ok('切走之后那一行仍然标着「回答中」——没有被切换打断')
  else bad('切走之后看不到「回答中」，无法确认没被打断')

  const duringSwitch = await userBubbles()
  if (duringSwitch.length === 1 && duringSwitch[0] === '我的账户余额还有多少？') {
    ok('切走时显示的是被切到的那一段，不是还在回答的那一段')
  } else {
    bad('切走之后显示的内容不对', JSON.stringify(duringSwitch).slice(0, 200))
  }

  // 等它答完（"回答中"消失），再切回去确认回答确实落在了它自己那一段里。
  let settled = false
  for (let i = 0; i < 240; i += 1) {
    const text = await busyRow.innerText().catch(() => '')
    if (!text.includes('回答中')) { settled = true; break }
    await page.waitForTimeout(500)
  }
  if (!settled) bad('等了两分钟那一行还标着「回答中」')

  await busyRow.click()
  await page.waitForTimeout(600)
  const answered = await userBubbles()
  const replyCount = await page.locator('div.bg-sunk.rounded-card').count()
  if (answered.length === 1 && answered[0] === SLOW_PROMPT && replyCount >= 1) {
    ok('切回来之后：回答写在了它自己那一段里（没跑到别处，也没丢）')
  } else {
    bad('被切走的那一段没有收到回答', `用户气泡 ${JSON.stringify(answered).slice(0, 120)}；助手气泡 ${replyCount}`)
  }

  // ── 9d. 改名
  await drawer.locator('div.group:has(button[aria-current="true"])').first()
    .getByRole('button', { name: /^重命名/ }).click()
  await page.getByLabel('对话标题').fill('房租转账')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.waitForTimeout(400)
  if ((await rows().allInnerTexts()).some(t => t.includes('房租转账'))) ok('改名生效，列表里换成了新名字')
  else bad('改名没有生效')

  // ── 9e. 刷新不丢（记录存在这台设备上）
  await page.reload({ waitUntil: 'domcontentloaded' })
  // 先等通道连上：抽屉只在 agent 可用时才渲染。太早点会点到"还没出现的按钮"，
  // 而 Playwright 会一直等它出现——等到了再点，反而把本来开着的抽屉关掉。
  await page.getByText('Agent 已连接', { exact: false }).waitFor({ state: 'visible', timeout: 15_000 })
  const drawerUp = async () => await drawer.waitFor({ state: 'visible', timeout: 4_000 })
    .then(() => true).catch(() => false)
  // 抽屉的开合状态也是存着的，刷新前开着，刷新后应该自己开回来。
  let open = await drawerUp()
  if (!open) {
    await historyToggle.click()
    open = await drawerUp()
  }
  if (!open) {
    bad('刷新之后抽屉打不开')
  } else {
    const afterReload = await rows().allInnerTexts()
    if (afterReload.some(t => t.includes('房租转账')) && afterReload.length >= 3) {
      ok(`刷新之后历史对话还在（${afterReload.length} 段，含改过名的那一段）`)
    } else {
      bad('刷新之后历史对话丢了，或改过的名字没保住',
        `拿到 ${afterReload.length} 段：${afterReload.map(t => t.split('\n')[0]).join(' | ') || '（空）'}`)
    }
  }

  // ── 9f. 删除：要二次确认，而且说清楚删的是什么
  const beforeDelete = await rows().count()
  await drawer.locator('div.group', { hasText: '房租转账' }).first()
    .getByRole('button', { name: /^删除/ }).click()
  const warned = await page.getByText('只从这台设备上移除', { exact: false })
    .waitFor({ state: 'visible', timeout: 5_000 }).then(() => true).catch(() => false)
  if (warned) ok('删除前有二次确认，并写明了「服务端与审计日志里的记录会保留」')
  else bad('删除没有二次确认')

  await page.getByRole('button', { name: '删除', exact: true }).click()
  await page.waitForTimeout(400)
  const afterDelete = await rows().count()
  if (afterDelete === beforeDelete - 1 && !(await rows().allInnerTexts()).some(t => t.includes('房租转账'))) {
    ok(`删除从列表里拿掉了一段（${beforeDelete} → ${afterDelete}）`)
  } else {
    bad('删除没有生效', `${beforeDelete} → ${afterDelete}`)
  }

  if (TAKE_SHOTS) await page.screenshot({ path: path.join(SHOT_DIR, 'agent-05-sessions.png'), fullPage: false })
} finally {
  await browser.close()
}

console.log()
if (failures === 0) console.log('check-agent: 全部通过')
else console.log(`check-agent: ${failures} 项未通过`)
process.exit(failures === 0 ? 0 : 1)
