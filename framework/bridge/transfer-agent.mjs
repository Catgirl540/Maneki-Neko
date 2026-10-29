import { bankError } from './bank-error.mjs'
const str = (v, label) => { if (typeof v !== 'string' || !v.trim()) throw bankError(`缺少${label}`); return v.trim() }
const enc = encodeURIComponent
const money = (n, c) => `${c} ${(n / 100).toFixed(2)}`
const field = (label, value, emphasis = false) => ({ label, value: String(value), ...(emphasis ? { emphasis: true } : {}) })
export function fullAccount(value) {
  const account = str(value, '完整收款账号').replace(/\s/g, '')
  if (!/^\d{12,19}$/.test(account)) throw bankError('请提供 12–19 位完整收款账号，不能仅使用尾号')
  return account
}
export function fpsIdentifier(method, value) {
  if (!['account', 'mobile', 'email', 'fpsid'].includes(method)) throw bankError('FPS 方式必须是 account、mobile、email 或 fpsid')
  const id = str(value, '完整 FPS 标识').replace(/\s/g, '')
  const valid = method === 'account' ? /^[a-zA-Z0-9]{6,24}$/.test(id)
    : method === 'mobile' ? /^[4-9]\d{7}$/.test(id)
      : method === 'fpsid' ? /^\d{7}$/.test(id) : id.length <= 60 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(id)
  if (!valid) throw bankError('FPS 标识格式不合法，请核对完整标识')
  return id
}
const quoteInput = b => ({ fromAccountId: b.fromAccountId, channel: b.channel, scope: b.scope, amount: b.amount, bankCode: b.payeeBankCode, bankRegion: b.payeeBankRegion, payeeCurrency: b.payeeCurrency })
const fxTerms = fx => fx ? Object.fromEntries(['fromCurrency', 'toCurrency', 'rate', 'fromAmount', 'toAmount', 'spread'].map(k => [k, fx[k]])) : null
const terms = (q, currency) => ({ version: 1, fromCurrency: currency, fee: q.fee, fx: fxTerms(q.fx) })
const recipientTerms = r => ({ name: r.name, bankCode: r.bankCode, bankRegion: r.bankRegion })
function checkQuote(q, body, currency) {
  if (!Number.isSafeInteger(q.fee) || q.fee < 0 || !Number.isFinite(q.singleLimit) || !Number.isFinite(q.maxAmount)) throw bankError('银行报价不完整', 502)
  if (body.amount > q.singleLimit) throw bankError('转账金额超过通道单笔上限')
  if (body.amount > q.maxAmount) throw bankError('账户可用余额不足')
  if (body.payeeCurrency !== currency && (!q.fx || q.fx.fromCurrency !== currency || q.fx.toCurrency !== body.payeeCurrency || q.fx.fromAmount !== body.amount || !Number.isFinite(q.fx.rate) || q.fx.rate <= 0 || !Number.isSafeInteger(q.fx.toAmount) || q.fx.toAmount <= 0 || !Number.isFinite(q.fx.spread))) throw bankError('银行未提供有效换汇报价', 502)
}
export async function prepareTransfer(a, fps, get, post) {
  const support = await get('/api/agent/transfer/requirements')
  if (support.transferPaymentPassword !== true || support.confirmedQuoteVersion !== 1 || (fps && !support.confirmedRecipient)) throw bankError('银行服务暂不支持安全转账，请稍后再试', 503)
  const account = await get(`/api/accounts/${enc(str(a.fromAccountId, '付款账户'))}`)
  if (!Number.isSafeInteger(a.amountCents) || a.amountCents <= 0) throw bankError('金额必须是大于 0 的整数分')
  const currency = a.payeeCurrency ?? (fps ? undefined : account.currency)
  if (!['CNY', 'HKD', 'USD'].includes(currency) || (fps && !['CNY', 'HKD'].includes(currency))) throw bankError('请明确有效收款币种；FPS 仅支持 CNY 或 HKD')
  const body = { fromAccountId: account.id, channel: fps ? 'fps' : 'bank', scope: fps ? 'overseas' : a.payeeBankRegion === 'HK' ? 'overseas' : 'domestic', amount: a.amountCents, payeeCurrency: currency, memo: typeof a.memo === 'string' ? a.memo.trim() : '' }
  let recipient, identifier, identityLabel = '完整收款账号'
  if (fps) {
    body.fpsMethod = a.fpsMethod
    identifier = fpsIdentifier(a.fpsMethod, a.fpsIdentifier)
    identityLabel = `FPS ${a.fpsMethod}`
    if (a.fpsMethod === 'account') {
      body.payeeAccountNo = identifier
      body.payeeName = str(a.payeeName, '收款户名')
      body.payeeBankCode = str(a.payeeBankCode, '香港收款银行代码')
      body.payeeBankRegion = 'HK'
    } else {
      body.fpsId = identifier
      const resolved = await post('/api/fps/resolve', { idType: a.fpsMethod, fpsId: identifier })
      if (!resolved.registered) throw bankError(resolved.reason || '该标识未登记 FPS')
      if (!resolved.name || !resolved.bankCode || resolved.bankRegion !== 'HK') throw bankError('FPS 登记信息不完整', 502)
      if (a.payeeBankCode !== undefined && a.payeeBankCode !== resolved.bankCode) throw bankError('指定银行与登记解析的收款银行不同，请核对后重新选择')
      recipient = recipientTerms(resolved)
      Object.assign(body, { payeeName: recipient.name, payeeBankCode: recipient.bankCode, payeeBankRegion: 'HK', confirmedRecipient: recipient })
    }
  } else {
    identifier = fullAccount(a.payeeAccountNo)
    Object.assign(body, { payeeName: str(a.payeeName, '收款人姓名'), payeeAccountNo: identifier, payeeBankCode: str(a.payeeBankCode, '收款银行'), payeeBankRegion: str(a.payeeBankRegion, '银行地区') })
    if (!['CN', 'HK'].includes(body.payeeBankRegion)) throw bankError('银行地区必须为 CN 或 HK')
    await post('/api/transfers/recipient', { bankCode: body.payeeBankCode, bankRegion: body.payeeBankRegion, accountOrCardNo: identifier, payeeName: body.payeeName })
  }
  const bank = (await get('/api/banks')).find(b => b.code === body.payeeBankCode && b.region === body.payeeBankRegion)
  if (!bank) throw bankError('收款银行不存在')
  if (!fps && bank.internal && currency !== account.currency) throw bankError('本行账户划转币种必须一致')
  const quote = await post('/api/transfers/quote', quoteInput(body))
  checkQuote(quote, body, account.currency)
  if (body.amount + quote.fee > account.available) throw bankError('可用余额不足以支付金额与手续费')
  const submitBefore = quote.fx ? Date.parse(quote.fx.quotedAt) + quote.fx.quoteTtlSeconds * 1000 : Date.now() + 180_000
  if (!Number.isFinite(submitBefore) || submitBefore <= Date.now()) throw bankError('报价已过期，请重新确认', 409, 'QUOTE_EXPIRED')
  body.confirmedQuote = { ...terms(quote, account.currency), submitBefore }
  const fields = [field('付款账户', `${account.label} · 尾号 ${account.accountNo.slice(-4)}`), field('通道', fps ? 'FPS' : body.scope === 'overseas' ? '跨境银行转账' : '境内银行转账'), field(recipient ? '收款人（登记掩码）' : '收款人', body.payeeName), field('收款银行', `${bank.name} · ${bank.region} ${bank.code}`), field(identityLabel, identifier), field('付款金额', money(body.amount, account.currency), true), field('收款币种', currency), field('手续费', money(quote.fee, account.currency)), field('付款合计', money(body.amount + quote.fee, account.currency), true), field('预计到账', quote.etaText), field('备注', body.memo || '无')]
  if (quote.fx) fields.push(field('换汇汇率', `1 ${account.currency} = ${quote.fx.rate} ${currency}`), field('换汇后收款金额', money(quote.fx.toAmount, currency), true), field('报价有效至', new Date(submitBefore).toISOString()))
  if (quote.requiresConfirm) fields.push(field('大额提示', quote.confirmReason || '金额较大，请再次核对收款人和金额', true))
  return { path: '/api/transfers', body, fields, preview: { currency: account.currency, recipient }, submitBefore }
}
export async function refreshTransfer(body, preview, get, post) {
  if (Date.now() >= body.confirmedQuote.submitBefore) throw bankError('转账报价已过期，请重新确认', 409, 'QUOTE_EXPIRED')
  const account = await get(`/api/accounts/${enc(body.fromAccountId)}`)
  const q = await post('/api/transfers/quote', quoteInput(body))
  checkQuote(q, body, account.currency)
  const confirmed = { ...body.confirmedQuote }; delete confirmed.submitBefore
  if (JSON.stringify(terms(q, account.currency)) !== JSON.stringify(confirmed)) throw bankError('手续费或换汇报价已变化，请重新确认', 409, 'QUOTE_CHANGED')
  if (body.amount + q.fee > account.available) throw bankError('可用余额不足以支付金额与手续费')
  if (preview.recipient) {
    const r = await post('/api/fps/resolve', { idType: body.fpsMethod, fpsId: body.fpsId })
    if (!r.registered || JSON.stringify(recipientTerms(r)) !== JSON.stringify(preview.recipient)) throw bankError('FPS 收款登记已变化，请重新确认', 409, 'RECIPIENT_CHANGED')
  }
}
