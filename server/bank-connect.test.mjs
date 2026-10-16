import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createBankConnect } from './bank-connect.mjs'
import { createDataCipher } from './database-crypto.mjs'

const gates = ['bank_contract', 'production_api', 'receipt_authentication', 'strong_customer_authentication', 'bank_uat', 'trusted_https', 'backup_restore', 'incident_response', 'privacy_review']
const harmlessDb = { async query() { return { rows: [] } }, async transaction(work) { return work() } }
const providerId = randomUUID()
const approvedProvider = (environment = 'test', driver = 'test_fixture') => ({ id: providerId, name: 'TEST ONLY fixture provider', driver, environment, status: 'approved', license_reference: 'TEST ONLY fixture', contract_evidence_sha256: 'a'.repeat(64), reviewed_by: 'reviewer', approved_by: 'approver', approved_at: new Date(Date.now() - 60000) })
const gateEvidence = gates.map(gate => ({ gate, state: 'passed', evidence_sha256: 'b'.repeat(64), reviewed_by: 'reviewer', approved_by: 'approver', verified_at: new Date(Date.now() - 60000), expires_at: new Date(Date.now() + 3600000) }))
const approvedDb = provider => ({
  async query(sql) { if (sql.includes('banking.providers')) return { rows: [provider] }; if (sql.includes('banking.release_gates')) return { rows: gateEvidence }; throw new Error(`Unexpected query: ${sql}`) },
  async transaction() { throw new Error('Unauthenticated receipt reached a database transaction') },
})

test('Bank Connect readiness fails closed with no provider or registered adapter', async () => {
  const service = createBankConnect({ db: harmlessDb, environment: 'test' })
  const report = await service.readiness()
  assert.equal(report.ready, false)
  assert.deepEqual(report.providers, [])
  assert(report.missingGates.includes('provider_approval'))
  assert(report.missingGates.includes('trusted_adapter'))
  assert.equal(report.gates.length, gates.length)
  await assert.rejects(service.listAccounts('customer'), { code: 'BANK_NOT_CONNECTED', status: 503 })
  const approved = createBankConnect({ db: approvedDb(approvedProvider()), environment: 'test' })
  assert((await approved.readiness()).missingGates.includes('trusted_adapter'))
  await assert.rejects(approved.listAccounts('customer'), { code: 'BANK_NOT_CONNECTED' })
})

test('fixture adapters cannot be registered in production or under a different driver', () => {
  const prior = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'
  try {
    const service = createBankConnect({ db: harmlessDb, environment: 'production' })
    assert.throws(() => service.registerAdapter('test_fixture', { driver: 'test_fixture', environment: 'production', async verifyReceipt() {} }), /prohibited/)
    assert.throws(() => service.registerAdapter('bank_driver', { driver: 'other_bank', environment: 'production', async verifyReceipt() {} }), /explicitly bound/)
  } finally { if (prior === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prior }
})

test('a client verified=true flag cannot bypass trusted adapter receipt authentication', async () => {
  let called = false
  const service = createBankConnect({ db: approvedDb(approvedProvider('production', 'bank_driver')), environment: 'production', cipher: unitCipher,
    adapters: [{ driver: 'bank_driver', environment: 'production', async verifyReceipt(raw) { called = true; assert.equal(JSON.parse(raw).verified, true); throw new Error('Invalid bank signature') } }],
  })
  await assert.rejects(service.processBankReceipt(providerId, Buffer.from('{"verified":true}'), {}), { code: 'INVALID_BANK_RECEIPT', status: 401 })
  assert.equal(called, true)
})

test('production adapters cannot return fixture verification evidence', async () => {
  const service = createBankConnect({ db: approvedDb(approvedProvider('production', 'bank_driver')), environment: 'production', cipher: unitCipher,
    adapters: [{ driver: 'bank_driver', environment: 'production', async verifyReceipt() { return { verificationMethod: 'test_fixture', verified: true } } }],
  })
  await assert.rejects(service.processBankReceipt(providerId, Buffer.from('{}'), {}), { code: 'INVALID_BANK_RECEIPT' })
})

// Uses a dedicated database because bank/accounting schemas and trigger types have
// fixed names. This suite will never reset the shared BANK_TEST_DATABASE_URL.
test('partner custody PostgreSQL state machine requires verified bank authorization and settlement', { skip: !process.env.BANK_CONNECT_TEST_DATABASE_URL, timeout: 120000 }, async t => {
  const { createPgClient } = await import('./pg-client.mjs')
  const db = createPgClient(process.env.BANK_CONNECT_TEST_DATABASE_URL)
  const previousMode = process.env.NODE_ENV
  process.env.NODE_ENV = 'test'
  let safeDatabase = false
  try {
    const databaseName = (await db.query('SELECT current_database() AS name')).rows[0].name
    assert.match(databaseName, /^maneki_connector_test(?:_|$)/, 'destructive fixture reset requires a dedicated maneki_connector_test database')
    safeDatabase = true
    await db.query('DROP SCHEMA IF EXISTS accounting CASCADE')
    await db.query('DROP SCHEMA IF EXISTS banking CASCADE')
    await db.query('DROP SCHEMA IF EXISTS regulatory CASCADE')
    await db.exec(readFileSync(new URL('./postgres-schema.sql', import.meta.url), 'utf8'))
    await db.exec(readFileSync(new URL('./bank-connect-schema.sql', import.meta.url), 'utf8'))
    const cipher = createDataCipher(':memory:'), service = createBankConnect({ db, cipher, environment: 'test' })
    const owner = `bankconnect-test-${randomUUID()}`, otherOwner = `bankconnect-other-${randomUUID()}`
    for (const [index, id] of [owner, otherOwner].entries()) {
      await db.query('INSERT INTO customers(id,phone,name,user_cipher,profile_fields_json) VALUES($1,$2,$3,$4,$5)', [id, `139${Date.now().toString().slice(-7)}${index}`, 'TEST ONLY fixture customer', cipher.seal({ id }, `customers:${id}`), '[]'])
    }
    await t.test('missing bank remains unavailable and exposes no legacy accounts', async () => {
      assert.equal((await service.readiness()).ready, false)
      await assert.rejects(service.listAccounts(owner), { code: 'BANK_NOT_CONNECTED' })
    })
    const bank = approvedProvider(), accountId = randomUUID(), consentId = randomUUID(), secret = randomBytes(32)
    await db.query(`INSERT INTO banking.providers(id,name,driver,environment,status,license_reference,contract_evidence_sha256,reviewed_by,approved_by,approved_at)
      VALUES($1,$2,'test_fixture','test','approved',$3,$4,'reviewer','approver',now()-interval '1 minute')`, [bank.id, bank.name, bank.license_reference, bank.contract_evidence_sha256])
    for (const gate of gates) await db.query(`INSERT INTO banking.release_gates(provider_id,gate,state,evidence_sha256,reviewed_by,approved_by,verified_at,expires_at) VALUES($1,$2,'passed',$3,'reviewer','approver',now()-interval '1 minute',now()+interval '1 year')`, [bank.id, gate, 'b'.repeat(64)])
    await t.test('approved database records do not replace a registered trusted adapter', async () => {
      assert.equal((await service.readiness()).ready, false)
      await assert.rejects(service.listAccounts(owner), { code: 'BANK_NOT_CONNECTED' })
    })
    service.registerAdapter('test_fixture', { driver: 'test_fixture', environment: 'test', async verifyReceipt(raw, headers) {
      const expected = createHmac('sha256', secret).update(raw).digest(), supplied = Buffer.from(headers['x-fixture-signature'] ?? '', 'hex')
      if (supplied.length !== expected.length || !timingSafeEqual(expected, supplied)) throw new Error('Invalid test fixture HMAC')
      return { ...JSON.parse(raw), verificationMethod: 'test_fixture', verificationReference: 'TEST ONLY fixture HMAC v1' }
    } })
    assert.equal((await service.readiness()).ready, true)
    await db.query(`INSERT INTO banking.account_links(id,owner_id,provider_id,bank_account_hash,bank_reference_cipher,masked_account,label,currency,state,verified_at)
      VALUES($1,$2,$3,$4,$5,'****1234','人民币银行托管账户','CNY','active',now())`, [accountId, owner, bank.id, 'c'.repeat(64), cipher.seal('TEST ONLY reference', `banking.account_links:${accountId}:reference`)])
    await db.query(`INSERT INTO banking.consents(id,owner_id,provider_id,account_link_id,scopes,bank_authorization_cipher,proof_sha256,granted_at,expires_at)
      VALUES($1,$2,$3,$4,ARRAY['accounts:read','payments:initiate'],$5,$6,now()-interval '1 hour',now()+interval '1 day')`, [consentId, owner, bank.id, accountId, cipher.seal('TEST ONLY authorization', `banking.consents:${consentId}:authorization`), 'd'.repeat(64)])
    const receipt = event => {
      const raw = Buffer.from(JSON.stringify({ eventId: randomUUID(), occurredAt: new Date().toISOString(), currency: 'CNY', ...event }))
      return service.processBankReceipt(bank.id, raw, { 'x-fixture-signature': createHmac('sha256', secret).update(raw).digest('hex') })
    }
    const input = { sourceAccountId: accountId, consentId, amountCents: 500, currency: 'CNY', payee: { name: 'TEST ONLY收款人', accountNumber: '6217000000000000123', bankCode: 'TEST_ONLY', bankRegion: 'CN' }, memo: 'TEST ONLY payment' }
    await t.test('only bank-observed balances are listed and old snapshots cannot overwrite new ones', async () => {
      assert.deepEqual(await service.listAccounts(owner), [])
      assert.equal((await receipt({ type: 'account.balance', accountLinkId: accountId, balanceCents: 100000, availableCents: 90000, sequence: 1 })).applied, true)
      const listed = await service.listAccounts(owner)
      assert.equal(listed.length, 1)
      assert.equal(listed[0].balance, 100000)
      assert.equal(listed[0].balanceSource, 'partner_bank')
      assert.deepEqual(await service.listAccounts(otherOwner), [])
      assert.equal((await receipt({ type: 'account.balance', accountLinkId: accountId, balanceCents: 1, availableCents: 1, sequence: 0 })).applied, false)
      assert.equal((await service.getAccount(owner, accountId)).balance, 100000)
      await assert.rejects(service.getAccount(otherOwner, accountId), { code: 'BANK_ACCOUNT_NOT_FOUND' })
    })
    await t.test('amounts, currency, ownership, consent and release evidence are enforced', async () => {
      await assert.rejects(service.createPayment(owner, { ...input, amountCents: 0 }, 'test-invalid-01'))
      await assert.rejects(service.createPayment(owner, { ...input, amountCents: 1.5 }, 'test-invalid-02'))
      await assert.rejects(service.createPayment(owner, { ...input, amountCents: Number.MAX_SAFE_INTEGER + 1 }, 'test-invalid-03'))
      await assert.rejects(service.createPayment(owner, { ...input, currency: 'USD' }, 'test-invalid-04'), { code: 'UNSUPPORTED_CURRENCY' })
      await assert.rejects(service.createPayment(otherOwner, input, 'test-owner-0001'), { code: 'BANK_ACCOUNT_UNAVAILABLE' })
      await db.query('UPDATE banking.consents SET revoked_at=now() WHERE id=$1', [consentId])
      await assert.rejects(service.createPayment(owner, input, 'test-revoked-01'), { code: 'BANK_CONSENT_REQUIRED' })
      await db.query('UPDATE banking.consents SET revoked_at=NULL,expires_at=now()-interval \'1 minute\' WHERE id=$1', [consentId])
      await assert.rejects(service.createPayment(owner, input, 'test-expired-01'), { code: 'BANK_CONSENT_REQUIRED' })
      await db.query("UPDATE banking.consents SET expires_at=now()+interval '1 day' WHERE id=$1", [consentId])
      await db.query("UPDATE banking.release_gates SET expires_at=now()-interval '1 minute' WHERE provider_id=$1 AND gate='bank_uat'", [bank.id])
      assert.equal((await service.readiness()).ready, false)
      await assert.rejects(service.createPayment(owner, input, 'test-gate-00001'), { code: 'BANK_NOT_CONNECTED' })
      await db.query("UPDATE banking.release_gates SET expires_at=now()+interval '1 year' WHERE provider_id=$1 AND gate='bank_uat'", [bank.id])
    })
    let payment
    await t.test('concurrent creation is idempotent and creates neither a debit nor a dispatch', async () => {
      const results = await Promise.all([service.createPayment(owner, input, 'test-payment-0001'), service.createPayment(owner, input, 'test-payment-0001')])
      payment = results[0]
      assert.equal(results[1].id, payment.id)
      assert.equal(payment.status, 'awaiting_authorization')
      assert.equal((await db.query('SELECT count(*) AS n FROM banking.payment_intents')).rows[0].n, 1)
      assert.equal((await db.query('SELECT count(*) AS n FROM banking.outbox')).rows[0].n, 0)
      assert.equal((await service.getAccount(owner, accountId)).balance, 100000)
      await assert.rejects(service.createPayment(owner, { ...input, amountCents: 501 }, 'test-payment-0001'), { code: 'IDEMPOTENCY_CONFLICT' })
      await assert.rejects(service.getPayment(otherOwner, payment.id), { code: 'PAYMENT_NOT_FOUND' })
      const stored = (await db.query('SELECT payee_cipher FROM banking.payment_intents WHERE id=$1', [payment.id])).rows[0].payee_cipher
      assert(stored.startsWith('aesgcm:v1:'))
      assert.equal(stored.includes(input.payee.accountNumber), false)
    })
    const details = () => ({ paymentId: payment.id, sourceAccountId: accountId, amountCents: 500, bankPaymentReference: `BANK-${payment.id}` })
    await t.test('client verification flags and mismatched signed receipts cannot move funds', async () => {
      await assert.rejects(service.processBankReceipt(bank.id, Buffer.from(JSON.stringify({ verified: true, type: 'payment.succeeded', ...details() })), {}), { code: 'INVALID_BANK_RECEIPT' })
      await assert.rejects(receipt({ type: 'payment.authorized', ...details(), amountCents: 501, bankAuthorizationReference: `AUTH-${payment.id}` }), { code: 'BANK_RECEIPT_MISMATCH' })
      await assert.rejects(receipt({ type: 'payment.authorized', ...details(), sourceAccountId: randomUUID(), bankAuthorizationReference: `AUTH-${payment.id}` }), { code: 'BANK_RECEIPT_MISMATCH' })
      assert.equal((await service.getPayment(owner, payment.id)).status, 'awaiting_authorization')
    })
    await t.test('only a bank authorization queues dispatch; pending and timeout remain uncertain', async () => {
      const event = { type: 'payment.authorized', ...details(), bankAuthorizationReference: `AUTH-${payment.id}`, eventId: 'authorize-payment-once', occurredAt: new Date().toISOString(), currency: 'CNY' }
      const raw = Buffer.from(JSON.stringify(event)), headers = { 'x-fixture-signature': createHmac('sha256', secret).update(raw).digest('hex') }
      const results = await Promise.all([service.processBankReceipt(bank.id, raw, headers), service.processBankReceipt(bank.id, raw, headers)])
      assert.equal(results.filter(item => item.applied).length, 1)
      assert.equal((await service.getPayment(owner, payment.id)).status, 'queued')
      assert.equal((await db.query('SELECT count(*) AS n FROM banking.outbox')).rows[0].n, 1)
      const changed = Buffer.from(JSON.stringify({ ...event, amountCents: 600 }))
      await assert.rejects(service.processBankReceipt(bank.id, changed, { 'x-fixture-signature': createHmac('sha256', secret).update(changed).digest('hex') }), { code: 'BANK_RECEIPT_CONFLICT' })
      await receipt({ type: 'payment.pending', ...details() })
      assert.equal((await service.getPayment(owner, payment.id)).status, 'bank_pending')
      await db.query("UPDATE banking.outbox SET state='leased',lease_token=$1,leased_until=now()-interval '1 minute' WHERE payment_id=$2", [randomUUID(), payment.id])
      assert.deepEqual(await service.expireOutboxLeases(), { expired: 1, automaticallyRetried: 0 })
      assert.equal((await service.getPayment(owner, payment.id)).status, 'unknown')
      assert.equal((await db.query('SELECT state FROM banking.outbox WHERE payment_id=$1', [payment.id])).rows[0].state, 'unknown')
      await receipt({ type: 'payment.pending', ...details() })
      assert.equal((await service.getPayment(owner, payment.id)).status, 'unknown', 'a pending receipt cannot resolve an unknown outcome')
    })
    await t.test('only a matching settled bank receipt finalizes success and balance stays bank-owned', async () => {
      await assert.rejects(receipt({ type: 'payment.succeeded', ...details(), bankPaymentReference: 'WRONG-REFERENCE' }), { code: 'BANK_RECEIPT_MISMATCH' })
      const done = await receipt({ type: 'payment.succeeded', ...details() })
      assert.equal(done.status, 'succeeded')
      assert.equal((await service.getAccount(owner, accountId)).balance, 100000)
      await assert.rejects(db.query("UPDATE banking.payment_intents SET amount_cents=501 WHERE id=$1", [payment.id]), { code: '23514' })
      await assert.rejects(db.query('DELETE FROM banking.receipts WHERE id=$1', [done.receiptId]), { code: '23514' })
      await assert.rejects(db.query('DELETE FROM banking.payment_events WHERE payment_id=$1', [payment.id]), { code: '23514' })
    })
    await t.test('pre-authorization rejection is final without fabricating an authorization', async () => {
      const rejected = await service.createPayment(owner, input, 'test-rejected-0001')
      await receipt({ type: 'payment.rejected', paymentId: rejected.id, sourceAccountId: accountId, amountCents: 500 })
      const row = (await db.query('SELECT * FROM banking.payment_intents WHERE id=$1', [rejected.id])).rows[0]
      assert.equal(row.status, 'rejected')
      assert.equal(row.authorization_receipt_id, null)
      assert(row.final_receipt_id)
    })
    await t.test('out-of-order settlement is retained and applied only after matching bank authorization', async () => {
      const early = await service.createPayment(owner, input, 'test-outoforder-01')
      const refs = { paymentId: early.id, sourceAccountId: accountId, amountCents: 500, bankPaymentReference: `BANK-${early.id}` }
      const settlement = await receipt({ type: 'payment.succeeded', ...refs })
      assert.equal(settlement.applied, false)
      assert.equal((await service.getPayment(owner, early.id)).status, 'awaiting_authorization')
      const authorized = await receipt({ type: 'payment.authorized', ...refs, bankAuthorizationReference: `AUTH-${early.id}` })
      assert.equal(authorized.status, 'succeeded')
      assert.equal(authorized.settledByEarlierReceipt, settlement.receiptId)
      assert.equal((await db.query('SELECT state FROM banking.outbox WHERE payment_id=$1', [early.id])).rows[0].state, 'delivered')
    })
  } finally {
    if (previousMode === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previousMode
    await db.close()
    assert(safeDatabase, 'suite must connect to the dedicated test database before any schema reset')
  }
})

// Runs after this file's connector fixture; each subtest owns fresh test books.
test('PostgreSQL accounting policy, posting and day close preserve immutable exact balances', { skip: !process.env.BANK_CONNECT_TEST_DATABASE_URL, concurrency: false, timeout: 120000 }, async t => {
  const { createPgClient } = await import('./pg-client.mjs')
  const db = createPgClient(process.env.BANK_CONNECT_TEST_DATABASE_URL)
  const day = '2026-10-15'
  let safeDatabase = false
  try {
    const name = (await db.query('SELECT current_database() name')).rows[0].name
    assert.match(name, /^maneki_connector_test(?:_|$)/, 'accounting fixtures require the dedicated connector test database')
    safeDatabase = true
    // No shared schemas or existing connector evidence are reset here.
    await db.exec(readFileSync(new URL('./postgres-schema.sql', import.meta.url), 'utf8'))
    await db.exec(readFileSync(new URL('./bank-connect-schema.sql', import.meta.url), 'utf8'))
    async function book({ status = 'approved', effectiveFrom = '2026-01-01', effectiveTo = null } = {}) {
      const chartId = `TEST-ACCOUNTING-${randomUUID()}`, id = randomUUID(), debit = randomUUID(), credit = randomUUID(), otherCredit = randomUUID()
      await db.query(`INSERT INTO accounting.charts(id,name,version,purpose,status,policy_evidence_sha256,approved_by,effective_from,effective_to)
        VALUES($1,'TEST ONLY accounting policy',1,'platform_financial',$2,$3,'TEST ONLY reviewer',$4,$5)`, [chartId, status, 'f'.repeat(64), effectiveFrom, effectiveTo])
      await db.query(`INSERT INTO accounting.subjects(chart_id,code,name,category,normal_side) VALUES($1,'1002','TEST ONLY cash','asset','D'),($1,'6001','TEST ONLY revenue','income','C'),($1,'2202','TEST ONLY payable','liability','C')`, [chartId])
      await db.query(`INSERT INTO accounting.books(id,chart_id,name,currency,purpose) VALUES($1,$2,'TEST ONLY book','CNY','platform_financial')`, [id, chartId])
      for (const [accountId, code] of [[debit,'1002'],[credit,'6001'],[otherCredit,'2202']]) await db.query(`INSERT INTO accounting.accounts(id,book_id,chart_id,subject_code,name,currency) VALUES($1,$2,$3,$4,'TEST ONLY account','CNY')`, [accountId, id, chartId, code])
      await db.query(`INSERT INTO accounting.business_days(book_id,business_date,state) VALUES($1,$2,'open')`, [id, day])
      return { id, chartId, debit, credit, otherCredit }
    }
    const journal = async (connection, target, date = day) => {
      const id = randomUUID()
      await connection.query(`INSERT INTO accounting.journals(id,book_id,business_date,source_kind,source_reference,memo) VALUES($1,$2,$3,'platform_fee',$4,'TEST ONLY journal')`, [id, target.id, date, randomUUID()])
      return id
    }
    const entry = (connection, id, accountId, debit, credit, currency = 'CNY') => connection.query('INSERT INTO accounting.entries(journal_id,account_id,currency,debit_cents,credit_cents) VALUES($1,$2,$3,$4,$5)', [id, accountId, currency, debit, credit])
    async function post(target, { debit = 1000, credit = 1000, currency = 'CNY', account = target.debit, date = day } = {}) {
      return db.transaction(async connection => {
        const id = await journal(connection, target, date)
        await entry(connection, id, account, debit, 0, currency)
        await entry(connection, id, target.credit, 0, credit)
        await connection.query("UPDATE accounting.journals SET state='posted' WHERE id=$1", [id])
        return id
      })
    }
    const close = target => db.query('SELECT accounting.close_business_day($1,$2::date)', [target.id, day])
    const snapshots = async target => (await db.query('SELECT account_id,business_date::text,debit_cents,credit_cents FROM accounting.daily_balances WHERE book_id=$1 ORDER BY account_id,business_date', [target.id])).rows

    await t.test('draft accounting charts and dates outside approved policy cannot post', async () => {
      for (const settings of [{ status: 'draft' }, { effectiveFrom: '2027-01-01' }, { effectiveTo: '2026-01-02' }]) {
        const target = await book(settings)
        await assert.rejects(post(target), { code: '23514' })
        assert.equal((await db.query('SELECT count(*) n FROM accounting.journals WHERE book_id=$1', [target.id])).rows[0].n, 0)
      }
    })
    await t.test('imbalance, foreign currency and an account in another book are rejected', async () => {
      const target = await book(), other = await book()
      await assert.rejects(post(target, { debit: 1000, credit: 999 }), { code: '23514' })
      await assert.rejects(post(target, { currency: 'USD' }), { code: '23514' })
      await assert.rejects(post(target, { account: other.debit }), { code: '23514' })
    })
    await t.test('balanced multi-entry postings are final and journal/entry history cannot mutate', async () => {
      const target = await book()
      const id = await db.transaction(async connection => {
        const id = await journal(connection, target)
        await entry(connection, id, target.debit, 1000, 0)
        await entry(connection, id, target.credit, 0, 600)
        await entry(connection, id, target.otherCredit, 0, 400)
        await connection.query("UPDATE accounting.journals SET state='posted' WHERE id=$1", [id])
        return id
      })
      const posted = (await db.query('SELECT state,posted_at FROM accounting.journals WHERE id=$1', [id])).rows[0]
      assert.equal(posted.state, 'posted'); assert(posted.posted_at)
      assert.deepEqual((await db.query('SELECT SUM(debit_cents::numeric) debit,SUM(credit_cents::numeric) credit FROM accounting.entries WHERE journal_id=$1', [id])).rows[0], { debit: 1000, credit: 1000 })
      await assert.rejects(db.query("UPDATE accounting.journals SET memo='tampered' WHERE id=$1", [id]), { code: '23514' })
      await assert.rejects(db.query('DELETE FROM accounting.journals WHERE id=$1', [id]), { code: '23514' })
      await assert.rejects(db.query('UPDATE accounting.entries SET debit_cents=debit_cents+1 WHERE journal_id=$1', [id]), { code: '23514' })
      await assert.rejects(db.query('DELETE FROM accounting.entries WHERE journal_id=$1', [id]), { code: '23514' })
      await assert.rejects(entry(db, id, target.debit, 1, 0), { code: '23514' })
      await assert.rejects(db.exec('TRUNCATE accounting.entries'), { code: '23514' })
    })
    await t.test('unposted drafts prevent closing and a successful close preserves journal totals', async () => {
      const target = await book(), id = await journal(db, target)
      await assert.rejects(close(target), { code: '23514' })
      await entry(db, id, target.debit, 2000, 0); await entry(db, id, target.credit, 0, 2000)
      await db.query("UPDATE accounting.journals SET state='posted' WHERE id=$1", [id])
      await close(target)
      const saved = await snapshots(target)
      assert.equal(saved.length, 3)
      assert.equal(saved.find(row => row.account_id === target.debit).debit_cents, 2000)
      assert.equal(saved.find(row => row.account_id === target.credit).credit_cents, 2000)
      assert.equal(saved.find(row => row.account_id === target.otherCredit).debit_cents, 0)
      await assert.rejects(close(target), { code: '23514' })
      await assert.rejects(db.query("UPDATE accounting.business_days SET state='open',closed_at=NULL WHERE book_id=$1 AND business_date=$2", [target.id, day]), { code: '23514' })
      await assert.rejects(post(target), { code: '23514' })
      await assert.rejects(db.query('UPDATE accounting.daily_balances SET debit_cents=0 WHERE book_id=$1', [target.id]), { code: '23514' })
      assert.deepEqual(await snapshots(target), saved)
    })
    await t.test('snapshots cannot be fabricated before close or associated with another book', async () => {
      const target = await book(), other = await book()
      await assert.rejects(db.query('INSERT INTO accounting.daily_balances(book_id,account_id,business_date,debit_cents,credit_cents) VALUES($1,$2,$3,100,0)', [target.id, target.debit, day]), { code: '23514' })
      await db.query("UPDATE accounting.business_days SET state='closing' WHERE book_id=$1 AND business_date=$2", [target.id, day])
      await assert.rejects(db.query('INSERT INTO accounting.daily_balances(book_id,account_id,business_date,debit_cents,credit_cents) VALUES($1,$2,$3,0,0)', [target.id, other.debit, day]), { code: '23514' })
      await assert.rejects(db.query('INSERT INTO accounting.daily_balances(book_id,account_id,business_date,debit_cents,credit_cents) VALUES($1,$2,$3,100,0)', [target.id, target.debit, day]), { code: '23514' })
      await assert.rejects(db.query("UPDATE accounting.business_days SET state='closed',closed_at=now() WHERE book_id=$1 AND business_date=$2", [target.id, day]), { code: '23514' })
    })
    await t.test('book purpose cannot change the treatment of customer funds', async () => {
      const target = await book()
      await assert.rejects(db.query("INSERT INTO accounting.books(id,chart_id,name,currency,purpose) VALUES($1,$2,'TEST ONLY mismatched book','CNY','external_bank_memorandum')", [randomUUID(), target.chartId]), { code: '23514' })
      await assert.rejects(db.query("UPDATE accounting.books SET purpose='external_bank_memorandum' WHERE id=$1", [target.id]), { code: '23514' })
    })
    await t.test('concurrent posting and close produce a complete snapshot or reject the late posting', async () => {
      const target = await book()
      const outcomes = await Promise.allSettled([post(target), close(target)])
      assert(outcomes.some(result => result.status === 'fulfilled'))
      const state = (await db.query('SELECT state FROM accounting.business_days WHERE book_id=$1 AND business_date=$2', [target.id, day])).rows[0].state
      if (state === 'open') await close(target)
      const totals = (await db.query("SELECT COALESCE(SUM(e.debit_cents::numeric),0) debit,COALESCE(SUM(e.credit_cents::numeric),0) credit FROM accounting.entries e JOIN accounting.journals j ON j.id=e.journal_id WHERE j.book_id=$1 AND j.state='posted'", [target.id])).rows[0]
      const saved = await snapshots(target)
      assert.equal(saved.reduce((sum, row) => sum + row.debit_cents, 0), totals.debit)
      assert.equal(saved.reduce((sum, row) => sum + row.credit_cents, 0), totals.credit)
    })
  } finally { await db.close(); assert(safeDatabase, 'accounting tests must verify the dedicated test database') }
})
const unitCipher = { seal() { return 'encrypted' }, open() {} }

// No adapter, bank credentials, approval or release gate is silently fabricated.
