/** 账户绑定、权威确认信息与一次性执行授权。银行 Bearer / 支付密码永不进入 harness。 */
import { createHash } from 'node:crypto'

export const bankError = (message, status = 400, code = 'AGENT_BANK_ERROR') => Object.assign(new Error(message), { status, code })
const enc = encodeURIComponent
const text = (value, label) => {
  if (typeof value !== 'string' || !value.trim()) throw bankError(`缺少${label}`)
  return value.trim()
}
const amount = value => {
  if (!Number.isSafeInteger(value) || value <= 0) throw bankError('金额必须是大于 0 的整数分')
  return value
}
const money = (cents, currency = 'CNY') => `${currency} ${(cents / 100).toFixed(2)}`
const stable = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v)
const digest = value => createHash('sha256').update(stable(value)).digest('hex')
const field = (label, value, emphasis = false) => ({ label, value: String(value), ...(emphasis ? { emphasis: true } : {}) })
const writable = new Set(['bank_transfer', 'bank_wealth_subscribe', 'bank_wealth_redeem', 'bank_reveal_card_secret'])

export function createBankAgent({ baseUrl, sessions, publish }) {
  const base = new URL(baseUrl)
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname))) throw bankError('银行服务必须使用 HTTPS 或本机回环地址')
  const grants = new Map()
  const key = (sessionId, callId) => `${sessionId}\0${callId}`
  async function call(token, path, body) {
    let response
    try {
      response = await fetch(new URL(path, base), { method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(12_000) })
    } catch { throw bankError('无法连接银行服务，请稍后重试', 503, 'BANK_UNREACHABLE') }
    let data
    try { data = await response.json() } catch { throw bankError('银行接口返回了无效响应', 502) }
    if (!response.ok) throw bankError(data.message ?? '银行请求失败', response.status, data.code)
    return data
  }
  async function authenticate(authorization) {
    const match = /^Bearer ([A-Za-z0-9_-]+)$/.exec(authorization ?? '')
    if (!match) throw bankError('请重新登录', 401, 'UNAUTHORIZED')
    const user = await call(match[1], '/api/auth/profile')
    return { user, token: match[1] }
  }
  async function owned(entry, identity) {
    if (!entry || entry.ownerId !== identity.user.id) throw bankError('会话不存在或不属于当前账户', 404, 'NOT_FOUND')
    entry.bankToken = identity.token
    return entry
  }
  async function current(sessionId) {
    const entry = sessions.get(sessionId)
    if (!entry?.bankToken) throw bankError('会话不存在或已失效', 401, 'UNAUTHORIZED')
    const identity = await authenticate(`Bearer ${entry.bankToken}`)
    await owned(entry, identity)
    return entry
  }
  async function prepare(challenge) {
    const entry = await current(challenge.sessionId)
    const a = challenge.arguments
    if (!a || typeof a !== 'object' || Array.isArray(a)) throw bankError('工具调用缺少绑定参数')
    if (Object.keys(a).some(k => /password|token|secret/i.test(k))) throw bankError('凭据不得通过模型工具参数传入')
    const get = path => call(entry.bankToken, path)
    const post = (path, body) => call(entry.bankToken, path, body)
    let path, body, fields, preview, riskAcknowledgementText
    switch (challenge.toolName) {
      case 'bank_get_balance': {
        path = a.accountId ? `/api/accounts/${enc(text(a.accountId, '账户编号'))}` : '/api/accounts'
        fields = [field('账户', a.accountId || '当前客户名下全部账户'), field('查询内容', '余额、可用余额、卡片概要和理财持仓')]
        break
      }
      case 'bank_list_transactions': {
        const id = text(a.accountId, '账户编号')
        const account = await get(`/api/accounts/${enc(id)}`)
        const limit = a.limit === undefined ? 10 : Math.min(20, Math.max(1, Math.trunc(a.limit)))
        if (!Number.isFinite(limit)) throw bankError('查询条数不合法')
        path = `/api/accounts/${enc(id)}/transactions?size=${limit}&keyword=${enc(a.keyword ?? '')}`
        fields = [field('账户', `${account.label} · ${account.currency}`), field('查询条数', limit), field('关键词', a.keyword || '全部')]
        break
      }
      case 'bank_get_transaction_detail':
        path = `/api/transactions/${enc(text(a.transactionId, '交易编号'))}`
        await get(path)
        fields = [field('交易编号', a.transactionId)]
        break
      case 'bank_transfer': {
        const account = await get(`/api/accounts/${enc(text(a.fromAccountId, '付款账户'))}`)
        const accountNo = text(a.payeeAccountNo, '完整收款账号').replace(/\s/g, '')
        if (!/^\d{8,34}$/.test(accountNo)) throw bankError('请提供完整收款账号，不能仅使用尾号')
        const name = text(a.payeeName, '收款人姓名')
        const bankCode = text(a.payeeBankCode, '收款银行')
        const bankRegion = text(a.payeeBankRegion, '收款银行地区')
        if (!['CN', 'HK'].includes(bankRegion)) throw bankError('银行地区必须为 CN 或 HK')
        const banks = await get('/api/banks')
        const bank = banks.find(b => b.code === bankCode && b.region === bankRegion)
        if (!bank) throw bankError('收款银行不存在')
        if (bankRegion !== 'CN' || account.currency !== 'CNY') throw bankError('助手目前仅支持境内人民币银行转账，跨境或换汇请使用转账页面')
        body = { fromAccountId: account.id, channel: 'bank', scope: 'domestic', payeeName: name, payeeAccountNo: accountNo, payeeBankCode: bankCode, payeeBankRegion: bankRegion, amount: amount(a.amountCents), memo: typeof a.memo === 'string' ? a.memo : '' }
        if (bankCode === 'LCB') {
          await post('/api/transfers/recipient', { bankCode, bankRegion, accountOrCardNo: accountNo, payeeName: name })
        }
        const quote = await post('/api/transfers/quote', { fromAccountId: account.id, channel: 'bank', scope: 'domestic', amount: body.amount, bankCode, bankRegion })
        path = '/api/transfers'
        fields = [field('付款账户', `${account.label} · 尾号 ${account.accountNo.slice(-4)}`), field('收款人', name), field('收款银行', bank.name), field('完整收款账号', accountNo), field('转账金额', money(body.amount), true), field('手续费', money(quote.fee)), field('预计到账', quote.etaText), field('备注', body.memo || '无')]
        preview = { fee: quote.fee }
        break
      }
      case 'bank_wealth_quote':
        path = a.productCode ? `/api/wealth/products/${enc(text(a.productCode, '产品代码'))}` : '/api/wealth/products'
        fields = [field('产品', a.productCode || '可用产品列表'), field('说明', '业绩比较基准不构成收益承诺')]
        break
      case 'bank_wealth_subscribe': {
        const product = await get(`/api/wealth/products/${enc(text(a.productCode, '产品代码'))}`)
        const requirements = await get('/api/agent/wealth/requirements')
        riskAcknowledgementText = requirements.riskAcknowledgementText
        const overview = await get('/api/wealth/overview')
        if (!overview.account.opened) throw bankError('请先在理财页面开立理财账户', 403)
        if (!overview.risk.done || overview.risk.expired) throw bankError('请先在理财页面完成风险测评', 403)
        const settlement = await get(`/api/accounts/${enc(overview.account.settlementAccountId)}`)
        preview = { product: digest({ nav: product.nav, fees: product.transactionFees }), settlementAccountId: settlement.id }
        const fee = product.transactionFees.find(f => f.label.startsWith('申购'))
        const feeCents = Math.round(amount(a.amountCents) * (fee?.rate ?? 0))
        path = '/api/wealth/subscribe'
        body = { productCode: product.code, amount: amount(a.amountCents) }
        fields = [field('产品', product.name), field('产品代码', product.code), field('风险等级', product.risk), field('申购金额', money(body.amount), true), field('内扣申购费', money(feeCents)), field('资金账户', `${settlement.label} · 尾号 ${settlement.accountNo.slice(-4)}`)]
        break
      }
      case 'bank_wealth_redeem': {
        const overview = await get('/api/wealth/overview')
        const holding = overview.holdings.find(h => h.id === text(a.holdingId, '持仓编号'))
        if (!holding) throw bankError('持仓不存在或不属于当前账户', 404)
        if (holding.closed) throw bankError('持仓尚在封闭期，暂不能赎回')
        if (a.shares !== undefined && (!Number.isFinite(a.shares) || a.shares <= 0 || a.shares > holding.shares)) throw bankError('赎回份额不合法')
        path = '/api/wealth/redeem'
        body = { holdingId: holding.id, ...(a.shares === undefined ? {} : { shares: a.shares }) }
        fields = [field('产品', holding.productName), field('持仓编号', holding.id), field('赎回份额', a.shares ?? holding.shares, true), field('说明', '到账金额与时间以银行受理结果为准')]
        break
      }
      case 'bank_reveal_card_secret': {
        const cards = await get('/api/cards')
        const card = cards.find(c => c.id === text(a.cardId, '卡片编号'))
        if (!card) throw bankError('卡片不存在或不属于当前账户', 404)
        if (!['card-number', 'cvv'].includes(a.field)) throw bankError('只能查看卡号或 CVV')
        path = `/api/cards/${enc(card.id)}/secrets`
        body = {}
        fields = [field('卡片', `${card.productName} · 尾号 ${card.last4}`), field('查看内容', a.field === 'cvv' ? 'CVV' : '完整卡号')]
        break
      }
      default: throw bankError('未支持的银行工具', 400)
    }
    if (!Number.isFinite(challenge.expiresAt) || challenge.expiresAt <= Date.now()) throw bankError('确认已过期')
    const verification = writable.has(challenge.toolName) ? 'payment-password' : undefined
    const prepared = { challenge: { ...challenge, arguments: undefined, fields, verification, ...(riskAcknowledgementText ? { riskAcknowledgementText } : {}), consequence: verification ? '确认并验证后提交银行服务；操作结果以银行回执为准。' : '查询结果会显示在对话中。' }, fingerprint: digest(a), path, body, preview, ownerId: entry.ownerId, approved: false }
    const k = key(challenge.sessionId, challenge.callId)
    if (grants.has(k)) throw bankError('工具调用已存在确认', 409)
    const ttl = Math.min(challenge.expiresAt - Date.now(), 180_000)
    prepared.timer = setTimeout(() => { prepared.password = undefined; grants.delete(k) }, ttl)
    prepared.timer.unref()
    grants.set(k, prepared)
    return prepared.challenge
  }
  function forget(challenge) {
    const k = key(challenge.sessionId, challenge.callId)
    const g = grants.get(k)
    if (g) { clearTimeout(g.timer); g.password = undefined; grants.delete(k) }
  }
  async function approve(challenge, password, riskAcknowledgement) {
    const entry = await current(challenge.sessionId)
    const g = grants.get(key(challenge.sessionId, challenge.callId))
    if (!g || g.challenge.challengeId !== challenge.challengeId || g.challenge.expiresAt <= Date.now()) throw bankError('确认已过期', 404)
    if (g.approved || g.approving) throw bankError('确认正在提交或已处理', 409)
    g.approving = true
    try {
      if (g.challenge.riskAcknowledgementText) {
        if (typeof riskAcknowledgement !== 'string' || riskAcknowledgement.trim() !== g.challenge.riskAcknowledgementText) throw bankError('请在确认卡中完整抄录风险确认语句')
        g.body.riskAcknowledgement = riskAcknowledgement.trim()
      }
      if (g.challenge.verification) await call(entry.bankToken, '/api/auth/payment-password/verify', { paymentPassword: password })
      g.password = g.challenge.verification ? password : undefined
      g.approved = true
    } finally { g.approving = false }
  }
  async function execute(input) {
    const entry = await current(input.sessionId)
    const k = key(input.sessionId, input.callId)
    const g = grants.get(k)
    if (!g || !g.approved || g.ownerId !== entry.ownerId || g.challenge.toolName !== input.toolName || g.fingerprint !== digest(input.arguments) || g.challenge.expiresAt <= Date.now()) throw bankError('缺少与本次参数匹配的用户授权', 403, 'CONSENT_REQUIRED')
    grants.delete(k) // 在任何异步调用前消费，防并行重放和重复扣款。
    clearTimeout(g.timer)
    try {
      let body = g.body
      if (input.toolName === 'bank_transfer') {
        await call(entry.bankToken, '/api/auth/payment-password/verify', { paymentPassword: g.password })
        const quote = await call(entry.bankToken, '/api/transfers/quote', { fromAccountId: body.fromAccountId, channel: 'bank', scope: 'domestic', amount: body.amount, bankCode: body.payeeBankCode, bankRegion: body.payeeBankRegion })
        if (quote.fee !== g.preview.fee) throw bankError('手续费已变化，请重新确认', 409)
      }
      if (input.toolName === 'bank_wealth_subscribe') {
        const product = await call(entry.bankToken, `/api/wealth/products/${enc(body.productCode)}`)
        const overview = await call(entry.bankToken, '/api/wealth/overview')
        if (digest({ nav: product.nav, fees: product.transactionFees }) !== g.preview.product || overview.account.settlementAccountId !== g.preview.settlementAccountId) throw bankError('产品净值、费用或资金账户已变化，请重新确认', 409)
      }
      if (input.toolName === 'bank_wealth_redeem') await call(entry.bankToken, '/api/auth/payment-password/verify', { paymentPassword: g.password })
      if (['bank_wealth_subscribe', 'bank_reveal_card_secret'].includes(input.toolName)) body = { ...body, paymentPassword: g.password }
      const data = await call(entry.bankToken, g.path, body)
      if (input.toolName === 'bank_reveal_card_secret') {
        const value = input.arguments.field === 'cvv' ? data.cvv : data.pan
        publish(input.sessionId, { type: 'card-secret', cardId: input.arguments.cardId, field: input.arguments.field, value, expiresAt: Date.now() + Math.min(60, Math.max(1, Number(data.revealSeconds) || 30)) * 1000 })
        return { dataSource: 'http', displayed: true, notice: '卡安全信息已在临时窗口展示，不进入助手对话。' }
      }
      if (input.toolName === 'bank_get_balance') {
        const cards = await call(entry.bankToken, '/api/cards')
        const overview = await call(entry.bankToken, '/api/wealth/overview')
        return { dataSource: 'http', accounts: Array.isArray(data) ? data : [data], cards: cards.map(c => ({ id: c.id, last4: c.last4, status: c.status })), holdings: overview.holdings, wealthAccount: overview.account, risk: overview.risk }
      }
      if (writable.has(input.toolName)) publish(input.sessionId, { type: 'bank-updated' })
      return { dataSource: 'http', result: data }
    } finally { g.password = undefined }
  }
  function close() { for (const g of grants.values()) { clearTimeout(g.timer); g.password = undefined }; grants.clear() }
  return { authenticate, owned, current, prepare, approve, forget, execute, close }
}
