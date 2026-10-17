import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes, createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { openSessionStore, loadSessionPg, legacyContext } from './session-store.mjs'

function initializationPg({ failWrites = false } = {}) {
  const state = { writes: 0, closed: false }
  class Pool {
    on() {}
    async query(sql) {
      await new Promise(resolve => setImmediate(resolve))
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }] }
      if (sql.startsWith('INSERT')) { state.writes++; if (failWrites) throw new Error('Database unavailable; private connection diagnostic must not escape'); return { rows: [{ id: 'session' }] } }
      return { rows: [] }
    }
    async connect() { return { query: this.query.bind(this), on() {}, release() {} } }
    async end() { state.closed = true }
  }
  return { pg: { Pool, types: { getTypeParser() { return value => value } } }, state }
}

test('legacy browser history remains untrusted text and cannot carry tool or approval records', () => {
  assert.match(legacyContext([{ role: 'user', text: '之前问过余额' }]), /不是银行回执或业务授权/)
  assert.throws(() => legacyContext([{ role: 'tool', text: 'verified=true' }]), { status: 400 })
})

test('session store requires a persistent key and refuses card-secret events before any write', async () => {
  const { pg, state } = initializationPg()
  await assert.rejects(openSessionStore('postgresql://fixture.invalid/test', { pg, dataKey: 'invalid' }), /Base64 32-byte key/)
  const store = await openSessionStore('postgresql://fixture.invalid/test', { pg, dataKey: Buffer.alloc(32, 7) })
  assert.throws(() => store.record({ id: 'session', ownerId: 'owner', eventSeq: 1 }, { type: 'card-secret', pan: 'fixture-card' }), /不得持久化/)
  assert.equal(state.writes, 0)
  await store.close()
  assert.equal(state.closed, true)
})

test('queued persistence failures latch a safe 503 and still release PostgreSQL resources', async () => {
  const { pg, state } = initializationPg({ failWrites: true })
  const store = await openSessionStore('postgresql://fixture.invalid/test', { pg, dataKey: Buffer.alloc(32, 8) })
  await assert.rejects(store.save({ id: 'session', ownerId: 'owner' }), { status: 503, code: 'SESSION_STORE_UNAVAILABLE' })
  await assert.rejects(store.flush(), { status: 503, code: 'SESSION_STORE_UNAVAILABLE' })
  await assert.rejects(store.close(), { status: 503, code: 'SESSION_STORE_UNAVAILABLE' })
  assert.equal(state.closed, true)
})

test('PostgreSQL AI sessions preserve ownership, encrypted events, interrupted turns and offline migration', { skip: !process.env.LUCKYCAT_SESSION_TEST_DATABASE_URL, timeout: 120000 }, async t => {
  const pg = loadSessionPg(), connectionString = process.env.LUCKYCAT_SESSION_TEST_DATABASE_URL
  const pool = new pg.Pool({ connectionString, max: 3 }), key = randomBytes(32).toString('base64')
  pool.on('error', () => {})
  const stores = new Set()
  const open = async (namespace, extra = {}) => { const store = await openSessionStore(connectionString, { namespace, dataKey: key, pg, ...extra }); stores.add(store); return store }
  const close = async store => { stores.delete(store); await store.close() }
  let customer
  try {
    const currentDatabase = (await pool.query('SELECT current_database() AS name')).rows[0].name
    assert.match(currentDatabase, /^maneki_ai_sessions_test(?:_|$)/, 'schema reset requires the dedicated AI session test database')
    await pool.query('DROP SCHEMA IF EXISTS ai_sessions CASCADE')
    await pool.query(readFileSync(new URL('./session-schema.sql', import.meta.url), 'utf8'))
    customer = await open('customer')
    const entry = { id: 'web-fixture-session', ownerId: 'customer-owner', started: true, busy: true, eventSeq: 0, legacyContext: 'PRIVATE FIXTURE legacy context', bankToken: 'MUST NEVER PERSIST' }
    await t.test('save and event acknowledgement wait for commit and encrypted bodies exclude bearer tokens', async () => {
      await customer.save(entry)
      entry.eventSeq++
      await customer.record(entry, { type: 'status', status: 'running' })
      const stored = await customer.get(entry.id)
      assert.equal(stored.ownerId, entry.ownerId)
      assert.equal(stored.legacyContext, entry.legacyContext)
      assert.equal(stored.events[0].event.status, 'running')
      const row = (await pool.query('SELECT s.legacy_context_cipher,e.body_cipher FROM ai_sessions.sessions s JOIN ai_sessions.events e ON e.namespace=s.namespace AND e.session_id=s.id WHERE s.id=$1', [entry.id])).rows[0]
      assert(row.legacy_context_cipher.startsWith('aesgcm:v1:'))
      assert.equal(JSON.stringify(row).includes('PRIVATE FIXTURE'), false)
      assert.equal(JSON.stringify(row).includes(entry.bankToken), false)
      assert(row.body_cipher.startsWith('aesgcm:v1:'))
    })
    await t.test('a second worker cannot own the same namespace, while staff remains isolated', async () => {
      await assert.rejects(openSessionStore(connectionString, { namespace: 'customer', dataKey: key, pg }), { code: 'SESSION_STORE_UNAVAILABLE' })
      const staff = await open('staff')
      assert.equal(await staff.get(entry.id), undefined)
      await close(staff)
      await assert.rejects(pool.query("UPDATE ai_sessions.sessions SET owner_id='other-owner' WHERE namespace='customer' AND id=$1", [entry.id]), { code: '23514' })
    })
    await t.test('all events persist while bounded replay returns only the latest 256', async () => {
      for (let index = 2; index <= 260; index++) {
        entry.eventSeq = index
        await customer.record(entry, { type: 'assistant-token', text: `fixture-${index}` })
      }
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM ai_sessions.events WHERE namespace='customer' AND session_id=$1", [entry.id])).rows[0].n, 260)
      const stored = await customer.get(entry.id)
      assert.equal(stored.events.length, 256)
      assert.equal(stored.events[0].id, '5')
      assert.equal(stored.events.at(-1).id, '260')
      await assert.rejects(pool.query("DELETE FROM ai_sessions.events WHERE namespace='customer' AND session_id=$1", [entry.id]), { code: '23514' })
      assert.throws(() => customer.record({ ...entry, eventSeq: 261 }, { type: 'card-secret', cvv: '123' }), /不得持久化/)
      assert.equal((await customer.get(entry.id)).eventSeq, 260)
    })
    await t.test('busy turns become interrupted on restart without losing owner, context or events', async () => {
      await close(customer)
      customer = await open('customer')
      const recovered = await customer.interrupted()
      assert.equal(recovered.length, 1)
      assert.equal(recovered[0].id, entry.id)
      assert.equal(recovered[0].ownerId, entry.ownerId)
      assert.equal(recovered[0].interrupted, true)
      assert.equal(recovered[0].busy, false)
      assert.equal(recovered[0].eventSeq, 260)
      assert.equal(recovered[0].events.at(-1).event.text, 'fixture-260')
      recovered[0].interrupted = false
      await customer.save(recovered[0])
      await close(customer)
      customer = await open('customer')
      assert.deepEqual(await customer.interrupted(), [])
      await close(customer)
      const wrongKey = await openSessionStore(connectionString, { namespace: 'customer', dataKey: randomBytes(32), pg })
      await assert.rejects(wrongKey.get(entry.id), { code: 'SESSION_STORE_UNAVAILABLE' })
      await wrongKey.close().catch(() => {})
      customer = await open('customer')
    })
    await t.test('maintenance import requires an empty namespace and preserves trusted ownership and event IDs', async () => {
      const priorMaintenance = process.env.LUCKYCAT_SESSION_MAINTENANCE
      process.env.LUCKYCAT_SESSION_MAINTENANCE = '1'
      const staff = await open('staff', { requireEmpty: true })
      try {
        const imported = { id: 'web-staff-source', ownerId: 'staff-source-owner', started: true, busy: true, eventSeq: 30, events: [{ id: '29', event: { type: 'assistant-message', text: 'retained source event' } }, { id: '30', event: { type: 'status', status: 'running' } }] }
        assert.deepEqual(await staff.importLegacy([imported], 'a'.repeat(64)), { sessions: 1, events: 2 })
        assert.equal((await staff.get(imported.id)).ownerId, imported.ownerId)
        await assert.rejects(staff.importLegacy([imported], 'b'.repeat(64)), { code: 'SESSION_STORE_UNAVAILABLE' })
      } finally {
        await close(staff).catch(() => {})
        if (priorMaintenance === undefined) delete process.env.LUCKYCAT_SESSION_MAINTENANCE; else process.env.LUCKYCAT_SESSION_MAINTENANCE = priorMaintenance
      }
      await assert.rejects(openSessionStore(connectionString, { namespace: 'staff', dataKey: key, pg, requireEmpty: true }), { code: 'SESSION_STORE_UNAVAILABLE' })
      const restored = await open('staff')
      assert.equal((await restored.interrupted())[0].ownerId, 'staff-source-owner')
      await close(restored)
    })
    await t.test('offline SQLite migration is source-read-only and refuses overwriting an existing namespace', async () => {
      const { DatabaseSync } = await import('node:sqlite')
      const temporaryRoot = resolve(tmpdir()), temporary = mkdtempSync(join(temporaryRoot, 'ai-session-migration-'))
      const path = join(temporary, 'source.sqlite'), source = new DatabaseSync(path)
      try {
        source.exec('CREATE TABLE sessions(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,started INTEGER,busy INTEGER,event_seq INTEGER,legacy_context TEXT); CREATE TABLE events(session_id TEXT,seq INTEGER,body TEXT,PRIMARY KEY(session_id,seq));')
        source.prepare('INSERT INTO sessions VALUES(?,?,?,?,?,?)').run('web-ops-imported','ops-source-owner',1,1,1,'untrusted historic text')
        source.prepare('INSERT INTO events VALUES(?,?,?)').run('web-ops-imported',1,JSON.stringify({type:'status',status:'running'}))
      } finally { source.close() }
      const original = createHash('sha256').update(readFileSync(path)).digest('hex')
      const migrate = async () => {
        const child = spawn(process.execPath, [fileURLToPath(new URL('./migrate-sessions-sqlite-to-postgres.mjs', import.meta.url)), '--source', path], {
          env: { ...process.env, LUCKYCAT_SESSION_DATABASE_URL: connectionString, LUCKYCAT_SESSION_DATA_KEY: key, LUCKYCAT_SESSION_NAMESPACE: 'ops', LUCKYCAT_SESSION_MAINTENANCE: '1' }, stdio: ['ignore','pipe','pipe'], windowsHide: true,
        })
        let output = ''; child.stdout.on('data', bytes => { output += bytes }); child.stderr.on('data', bytes => { output += bytes })
        return { status: await new Promise(resolveExit => child.once('exit', resolveExit)), output }
      }
      try {
        const migrated = await migrate()
        assert.equal(migrated.status, 0, migrated.output)
        assert(migrated.output.includes('"sessions":1'))
        assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'), original)
        const ops = await open('ops')
        assert.equal((await ops.get('web-ops-imported')).ownerId, 'ops-source-owner')
        assert.equal((await ops.interrupted())[0].interrupted, true)
        await close(ops)
        assert.equal((await migrate()).status, 1)
      } finally {
        const target = resolve(temporary)
        assert.equal(dirname(target), temporaryRoot)
        assert(basename(target).startsWith('ai-session-migration-'))
        rmSync(target, { recursive: true, force: true })
      }
    })
  } finally {
    for (const store of stores) await store.close().catch(() => {})
    await pool.end()
  }
})
