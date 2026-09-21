/**
 * 登录与登录态的检查。
 *
 * 这一份盯的是**两件产品口径**，都是明确要求过的：
 *
 *   1. **关掉浏览器就退出登录。** 登录态存在 `sessionStorage` 里——
 *      同一个标签页刷新还在，**新开标签页 / 关掉浏览器就没了**。
 *   2. **登录要手机号 + 密码 + 短信验证码三样都对**，而且验证码是一次性的。
 *
 * 为什么值得单独测：这两件事**坏起来都不报错**。登录态一旦被写进
 * `localStorage`（而不是 sessionStorage），"关掉浏览器退出登录"就悄悄失效了——
 * 页面一切正常、没人会发现；验证码那一格如果不校验，登录照样成功，
 * 只是那一步变成了摆设。所以每一条都用**可观察的行为**去钉：
 * 刷新还在不在、新标签页要不要重新登、同一个码还能不能用第二次。
 *
 * 需要前端 dev server 在跑：
 *   node tools/check-login.mjs
 *   node tools/check-login.mjs --base http://127.0.0.1:5180
 */

import { chromium } from 'playwright-core'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { DEMO_PHONE, DEMO_PASSWORD } from './lib/session.mjs'

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

/** 页面上那条报错（登录失败时显示的东西）。 */
const alertText = async (page) =>
  await page.locator('[role="alert"]').first().innerText().catch(() => '')

/** 当前地址。 */
const here = async (page) => await page.evaluate(() => window.location.pathname)

/**
 * 等登录成功。判据是**离开登录页**，而不是落到某个写死的页面：
 * 登录后会回到"被守卫拦下来的那一页"（`from`），所以落点是哪个页面取决于
 * 之前去过哪，写死 `/dashboard` 会在正确的行为上误报（实测踩到）。
 */
const waitLoggedIn = async (page) =>
  await page.waitForFunction(() => window.location.pathname !== '/login', null, { timeout: 15_000 })
    .then(() => true).catch(() => false)

/**
 * 两个 storage 里各自有什么。
 *
 * 分清这两处是这条检查的重点：**登录态放 sessionStorage**（关标签页就没），
 * **业务数据放 localStorage**（关标签页还在）。放错地方不会报错，
 * 只会让"关掉浏览器退出登录"或"刷新不丢记录"其中一条悄悄失效。
 */
const storedAuth = async (page) => await page.evaluate(() => ({
  session: {
    token: sessionStorage.getItem('luckycat.token'),
    user: sessionStorage.getItem('luckycat.session.user'),
  },
  local: {
    token: localStorage.getItem('luckycat.token'),
    user: localStorage.getItem('luckycat.session.user'),
  },
}))

async function fillCredentials(page) {
  await page.getByPlaceholder('请输入 11 位手机号').fill(DEMO_PHONE)
  await page.getByPlaceholder('请输入密码').fill(DEMO_PASSWORD)
}

/** 点「获取验证码」并把页面上显示的码读出来。 */
async function requestCode(page) {
  await page.getByRole('button', { name: '获取验证码' }).click()
  const hint = page.getByText(/演示环境验证码[：:]\s*\d{6}/)
  await hint.waitFor({ state: 'visible', timeout: 10_000 })
  return /\d{6}/.exec(await hint.innerText())?.[0]
}

try {
  const page = await context.newPage()

  /* ── 1. 未登录进不去银行页面 ───────────────────────────────────────── */
  await page.goto(`${BASE}/wealth`, { waitUntil: 'networkidle' })
  if (await here(page) === '/login') ok('未登录访问 `/wealth` 被守卫弹到登录页')
  else bad('未登录访问 `/wealth` 没有被拦住', `落地 ${await here(page)}`)

  /* ── 2. 不获取验证码就登录 → 必须被拒 ─────────────────────────────── */
  await fillCredentials(page)
  await page.getByPlaceholder('请输入 6 位验证码').fill('123456')
  await page.getByRole('button', { name: '登入' }).click()
  await page.waitForTimeout(1200)
  const noCodeMsg = await alertText(page)
  if (await here(page) === '/login' && noCodeMsg.includes('验证码')) {
    ok(`没获取验证码就登录被拒（提示「${noCodeMsg}」）`)
  } else {
    bad('没获取验证码也能登录，或者被拒的理由不对', `落地 ${await here(page)}；报错 ${JSON.stringify(noCodeMsg)}`)
  }

  /* ── 3. 获取验证码：页面上要给出码（演示环境），且有重发倒计时 ─────── */
  const code = await requestCode(page)
  if (typeof code === 'string' && /^\d{6}$/.test(code)) {
    ok(`点「获取验证码」后页面上给出了 6 位验证码（${code}）`)
  } else {
    bad('拿不到演示验证码', String(code))
  }

  const cooldown = await page.getByRole('button', { name: /\d+ 秒后重发/ }).count()
  if (cooldown >= 1) ok('发出后按钮进入重发倒计时（防止连点把短信打爆）')
  else bad('发出验证码之后没有倒计时，按钮还能继续点')

  /* ── 4. 验证码填错 → 必须被拒，而且不能放进去 ─────────────────────── */
  await page.getByPlaceholder('请输入 6 位验证码').fill('000000')
  await page.getByRole('button', { name: '登入' }).click()
  await page.waitForTimeout(1200)
  const wrongMsg = await alertText(page)
  if (await here(page) === '/login' && wrongMsg.includes('验证码')) {
    ok(`验证码填错被拒（提示「${wrongMsg}」）`)
  } else {
    bad('验证码填错也能登录', `落地 ${await here(page)}；报错 ${JSON.stringify(wrongMsg)}`)
  }

  /* ── 5. 三样都对 → 进入应用 ───────────────────────────────────────── */
  await page.getByPlaceholder('请输入 6 位验证码').fill(code ?? '')
  await page.getByRole('button', { name: '登入' }).click()
  await page.waitForFunction(() => window.location.pathname === '/wealth', null, { timeout: 15_000 })
    .then(() => ok('手机号 + 密码 + 验证码都对之后进入应用（而且回到了原本想去的 `/wealth`）'))
    .catch(async () => bad('三样都对也没能进入应用', `落地 ${await here(page)}；报错 ${await alertText(page)}`))


  /* ── 6. 登录态存在 sessionStorage，不在 localStorage ─────────────── */
  const stored = await storedAuth(page)
  if (stored.local.token === null && stored.local.user === null) {
    ok('localStorage 里没有登录态（它只放业务数据）')
  } else {
    bad('登录态被写进了 localStorage——那样关掉浏览器也不会退出',
      `token=${JSON.stringify(stored.local.token)}`)
  }
  if (stored.session.token !== null && stored.session.user !== null) {
    ok('登录态在 sessionStorage 里（关掉标签页就没了）')
  } else {
    bad('sessionStorage 里没有完整的登录态，"刷新还在"这条就保不住',
      `token=${JSON.stringify(stored.session.token)} user=${stored.session.user === null ? 'null' : '有值'}`)
  }

  /* ── 7. 同一个标签页里**刷新**不该退出（这是与上一版口径的区别）───── */
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
  const afterReload = await here(page)
  if (afterReload === '/wealth') {
    ok('刷新之后仍然登录着（sessionStorage 在同一个标签页里是留着的）')
  } else {
    bad('刷新之后掉登录了——那样"关掉浏览器才退出"就变成了"刷新就退出"', `落地 ${afterReload}`)
  }

  /* ── 8. 新标签页 = 未登录（"关掉浏览器就退出"唯一能自动测的形式）───
     sessionStorage 是**按标签页隔离**的，新开一个标签页拿不到上一个的登录态，
     这正是"关浏览器退出"的等价行为：浏览器没了，标签页就都没了。
     顺带它也是下面"验证码一次性"要用的干净入口——而且**不动演示库**
     （新标签页共享同一个 localStorage），所以不会像"退出登录"那样
     把 pendingSms 一起清掉、让那条断言变成空测。 */
  const fresh = await context.newPage()
  try {
    await fresh.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' })
    await fresh.waitForTimeout(500)
    if (await here(fresh) === '/login') {
      ok('新开一个标签页是未登录的（等价于"关掉浏览器就退出"）')
    } else {
      bad('新标签页里还是登录状态——登录态没有跟着标签页隔离', `落地 ${await here(fresh)}`)
    }

    /* ── 9. 验证码一次性：同一个码不能用第二次 ───────────────────────
       手法：在**新标签页**里拿刚才那个已经用过的码再登一次。
       演示库没有被重置（没用退出登录），所以 pendingSms 的状态才有意义——
       实测踩到过：靠"退出登录"回到登录页，测到的只是"退出把库清了"，
       把"用完作废"那行删掉照样通过（假通过）。 */
    await fresh.getByPlaceholder('请输入 11 位手机号').fill(DEMO_PHONE)
    await fresh.getByPlaceholder('请输入密码').fill(DEMO_PASSWORD)
    await fresh.getByPlaceholder('请输入 6 位验证码').fill(code ?? '')
    await fresh.getByRole('button', { name: '登入' }).click()
    await fresh.waitForTimeout(1400)
    if (await here(fresh) === '/login') {
      ok('验证码是一次性的：同一个码第二次登录被拒（必须重新获取）')
    } else {
      bad('同一个验证码可以重复登录——"一次性"没有生效', `落地 ${await here(fresh)}`)
    }
  } finally {
    await fresh.close()
  }

  /* ── 10. 退出登录：回到登录页并把 sessionStorage 清干净 ───────────── */
  const logout = page.getByRole('button', { name: /退出登录/ }).first()
  if (await logout.count() === 0) {
    bad('侧栏里找不到「退出登录」入口')
  } else {
    await logout.click()
    await page.waitForTimeout(900)
    if (await here(page) === '/login') ok('点「退出登录」回到登录页')
    else bad('退出登录之后没有回到登录页', `落地 ${await here(page)}`)

    const after = await storedAuth(page)
    if (after.session.token === null && after.session.user === null) {
      ok('退出登录把 sessionStorage 里的登录态清干净了（不是只把界面切走）')
    } else {
      bad('退出登录之后 sessionStorage 里还留着登录态',
        `token=${JSON.stringify(after.session.token)}`)
    }
  }
} finally {
  await browser.close()
}

console.log()
if (failures === 0) console.log('check-login: 全部通过')
else console.log(`check-login: ${failures} 项未通过`)
process.exit(failures === 0 ? 0 : 1)
