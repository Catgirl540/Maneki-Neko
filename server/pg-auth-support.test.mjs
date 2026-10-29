import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { createCustomerAuth } from './customer-auth.mjs'
import { createSecurityGateway } from './security-gateway.mjs'
import { createCustomerSupportApi } from './support-api.mjs'

const tick = () => new Promise(resolve => setImmediate(resolve))
const unauthorized = () => { throw Object.assign(new Error('请重新登录'), { status: 401, code: 'UNAUTHORIZED' }) }
function request(path, body, token, method = 'POST') {
  return Object.assign(Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]), {
    method, url: path, headers: token ? { authorization: `Bearer ${token}` } : {}, socket: { remoteAddress: '127.0.0.1' },
  })
}
function response() {
  return { writeHead(status) { this.status = status }, end(value) { this.body = JSON.parse(value) } }
}

// Resolving on a later turn catches accidental synchronous treatment of PG results.
test('customer sessions wait for database writes and share hashed tokens across processes', async () => {
  const sessions = new Map(), audits = []
  const db = {
    async exec() { await tick() },
    async transaction(work) { await tick(); return work() },
    prepare(sql) { return {
      async run(...args) {
        await tick()
        if (sql.startsWith('INSERT INTO customer_sessions')) {
          const [id, owner_id, phone, device, created_at, expires_at] = args
          sessions.set(id, { id, owner_id, phone, device, created_at, expires_at, ended_at: null })
        } else if (sql.startsWith('INSERT INTO customer_auth_audit')) audits.push(args)
        else if (sql.startsWith('UPDATE customer_sessions SET ended_at')) {
          const row = sessions.get(args[1])
          if (!row || row.ended_at !== null) return { changes: 0 }
          row.ended_at = args[0]
        } else throw new Error(`Unexpected SQL: ${sql}`)
        return { changes: 1 }
      },
      async get(...args) { await tick(); const row = sessions.get(args[0]); return row?.ended_at === null ? row : undefined },
    } },
  }
  const auth = await createCustomerAuth(db)
  const token = await auth.issue({ id: 'customer_test', phone: '13800000001' }, { headers: {} })
  assert.equal(audits.length, 1, 'token issue must await the audit write')
  assert.equal(sessions.has(token), false, 'raw bearer tokens must never be persisted')
  const secondProcess = await createCustomerAuth(db)
  const req = request('/api/accounts', undefined, token, 'GET')
  assert.deepEqual(await secondProcess.identity(req), { id: 'customer_test' })
  await secondProcess.logout(req)
  await assert.rejects(auth.identity(req), { code: 'UNAUTHORIZED' })
  assert.equal(audits.length, 2)
})

test('live mode rejects simulator payments, card operations, SMS and identity verification', async () => {
  const previous = process.env.BANK_INTEGRATION_MODE
  process.env.BANK_INTEGRATION_MODE = 'live'
  try {
    const security = await createSecurityGateway({ async exec() {}, prepare() { throw new Error('Live gate touched sandbox database') } }, { async identity() { return unauthorized() } })
    const req = request('/api/transfers', {})
    for (const method of ['submitTransfer', 'recallTransfer', 'deposit', 'subscribeWealth', 'openCard', 'setCardLock', 'updateCardSettings', 'setAutoDebitEnabled', 'updateSavingsRoundup', 'applyLoan', 'runIdentityOcr', 'runIdentityLiveness']) {
      await assert.rejects(security.before(req, method, { channel: 'bank', scope: 'domestic', payeeBankCode: 'LCB', payeeBankRegion: 'CN' }), { code: 'INTEGRATION_NOT_CONFIGURED' }, method)
    }
    await assert.rejects(security.sendSms('13800000001'), { code: 'INTEGRATION_NOT_CONFIGURED' })
    await assert.rejects(security.verifySms('13800000001', '123456'), { code: 'INTEGRATION_NOT_CONFIGURED' })
    await assert.rejects(security.issueIdentityTicket('face'), { code: 'INTEGRATION_NOT_CONFIGURED' })
    await assert.rejects(security.consumeIdentityTicket('sandbox-ticket'), { code: 'INTEGRATION_NOT_CONFIGURED' })
  } finally {
    if (previous === undefined) delete process.env.BANK_INTEGRATION_MODE
    else process.env.BANK_INTEGRATION_MODE = previous
  }
})

test('production defaults to live and refuses an explicit sandbox configuration', async () => {
  const names=['NODE_ENV','BANK_INTEGRATION_MODE','BANK_AUTO_MIGRATE']
  const previous=new Map(names.map(name=>[name,process.env[name]]))
  try {
    process.env.NODE_ENV='production'
    process.env.BANK_AUTO_MIGRATE='false'
    delete process.env.BANK_INTEGRATION_MODE
    const db={async exec(){throw new Error('Production default attempted DDL')},prepare(){throw new Error('Production default touched sandbox data')}}
    const auth={async identity(){return unauthorized()}}
    const security=await createSecurityGateway(db,auth)
    assert.equal(security.mode,'live')
    await assert.rejects(security.sendSms('13800000001'),{code:'INTEGRATION_NOT_CONFIGURED'})
    await assert.rejects(security.before(request('/api/transfers',{}),'submitTransfer',{}),{code:'INTEGRATION_NOT_CONFIGURED'})
    process.env.BANK_INTEGRATION_MODE='sandbox'
    await assert.rejects(createSecurityGateway(db,auth),/Production requires BANK_INTEGRATION_MODE=live/)
    process.env.NODE_ENV='test'
    assert.equal((await createSecurityGateway(db,auth)).mode,'sandbox')
  } finally {
    for(const [name,value]of previous)if(value===undefined)delete process.env[name];else process.env[name]=value
  }
})

test('runtime initialization does not require DDL privileges when auto migration is disabled', async () => {
  const previous = process.env.BANK_AUTO_MIGRATE
  process.env.BANK_AUTO_MIGRATE = 'false'
  try {
    const db = { async exec() { throw new Error('Runtime attempted schema mutation') } }
    const auth = await createCustomerAuth(db)
    assert.equal(typeof auth.identity, 'function')
    const security = await createSecurityGateway(db, auth)
    assert.equal(typeof security.before, 'function')
    const support = await createCustomerSupportApi({ db, auth })
    assert.equal(typeof support.handle, 'function')
  } finally {
    if (previous === undefined) delete process.env.BANK_AUTO_MIGRATE
    else process.env.BANK_AUTO_MIGRATE = previous
  }
})

test('PostgreSQL auth, one-use challenges and concurrent support/idempotency retries', { skip: !process.env.BANK_TEST_DATABASE_URL, timeout: 60000 }, async () => {
  const { createPgClient } = await import('./pg-client.mjs')
  const url = process.env.BANK_TEST_DATABASE_URL
  const schema = `auth_support_test_${randomUUID().replaceAll('-', '')}`
  const admin = createPgClient(url), db = createPgClient(url, { schema })
  const previousMode = process.env.BANK_INTEGRATION_MODE
  const previousMigrate = process.env.BANK_AUTO_MIGRATE
  process.env.BANK_INTEGRATION_MODE = 'sandbox'
  process.env.BANK_AUTO_MIGRATE = 'true'
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`)
    await db.exec(`CREATE TABLE tickets (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, channel TEXT NOT NULL, reason TEXT NOT NULL, priority TEXT NOT NULL, status TEXT NOT NULL, assignee_id TEXT, created_by TEXT, agent_transcript TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE ticket_messages (id TEXT PRIMARY KEY, seq BIGINT GENERATED BY DEFAULT AS IDENTITY UNIQUE, ticket_id TEXT NOT NULL REFERENCES tickets(id), sender TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE audit_logs (id TEXT PRIMARY KEY, actor_type TEXT, actor_id TEXT, action TEXT, target_type TEXT, target_id TEXT, result TEXT, request_id TEXT, reason TEXT, created_at TEXT);
      CREATE TABLE customer_membership_state(owner_id TEXT PRIMARY KEY,payload_cipher TEXT NOT NULL);`)
    const auth = await createCustomerAuth(db)
    const token = await auth.issue({ id: 'customer_pg', phone: '13800000001' }, { headers: {} })
    const req = request('/api/transfers', {}, token)
    const reloaded = await createCustomerAuth(db)
    assert.deepEqual(await reloaded.identity(req), { id: 'customer_pg' })
    const other = await auth.issue({ id: 'customer_pg', phone: '13800000001' }, { headers: {} })
    await auth.revokeOthers(req)
    await assert.rejects(reloaded.identity(request('/api/accounts', undefined, other)), { code: 'UNAUTHORIZED' })
    await auth.phoneChanged('13800000001', '13900000001')
    assert.equal(await auth.resolve(req, 'profile'), '13900000001')
    const overview = await auth.security(req, { score: 90 })
    assert.equal(overview.devices.filter(row => row.active).length, 1)
    assert(overview.logs.length >= 3)

    const security = await createSecurityGateway(db, auth)
    const sent = await security.run(req, () => Promise.allSettled([security.sendSms('13800000002'), security.sendSms('13800000002')]))
    assert.equal(sent.filter(item => item.status === 'fulfilled').length, 1)
    assert.equal(sent.find(item => item.status === 'rejected').reason.code, 'SMS_TOO_FREQUENT')
    const code = sent.find(item => item.status === 'fulfilled').value.demoCode
    const verified = await Promise.allSettled([security.verifySms('13800000002', code), security.verifySms('13800000002', code)])
    assert.equal(verified.filter(item => item.status === 'fulfilled').length, 1)
    assert.equal(verified.find(item => item.status === 'rejected').reason.code, 'SMS_NOT_SENT')
    const identity = await security.run(req, () => security.issueIdentityTicket('face'))
    const consumed = await security.run(req, () => Promise.allSettled([security.consumeIdentityTicket(identity.ticket), security.consumeIdentityTicket(identity.ticket)]))
    assert.equal(consumed.filter(item => item.status === 'fulfilled').length, 1)
    assert.equal(consumed.find(item => item.status === 'rejected').reason.code, 'IDENTITY_REQUIRED')

    const retryReq = request('/api/transfers', {}, token)
    retryReq.headers['idempotency-key'] = 'pg-retry-key-0001'
    let executed = 0
    const payment = () => db.transaction(async () => {
      const hit = await security.idempotent(retryReq, 'submitTransfer', { amount: 100 })
      if (hit) return hit.value
      await tick()
      executed += 1
      const result = { id: 'payment_once' }
      await security.idempotent(retryReq, 'submitTransfer', { amount: 100 }, result)
      return result
    })
    assert.deepEqual(await Promise.all([payment(), payment()]), [{ id: 'payment_once' }, { id: 'payment_once' }])
    assert.equal(executed, 1)
    await assert.rejects(db.transaction(() => security.idempotent(retryReq, 'submitTransfer', { amount: 101 })), { code: 'IDEMPOTENCY_CONFLICT' })
    // The payment PIN is a credential, not a business field. It must not enter the
    // stored fingerprint, because a deterministic six-digit PIN digest is guessable.
    const pinReq = request('/api/transfers', {}, token)
    pinReq.headers['idempotency-key'] = 'pg-pin-key-0001'
    await db.transaction(() => security.idempotent(pinReq, 'submitTransfer', { amount: 100, paymentPassword: '888888' }, { id: 'pin_once' }))
    const pinReplay = await db.transaction(() => security.idempotent(pinReq, 'submitTransfer', { amount: 100, paymentPassword: '000000' }))
    assert.deepEqual(pinReplay, { hit: true, value: { id: 'pin_once' } }, 'a retry that only changes the PIN is the same request')
    const pinRow = await db.prepare('SELECT request_hash FROM bank_idempotency WHERE owner_id=? AND key=?').get('customer_pg', 'pg-pin-key-0001')
    const plainRow = await db.prepare('SELECT request_hash FROM bank_idempotency WHERE owner_id=? AND key=?').get('customer_pg', 'pg-retry-key-0001')
    assert.equal(pinRow.request_hash, plainRow.request_hash, 'the request fingerprint must not depend on the PIN')

    const support = await createCustomerSupportApi({ db, auth })
    const post = async (path, body) => {
      const res = response()
      assert.equal(await support.handle(request(path, body, token), res, new URL(path, 'http://localhost')), true)
      return res
    }
    const body = { requestId: 'support_create_0001', reason: '核对账单' }
    const created = await Promise.all([post('/api/support/tickets', body), post('/api/support/tickets', body)])
    assert.deepEqual(created.map(row => row.status).sort(), [200, 201])
    const ticketId = created[0].body.ticketId
    assert.equal(created[1].body.ticketId, ticketId)
    assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM tickets').get()).count, 1)
    await assert.rejects(post('/api/support/tickets', { ...body, reason: '更改内容' }), { code: 'REQUEST_CONFLICT' })
    const reply = { requestId: 'support_reply_0001', text: '请核对这一笔' }
    const replies = await Promise.all([post(`/api/support/tickets/${ticketId}/messages`, reply), post(`/api/support/tickets/${ticketId}/messages`, reply)])
    assert.equal(replies[0].body.messageId, replies[1].body.messageId)
    assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM ticket_messages').get()).count, 1)
    const detail = response(), path = `/api/support/tickets/${ticketId}`
    await support.handle(request(path, undefined, token, 'GET'), detail, new URL(path, 'http://localhost'))
    assert.equal(detail.body.messages.length, 1)
    await db.prepare("UPDATE tickets SET status='resolved' WHERE id=?").run(ticketId)
    await assert.rejects(post(`/api/support/tickets/${ticketId}/messages`, { requestId: 'support_reply_0002', text: '再次留言' }), { code: 'TICKET_CLOSED' })
    assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM ticket_messages').get()).count, 1)
    await auth.logout(req)
    await assert.rejects(auth.identity(req), { code: 'UNAUTHORIZED' })
  } finally {
    if (previousMode === undefined) delete process.env.BANK_INTEGRATION_MODE
    else process.env.BANK_INTEGRATION_MODE = previousMode
    if (previousMigrate === undefined) delete process.env.BANK_AUTO_MIGRATE
    else process.env.BANK_AUTO_MIGRATE = previousMigrate
    await db.close()
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await admin.close()
  }
})
