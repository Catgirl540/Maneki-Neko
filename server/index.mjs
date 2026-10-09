import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDemoBank } from '../framework/bridge/demo-bank.mjs'
import { openBankDatabase } from './database.mjs'

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
const bank = await createDemoBank({ searchFrom: root, auth, storage: database.storage })

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
})
