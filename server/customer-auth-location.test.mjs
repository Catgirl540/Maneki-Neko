import test from 'node:test'
import assert from 'node:assert/strict'
import { createCustomerAuth } from './customer-auth.mjs'

/** 极简内存库：够用的 SELECT/INSERT/UPDATE 语义，专测审计与会话字段。 */
function memoryDb() {
  const sessions = new Map(), audits = []
  return {
    audits, sessions,
    async exec() {},
    async transaction(work) { return work() },
    prepare(sql) {
      const statement = sql.replace(/\s+/g, ' ').trim()
      return {
        async run(...args) {
          if (statement.startsWith('INSERT INTO customer_sessions')) {
            const [id, owner_id, phone, device, created_at, expires_at, ip] = args
            sessions.set(id, { id, owner_id, phone, device, created_at, expires_at, ended_at: null, ip })
            return { changes: 1 }
          }
          if (statement.startsWith('INSERT INTO customer_auth_audit')) {
            const [id, owner_id, action, created_at, level, ip, device] = args
            audits.push({ id, owner_id, action, created_at, level, ip, device, seq: audits.length + 1 })
            return { changes: 1 }
          }
          if (statement.startsWith('UPDATE customer_sessions SET ended_at')) {
            const [ended_at, id] = args
            const row = sessions.get(id)
            if (!row || row.ended_at !== null) return { changes: 0 }
            row.ended_at = ended_at
            return { changes: 1 }
          }
          return { changes: 0 }
        },
        async get(...args) {
          if (statement.startsWith('SELECT * FROM customer_sessions WHERE id')) return sessions.get(args[0])
          return undefined
        },
        async all(ownerId) {
          if (statement.includes('FROM customer_sessions')) return [...sessions.values()].filter((row) => row.owner_id === ownerId)
          if (statement.includes('FROM customer_auth_audit')) return audits.filter((row) => row.owner_id === ownerId).reverse()
          return []
        },
      }
    },
  }
}

test('登录设备与安全日志记录真实来源地址和设备，而不是一律未知', async () => {
  const db = memoryDb()
  const auth = await createCustomerAuth(db, { now: () => 1_700_000_000_000 })
  const user = { id: 'u1', phone: '13800138000' }

  // 经本机反向代理的请求：信任 x-real-ip，按浏览器 UA 识别设备。
  const proxied = {
    socket: { remoteAddress: '127.0.0.1' },
    headers: {
      'x-real-ip': '203.0.113.9',
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
    },
  }
  await auth.issue(user, proxied)

  // 直连请求：不信任可伪造的 x-real-ip，只记 peer。
  await auth.issue(user, { socket: { remoteAddress: '10.1.2.3' }, headers: { 'x-real-ip': '1.1.1.1', 'user-agent': 'okhttp/4.12.0' } })

  const dbRows = [...db.sessions.values()]
  assert.equal(dbRows.length, 2)
  const first = dbRows[0]
  assert.equal(first.ip, '203.0.113.9')
  assert.equal(first.device, 'macOS · Chrome')

  const second = dbRows[1]
  assert.equal(second.ip, '10.1.2.3', '直连时不得采信 x-real-ip')
  assert.equal(second.device, '招财猫 App')

  // 审计行同样带地址与设备，detail 由真实字段拼出。
  assert.equal(db.audits[0].ip, '203.0.113.9')
  assert.equal(db.audits[0].device, 'macOS · Chrome')
})

test('旧库没有 ip 列时登录仍可用，只是不记录地址', async () => {
  const { createCustomerAuth: create } = await import('./customer-auth.mjs')
  const sessions = [], audits = []
  const db = {
    async exec() {},
    async transaction(work) { return work() },
    prepare(sql) {
      const statement = sql.replace(/\s+/g, ' ').trim()
      return {
        async get() {
          // 旧库：SELECT ip 直接报错，其余查询当不存在。
          if (statement.includes('SELECT ip')) throw Object.assign(new Error('column "ip" does not exist'), { code: '42703' })
          return undefined
        },
        async run(...args) {
          if (statement.startsWith('INSERT INTO customer_sessions')) {
            if (statement.includes('ip')) throw Object.assign(new Error('column "ip" does not exist'), { code: '42703' })
            sessions.push(args); return { changes: 1 }
          }
          if (statement.startsWith('INSERT INTO customer_auth_audit')) { audits.push(args); return { changes: 1 } }
          return { changes: 0 }
        },
        async all() { return [] },
      }
    },
  }
  const auth = await create(db, { now: () => 1_700_000_000_000 })
  const token = await auth.issue({ id: 'u1', phone: '13800138000' }, { socket: { remoteAddress: '203.0.113.9' }, headers: { 'user-agent': 'okhttp/4.12.0' } })
  assert.equal(typeof token, 'string')
  assert.equal(sessions.length, 1, '登录会话照常写入')
  assert.equal(sessions[0].length, 6, '旧库语句不含 ip 列')
  assert.equal(audits.length, 1, '审计照常写入')
})
