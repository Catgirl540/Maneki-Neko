import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createBankAgent } from './bank-agent.mjs'
import { monthlyBudgetsOverview, saveMonthlyBudget, removeMonthlyBudget } from '../../shared/monthly-budgets.mjs'
import { referenceExchangeRates } from '../../shared/fx-rates.mjs'

test('focused query tools return month totals, holdings and numerical rates; monthly target requires one-use confirmation', async t => {
  const db = { accounts: [{ id: 'a', currency: 'CNY' }], transactions: [] }, calls = []
  let invalidRates = false
  const rates = () => referenceExchangeRates(db, { CNY: 1, USD: 7.1562, HKD: .91547 }, .0035)
  const sessions = new Map([['s', { ownerId: 'alice', bankToken: 'fixture', activity: {} }]])
  const server = createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json')
    const send = (body, status = 200) => { res.writeHead(status); res.end(JSON.stringify(body)) }
    if (req.headers.authorization !== 'Bearer fixture') return send({}, 401)
    let raw = ''; for await (const chunk of req) raw += chunk
    const body = raw ? JSON.parse(raw) : undefined, url = new URL(req.url, 'http://localhost')
    calls.push({ path: url.pathname, method: req.method, body })
    try {
      if (url.pathname === '/api/auth/profile') return send({ id: 'alice' })
      if (url.pathname === '/api/analysis/spending') return send({ month: url.searchParams.get('month'), total: 12345, byCurrency: { CNY: { total: 12345 } } })
      if (url.pathname === '/api/wealth/overview') return send({ holdings: [{ id: 'h1', marketValue: 23400 }], totalMarketValue: 23400, risk: { done: false } })
      if (url.pathname === '/api/exchange/rates') return send(invalidRates ? { rates: [] } : rates())
      if (url.pathname === '/api/budgets/monthly') return send(req.method === 'GET' ? monthlyBudgetsOverview(db, url.searchParams.get('month') ?? undefined) : req.method === 'DELETE' ? removeMonthlyBudget(db, body) : saveMonthlyBudget(db, body))
      return send({ message: 'unexpected route' }, 404)
    } catch (error) { return send({ message: error.message, code: error.code }, error.status ?? 500) }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const bank = createBankAgent({ baseUrl: `http://127.0.0.1:${server.address().port}`, sessions, publish() {} })
  t.after(async () => { bank.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) })
  let sequence = 0
  const raw = (toolName, args) => ({ toolName, arguments: args, sessionId: 's', callId: 'c' + ++sequence, challengeId: 'h' + sequence, expiresAt: Date.now() + 60000 })
  const execute = async (name, args) => { const input = raw(name, args); const review = await bank.prepare(input); await bank.approve(review); return (await bank.execute(input)).result }
  assert.equal((await execute('bank_get_spending', { month: '2026-11' })).total, 12345)
  const wealth = await execute('bank_get_wealth_overview', {})
  assert.equal(wealth.holdings[0].id, 'h1'); assert.equal(wealth.risk.status, 'unassessed')
  const fx = await execute('bank_get_exchange_rates', { fromCurrency: 'CNY', toCurrency: 'USD' })
  assert.equal(fx.rates.length, 1); assert.equal(fx.rates[0].rate, rates().rates.find(row => row.fromCurrency === 'CNY' && row.toCurrency === 'USD').rate)
  assert.equal(fx.source, 'sandbox-reference'); assert.equal(fx.marketAsOf, null)
  for (const path of ['/api/analysis/spending', '/api/wealth/overview', '/api/exchange/rates']) assert.equal(calls.filter(row => row.path === path).length, 1)
  assert(!calls.some(row => ['/api/accounts', '/api/cards', '/api/analysis/billing-report'].includes(row.path)))
  const input = raw('bank_set_monthly_budget', { month: '2026-11', currency: 'CNY', category: 'dining', limitCents: 200000 })
  const review = await bank.prepare(input)
  assert(review.fields.some(row => row.label === '说明' && row.value.includes('不阻止支付')))
  await assert.rejects(bank.execute(input), { code: 'CONSENT_REQUIRED' })
  assert.equal(db.monthlyBudgets, undefined)
  await bank.approve(review)
  const saved = (await bank.execute(input)).result
  assert.equal(saved.limit, 200000); assert.equal(saved.category, 'dining'); assert.equal(saved.month, '2026-11')
  await assert.rejects(bank.execute(input), { code: 'CONSENT_REQUIRED' })
  const stale = raw('bank_set_monthly_budget', { month: '2026-11', currency: 'CNY', category: 'dining', limitCents: 300000 })
  const staleReview = await bank.prepare(stale)
  saveMonthlyBudget(db, { month: '2026-11', category: 'dining', currency: 'CNY', limit: 250000, version: 1 })
  await bank.approve(staleReview)
  await assert.rejects(bank.execute(stale), { code: 'VERSION_CONFLICT' })
  assert.equal(db.monthlyBudgets[0].limit, 250000)
  const deletionArgs = { month: '2026-11', currency: 'CNY', category: 'dining' }
  const deletion = raw('bank_delete_monthly_budget', deletionArgs)
  const deletionReview = await bank.prepare(deletion)
  assert(deletionReview.fields.some(row => row.label === '原目标' && row.value.includes('2500.00')))
  await assert.rejects(bank.execute(deletion), { code: 'CONSENT_REQUIRED' })
  assert.equal(db.monthlyBudgets.length, 1)
  saveMonthlyBudget(db, { month: '2026-11', currency: 'CNY', category: 'dining', limit: 260000, version: 2 })
  await bank.approve(deletionReview)
  await assert.rejects(bank.execute(deletion), { code: 'VERSION_CONFLICT' })
  const freshDelete = raw('bank_delete_monthly_budget', deletionArgs)
  const freshReview = await bank.prepare(freshDelete)
  await bank.approve(freshReview)
  assert.equal((await bank.execute(freshDelete)).result.deleted, true)
  assert.equal(db.monthlyBudgets.length, 0)
  await assert.rejects(bank.execute(freshDelete), { code: 'CONSENT_REQUIRED' })
  await assert.rejects(bank.prepare(raw('bank_delete_monthly_budget', deletionArgs)), { code: 'MONTHLY_BUDGET_NOT_FOUND' })
  assert.equal(calls.filter(c => c.method === 'DELETE').length, 2, 'unauthorized/replayed deletion never reaches bank')
  invalidRates = true
  await assert.rejects(execute('bank_get_exchange_rates', { fromCurrency: 'CNY', toCurrency: 'USD' }), /有效.*汇率/)
})
