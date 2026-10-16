import { createHash, randomUUID } from 'node:crypto'

const RELEASE_GATES = Object.freeze(['bank_contract', 'production_api', 'receipt_authentication', 'strong_customer_authentication', 'bank_uat', 'trusted_https', 'backup_restore', 'incident_response', 'privacy_review'])
const FINAL = new Set(['succeeded', 'rejected', 'cancelled'])
const PAYMENT_EVENTS = new Set(['payment.authorized', 'payment.pending', 'payment.succeeded', 'payment.rejected', 'payment.cancelled', 'payment.unknown'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA256 = /^[0-9a-f]{64}$/
const error = (message, status = 400, code = 'INVALID_BANK_REQUEST') => Object.assign(new Error(message), { status, code })
const digest = value => createHash('sha256').update(value).digest('hex')
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value)
const cents = (value, positive = false) => {
  if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0)) throw error('金额必须为安全范围内的整数分')
  return value
}
const text = (value, name, max = 200) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw error(`${name}不合法`)
  return value.trim()
}
const uuid = (value, name) => { if (typeof value !== 'string' || !UUID.test(value)) throw error(`${name}不合法`); return value.toLowerCase() }
const iso = value => value instanceof Date ? value.toISOString() : new Date(value).toISOString()
const paymentDto = row => ({
  id: row.id, paymentId: row.id, providerId: row.provider_id, sourceAccountId: row.source_account_id,
  amountCents: Number(row.amount_cents), currency: row.currency, status: row.status,
  bankPaymentReference: row.bank_payment_reference, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
})
const accountDto = row => ({
  id: row.id, providerId: row.provider_id, accountNo: row.masked_account, label: row.label, currency: row.currency,
  balance: Number(row.bank_balance_cents), available: Number(row.bank_available_cents),
  balanceObservedAt: iso(row.balance_observed_at), balanceSource: 'partner_bank', custody: 'partner_bank',
})

/**
 * Partner-held funds only. Adapters are trusted server code registered explicitly;
 * this module ships no real bank adapter and never turns a local intent into funds.
 * It performs no schema migration and never reads the legacy bank_accounts table.
 */
export function createBankConnect({ db, cipher, adapters = [], environment = process.env.NODE_ENV === 'production' ? 'production' : 'test', now = Date.now } = {}) {
  if (!db?.query || !db?.transaction) throw new Error('Bank Connect requires a PostgreSQL client')
  if (!['test', 'production'].includes(environment)) throw new Error('Invalid partner bank environment')
  const registry = new Map()
  const q = async (sql, params = []) => (await db.query(sql, params)).rows
  const one = async (sql, params = []) => (await q(sql, params))[0]
  const lock = key => q('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key])
  const encrypted = () => {
    if (typeof cipher?.seal !== 'function' || typeof cipher?.open !== 'function') throw error('银行接入加密服务未配置', 503, 'DATA_ENCRYPTION_UNAVAILABLE')
    return cipher
  }
  function registerAdapter(driver, adapter) {
    if (typeof driver !== 'string' || !/^[a-z][a-z0-9_-]{1,63}$/.test(driver) || !adapter || adapter.driver !== driver || adapter.environment !== environment || typeof adapter.verifyReceipt !== 'function') throw new Error('Adapter driver, environment and receipt verifier must be explicitly bound')
    if (driver === 'test_fixture' && (process.env.NODE_ENV !== 'test' || environment !== 'test')) throw new Error('Test fixture adapters are prohibited outside test mode')
    if (registry.has(driver)) throw new Error('Adapter driver is already registered')
    registry.set(driver, Object.freeze({ ...adapter, verifyReceipt: adapter.verifyReceipt.bind(adapter) }))
  }
  for (const adapter of adapters) registerAdapter(adapter.driver, adapter)
  function reviewValid(row) {
    return row && SHA256.test(row.evidence_sha256 ?? '') && typeof row.reviewed_by === 'string' && row.reviewed_by.length > 0 && typeof row.approved_by === 'string' && row.approved_by.length > 0 && row.reviewed_by !== row.approved_by && row.verified_at && new Date(row.verified_at).getTime() <= now() && (!row.expires_at || new Date(row.expires_at).getTime() > now())
  }
  function approved(provider) {
    return provider?.status === 'approved' && provider.environment === environment && typeof provider.license_reference === 'string' && provider.license_reference.trim().length > 0 && SHA256.test(provider.contract_evidence_sha256 ?? '') && provider.reviewed_by && provider.approved_by && provider.reviewed_by !== provider.approved_by && provider.approved_at && new Date(provider.approved_at).getTime() <= now()
  }
  async function inspect(provider, rowLock = false) {
    const evidence = provider ? await q(`SELECT * FROM banking.release_gates WHERE provider_id=$1${rowLock ? ' FOR SHARE' : ''}`, [provider.id]) : []
    const gates = RELEASE_GATES.map(gate => {
      const row = evidence.find(item => item.gate === gate)
      return { gate, state: row?.state === 'passed' && reviewValid(row) ? 'passed' : row?.state === 'failed' ? 'failed' : 'pending' }
    })
    const adapter = provider && registry.get(provider.driver)
    const missingGates = [...(!approved(provider) ? ['provider_approval'] : []), ...(!adapter || adapter.environment !== provider?.environment ? ['trusted_adapter'] : []), ...gates.filter(item => item.state !== 'passed').map(item => item.gate)]
    return { ready: missingGates.length === 0, connected: missingGates.length === 0, environment, custody: 'partner_bank', provider: provider ? { id: provider.id, name: provider.name, status: provider.status, environment: provider.environment } : null, missingGates, gates }
  }
  async function readiness(providerId) {
    const providers = await q(`SELECT * FROM banking.providers WHERE environment=$1${providerId ? ' AND id=$2' : ''} ORDER BY created_at,id`, providerId ? [environment, uuid(providerId, '银行接入编号')] : [environment])
    const reports = []
    for (const provider of providers) reports.push(await inspect(provider))
    const report = reports.find(item => item.ready) ?? reports[0] ?? await inspect(null)
    return { ...report, providers: reports.map(item => ({ ...item.provider, ready: item.ready, missingGates: item.missingGates })) }
  }
  async function connected(providerId, rowLock = false) {
    const provider = await one(`SELECT * FROM banking.providers WHERE id=$1 AND environment=$2${rowLock ? ' FOR SHARE' : ''}`, [providerId, environment])
    const report = await inspect(provider, rowLock)
    if (!report.ready) throw Object.assign(error('尚未完成持牌银行接入及上线验收', 503, 'BANK_NOT_CONNECTED'), { missingGates: report.missingGates })
    return { provider, adapter: registry.get(provider.driver) }
  }
  async function availableProviders() {
    const providers = await q("SELECT * FROM banking.providers WHERE environment=$1 AND status='approved' ORDER BY id", [environment])
    const result = []
    for (const provider of providers) if ((await inspect(provider)).ready) result.push(provider.id)
    if (!result.length) throw error('尚未完成持牌银行接入及上线验收', 503, 'BANK_NOT_CONNECTED')
    return result
  }
  async function listAccounts(ownerId) {
    const owner = text(ownerId, '客户编号', 128), providers = await availableProviders()
    const rows = await q(`SELECT a.* FROM banking.account_links a WHERE a.owner_id=$1 AND a.provider_id=ANY($2::uuid[])
      AND a.state='active' AND a.verified_at IS NOT NULL AND a.bank_balance_cents IS NOT NULL
      AND a.bank_available_cents IS NOT NULL AND a.balance_observed_at IS NOT NULL ORDER BY a.created_at,a.id`, [owner, providers])
    return rows.map(accountDto)
  }
  async function getAccount(ownerId, id) {
    const accountId = uuid(id, '托管账户编号'), rows = await listAccounts(ownerId), found = rows.find(item => item.id === accountId)
    if (!found) throw error('托管账户不存在或尚无银行余额快照', 404, 'BANK_ACCOUNT_NOT_FOUND')
    return found
  }
  function normalizeRequest(request) {
    if (!request || typeof request !== 'object' || Array.isArray(request)) throw error('支付请求不合法')
    if (request.currency !== undefined && request.currency !== 'CNY') throw error('仅支持境内人民币支付', 400, 'UNSUPPORTED_CURRENCY')
    if ((request.scope !== undefined && request.scope !== 'domestic') || (request.channel !== undefined && request.channel !== 'bank')) throw error('仅支持境内人民币银行支付', 400, 'UNSUPPORTED_PAYMENT_CHANNEL')
    const payee = request.payee ?? { name: request.payeeName, accountNumber: request.payeeAccountNo, bankCode: request.payeeBankCode, bankRegion: request.payeeBankRegion ?? 'CN' }
    if (!payee || typeof payee !== 'object' || Array.isArray(payee)) throw error('收款信息不合法')
    const accountNumber = text(payee.accountNumber, '收款账号', 34)
    if (!/^\d{6,34}$/.test(accountNumber) || (payee.bankRegion !== undefined && payee.bankRegion !== 'CN')) throw error('收款账号或地区不合法')
    return {
      sourceAccountId: uuid(request.sourceAccountId ?? request.fromAccountId, '托管账户编号'),
      consentId: uuid(request.consentId, '银行授权编号'), amountCents: cents(request.amountCents ?? request.amount, true), currency: 'CNY',
      payee: { name: text(payee.name, '收款户名', 140), accountNumber, bankCode: text(payee.bankCode, '收款行代码', 32), bankRegion: 'CN' },
      memo: request.memo === undefined || request.memo === '' ? '' : text(request.memo, '附言', 200),
    }
  }
  async function getPayment(ownerId, id) {
    const row = await one('SELECT * FROM banking.payment_intents WHERE id=$1 AND owner_id=$2', [uuid(id, '支付编号'), text(ownerId, '客户编号', 128)])
    if (!row) throw error('支付指令不存在', 404, 'PAYMENT_NOT_FOUND')
    return paymentDto(row)
  }
  async function record(paymentId, previous, next, receiptId = null) {
    await q('INSERT INTO banking.payment_events(payment_id,previous_status,next_status,receipt_id) VALUES($1,$2,$3,$4)', [paymentId, previous, next, receiptId])
  }
  async function createPayment(ownerId, request, key) {
    const owner = text(ownerId, '客户编号', 128), input = normalizeRequest(request), fingerprint = digest(canonical(input))
    if (typeof key !== 'string' || !/^[A-Za-z0-9_.:-]{8,128}$/.test(key)) throw error('必须提供有效的支付幂等键', 400, 'INVALID_IDEMPOTENCY_KEY')
    // A global provider preflight also ensures absent / unconfigured banks fail closed.
    await availableProviders()
    encrypted()
    return db.transaction(async () => {
      await lock(`bank-connect-payment:${owner}:${key}`)
      const previous = await one('SELECT * FROM banking.payment_intents WHERE owner_id=$1 AND idempotency_key=$2 FOR UPDATE', [owner, key])
      if (previous) {
        if (previous.request_sha256 !== fingerprint) throw error('幂等键已用于不同支付内容', 409, 'IDEMPOTENCY_CONFLICT')
        await connected(previous.provider_id, true)
        return { ...paymentDto(previous), repeated: true }
      }
      const account = await one('SELECT * FROM banking.account_links WHERE id=$1 AND owner_id=$2 FOR UPDATE', [input.sourceAccountId, owner])
      if (!account || account.state !== 'active' || account.currency !== 'CNY' || !account.verified_at) throw error('托管账户不可用于支付', 403, 'BANK_ACCOUNT_UNAVAILABLE')
      await connected(account.provider_id, true)
      const consent = await one(`SELECT * FROM banking.consents WHERE id=$1 AND owner_id=$2 AND provider_id=$3 AND account_link_id=$4 FOR SHARE`, [input.consentId, owner, account.provider_id, account.id])
      if (!consent || consent.revoked_at || new Date(consent.granted_at).getTime() > now() || new Date(consent.expires_at).getTime() <= now() || !consent.scopes.includes('payments:initiate')) throw error('银行支付授权已失效或范围不足', 403, 'BANK_CONSENT_REQUIRED')
      const id = randomUUID(), row = await one(`INSERT INTO banking.payment_intents
        (id,owner_id,provider_id,source_account_id,consent_id,idempotency_key,request_sha256,payee_cipher,amount_cents,currency,status)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'CNY','awaiting_authorization') RETURNING *`,
      [id, owner, account.provider_id, account.id, consent.id, key, fingerprint, cipher.seal({ payee: input.payee, memo: input.memo }, `banking.payment_intents:${id}:payee`), input.amountCents])
      await record(id, null, 'awaiting_authorization')
      return paymentDto(row)
    })
  }
  function normalizeReceipt(value, adapter) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw error('银行回执验签失败', 401, 'INVALID_BANK_RECEIPT')
    const verificationMethod = value.verificationMethod
    if (!['bank_signature', 'bank_mtls_query', 'test_fixture'].includes(verificationMethod) || (verificationMethod === 'test_fixture' && (process.env.NODE_ENV !== 'test' || environment !== 'test' || adapter.driver !== 'test_fixture'))) throw error('银行回执验证方式不可用', 401, 'INVALID_BANK_RECEIPT')
    const occurred = new Date(value.occurredAt).getTime()
    if (!Number.isFinite(occurred) || occurred > now() + 300_000) throw error('银行事件时间不合法', 400, 'INVALID_BANK_RECEIPT')
    if (value.currency !== 'CNY') throw error('银行回执币种不匹配', 409, 'BANK_RECEIPT_MISMATCH')
    const event = { eventId: text(value.eventId, '银行事件编号'), type: value.type, currency: 'CNY', occurredAt: new Date(occurred).toISOString() }
    if (event.type === 'account.balance') {
      Object.assign(event, { accountLinkId: uuid(value.accountLinkId, '托管账户编号'), balanceCents: cents(value.balanceCents), availableCents: cents(value.availableCents), sequence: cents(value.sequence) })
    } else {
      if (!PAYMENT_EVENTS.has(event.type)) throw error('不支持的银行回执类型', 400, 'INVALID_BANK_RECEIPT')
      Object.assign(event, { paymentId: uuid(value.paymentId, '支付编号'), sourceAccountId: uuid(value.sourceAccountId, '托管账户编号'), amountCents: cents(value.amountCents, true), bankPaymentReference: value.bankPaymentReference == null ? null : text(value.bankPaymentReference, '银行支付参考号'), bankAuthorizationReference: value.bankAuthorizationReference == null ? null : text(value.bankAuthorizationReference, '银行授权参考号') })
      if (!['payment.rejected', 'payment.cancelled'].includes(event.type) && !event.bankPaymentReference) throw error('缺少银行支付参考号', 409, 'BANK_RECEIPT_MISMATCH')
      if (event.type === 'payment.authorized' && !event.bankAuthorizationReference) throw error('缺少银行授权参考号', 409, 'BANK_RECEIPT_MISMATCH')
    }
    return { event, verificationMethod, verificationReference: text(value.verificationReference, '银行验签依据', 500) }
  }
  async function processBankReceipt(providerId, rawBody, headers) {
    const provider = uuid(providerId, '银行接入编号')
    if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) throw error('银行回执必须提供原始请求字节', 400, 'INVALID_BANK_RECEIPT')
    if (rawBody.length > 1024 * 1024) throw error('银行回执不得超过 1MB', 413, 'INVALID_BANK_RECEIPT')
    const { adapter } = await connected(provider)
    encrypted()
    let verified
    try { verified = await adapter.verifyReceipt(Buffer.from(rawBody), Object.freeze({ ...headers })) }
    catch { throw error('银行回执认证失败', 401, 'INVALID_BANK_RECEIPT') }
    const { event, verificationMethod, verificationReference } = normalizeReceipt(verified, adapter), bodyHash = digest(rawBody)
    return db.transaction(async () => {
      await connected(provider, true)
      await lock(`bank-connect-receipt:${provider}:${event.eventId}`)
      const previous = await one('SELECT * FROM banking.receipts WHERE provider_id=$1 AND provider_event_id=$2', [provider, event.eventId])
      if (previous) {
        if (previous.body_sha256 !== bodyHash || canonical(previous.normalized_json) !== canonical(event)) throw error('银行事件编号对应不同内容', 409, 'BANK_RECEIPT_CONFLICT')
        return { receiptId: previous.id, paymentId: previous.payment_id, repeated: true, applied: false }
      }
      let payment, account
      if (event.type === 'account.balance') {
        account = await one('SELECT * FROM banking.account_links WHERE id=$1 AND provider_id=$2 FOR UPDATE', [event.accountLinkId, provider])
        if (!account || account.currency !== event.currency || account.state !== 'active') throw error('银行余额回执账户不匹配', 409, 'BANK_RECEIPT_MISMATCH')
      } else {
        payment = await one('SELECT * FROM banking.payment_intents WHERE id=$1 AND provider_id=$2 FOR UPDATE', [event.paymentId, provider])
        if (!payment || payment.source_account_id !== event.sourceAccountId || Number(payment.amount_cents) !== event.amountCents || payment.currency !== event.currency || (payment.bank_payment_reference && payment.bank_payment_reference !== event.bankPaymentReference) || (event.bankAuthorizationReference && payment.bank_authorization_reference && payment.bank_authorization_reference !== event.bankAuthorizationReference)) throw error('银行回执与支付指令不一致', 409, 'BANK_RECEIPT_MISMATCH')
      }
      const receiptId = randomUUID()
      await q(`INSERT INTO banking.receipts(id,provider_id,provider_event_id,payment_id,event_type,body_sha256,body_cipher,normalized_json,verification_method,verification_reference,verified_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11)`, [receiptId, provider, event.eventId, payment?.id ?? null, event.type, bodyHash, cipher.seal({ encoding: 'base64', body: rawBody.toString('base64') }, `banking.receipts:${receiptId}:body`), JSON.stringify(event), verificationMethod, verificationReference, new Date(now()).toISOString()])
      if (account) {
        const applied = account.bank_sequence == null || event.sequence > Number(account.bank_sequence)
        if (applied) await q('UPDATE banking.account_links SET bank_balance_cents=$1,bank_available_cents=$2,bank_sequence=$3,balance_observed_at=$4 WHERE id=$5', [event.balanceCents, event.availableCents, event.sequence, event.occurredAt, account.id])
        return { receiptId, accountLinkId: account.id, applied }
      }
      const previousStatus = payment.status
      if (FINAL.has(previousStatus)) {
        await record(payment.id, previousStatus, previousStatus, receiptId)
        return { receiptId, paymentId: payment.id, status: previousStatus, applied: false, reason: 'PAYMENT_ALREADY_FINAL' }
      }
      let next = previousStatus
      if (event.type === 'payment.authorized' && previousStatus === 'awaiting_authorization') {
        next = 'queued'
        await q(`UPDATE banking.payment_intents SET status='queued',bank_payment_reference=$1,bank_authorization_reference=$2,authorization_receipt_id=$3,authorization_verified_at=$4,updated_at=now() WHERE id=$5`, [event.bankPaymentReference, event.bankAuthorizationReference, receiptId, new Date(now()).toISOString(), payment.id])
        await q('INSERT INTO banking.outbox(id,payment_id) VALUES($1,$2) ON CONFLICT(payment_id) DO NOTHING', [randomUUID(), payment.id])
        // Bank events may arrive out of order. A previously authenticated settlement
        // becomes applicable only once its matching authorization is also recorded.
        const settlement = await one(`SELECT * FROM banking.receipts WHERE payment_id=$1 AND provider_id=$2
          AND event_type='payment.succeeded' AND normalized_json->>'bankPaymentReference'=$3
          ORDER BY received_at,id LIMIT 1`, [payment.id, provider, event.bankPaymentReference])
        if (settlement) {
          await record(payment.id, previousStatus, 'queued', receiptId)
          await q("UPDATE banking.payment_intents SET status='succeeded',final_receipt_id=$1,bank_settled_at=$2,updated_at=now() WHERE id=$3", [settlement.id, settlement.normalized_json.occurredAt, payment.id])
          await q("UPDATE banking.outbox SET state='delivered',lease_token=NULL,leased_until=NULL WHERE payment_id=$1", [payment.id])
          await record(payment.id, 'queued', 'succeeded', settlement.id)
          return { receiptId, paymentId: payment.id, status: 'succeeded', applied: true, settledByEarlierReceipt: settlement.id }
        }
      } else if (event.type === 'payment.rejected') {
        next = 'rejected'
        await q("UPDATE banking.payment_intents SET status='rejected',final_receipt_id=$1,bank_payment_reference=COALESCE(bank_payment_reference,$2),updated_at=now() WHERE id=$3", [receiptId, event.bankPaymentReference, payment.id])
      } else if (event.type === 'payment.cancelled') {
        next = 'cancelled'
        await q("UPDATE banking.payment_intents SET status='cancelled',final_receipt_id=$1,updated_at=now() WHERE id=$2", [receiptId, payment.id])
      } else if (previousStatus !== 'awaiting_authorization' && event.type === 'payment.succeeded') {
        next = 'succeeded'
        await q("UPDATE banking.payment_intents SET status='succeeded',final_receipt_id=$1,bank_settled_at=$2,updated_at=now() WHERE id=$3", [receiptId, event.occurredAt, payment.id])
      } else if (previousStatus !== 'awaiting_authorization' && event.type === 'payment.unknown') {
        next = 'unknown'
        await q("UPDATE banking.payment_intents SET status='unknown',updated_at=now() WHERE id=$1", [payment.id])
      } else if (['queued', 'submitting', 'bank_pending', 'unknown'].includes(previousStatus) && event.type === 'payment.pending' && previousStatus !== 'unknown') {
        next = 'bank_pending'
        await q("UPDATE banking.payment_intents SET status='bank_pending',updated_at=now() WHERE id=$1", [payment.id])
      }
      if (next === 'unknown') await q("UPDATE banking.outbox SET state='unknown',lease_token=NULL,leased_until=NULL,last_error_code='BANK_RESULT_UNKNOWN' WHERE payment_id=$1 AND state<>'dead'", [payment.id])
      else if (FINAL.has(next) || event.type === 'payment.pending') await q("UPDATE banking.outbox SET state='delivered',lease_token=NULL,leased_until=NULL WHERE payment_id=$1 AND state<>'dead'", [payment.id])
      await record(payment.id, previousStatus, next, receiptId)
      return { receiptId, paymentId: payment.id, status: next, applied: next !== previousStatus, ...(next === previousStatus ? { reason: 'NO_VALID_FORWARD_TRANSITION' } : {}) }
    }).catch(cause => {
      if (cause?.code === '23505') throw error('银行参考号已绑定其他支付或事件', 409, 'BANK_RECEIPT_CONFLICT')
      throw cause
    })
  }
  // Recovery does not retry a potentially transmitted payment. An authenticated
  // bank query or receipt must resolve every unknown outcome before further action.
  async function expireOutboxLeases({ limit = 50 } = {}) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw error('租约批量大小不合法')
    return db.transaction(async () => {
      const rows = await q(`SELECT p.id,p.status,o.id AS outbox_id FROM banking.payment_intents p JOIN banking.outbox o ON o.payment_id=p.id
        WHERE o.state='leased' AND o.leased_until<=now() ORDER BY o.leased_until,o.id LIMIT $1 FOR UPDATE OF p,o SKIP LOCKED`, [limit])
      for (const row of rows) {
        await q("UPDATE banking.outbox SET state='unknown',lease_token=NULL,leased_until=NULL,last_error_code='DISPATCH_OUTCOME_UNKNOWN' WHERE id=$1", [row.outbox_id])
        if (!FINAL.has(row.status) && row.status !== 'awaiting_authorization') {
          await q("UPDATE banking.payment_intents SET status='unknown',updated_at=now() WHERE id=$1", [row.id])
          await record(row.id, row.status, 'unknown')
        }
      }
      return { expired: rows.length, automaticallyRetried: 0 }
    })
  }
  return { registerAdapter, readiness, listAccounts, getAccount, createPayment, getPayment, processBankReceipt, expireOutboxLeases }
}
