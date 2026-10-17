import { createOpsTerminal } from './ops-terminal.mjs'
import { createServer } from 'node:http'
import { createCustomerSupportApi } from './support-api.mjs'
import { createCustomerAuth } from './customer-auth.mjs'
import { createOperations } from './operations.mjs'
import { createPgClient } from './pg-client.mjs'
import { createDataCipher } from './database-crypto.mjs'
import { createBankConnect } from './bank-connect.mjs'
import { createConnectedHttp } from './connected-http.mjs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createBankApi } from './bank-api.mjs'
import { createSecurityGateway } from './security-gateway.mjs'
import { openBankDatabase } from './database.mjs'
import { createStaffApi, ensureStaffSchema, getTransferReviewCents } from './staff-api.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const host = process.env.BANK_HOST ?? '127.0.0.1'
const port = Number(process.env.BANK_PORT ?? 8080)
const database = await openBankDatabase()
const auth = await createCustomerAuth(database.db)
const security = await createSecurityGateway(database.db, auth)
await ensureStaffSchema(database.db)
const customerSupport = await createCustomerSupportApi({ db: database.db, auth })
// Native bank integrations and telemetry never join the legacy projection client.
const connectionDb = createPgClient(process.env.BANK_DATABASE_URL, { max: 4 })
const telemetryDb = createPgClient(process.env.BANK_DATABASE_URL, { max: 2 })
const connectionVersion = (await connectionDb.query('SELECT max(version) AS version FROM banking.schema_migrations')).rows[0]?.version
if (connectionVersion !== 2026101504) throw new Error('Bank integration/accounting schema requires matching owner bootstrap')
const connections = createBankConnect({ db: connectionDb, cipher: createDataCipher(':memory:') })
const operations = await createOperations({ db: telemetryDb, root, backupDir: process.env.BANK_BACKUP_DIR })
// 大额转账延迟到账阈值（清单 §9.1）：默认 ¥500,000 = 50000000 分。
// 2026-10-12 起是**运行时配置**：存 staff_settings，员工端随时改，这里每笔现读。
// 在途窗口时长：业务默认 5 分钟，演示调成 30 秒（BANK_TRANSFER_HOLD_SECONDS=30）。
const holdWindowMs = Number(process.env.BANK_TRANSFER_HOLD_SECONDS ?? 300) * 1000
// staffApi 依赖 bank 的资金钩子，bank 的回调又要回写 staffApi 的记录，
// 所以用前向引用解开环：先建 bank，回调触发时 staffApi 已就位。
let staffApi
const bank = await createBankApi({
  security,
  database,
  searchFrom: root,
  auth,
  storage: database.storage,
  reviewThreshold: () => getTransferReviewCents(database.db),
  holdWindowMs,
  onTransferHeld: (held) => staffApi.createTransferApproval(held),
  onHoldClosed: (closed) => staffApi.closeTransferApproval(closed),
})
// 工作人员端 /staff-api/*（见 design/staff-console/）。先于 bank.handle 匹配。
staffApi = await createStaffApi({
  db: database.db,
  operations,
  bankHooks: {
    getHeldTransfer: (args) => bank.getHeldTransfer(args),
    settleHeldTransfer: (args) => bank.settleHeldTransfer(args),
    // 乙模块（客户查询 / 代客办理）：复用同一份 mock 业务规则，不复制校验
    searchCustomers: (keyword) => bank.searchCustomers(keyword),
    getCustomerProfile: (customerId) => bank.getCustomerProfile(customerId),
    performCustomerAction: (args) => bank.performCustomerAction(args),
    publishSupportNotice: (args) => bank.publishSupportNotice(args),
  },
})

// Compatibility profile operations retain a queue while bank-native repositories
// use independent PostgreSQL transactions and row locks.
let pendingWork = Promise.resolve()
let queued = 0
function enqueue(work) {
  queued += 1
  const next = pendingWork.then(work)
  pendingWork = next.catch(() => {}).finally(() => { queued -= 1 })
  return next
}
let sweepQueued = false
const holdTimer = setInterval(() => {
  if (security.mode !== 'sandbox' || sweepQueued) return
  sweepQueued = true
  enqueue(() => bank.tickHolds()).catch(() => {
    operations.record({ service: 'settlement', kind: 'settlement-error', code: 'SETTLEMENT_FAILED' }).catch(() => {})
    console.warn('[bank-server] Settlement failed; transaction rolled back')
  }).finally(() => { sweepQueued = false })
}, 1000)
holdTimer.unref?.()

const opsTerminal = createOpsTerminal({ auth: staffApi.auth, writeAudit: staffApi.writeAudit, db: database.db, root })

async function handleRequest(req, res) {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  res.on('finish', () => {
    if (res.statusCode >= 500) {
      operations.record({ service: url.pathname.startsWith('/staff-api/') ? 'staff' : 'bank', status: res.statusCode, code: 'HTTP_ERROR' }).catch(() => {})
    }
  })
  if (url.pathname === '/health' || url.pathname === '/ready') {
    await database.db.prepare('SELECT 1').get()
    const readiness = await connections.readiness()
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify({ ok: true, kind: 'bank-partner-platform', database: 'postgresql', integrationMode: security.mode, commercialReady: readiness.ready === true, bankConnection: readiness.ready === true ? 'configured' : 'unconfigured', routes: bank.stats().routes }))
    return
  }
  // 演示数据的全局重置接口不能暴露在这个多用户联调入口。
  if (url.pathname === '/api/__demo/reset') {
    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ message: '接口不存在', code: 'NOT_FOUND' }))
    return
  }
  try {
    if (await opsTerminal.handle(req, res, url)) return
    if (await connectedHttp.handle(req, res, url)) return
    if (await customerSupport.handle(req, res, url)) return
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
    res.end(JSON.stringify({ message: error?.status && error.status < 500 ? error.message : '服务异常', code: error?.code ?? 'INTERNAL_ERROR' }))
    return
  }
  res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify({ message: '接口不存在', code: 'NOT_FOUND' }))
}

const server = createServer((req, res) => {
  if (queued >= 128) { res.writeHead(503, { 'content-type': 'application/json' }); res.end(JSON.stringify({ message: '服务繁忙，请稍后重试', code: 'BUSY' })); return }
  enqueue(() => handleRequest(req, res)).catch(() => {
    if (!res.writableEnded) {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ message: '服务异常', code: 'INTERNAL_ERROR' }))
    }
  })
})
server.requestTimeout = 30_000
server.headersTimeout = 15_000
server.maxConnections = 128

const connectedHttp = createConnectedHttp({ connections, auth, staffAuth: staffApi.auth, mode: security.mode })

server.listen(port, host, () => {
  console.log(`[bank-server] http://${host}:${port}`)
  console.log('[bank-server] PostgreSQL; bank custody integration is required for live funds')

})

let closing = false
async function shutdown() {
  if (closing) return
  closing = true
  clearInterval(holdTimer)
  opsTerminal.close()
  server.close(async () => {
    await pendingWork
    await Promise.all([database.close(), connectionDb.close(), telemetryDb.close()])
    process.exit(0)
  })
  setTimeout(() => process.exit(1), 15_000).unref()
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
