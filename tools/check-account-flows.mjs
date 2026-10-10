/** 账户转入转出弹窗回归；只允许在本地 mock 前端运行。 */
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright-core'
import { login } from './lib/session.mjs'
const base = process.argv[2] ?? 'http://127.0.0.1:5180'
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname), '仅限本地 mock')
assert(process.env.CHROME_PATH, '设置 CHROME_PATH 指向 Chromium')
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH })
const errors = []
const screenshots = process.env.SCREENSHOT_DIR
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
  page.on('pageerror', e => errors.push(e.message))
  await page.route('**/agent-api/**', r => r.fulfill({ status: 503, body: '{}' }))
  await login(page, base)
  await page.getByRole('button', { name: '转入', exact: true }).waitFor()
  await page.getByRole('group', { name: /现金流图/ }).waitFor()
  await page.waitForTimeout(700)
  if (screenshots) {
    await mkdir(screenshots, { recursive: true })
    await page.screenshot({ path: `${screenshots}/overview-desktop.png`, fullPage: true })
  }
  await page.setViewportSize({ width: 320, height: 740 })
  if (screenshots) await page.screenshot({ path: `${screenshots}/overview-mobile.png`, fullPage: true })
  const inputDialog = page.getByRole('dialog', { name: '转入', exact: true })
  await page.getByRole('button', { name: '转入', exact: true }).click()
  await inputDialog.getByRole('button', { name: '模拟一笔转入', exact: true }).click()
  assert.equal(await page.getByRole('dialog').count(), 1)
  await inputDialog.getByLabel('转入金额（元）').fill('100')
  await inputDialog.getByRole('button', { name: '确认转入', exact: true }).click()
  await inputDialog.waitFor({ state: 'detached' })
  assert.equal(new URL(page.url()).searchParams.has('flow'), false)
  await page.getByRole('button', { name: '转入', exact: true }).click()
  await inputDialog.getByRole('button', { name: '复制全部', exact: true }).waitFor()
  assert.equal(await inputDialog.getByLabel('转入金额（元）').count(), 0, '重开未回到首屏')
  await page.keyboard.press('Escape')
  await inputDialog.waitFor({ state: 'detached' })
  console.log('PASS 转入完成关闭同窗，重开恢复收款信息')

  const dialog = page.getByRole('dialog', { name: '转出', exact: true })
  async function width(label) {
    const sizes = await dialog.evaluate(el => ({ inner: el.clientWidth, content: el.scrollWidth }))
    assert(sizes.content <= sizes.inner + 1, `${label} 弹窗内部溢出 ${JSON.stringify(sizes)}`)
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label} 页面溢出`)
    assert.equal(await page.getByRole('dialog').count(), 1, `${label} 出现嵌套弹窗`)
  }
  async function recipient(amount) {
    await dialog.getByLabel('转账金额', { exact: true }).fill(amount)
    await dialog.getByRole('button', { name: '下一步', exact: true }).click()
    await dialog.getByRole('button', { name: /云闪付联名卡/ }).click()
    await width('收款人')
    await dialog.getByRole('button', { name: '选择收款银行', exact: true }).click()
    await dialog.getByRole('listbox').waitFor()
    await page.keyboard.press('Escape')
    assert.equal(await dialog.getByRole('listbox').count(), 0)
    assert.equal(await dialog.count(), 1, '关闭银行下拉时误关弹窗')
    await dialog.getByRole('button', { name: '下一步', exact: true }).click()
    await dialog.getByRole('heading', { name: '信息确认', exact: true }).waitFor()
    await width('确认')
  }
  await page.getByRole('button', { name: '转出', exact: true }).click()
  await dialog.getByLabel('转账金额', { exact: true }).waitFor()
  await dialog.getByRole('button', { name: '下一步', exact: true }).click()
  await dialog.getByText('请输入转账金额', { exact: true }).waitFor()
  await dialog.getByLabel('转账金额', { exact: true }).fill('9'.repeat(30))
  await width('超长金额')
  await recipient('1')
  // mock 提交本身带延迟，提交期间关闭控件禁用，Escape 也不能丢失回执。
  await dialog.getByRole('button', { name: '确认转账', exact: true }).click()
  await page.keyboard.press('Escape')
  assert.equal(await dialog.count(), 1)
  await dialog.getByRole('heading', { name: '转账成功', exact: true }).waitFor()
  await width('成功回执')
  if (screenshots) await page.screenshot({ path: `${screenshots}/transfer-receipt-mobile.png` })
  await dialog.getByRole('button', { name: '完成', exact: true }).click()
  await dialog.waitFor({ state: 'detached' })
  assert.equal(new URL(page.url()).searchParams.has('flow'), false)
  console.log('PASS 转出金额校验、收款核验、提交与回执同窗，手机无溢出')
  await page.getByRole('button', { name: '转出', exact: true }).click()
  await dialog.getByLabel('转账金额', { exact: true }).waitFor()
  assert.equal(await dialog.getByLabel('转账金额', { exact: true }).inputValue(), '')
  await recipient('6000')
  await dialog.getByRole('button', { name: '确认转账', exact: true }).click()
  await dialog.getByText('请再次确认', { exact: true }).waitFor()
  await width('大额二次确认')
  if (screenshots) await page.screenshot({ path: `${screenshots}/transfer-confirm-mobile.png` })
  await dialog.getByRole('button', { name: '确认转出', exact: true }).click()
  await dialog.getByRole('heading', { name: '转账成功', exact: true }).waitFor()
  await dialog.getByRole('button', { name: '完成', exact: true }).click()
  await dialog.waitFor({ state: 'detached' })
  console.log('PASS 大额二次确认仍在同一个弹窗内，重开表单清空')
  assert.deepEqual(errors, [])
} finally { await browser.close() }
