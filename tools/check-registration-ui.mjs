/** 网页注册开户流程门禁。需 Vite 服务运行在 5180。 */
import { chromium } from 'playwright-core'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

const BASE = process.argv[2] ?? 'http://127.0.0.1:5180'
const dirs = (await readdir(path.join(os.homedir(), '.cache/ms-playwright')))
  .filter((name) => name.startsWith('chromium-')).sort()
const executablePath = path.join(os.homedir(), '.cache/ms-playwright', dirs.at(-1), 'chrome-linux64', 'chrome')
const browser = await chromium.launch({ executablePath })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })

let failures = 0
function check(ok, label) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) failures += 1
}

try {
  await page.goto(`${BASE}/open-account`, { waitUntil: 'networkidle' })
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'networkidle' })
  const body = await page.locator('body').innerText()
  check(body.includes('注册并开通储蓄账户'), '注册页固定显示储蓄账户')
  check(!body.includes('Ⅰ 类') && !body.includes('Ⅱ 类') && !body.includes('Ⅲ 类') && !body.includes('零钱包'), '注册页没有账户类别选择')

  const submit = page.getByRole('button', { name: '确认注册并开户' })
  await page.getByLabel('姓名').fill('测试用户')
  await page.getByLabel('身份证号').fill('310101199001011234')
  await page.getByLabel('登录密码', { exact: true }).fill('safe123')
  await page.getByLabel('确认登录密码').fill('different')
  check(await page.getByText('两次输入的密码不一致').isVisible(), '密码不一致给出即时错误')
  check(await submit.isDisabled(), '密码不一致时不可提交')

  await page.getByLabel('确认登录密码').fill('safe123')
  await page.getByLabel('手机号').fill('13900139000')
  check(await submit.isDisabled(), '缺短信验证时不可提交')
  await page.getByRole('button', { name: '获取验证码' }).click()
  await page.getByText(/演示环境验证码：\d{6}/).waitFor()
  check(await submit.isDisabled(), '缺人脸核身时不可提交')
  await page.getByRole('button', { name: '开始人脸核身' }).click()
  await page.getByRole('button', { name: '人脸核身已通过' }).waitFor()
  check(await submit.isDisabled(), '缺开户承诺时不可提交')

  const checks = page.locator('input[type="checkbox"]')
  await checks.nth(0).check()
  check(await submit.isDisabled(), '缺最终信息确认时不可提交')
  await checks.nth(1).check()
  check(await submit.isEnabled(), '短信、人脸、承诺和最终确认齐全后可提交')

  await submit.click()
  await page.waitForURL('**/dashboard')
  await page.getByText('储蓄账户余额').waitFor()
  const dashboard = await page.locator('body').innerText()
  const storedBalance = await page.evaluate(() => {
    const raw = localStorage.getItem('luckycat.mock.db')
    return raw ? JSON.parse(raw).accounts?.[0]?.balance : null
  })
  check(dashboard.includes('储蓄账户余额') && storedBalance === 0, '开户成功后自动登录并进入零余额首页')
  if (storedBalance !== 0) console.log(`      storedBalance=${storedBalance}`)
} finally {
  await browser.close()
}

if (failures) process.exit(1)
console.log('\nRegistration UI checks passed.')
