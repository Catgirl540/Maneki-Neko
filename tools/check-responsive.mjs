/**
 * 桌面网页布局与交互回归检查（移动端由 App 承担）。使用前端 mock 数据，不调用银行或模型服务。
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
const routes = ['/dashboard', '/accounts', '/transfer', '/services', '/cards', '/analysis', '/analysis/statistics', '/analysis/autodebits', '/wealth', '/security', '/support']
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
  await page.getByRole('heading', { name: '今天想处理什么？', exact: true }).waitFor()
  assert(await page.getByLabel('聊天消息').isDisabled(), '离线状态不能冒充在线助手')
  for (const width of [1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 })
    for (const route of routes) {
      await gotoInApp(page, route)
      if (route === '/accounts') {
        const reveal = page.getByRole('button', { name: '显示', exact: true })
        if (await reveal.count()) await reveal.click()
      }
      await checkWidth(page, `${width}px ${route}`)
      if (route === '/support') {
        const chat = await page.evaluate(() => {
          const panel = document.querySelector('.chat-panel').getBoundingClientRect()
          const input = document.querySelector('textarea[aria-label="聊天消息"]').getBoundingClientRect()
          const bottom = innerHeight
          return { top: panel.top, bottom: panel.bottom, expectedBottom: bottom, inputBottom: input.bottom, pageHeight: document.documentElement.scrollHeight, viewportHeight: innerHeight }
        })
        assert(chat.top >= 28 && chat.top < 100, '聊天区应在演示声明下面')
        assert(chat.bottom <= chat.expectedBottom && chat.expectedBottom - chat.bottom < 50, '聊天区应铺满侧栏以外的可用空间')
        assert(chat.inputBottom <= chat.bottom, '输入栏不能被主导航遮挡')
        assert(chat.pageHeight <= chat.viewportHeight + 1, '聊天页面应只滚动消息区域')
      }
      const nav = page.getByRole('navigation', { name: width < 960 ? '移动端主导航' : '桌面主导航' })
      assert.deepEqual(await nav.getByRole('link').evaluateAll(links => links.map(link => link.getAttribute('aria-label') ?? link.textContent.trim())), ['账户总览', '转账与支付', '银行卡', '账单与交易', '理财与储蓄'])
      const expected = route === '/wealth' ? '/wealth' : route === '/cards' ? '/cards'
        : route.startsWith('/analysis') ? '/analysis' : route === '/transfer' ? '/transfer'
          : ['/dashboard', '/support'].includes(route) ? '/dashboard' : undefined
      assert.deepEqual(await nav.locator('[aria-current="page"]').evaluateAll(links => links.map(link => link.getAttribute('href'))), expected ? [expected] : [], `${route} 主导航归属`)
      assert.equal(await nav.locator('a[href="/transfer"]').count(), 1, '转账应有独立可见入口')
      assert.equal(await page.getByRole('navigation', { name: '账户导航' }).count(), 0)
      assert.equal(await page.getByRole('button', { name: '更多服务' }).count(), 0)
    }
    const mobile = await page.getByRole('navigation', { name: '移动端主导航' }).isVisible()
    assert.equal(mobile, width < 960, `${width}px 导航断点`)
  }
  // 同一路由的第二次全局搜索必须更新页面筛选值。
  await gotoInApp(page, '/analysis')
  for (const word of ['咖啡', 'Apple']) {
    await page.getByLabel('交易搜索').fill(word)
    await page.getByLabel('交易搜索').press('Enter')
    await page.waitForFunction(value => new URLSearchParams(location.search).get('q') === value, word)
    assert.equal(new URL(page.url()).searchParams.get('q'), word)
    assert.equal(await page.getByRole('heading', { name: '账单', exact: true }).count(), 1)
  }
  console.log('PASS 账单重复交易搜索同步')
  await page.getByRole('tab', { name: '餐饮', exact: true }).click()
  await page.waitForFunction(() => new URLSearchParams(location.search).get('category') === 'dining')
  await page.getByLabel('交易搜索').fill('咖啡')
  await page.getByLabel('交易搜索').press('Enter')
  await page.waitForFunction(() => new URLSearchParams(location.search).get('q') === '咖啡')
  assert.equal(new URL(page.url()).searchParams.get('category'), 'dining', '搜索覆盖了分类筛选')
  await page.reload()
  await page.getByRole('heading', { name: '账单', exact: true }).waitFor()
  assert.equal(await page.getByLabel('交易搜索').inputValue(), '咖啡')
  const beforeDetail = page.url()
  await page.locator('main a[href^="/transactions/"]').first().click()
  await page.waitForURL('**/transactions/*')
  assert.equal(await page.getByRole('navigation', { name: '账户导航' }).count(), 0)
  assert.equal(await page.getByRole('navigation', { name: '桌面主导航' }).locator('[aria-current="page"]').getAttribute('href'), '/analysis')
  await page.goBack()
  await page.waitForURL(beforeDetail)
  assert.equal(await page.getByLabel('交易搜索').inputValue(), '咖啡')
  await page.getByRole('button', { name: '清除关键词', exact: true }).click()
  await page.waitForFunction(() => !new URLSearchParams(location.search).has('q'))
  assert.equal(await page.getByLabel('交易搜索').inputValue(), '')
  assert.equal(new URL(page.url()).searchParams.get('category'), 'dining')
  console.log('PASS 搜索与分类保留、刷新与返回、交易详情导航归属')

  await page.setViewportSize({ width: 1280, height: 800 })
  await gotoInApp(page, '/accounts')
  const openIn = page.getByRole('button', { name: '转入', exact: true })
  await openIn.waitFor()
  assert.equal(await openIn.count(), 1)
  assert.equal(await page.getByRole('button', { name: '转出', exact: true }).count(), 1)
  await openIn.click()
  const receiving = page.getByRole('dialog', { name: '转入', exact: true })
  await receiving.getByRole('button', { name: '复制全部', exact: true }).waitFor()
  await checkWidth(page, '桌面 转入收款信息')
  await receiving.getByRole('button', { name: '模拟一笔转入', exact: true }).click()
  await page.getByLabel('转入金额（元）').waitFor()
  assert.equal(await page.getByRole('dialog').count(), 1)
  await checkWidth(page, '桌面 同窗模拟入账表单')
  assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden')
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press(i % 2 ? 'Shift+Tab' : 'Tab')
    assert(await receiving.evaluate(el => el.contains(document.activeElement)), '弹窗焦点泄漏')
  }
  await page.keyboard.press('Escape')
  await receiving.waitFor({ state: 'detached' })
  assert(await openIn.evaluate(el => el === document.activeElement), '关闭后未恢复焦点')
  assert.notEqual(await page.evaluate(() => document.body.style.overflow), 'hidden')
  for (const [legacy, flow] of [['/receiving', 'in'], ['/dashboard?flow=out', 'out']]) {
    await gotoInApp(page, legacy, { expect: '/accounts' })
    await page.waitForFunction(value => new URLSearchParams(location.search).get('flow') === value, flow)
    const dialog = page.getByRole('dialog', { name: flow === 'in' ? '转入' : '转出', exact: true })
    await dialog.waitFor()
    await dialog.getByRole('button', { name: '关闭弹窗', exact: true }).click()
    await dialog.waitFor({ state: 'detached' })
    assert.equal(new URL(page.url()).searchParams.has('flow'), false)
  }
  console.log('PASS 单窗转入、焦点恢复与旧转账/收款地址兼容')

  await page.getByRole('button', { name: '通知', exact: true }).click()
  const notices = page.getByRole('dialog', { name: '最新动态' })
  await notices.waitFor()
  await checkWidth(page, '桌面 通知弹窗')
  const rect = await notices.boundingBox()
  assert(rect.x >= 0 && rect.x + rect.width <= 1280 && rect.y >= 0 && rect.y + rect.height <= 800, '通知超出视口')
  await notices.getByRole('button', { name: '查看全部安全日志' }).click()
  await notices.waitFor({ state: 'detached' })
  assert.equal(new URL(page.url()).pathname, '/security')
  console.log('PASS 桌面通知与安全日志跳转')

  const agentPage = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  agentPage.on('pageerror', error => errors.push(error.message))
  await agentPage.route('**/agent-api/**', route => {
    const url = new URL(route.request().url())
    const body = url.pathname.endsWith('/health') ? { ok: true, voice: { asr: false, tts: false } }
      : url.pathname.endsWith('/sessions') ? { sessionId: 'responsive-test-session' } : { known: true, started: false, busy: false }
    return route.fulfill({ contentType: url.pathname.endsWith('/stream') ? 'text/event-stream' : 'application/json', body: url.pathname.endsWith('/stream') ? ': test\n\n' : JSON.stringify(body) })
  })
  await login(agentPage, base, { to: '/support' })
  await agentPage.getByRole('button', { name: /历史对话/ }).click()
  await agentPage.getByRole('complementary', { name: '历史对话', exact: true }).waitFor()
  await checkWidth(agentPage, '桌面客服历史抽屉')
  await agentPage.getByRole('button', { name: /历史对话/ }).click()
  await agentPage.getByLabel('聊天消息').fill('保留这份草稿')
  await agentPage.getByRole('navigation', { name: '桌面主导航' }).getByRole('link', { name: '银行卡', exact: true }).click()
  await agentPage.getByRole('heading', { name: '银行卡', exact: true, level: 1 }).waitFor()
  assert.equal(await agentPage.getByLabel('聊天消息').inputValue(), '保留这份草稿')
  await agentPage.getByRole('navigation', { name: '桌面主导航' }).getByRole('link', { name: '账户总览', exact: true }).click()
  assert.equal(await agentPage.getByLabel('聊天消息').inputValue(), '保留这份草稿')
  await agentPage.getByRole('button', { name: '转人工', exact: true }).click()
  await agentPage.getByRole('dialog', { name: '转人工', exact: true }).waitFor()
  console.log('PASS 跨页面草稿保留、桌面历史抽屉与转人工入口')

  for (const width of [1280, 1440]) {
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
  console.log('PASS 桌面布局与交互回归检查完成')
} finally {
  await browser.close()
}
