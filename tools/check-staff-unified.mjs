/** Browser regression for one staff environment. Uses only local HTTP fixtures; no database or model calls. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'staff', 'dist')
const fixturePassword = 'LocalFixture!123'
await stat(join(dist, 'index.html')).catch(() => {
  throw Error('Build first: VITE_USE_MOCK=false VITE_BASE_PATH=/staff/ npm --prefix staff run build')
})
const users = {
  csr: { id: 'fixture-csr', name: '王小明', role: 'csr' },
  supervisor: { id: 'fixture-supervisor', name: '李主管', role: 'supervisor' },
  ops: { id: 'fixture-ops', name: '运维人员', role: 'ops' },
}
const requests = [], unexpected = [], tokens = new Map(), expired = new Set()
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.mp4': 'video/mp4', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf' }
let sequence = 0
const json = (res, body, status = 200) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://127.0.0.1').pathname
  try {
    if (path.startsWith('/staff-api/') || path.startsWith('/staff-agent-api/') || path.startsWith('/staff-ops-agent-api/')) {
      const auth = req.headers.authorization ?? ''
      requests.push({ path, auth, method: req.method })
      if (path === '/staff-api/login') {
        let raw = ''; for await (const chunk of req) raw += chunk
        const body = JSON.parse(raw)
        const staff = Object.values(users).find(user => user.name === body.name)
        if (!staff || body.password !== fixturePassword) return json(res, { code: 'UNAUTHORIZED' }, 401)
        const token = `fixture-staff-${staff.role}-${++sequence}`
        tokens.set(`Bearer ${token}`, staff)
        return json(res, { token, staff })
      }
      const staff = tokens.get(auth)
      if (!staff || expired.has(auth)) return json(res, { code: 'UNAUTHORIZED', error: '登录已过期' }, 401)
      if (path === '/staff-api/me') return json(res, staff)
      if (path === '/staff-api/logout') { tokens.delete(auth); return json(res, {}) }
      if (path === '/staff-api/tickets' || path === '/staff-api/audit-logs') return json(res, [])
      if (path === '/staff-api/workbench') return json(res, { pending: 0, mine: 0, waiting: 0, resolved: 0 })
      if (path === '/staff-api/ops/overview' && staff.role === 'ops') return json(res, {
        checkedAt: new Date().toISOString(), startedAt: new Date().toISOString(), uptimeSeconds: 0,
        services: [], version: { revision: 'fixture', localChanges: false, node: process.version, environment: 'fixture', telemetrySince: new Date().toISOString() },
        database: { sizeBytes: 0 }, backups: { status: 'missing', detail: 'Local test', items: [] }, events: [], errors24h: 0,
      })
      if (path === '/staff-api/im/notification-preferences') return json(res, { enabled: false, quiet_start: null, quiet_end: null, urgent_override: false, version: 1, binding: null })
      if (path === '/staff-api/im/notifications') return json(res, { items: [], total: 0, page: 1, waitingRecipients: 0 })
      if (path === '/staff-api/im/notification-rules' && staff.role === 'supervisor') return json(res, { rules: { csrIds: [], supervisorIds: [users.supervisor.id], start: '00:00', end: '00:00', version: 1 }, staff: Object.values(users) })
      if (path === '/staff-agent-api/im/bindings' && staff.role !== 'ops') return json(res, [])
      const channel = staff.role === 'ops' ? '/staff-ops-agent-api' : '/staff-agent-api'
      if (path === `${channel}/health`) return json(res, { ok: true, bankDataSource: 'http', voice: { asr: false, tts: false } })
      unexpected.push({ path, role: staff.role })
      return json(res, { code: 'FIXTURE_UNEXPECTED_ROUTE' }, 500)
    }
    if (/^\/(staff-demo-api|api|agent-api)\//.test(path)) {
      unexpected.push({ path, auth: req.headers.authorization })
      return json(res, { code: 'WRONG_BANK_CHANNEL' }, 500)
    }
    if (path.startsWith('/staff/')) {
      const relative = path.slice('/staff/'.length)
      const file = relative.startsWith('assets/') ? resolve(dist, relative) : join(dist, 'index.html')
      if (!file.startsWith(dist + sep)) return json(res, {}, 403)
      res.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream' })
      return res.end(await readFile(file))
    }
    return json(res, {}, 404)
  } catch (error) {
    unexpected.push({ path, error: String(error) })
    if (!res.headersSent) json(res, { code: 'FIXTURE_ERROR' }, 500)
    else res.end()
  }
})

let browser
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  browser = await chromium.launch({
    executablePath: process.env.CHROME_BIN ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  })
  const selections = [{ query: 'demo', stored: 'live' }, { query: 'live', stored: 'demo' }, { query: '', stored: 'demo' }]
  const navigate = async (page, path) => {
    await page.evaluate(path => { history.pushState({}, '', `/staff${path}`); dispatchEvent(new PopStateEvent('popstate')) }, path)
  }
  for (const selection of selections) {
    for (const role of ['csr', 'supervisor', 'ops']) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
      await context.addInitScript(({ stored }) => {
        sessionStorage.setItem('luckycat.staff.bank-environment', stored)
        sessionStorage.setItem('luckycat.token', JSON.stringify('fixture-customer-token'))
        sessionStorage.setItem('luckycat.session.user', JSON.stringify({ id: 'fixture-customer', name: '客户' }))
      }, selection)
      const page = await context.newPage()
      page.setDefaultTimeout(10_000)
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      const start = requests.length
      const loginUrl = `${base}/staff/login${selection.query ? `?bank=${selection.query}` : ''}`
      await page.goto(loginUrl)
      await page.getByRole('heading', { name: '登录工作人员账户' }).waitFor()
      assert.equal(await page.getByRole('combobox').count(), 0)
      assert.equal(await page.getByText('合作银行环境', { exact: true }).count(), 0)
      await page.getByText('工作人员账号', { exact: true }).click()
      await page.getByText('请使用管理员分配的工作人员姓名和密码登录。', { exact: false }).waitFor()
      assert.equal(await page.getByText('密码均为 123456', { exact: false }).count(), 0)
      const login = async () => {
        await page.getByLabel('员工姓名').fill(users[role].name)
        await page.getByLabel('密码', { exact: true }).fill(fixturePassword)
        await page.getByRole('button', { name: '登录', exact: true }).click()
        await page.waitForURL(`${base}/staff/${role === 'ops' ? 'operations' : 'workbench'}`)
        await page.getByRole('heading', { name: role === 'ops' ? '运维监控' : '工作台', exact: true }).waitFor()
      }
      await login()
      const token = `Bearer fixture-staff-${role}-${sequence}`
      const nav = page.getByRole('navigation', { name: '工作人员导航' })
      assert.equal(await nav.getByRole('link', { name: 'IM 机器人', exact: true }).count(), role === 'ops' ? 0 : 1)
      assert.equal(await nav.getByRole('link', { name: '运维监控', exact: true }).count(), role === 'ops' ? 1 : 0)
      assert.equal(await nav.getByRole('link', { name: '审计日志', exact: true }).count(), role === 'supervisor' ? 1 : 0)
      const health = page.waitForResponse(response => response.url().endsWith(`${role === 'ops' ? '/staff-ops-agent-api' : '/staff-agent-api'}/health`) && response.status() === 200)
      await nav.getByRole('link', { name: '工作人员助手', exact: true }).click()
      await page.locator('.staff-assistant-heading').filter({ hasText: role === 'ops' ? '运维助手' : '工作人员助手' }).waitFor()
      await health
      await page.getByLabel('聊天消息').waitFor({ state: 'visible' })
      assert.equal(await page.getByLabel('聊天消息').isEnabled(), true)
      if (role === 'ops') {
        const before = requests.length
        await navigate(page, '/im')
        await page.waitForURL(`${base}/staff/operations`)
        assert.equal(requests.slice(before).some(request => request.path.includes('/im/')), false)
        await navigate(page, '/customers')
        await page.waitForURL(`${base}/staff/operations`)
      } else {
        await nav.getByRole('link', { name: 'IM 机器人', exact: true }).click()
        await page.getByRole('heading', { name: 'IM 机器人', exact: true }).waitFor()
        await page.getByText('尚未连接本人微信', { exact: true }).waitFor()
        const before = requests.length
        await navigate(page, '/operations')
        await page.waitForURL(`${base}/staff/workbench`)
        assert.equal(requests.slice(before).some(request => request.path === '/staff-api/ops/overview'), false)
        await navigate(page, '/audit')
        if (role === 'supervisor') await page.getByRole('heading', { name: '审计日志', exact: true }).waitFor()
        else await page.waitForURL(`${base}/staff/workbench`)
      }
      assert(requests.slice(start).some(request => request.path === '/staff-api/login'), 'All legacy links must log in via /staff-api')
      assert(requests.slice(start).filter(request => request.auth).every(request => request.auth === token), 'Staff requests must use only the current employee token')
      assert.equal(await page.evaluate(() => sessionStorage.getItem('luckycat.token')), JSON.stringify('fixture-customer-token'))
      await page.getByRole('button', { name: '退出', exact: true }).click()
      await page.waitForURL(`${base}/staff/login`)
      assert.equal(tokens.has(token), false, 'Logout must invalidate the employee token')
      assert.deepEqual(errors, [])
      await context.close()
    }
  }

  // An Agent 401 clears the in-memory employee session, even with an old demo link and customer token present.
  const page = await browser.newPage()
  await page.goto(`${base}/staff/login?bank=demo`)
  await page.getByLabel('员工姓名').fill(users.csr.name)
  await page.getByLabel('密码', { exact: true }).fill(fixturePassword)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await page.waitForURL(`${base}/staff/workbench`)
  expired.add(`Bearer fixture-staff-csr-${sequence}`)
  await page.getByRole('navigation').getByRole('link', { name: '工作人员助手', exact: true }).click()
  await page.waitForURL(`${base}/staff/login`)
  const afterExpired = requests.length
  await page.reload()
  await page.getByRole('heading', { name: '登录工作人员账户' }).waitFor()
  assert(requests.slice(afterExpired).every(request => !request.auth), 'Expired employee token must not survive reload')
  await page.close()
  assert.deepEqual(unexpected, [], 'No customer, retired environment, wrong role or unknown API channel may be requested')
  assert(requests.every(request => request.auth !== 'Bearer fixture-customer-token'), 'Customer token must never be sent to staff channels')
  console.log('PASS unified staff browser: 9 legacy URL/storage/role combinations, canonical API, assistant/IM, role guards, logout and Agent 401')
} finally {
  await browser?.close()
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
}
