/** Real browser + delayed HTTP fixture; no bank data or paid model requests. */
import assert from 'node:assert/strict'
import { createServer as http } from 'node:http'
import { fileURLToPath } from 'node:url'
import { createServer } from '../app/node_modules/vite/dist/node/index.js'
import { chromium } from 'playwright-core'

const root = fileURLToPath(new URL('../', import.meta.url))
let delay = 4500, unavailable = false, healthRequests = 0, sessionRequests = 0
const fixture = http(async (req, res) => {
  if (req.url === '/agent-api/health') {
    healthRequests++
    const fail = unavailable, wait = delay
    await new Promise(resolve => setTimeout(resolve, wait))
    res.writeHead(fail ? 503 : 200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(JSON.stringify(fail ? { error: 'fixture temporarily unavailable' } : { ok: true, bankDataSource: 'http' }))
    return
  }
  if (req.url?.startsWith('/agent-api/sessions')) sessionRequests++
  res.writeHead(404); res.end()
})
let vite, browser, page
try {
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve))
  process.env.VITE_USE_MOCK = 'true'
  process.env.VITE_AGENT_TARGET = `http://127.0.0.1:${fixture.address().port}`
  vite = await createServer({ root: root + 'app', server: { host: '127.0.0.1', port: 0 } })
  await vite.listen()
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH })
  const context = await browser.newContext()
  page = await context.newPage()
  page.on('pageerror', error => console.error('PAGE_ERROR', error.message))
  const base = `http://127.0.0.1:${vite.httpServer.address().port}`
  await page.goto(base + '/login')
  await page.getByRole('textbox', { name: '手机号', exact: true }).fill('13800138000')
  await page.getByRole('textbox', { name: '密码', exact: true }).fill('123456')
  await page.getByRole('button', { name: '获取验证码', exact: true }).click()
  const hint = page.getByRole('status').filter({ hasText: '演示环境验证码' })
  await hint.waitFor()
  const code = /\d{6}/.exec(await hint.innerText())?.[0]
  assert(code)
  await page.getByRole('textbox', { name: '短信验证码', exact: true }).fill(code)
  await page.getByRole('button', { name: '登入', exact: true }).click()
  await page.locator('[data-agent-status="ready"]').waitFor({ timeout: 16000 })
  assert.equal(sessionRequests, 0)
  console.log('PASS 4.5 秒真实 HTTP 健康响应仍能连上，探测不创建会话')
  const healthyCount = healthRequests
  await page.waitForTimeout(3300)
  assert.equal(healthRequests, healthyCount, '健康后不应持续轮询')

  unavailable = true; delay = 0
  await page.reload()
  await page.locator('[data-agent-status="off"]').waitFor()
  const failedCount = healthRequests
  unavailable = false
  await page.locator('[data-agent-status="ready"]').waitFor({ timeout: 10000 })
  assert(healthRequests > failedCount)
  console.log('PASS 首次探测失败后退避重试，无需刷新即可恢复在线')

  unavailable = true
  await page.reload()
  await page.locator('[data-agent-status="off"]').waitFor()
  unavailable = false
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await page.locator('[data-agent-status="ready"]').waitFor({ timeout: 2500 })
  console.log('PASS 网络恢复事件立即重新探测')

  unavailable = true
  await page.reload()
  await page.locator('[data-agent-status="off"]').waitFor()
  await page.waitForTimeout(100)
  await page.close()
  const closedCount = healthRequests
  await new Promise(resolve => setTimeout(resolve, 3500))
  assert.equal(healthRequests, closedCount, '卸载后应停止健康探测')
  assert.equal(sessionRequests, 0)
  console.log('PASS 卸载后停止重试，所有健康检查均未创建会话')
} catch (error) {
  console.error(JSON.stringify({ healthRequests, sessionRequests, url: page?.url(), body: await page?.locator('body').innerText().catch(() => '') }))
  throw error
} finally {
  await browser?.close()
  await vite?.close()
  fixture.closeAllConnections()
  await new Promise(resolve => fixture.close(resolve))
}
