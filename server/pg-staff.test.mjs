import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { hashPassword } from './passwords.mjs'
import { createStaffApi, createStaffAuth, ensureStaffSchema, getTransferReviewCents, makeWriteAudit } from './staff-api.mjs'

const password = 'staff-async-test-password'
const employee = { id: 'test_supervisor', name: '测试主管', role: 'supervisor', password_hash: hashPassword(password) }
const afterTick = () => new Promise(resolve => setImmediate(resolve))

// Deliberately resolve every database operation on a later turn. These tests
// catch returning a success response before PostgreSQL reads or audit writes
// have completed; the integration suite validates the SQL against PostgreSQL.
function asyncDatabase() {
  const state = { events: [], approvals: new Map(), messages: [], rejectAudit: false }
  const db = {
    async exec(sql) { await afterTick(); state.schema = sql; state.events.push('schema') },
    prepare(sql) {
      const statement = sql.replace(/\s+/g, ' ').trim()
      return {
        async get(...params) {
          await afterTick()
          if (statement.includes('COUNT(*) AS n FROM staff_users')) return { n: '3' }
          if (statement.startsWith('SELECT 1 FROM staff_users')) return { exists: 1 }
          if (statement.startsWith('SELECT 1 AS x FROM staff_settings')) return { x: 1 }
          if (statement.startsWith('SELECT value FROM staff_settings')) return { value: '50000000' }
          if (statement.includes('FROM staff_login_attempts')) return undefined
          if (statement.startsWith('SELECT * FROM staff_users')) return params[0] === employee.name ? employee : undefined
          if (statement.includes("biz_payload::jsonb ->> 'transactionId'")) {
            return [...state.approvals.values()].find(row => row.status === 'pending' && JSON.parse(row.biz_payload).transactionId === params[0])
          }
          if (statement.startsWith('SELECT * FROM approvals WHERE id')) return state.approvals.get(params[0])
          if (statement.startsWith('SELECT id FROM tickets')) return { id: 'ticket_test' }
          throw new Error(`Unexpected get: ${statement}`)
        },
        async run(...params) {
          await afterTick()
          if (statement.startsWith('INSERT INTO audit_logs')) {
            if (state.rejectAudit) throw new Error('Audit database unavailable')
            state.events.push(`audit:${params[3]}`)
          } else if (statement.startsWith('DELETE FROM staff_login_attempts')) {
            state.events.push('auth:cleanup')
          } else if (statement.startsWith('INSERT INTO approvals')) {
            const [id, biz_payload, risk_summary, created_at] = params
            state.approvals.set(id, { id, biz_type: 'transfer', biz_payload, risk_summary, created_at, status: 'pending', execution_status: 'pending' })
            state.events.push('approval:insert')
          } else if (statement.startsWith('UPDATE approvals SET execution_error=')) {
            state.approvals.get(params[1]).execution_error = params[0]
            state.events.push('approval:error')
          } else if (statement.startsWith('UPDATE approvals SET status =')) {
            const [status, execution_status, execution_error, decided_by, reason, decided_at, id] = params
            const row = state.approvals.get(id)
            if (row.status !== 'pending') return { changes: 0 }
            Object.assign(row, { status, execution_status, execution_error, decided_by, reason, decided_at })
            state.events.push('approval:close')
          } else if (statement.startsWith('INSERT INTO ticket_messages')) {
            state.messages.push(params)
            state.events.push('ticket:message')
          } else if (statement.startsWith('UPDATE tickets SET updated_at')) {
            state.events.push('ticket:update')
          } else throw new Error(`Unexpected run: ${statement}`)
          return { changes: 1 }
        },
      }
    },
  }
  return { db, state }
}

function request(path, body, token) {
  return Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), {
    method: 'POST', url: path,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    socket: { remoteAddress: '127.0.0.1' },
  })
}
function response() {
  return {
    writableEnded: false,
    writeHead(status) { this.status = status },
    end(text) { this.body = JSON.parse(text); this.writableEnded = true },
  }
}

test('PostgreSQL staff auth and settings wait for asynchronous reads and writes', async () => {
  const { db, state } = asyncDatabase()
  const auth = await createStaffAuth(db)
  assert.deepEqual(state.events, ['auth:cleanup'])
  const login = await auth.login(employee.name, password)
  assert.equal(auth.resolve({ headers: { authorization: `Bearer ${login.token}` } }, { roles: ['supervisor'] }).actorId, employee.id)
  assert.equal(await getTransferReviewCents(db), 50_000_000)
  assert.equal(state.events.filter(event => event === 'auth:cleanup').length, 2)
  await makeWriteAudit(db)({ actorId: employee.id, action: 'test.write' })
  assert.equal(state.events.at(-1), 'audit:test.write')
})

test('held transfer callbacks finish approval, audit and ticket writes before returning', async () => {
  const { db, state } = asyncDatabase()
  const api = await createStaffApi({ db })
  assert.match(state.schema, /seq\s+BIGINT GENERATED BY DEFAULT AS IDENTITY/)
  assert.match(state.schema, /window_started_at BIGINT/)
  assert.doesNotMatch(state.schema, /sqlite_master|PRAGMA|rowid/i)
  const held = { customerId: 'customer_test', request: {}, result: { transactionId: 'transfer_test', amount: 60_000_000 } }
  const first = await api.createTransferApproval(held)
  const second = await api.createTransferApproval(held)
  assert.equal(second.approvalId, first.approvalId)
  assert.equal(state.approvals.size, 1)
  assert.equal(state.events.at(-1), 'audit:approval.create')
  await api.closeTransferApproval({ customerId: held.customerId, transactionId: held.result.transactionId, outcome: 'intercepted', reason: '疑似诈骗' })
  assert.equal(state.approvals.get(first.approvalId).status, 'intercepted')
  assert.equal(state.events.at(-1), 'ticket:update')
  assert.equal(state.messages.length, 1)
  assert.equal(await api.closeTransferApproval({ transactionId: held.result.transactionId, outcome: 'intercepted' }), null)
})

test('failed financial unit of work leaves approval pending and reports failure', async () => {
  const { db, state } = asyncDatabase()
  const api = await createStaffApi({ db, bankHooks: { settleHeldTransfer: async () => { await afterTick(); throw new Error('Bank settlement unavailable') } } })
  const { token } = await api.auth.login(employee.name, password)
  const { approvalId } = await api.createTransferApproval({ customerId: 'customer_test', request: {}, result: { transactionId: 'transfer_test', amount: 60_000_000 } })
  const path = `/staff-api/approvals/${approvalId}/decide`
  const res = response()
  await api.handle(request(path, { decision: 'settle' }, token), res, new URL(path, 'http://localhost'))
  assert.equal(res.status, 503)
  assert.equal(res.body.code, 'SETTLEMENT_FAILED')
  assert.equal(state.approvals.get(approvalId).status, 'pending')
  assert.match(state.approvals.get(approvalId).execution_error, /原指令仍待处理/)
  assert.equal(state.events.at(-1), 'audit:approval.error')
})

test('staff login cannot return a token when its required audit write fails', async () => {
  const { db, state } = asyncDatabase()
  const api = await createStaffApi({ db })
  const login = api.auth.login
  let issuedToken
  api.auth.login = async (...args) => {
    const session = await login(...args)
    issuedToken = session.token
    return session
  }
  state.rejectAudit = true
  const path = '/staff-api/login'
  const res = response()
  await api.handle(request(path, { name: employee.name, password }), res, new URL(path, 'http://localhost'))
  assert.equal(res.status, 500)
  assert.equal(res.body.token, undefined)
  assert.ok(issuedToken)
  assert.throws(() => api.auth.resolve({ headers: { authorization: `Bearer ${issuedToken}` } }), error => error.code === 'UNAUTHORIZED')
})

test('production runtime schema checks perform no DDL when auto migration is disabled', async () => {
  const { db, state } = asyncDatabase()
  const previous = process.env.BANK_AUTO_MIGRATE
  process.env.BANK_AUTO_MIGRATE = 'false'
  try {
    await ensureStaffSchema(db)
    assert.equal(state.schema, undefined)
    assert.deepEqual(state.events, [])
  } finally {
    if (previous === undefined) delete process.env.BANK_AUTO_MIGRATE
    else process.env.BANK_AUTO_MIGRATE = previous
  }
})
