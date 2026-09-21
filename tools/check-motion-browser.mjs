/**
 * 动效的浏览器检查：证明"减少动态效果"真的生效、退场动画真的会播。
 *
 * 为什么不能只查 CSS 源码（`tools/check-motion.mjs` 做的那部分）：
 *
 *   · 「`prefers-reduced-motion` 时动效被关掉」是**层叠优先级**的问题。
 *     `.pop-in` 写在 `@layer components` 里，兜底块写在文件末尾的 `@media` 里——
 *     看起来稳赢，但只要有人把兜底块挪进某个 `@layer`，或者 Tailwind 的
 *     utility 换了个名字，就会变成"样式在、但不生效"。**源码里看不出来**。
 *
 *   · 「关掉的元素还会留在 DOM 里把动画播完」是个时序行为，
 *     只能在真浏览器里点一下才知道。
 *
 * 只需要前端 dev server（`cd app && npm run dev`），**不需要 agent 服务、不需要模型**：
 * 走的是有 mock 数据的 `/security` 页。
 *
 *   node tools/check-motion-browser.mjs
 *   node tools/check-motion-browser.mjs --base http://127.0.0.1:5180
 */

import { chromium } from 'playwright-core'
import { login as loginWithCode, gotoInApp } from './lib/session.mjs'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

const args = process.argv.slice(2)
const baseIndex = args.indexOf('--base')
const BASE = baseIndex >= 0 ? args[baseIndex + 1] : 'http://127.0.0.1:5180'

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

/** 注入登录态（与 tools/check-agent.mjs 同一套 key）。 */
/**
 * 登录并落到安全中心。
 *
 * 登录态**不写 localStorage**（现在只在内存里，见 `app/src/lib/authToken.ts`），
 * 所以这里走真实的登录流程：手机号 + 密码 + 短信验证码。
 */
async function login(page) {
  await loginWithCode(page, BASE, { to: '/security' })
}

/**
 * 读某个选择器上第一个元素的动画时长（毫秒）。
 * @returns 时长；元素不在时返回 null。
 */
async function animationMs(page, selector) {
  return await page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (el === null) return null
    const ms = getComputedStyle(el).animationDuration
    const first = ms.split(',')[0].trim()
    return first.endsWith('ms') ? Number.parseFloat(first) : Number.parseFloat(first) * 1000
  }, selector)
}

const executablePath = await findChrome()
const browser = await chromium.launch({ executablePath })
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  locale: 'zh-CN',
})

try {
  const page = await context.newPage()
  await login(page)
  /*
   * 等页面真的渲染出来再断言。
   * 原来的写法是整页 `goto(..., { waitUntil: 'networkidle' })`，它会等到数据取完；
   * 换成应用内换页之后**没有可等的加载事件**，所以要显式等内容出现，
   * 否则断言会在"页面还在加载"的窗口里跑，量到一堆 null。
   */
  await page.locator('main').waitFor({ state: 'visible', timeout: 10_000 })
  await page.waitForTimeout(800)

  // ── 1. 先确认"平时确实有动画"。少了这条，下面所有"时长为 0"的断言
  //      都可能只是因为选择器抓空了而空转通过。
  const liveMs = await animationMs(page, '.float-up')
  if (liveMs === null) {
    bad('页面上找不到带头入动画的元素（检查会空转）', '.float-up 一个都没有')
  } else if (liveMs > 50) {
    ok(`平时动效是开着的（.float-up 时长 ${liveMs}ms）`)
  } else {
    bad('平时动效就是关的，无法判断兜底块有没有生效', `.float-up 时长只有 ${liveMs}ms`)
  }

  // ── 2. 开了"减少动态效果"之后必须归零
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.reload({ waitUntil: 'domcontentloaded' })
  /*
   * 刷新之后补一次登录：登录态在 sessionStorage，正常刷新是留着的，
   * 这一行在没登出时是空操作（`login` 会直接跳过）。留着是为了这一条检查
   * 不依赖"上一步有没有把登录搞丢"这种隐含前提。
   */
  await login(page)
  await page.locator('main').waitFor({ state: 'visible', timeout: 10_000 })
  await page.waitForTimeout(800)
  const reducedMs = await animationMs(page, '.float-up')
  if (reducedMs === null) {
    bad('开了减少动态效果之后找不到元素')
  } else if (reducedMs <= 1) {
    ok(`减少动态效果时动画被压到 ${reducedMs}ms（兜底块的层叠优先级是对的）`)
  } else {
    bad('减少动态效果没有生效——兜底块输给了别的样式', `.float-up 时长仍是 ${reducedMs}ms`)
  }

  const reducedDelay = await page.evaluate(() => {
    const el = document.querySelector('.float-up')
    return el === null ? null : getComputedStyle(el).animationDelay
  })
  if (reducedDelay === '0s' || reducedDelay === '0ms') {
    ok('减少动态效果时动画延迟也被清掉了（否则带延迟的元素会先空一块）')
  } else {
    bad('减少动态效果时动画延迟没被清掉', `animationDelay = ${reducedDelay}`)
  }

  // 换回正常动效，验证退场。同样要重新登录（见上）
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await login(page)
  await page.locator('main').waitFor({ state: 'visible', timeout: 10_000 })
  await page.waitForTimeout(800)

  // ── 3. 弹层：关掉之后必须**先留在 DOM 里把退场动画播完**，再消失。
  //      这是纯时序行为，源码里看不出来（`if (!open) return null` 会瞬间抽走）。
  await page.getByRole('button', { name: '修改' }).first().click()
  const dialog = page.getByRole('dialog', { name: '重置登录密码' })
  try {
    await dialog.waitFor({ state: 'visible', timeout: 5_000 })
    ok('点了「修改」之后弹层出现')
  } catch {
    bad('弹层没有出现，后面的退场检查没法做')
  }

  const enterState = await page.evaluate(() => {
    const panel = document.querySelector('[role="dialog"]')
    return panel === null ? null : {
      name: getComputedStyle(panel).animationName,
      ms: getComputedStyle(panel).animationDuration,
    }
  })
  if (enterState !== null && enterState.name.includes('pop-in') && Number.parseFloat(enterState.ms) > 0) {
    ok(`弹层入场跑的是 pop-in（${enterState.ms}）`)
  } else {
    bad('弹层入场没有跑 pop-in', JSON.stringify(enterState))
  }

  // 点「取消」之后，弹层要**先留在 DOM 里把退场动画播完**，再消失。
  // 这是纯时序行为，源码里看不出来（写成 `if (!open) return null` 会瞬间抽走）。
  //
  // 不能"点完再 evaluate 看一眼"：退场只有 140ms，一次 CDP 往返就过去了，
  // 抓到的永远是"已经没了"（实测踩到，白报一个 FAIL）。
  // 所以在点之前先架上采样器，每 10ms 记一次弹层的状态。
  await page.evaluate(() => {
    window.__motionLog = []
    window.__motionTimer = window.setInterval(() => {
      const panel = document.querySelector('[role="dialog"]')
      window.__motionLog.push(panel === null ? 'gone' : getComputedStyle(panel).animationName)
    }, 10)
  })
  await page.getByRole('button', { name: '取消' }).first().click()
  await page.waitForTimeout(700)
  const log = await page.evaluate(() => {
    window.clearInterval(window.__motionTimer)
    return window.__motionLog
  })

  const exitFrames = log.filter(name => name.includes('pop-out')).length
  if (exitFrames > 0) {
    ok(`点「取消」之后弹层留在原地播了退场动画（采样到 ${exitFrames} 帧 pop-out 才消失）`)
  } else {
    bad('关掉弹层时没有退场动画——它是瞬间从 DOM 里没的', `采样序列：${log.slice(0, 12).join(' → ') || '（空）'}`)
  }

  const endsGone = log.length > 0 && log[log.length - 1] === 'gone'
  if (endsGone) ok('退场动画放完之后弹层真的从 DOM 里摘掉了')
  else bad('退场之后弹层一直留在 DOM 里', `最后一帧是 ${String(log[log.length - 1])}`)

  // ── 4. 常驻挂载的代价：重开必须是**干净的**。
  //      为了播退场动画，弹层不再"关掉就卸载"（以前靠卸载来重置表单），
  //      所以"重开清空"变成了必须自己保证的一件事——这是这次改动最容易漏的回归。
  await page.getByRole('button', { name: '修改' }).first().click()
  await dialog.waitFor({ state: 'visible', timeout: 5_000 })
  const oldField = page.getByLabel('原密码')
  await oldField.fill('不该留下来的东西')
  await page.getByRole('button', { name: '取消' }).first().click()
  await page.waitForTimeout(400)

  await page.getByRole('button', { name: '修改' }).first().click()
  await dialog.waitFor({ state: 'visible', timeout: 5_000 })
  const leftover = await page.getByLabel('原密码').inputValue()
  if (leftover === '') ok('重新打开时表单是空的（常驻挂载没有把上次的输入带过来）')
  else bad('重新打开时上次填的内容还在', `原密码 = ${JSON.stringify(leftover)}`)
} finally {
  await browser.close()
}

console.log()
if (failures === 0) console.log('check-motion-browser: 全部通过')
else console.log(`check-motion-browser: ${failures} 项未通过`)
process.exit(failures === 0 ? 0 : 1)
