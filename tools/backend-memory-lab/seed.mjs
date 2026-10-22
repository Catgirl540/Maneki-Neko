/** Synthetic, disposable PostgreSQL data only. No production exports are used. */
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { createPgClient } from '../../server/pg-client.mjs'
import { openBankDatabase, CURRENT_KEY, PROFILES_KEY } from '../../server/database.mjs'
import { createDataCipher } from '../../server/database-crypto.mjs'
import { createCustomerAuth } from '../../server/customer-auth.mjs'

const root = resolve(import.meta.dirname, '../..')
const url = process.env.BANK_DATABASE_URL
const parsed = new URL(url)
assert(['127.0.0.1', 'localhost'].includes(parsed.hostname) && /^\/maneki_oom_(?:live_)?test$/.test(parsed.pathname), 'Only the local disposable OOM lab is allowed')
const customers = Number(process.env.LAB_CUSTOMERS ?? 504), transactions = Number(process.env.LAB_TRANSACTIONS ?? 200)
assert(Number.isInteger(customers) && customers > 0 && customers <= 5000)
assert(Number.isInteger(transactions) && transactions >= 0 && transactions <= 100000)
const admin = createPgClient(url)
for (const schema of ['regulatory', 'accounting', 'banking', 'public']) await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
await admin.query('CREATE SCHEMA public'); await admin.close()
const env = { ...process.env, NODE_ENV: 'test', BANK_AUTO_MIGRATE: 'true', BANK_INTEGRATION_MODE: 'sandbox', BANK_CSR_PASSWORD: 'lab-csr-password', BANK_SUPERVISOR_PASSWORD: 'lab-supervisor-password', BANK_OPS_PASSWORD: 'lab-ops-password' }
const boot = spawnSync(process.execPath, ['server/bootstrap-postgres.mjs'], { cwd: root, env, encoding: 'utf8' })
assert.equal(boot.status, 0, boot.stderr)
const memory = new Map()
globalThis.window = { localStorage: { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value), removeItem: key => memory.delete(key), setItemsAtomically: pairs => { for (const [key, value] of pairs) memory.set(key, value) } } }
const { resetDb } = await import('../../server/domain/state.mjs')
const template = resetDb()
const bank = await openBankDatabase(url, { autoMigrate: false, profileProjection: 'scoped' })
const cipher = createDataCipher(':memory:'), tokens = []
const auth = await createCustomerAuth(bank.db)
let logicalBytes = 0
try {
  for (let i = 0; i < customers; i++) {
    const profile = structuredClone(template), owner = `u_lab_${String(i).padStart(5, '0')}`
    profile.user = { ...profile.user, id: owner, phone: String(13800000000 + i), name: `压测客户${i}` }
    profile.accounts = [{ ...profile.accounts[0], id: 'acc_lab', accountNo: `882000${String(i).padStart(13, '0')}`, balance: 0, available: 0 }]
    profile.currencyBalances = []; profile.retiredBalances = []; profile.accountAliases = {}; profile.accountNumberAliases = {}
    profile.transactions = []; profile.cards = []; profile.cardSecrets = {}; profile.autoDebits = []; profile.fpsRegistrations = []; profile.payees = []; profile.pendingSms = null
    logicalBytes += Buffer.byteLength(JSON.stringify(profile))
    await bank.storage.beginUnitOfWork({ loadCurrent: false })
    bank.storage.setValuesAtomically([[CURRENT_KEY, profile], [PROFILES_KEY, { [profile.user.phone]: profile }]])
    await bank.storage.commitUnitOfWork(); bank.storage.releaseProjection()
    const rows = []
    for (let j = 0; j < transactions; j++) {
      const id = `txn_${j + 1}`, detail = { referenceNo: `LAB-${i}-${j}`, channel: 'transfer', paymentMethod: '储蓄账户', accountLabel: '储蓄账户', accountNo: profile.accounts[0].accountNo, settleCurrency: 'CNY', counterpartyName: '合成历史交易', location: '本地压测', remark: '仅本地模拟数据' }
      const tx = { id, accountId: 'acc_lab', direction: 'in', amount: 100, signedAmount: 100, counterparty: '合成历史交易', memo: '历史流水容量测试', category: 'salary', status: 'success', createdAt: new Date(Date.UTC(2026, 9, 1, 0, j)).toISOString(), detail }
      logicalBytes += Buffer.byteLength(JSON.stringify(tx))
      rows.push({ owner_id: owner, id, account_id: 'acc_lab', direction: 'in', amount_cents: 100, signed_amount_cents: 100, counterparty: tx.counterparty, memo: tx.memo, category: tx.category, status: 'success', created_at: tx.createdAt, detail_json: cipher.seal(detail, `transaction-detail:${owner}:${id}`), payload_cipher: cipher.seal({}, `transaction:${owner}:${id}`), ordinal: j, provenance: 'historical-import' })
      if (rows.length === 500 || j === transactions - 1) {
        await bank.db.query(`INSERT INTO bank_transactions(owner_id,id,account_id,direction,amount_cents,signed_amount_cents,counterparty,memo,category,status,created_at,detail_json,payload_cipher,ordinal,provenance)
          SELECT owner_id,id,account_id,direction,amount_cents,signed_amount_cents,counterparty,memo,category,status,created_at,detail_json,payload_cipher,ordinal,provenance
          FROM jsonb_to_recordset($1::jsonb) AS r(owner_id text,id text,account_id text,direction text,amount_cents bigint,signed_amount_cents bigint,counterparty text,memo text,category text,status text,created_at text,detail_json text,payload_cipher text,ordinal bigint,provenance text)`, [JSON.stringify(rows)])
        rows.length = 0
      }
    }
    if (i < 40) tokens.push({ id: owner, phone: profile.user.phone, name: profile.user.name, token: await auth.issue(profile.user), accountId: 'acc_lab' })
    if ((i + 1) % 100 === 0) console.log(`seeded ${i + 1} customers`)
  }
  // Make the default legacy profile a real member of the synthetic dataset.
  await bank.db.query('UPDATE profile_bindings SET owner_id=$1 WHERE storage_key=$2', ['u_lab_00000', CURRENT_KEY])
  await bank.db.query('ANALYZE')
  const result = { customers, transactionsPerCustomer: transactions, totalTransactions: customers * transactions, logicalBytes, databaseBytes: (await bank.db.query('SELECT pg_database_size(current_database()) AS bytes')).rows[0].bytes, tokens }
  await writeFile(resolve(root, `.generated/backend-memory-lab/seed${parsed.pathname.includes('live') ? '-live' : ''}.json`), JSON.stringify(result, null, 2), { mode: 0o600 })
  console.log(JSON.stringify({ ...result, tokens: `${tokens.length} local test tokens saved to ignored file` }))
} finally { await bank.close() }
