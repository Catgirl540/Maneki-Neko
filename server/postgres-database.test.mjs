import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { AsyncResource } from 'node:async_hooks'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CURRENT_KEY, PROFILES_KEY, CORE_SCHEMA_VERSION, openBankDatabase, reconcileDatabase } from './database.mjs'
import { createPgClient, postgresParameters } from './pg-client.mjs'
import { createDataCipher } from './database-crypto.mjs'

const url = process.env.BANK_TEST_DATABASE_URL
process.env.BANK_DATA_KEY ??= Buffer.alloc(32, 39).toString('base64')
const options = { skip: !url, concurrency: false }
const clone = value => JSON.parse(JSON.stringify(value))
const sample = (id = 'u1', phone = '13000000001', balance = 100_000) => ({
  schema: 18, user: { id, phone, name: '数据库测试客户', avatarInitial: '测' },
  accounts: [{ id: 'a1', accountNo: `${phone}001`, label: '人民币账户', kind: 'current', currency: 'CNY', balance, available: balance, interestRate: 0.01 }],
  transactions: [{ id: 't1', accountId: 'a1', direction: 'in', amount: 1_000, signedAmount: 1_000, counterparty: '历史导入', memo: '历史', category: 'salary', status: 'success', createdAt: '2026-01-01T00:00:00.000Z', detail: { referenceNo: 'TEST-REF' } }],
  cards: [{ id: 'c1', accountId: 'a1', productName: '测试卡', last4: '1234', cardholder: 'TEST', expiry: '12/29', theme: 'ink', network: 'visa', kind: 'debit', status: 'active', onlinePayment: true, overseasPayment: false, dailyLimit: 5_000_000 }],
  cardSecrets: { c1: { pan: '4026889999991234', cvv: '123' } },
  payees: [], autoDebits: [], fpsRegistrations: [], passwordDigest: 'secret-password-digest', payPassword: 'private-pin',
  security: { devices: [] }, identity: { idNumber: 'private-identity' }, holdings: [], futureExtension: { preserved: true },
})
function stage(bank, profile) { bank.storage.setItemsAtomically([[CURRENT_KEY, JSON.stringify(profile)], [PROFILES_KEY, JSON.stringify({ [profile.user.phone]: profile })]]) }
async function seed(bank, profile = sample()) { stage(bank, profile); await bank.storage.flush(); return profile }
const count = async (bank, table) => (await bank.db.query(`SELECT COUNT(*) n FROM ${table}`)).rows[0].n
async function scratch(work) {
  const schema = `bank_test_${randomUUID().replaceAll('-', '')}`, admin = createPgClient(url)
  let bank
  try {
    await admin.query(`CREATE SCHEMA ${schema}`)
    bank = await openBankDatabase(url, { schema, autoMigrate: true })
    return await work(bank, schema, admin)
  } finally {
    if (bank) await bank.close()
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
    await admin.close()
  }
}

test('PostgreSQL round trip encrypts customer domains and uses safe exact integers', options, () => scratch(async bank => {
  const profile = await seed(bank)
  assert.deepEqual(JSON.parse(bank.storage.getItem(CURRENT_KEY)), profile)
  assert.equal((await bank.db.prepare('SELECT balance_cents FROM bank_accounts').get()).balance_cents, 100_000)
  const secret = (await bank.db.query('SELECT payload_cipher FROM customer_credentials')).rows[0].payload_cipher
  assert.ok(secret.startsWith('aesgcm:v1:')); assert.equal(secret.includes('private-pin'), false)
  const preview = (await bank.db.query('SELECT value_json FROM app_storage WHERE key=$1', [PROFILES_KEY])).rows[0].value_json
  assert.equal(preview.includes('accounts'), false)
  assert.equal((await bank.db.query('SELECT origin FROM bank_accounts')).rows[0].origin, 'legacy_demo')
  assert.equal((await reconcileDatabase(bank.db)).ok, true)
  assert.equal(postgresParameters("SELECT '?' AS literal, ? AS bound -- ?\n, $$?$$ AS body"), "SELECT '?' AS literal, $1 AS bound -- ?\n, $$?$$ AS body")
  assert.equal((await bank.db.query('SELECT $1::bigint AS epoch', [1_790_000_000_000])).rows[0].epoch, 1_790_000_000_000)
}))

test('repeated snapshots keep sequence identity and post balance deltas once', options, () => scratch(async bank => {
  const profile = await seed(bank), first = await bank.db.prepare('SELECT seq FROM bank_accounts').get()
  const entries = await count(bank, 'journal_entries')
  stage(bank, profile); await bank.storage.flush(); assert.equal(await count(bank, 'journal_entries'), entries)
  profile.accounts[0].balance -= 5_000; profile.accounts[0].available -= 5_000
  stage(bank, profile); await bank.storage.flush()
  assert.equal(await count(bank, 'journal_batches'), 2)
  assert.deepEqual(await bank.db.prepare('SELECT seq FROM bank_accounts').get(), first)
  profile.accounts[0].available -= 100; stage(bank, profile); await bank.storage.flush()
  assert.equal(await count(bank, 'journal_batches'), 2)
  assert.equal((await reconcileDatabase(bank.db)).ok, true)
}))

test('unit of work commits audit SQL and final profile together and rolls both back', options, () => scratch(async bank => {
  const profile = await seed(bank)
  await bank.db.exec('CREATE TABLE approval_probe(id TEXT PRIMARY KEY)')
  await bank.storage.beginUnitOfWork()
  await bank.db.prepare('INSERT INTO approval_probe VALUES (?)').run('rollback')
  profile.accounts[0].balance -= 1_000; profile.accounts[0].available -= 1_000; stage(bank, profile)
  assert.equal(JSON.parse(bank.storage.getItem(CURRENT_KEY)).accounts[0].balance, 99_000)
  await bank.storage.rollbackUnitOfWork()
  assert.equal(await count(bank, 'approval_probe'), 0)
  assert.equal(JSON.parse(bank.storage.getItem(CURRENT_KEY)).accounts[0].balance, 100_000)
  await bank.storage.beginUnitOfWork({ requestId: 'atomic-audit-test' })
  await bank.db.prepare('INSERT INTO approval_probe VALUES (?)').run('commit')
  stage(bank, profile)
  await bank.storage.commitUnitOfWork()
  assert.equal(await count(bank, 'approval_probe'), 1)
  assert.equal((await bank.db.query("SELECT request_id FROM journal_batches WHERE kind='balance-change'")).rows[0].request_id, 'atomic-audit-test')
}))

test('two processes refresh after the PostgreSQL advisory lock without lost updates', options, () => scratch(async (bank, schema) => {
  await seed(bank)
  await bank.db.exec('CREATE TABLE worker_probe(id TEXT PRIMARY KEY)')
  // A worker born outside the legacy request must never join its manual client.
  const worker = new AsyncResource('independent-banking-worker')
  const second = await openBankDatabase(url, { schema, autoMigrate: false })
  try {
    await bank.storage.beginUnitOfWork()
    const parentPid = (await bank.db.query('SELECT pg_backend_pid() pid')).rows[0].pid
    const workerPid = await worker.runInAsyncScope(() => bank.db.transaction(async db => {
      await db.exec("INSERT INTO worker_probe VALUES ('independent')")
      return (await db.query('SELECT pg_backend_pid() pid')).rows[0].pid
    }))
    assert.notEqual(workerPid, parentPid)
    let secondStarted = false
    const waiting = second.storage.beginUnitOfWork().then(() => { secondStarted = true })
    await new Promise(resolve => setTimeout(resolve, 30))
    assert.equal(secondStarted, false)
    const firstProfile = JSON.parse(bank.storage.getItem(CURRENT_KEY))
    firstProfile.accounts[0].balance -= 1_000; firstProfile.accounts[0].available -= 1_000; stage(bank, firstProfile)
    await bank.storage.commitUnitOfWork(); await waiting
    const secondProfile = JSON.parse(second.storage.getItem(CURRENT_KEY))
    assert.equal(secondProfile.accounts[0].balance, 99_000)
    secondProfile.accounts[0].balance -= 2_000; secondProfile.accounts[0].available -= 2_000; stage(second, secondProfile)
    await second.storage.commitUnitOfWork()
    assert.equal((await bank.db.query('SELECT balance_cents FROM bank_accounts')).rows[0].balance_cents, 97_000)
    assert.equal((await reconcileDatabase(bank.db)).ok, true)
  } finally { worker.emitDestroy(); await second.close() }
}))

test('invalid money and references roll back a complete multi-customer flush', options, () => scratch(async bank => {
  const original = await seed(bank)
  for (const mutate of [p => { p.accounts[0].balance = 1.5 }, p => { p.accounts[0].balance = Number.MAX_SAFE_INTEGER + 1 }, p => { p.accounts[0].available = 100_001 }, p => { p.transactions[0].accountId = 'missing' }]) {
    const profile = clone(original); mutate(profile); stage(bank, profile)
    await assert.rejects(bank.storage.flush())
    assert.deepEqual(JSON.parse(bank.storage.getItem(CURRENT_KEY)), original)
    assert.equal(await count(bank, 'journal_batches'), 1)
  }
  const second = sample('u2', '13000000002'); second.accounts[0].balance = -1
  bank.storage.setItem(PROFILES_KEY, JSON.stringify({ [original.user.phone]: original, [second.user.phone]: second }))
  await assert.rejects(bank.storage.flush()); assert.equal(await count(bank, 'customers'), 1)
}))

test('SQL guards reject unbalanced postings, changed history and posted appends', options, () => scratch(async bank => {
  await seed(bank)
  const entry = (await bank.db.query('SELECT * FROM journal_entries LIMIT 1')).rows[0]
  for (const sql of ['UPDATE journal_entries SET debit_cents=1', 'DELETE FROM journal_entries', 'DELETE FROM journal_batches', 'TRUNCATE journal_entries', "UPDATE bank_transactions SET amount_cents=1001,signed_amount_cents=1001", "UPDATE bank_accounts SET currency='HKD'"]) await assert.rejects(bank.db.exec(sql))
  await assert.rejects(bank.db.query('INSERT INTO journal_entries(batch_id,ledger_account_id,currency,debit_cents,credit_cents) VALUES($1,$2,$3,1,0)', [entry.batch_id, entry.ledger_account_id, entry.currency]))
  await assert.rejects(bank.db.transaction(async db => {
    await db.exec("INSERT INTO journal_batches(id,kind,source,request_id) VALUES ('bad','opening','test','bad')")
    await db.query("INSERT INTO journal_entries(batch_id,ledger_account_id,currency,debit_cents,credit_cents) VALUES('bad',$1,'CNY',1,0)", [entry.ledger_account_id])
    await db.exec("UPDATE journal_batches SET state='posted' WHERE id='bad'")
  }))
  assert.equal((await reconcileDatabase(bank.db)).ok, true)
}))

test('commit constraints reject balance tampering and unposted journals; runtime refuses DDL', options, () => scratch(async (bank, schema, admin) => {
  await seed(bank)
  await assert.rejects(bank.db.transaction(db => db.exec('UPDATE bank_accounts SET balance_cents=balance_cents+1')))
  await assert.rejects(bank.db.transaction(db => db.exec("INSERT INTO journal_batches(id,kind,source,request_id) VALUES ('draft','opening','test','draft')")))
  await assert.rejects(bank.db.transaction(async db => {
    try { await db.query('SELECT 1/0') } catch {}
    return 'must not report a committed result'
  }), /rolled back an aborted transaction/)
  assert.equal((await bank.db.query('SELECT balance_cents FROM bank_accounts')).rows[0].balance_cents, 100_000)
  const empty = `${schema}_empty`
  await admin.query(`CREATE SCHEMA ${empty}`)
  try { await assert.rejects(openBankDatabase(url, { schema: empty, autoMigrate: false }), /owner bootstrap/) }
  finally { await admin.query(`DROP SCHEMA ${empty} CASCADE`) }
  assert.equal((await bank.db.query('SELECT MAX(version) n FROM bank_schema_migrations')).rows[0].n, CORE_SCHEMA_VERSION)
}))

test('one-time SQLite import retains balances, journal ids, encrypted data and audit rows', options, async () => {
  const { DatabaseSync } = await import('node:sqlite')
  const { migrateSqliteToPostgres } = await import('./migrate-sqlite-to-postgres.mjs')
  const directory = mkdtempSync(join(tmpdir(), 'bank-pg-migration-')), path = join(directory, 'source.sqlite')
  const source = new DatabaseSync(path), profile = sample(), cipher = createDataCipher(':memory:')
  source.exec(readFileSync(new URL('./bank-schema.sql', import.meta.url), 'utf8'))
  source.prepare('INSERT INTO customers(id,phone,name,user_cipher,profile_fields_json) VALUES (?,?,?,?,?)').run(profile.user.id, profile.user.phone, profile.user.name, cipher.seal(profile.user, 'customers:u1'), JSON.stringify(['user','accounts','transactions','cards','cardSecrets','payees','autoDebits','fpsRegistrations']))
  source.prepare('INSERT INTO bank_accounts(owner_id,id,account_no,label,currency,kind,balance_cents,available_cents,ordinal,payload_cipher) VALUES (?,?,?,?,?,?,?,?,?,?)').run('u1','a1',profile.accounts[0].accountNo,'人民币账户','CNY','current',100_000,100_000,0,cipher.seal({},'account:u1:a1'))
  source.exec("INSERT INTO ledger_accounts(id,code,name,currency,kind,owner_id,account_id) VALUES ('deposit:u1:a1','2101','legacy','CNY','liability','u1','a1'); INSERT INTO ledger_accounts(id,code,name,currency,kind) VALUES ('opening:CNY','3101','legacy','CNY','equity'); INSERT INTO journal_batches(id,kind,source,request_id) VALUES ('batch1','opening','legacy','legacy'); INSERT INTO journal_entries(id,batch_id,ledger_account_id,currency,debit_cents,credit_cents) VALUES (41,'batch1','deposit:u1:a1','CNY',0,100000),(42,'batch1','opening:CNY','CNY',100000,0); UPDATE journal_batches SET state='posted' WHERE id='batch1'; CREATE TABLE legacy_audit(id TEXT PRIMARY KEY,event TEXT NOT NULL DEFAULT 'retained' CHECK(event IN ('retained','verified'))); CREATE UNIQUE INDEX audit_event_unique ON legacy_audit(event); INSERT INTO legacy_audit VALUES ('audit1','retained');")
  for (const [key, member] of [[CURRENT_KEY,''],[PROFILES_KEY,profile.user.phone]]) {
    source.prepare('INSERT INTO app_storage(key,value_json) VALUES (?,?)').run(key, '{}')
    source.prepare('INSERT INTO profile_bindings(storage_key,member_key,owner_id,ordinal) VALUES (?,?,?,0)').run(key, member, 'u1')
  }
  source.close()
  try { await scratch(async (bank, schema) => {
    const result = await migrateSqliteToPostgres({ sourcePath: path, connectionString: url, schema })
    assert.equal(result.balanceVerified, true); assert.equal(result.accounts, 1); assert.equal(result.journalEntries, 2)
    await bank.storage.refresh()
    assert.equal(JSON.parse(bank.storage.getItem(CURRENT_KEY)).accounts[0].balance, 100_000)
    assert.equal((await bank.db.query('SELECT MAX(id) n FROM journal_entries')).rows[0].n, 42)
    assert.equal((await bank.db.query('SELECT event FROM legacy_audit')).rows[0].event, 'retained')
    await assert.rejects(bank.db.query("INSERT INTO legacy_audit(id,event) VALUES ('bad','invalid')"))
    await assert.rejects(bank.db.query("INSERT INTO legacy_audit(id) VALUES ('duplicate-default')"))
    assert.equal((await reconcileDatabase(bank.db)).ok, true)
    await assert.rejects(migrateSqliteToPostgres({ sourcePath: path, connectionString: url, schema }), /Target must be empty/)
  }) } finally { rmSync(directory, { recursive: true, force: true }) }
})
