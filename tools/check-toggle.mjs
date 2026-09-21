/**
 * 交互流畅度冒烟测试：
 * 验证「点开关 → 立刻响应」且过程中不出现骨架屏（骨架屏 = 列表被打回加载态）。
 *
 *   node tools/check-toggle.mjs [baseUrl]
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

const browser = await chromium.launch({ executablePath: await findChrome() })
const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, locale: 'zh-CN' })

async function openTab() {
  const tab = await context.newPage()
  // 走真实登录流程：手机号 + 密码 + 短信验证码（登录态存 sessionStorage，关标签页即失效）
  await login(tab, BASE)
  return tab
}

let failures = 0

/** 点某个开关，测「立即响应」与「无骨架屏闪烁」 */
async function checkToggle(tab, label, pageName) {
  const sw = tab.getByRole('switch').first()
  await sw.waitFor({ state: 'visible', timeout: 8000 })
  const before = await sw.getAttribute('aria-checked')

  // 记录点击后 700ms 内是否出现过骨架屏
  await tab.evaluate(() => {
    window.__sawSkeleton = false
    window.__probe = setInterval(() => {
      if (document.querySelector('.animate-pulse')) window.__sawSkeleton = true
    }, 16)
  })

  const started = Date.now()
  await sw.click()
  // 不等网络：点击后立刻读状态，验证乐观更新
  const afterImmediate = await sw.getAttribute('aria-checked')
  const immediateMs = Date.now() - started

  await tab.waitForTimeout(700)
  const sawSkeleton = await tab.evaluate(() => {
    clearInterval(window.__probe)
    return window.__sawSkeleton
  })

  const settled = await tab.getByRole('switch').first().getAttribute('aria-checked')

  const okImmediate = afterImmediate !== before
  const okNoSkeleton = !sawSkeleton
  const okSettled = settled === afterImmediate

  if (!okImmediate || !okNoSkeleton || !okSettled) failures += 1
  console.log(
    `${okImmediate && okNoSkeleton && okSettled ? 'PASS' : 'FAIL'}  ${pageName} · ${label}` +
      `\n      点击后 ${immediateMs}ms 状态: ${before} → ${afterImmediate}` +
      `\n      骨架屏闪烁: ${sawSkeleton ? '有（异常）' : '无'}` +
      `\n      网络返回后状态: ${settled}（应与点击后一致，未被覆盖）`,
  )
}

// —— 自动扣款 ——
{
  const tab = await openTab()
  await gotoInApp(tab, '/analysis')
  await tab.waitForTimeout(600)
  await checkToggle(tab, '自动扣款开关', '消费分析')
  await tab.close()
}

// —— 风控规则 ——
{
  const tab = await openTab()
  await gotoInApp(tab, '/security')
  await tab.waitForTimeout(600)
  await checkToggle(tab, '风控规则开关', '安全中心')
  await tab.close()
}

// —— 银行卡设置 ——
{
  const tab = await openTab()
  await gotoInApp(tab, '/cards')
  await tab.waitForTimeout(600)
  await checkToggle(tab, '线上支付开关', '银行卡')
  await tab.close()
}

await browser.close()
console.log(failures === 0 ? '\n全部通过 ✅' : `\n${failures} 项未通过 ❌`)
process.exit(failures === 0 ? 0 : 1)