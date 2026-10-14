/** 检查生产 /bank/ 构建、手机全路径拦截、下载字节和失败恢复；不访问客户 API。 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { preview } from '../app/node_modules/vite/dist/node/index.js'
import { chromium } from 'playwright-core'

const root = path.resolve(import.meta.dirname, '..')
const metadata = JSON.parse(await readFile(path.join(root, 'app/dist/downloads/android.json'), 'utf8'))
const web = await preview({ root: path.join(root, 'app'), configFile: false, base: '/bank/', logLevel: 'error', preview: { host: '127.0.0.1', port: 0 } })
const origin = `http://127.0.0.1:${web.httpServer.address().port}`
const base = origin + '/bank'
const errors = [], apiRequests = []
let browser
async function guard(page) {
  page.on('pageerror', e => errors.push(e.message))
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (/\/(api|agent-api)\//.test(url.pathname) || url.origin !== origin) {
      apiRequests.push(url.pathname)
      return route.fulfill({ status: 503, contentType: 'application/json', body: '{}' })
    }
    return route.continue()
  })
}
async function hasDownload(page) {
  await page.getByRole('heading', { name: '招财猫安卓版', exact: true }).waitFor()
  await page.getByRole('link', { name: '下载安卓版 APK', exact: true }).waitFor()
  assert.equal(new URL(page.url()).pathname, '/bank/download')
  assert.equal(await page.getByRole('navigation', { name: '移动端主导航' }).count(), 0)
  assert.equal(await page.getByRole('textbox').count(), 0)
  const size = await page.evaluate(() => ({ width: innerWidth, content: document.documentElement.scrollWidth }))
  assert(size.content <= size.width + 1, `下载页溢出：${JSON.stringify(size)}`)
}

try {
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/snap/chromium/current/usr/lib/chromium-browser/chrome', args: ['--no-sandbox'] })
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await desktop.newPage()
  await guard(page)
  await page.goto(base + '/')
  await page.getByRole('heading', { name: /新形态银行/ }).waitFor()
  await page.getByRole('link', { name: '下载安卓版', exact: true }).first().click()
  await hasDownload(page)
  const link = page.getByRole('link', { name: '下载安卓版 APK', exact: true })
  assert.equal(await link.getAttribute('href'), `/bank/downloads/${metadata.fileName}`)
  const [download] = await Promise.all([page.waitForEvent('download'), link.click()])
  assert.equal(await download.failure(), null)
  assert.equal(download.suggestedFilename(), metadata.fileName)
  const hash = createHash('sha256')
  let size = 0
  for await (const chunk of createReadStream(await download.path())) { hash.update(chunk); size += chunk.length }
  assert.equal(size, metadata.bytes)
  assert.equal(hash.digest('hex'), metadata.sha256, '下载内容必须是完整 APK，不能是 SPA HTML')
  await page.getByRole('link', { name: '返回官网', exact: true }).click()
  await page.getByRole('heading', { name: /新形态银行/ }).waitFor()
  for (const width of [320, 980, 1280, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    assert.equal(new URL(page.url()).pathname, '/bank/')
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    if (width >= 1280) assert(await page.locator('header').evaluate(el => el.getBoundingClientRect().height <= 80), '桌面官网导航不应换行')
  }
  await page.goto(base + '/login')
  assert.equal(new URL(page.url()).pathname, '/bank/login', '电脑缩窄窗口仍保留网页入口')
  assert.equal(await page.getByRole('heading', { name: '招财猫安卓版' }).count(), 0)
  console.log('PASS 电脑官网入口、窄窗口保留网页、/bank/ 路径及完整 APK 下载校验')

  const phones = [
    ['Android', 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36'],
    ['iPhone', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'],
  ]
  for (const [name, userAgent] of phones) {
    const context = await browser.newContext({ userAgent, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: 'light' })
    const phone = await context.newPage()
    await guard(phone)
    // 已登录的手机也不能挂载原网页账户页。
    await phone.addInitScript(() => {
      sessionStorage.setItem('luckycat.token', JSON.stringify('unused-fixture'))
      sessionStorage.setItem('luckycat.session.user', JSON.stringify({ id: 'download-only', name: '测试', phone: '13900139000' }))
    })
    for (const route of ['/', '/login', '/open-account', '/dashboard?flow=out', '/cards', '/wealth', '/support', '/security', '/unknown']) {
      await phone.goto(base + route)
      await hasDownload(phone)
    }
    if (name === 'iPhone') await phone.getByText('暂未提供 iOS 版。你可以在电脑上使用网页版。', { exact: true }).waitFor()
    for (const width of [320, 390]) {
      await phone.setViewportSize({ width, height: 844 })
      await hasDownload(phone)
    }
    if (name === 'Android') {
      await phone.screenshot({ path: '/tmp/luckycat-download-mobile.png', fullPage: true })
      await phone.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
      await phone.screenshot({ path: '/tmp/luckycat-download-mobile-dark.png', fullPage: true })
    }
    assert.equal(await phone.getByRole('link', { name: '返回官网' }).count(), 0)
    await context.close()
    console.log(`PASS ${name} 官网与业务深链接统一下载页，已登录也不挂载客户端`)
  }

  const hint = await browser.newContext({ userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36' })
  const hinted = await hint.newPage()
  await guard(hinted)
  await hinted.addInitScript(() => Object.defineProperty(navigator, 'userAgentData', { configurable: true, value: { mobile: true } }))
  await hinted.goto(base + '/login')
  await hasDownload(hinted)
  await hint.close()
  const tablet = await browser.newContext({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Tablet) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36', viewport: { width: 768, height: 1024 }, hasTouch: true })
  const tabletPage = await tablet.newPage()
  await guard(tabletPage)
  await tabletPage.goto(base + '/login')
  assert.equal(new URL(tabletPage.url()).pathname, '/bank/login')
  assert.equal(await tabletPage.getByRole('heading', { name: '招财猫安卓版' }).count(), 0)
  await tablet.close()
  console.log('PASS UA Client Hints 手机识别，平板保留网页')

  const retry = await desktop.newPage()
  await guard(retry)
  let fail = true
  await retry.route('**/downloads/android.json', route => fail
    ? route.fulfill({ status: 200, contentType: 'text/html', body: '<html>SPA fallback</html>' })
    : route.continue())
  await retry.goto(base + '/download')
  await retry.getByText('安装包暂时无法获取', { exact: true }).waitFor()
  assert.equal(await retry.getByRole('link', { name: '下载安卓版 APK' }).count(), 0)
  fail = false
  await retry.getByRole('button', { name: '重新加载' }).click()
  await hasDownload(retry)
  await retry.reload()
  await hasDownload(retry)
  console.log('PASS 元数据故障/HTML 回落无无效下载按钮，重试与刷新恢复')
  assert.deepEqual(apiRequests, [], '下载流程不应连接账户或 Agent，也不应访问外部服务')
  assert.deepEqual(errors, [])
  console.log('PASS 无客户 API 请求、无浏览器异常')
} finally {
  await browser?.close()
  web.httpServer.closeAllConnections()
  await new Promise(resolve => web.httpServer.close(resolve))
}
