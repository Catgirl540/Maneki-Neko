/**
 * 行标在**真实浏览器里真的渲染出来了**的检查。
 *
 * `check-bank-data.mjs` 只验证「文件存在」，验证不了「浏览器能解码它」——
 * 格式写错、SVG 里 XML 不闭合、mime 不对，文件明明在，`<img>` 就是破图。
 * 尤其这次把行标从位图换成了 SVG：SVG 是文本，一个没闭合的标签就是一个静默的破图。
 *
 *   node tools/check-bank-logos.mjs [baseUrl]
 */
import { chromium } from 'playwright-core'
import { login, gotoInApp } from './lib/session.mjs'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

const BASE = process.argv[2] ?? 'http://127.0.0.1:5180'
const ROOT = path.resolve(import.meta.dirname, '..')

/**
 * 从 db.ts 里读出「哪些银行挂了行标」。
 *
 * 断言必须对着名录逐家核，不能只看「加载失败的张数为 0」：
 * 行标加载失败时 `<img>` 会退化成品牌色块（这是 BankMark 的设计），
 * 于是那张图**从 DOM 里消失了** —— 「0 张失败」自然成立，检查就永远是绿的。
 * 变异自测时正是这么漏的。
 */
const dbSrc = await readFile(path.join(ROOT, 'app/src/api/mock/db.ts'), 'utf8')
// 键必须带 region：两地有同名机构（上海浦东发展银行、交通银行、招商银行… 各一家），
// 只按行名配对会把两条压成一条，然后拿香港那条去对内地那家的行标，永远对不上。
const expected = [
  ...dbSrc.matchAll(/\{ code: '([^']+)', region: '(CN|HK)',[^}]*name: '([^']+)'[^}]*?logo: '([^']+)'/g),
].map((m) => ({ code: m[1], region: m[2], name: m[3], logo: m[4] }))

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

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? await findChrome() })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
const tab = await context.newPage()

/** 控制台 / 网络里出现的资源错误，最后一起看 */
const broken = []
tab.on('response', (res) => {
  if (res.url().includes('/banks/') && res.status() >= 400) {
    broken.push(`${res.status()} ${res.url().split('/').pop()}`)
  }
})

await login(tab, BASE)

await gotoInApp(tab, '/transfer')
const brandLogo = await tab.locator('.workbench-brand img').first().getAttribute('src')
await tab.getByLabel('转账金额', { exact: true }).fill('100')
await tab.getByRole('button', { name: '下一步', exact: true }).click()
await tab.getByRole('button', { name: '选择收款银行' }).waitFor()
const picker = tab.getByRole('button', { name: '选择收款银行' })
const initialMark = picker.locator('img')
await initialMark.waitFor()
report(await initialMark.getAttribute('src') === brandLogo, '本行已选行标与工作台品牌一致')

/** 展开银行选择器并滚到底，让懒加载的 <img> 全部真正去取图 */
async function collect(region) {
  await tab.locator('button[aria-label="选择收款银行"]').click()
  await tab.locator('input[aria-label="搜索收款银行"]').fill('')
  const list = tab.locator('ul[role="listbox"]')
  await list.waitFor({ timeout: 10000 })
  // 列表里是懒加载，逐屏滚一遍
  for (let i = 0; i < 12; i++) {
    await list.evaluate((el) => el.scrollBy(0, 400))
    await tab.waitForTimeout(60)
  }
  await tab.waitForTimeout(400)
  const rows = await tab.evaluate(() =>
    Array.from(document.querySelectorAll('ul[role="listbox"] li')).map((li) => {
      const img = li.querySelector('img')
      const text = li.textContent ?? ''
      // 用银行代码配对，不用行名：JSX 编译出来的 DOM 里 textContent 是不带换行的，
      // 按行切名字切不干净；而且两地有同名机构，代码在同市场内才是唯一的。
      const code = text.match(/银行代码\s*([A-Za-z0-9]+)/)?.[1] ?? null
      return {
        code,
        name: text.replace(/银行代码\s*[A-Za-z0-9]+/, '').trim(),
        logo: img ? img.getAttribute('src') : null,
        // naturalWidth 为 0 = 浏览器没能解码这张图（404 / 坏文件 / 非图片）
        loaded: img ? img.naturalWidth > 0 : null,
      }
    }),
  )
  await tab.keyboard.press('Escape')
  await tab.locator('button[aria-label="关闭银行列表"]').click({ timeout: 2000 }).catch(() => {})
  await tab.waitForTimeout(150)
  return { rows, region }
}

const cn = await collect('CN')
await picker.click()
await tab.getByRole('listbox').getByRole('option', { name: /中国工商银行/ }).click()
report(await picker.locator('img').getAttribute('src') === '/banks/cn-102.svg', '切换外行仍显示对应行标')
await picker.click()
await tab.getByRole('listbox').getByRole('option', { name: /招财猫银行/ }).click()
report(await picker.locator('img').getAttribute('src') === brandLogo, '切回本行仍显示工作台品牌')
await tab.getByRole('tab', { name: '境外' }).click()
await tab.waitForTimeout(300)
const hk = await collect('HK')

const all = [...cn.rows, ...hk.rows]
const withLogo = all.filter((r) => r.logo)

report(
  all.length >= 54,
  '① 两个市场共列出 55 家银行',
  [`内地 ${cn.rows.length} 家 + 香港 ${hk.rows.length} 家 = ${all.length} 家`],
)

// 逐家核对：名录里挂了行标的，列表里必须真的渲染出一张**解码成功**的图
const byRegion = {
  CN: new Map(cn.rows.map((r) => [r.code, r])),
  HK: new Map(hk.rows.map((r) => [r.code, r])),
}
const brokenRows = []
for (const e of expected) {
  const row = byRegion[e.region].get(e.code)
  if (!row) {
    brokenRows.push(`${e.region}-${e.code} ${e.name} 没出现在列表里`)
    continue
  }
  if (!row.logo) brokenRows.push(`${e.region}-${e.code} ${e.name} 的 <img> 消失了（加载失败已退化成色块）`)
  else if (row.loaded === false) brokenRows.push(`${e.region}-${e.code} ${e.name} 的 ${row.logo} 浏览器解码失败`)
  else if (row.logo !== (e.code === 'LCB' ? brandLogo : e.logo)) brokenRows.push(`${e.region}-${e.code} ${e.name} 渲染的行标不正确：${row.logo}`)
}
const hkInternal = byRegion.HK.get('LCB')
if (!brandLogo || !hkInternal || hkInternal.logo !== brandLogo || !hkInternal.loaded) {
  brokenRows.push('香港模拟通道的本行行标未使用工作台品牌图或加载失败')
}
report(
  brokenRows.length === 0 && expected.length >= 53,
  '② 名录里每一家挂了行标的，浏览器都真的解码出来了',
  [
    `名录挂行标 ${expected.length} 家 / 列表里有行标 ${withLogo.length} 家`,
    brokenRows.length ? `对不上：${brokenRows.join('；')}` : '逐家核对全部通过',
  ],
)

const svgCount = withLogo.filter((r) => r.logo.endsWith('.svg')).length
report(svgCount >= 49, '③ 行标以矢量（SVG）为主', [
  `SVG ${svgCount} 家 / 位图 ${withLogo.length - svgCount} 家`,
])

// Vite 对 app/public 下缺失的文件会回退成 200 + index.html，所以状态码抓不到「文件没发出去」；
// 但正常的图片请求应当都是 200，这条用来抓真正的 4xx/5xx。
report(broken.length === 0, '④ 没有 4xx/5xx 的行标请求', [
  broken.length ? broken.join('、') : '全部 200',
])

await browser.close()
console.log(failures === 0 ? '\n全部通过 ✅' : `\n${failures} 项未通过 ❌`)
process.exit(failures === 0 ? 0 : 1)
