import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'
import { hashPassword } from './passwords.mjs'
import { createStaffApi } from './staff-api.mjs'

const password = 'StaffTest!123'
const digest = hashPassword(password)
const tick = () => new Promise(resolve => setImmediate(resolve))

// Exercise the real route/auth/transaction boundary with deliberately async I/O.
// PostgreSQL persistence of the customer's freeze is tested by the banking suite.
async function fixture() {
  const employees = ['csr', 'supervisor', 'ops'].map(role => ({ id: `staff_${role}`, name: role, role, password_hash: digest }))
  const state = { frozen: true, audits: [], requests: new Map(), calls: [], failAudit: false,
    ticket: { id: 'ticket_1', customer_id: 'customer_1', status: 'processing', assignee_id: 'staff_csr' } }
  const db = {
    async exec() { await tick() },
    async transaction(work) {
      const before = structuredClone({ frozen: state.frozen, audits: state.audits, requests: state.requests })
      try { return await work() }
      catch (error) { Object.assign(state, before); throw error }
    },
    prepare(sql) {
      const statement = sql.replace(/\s+/g, ' ').trim()
      return {
        async get(...args) {
          await tick()
          if (statement.includes('information_schema.columns')) return { n: 1 }
          if (statement.startsWith('SELECT COUNT(*) AS n FROM staff_users')) return { n: 3 }
          if (statement.startsWith('SELECT 1 FROM staff_users')) return { exists: 1 }
          if (statement.startsWith('SELECT 1 AS x FROM staff_settings')) return { x: 1 }
          if (statement.includes('FROM staff_login_attempts')) return undefined
          if (statement.startsWith('SELECT * FROM staff_users')) return employees.find(row => row.name === args[0])
          if (statement.startsWith('SELECT pg_advisory_xact_lock')) return {}
          if (statement.startsWith('SELECT * FROM staff_write_requests')) return state.requests.get(`${args[0]}:${args[1]}`)
          if (statement.startsWith('SELECT * FROM tickets')) return args[0] === state.ticket.id ? state.ticket : undefined
          throw Error(`Unexpected read: ${statement}`)
        },
        async run(...args) {
          await tick()
          if (statement.startsWith('DELETE FROM staff_login_attempts')) return { changes: 1 }
          if (statement.startsWith('INSERT INTO audit_logs')) {
            if (state.failAudit) throw Error('Audit persistence failed')
            state.audits.push({ actorId: args[2], action: args[3], targetId: args[5], reason: args[8] })
          } else if (statement.startsWith('INSERT INTO staff_write_requests')) {
            const [staff, id, fingerprint, status, response] = args
            state.requests.set(`${staff}:${id}`, { fingerprint, status, response })
          } else throw Error(`Unexpected write: ${statement}`)
          return { changes: 1 }
        },
      }
    },
  }
  const api = await createStaffApi({ db, bankHooks: {
    runStaffUnitOfWork: work => db.transaction(work),
    async performCustomerAction(input) {
      await tick()
      assert.deepEqual(input, { customerId: 'customer_1', action: 'unfreezeAccount', payload: {} })
      if (!state.frozen) throw Object.assign(Error('账号未冻结'), { status: 409, code: 'ACCOUNT_NOT_FROZEN' })
      state.calls.push(input)
      state.frozen = false
    },
  } })
  const tokens = Object.fromEntries(await Promise.all(employees.map(async row => [row.role, (await api.auth.login(row.name, password)).token])))
  async function call({ role = 'csr', body = {}, customerId = 'customer_1', requestId = randomUUID(), agent = false } = {}) {
    const path = `/staff-api/customers/${customerId}/actions/unfreezeAccount`
    const data = { ticketId: 'ticket_1', verificationMethod: 'phone', verificationResult: 'passed', reason: '已核实本人申请解冻', ...body }
    const headers = { 'x-staff-request-id': requestId,
      ...(tokens[role] ? { authorization: `Bearer ${tokens[role]}` } : {}),
      ...(agent ? { 'x-agent-token': process.env.STAFF_AGENT_TOKEN ?? 'demo-agent-token' } : {}) }
    const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(data))]), { headers, method: 'POST', url: path, socket: { remoteAddress: '127.0.0.1' } })
    const res = { writableEnded: false, writeHead(status) { this.status = status }, end(raw) { this.body = JSON.parse(raw); this.writableEnded = true } }
    await api.handle(req, res, new URL(path, 'http://localhost'))
    return res
  }
  return { state, call }
}

test('account unfreeze requires a business staff session, linked active ticket and identity verification', async t => {
  const { state, call } = await fixture()
  const denied = [
    ['anonymous', { role: 'none' }, 401, 'UNAUTHORIZED'],
    ['operations', { role: 'ops' }, 403, 'FORBIDDEN'],
    ['Agent channel', { role: 'none', agent: true }, 401, 'UNAUTHORIZED'],
    ['another customer', { customerId: 'customer_2' }, 403, 'TICKET_CUSTOMER_MISMATCH'],
    ['missing ticket', { body: { ticketId: 'absent' } }, 403, 'TICKET_CUSTOMER_MISMATCH'],
    ['failed verification', { body: { verificationResult: 'failed' } }, 403, 'VERIFICATION_REQUIRED'],
    ['invalid verification method', { body: { verificationMethod: 'none' } }, 403, 'VERIFICATION_REQUIRED'],
    ['blank reason', { body: { reason: '   ' } }, 400, 'REASON_REQUIRED'],
  ]
  for (const [label, options, status, code] of denied) await t.test(label, async () => {
    const res = await call(options)
    assert.equal(res.status, status)
    assert.equal(res.body.code, code)
    assert.equal(state.frozen, true)
    assert.equal(state.calls.length, 0)
    assert.equal(state.audits.length, 0)
  })
  state.ticket.status = 'resolved'
  assert.equal((await call()).body.code, 'TICKET_CLOSED')
  state.ticket.status = 'processing'
  state.ticket.assignee_id = 'staff_other'
  assert.equal((await call()).body.code, 'NOT_ASSIGNEE')
  assert.equal(state.frozen, true)
  assert.equal(state.calls.length, 0)
})

test('staff unfreeze waits for audit, supports supervisors and replays without repeating the mutation', async () => {
  const { state, call } = await fixture()
  const requestId = randomUUID()
  const result = await call({ requestId })
  assert.equal(result.status, 200)
  assert.deepEqual(result.body, { ok: true })
  assert.equal(state.frozen, false)
  assert.deepEqual(state.audits, [{ actorId: 'staff_csr', action: 'customer.action.unfreezeAccount', targetId: 'customer_1', reason: '工单 ticket_1 · phone 核验通过 · 已核实本人申请解冻' }])
  assert.equal((await call({ requestId })).status, 200)
  assert.equal(state.calls.length, 1)
  assert.equal(state.audits.length, 1)
  state.frozen = true
  state.ticket.assignee_id = 'staff_other'
  assert.equal((await call({ role: 'supervisor' })).status, 200)
  assert.equal(state.frozen, false)
  assert.equal(state.audits.at(-1).actorId, 'staff_supervisor')
})

test('audit failure rolls back unfreeze and does not consume the retry request', async () => {
  const { state, call } = await fixture()
  const requestId = randomUUID()
  state.failAudit = true
  assert.equal((await call({ requestId })).status, 500)
  assert.equal(state.frozen, true)
  assert.equal(state.audits.length, 0)
  assert.equal(state.requests.size, 0)
  state.failAudit = false
  assert.equal((await call({ requestId })).status, 200)
  assert.equal(state.frozen, false)
  assert.equal(state.audits.length, 1)
})
