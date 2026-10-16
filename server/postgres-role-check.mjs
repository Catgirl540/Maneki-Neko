// Direct credential tests only against the dedicated connector fixture database.
// No SET ROLE, role memberships, owner URL, or production database is used.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createPgClient } from './pg-client.mjs'

let step = 'validate test connection settings'
const bankLocks = ['banking.providers','banking.release_gates','banking.account_links','banking.consents','banking.payment_intents']
function validateUrl(value) {
  let url
  try { url = new URL(value) } catch { throw new Error('A dedicated PostgreSQL role test URL is required') }
  const name = decodeURIComponent(url.pathname.slice(1))
  if (!['postgres:','postgresql:'].includes(url.protocol) || !/^maneki_connector_test(?:_[a-z0-9_]+)?$/.test(name)) throw new Error('Role checks require a dedicated maneki_connector_test database')
  return name
}
async function checkRole(role, connectionString) {
  const databaseName = validateUrl(connectionString), db = createPgClient(connectionString, { schema: 'public' })
  let checks = 0
  try {
    step = `${role}: verify actual authenticated role and test database`
    const identity = (await db.query('SELECT current_database() name,current_user role')).rows[0]
    assert.equal(identity.name, databaseName); assert.equal(identity.role, role); checks++
    const locks = role === 'maneki_app' ? bankLocks : [...bankLocks, 'accounting.charts']
    for (const table of locks) {
      step = `${role}: acquire real row locks on ${table}`
      await db.transaction(async () => {
        // Privileges are checked even when the fixture table contains no rows.
        await db.query(`SELECT * FROM ${table} WHERE false FOR UPDATE`)
        await db.query(`SELECT * FROM ${table} WHERE false FOR SHARE`)
        await db.query(`UPDATE ${table} SET lock_version=0 WHERE false`)
      })
      checks++
    }
    const denied = [
      ['provider approval', "UPDATE banking.providers SET status='approved' WHERE false"],
      ['release evidence', "UPDATE banking.release_gates SET state='passed' WHERE false"],
      ['approved chart policy', "UPDATE accounting.charts SET status='approved' WHERE false"],
      ['bank schema marker', 'INSERT INTO banking.schema_migrations(version) SELECT 9999999999 WHERE false'],
    ]
    if (role === 'maneki_app') denied.push(
      ['observed bank balance', 'UPDATE banking.account_links SET bank_balance_cents=0 WHERE false'],
      ['bank consent scope', "UPDATE banking.consents SET scopes=ARRAY['payments:initiate'] WHERE false"],
      ['payment amount', 'UPDATE banking.payment_intents SET amount_cents=1 WHERE false'],
      ['payment finality', "UPDATE banking.payment_intents SET status='succeeded' WHERE false"],
      ['verified receipt insert', 'INSERT INTO banking.receipts(id) SELECT gen_random_uuid() WHERE false'],
      ['receipt mutation', "UPDATE banking.receipts SET verification_method='bank_signature' WHERE false"],
      ['legacy schema marker', 'UPDATE bank_schema_migrations SET version=9999999999 WHERE false'],
    )
    for (const [label, sql] of denied) {
      step = `${role}: reject ${label}`
      await assert.rejects(db.query(sql), { code: '42501' }); checks++
    }
    if (role === 'maneki_bank_worker') {
      step = 'maneki_bank_worker: find an owner-prepared TEST ONLY accounting book'
      const target = (await db.query(`SELECT b.id,d.business_date::text AS day FROM accounting.books b
        JOIN accounting.charts c ON c.id=b.chart_id JOIN accounting.business_days d ON d.book_id=b.id
        WHERE b.name='TEST ONLY book' AND b.purpose='platform_financial' AND d.state='open' AND c.status='approved'
          AND d.business_date>=c.effective_from AND (c.effective_to IS NULL OR d.business_date<=c.effective_to)
          AND NOT EXISTS(SELECT 1 FROM accounting.business_days x WHERE x.book_id=b.id AND x.business_date>=d.business_date AND x.state IN ('closing','closed'))
          AND NOT EXISTS(SELECT 1 FROM accounting.journals j WHERE j.book_id=b.id AND j.business_date<=d.business_date AND j.state='draft')
        ORDER BY b.id,d.business_date LIMIT 1`)).rows[0]
      assert(target, 'Run the owner connector/accounting fixtures before this real-role check')
      const accounts = (await db.query(`SELECT a.id,s.normal_side FROM accounting.accounts a JOIN accounting.subjects s ON s.chart_id=a.chart_id AND s.code=a.subject_code WHERE a.book_id=$1 AND s.posting_allowed ORDER BY a.id`, [target.id])).rows
      const debit = accounts.find(row => row.normal_side === 'D'), credit = accounts.find(row => row.normal_side === 'C')
      assert(debit && credit, 'TEST ONLY fixture needs debit and credit posting accounts')
      const journalId = randomUUID(), rollbackProbe = new Error('ROLLBACK_TEST_ROLE_FINANCIAL_PROBE')
      step = 'maneki_bank_worker: actual guarded journal posting and day close, followed by rollback'
      try {
        await db.transaction(async () => {
          await db.query(`INSERT INTO accounting.journals(id,book_id,business_date,source_kind,source_reference,memo)
            VALUES($1,$2,$3,'platform_fee',$4,'TEST ONLY real role probe; rolled back')`, [journalId, target.id, target.day, randomUUID()])
          await db.query(`INSERT INTO accounting.entries(journal_id,account_id,currency,debit_cents,credit_cents) VALUES($1,$2,'CNY',1,0),($1,$3,'CNY',0,1)`, [journalId, debit.id, credit.id])
          await db.query("UPDATE accounting.journals SET state='posted' WHERE id=$1", [journalId])
          assert.equal((await db.query('SELECT state FROM accounting.journals WHERE id=$1', [journalId])).rows[0].state, 'posted')
          await db.query('SELECT accounting.close_business_day($1,$2::date)', [target.id, target.day])
          assert.equal((await db.query('SELECT state FROM accounting.business_days WHERE book_id=$1 AND business_date=$2', [target.id, target.day])).rows[0].state, 'closed')
          throw rollbackProbe
        })
      } catch (error) { if (error !== rollbackProbe) throw error }
      assert.equal((await db.query('SELECT count(*) n FROM accounting.journals WHERE id=$1', [journalId])).rows[0].n, 0)
      assert.equal((await db.query('SELECT state FROM accounting.business_days WHERE book_id=$1 AND business_date=$2', [target.id, target.day])).rows[0].state, 'open')
      checks++
    }
    return { role, checks, lockingAllowed: true, financialColumnPrivilegesRestricted: true, ...(role === 'maneki_bank_worker' ? { postingAndCloseVerifiedWithRollback: true } : {}) }
  } finally { await db.close() }
}

try {
  const appUrl = process.env.BANK_ROLE_APP_TEST_DATABASE_URL, workerUrl = process.env.BANK_ROLE_WORKER_TEST_DATABASE_URL
  validateUrl(appUrl); validateUrl(workerUrl)
  const roles = [await checkRole('maneki_app', appUrl), await checkRole('maneki_bank_worker', workerUrl)]
  console.log(JSON.stringify({ ok: true, database: 'dedicated connector fixture', roles }))
} catch (error) {
  console.error(JSON.stringify({ ok: false, step, code: error?.code ?? error?.name ?? 'ROLE_CHECK_FAILED', detail: 'Inspect the named test step and test-database grants; connection credentials are never printed.' }))
  process.exitCode = 1
}
