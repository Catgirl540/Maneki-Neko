/** Browser smoke against the local staff server. No business operations. */
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const base = process.env.OPS_UI_BASE ?? 'http://127.0.0.1:5181'
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto(base + '/login')
  await page.getByLabel('员工姓名', { exact: true }).fill('运维人员')
  await page.locator('input[type=password]').fill('123456')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await page.waitForURL('**/operations')
  await page.getByRole('heading', { name: '运行事件', exact: true }).waitFor()
  for (const text of ['银行后端', 'SQLite 数据库', '客户端网页', 'AI 服务', '备份状态', '运行版本']) assert((await page.locator('main').innerText()).includes(text))
  assert.equal(await page.getByRole('link', { name: '客户查询', exact: true }).count(), 0)
  await page.getByRole('checkbox').check()
  await page.getByRole('cell', { name: '服务启动', exact: true }).first().waitFor()
  mkdirSync(new URL('../server/data/', import.meta.url), { recursive: true })
  await page.screenshot({ path: fileURLToPath(new URL('../server/data/operations-preview.png', import.meta.url)), fullPage: true })
  // Client-side navigation must enforce the same role restrictions as HTTP.
  await page.evaluate(() => { history.pushState({}, '', '/customers'); dispatchEvent(new PopStateEvent('popstate')) })
  await page.waitForURL('**/operations')
  await page.getByRole('button', { name: '退出', exact: true }).click()
  await page.waitForURL('**/login')
  await page.getByLabel('员工姓名', { exact: true }).fill('李主管')
  await page.locator('input[type=password]').fill('123456')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await page.waitForURL('**/workbench')
  assert.equal(await page.getByRole('link', { name: '运维监控', exact: true }).count(), 0)
  await page.evaluate(() => { history.pushState({}, '', '/operations'); dispatchEvent(new PopStateEvent('popstate')) })
  await page.waitForURL('**/workbench')
  await page.setViewportSize({ width: 1000, height: 900 })
  assert.equal(errors.length, 0, errors.join('\n'))
  await page.getByRole('button', { name: '退出', exact: true }).click()
  console.log('PASS 运维登录/真实状态/事件/退出、业务菜单隔离、两类角色路由守卫；页面无运行错误')
} finally { await browser.close() }
