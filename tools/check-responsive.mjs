/**
 * 响应式与交互回归检查。使用前端 mock 数据，不调用银行或模型服务。
 * 先启动 VITE_USE_MOCK=true 的前端，再运行：
 *   node tools/check-responsive.mjs [baseUrl]
 * 可用 CHROME_PATH 指定 Chromium；默认使用 Playwright 缓存中的浏览器。
 */
import assert from 'node:assert/strict'
import { readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'
import { login, gotoInApp } from './lib/session.mjs'

const base = process.argv[2] ?? 'http://127.0.0.1:5180'
async function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH
  const cache = path.join(homedir(), '.cache/ms-playwright')
  const versions = (await readdir(cache)).filter(name => name.startsWith('chromium-')).sort()
  assert(versions.length, '请先安装 Playwright Chromium 或设置 CHROME_PATH')
  return path.join(cache, versions.at(-1), 'chrome-linux64', 'chrome')
}
const browser = await chromium.launch({ executablePath: await chromePath() })
const errors = []
const routes = ['/dashboard', '/transfer', '/cards', '/analysis', '/wealth', '/security', '/support']
async function checkWidth(page, label) {
  await page.waitForTimeout(350)
  const sizes = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }))
  assert(sizes.content <= sizes.viewport + 1, `${label} 横向溢出：${JSON.stringify(sizes)}`)
  console.log(`PASS ${label}`)
}
try {
  const page = await browser.newPage({ locale: 'zh-CN' })
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/agent-api/**', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"test offline"}' }))
  await login(page, base)
  await page.getByLabel('全局搜索').waitFor()
  assert.equal(await page.getByLabel('全局搜索').count(), 1)
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 })
    for (const route of routes) {
      await gotoInApp(page, route)
      if (route === '/dashboard') {
        const reveal = page.getByRole('button', { name: '显示', exact: true })
        if (await reveal.count()) await reveal.click()
      }
      await checkWidth(page, `${width}px ${route}`)
    }
    const mobile = await page.getByRole('navigation', { name: '移动端主导航' }).isVisible()
    assert.equal(mobile, width < 1024, `${width}px 导航断点`)
  }
  // 同一路由的第二次全局搜索必须更新页面筛选值。
  await gotoInApp(page, '/analysis')
  for (const word of ['咖啡', 'Apple']) {
    await page.getByLabel('全局搜索').fill(word)
    await page.getByLabel('全局搜索').press('Enter')
    await page.waitForFunction(value => new URLSearchParams(location.search).get('q') === value, word)
    await page.waitForFunction(value => document.querySelector('input[placeholder="搜索商户或备注"]')?.value === value, word)
    assert.equal(await page.getByPlaceholder('搜索商户或备注').inputValue(), word)
  }
  console.log('PASS 分析页重复全局搜索同步')

  await page.setViewportSize({ width: 320, height: 640 })
  const more = page.getByRole('button', { name: '更多服务' })
  await gotoInApp(page, '/dashboard')
  await page.getByRole('button', { name: '转入', exact: true }).click()
  const receiving = page.getByRole('dialog', { name: '转入 · 收款信息' })
  await receiving.waitFor()
  await checkWidth(page, '320px 收款信息弹窗')
  await receiving.getByRole('button', { name: '模拟一笔转入', exact: true }).click()
  await page.getByLabel('转入金额（元）').waitFor()
  await checkWidth(page, '320px 转入表单')
  await page.keyboard.press('Escape')
  await page.getByRole('dialog').waitFor({ state: 'detached' })
  await more.click()
  const services = page.getByRole('dialog', { name: '全部服务' })
  await services.waitFor()
  assert.equal(await services.getByRole('link').count(), routes.length)
  assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden')
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press(i % 2 ? 'Shift+Tab' : 'Tab')
    assert(await services.evaluate(el => el.contains(document.activeElement)), '弹窗焦点泄漏')
  }
  await page.keyboard.press('Escape')
  await services.waitFor({ state: 'detached' })
  assert(await more.evaluate(el => el === document.activeElement), '关闭后未恢复焦点')
  assert.notEqual(await page.evaluate(() => document.body.style.overflow), 'hidden')
  await more.click()
  await services.getByRole('link', { name: '理财', exact: true }).click()
  await services.waitFor({ state: 'detached' })
  assert.equal(new URL(page.url()).pathname, '/wealth')
  console.log('PASS 手机全部服务、焦点循环、Escape 与路由跳转')

  await page.getByRole('button', { name: '通知', exact: true }).click()
  const notices = page.getByRole('dialog', { name: '最新动态' })
  await notices.waitFor()
  await checkWidth(page, '320px 通知弹窗')
  const rect = await notices.boundingBox()
  assert(rect.x >= 0 && rect.x + rect.width <= 320 && rect.y >= 0 && rect.y + rect.height <= 640, '通知超出视口')
  await notices.getByRole('button', { name: '查看全部安全日志' }).click()
  await notices.waitFor({ state: 'detached' })
  assert.equal(new URL(page.url()).pathname, '/security')
  console.log('PASS 手机通知与安全日志跳转')

  await gotoInApp(page, '/support')
  const input = page.getByLabel('聊天消息', { exact: true })
  await input.fill('你好')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await page.getByText('你好', { exact: true }).waitFor()
  console.log('PASS 手机聊天输入与发送')

  const agentPage = await browser.newPage({ viewport: { width: 390, height: 844 } })
  agentPage.on('pageerror', error => errors.push(error.message))
  await agentPage.route('**/agent-api/**', route => {
    const url = new URL(route.request().url())
    const body = url.pathname.endsWith('/health') ? { ok: true, voice: { asr: false, tts: false } }
      : url.pathname.endsWith('/sessions') ? { sessionId: 'responsive-test-session' } : { known: true, started: false, busy: false }
    return route.fulfill({ contentType: url.pathname.endsWith('/stream') ? 'text/event-stream' : 'application/json', body: url.pathname.endsWith('/stream') ? ': test\n\n' : JSON.stringify(body) })
  })
  await login(agentPage, base, { to: '/support' })
  await agentPage.getByRole('button', { name: /历史对话/ }).click()
  const history = agentPage.getByRole('dialog', { name: '历史对话', exact: true })
  await history.waitFor()
  await checkWidth(agentPage, '390px 客服历史对话')
  await history.getByRole('button', { name: '关闭弹窗', exact: true }).click()
  await history.waitFor({ state: 'detached' })
  console.log('PASS 手机客服历史入口')

  for (const width of [320, 390, 768, 1440]) {
    const publicPage = await browser.newPage({ viewport: { width, height: 844 } })
    publicPage.on('pageerror', error => errors.push(error.message))
    for (const route of ['/', '/login', '/open-account']) {
      await publicPage.goto(base + route)
      if (route === '/') await publicPage.getByRole('heading', { level: 1 }).waitFor()
      else if (route === '/login') await publicPage.getByPlaceholder('请输入密码').waitFor()
      else await publicPage.getByLabel('姓名', { exact: true }).waitFor()
      await checkWidth(publicPage, `${width}px 公开页 ${route}`)
      assert.equal(await publicPage.locator('a button').count(), 0, '链接中嵌套按钮')
    }
    await publicPage.goto(base + '/login')
    await publicPage.getByPlaceholder('请输入密码').waitFor()
    assert.equal(await publicPage.getByLabel('密码', { exact: true }).count(), 1, '密码标签关联不唯一')
    await publicPage.close()
  }
  assert.deepEqual(errors, [], '页面出现未捕获错误')
  console.log('PASS 响应式与交互回归检查完成')
} finally {
  await browser.close()
}
