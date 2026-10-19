/** 账户绑定、权威确认信息与一次性执行授权。银行 Bearer / 支付密码永不进入 harness。 */
import { redactSupportText } from '../../shared/support.mjs'
import { createHash } from 'node:crypto'

import { bankError } from './bank-error.mjs'
export { bankError } from './bank-error.mjs'
import { prepareTransfer, refreshTransfer, fullAccount, fpsIdentifier } from './transfer-agent.mjs'
import { summarizeRiskAssessment } from './wealth-risk.mjs'
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
const passwordTools = new Set(['bank_transfer', 'bank_fps_transfer', 'bank_wealth_subscribe', 'bank_wealth_redeem', 'bank_reveal_card_secret', 'bank_apply_card', 'bank_replace_card'])
const writable = new Set([...passwordTools, 'bank_set_card_lock', 'bank_update_card_settings', 'bank_set_autodebit', 'bank_recall_transfer', 'bank_request_human_support', 'bank_reply_support_ticket'])
const routineQueries = new Set(['bank_get_balance', 'bank_list_transactions', 'bank_get_transaction_detail', 'bank_list_banks', 'bank_list_payees', 'bank_list_cards', 'bank_card_products', 'bank_list_autodebits', 'bank_get_spending', 'bank_get_cashflow', 'bank_list_support_tickets', 'bank_get_support_ticket'])
const boolean = (value, label) => { if (typeof value !== 'boolean') throw bankError(`${label}必须为布尔值`); return value }
const cardLabel = card => `${card.productName} · 尾号 ${card.last4}`
const safeCard = ({ shippingAddress, cardholder, ...card }) => card
const addressOf = a => {
  const address = Object.fromEntries(['recipient', 'phone', 'region', 'city', 'detail'].map(k => [k, text(a[k], '寄送地址 ' + k)]))
  if (!/^1[3-9]\d{9}$/.test(address.phone)) throw bankError('请输入 11 位手机号')
  if (address.detail.length < 5) throw bankError('详细地址至少 5 个字')
  if (a.postalCode !== undefined && a.postalCode !== '') {
    if (!/^\d{6}$/.test(a.postalCode)) throw bankError('邮政编码为 6 位数字')
    address.postalCode = a.postalCode
  }
  return address
}
const addressFields = address => [field('收件人', address.recipient), field('联系电话', address.phone), field('寄送地址', `${address.region} ${address.city} ${address.detail}`), field('邮政编码', address.postalCode || '未填写')]


export function createBankAgent({ baseUrl, sessions, publish }) {
  const base = new URL(baseUrl)
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname))) throw bankError('银行服务必须使用 HTTPS 或本机回环地址')
  const grants = new Map()
  const key = (sessionId, callId) => `${sessionId}\0${callId}`
  async function call(token, path, body, method = body === undefined ? 'GET' : 'POST') {
    let response
    try {
      response = await fetch(new URL(path, base), { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(12_000) })
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
    const activity = entry.activity
    if (entry.stopping || activity?.cancelled) throw bankError('本轮已停止', 409)
    const a = challenge.arguments
    if (!a || typeof a !== 'object' || Array.isArray(a)) throw bankError('工具调用缺少绑定参数')
    if (Object.keys(a).some(k => /password|token|secret/i.test(k))) throw bankError('凭据不得通过模型工具参数传入')
    const get = path => call(entry.bankToken, path)
    const post = (path, body) => call(entry.bankToken, path, body)
    let path, body, fields, preview, riskAcknowledgementText, method, submitBefore
    const ownedCard = async () => {
      const card = (await get('/api/cards')).find(c => c.id === text(a.cardId, '卡片编号'))
      if (!card) throw bankError('卡片不存在或不属于当前账户', 404)
      if (card.status === 'replaced') throw bankError('该卡已换卡，无法操作')
      return card
    }
    switch (challenge.toolName) {
      case 'bank_request_human_support': {
        const reason = text(a.reason, '问题描述')
        if (reason.length > 500) throw bankError('问题描述不超过 500 字')
        path = '/api/support/tickets'
        body = { reason: redactSupportText(reason), requestId: `agent_${digest([challenge.sessionId, challenge.callId, challenge.toolName])}` }
        fields = [field('操作', '提交人工服务工单', true), field('问题描述', body.reason), field('对话分享', '仅发送以上摘要，不附带完整对话或图片'), field('提交结果', '等待客服受理；这不会立即接通人工客服')]
        break
      }
      case 'bank_list_support_tickets': {
        const page = a.page ?? 1
        if (!Number.isSafeInteger(page) || page < 1 || page > 1_000_000) throw bankError('页码不合法')
        path = `/api/support/tickets?page=${page}`
        fields = [field('查询内容', '本人提交的人工工单'), field('页码', page)]
        break
      }
      case 'bank_get_support_ticket':
      case 'bank_reply_support_ticket': {
        const id = text(a.ticketId, '工单编号')
        const ticket = await get(`/api/support/tickets/${enc(id)}`)
        path = `/api/support/tickets/${enc(id)}`
        fields = [field('工单编号', id), field('问题描述', ticket.reason)]
        if (challenge.toolName === 'bank_reply_support_ticket') {
          const value = text(a.text, '补充留言')
          if (value.length > 2000) throw bankError('补充留言不超过 2000 字')
          if (ticket.status === 'resolved') throw bankError('工单已解决，请重新转人工', 409)
          path += '/messages'
          body = { text: redactSupportText(value), requestId: `agent_${digest([challenge.sessionId, challenge.callId, challenge.toolName])}` }
          fields.push(field('发送内容', body.text, true))
        } else fields.push(field('查询内容', '工单进度与人工回复'))
        break
      }
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
      case 'bank_transfer':
      case 'bank_fps_transfer': {
        ({ path, body, fields, preview, submitBefore } = await prepareTransfer(a, challenge.toolName === 'bank_fps_transfer', get, post))
        break
      }
      case 'bank_list_banks':
        if (a.region !== undefined && !['CN', 'HK'].includes(a.region)) throw bankError('银行地区必须为 CN 或 HK')
        path = '/api/banks'
        fields = [field('查询内容', '银行名称、地区与代码'), field('地区', a.region || '全部'), field('关键词', a.keyword || '全部')]
        break
      case 'bank_list_payees':
        path = '/api/payees'
        fields = [field('查询内容', '本人已保存收款人及完整收款标识'), field('关键词', a.keyword || '全部')]
        break
      case 'bank_resolve_fps':
        if (a.fpsMethod === 'account') throw bankError('银行账号方式需自行提供户名与香港银行代码，不能解析登记')
        path = '/api/fps/resolve'
        body = { idType: a.fpsMethod, fpsId: fpsIdentifier(a.fpsMethod, a.fpsIdentifier) }
        fields = [field('查询内容', 'FPS 登记掩码姓名与默认收款银行'), field('方式', body.idType), field('完整 FPS 标识', body.fpsId)]
        break
      case 'bank_verify_recipient': {
        if (!['CN', 'HK'].includes(a.bankRegion)) throw bankError('银行地区必须为 CN 或 HK')
        path = '/api/transfers/recipient'
        body = { bankCode: text(a.bankCode, '银行代码'), bankRegion: a.bankRegion, accountOrCardNo: fullAccount(a.accountNo), ...(a.payeeName === undefined ? {} : { payeeName: text(a.payeeName, '收款人姓名') }) }
        if (!(await get('/api/banks')).some(b => b.code === body.bankCode && b.region === body.bankRegion)) throw bankError('收款银行不存在')
        fields = [field('查询内容', '收款账户校验；外部银行不代表实名核验通过'), field('银行', `${body.bankRegion} ${body.bankCode}`), field('完整收款账号', body.accountOrCardNo)]
        break
      }
      case 'bank_recall_transfer': {
        const tx = await get(`/api/transactions/${enc(text(a.transactionId, '交易编号'))}`)
        if (tx.status !== 'pending' || tx.pendingReason !== 'inflight' || Date.parse(tx.holdUntil) <= Date.now() || !Number.isFinite(Date.parse(tx.holdUntil))) throw bankError('该交易已不能撤回，请查看最新交易状态', 409)
        path = `/api/transfers/${enc(tx.id)}/recall`
        body = {}
        preview = { recallState: digest(tx) }
        submitBefore = Date.parse(tx.holdUntil)
        fields = [field('操作', '撤回在途转账', true), field('交易编号', tx.id), field('金额', money(Math.abs(tx.amount), tx.detail.settleCurrency)), field('收款人', tx.counterparty || tx.title || '请核对交易详情'), field('在途截止', tx.holdUntil), field('影响', '解除本笔在途冻结；以银行撤回结果为准')]
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
      case 'bank_list_cards':
        path = '/api/cards'
        fields = [field('查询内容', '本人银行卡、状态、支付开关与日限额')]
        break
      case 'bank_card_products':
        path = '/api/cards/products'
        fields = [field('查询内容', '可申请卡产品、制卡与寄送费用')]
        break
      case 'bank_set_card_lock': {
        const card = await ownedCard()
        const locked = boolean(a.locked, '锁卡状态')
        // 寄送中卡片不能借解锁动作被激活。
        if (card.status === 'pending') throw bankError('卡片仍在寄送中，请在银行卡页面处理')
        path = `/api/cards/${enc(card.id)}/lock`
        body = { locked }
        preview = { cardState: digest(safeCard(card)) }
        fields = [field('卡片', cardLabel(card)), field('操作', locked ? '锁卡' : '解锁', true), field('影响', locked ? '关闭线上及境外支付；资金账户转账不受影响' : '支付开关不会自动恢复，请重新检查')]
        break
      }
      case 'bank_update_card_settings': {
        const card = await ownedCard()
        if (card.status === 'pending') throw bankError('卡片仍在寄送中，请在银行卡页面处理')
        body = {}
        fields = [field('卡片', cardLabel(card))]
        for (const [key, label] of [['onlinePayment', '线上支付'], ['overseasPayment', '境外支付']]) {
          if (a[key] === undefined) continue
          body[key] = boolean(a[key], label)
          fields.push(field(label, body[key] ? '开启' : '关闭', true))
        }
        if (a.dailyLimitCents !== undefined) {
          if (![200_000, 500_000, 1_000_000, 5_000_000].includes(a.dailyLimitCents)) throw bankError('日限额仅支持 2000、5000、10000 或 50000 元')
          body.dailyLimit = a.dailyLimitCents
          fields.push(field('银行卡日限额', money(body.dailyLimit), true))
        }
        if (!Object.keys(body).length) throw bankError('请指定要修改的卡片设置')
        if (card.status === 'locked' && (body.onlinePayment || body.overseasPayment)) throw bankError('卡片已锁定，请先解锁')
        path = `/api/cards/${enc(card.id)}/settings`
        method = 'PATCH'
        preview = { cardState: digest(safeCard(card)) }
        break
      }
      case 'bank_apply_card':
      case 'bank_replace_card': {
        const replacing = challenge.toolName === 'bank_replace_card'
        const card = replacing ? await ownedCard() : undefined
        const products = await get('/api/cards/products')
        const product = replacing ? products.find(p => p.network === card.network) : products.find(p => p.code === text(a.productCode, '卡产品代码'))
        if (!replacing && !product) throw bankError('卡产品不存在', 404)
        const accounts = await get('/api/accounts')
        const account = accounts[0]
        if (!account) throw bankError('没有可扣费资金账户')
        const fee = product ? product.issuingFee + product.deliveryFee : 2000
        const address = addressOf(a)
        body = { address, ...(!replacing ? { productCode: product.code } : {}) }
        path = replacing ? `/api/cards/${enc(card.id)}/replace` : '/api/cards/open'
        preview = { fee, accountId: account.id, ...(card ? { cardState: digest(safeCard(card)) } : {}) }
        fields = [field('操作', replacing ? '换卡' : '申请新卡'), field('卡片', replacing ? cardLabel(card) : product.name), field('费用合计', money(fee), true), field('扣费账户', `${account.label} · 尾号 ${account.accountNo.slice(-4)}`), ...addressFields(address), field('影响', replacing ? '旧卡将失效，新卡为寄送中' : '新卡为寄送中，支付开关初始关闭')]
        break
      }
      case 'bank_list_autodebits':
        path = '/api/autodebits'
        fields = [field('查询内容', '本人已签约自动扣款、金额、周期与启用状态')]
        break
      case 'bank_set_autodebit': {
        const item = (await get('/api/autodebits')).find(d => d.id === text(a.autoDebitId, '自动扣款编号'))
        if (!item) throw bankError('扣款计划不存在或不属于当前账户', 404)
        body = { enabled: boolean(a.enabled, '启用状态') }
        path = `/api/autodebits/${enc(item.id)}`
        method = 'PATCH'
        preview = { autoDebitState: digest(item) }
        fields = [field('签约服务', item.merchant), field('每期金额', money(item.amount)), field('扣款周期', item.cycle), field('操作', body.enabled ? '启用自动扣款' : '关闭自动扣款', true), field('说明', '仅管理已有签约；不会取消已产生账单或退款')]
        break
      }
      case 'bank_get_spending': {
        if (a.month !== undefined && !/^\d{4}-(0[1-9]|1[0-2])$/.test(a.month)) throw bankError('月份格式应为 YYYY-MM')
        path = '/api/analysis/spending' + (a.month ? `?month=${enc(a.month)}` : '')
        fields = [field('查询内容', '月度支出、分类构成与近期走势'), field('月份', a.month || '本月')]
        break
      }
      case 'bank_get_cashflow': {
        const days = a.days ?? 7
        if (![7, 30].includes(days)) throw bankError('现金流仅支持近 7 天或 30 天')
        path = `/api/analysis/cashflow?days=${days}`
        fields = [field('查询内容', `近 ${days} 天现金流与收支趋势`)]
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
    if (submitBefore) challenge = { ...challenge, expiresAt: Math.min(challenge.expiresAt, submitBefore) }
    if (!Number.isFinite(challenge.expiresAt) || challenge.expiresAt <= Date.now()) throw bankError('确认已过期')
    if (entry.stopping || activity?.cancelled || entry.activity !== activity) throw bankError('本轮已停止', 409)
    const verification = passwordTools.has(challenge.toolName) ? 'payment-password' : undefined
    const prepared = { challenge: { ...challenge, arguments: undefined, fields, verification, ...(riskAcknowledgementText ? { riskAcknowledgementText } : {}), consequence: challenge.toolName === 'bank_request_human_support' ? '确认后创建工单，可在助手 → 人工工单查看回复；不保证即时受理。' : challenge.toolName === 'bank_reply_support_ticket' ? '确认后将以上留言发送给人工客服。' : verification ? '确认并验证后提交银行服务；操作结果以银行回执为准。' : writable.has(challenge.toolName) ? '确认后提交银行服务，操作结果以银行回执为准。' : '查询结果会显示在对话中。' }, fingerprint: digest(a), path, body, method, preview, activity, ownerId: entry.ownerId, approved: false }
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
    if (entry.stopping || entry.activity?.cancelled) throw bankError('本轮已停止，未执行的授权已取消', 409)
    const k = key(input.sessionId, input.callId)
    const g = grants.get(k)
    if (!g || !g.approved || g.activity !== entry.activity || g.ownerId !== entry.ownerId || g.challenge.toolName !== input.toolName || g.fingerprint !== digest(input.arguments) || g.challenge.expiresAt <= Date.now()) throw bankError('缺少与本次参数匹配的用户授权', 403, 'CONSENT_REQUIRED')
    grants.delete(k) // 在任何异步调用前消费，防并行重放和重复扣款。
    clearTimeout(g.timer)
    try {
      let body = g.body
      if (['bank_transfer', 'bank_fps_transfer'].includes(input.toolName)) {
        await call(entry.bankToken, '/api/auth/payment-password/verify', { paymentPassword: g.password })
        await refreshTransfer(body, g.preview, path => call(entry.bankToken, path), (path, data) => call(entry.bankToken, path, data))
      }
      if (g.preview?.recallState) {
        const tx = await call(entry.bankToken, `/api/transactions/${enc(input.arguments.transactionId)}`)
        if (digest(tx) !== g.preview.recallState || tx.status !== 'pending' || tx.pendingReason !== 'inflight' || Date.parse(tx.holdUntil) <= Date.now()) throw bankError('交易状态已变化，请重新确认', 409)
      }
      if (input.toolName === 'bank_wealth_subscribe') {
        const product = await call(entry.bankToken, `/api/wealth/products/${enc(body.productCode)}`)
        const overview = await call(entry.bankToken, '/api/wealth/overview')
        if (digest({ nav: product.nav, fees: product.transactionFees }) !== g.preview.product || overview.account.settlementAccountId !== g.preview.settlementAccountId) throw bankError('产品净值、费用或资金账户已变化，请重新确认', 409)
      }
      if (input.toolName === 'bank_wealth_redeem') await call(entry.bankToken, '/api/auth/payment-password/verify', { paymentPassword: g.password })
      if (g.preview?.cardState) {
        const card = (await call(entry.bankToken, '/api/cards')).find(c => c.id === input.arguments.cardId)
        if (!card || digest(safeCard(card)) !== g.preview.cardState) throw bankError('卡片状态或设置已变化，请重新确认', 409)
      }
      if (['bank_apply_card', 'bank_replace_card'].includes(input.toolName)) {
        const products = await call(entry.bankToken, '/api/cards/products')
        const cards = await call(entry.bankToken, '/api/cards')
        const card = cards.find(c => c.id === input.arguments.cardId)
        const product = input.toolName === 'bank_apply_card' ? products.find(p => p.code === body.productCode) : products.find(p => p.network === card?.network)
        const fee = product ? product.issuingFee + product.deliveryFee : 2000
        const accounts = await call(entry.bankToken, '/api/accounts')
        if (fee !== g.preview.fee || accounts[0]?.id !== g.preview.accountId) throw bankError('卡片费用或扣费账户已变化，请重新确认', 409)
      }
      if (g.preview?.autoDebitState) {
        const item = (await call(entry.bankToken, '/api/autodebits')).find(d => d.id === input.arguments.autoDebitId)
        if (!item || digest(item) !== g.preview.autoDebitState) throw bankError('签约项目已变化，请重新确认', 409)
      }
      // 停止可能与重新核价并发，真正提交前再核对一次。
      if (entry.stopping || g.activity?.cancelled || g.activity !== entry.activity) throw bankError('本轮已停止，未提交银行操作', 409)
      if (['bank_wealth_subscribe', 'bank_reveal_card_secret', 'bank_apply_card', 'bank_replace_card'].includes(input.toolName)) body = { ...body, paymentPassword: g.password }
      const data = await call(entry.bankToken, g.path, body, g.method)
      if (input.toolName === 'bank_reveal_card_secret') {
        const value = input.arguments.field === 'cvv' ? data.cvv : data.pan
        publish(input.sessionId, { type: 'card-secret', cardId: input.arguments.cardId, field: input.arguments.field, value, expiresAt: Date.now() + Math.min(60, Math.max(1, Number(data.revealSeconds) || 30)) * 1000 })
        return { dataSource: 'http', displayed: true, notice: '卡安全信息已在临时窗口展示，不进入助手对话。' }
      }
      if (input.toolName === 'bank_get_balance') {
        const cards = await call(entry.bankToken, '/api/cards')
        const overview = await call(entry.bankToken, '/api/wealth/overview')
        return { dataSource: 'http', accounts: Array.isArray(data) ? data : [data], cards: cards.map(c => ({ id: c.id, last4: c.last4, status: c.status })), holdings: overview.holdings, wealthAccount: overview.account, risk: summarizeRiskAssessment(overview.risk) }
      }
      if (['bank_list_banks', 'bank_list_payees'].includes(input.toolName)) {
        const query = String(input.arguments.keyword ?? '').trim().toLowerCase()
        const rows = data.filter(item => (input.toolName !== 'bank_list_banks' || !input.arguments.region || item.region === input.arguments.region) && (!query || [item.name, item.bankName, item.code, item.accountNo, item.fpsId].some(v => typeof v === 'string' && v.toLowerCase().includes(query))))
        const notices = []
        if (input.toolName === 'bank_list_payees') notices.push('这里只查询当前客户已保存的收款人，不是全行账户查询。未找到不代表账号不存在或户名错误；新收款人无需先保存，信息齐全后请用 bank_verify_recipient 核验。')
        if (rows.length > 20) notices.push('请提供更具体的名称或银行地区以缩小范围，不得猜测未返回的信息。')
        return { dataSource: 'http', result: { items: rows.slice(0, 20).map(item => input.toolName === 'bank_list_banks' ? { code: item.code, region: item.region, name: item.name, internal: !!item.internal } : item), total: rows.length, truncated: rows.length > 20, ...(input.toolName === 'bank_list_payees' ? { scope: 'saved-payees' } : {}), ...(notices.length ? { notice: notices.join(' ') } : {}) } }
      }
      if (input.toolName === 'bank_list_cards') return { dataSource: 'http', result: data.map(safeCard) }
      if (writable.has(input.toolName)) publish(input.sessionId, { type: 'bank-updated' })
      return { dataSource: 'http', result: input.toolName.includes('card') && writable.has(input.toolName) ? safeCard(data) : data }
    } finally { g.password = undefined }
  }
  function forgetSession(sessionId) { for (const g of grants.values()) if (g.challenge.sessionId === sessionId) forget(g.challenge) }
  // Called only through the Bridge's active, authenticated IM binding gate.
  async function approveRoutineQuery(challenge) {
    const g = grants.get(key(challenge.sessionId, challenge.callId))
    if (!g || g.challenge.challengeId !== challenge.challengeId || g.challenge.toolName !== challenge.toolName
        || !routineQueries.has(g.challenge.toolName) || (g.method ?? 'GET') !== 'GET' || g.body !== undefined
        || g.challenge.verification || g.challenge.riskAcknowledgementText) return false
    await approve(g.challenge)
    return true
  }
  function close() { for (const g of grants.values()) { clearTimeout(g.timer); g.password = undefined }; grants.clear() }
  return { authenticate, owned, current, prepare, approve, approveRoutineQuery, forget, forgetSession, execute, close }
}
