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
import { login as loginWithCode, gotoInApp } from './lib/session.mjs'
import { mkdir, readdir } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

const args = process.argv.slice(2)
const baseIndex = args.indexOf('--base')
const BASE = baseIndex >= 0 ? args[baseIndex + 1] : 'http://127.0.0.1:5180'
const TAKE_SHOTS = args.includes('--shots')
const SHOT_DIR = path.resolve(import.meta.dirname, '../docs/design/implementation-screenshots/automated')

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
    localStorage.removeItem('luckycat.support.history.v1')
    localStorage.removeItem('luckycat.agent.sessions.v1')
    localStorage.removeItem('luckycat.ui.agentHistoryOpen')
  })
  /*
   * 登录态**不再写 localStorage**——现在只在内存里（见 app/src/lib/authToken.ts），
   * 所以这里走真实的登录流程：手机号 + 密码 + 短信验证码。
   * 上面那些 removeItem 仍然必要，而且**必须在登录之前**做：登录助手会直接
   * 把我们送到目标页，那之后这一页就已经读过一次本地记录了。
   */
  await loginWithCode(page, BASE, { to: '/support' })
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

  // ── 1. agent 通道必须真的连上（而不是回落固定话术）
  const agentTag = page.locator('[data-agent-status="ready"]')
  try {
    await agentTag.waitFor({ state: 'visible', timeout: 15_000 })
    ok('页面显示「已连接」状态（按 data-agent-status 锚点，不按文案）')
  } catch {
    bad('页面没有连上 agent', '确认 agent 演示服务与前端 dev server 都在跑')
  }

  // ── 1b. 页面上不再有快捷问题条（产品口径：去掉快捷方式）
  //    这条同时也守住了"没有一键发起资金操作的按钮"——按提示词入口整个没了。
  //    选择器要**窄**：顶栏那几个按钮（语音 / 历史对话 / 新对话）也带 `rounded-chip`，
  //    只按这个类名找会把它们一起数进来（实测踩到）。快捷问题条那批的高度是 `h-8`。
  const quickAsks = await page.locator('button.h-8.rounded-chip').allTextContents()
  if (quickAsks.length === 0) ok('输入框上方没有快捷问题条（已按要求去掉）')
  else bad('页面上还留着快捷问题条', quickAsks.join(' / '))

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
  await page.getByRole('button', { name: '新对话', exact: true }).click()
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

  // ── 9a2. 当前项那块高亮底是**跟着走的一条滑块**，不是每行各自上色。
  //        要断言两件事：它必须精确盖住当前行；切换时必须**滑**过去而不是跳过去。
  //        （这两件事只有真浏览器能量：位置来自测量，滑动是一段时序。）
  const pillGeometry = () => page.evaluate(() => {
    const aside = document.querySelector('aside[aria-label="历史对话"]')
    const pill = aside?.querySelector('.session-pill')
    const active = aside?.querySelector('div.group > button[aria-current="true"]')?.closest('div.group')
    if (!pill || !active) return null
    const p = pill.getBoundingClientRect()
    const a = active.getBoundingClientRect()
    return { deltaTop: p.top - a.top, deltaHeight: p.height - a.height, top: p.top, height: p.height }
  })

  const lined = await pillGeometry()
  if (lined === null) {
    bad('找不到当前项的高亮滑块（后面的滑动断言会空转）')
  } else if (Math.abs(lined.deltaTop) <= 1 && Math.abs(lined.deltaHeight) <= 1) {
    ok('高亮滑块精确盖住当前那一行（位置是从测量来的，没有偏）')
  } else {
    bad('高亮滑块和当前行没对齐',
      `上下差 ${lined.deltaTop.toFixed(1)}px、高矮差 ${lined.deltaHeight.toFixed(1)}px`)
  }

  // ── 9b. 切换：内容跟着换，而且**不许串**
  // 切之前先架上采样器，盯住滑块的位置（12ms 一次）。
  await page.evaluate(() => {
    window.__pillLog = []
    window.__pillTimer = window.setInterval(() => {
      const pill = document.querySelector('aside[aria-label="历史对话"] .session-pill')
      window.__pillLog.push(pill === null ? null : Math.round(pill.getBoundingClientRect().top))
    }, 12)
  })
  const pillTopBefore = lined?.top ?? null
  await rows().filter({ hasText: '帮我转 800 元' }).first().click()
  await page.waitForTimeout(600)
  const pillLog = await page.evaluate(() => {
    window.clearInterval(window.__pillTimer)
    return window.__pillLog
  })
  const pillStops = [...new Set(pillLog.filter(value => value !== null))]
  const pillTopAfter = (await pillGeometry())?.top ?? null
  // 只看到起点和终点 = 它是"跳"过去的；中间位置足够多才叫滑动。
  if (pillStops.length >= 4) {
    ok(`切换时高亮底是滑过去的（采样到 ${pillStops.length} 个中间位置：${pillTopBefore} → ${pillTopAfter}）`)
  } else {
    bad('切换时高亮底是跳过去的，没有滑动过程',
      `只采到 ${pillStops.length} 个位置：${pillStops.join(' → ')}`)
  }

  const relined = await pillGeometry()
  if (relined !== null && Math.abs(relined.deltaTop) <= 1 && Math.abs(relined.deltaHeight) <= 1) {
    ok('切完滑块落在新那一行上，高矮也和它一致')
  } else {
    bad('切完之后滑块没对齐新行', JSON.stringify(relined))
  }

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
  await page.getByRole('button', { name: '新对话', exact: true }).click()
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
  /*
   * 历史对话在 localStorage 里（登录态在 sessionStorage，刷新不受影响），
   * 这一条验的是"刷新之后本地历史还在"。
   *
   * **注意这里不能调本文件的 `login(page)`**：那个函数会先清掉
   * `luckycat.agent.sessions.v1`（它是给"每次从干净的对话开始"用的），
   * 而这一步要验的恰恰是那份记录还在。实测踩到：清完之后断言必然失败。
   * 所以直接用共用助手：只确保登录，不碰本地记录。
   */
  await loginWithCode(page, BASE, { to: '/support' })
  // 先等通道连上：抽屉只在 agent 可用时才渲染。太早点会点到"还没出现的按钮"，
  // 而 Playwright 会一直等它出现——等到了再点，反而把本来开着的抽屉关掉。
  await page.locator('[data-agent-status="ready"]').waitFor({ state: 'visible', timeout: 15_000 })

  /** 抽屉开着吗（`hidden sm:block` 那个 aside 可见即可）。 */
  const drawerUp = async () => await drawer.isVisible()

  /*
   * **刷新之后再发一句，id 不许和历史里的重复。**
   *
   * 实测抓出来的真 bug：`nextId()` 的计数器是模块级的，刷新后从 0 重来，
   * 而历史消息的 id 是从 localStorage 原样读回来的——于是刷新后新建的那条
   * 会拿到一个和旧消息**相同**的 id。后果是 `speakingId === item.id` 同时命中
   * 两条（页面上冒出两个朗读播放器）、React key 重复、按 id 定位的
   * 「重新生成 / 编辑」会指错行。
   *
   * **必须真的发一条再查**：只读刷新后的历史，"新 id 会不会撞"这件事
   * 根本没发生，断言是空的（第一版就是这么写的，变异测试没抓住）。
   * 用户消息在 `send()` 里是**同步**入列的，所以不用等模型回答。
   */
  {
    /*
     * 先把存档改成**老版本的形状**（id 是 `i1`、`i2`，没有页面前缀），
     * 再刷新、再发一条。这正是真实场景：**老用户升级到新版本**，
     * 他 localStorage 里躺着的是老代码写下的 id。
     *
     * 不造这个前提的话，断言是测不出东西的：新代码写的 id 已经带前缀，
     * 就算把前缀生成逻辑改坏成恒定值，新旧也对不上、撞不了（实测：
     * 变异注入了但断言照过）。
     */
    const renderedIds = await page.$$eval('[data-message-id]', nodes => nodes.map(n => n.dataset.messageId))
    await page.evaluate((ids) => {
      const key = 'luckycat.agent.sessions.v1'
      const list = JSON.parse(localStorage.getItem(key) ?? '[]')
      /*
       * 把**当前这段对话**的 id 改成老版本的形状：`i1`、`i2`…（无页面前缀）。
       *
       * 为什么要按"当前渲染出来的那几条"来改，而不是把所有对话统一去前缀：
       * 老版本的计数器是全局的，一段对话里的消息未必从 `i1` 开始；而真正会撞的
       * 情形是"**同一段对话**里已有 `i1`，刷新后新消息又拿到 `i1`"。
       * 把活动这段重排成从 `i1` 起，才是那个前提。实测：只统一去前缀时，
       * 活动的对话里根本没有 `i1` 这个 id，变异注入了也撞不上（断言空转）。
       */
      const renamed = new Map(ids.map((oldId, index) => [oldId, `i${index + 1}`]))
      for (const conversation of list) {
        for (const item of conversation.items ?? []) {
          if (renamed.has(item.id)) item.id = renamed.get(item.id)
        }
      }
      localStorage.setItem(key, JSON.stringify(list))
    }, renderedIds)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await loginWithCode(page, BASE, { to: '/support' })
    await page.locator('[data-agent-status="ready"]').waitFor({ state: 'visible', timeout: 20_000 })
    await page.getByPlaceholder('描述你的需求', { exact: false }).fill('你好')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(1_500)
    const ids = await page.$$eval('[data-message-id]', nodes => nodes.map(n => n.dataset.messageId))
    const unique = new Set(ids)
    if (ids.length === unique.size) ok(`刷新之后再发一条，消息 id 依然没有重复（${ids.length} 条）`)
    else {
      const dup = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))]
      bad('刷新之后新消息的 id 和历史撞了', `共 ${ids.length} 条、唯一 ${unique.size} 个；重复的是 ${JSON.stringify(dup)}`)
    }
  }

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

  // ── 9g. 空对话的两条规矩
  //   ① 已经是一段空对话时不许再新建（否则列表里会堆一串用不上的「新对话」）
  //   ② 从空对话切到有内容的对话，空的那段要被销毁
  // 用 exact：一段标题就叫「新对话」的对话，它的行按钮名字是「新对话 刚刚」/
  // 「重命名「新对话」」这类，非精确匹配会一起命中。
  const headerNewChat = page.getByRole('button', { name: '新对话', exact: true })

  const beforeBlank = await rows().count()
  await headerNewChat.click()
  await page.waitForTimeout(500)
  const afterBlank = await rows().count()
  if (afterBlank === beforeBlank + 1) ok(`在有内容的对话上点「新对话」会新建一段（${beforeBlank} → ${afterBlank}）`)
  else bad('点「新对话」没有新建', `${beforeBlank} → ${afterBlank}`)

  const blankTitle = (await drawer.locator('div.group:has(button[aria-current="true"])').first().innerText()).split('\n')[0]
  if (await headerNewChat.isDisabled()) {
    ok('站在空对话上时，「新对话」按钮是禁用的')
  } else {
    bad('站在空对话上时「新对话」还能点', `当前那段标题是「${blankTitle}」`)
  }

  // 再点一次：按钮已禁用，这里用 force 硬点一下，确认它**点不动**（列表条数不许变）。
  await headerNewChat.click({ force: true, timeout: 3_000 }).catch(() => { /* 禁用时点不动是预期 */ })
  await page.waitForTimeout(400)
  const stillBlank = await rows().count()
  if (stillBlank === afterBlank) ok('已经是一段空对话时再点「新对话」不会多出一段')
  else bad('空对话上还是能再新建', `${afterBlank} → ${stillBlank}`)

  // 切走 → 空的那段要被销毁
  await rows().filter({ hasText: '帮我转 800 元' }).first().click()
  await page.waitForTimeout(500)
  const afterLeave = await rows().count()
  const blankStillThere = (await rows().allInnerTexts()).some(t => t.startsWith('新对话'))
  if (afterLeave === stillBlank - 1 && !blankStillThere) {
    ok(`从空对话切走之后它被销毁了（${stillBlank} → ${afterLeave}）`)
  } else {
    bad('从空对话切走之后它还在列表里', `${stillBlank} → ${afterLeave}，列表里还有「新对话」吗：${blankStillThere}`)
  }

  if (!(await headerNewChat.isDisabled())) ok('切到有内容的对话之后，「新对话」又可以点了')
  else bad('切到有内容的对话之后，「新对话」还是禁用的')

  /* ══════════════════════════════════════════════════════════════════════
     10. 消息上的小动作：复制 / 编辑重发 / 重新生成
     ══════════════════════════════════════════════════════════════════════ */

  // 这一段刻意**另起一段对话**，并且用一句不需要工具的闲聊：
  // 编辑重发和重新生成都会让助手再答一次，如果还是"帮我转 800 元"，它会再调一次
  // 转账工具、再弹一张确认卡片——那张卡会把后面的操作全部冻住（这是设计如此），
  // 于是这个检查就变成了"在测卡片"，而不是在测消息动作。
  await headerNewChat.click()
  await page.waitForTimeout(300)
  const CHAT_PROMPT = '请只回四个字：收到收到。不要调用任何工具。'
  await input.fill(CHAT_PROMPT)
  await page.keyboard.press('Enter')

  /** 页面上某类消息的行。 */
  const messageRows = (kind) => page.locator(`[data-message-kind="${kind}"]`)
  /** 一段对话里"人看得见"的内容（不含工具执行过程）。 */
  const visibleMessages = async () =>
    (await page.locator('[data-message-kind] div.rounded-card').allInnerTexts()).map(t => t.trim())

  // 等第一轮答完
  let firstAnswered = false
  for (let i = 0; i < 120; i += 1) {
    if (await messageRows('assistant').count() >= 1) { firstAnswered = true; break }
    await page.waitForTimeout(500)
  }
  if (firstAnswered) ok('新开一段闲聊对话并拿到第一条回复（后面几条断言都在这段里做）')
  else bad('新开的对话一直没等到助手回复，后面的消息动作测不了')

  // 数请求：编辑重发和重新生成都必须**真的再发一次**，不能只是界面上少了条东西。
  let sendCalls = 0
  page.on('request', (request) => {
    if (request.method() !== 'POST') return
    if (/^\/agent-api\/sessions\/[^/]+\/messages$/.test(new URL(request.url()).pathname)) sendCalls += 1
  })

  // ── 10a. 两边都要能复制
  const userRows = await messageRows('user').count()
  const assistantRows = await messageRows('assistant').count()
  const userCopy = await messageRows('user').locator('button[aria-label="复制这条消息"]').count()
  const assistantCopy = await messageRows('assistant').locator('button[aria-label="复制这条回复"]').count()
  if (userRows >= 1 && assistantRows >= 1 && userCopy === userRows && assistantCopy === assistantRows) {
    ok(`用户和助手每条消息都带复制按钮（用户 ${userCopy} / 助手 ${assistantCopy}）`)
  } else {
    bad('复制按钮没有覆盖到每条消息',
      `消息 ${userRows} 用户 / ${assistantRows} 助手；按钮 ${userCopy} / ${assistantCopy}`)
  }

  // 复制的内容必须是**这一条**的原文：点助手最后一条，然后读剪贴板比对。
  // 剪贴板要显式授权，否则读回来是空的，断言会变成"空 == 空"那种假通过。
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE })
  const lastAssistantRow = messageRows('assistant').last()
  const lastAssistantWords = (await lastAssistantRow.locator('div.rounded-card').first().innerText()).trim()
  await lastAssistantRow.locator('button[aria-label="复制这条回复"]').click()
  const copied = await page.evaluate(() => navigator.clipboard.readText()).catch(() => null)
  // 剪贴板里是**原文**（可能带 `**`、`|---|`），气泡里是**渲染后**的文字。
  // 两边都去掉 Markdown 符号再比，否则一条带粗体的回复会被误判成"复制错了"。
  const plain = (text) => text.replace(/[*#`>\[\]()|_$~]/g, '').replace(/\s+/g, '')
  const copiedPlain = plain((copied ?? '').trim())
  const bubblePlain = plain(lastAssistantWords)
  if (copiedPlain !== '' && bubblePlain !== '' && bubblePlain.includes(copiedPlain.slice(0, 6))) {
    ok(`点复制之后剪贴板里是这一条的原文（读回 ${copiedPlain.length} 字，与气泡一致）`)
  } else {
    bad('复制的内容对不上', `剪贴板：${JSON.stringify((copied ?? '').slice(0, 60))}；气泡：${lastAssistantWords.slice(0, 60)}`)
  }

  const copyToast = await page.getByText('已复制这条回复', { exact: false })
    .waitFor({ state: 'visible', timeout: 3_000 }).then(() => true).catch(() => false)
  if (copyToast) ok('复制成功有明确反馈（不是点完没动静）')
  else bad('复制之后没有任何反馈')

  // ── 10b. 只有最后一条助手回复能重新生成
  const regenButtons = await page.locator('button[aria-label="重新生成这条回复"]').count()
  const regenInLast = await lastAssistantRow.locator('button[aria-label="重新生成这条回复"]').count()
  if (regenButtons === 1 && regenInLast === 1) {
    ok('「重新生成」只挂在最后一条助手回复上（不会让用户误删后面几轮）')
  } else {
    bad('「重新生成」挂的地方不对', `页面上 ${regenButtons} 个，最后一条里 ${regenInLast} 个`)
  }

  // ── 10c. 重新生成：要真的再问一遍，并且**旧的回复被换掉**
  await lastAssistantRow.locator('button[aria-label="重新生成这条回复"]').click()
  let regenSent = false
  for (let i = 0; i < 40; i += 1) {
    if (sendCalls >= 1) { regenSent = true; break }
    await page.waitForTimeout(500)
  }
  if (regenSent) ok(`点「重新生成」真的又发了一次（服务端收到 ${sendCalls} 次发言）`)
  else bad('点「重新生成」没有发出任何请求——它只改了界面')

  // 等新一轮答完（转圈的三个点在就说明还在写）
  for (let i = 0; i < 160; i += 1) {
    if (await page.locator('span.animate-bounce').count() === 0 && sendCalls >= 1) break
    await page.waitForTimeout(500)
  }
  await page.waitForTimeout(400)

  // 关键在**没有变多**：倒回重发必须先把旧回复截掉。
  // 只断言"不少于之前"是不够的——旧回复要是留着，这里会变成三条，
  // 而"不少于"照样成立（这条断言原来是这么写的，等于白测）。
  const assistantAfter = await messageRows('assistant').count()
  const userAfter = await messageRows('user').count()
  if (assistantAfter === assistantRows && userAfter === 1) {
    ok(`重新生成之后旧回复被换掉而不是堆起来（助手 ${assistantRows} → ${assistantAfter} 条，用户仍是 ${userAfter} 条）`)
  } else {
    bad('重新生成之后这段对话的形状不对——像是把新回复追加上了，没有截掉旧的',
      `助手 ${assistantRows} → ${assistantAfter} 条；用户 ${userAfter} 条`)
  }

  // ── 10d. 编辑重发：改的是这一条，而且说清楚代价
  const targetRow = messageRows('user').first()
  await targetRow.locator('button[aria-label="编辑这条消息"]').click()
  const dialog = page.getByRole('dialog', { name: '修改这条消息' })
  const editShown = await dialog.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true).catch(() => false)
  if (editShown) ok('用户消息上有「编辑」，点开是一个弹框')
  else bad('点「编辑」没有打开弹框')

  // 框里那句话是这套实现最容易让人误解的地方（本地记录倒回去了、服务端没有），
  // 它必须在**按下去之前**就写在脸上，否则用户会以为"助手当没听过原来那句"。
  const honest = await dialog.getByText('助手那边的会话记录退不回去', { exact: false }).count()
  if (honest >= 1) ok('弹框里写明了「服务端的会话记录退不回去」（不许给出错误的安全感）')
  else bad('编辑弹框没有说明服务端的记录退不回去')

  const dropped = await dialog.getByText('会从这台设备的记录里删掉', { exact: false }).count()
  if (dropped >= 1) ok('弹框里写明了这条之后的几条内容会被删掉')
  else bad('编辑弹框没有说清后面会被删掉')

  const EDIT_PROMPT = '请只回三个字：好的呀。不要调用任何工具。'
  await dialog.getByLabel('修改后的消息').fill(EDIT_PROMPT)
  const sendsBeforeEdit = sendCalls
  await dialog.getByRole('button', { name: '保存并重发' }).click()

  let editSent = false
  for (let i = 0; i < 40; i += 1) {
    if (sendCalls > sendsBeforeEdit) { editSent = true; break }
    await page.waitForTimeout(500)
  }
  if (editSent) ok('「保存并重发」真的按新说法重新问了一遍')
  else bad('「保存并重发」没有发出请求')

  await page.waitForTimeout(800)
  const afterEdit = await visibleMessages()
  if (afterEdit.some(t => t.includes('好的呀')) && !afterEdit.some(t => t.includes('收到收到'))) {
    ok('列表里换成了改过的说法，原来那句已经不在了')
  } else {
    bad('编辑之后列表内容不对', JSON.stringify(afterEdit).slice(0, 200))
  }

  if (TAKE_SHOTS) await page.screenshot({ path: path.join(SHOT_DIR, 'agent-06-message-actions.png'), fullPage: false })
} finally {
  await browser.close()
}

console.log()
if (failures === 0) console.log('check-agent: 全部通过')
else console.log(`check-agent: ${failures} 项未通过`)
process.exit(failures === 0 ? 0 : 1)
