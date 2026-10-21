/** 浏览器验收专用：127.0.0.1 隔离内存银行，所有业务写接口拒绝，不代理真实银行或模型。 */
import { createServer } from '../app/node_modules/vite/dist/node/index.js'
import { resolve } from 'node:path'
class Storage {
  data = new Map()
  getItem(key) { return this.data.get(key) ?? null }
  setItem(key, value) { this.data.set(key, String(value)) }
  removeItem(key) { this.data.delete(key) }
}
globalThis.window = { localStorage: new Storage(), sessionStorage: new Storage() }
const { createMockApi } = await import('../app/src/api/mock/index.ts')
const { resetDb, loadDb, persist } = await import('../app/src/api/mock/db.ts')
const { WEALTH_INVESTMENT_AGREEMENT, RISK_ACKNOWLEDGEMENT } = await import('../app/src/lib/wealth.ts')
resetDb()
const api = createMockApi()
const profile = await api.profile()
const account = (await api.listAccounts())[0]
const sms = await api.sendSmsCode(profile.phone)
const face = await api.verifyIdentity('face')
const questions = await api.listRiskQuestions()
await api.submitRiskAssessment(questions.map(question => question.options.reduce((best, option, index, all) => option.score > all[best].score ? index : best, 0)))
await api.openWealthAccount({ smsCode: sms.demoCode, faceTicket: face.ticket, agreement: WEALTH_INVESTMENT_AGREEMENT, settlementAccountId: account.id })
const products = await api.listWealthProducts()
for (const product of [products.find(product => product.category === 'cash'), products.find(product => product.category === 'fixed')]) {
  await api.subscribeWealth({ productCode: product.code, amount: Math.max(product.minAmount, 200000), paymentPassword: '888888', riskAcknowledgement: RISK_ACKNOWLEDGEMENT })
}
const openHolding = (await api.getWealthOverview()).holdings.find(holding => !holding.closed)
await api.redeemWealth({ holdingId: openHolding.id, shares: 1000 })
// 补足分页读模型；夹具是虚构数据，不能作为订单或真实用户账本。
const db = loadDb()
const row = db.transactions.find(transaction => transaction.counterparty.startsWith('申购 · '))
for (let index = 0; index < 12; index++) db.transactions.push({ ...row, id: `wealth_fixture_${index}`, createdAt: `2026-10-${String(19 - index).padStart(2, '0')}T04:00:00.000Z` })
persist()
const root = resolve(import.meta.dirname, '..')
Object.assign(process.env, { VITE_USE_MOCK: 'false', VITE_BASE_PATH: '/', VITE_API_BASE_URL: '', VITE_AGENT_URL: '/agent-api' })
let pageTwoFailure = true
const fixture = {
  name: 'wealth-readonly-fixture', enforce: 'pre',
  configureServer(server) {
    server.middlewares.use(async (request, response, next) => {
      const url = new URL(request.url, 'http://localhost')
      if (!url.pathname.startsWith('/api/') && !url.pathname.startsWith('/agent-api/')) return next()
      const send = (data, status = 200) => { response.statusCode = status; response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(data)) }
      try {
        if (url.pathname === '/agent-api/health') return send({ ok: false })
        if (url.pathname.startsWith('/agent-api/')) return send({ message: '验收夹具不连接模型' }, 503)
        if (url.pathname === '/api/auth/login') return send({ token: 'wealth-fixture-only', user: { ...profile, name: '理财界面夹具', avatarInitial: '测' } })
        if (url.pathname === '/api/auth/sms-code') return send({ sent: true, expiresAt: new Date(Date.now() + 300000).toISOString(), demoCode: '123456' })
        if (request.method !== 'GET') return send({ message: '只读验收夹具，禁止业务提交' }, 405)
        if (url.pathname === '/api/auth/profile') return send({ ...profile, name: '理财界面夹具', avatarInitial: '测' })
        if (url.pathname === '/api/accounts') return send(await api.listAccounts())
        if (url.pathname === '/api/wealth/overview') return send(await api.getWealthOverview())
        if (url.pathname === '/api/wealth/products') return send(await api.listWealthProducts())
        if (url.pathname === '/api/wealth/risk/questions') return send(await api.listRiskQuestions())
        if (url.pathname === '/api/wealth/cash-management') return send(await api.getCashManagement())
        if (url.pathname === '/api/wealth/investments') return send(await api.getInvestments())
        if (url.pathname === '/api/savings/overview') return send(await api.getSavingsOverview())
        if (url.pathname === '/api/support/messages') return send([])
        if (url.pathname === '/api/support/tickets') return send({ items: [], total: 0, page: 1, size: 20 })
        if (url.pathname === `/api/accounts/${account.id}/transactions`) {
          const page = Number(url.searchParams.get('page') ?? 1)
          if (page === 2 && pageTwoFailure) { pageTwoFailure = false; return send({ message: '夹具：第二页首次加载失败，请重试' }, 503) }
          return send(await api.listTransactions(account.id, { page, size: Number(url.searchParams.get('size') ?? 10), category: url.searchParams.get('category') ?? 'all', keyword: url.searchParams.get('keyword') ?? '' }))
        }
        if (url.pathname.startsWith('/api/transactions/')) return send(await api.getTransaction(decodeURIComponent(url.pathname.slice('/api/transactions/'.length))))
        return send({ message: `只读夹具未提供 ${url.pathname}` }, 404)
      } catch (error) { send({ message: error.message, code: error.code }, error.status ?? 500) }
    })
  },
}
const web = await createServer({ root: `${root}/app`, cacheDir: `${root}/app/node_modules/.vite-wealth-ui`, configFile: `${root}/app/vite.config.ts`, plugins: [fixture],
  server: { host: '127.0.0.1', port: 5185, strictPort: true, hmr: false, proxy: {} }, logLevel: 'error' })
await web.listen()
console.log('只读理财验收夹具 http://127.0.0.1:5185/wealth；任意 11 位演示手机号 / 密码 / 短信 123456；业务写入均拒绝。')
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await web.close(); process.exit(0) })
