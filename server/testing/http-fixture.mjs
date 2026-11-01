import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createPgClient } from '../pg-client.mjs'
import { openBankDatabase, PROFILES_KEY, reconcileDatabase } from '../database.mjs'
import { ACCOUNT_OPENING_PLEDGE } from '../lib/account-opening.mjs'
import { routes } from '../api/contract.mjs'

// These fixtures reset only an explicitly named, disposable PostgreSQL database.
// They never read BANK_DATABASE_URL or the shared BANK_TEST_DATABASE_URL.
const testUrl = process.env.BANK_HTTP_TEST_DATABASE_URL
const testOptions = { skip: !testUrl, concurrency: false }
function dedicatedName(name) { return /^maneki_http_test(?:_[a-z0-9_]+)?$/.test(name) }
function verifyUrl() {
  let parsed
  try { parsed = new URL(testUrl) } catch { throw new Error('BANK_HTTP_TEST_DATABASE_URL must be a PostgreSQL test database URL') }
  const name = decodeURIComponent(parsed.pathname.slice(1))
  assert(['postgres:', 'postgresql:'].includes(parsed.protocol) && dedicatedName(name), 'HTTP fixture database name must be maneki_http_test or start with maneki_http_test_')
  return name
}
async function resetDatabase(db, expectedName) {
  const actual = (await db.query('SELECT current_database() AS name')).rows[0].name
  assert(actual === expectedName && dedicatedName(actual), 'refusing to reset a database outside the dedicated HTTP fixture')
  for (const schema of ['regulatory', 'accounting', 'banking', 'public']) await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
  await db.query('CREATE SCHEMA public')
}
async function bootstrap(env) {
  const child = spawn(process.execPath, [join(root, 'server/bootstrap-postgres.mjs')], { cwd: root, env, stdio: ['ignore','pipe','pipe'], windowsHide: true })
  let output = ''
  for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => { output = (output + bytes).slice(-12000) })
  const code = await new Promise((resolveExit, reject) => { child.once('error', reject); child.once('exit', resolveExit) })
  assert.equal(code, 0, `PostgreSQL fixture bootstrap failed (exit ${code}): ${output.replaceAll(testUrl, '[test database]')}`)
}
const root = resolve(import.meta.dirname, '../..')
async function fixture({ production = false, mode = 'sandbox', reviewThreshold = 1000, holdSeconds = 5 } = {}) {
  const expectedName = verifyUrl()
  const temporaryRoot = resolve(tmpdir()), directory = mkdtempSync(join(temporaryRoot, 'banking-http-'))
  const inspection = createPgClient(testUrl, { schema: 'public' })
  const dataKey = randomBytes(32).toString('base64')
  const staffPasswords = Object.fromEntries(['王小明', '李主管', '运维人员'].map(name => [name, randomBytes(24).toString('base64url')]))
  let child, output = '', base, cleaned = false, startupError
  const call = async (path, { method = 'GET', token, body, key } = {}) => {
    const response = await fetch(base + path, {
      method, signal: AbortSignal.timeout(15000),
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(key ? { 'idempotency-key': key } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    return { status: response.status, body: await response.json() }
  }
  const database = work => work(inspection)
  async function editCustomer(customerId, edit) {
    const previousKey = process.env.BANK_DATA_KEY
    let connection
    try {
      process.env.BANK_DATA_KEY = dataKey
      connection = await openBankDatabase(testUrl, { schema: 'public', autoMigrate: false })
      await connection.storage.beginUnitOfWork({ requestId: `http-test-rename-${randomUUID()}` })
      const profiles = JSON.parse(connection.storage.getItem(PROFILES_KEY))
      const profile = Object.values(profiles).find(row => row.user.id === customerId)
      assert(profile, 'temporary customer must exist before rename')
      await edit(profile, connection, profiles)
      connection.storage.setItem(PROFILES_KEY, JSON.stringify(profiles))
      await connection.storage.commitUnitOfWork()
    } finally {
      await connection?.close()
      if (previousKey === undefined) delete process.env.BANK_DATA_KEY
      else process.env.BANK_DATA_KEY = previousKey
    }
  }
  const renameCustomer = (customerId, name) => editCustomer(customerId, profile => { profile.user.name = name })
  async function close() {
    if (cleaned) return
    cleaned = true
    try {
      if (child && child.exitCode === null && child.signalCode === null) {
        child.kill()
        let deadline
        await Promise.race([
          new Promise(resolveExit => child.once('exit', resolveExit)),
          new Promise(resolveTimeout => { deadline = setTimeout(resolveTimeout, 5000); deadline.unref() }),
        ])
        clearTimeout(deadline)
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL')
          await new Promise(resolveExit => child.once('exit', resolveExit))
        }
      }
      await resetDatabase(inspection, expectedName)
    } finally {
      await inspection.close()
      const cleanupTarget = resolve(directory)
      assert.equal(dirname(cleanupTarget), temporaryRoot, 'cleanup must remain in the test temporary root')
      assert(basename(cleanupTarget).startsWith('banking-http-'), 'cleanup requires the fixture directory prefix')
      rmSync(cleanupTarget, { recursive: true, force: true })
    }
  }
  try {
    await resetDatabase(inspection, expectedName)
    const probe = createServer()
    const port = await new Promise((resolvePort, reject) => {
      probe.once('error', reject)
      probe.listen(0, '127.0.0.1', () => resolvePort(probe.address().port))
    })
    await new Promise(resolveClose => probe.close(resolveClose))
    base = `http://127.0.0.1:${port}`
    const env = {
      ...process.env,
      NODE_ENV: production ? 'production' : 'test',
      BANK_HOST: '127.0.0.1', BANK_PORT: String(port),
      BANK_DATABASE_URL: testUrl, BANK_DATABASE_SCHEMA: 'public', BANK_AUTO_MIGRATE: 'false',
      BANK_BACKUP_DIR: join(directory, 'backups'), BANK_INTEGRATION_MODE: mode,
      BANK_TRANSFER_REVIEW_CENTS: String(reviewThreshold), BANK_TRANSFER_HOLD_SECONDS: String(holdSeconds),
      BANK_ALLOW_DEMO_SEED: 'true', BANK_DATA_KEY: dataKey,
      BANK_CSR_PASSWORD: staffPasswords['王小明'],
      BANK_SUPERVISOR_PASSWORD: staffPasswords['李主管'],
      BANK_OPS_PASSWORD: staffPasswords['运维人员'],
      STAFF_AGENT_TOKEN: randomBytes(32).toString('base64url'), BANK_WEBHOOK_ENABLED: 'false',
    }
    await bootstrap(env)
    async function start() {
      startupError = undefined
      child = spawn(process.execPath, [join(root, 'server/index.mjs')], {
        cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
      })
      child.once('error', error => { startupError = error })
      for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => { output = (output + bytes).slice(-12000) })
      let ready = false
      for (let i = 0; i < 180; i++) {
        if (startupError) throw startupError
        if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Bank fixture exited during startup:\n${output.replaceAll(testUrl, '[test database]')}`)
        try { ready = (await call('/health')).body.ok === true } catch {}
        if (ready) break
        await delay(100)
      }
      assert(ready, `Bank fixture did not become healthy:\n${output.replaceAll(testUrl, '[test database]')}`)
    }
    await start()
    async function restart() {
      assert(!cleaned && child?.exitCode === null && child?.signalCode === null, 'fixture must be running before restart')
      const previous = child
      let timeout
      const stopped = new Promise((resolveExit, reject) => {
        previous.once('exit', resolveExit)
        timeout = setTimeout(() => reject(new Error('Bank fixture did not stop for restart')), 10000)
      })
      previous.kill()
      try { await stopped } finally { clearTimeout(timeout) }
      // Same data key and database; no bootstrap, schema reset or reseeding.
      await start()
    }
    const staffLogin = async name => ok(await call('/staff-api/login', { method: 'POST', body: { name, password: staffPasswords[name] } }))
    const supervisorLogin = async () => (await staffLogin('李主管')).token
    return { base, call, database, close, restart, staffLogin, supervisorLogin, renameCustomer, editCustomer }
  } catch (error) { await close(); throw error }
}

const ok = (result, label = 'request') => {
  assert.equal(result.status, 200, `${label}: ${result.status} ${result.body.code ?? ''}`)
  return result.body
}
async function login(app, phone) {
  const sms = ok(await app.call('/api/auth/sms-code', { method: 'POST', body: { phone } }), 'send SMS')
  const body = { phone, password: '123456', smsCode: sms.demoCode }
  const user = ok(await app.call('/api/auth/login', { method: 'POST', body }), 'customer login')
  const accounts = ok(await app.call('/api/accounts', { token: user.token }))
  return { ...user, phone, accounts, loginBody: body }
}
async function register(app, phone, name) {
  const sms = ok(await app.call('/api/auth/sms-code', { method: 'POST', body: { phone } }))
  const face = ok(await app.call('/api/security/verify', { method: 'POST', body: { channel: 'face' } }))
  const user = ok(await app.call('/api/auth/register', {
    method: 'POST', body: { phone, holderName: name, password: 'TestBank!123', paymentPassword: '888888', smsCode: sms.demoCode,
      faceTicket: face.ticket, idNumber: '330106199203047234', pledge: ACCOUNT_OPENING_PLEDGE },
  }), 'customer registration')
  return { ...user, phone, accounts: ok(await app.call('/api/accounts', { token: user.token })) }
}
function transfer(sender, recipient, amount, memo = 'HTTP integration') {
  return { fromAccountId: sender.accounts[0].id, channel: 'bank', scope: 'domestic',
    payeeName: recipient.user.name, payeeAccountNo: recipient.accounts[0].accountNo,
    payeeBankCode: 'LCB', payeeBankRegion: 'CN', amount, memo }
}
async function account(app, customer, id = customer.accounts[0].id) {
  return ok(await app.call(`/api/accounts/${id}`, { token: customer.token }))
}
async function reconcile(app) {
  const result = await app.database(db => reconcileDatabase(db))
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.deepEqual(result.foreignKeys, [])
  assert.deepEqual(result.unbalancedBatches, [])
  assert.deepEqual(result.accountMismatches, [])
}
async function financialState(app) {
  return app.database(db => db.transaction(async () => {
    const accounts = (await db.query('SELECT owner_id,id,balance_cents,available_cents FROM bank_accounts ORDER BY owner_id,id')).rows
    const counts = []
    for (const table of ['bank_transactions', 'journal_batches', 'journal_entries', 'balance_changes', 'bank_idempotency']) {
      counts.push([table, (await db.query(`SELECT COUNT(*) AS n FROM ${table}`)).rows[0].n])
    }
    return { accounts, counts }
  }, { isolationLevel: 'REPEATABLE READ', readOnly: true }))
}

export { fixture, ok, login, register, transfer, account, reconcile, financialState, testOptions, routes }
