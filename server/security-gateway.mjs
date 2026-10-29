import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'

const digest = value => createHash('sha256').update(value).digest('hex')
const fail = (message, status, code) => { throw Object.assign(new Error(message), { status, code }) }
const IDEMPOTENT_METHODS = new Set(['submitTransfer', 'recallTransfer', 'submitExchange', 'subscribeWealth', 'redeemWealth', 'applyLoan', 'repayLoan', 'deposit', 'spendOnCard', 'openCard', 'replaceCard', 'createInvestPlan', 'updateInvestPlan'])
for (const method of ['createScheduledTransfer', 'cancelScheduledTransfer', 'createSplitCollection', 'cancelSplitCollection', 'confirmSplitPayment', 'remindSplitParticipant', 'reportCardLost', 'recoverCard', 'createBirthdayPlan', 'cancelBirthdayPlan', 'confirmBirthdayOrder', 'updatePayeeRemark']) IDEMPOTENT_METHODS.add(method)
// These operations currently have sandbox implementations only. Live processing must
// be routed to an approved partner adapter, never fall through to the local simulator.
const PARTNER_OPERATIONS = new Set([
  'createScheduledTransfer', 'cancelScheduledTransfer', 'createSplitCollection', 'confirmSplitPayment',
  'remindSplitParticipant', 'cancelSplitCollection', 'reportCardLost', 'recoverCard',
  'createBirthdayPlan', 'cancelBirthdayPlan', 'confirmBirthdayOrder',
  'submitTransfer', 'recallTransfer', 'submitExchange', 'subscribeWealth', 'redeemWealth',
  'openCard', 'replaceCard', 'createVirtualCard', 'activateOverdraft', 'applyLoan',
  'repayLoan', 'convertToInstallment', 'repayInstallment', 'updateCashSweep',
  'createInvestPlan', 'updateInvestPlan', 'enrollInsurance', 'subscribeMembership', 'cancelMembership',
  'registerFps', 'deposit', 'buyInsurance', 'claimInviteReward', 'setCardLock',
  'updateCardSettings', 'revealCardSecrets', 'reportCardLost', 'recoverCard', 'setAutoDebitEnabled', 'updateSavingsRoundup',
])
export async function createSecurityGateway(db, auth) {
  const context = new AsyncLocalStorage()
  const production = process.env.NODE_ENV === 'production'
  const mode = process.env.BANK_INTEGRATION_MODE ?? (production ? 'live' : 'sandbox')
  if (!['sandbox', 'live'].includes(mode)) throw new Error('Invalid BANK_INTEGRATION_MODE')
  if (production && mode !== 'live') throw new Error('Production requires BANK_INTEGRATION_MODE=live; use an isolated test environment for sandbox business')
  if (process.env.BANK_AUTO_MIGRATE !== 'false') await db.exec(`CREATE TABLE IF NOT EXISTS bank_security_limits (
    scope TEXT NOT NULL, subject TEXT NOT NULL, started_at BIGINT NOT NULL,
    attempts INTEGER NOT NULL CHECK (attempts > 0), PRIMARY KEY(scope,subject));
    CREATE TABLE IF NOT EXISTS bank_sms_challenges (
    phone TEXT PRIMARY KEY, salt TEXT NOT NULL, code_hash TEXT NOT NULL,
    expires_at BIGINT NOT NULL, sent_at BIGINT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0));
    CREATE TABLE IF NOT EXISTS bank_identity_tickets (
    token_hash TEXT PRIMARY KEY, subject TEXT NOT NULL, expires_at BIGINT NOT NULL);
    CREATE TABLE IF NOT EXISTS bank_idempotency (
    owner_id TEXT NOT NULL, key TEXT NOT NULL, path TEXT NOT NULL, request_hash TEXT NOT NULL,
    response_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(owner_id,key));
    CREATE TABLE IF NOT EXISTS bank_request_audit (
    id TEXT PRIMARY KEY, owner_id TEXT, method TEXT NOT NULL, path TEXT NOT NULL,
    result TEXT NOT NULL, created_at TEXT NOT NULL);`)
  async function subject() {
    const req = context.getStore()
    try { return `customer:${(await auth.identity(req)).id}` } catch (error) {
      // A database failure must not silently turn an authenticated customer into a client.
      if (error?.code !== 'UNAUTHORIZED') throw error
    }
    const ip = req?.socket?.remoteAddress ?? 'internal'
    // Only the local reverse proxy is trusted to supply the original address.
    const forwarded = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip) ? req?.headers?.['x-real-ip'] : null
    return `client:${digest(String(forwarded ?? ip).slice(0, 100))}`
  }
  async function lock(key) { await db.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))').get(key) }
  async function limit(scope, value, max, windowMs) {
    const key = digest(String(value).slice(0, 256)), now = Date.now()
    // One atomic UPSERT prevents lost increments across pool connections / replicas.
    const row = await db.prepare(`INSERT INTO bank_security_limits (scope, subject, started_at, attempts) VALUES(?,?,?,1)
      ON CONFLICT(scope,subject) DO UPDATE SET
        attempts=CASE WHEN bank_security_limits.started_at > ? THEN bank_security_limits.attempts+1 ELSE 1 END,
        started_at=CASE WHEN bank_security_limits.started_at > ? THEN bank_security_limits.started_at ELSE excluded.started_at END
      RETURNING attempts`).get(scope, key, now, now - windowMs, now - windowMs)
    if (row.attempts > max) fail('操作过于频繁，请稍后重试', 429, 'RATE_LIMITED')
  }
  return {
    mode,
    run: (req, work) => context.run(req, work),
    async loginAttempt(phone) {
      await limit('login-phone', phone, 10, 15 * 60_000)
      await limit('login-client', await subject(), 40, 15 * 60_000)
    },
    capability(name) {
      if (mode === 'live') fail(`尚未配置${name}外部服务，当前操作不可用`, 503, 'INTEGRATION_NOT_CONFIGURED')
    },
    async sendSms(phone) {
      if (typeof phone !== 'string' || !/^1[3-9]\d{9}$/.test(phone)) fail('请输入 11 位手机号', 400, 'INVALID_PHONE')
      this.capability('短信')
      return db.transaction(async () => {
        await lock(`sms:${digest(phone)}`)
        const old = await db.prepare('SELECT sent_at FROM bank_sms_challenges WHERE phone=?').get(phone)
        if (old && Date.now() - Number(old.sent_at) < 60_000) fail('请在一分钟后重新发送验证码', 429, 'SMS_TOO_FREQUENT')
        await limit('sms-client', await subject(), 20, 60 * 60_000)
        const code = String(randomInt(100000, 1000000)), salt = randomBytes(16).toString('hex'), now = Date.now()
        await db.prepare(`INSERT INTO bank_sms_challenges (phone, salt, code_hash, expires_at, sent_at, attempts) VALUES(?,?,?,?,?,0)
          ON CONFLICT(phone) DO UPDATE SET salt=excluded.salt,code_hash=excluded.code_hash,
          expires_at=excluded.expires_at,sent_at=excluded.sent_at,attempts=0`)
          .run(phone, salt, digest(salt + code), now + 300_000, now)
        return { sent: true, expiresAt: new Date(now + 300_000).toISOString(), demoCode: code }
      })
    },
    async verifySms(phone, code) {
      this.capability('短信')
      await db.transaction(async () => {
        const row = await db.prepare('SELECT * FROM bank_sms_challenges WHERE phone=? FOR UPDATE').get(phone)
        if (!row) fail('请先获取短信验证码', 400, 'SMS_NOT_SENT')
        if (Number(row.expires_at) <= Date.now()) fail('验证码已过期，请重新获取', 400, 'SMS_EXPIRED')
        if (row.attempts >= 5) fail('验证码已锁定，请重新获取', 429, 'SMS_LOCKED')
        const supplied = digest(row.salt + String(code ?? ''))
        if (!timingSafeEqual(Buffer.from(supplied), Buffer.from(row.code_hash))) {
          throw Object.assign(new Error('验证码不正确'), { status: 400, code: 'BAD_SMS_CODE', smsPhone: phone, smsChallengeHash: row.code_hash })
        }
        await db.prepare('DELETE FROM bank_sms_challenges WHERE phone=?').run(phone)
      })
    },
    async issueIdentityTicket(channel) {
      this.capability('实名核验')
      if (!['face', 'sms'].includes(channel)) fail('无效验证方式', 400, 'INVALID_CHANNEL')
      const token = randomBytes(32).toString('base64url')
      await db.prepare('DELETE FROM bank_identity_tickets WHERE expires_at<?').run(Date.now())
      await db.prepare('INSERT INTO bank_identity_tickets (token_hash, subject, expires_at) VALUES(?,?,?)').run(digest(token), await subject(), Date.now() + 300_000)
      return { ticket: token }
    },
    async consumeIdentityTicket(token) {
      this.capability('实名核验')
      const row = await db.prepare('DELETE FROM bank_identity_tickets WHERE token_hash=? AND subject=? AND expires_at>? RETURNING token_hash').get(digest(String(token ?? '')), await subject(), Date.now())
      if (!row) fail('身份验证已失效，请重新验证', 403, 'IDENTITY_REQUIRED')
    },
    async before(req, method, body) {
      if (mode === 'live' && PARTNER_OPERATIONS.has(method)) this.capability('合作银行支付或产品')
      if (['register', 'changePhone', 'openWealthAccount'].includes(method)) await this.consumeIdentityTicket(body.faceTicket)
      // 支付密码核身重置：没带原密码就必须有人脸票据；凭原密码修改不消耗票据
      if (method === 'changePaymentPassword' && !body.oldPassword) await this.consumeIdentityTicket(body.faceTicket)
      if (method === 'submitTransfer') {
        if (!['bank', 'fps'].includes(body.channel) || !['domestic', 'overseas'].includes(body.scope)) fail('无效转账渠道或范围', 400, 'INVALID_TRANSFER_CHANNEL')
        if (!(body.payeeBankCode === 'LCB' && body.payeeBankRegion === 'CN' && body.scope === 'domestic' && body.channel === 'bank')) this.capability('跨行清算')
      }
      if (['runIdentityOcr', 'runIdentityLiveness'].includes(method)) this.capability('实名核验')
    },
    async afterRollback(error) {
      if (error?.code === 'BAD_SMS_CODE' && error.smsPhone && error.smsChallengeHash) await db.prepare('UPDATE bank_sms_challenges SET attempts=attempts+1 WHERE phone=? AND code_hash=?').run(error.smsPhone, error.smsChallengeHash)
      if (error?.loginOwner !== undefined) await auth.failure(error.loginOwner ? { id: error.loginOwner } : null)
    },
    // Both calls must run inside the same business db.transaction. The transaction
    // lock spans lookup, financial mutation and response INSERT, including across servers.
    async idempotent(req, method, body, result) {
      if (!IDEMPOTENT_METHODS.has(method)) return null
      const key = req.headers['idempotency-key']
      if (key === undefined) return null
      if (typeof key !== 'string' || !/^[\w.:-]{8,128}$/.test(key)) fail('无效幂等键', 400, 'INVALID_IDEMPOTENCY_KEY')
      const owner = (await auth.identity(req)).id, path = req.url.split('?')[0], hash = digest(canonical(body))
      await lock(`bank-idempotency:${owner}:${key}`)
      const row = await db.prepare('SELECT * FROM bank_idempotency WHERE owner_id=? AND key=?').get(owner, key)
      if (row) {
        if (row.path !== path || row.request_hash !== hash) fail('幂等键已用于不同请求', 409, 'IDEMPOTENCY_CONFLICT')
        return { hit: true, value: JSON.parse(row.response_json) }
      }
      if (result !== undefined) await db.prepare('INSERT INTO bank_idempotency (owner_id, key, path, request_hash, response_json, created_at) VALUES(?,?,?,?,?,?)').run(owner,key,path,hash,JSON.stringify(result),new Date().toISOString())
      return null
    },
  }
}
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  // Payment credentials never enter the idempotency fingerprint: a deterministic
  // SHA-256 over a six-digit PIN would be trivially brute-forceable at rest.
  if (value && typeof value === 'object') return `{${Object.keys(value).filter(k => k !== 'paymentPassword').sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`
  return JSON.stringify(value)
}
