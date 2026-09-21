/**
 * 比赛演示水印的可见性检查。
 *
 * 起因：水印第一版贴在顶栏带子里（`top-6 z-20`），而顶栏是
 * `sticky top-0 z-30 h-[76px] bg-paper/85 backdrop-blur` ——
 * 背景铺满整条，z 更低的元素被那层不透明的底连模糊一起吃掉，直接看不见。
 * 「元素在 DOM 里」不等于「用户看得见」，所以这里要断言的是**渲染结果**：
 *   ① 元素存在且在视口内
 *   ② 未被祖先/兄弟的 overflow 或 display 隐藏
 *   ③ 它的方框**不与吸顶顶栏重叠** —— 第一版就是栽在这里：
 *      顶栏是 sticky top-0 z-30 h-[76px] bg-paper/85，水印贴在带子里却只有 z-20，
 *      被那层不透明的底连模糊一起吃掉。
 *      注意**不能**用 elementFromPoint 判"有没有被盖住"：水印是 pointer-events-none，
 *      而 elementFromPoint 会跳过不可命中元素，永远返回别人 —— 这个断言不成立。
 *   ④ 覆盖所有路由，包括没有应用外壳的登录页与开户页
 *
 *   node tools/check-watermark.mjs [baseUrl]
 */
import { chromium } from 'playwright-core'
import { login } from './lib/session.mjs'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

const BASE = process.argv[2] ?? 'http://127.0.0.1:5180'
const TEXT = '比赛演示作品 · 非真实银行'

async function findChrome() {
  const cache = path.join(os.homedir(), '.cache/ms-playwright')
  const dirs = (await readdir(cache)).filter((d) => d.startsWith('chromium-'))
  return path.join(cache, dirs.sort().at(-1), 'chrome-linux64', 'chrome')
}

const browser = await chromium.launch({ executablePath: await findChrome() })

let failures = 0
const report = (ok, title, lines = []) => {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${title}`)
  for (const line of lines) console.log(`      ${line}`)
}

/** 有外壳的路由要登录，登录页 / 开户页不要 */
const ROUTES = [
  { path: '/login', auth: false },
  { path: '/open-account', auth: false },
  // 官网首页（公开）与总览（要登录）都要盖水印——演示标识不能只盖在登录之后
  { path: '/', auth: false },
  { path: '/dashboard', auth: true },
  { path: '/wealth', auth: true },
  { path: '/cards', auth: true },
]

for (const route of ROUTES) {
  const tab = await browser.newPage()
  /*
   * 每条路由都用**一次真正的整页加载**来看水印（这是这张检查的意义：
   * 用户直接打开这个地址时该看得见水印）。
   *
   * 登录态现在只在内存里，整页加载必然把它清掉——所以受保护的路由一律用
   * `login`，它一次做完"重载 + 重新登录"，然后就停在这条路由上。
   * 公开路由不需要登录，直接 goto，但**要先清掉本地存档**，
   * 免得被上一条路由留下的东西影响（原来是统一在这里清）。
   */
  await tab.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await tab.evaluate(() => localStorage.clear())

  if (route.auth) {
    await login(tab, BASE, { to: route.path })
  } else {
    await tab.goto(`${BASE}${route.path}`, { waitUntil: 'networkidle' })
  }
  await tab.waitForTimeout(900)

  const probe = await tab.evaluate((text) => {
    // 用 aria-label 定位，比匹配文案稳：文案改一个字这里就会失配，
    // 而 aria-label 是水印语义本身（第一次写就是栽在文案匹配上的）
    const el = document.querySelector('[aria-label*="非真实银行"]')
    if (!el) {
      return { found: false, domHasText: document.body.innerText.includes('非真实银行') }
    }
    let box = el
    while (box && getComputedStyle(box).position !== 'fixed') box = box.parentElement
    if (!box) return { found: false, domHasText: true, note: '找到元素但祖先里没有 fixed' }

    const r = box.getBoundingClientRect()
    const cs = getComputedStyle(box)
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    const hit = document.elementFromPoint(cx, cy)

    // 吸顶顶栏：水印的方框绝不能落进它的带子里（会被它的背景盖掉）。
    // 注意要挑 position: sticky 的那个 —— 页面标题也用了 <header>，
    // 但它是透明底，压在上面没有关系，不能算作遮挡。
    const header = [...document.querySelectorAll('header')].find(
      (h) => getComputedStyle(h).position === 'sticky' || getComputedStyle(h).position === 'fixed',
    )
    const headerRect = header?.getBoundingClientRect() ?? null
    const headerZ = header ? Number(getComputedStyle(header).zIndex) || 0 : 0
    const overlapsHeader =
      headerRect != null && r.top < headerRect.bottom && r.bottom > headerRect.top

    return {
      found: true,
      rect: { top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) },
      opacity: cs.opacity,
      visibility: cs.visibility,
      display: cs.display,
      zIndex: cs.zIndex,
      background: cs.backgroundColor,
      inViewport: r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth,
      sized: r.width > 0 && r.height > 0,
      headerBottom: headerRect ? Math.round(headerRect.bottom) : null,
      headerZ,
      overlapsHeader,
      opaqueChip: cs.backgroundColor !== 'rgba(0, 0, 0, 0)',
    }
  }, TEXT)

  const ok =
    probe.found &&
    probe.inViewport &&
    probe.sized &&
    probe.visibility === 'visible' &&
    probe.display !== 'none' &&
    probe.opacity !== '0' &&
    probe.opaqueChip &&
    // 有顶栏的页面（登录页 / 开户页没有）不能被顶栏盖住
    (probe.headerBottom == null || !probe.overlapsHeader)

  report(ok, `${route.path} 水印可见`, [
    probe.found
      ? `位置 top=${probe.rect.top} left=${probe.rect.left} ${probe.rect.w}×${probe.rect.h} · z=${probe.zIndex}`
      : `未找到水印元素${probe.domHasText ? '（正文里有这些字，但定位不到 fixed 容器）' : '（整页都没有这些字）'}`,
    probe.found ? `视口内=${probe.inViewport} · visibility=${probe.visibility} · opacity=${probe.opacity}` : '',
    probe.found
      ? probe.headerBottom == null
        ? '本页无吸顶顶栏（登录 / 开户页）'
        : `顶栏底边=${probe.headerBottom}px（z=${probe.headerZ}）· 与顶栏重叠=${probe.overlapsHeader}`
      : '',
    probe.found ? `底色=${probe.background}（不透明底才能看清）` : '',
  ].filter(Boolean))

  await tab.close()
}

await browser.close()
console.log(failures === 0 ? '\n全部通过 ✅' : `\n${failures} 项未通过 ❌`)
process.exit(failures === 0 ? 0 : 1)
