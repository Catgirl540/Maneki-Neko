/**
 * 官网首页与总览页拆分的浏览器检查。
 *
 * ## 为什么单独测这件事
 *
 * `/` 从「登录后的总览」改成了「公开的官网」，`/dashboard` 才是总览。
 * 这类改动**坏起来不报错**：未登录的人访问 `/` 如果还被弹去登录页，
 * 页面照样渲染、控制台照样干净，只是官网根本没人看得见；
 * 而路由守卫写松了（把 `/` 也放进需要登录的那一组），后果是**官网公开可访问
 * 变成了首页公开可访问**——那是把控制台的门敞开了。
 * 所以这里逐条钉住「谁能进、谁不能进、被弹到哪里」。
 *
 * 需要前端 dev server 在跑：
 *   node tools/check-landing.mjs
 *   node tools/check-landing.mjs --base http://127.0.0.1:5180
 */

import { chromium } from 'playwright-core'
import { login, gotoInApp } from './lib/session.mjs'
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

const executablePath = await findChrome()
const browser = await chromium.launch({ executablePath })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })

/** 官网首屏的标记文案。用它判断"这一页是不是官网"。 */
const LANDING_MARK = '新形态银行'
/** 总览页才有的东西。 */
const DASHBOARD_MARK = '账户速览'

const has = async (page, text) => (await page.locator('body').innerText()).includes(text)

/**
 * 读页面正文，**排除常驻水印**。
 *
 * 水印是 `fixed` 定位、和页面同属 `body`，所以 `body.innerText` 会把它的文案
 * 一起读进来。实测踩到：水印那句「非真实银行」被当成"正文又写了一遍演示声明"，
 * 于是一条正确的改动被判成失败。
 */
async function readCopy(page) {
  return await page.evaluate(() => {
    const mark = document.querySelector('[aria-label^="本作品为比赛演示用途"]')
    const previous = mark === null ? undefined : mark.style.display
    if (mark !== null) mark.style.display = 'none'
    const text = document.body.innerText
    if (mark !== null) mark.style.display = previous ?? ''
    return text
  })
}

try {
  const page = await context.newPage()

  /* ── 1. 未登录：官网必须能直接看 ───────────────────────────────────── */
  // 这一整段测的是**未登录**时的行为，所以要真正的整页加载（内存里没有登录态，
  // 整页加载与客户端跳转在这里等价，但整页加载更贴近"用户直接打开这个地址"）
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  const path1 = new URL(page.url()).pathname
  if (path1 === '/' && await has(page, LANDING_MARK)) {
    ok('未登录访问 `/` 看到官网（没有被弹去登录页）')
  } else {
    bad('未登录访问 `/` 不是官网', `落地 ${path1}；标题在不在：${await has(page, LANDING_MARK)}`)
  }

  const noShell = (await page.locator('aside, nav[aria-label]').count()) === 0
  if (noShell) ok('官网没有套应用外壳（不带侧栏，和登录页一致）')
  else bad('官网上出现了应用外壳的侧栏')

  /* ── 2. 官网上的 CTA 要指向真实入口 ────────────────────────────────── */
  const toLogin = await page.getByRole('link', { name: '登录', exact: true }).count()
  // 只认「开户」二字：CTA 的措辞会改（登记开户 / 立即开户），
  // 但"官网上必须有开户入口"这件事不变——绑死整句会因为改文案而误报
  const toOpen = await page.getByRole('link', { name: /开户/ }).count()
  if (toLogin >= 1 && toOpen >= 1) ok('官网上有「登录」与「登记开户」两个入口')
  else bad('官网缺少入口', `登录 ${toLogin} 个、开户 ${toOpen} 个`)

  /* ── 3. 未登录：总览必须拦住 ───────────────────────────────────────── */
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' })
  const path3 = new URL(page.url()).pathname
  if (path3 === '/login') {
    ok('未登录访问 `/dashboard` 被弹到登录页（总览没有跟着官网一起公开）')
  } else {
    bad('未登录访问 `/dashboard` 没有被拦住', `落地 ${path3}`)
  }

  /* ── 4. 认不出的路径回官网 ─────────────────────────────────────────── */
  await page.goto(`${BASE}/no-such-page-xyz`, { waitUntil: 'networkidle' })
  const path4 = new URL(page.url()).pathname
  if (path4 === '/' && await has(page, LANDING_MARK)) ok('认不出的路径回落到官网（不是回总览）')
  else bad('认不出的路径没有回到官网', `落地 ${path4}`)

  /* ── 5. 登录后：官网仍然能看，并且给出「进入总览」 ───────────────────
     走真实登录流程（手机号 + 密码 + 短信验证码）——登录态现在只在内存里，
     往 localStorage 写 token 已经不起作用了。目标写 `/`：登录助手会先落总览，
     再应用内换到官网，所以这段结束时我们**是已登录状态**地待在官网上。 */
  await login(page, BASE, { to: '/' })
  if (new URL(page.url()).pathname === '/' && await has(page, LANDING_MARK)) {
    ok('已登录也能待在官网（不会因为登录了就被赶去总览）')
  } else {
    bad('已登录访问 `/` 被弹走了', `落地 ${new URL(page.url()).pathname}`)
  }

  const enter = page.getByRole('link', { name: /进入总览/ }).first()
  if (await enter.count() === 0) {
    bad('已登录的官网上没有「进入总览」入口——等于进了官网就出不去')
  } else {
    await enter.click()
    await page.waitForTimeout(800)
    const path5 = new URL(page.url()).pathname
    if (path5 === '/dashboard' && await has(page, DASHBOARD_MARK)) {
      ok('点「进入总览」落到 `/dashboard` 并看到总览内容')
    } else {
      bad('「进入总览」没落到总览', `落地 ${path5}；内容在不在：${await has(page, DASHBOARD_MARK)}`)
    }
  }

  /* ── 6. 侧栏「总览」指向新路径 ─────────────────────────────────────── */
  const navHome = page.getByRole('link', { name: '总览', exact: true }).first()
  if (await navHome.count() === 0) {
    bad('侧栏里找不到「总览」入口')
  } else {
    const href = await navHome.getAttribute('href')
    if (href === '/dashboard') ok('侧栏「总览」指向 `/dashboard`')
    else bad('侧栏「总览」还指着旧路径', `href=${href}`)
  }

  /* ── 7. 已登录访问登录页 → 去总览（不是停在官网）─────────────────────── */
  // 已登录去登录页会被守卫立刻送回总览，所以期望落点是 /dashboard（见 gotoInApp 的 expect）
  await gotoInApp(page, '/login', { expect: '/dashboard' })
  const path7 = new URL(page.url()).pathname
  if (path7 === '/dashboard') ok('已登录访问 `/login` 会被送去总览')
  else bad('已登录访问 `/login` 的去向不对', `落地 ${path7}`)

  /* ── 8. 这一页的主角必须是 agent（版面改了但文案没跟上，是很容易发生的事）── */
  await gotoInApp(page, '/')
  const body = await readCopy(page)
  const agentWords = ['调用工具', '确认', '支付密码'].filter(t => body.includes(t))
  if (agentWords.length === 3) {
    ok('官网主线是 agent：写到了「调用工具」「确认」「支付密码」')
  } else {
    bad('官网没有把 agent 讲清楚', `缺：${['调用工具', '确认', '支付密码'].filter(t => !body.includes(t)).join('、')}`)
  }

  /* ── 9. 页内锚点都得落到真实元素上 ───────────────────────────────────
     和站内路由是同一类坑：`href="#agent"` 写错一个字母，点了**什么都不发生**，
     不报错、不跳转。`tools/check-routes.mjs` 管的是路由，管不到锚点。 */
  const anchors = await page.locator('a[href^="#"]').evaluateAll(
    as => [...new Set(as.map(a => a.getAttribute('href')).filter(h => h !== null && h !== '#'))],
  )
  const missing = []
  for (const href of anchors) {
    const found = await page.locator(href).count()
    if (found === 0) missing.push(href)
  }
  if (anchors.length === 0) {
    bad('官网上一处页内锚点都没有', '选择器过时了，这条断言会空转通过')
  } else if (missing.length === 0) {
    ok(`${anchors.length} 个页内锚点都能落到真实元素上（${anchors.join(' ')}）`)
  } else {
    bad('有页内锚点指向不存在的元素（点了不会动）', missing.join(' '))
  }

  /* ── 10. 正文不重复"这是演示作品"的声明 ─────────────────────────────
     演示标识由 `DemoWatermark` 在每条路由上常驻显示（那条断言在
     `tools/check-watermark.mjs` 里，两边合起来才完整：
     水印必须在 + 正文不许再重复一遍）。 */
  // 只盯**声明性质**的话。「演示环境」不算：它常常只是在说明登录方式。
  const repeated = ['演示作品', '演示项目', '非真实银行', '不接入真实银行', '不提供任何金融服务']
    .filter(t => body.includes(t))
  if (repeated.length === 0) {
    ok('正文没有重复演示声明（这件事归水印管，不占正文篇幅）')
  } else {
    bad('正文又写了一遍演示声明（水印已经写着了）', repeated.join('、'))
  }

  /* ── 11. 反向断言：不许编造背书 ──────────────────────────────────────
     真实机构官网会放用户数、获奖、应用商店评分。这个项目一个都没有，
     写了就是编的。**不声明"这是演示"不等于可以乱说。** */
  const fake = ['百万用户', '第一数字银行', '年度数字银行', 'App Store 4', '用戶數量']
    .filter(t => body.includes(t))
  if (fake.length === 0) ok('官网上没有编造的用户量/获奖/评分背书')
  else bad('官网上出现了编造的背书', fake.join('、'))
} finally {
  await browser.close()
}

console.log()
if (failures === 0) console.log('check-landing: 全部通过')
else console.log(`check-landing: ${failures} 项未通过`)
process.exit(failures === 0 ? 0 : 1)
