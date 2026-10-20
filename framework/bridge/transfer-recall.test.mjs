import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { createBankAgent } from './bank-agent.mjs'
import { fixture, ok, login, account, financialState, reconcile, testOptions, routes } from '../../server/testing/http-fixture.mjs'

const input = (toolName, args, sessionId = 'owner') => ({ sessionId, callId: randomUUID(), challengeId: randomUUID(), toolName, arguments: args, expiresAt: Date.now() + 60000 })

test('recall confirmation validates authoritative currency, principal and reservation, including legacy holds', async t => {
  const token = 'a'.repeat(43), sessions = new Map([['owner', { ownerId: 'alice', bankToken: token, activity: {} }]])
  const tx = { id: 't1', accountId: 'usd', direction: 'out', category: 'transfer', status: 'pending', pendingReason: 'inflight',
    amount: 2000, heldFrozenAmount: 7000, holdUntil: new Date(Date.now() + 60000).toISOString(), detail: { settleCurrency: 'USD' } }
  let currency = 'USD', writes = 0
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401); return res.end('{}') }
    if (req.url === '/api/auth/profile') return res.end(JSON.stringify({ id: 'alice' }))
    if (req.url === '/api/transactions/t1') return res.end(JSON.stringify(tx))
    if (req.url === '/api/accounts/usd') return res.end(JSON.stringify({ id: 'usd', currency }))
    if (req.url === '/api/transfers/t1/recall') { writes++; return res.end(JSON.stringify({ transactionId: 't1', status: 'failed', memo: '已撤销' })) }
    res.writeHead(404); res.end('{}')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const bank = createBankAgent({ baseUrl: `http://127.0.0.1:${server.address().port}`, sessions, publish() {} })
  t.after(async () => { bank.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) })
  const raw = input('bank_recall_transfer', { transactionId: 't1' }), card = await bank.prepare(raw)
  assert(card.fields.some(row => row.label === '本笔冻结合计' && row.value === 'USD 70.00'))
  assert(card.fields.some(row => row.label === '费用冻结' && row.value === 'USD 50.00'))
  assert.equal(card.verification, undefined); assert.equal(await bank.approveRoutineQuery(card), false)
  await assert.rejects(bank.execute(raw), /授权/)
  await bank.approve(card)
  currency = 'HKD'
  await assert.rejects(bank.execute(raw), /币种已变化/)
  assert.equal(writes, 0)
  currency = 'USD'
  const original = structuredClone(tx)
  for (const patch of [{ amount: -2000 }, { amount: 0.5 }, { heldFrozenAmount: 1999 }, { heldFrozenAmount: Number.MAX_SAFE_INTEGER + 1 }, { detail: { settleCurrency: 'HKD' } }]) {
    Object.assign(tx, original, patch)
    await assert.rejects(bank.prepare(input('bank_recall_transfer', { transactionId: 't1' })), /金额或币种数据不一致/)
  }
  for (const patch of [{ direction: 'in' }, { category: 'shopping' }, { pendingReason: 'clearing' }, { holdUntil: 'invalid' }, { holdUntil: new Date(Date.now() - 1).toISOString() }]) {
    Object.assign(tx, original, patch)
    await assert.rejects(bank.prepare(input('bank_recall_transfer', { transactionId: 't1' })), /不能撤回/)
  }
  Object.assign(tx, original); delete tx.heldFrozenAmount
  const legacyRaw = input('bank_recall_transfer', { transactionId: 't1' }), legacy = await bank.prepare(legacyRaw)
  assert(legacy.fields.some(row => row.label === '本笔冻结合计' && row.value === 'USD 20.00'))
  assert(legacy.fields.some(row => row.value.includes('历史指令只记录本金冻结')))
  await bank.approve(legacy); await bank.execute(legacyRaw)
  assert.equal(writes, 1)
  await assert.rejects(bank.execute(legacyRaw), /授权/)
})

test('real local bank Agent transfers and recalls USD only after exact consent and rejects stale or foreign recalls', { ...testOptions, timeout: 60000 }, async t => {
  const backend = await fixture({ reviewThreshold: 1000, holdSeconds: 300 })
  t.after(() => backend.close())
  const owner = await login(backend, '13800138000'), other = await login(backend, '13600136000')
  const exchange = { fromAccountId: owner.accounts[0].id, toCurrency: 'USD', amount: 250000 }
  const quote = ok(await backend.call(routes.exchangeQuote(), { method: 'POST', token: owner.token, body: exchange }))
  ok(await backend.call(routes.exchange(), { method: 'POST', token: owner.token, body: { ...exchange, quoteId: quote.quoteId, paymentPassword: '888888' } }))
  const usd = ok(await backend.call(routes.accounts(), { token: owner.token }))[0].currencyBalances.find(row => row.currency === 'USD')
  const baseline = await account(backend, owner, usd.id), cny = await account(backend, owner)
  const sessions = new Map([['owner', { ownerId: owner.user.id, bankToken: owner.token, activity: {} }], ['other', { ownerId: other.user.id, bankToken: other.token, activity: {} }]])
  const events = [], bank = createBankAgent({ baseUrl: backend.base, sessions, publish: (_id, event) => events.push(event) })
  t.after(() => bank.close())
  const transfer = async () => {
    const raw = input('bank_transfer', { fromAccountId: usd.id, amountCents: 2000, payeeCurrency: 'USD', payeeAccountNo: '6217000000000000123', payeeName: 'TEST ONLY recall recipient', payeeBankCode: '004', payeeBankRegion: 'HK' })
    const card = await bank.prepare(raw)
    assert.equal(card.verification, 'payment-password')
    await bank.approve(card, '888888')
    const result = (await bank.execute(raw)).result
    assert.equal(result.pendingReason, 'inflight')
    return result
  }
  const held = await transfer()
  assert.equal((await account(backend, owner, usd.id)).available, baseline.available - held.amount - held.fee)
  const raw = input('bank_recall_transfer', { transactionId: held.transactionId }), card = await bank.prepare(raw)
  assert(card.fields.some(row => row.label === '本笔冻结合计' && row.value === 'USD 70.00'))
  assert.equal(await bank.approveRoutineQuery(card), false)
  await assert.rejects(bank.execute(raw), /授权/)
  await assert.rejects(bank.prepare(input('bank_recall_transfer', raw.arguments, 'other')), error => error.status === 404)
  await bank.approve(card)
  await assert.rejects(bank.execute({ ...raw, arguments: { transactionId: 'another' } }), /授权/)
  const result = (await bank.execute(raw)).result
  assert.equal(result.transactionId, held.transactionId); assert.equal(result.status, 'failed'); assert.match(result.memo, /已撤销/)
  assert.equal((await account(backend, owner, usd.id)).available, baseline.available)
  assert.equal((await account(backend, owner, usd.id)).balance, baseline.balance)
  await assert.rejects(bank.execute(raw), /授权/)
  const next = await transfer(), staleRaw = input('bank_recall_transfer', { transactionId: next.transactionId })
  await bank.approve(await bank.prepare(staleRaw))
  ok(await backend.call(routes.transferRecall(next.transactionId), { method: 'POST', token: owner.token, body: {} }))
  const before = await financialState(backend), eventsBefore = events.length
  await assert.rejects(bank.execute(staleRaw), /交易状态或币种已变化/)
  assert.equal(events.length, eventsBefore); assert.deepEqual(await financialState(backend), before)
  assert.equal((await account(backend, owner)).balance, cny.balance)
  assert.equal((await account(backend, owner)).available, cny.available)
  assert.equal((await account(backend, owner, usd.id)).available, baseline.available)
  const transaction = ok(await backend.call(routes.transaction(held.transactionId), { token: owner.token }))
  assert(!JSON.stringify(transaction).includes('888888'), 'held request must not contain payment password')
  await reconcile(backend)
})
