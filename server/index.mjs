import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDemoBank } from '../framework/bridge/demo-bank.mjs'
import { openBankDatabase } from './database.mjs'
import { createStaffApi, ensureStaffSchema, getTransferReviewCents } from './staff-api.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const host = process.env.BANK_HOST ?? '127.0.0.1'
const port = Number(process.env.BANK_PORT ?? 8080)
const databaseFile = process.env.BANK_DB_FILE ?? join(root, 'server/data/bank.sqlite')
const legacyStateFile = process.env.BANK_STATE_FILE ?? join(root, 'server/data/demo-bank-state.json')
const sessionLifetimeMs = 12 * 60 * 60 * 1000
const sessions = new Map()

function unauthorized() {
  return Object.assign(new Error('请重新登录'), { status: 401, code: 'UNAUTHORIZED' })
}

function session(req) {
  const match = /^Bearer ([A-Za-z0-9_-]+)$/.exec(req.headers.authorization ?? '')
  if (!match) return null
  const entry = sessions.get(match[1])
  if (!entry) return null
  if (entry.expiresAt <= Date.now()) {
    sessions.delete(match[1])
    return null
  }
  return entry
}

const auth = {
  resolve(req, routeName) {
    if (routeName === 'login' || routeName === 'register') return null
    const current = session(req)
    // 注册和登录前必须能获取验证码、完成演示核身。
    // 已登录时则保持当前用户档案，供换绑手机号等流程使用。
    if (routeName === 'smsCode' || routeName === 'verifyIdentity') return current?.phone ?? null
    if (!current) throw unauthorized()
    return current.phone
  },
  issue(user) {
    const token = randomBytes(32).toString('base64url')
    sessions.set(token, { phone: user.phone, expiresAt: Date.now() + sessionLifetimeMs })
    return token
  },
  logout(req) {
    const match = /^Bearer ([A-Za-z0-9_-]+)$/.exec(req.headers.authorization ?? '')
    if (match) sessions.delete(match[1])
  },
  phoneChanged(previous, next) {
    for (const entry of sessions.values()) {
      if (entry.phone === previous) entry.phone = next
    }
  },
}

mkdirSync(dirname(databaseFile), { recursive: true })
const database = openBankDatabase(databaseFile, legacyStateFile)
// 先建 staff 表：阈值读取走 staff_settings，必须在任何 getTransferReviewCents 之前存在。
ensureStaffSchema(database.db)
// 大额转账延迟到账阈值（清单 §9.1）：默认 ¥500,000 = 50000000 分。
// 2026-10-12 起是**运行时配置**：存 staff_settings，员工端随时改，这里每笔现读。
// 在途窗口时长：业务默认 5 分钟，演示调成 30 秒（BANK_TRANSFER_HOLD_SECONDS=30）。
const holdWindowMs = Number(process.env.BANK_TRANSFER_HOLD_SECONDS ?? 300) * 1000
// staffApi 依赖 bank 的资金钩子，bank 的回调又要回写 staffApi 的记录，
// 所以用前向引用解开环：先建 bank，回调触发时 staffApi 已就位。
let staffApi
const bank = await createDemoBank({
  searchFrom: root,
  auth,
  storage: database.storage,
  reviewThreshold: () => getTransferReviewCents(database.db),
  holdWindowMs,
  onTransferHeld: (held) => staffApi.createTransferApproval(held),
  onHoldClosed: (closed) => staffApi.closeTransferApproval(closed),
})
// 工作人员端 /staff-api/*（见 design/staff-console/）。先于 bank.handle 匹配。
staffApi = createStaffApi({
  db: database.db,
  bankHooks: {
    getHeldTransfer: (args) => bank.getHeldTransfer(args),
    settleHeldTransfer: (args) => bank.settleHeldTransfer(args),
    // 乙模块（客户查询 / 代客办理）：复用同一份 mock 业务规则，不复制校验
    searchCustomers: (keyword) => bank.searchCustomers(keyword),
    getCustomerProfile: (customerId) => bank.getCustomerProfile(customerId),
    performCustomerAction: (args) => bank.performCustomerAction(args),
  },
})

// 在途窗口到点自动到账（清单 §9.1：没人拦 = 默认放行）。
// 1 秒一次：demo 窗口只有 30 秒，粒度太粗会让倒计时和实际到账对不上。
const holdTimer = setInterval(() => {
  bank.tickHolds().catch((error) => {
    console.warn(`[bank-server] 自动到账扫账失败：${error?.message ?? error}`)
  })
}, 1000)
holdTimer.unref?.()

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify({ ok: true, kind: 'demo-bank', routes: bank.stats().routes }))
    return
  }
  // 演示数据的全局重置接口不能暴露在这个多用户联调入口。
  if (url.pathname === '/api/__demo/reset') {
    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ message: '接口不存在', code: 'NOT_FOUND' }))
    return
  }
  try {
    if (await staffApi.handle(req, res, url)) return
    if (url.pathname === '/api/agent/transfer/requirements' && req.method === 'GET') {
      const value = await bank.transferRequirements(req)
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(value))
      return
    }
    if (url.pathname === '/api/agent/wealth/requirements' && req.method === 'GET') {
      const value = await bank.wealthRequirements(req)
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(value))
      return
    }
    if (url.pathname === '/api/auth/payment-password/verify' && req.method === 'POST') {
      let size = 0
      const chunks = []
      for await (const chunk of req) {
        size += chunk.length
        if (size > 4096) throw Object.assign(new Error('请求体过大'), { status: 413 })
        chunks.push(chunk)
      }
      let body
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) }
      catch { throw Object.assign(new Error('请求体不是合法 JSON'), { status: 400 }) }
      await bank.verifyPaymentPassword(req, typeof body.paymentPassword === 'string' ? body.paymentPassword : '')
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify({ ok: true }))
      return
    }
    if (await bank.handle(req, res, url)) return
  } catch (error) {
    if (res.writableEnded) return
    res.writeHead(error?.status ?? 500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify({ message: error?.message ?? '服务异常', code: error?.code ?? 'INTERNAL_ERROR' }))
    return
  }
  res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify({ message: '接口不存在', code: 'NOT_FOUND' }))
})

server.listen(port, host, () => {
  console.log(`[bank-server] http://${host}:${port}`)
  console.log(`[bank-server] SQLite: ${databaseFile}`)
  console.log(`[bank-server] 大额延迟到账：阈值 ¥${(getTransferReviewCents(database.db) / 100).toFixed(2)}（员工端可改），窗口 ${holdWindowMs / 1000}s`)
})
