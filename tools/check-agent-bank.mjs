/** 无外部模型费用：真实 SQLite/HTTP 后端 + 账户绑定/确认/执行通道验证。 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'node:net'
import { randomUUID } from 'node:crypto'
import { createBankAgent } from '../framework/bridge/bank-agent.mjs'
const root = resolve(import.meta.dirname, '..')
const tmp = await mkdtemp(join(tmpdir(), 'luckycat-agent-'))
const socket = createServer(); await new Promise(r => socket.listen(0, '127.0.0.1', r)); const port = socket.address().port; await new Promise(r => socket.close(r))
const base = `http://127.0.0.1:${port}`
const child = spawn(process.execPath, ['server/index.mjs'], { cwd: root, env: { ...process.env, BANK_PORT: String(port), BANK_DB_FILE: join(tmp, 'bank.sqlite'), BANK_STATE_FILE: join(tmp, 'legacy.json') }, stdio: ['ignore', 'pipe', 'pipe'] })
let log = ''; child.stdout.on('data', x => log += x); child.stderr.on('data', x => log += x)
const sessions = new Map(); const events = []
const agent = createBankAgent({ baseUrl: base, sessions, publish: (_, e) => events.push(e) })
const call = async (path, token, body) => {
  const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const result = await response.json(); if (!response.ok) throw Object.assign(new Error(result.message), { status: response.status, code: result.code }); return result
}
const login = async phone => { const sms = await call('/api/auth/sms-code', null, { phone }); return call('/api/auth/login', null, { phone, password: '123456', smsCode: sms.demoCode }) }
const prepare = async (toolName, args, sessionId = 'a', ttl = 60_000) => {
  const c = { challengeId: randomUUID(), callId: randomUUID(), sessionId, toolName, arguments: args, createdAt: Date.now(), expiresAt: Date.now() + ttl }
  const challenge = await agent.prepare(c); return { c, challenge, input: { sessionId, callId: c.callId, toolName, arguments: args } }
}
const run = async (tool, args, password, sessionId = 'a') => { const p = await prepare(tool, args, sessionId); await agent.approve(p.challenge, password); return agent.execute(p.input) }
try {
  for (let n = 0; n < 100; n++) { if (child.exitCode !== null) throw new Error(log); try { if ((await fetch(base + '/health')).ok) break } catch {} await new Promise(r => setTimeout(r, 100)) }
  const a = await login('13800138000'); const b = await login('13600136000')
  sessions.set('a', { ownerId: a.user.id, bankToken: a.token }); sessions.set('b', { ownerId: b.user.id, bankToken: b.token })
  await assert.rejects(agent.authenticate(), e => e.status === 401)
  await assert.rejects(agent.owned(sessions.get('a'), { user: b.user, token: b.token }), e => e.status === 404)
  const balances = await run('bank_get_balance', {})
  const accounts = await call('/api/accounts', a.token)
  assert.deepEqual(balances.accounts, accounts); assert.equal(balances.dataSource, 'http')
  const other = await call('/api/accounts', b.token)
  assert.notEqual(accounts[0].accountNo, other[0].accountNo)
  await assert.rejects(run('bank_get_balance', { accountId: other[0].id }), e => e.status === 404)
  console.log('PASS 登录认证、跨账户会话拒绝，余额读取同一银行后端')
  const tx = await run('bank_list_transactions', { accountId: accounts[0].id, limit: 3 })
  assert(tx.result.items.length <= 3)
  if (tx.result.items[0]) { const detail = await run('bank_get_transaction_detail', { transactionId: tx.result.items[0].id }); assert.equal(detail.result.id, tx.result.items[0].id) }
  const products = await run('bank_wealth_quote', {}); assert(products.result.length > 0)
  assert.equal((await run('bank_wealth_quote', { productCode: products.result[0].code })).result.code, products.result[0].code)
  console.log('PASS 流水、交易详情、理财产品均返回 HTTP 数据')
  const transfer = { fromAccountId: accounts[0].id, payeeName: b.user.name, payeeAccountNo: other[0].accountNo, payeeBankCode: 'LCB', payeeBankRegion: 'CN', amountCents: 12345, memo: 'agent integration check' }
  await assert.rejects(prepare('bank_transfer', { ...transfer, payeeAccountNo: '9123' }), /完整收款账号/)
  const p = await prepare('bank_transfer', transfer)
  assert(p.challenge.fields.some(f => f.label === '完整收款账号' && f.value === other[0].accountNo)); assert.equal(p.challenge.verification, 'payment-password'); assert.equal(p.challenge.arguments, undefined)
  await assert.rejects(agent.execute(p.input), e => e.code === 'CONSENT_REQUIRED')
  await assert.rejects(agent.approve(p.challenge, '000000'), e => e.code === 'BAD_PAY_PASSWORD')
  assert.equal((await call('/api/accounts', a.token))[0].balance, accounts[0].balance)
  await agent.approve(p.challenge, '888888')
  await assert.rejects(agent.execute({ ...p.input, arguments: { ...transfer, amountCents: 54321 } }), e => e.code === 'CONSENT_REQUIRED')
  const result = await agent.execute(p.input); assert(result.result.referenceNo && !result.result.referenceNo.startsWith('LCB-DEMO'))
  assert.equal((await call('/api/accounts', a.token))[0].balance, accounts[0].balance - 12345)
  assert.equal((await call('/api/accounts', b.token))[0].balance, other[0].balance + 12345)
  await assert.rejects(agent.execute(p.input), e => e.code === 'CONSENT_REQUIRED')
  assert(events.some(e => e.type === 'bank-updated'))
  console.log('PASS 未确认/错密码/参数替换均不扣款，正确授权两侧入账且不能重放')
  const rejected = await prepare('bank_transfer', transfer); agent.forget(rejected.challenge); await assert.rejects(agent.execute(rejected.input), e => e.code === 'CONSENT_REQUIRED')
  const expired = await prepare('bank_get_balance', {}, 'a', 600); await new Promise(r => setTimeout(r, 700)); await assert.rejects(agent.approve(expired.challenge), e => e.status === 404)
  console.log('PASS 取消和过期授权不能执行')
  const cards = await call('/api/cards', a.token)
  const secret = await run('bank_reveal_card_secret', { cardId: cards[0].id, field: 'card-number' }, '888888')
  assert.equal(secret.displayed, true); assert(!('result' in secret)); assert(events.find(e => e.type === 'card-secret').value)
  await assert.rejects(prepare('bank_reveal_card_secret', { cardId: (await call('/api/cards', b.token))[0].id, field: 'cvv' }), e => e.status === 404)
  console.log('PASS 卡安全信息走临时事件，不返回给模型；拒绝他人卡片')
  const questions = await call('/api/wealth/risk/questions', a.token)
  await call('/api/wealth/risk/assess', a.token, { answers: questions.map(q => q.options.reduce((best, o, i, all) => o.score > all[best].score ? i : best, 0)) })
  const overview = await call('/api/wealth/overview', a.token)
  if (!overview.account.opened) {
    await import('./ts-resolve-hook.mjs')
    const { WEALTH_INVESTMENT_AGREEMENT } = await import('../app/src/lib/wealth.ts')
    const sms = await call('/api/auth/sms-code', a.token, { phone: a.user.phone })
    const face = await call('/api/security/verify', a.token, { channel: 'face' })
    await call('/api/wealth/account/open', a.token, { holderName: a.user.name, idNumber: '110101199001011234', smsCode: sms.demoCode, faceTicket: face.ticket, settlementAccountId: accounts[0].id, agreement: WEALTH_INVESTMENT_AGREEMENT })
  }
  const product = products.result.find(p => p.openEnded)
  const sub = await prepare('bank_wealth_subscribe', { productCode: product.code, amountCents: Math.max(product.minAmount, product.stepAmount) })
  assert(sub.challenge.riskAcknowledgementText)
  await assert.rejects(agent.approve(sub.challenge, '888888'), /完整抄录/)
  await agent.approve(sub.challenge, '888888', sub.challenge.riskAcknowledgementText)
  const subscribed = await agent.execute(sub.input)
  assert(subscribed.result.holding.id)
  const redeemed = await run('bank_wealth_redeem', { holdingId: subscribed.result.holding.id }, '888888')
  assert.equal(redeemed.result.holdingId, subscribed.result.holding.id)
  console.log('PASS 理财账户/风险条件、用户抄录要求、实际申购与赎回均接银行后端')
  const pending = await prepare('bank_transfer', transfer); await agent.approve(pending.challenge, '888888'); await call('/api/auth/logout', a.token, {}); await assert.rejects(agent.execute(pending.input), e => e.code === 'UNAUTHORIZED')
  console.log('PASS 注销后的会话与已有授权立即失效')
} finally { agent.close(); child.kill('SIGTERM'); await new Promise(r => child.exitCode === null ? child.once('exit', r) : r()); await rm(tmp, { recursive: true, force: true }) }
