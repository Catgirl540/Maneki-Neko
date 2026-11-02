import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { createServer } from '../app/node_modules/vite/dist/node/index.js'
import { chromium } from 'playwright-core'
class MemoryStorage { values = new Map(); getItem(k) { return this.values.get(k) ?? null } setItem(k, v) { this.values.set(k, String(v)) } removeItem(k) { this.values.delete(k) } setItemsAtomically(rows) { for (const [k, v] of rows) this.setItem(k, v) } }
globalThis.window = { localStorage: new MemoryStorage(), sessionStorage: new MemoryStorage() }
const state = await import('../server/domain/state.mjs'), { createBankBusinessApi } = await import('../server/domain/index.mjs')
state.resetDb()
const api = createBankBusinessApi(), user = await api.profile(), initial = structuredClone(state.loadDb().accounts)
const root = path.resolve(import.meta.dirname, '..'), errors = [], writes = [], deletes = []
Object.assign(process.env, { VITE_USE_MOCK: 'false', VITE_BASE_PATH: '/', VITE_API_BASE_URL: '', VITE_AGENT_URL: '/agent-api' })
const web = await createServer({ root: path.join(root, 'app'), configFile: path.join(root, 'app/vite.config.ts'), logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false } })
let browser
try {
  await web.listen()
  const base = `http://127.0.0.1:${web.httpServer.address().port}`
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/snap/bin/chromium', headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
  page.setDefaultTimeout(12000); page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(user => { sessionStorage.setItem('luckycat.token', JSON.stringify('fixture')); sessionStorage.setItem('luckycat.session.user', JSON.stringify(user)) }, user)
  await page.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url()), body = req.postData() ? JSON.parse(req.postData()) : undefined
    const respond = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    if (url.origin !== base) return respond({}, 502)
    if (url.pathname.startsWith('/agent-api/')) return respond({ ok: true, bankDataSource: 'http' })
    if (!url.pathname.startsWith('/api/')) return route.continue()
    try {
      switch (url.pathname) {
        case '/api/auth/profile': return respond(user)
        case '/api/accounts': return respond(await api.listAccounts())
        case '/api/membership': return respond(await api.getMembership())
        case '/api/security/overview': return respond(await api.getSecurityOverview())
        case '/api/support/messages': return respond([])
        case '/api/budgets': return respond(await api.listBudgets())
        case '/api/budgets/monthly':
          if (req.method() === 'DELETE') { deletes.push(body); return respond(await api.deleteMonthlyBudget(body)) }
          if (req.method() === 'POST') { writes.push(body); return respond(await api.setMonthlyBudget(body)) }
          return respond(await api.listMonthlyBudgets(url.searchParams.get('month') ?? undefined))
        default: errors.push(url.pathname); return respond({}, 404)
      }
    } catch (error) { return respond({ message: error.message, code: error.code }, error.status ?? 500) }
  })
  await page.goto(base + '/analysis/budgets')
  const form = page.getByRole('region', { name: '月度分类目标' })
  await form.getByLabel('月度目标金额').fill('2000')
  await form.getByRole('button', { name: '核对月度目标' }).click()
  await form.getByLabel('确认月度分类目标').waitFor()
  assert.equal(writes.length, 0)
  await form.getByRole('button', { name: '确认保存月度目标' }).click()
  await form.getByText('月度分类目标已保存', { exact: true }).waitFor()
  assert.equal(writes[0].limit, 200000); assert.equal(writes[0].category, 'dining'); assert.equal(writes[0].version, 0)
  await form.getByText(/目标.*已用.*剩余/).waitFor()
  await page.reload()
  await form.getByText(/目标.*已用.*剩余/).waitFor()
  await form.getByLabel('月度目标金额').fill('1500')
  await form.getByRole('button', { name: '核对月度目标' }).click()
  await form.getByLabel('确认月度分类目标').waitFor()
  await api.setMonthlyBudget({ ...writes[0], limit: 180000, version: 1 })
  await form.getByRole('button', { name: '确认保存月度目标' }).click()
  await form.getByText('月度预算已变化，请重新查询并确认', { exact: true }).waitFor()
  assert.equal((await api.listMonthlyBudgets()).goals[0].limit, 180000)
  await form.getByRole('button', { name: /^删除.*月度目标$/ }).click()
  await form.getByLabel('确认删除月度目标').waitFor()
  assert.equal(deletes.length, 0)
  await form.getByRole('button', { name: '取消删除' }).click()
  assert.equal(deletes.length, 0)
  assert.equal((await api.listMonthlyBudgets()).goals.length, 1)
  await form.getByRole('button', { name: /^删除.*月度目标$/ }).click()
  const original = (await api.listMonthlyBudgets()).goals[0]
  await api.setMonthlyBudget({ ...original, limit: 170000 })
  await form.getByRole('button', { name: '确认删除月度目标', exact: true }).click()
  await form.getByText('月度预算已变化，请重新查询并确认', { exact: true }).waitFor()
  assert.equal((await api.listMonthlyBudgets()).goals[0].limit, 170000)
  await form.getByRole('button', { name: /^删除.*月度目标$/ }).click()
  await form.getByRole('button', { name: '确认删除月度目标', exact: true }).click()
  await form.getByText('月度分类目标已删除', { exact: true }).waitFor()
  await form.getByText('本月尚未设置分类目标', { exact: true }).waitFor()
  assert.equal(deletes.length, 2)
  await page.reload()
  await form.getByText('本月尚未设置分类目标', { exact: true }).waitFor()
  assert.deepEqual(state.loadDb().accounts, initial)
  assert.deepEqual(errors, [])
  await mkdir(path.join(root, '.generated/monthly-budgets'), { recursive: true })
  await page.screenshot({ path: path.join(root, '.generated/monthly-budgets/overview.png'), fullPage: true })
  console.log('PASS monthly budget UI: category target → explicit review → persist/reload → usage/remaining → version conflict protects concurrent update → cancel/delete/stale-delete/reload → funds unchanged')
} finally { await browser?.close(); await web.close() }
