import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createBankAgent } from './bank-agent.mjs'
import { previewBirthdayPlan } from '../../shared/linked-plans.mjs'

test('extended tools bind exact consent, current snapshots and secure passwords; report only actual sandbox states', async t => {
  const account = { id: 'a1', currency: 'CNY', label: '储蓄资金账户', accountNo: '8820000000001234', balance: 1000000, available: 1000000 }
  const card = { id: 'card1', productName: '测试卡', last4: '1234', status: 'active', onlinePayment: true, overseasPayment: true }
  const payee = { id: 'p1', name: '王明', remark: '房东', accountNo: '6222000000000000', lastUsedAt: new Date().toISOString() }
  const schedules = [], splits = [], birthdays = [], calls = [], events = []
  const contract = { id: 'debit1', merchant: '测试视频', amount: 9900, currency: 'CNY', enabled: true, nextRunAt: new Date(Date.now() + 7 * 86400000).toISOString(), cycle: '每月' }
  const product = { code: 'P1', name: '真实目录测试产品', risk: 'R1', minAmount: 100, stepAmount: 100, openEnded: true, term: '随时赎回', nav: 1, transactionFees: [{ label: '赎回费（持有不满 7 天）', rate: .005, holdingDaysLessThan: 7 }], ongoingFees: [] }
  const holding = { id: 'h1', productCode: 'P1', productName: product.name, shares: 1000, purchasedAt: new Date(Date.now() - 86400000).toISOString(), closed: false, redeemableShares: 1000 }
  const overview = { account: { opened: true }, risk: { done: true, expired: false, level: 'C2', expiresAt: new Date(Date.now() + 86400000).toISOString() }, holdings: [holding] }
  const profile = { user: { id: 'alice' }, accounts: [account] }
  let reminderExecutions = 0
  const reminders = { prepare: (_owner, op, args) => { assert.equal(op, 'create'); return { ...args, label: '本人微信', operation: 'create' } }, execute: (_owner, args) => { reminderExecutions++; return { id: 'rem1', status: 'scheduled', title: args.title } } }
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const bytes of req) raw += bytes
    const body = raw ? JSON.parse(raw) : undefined
    calls.push({ path: req.url, method: req.method, body, key: req.headers['idempotency-key'] })
    const send = (data, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)) }
    if (req.headers.authorization !== 'Bearer fixture-token') return send({}, 401)
    const url = new URL(req.url, 'http://localhost'), path = url.pathname
    if (path === '/api/auth/profile') return send(profile.user)
    if (path === '/api/auth/payment-password/verify') return body.paymentPassword === '888888' ? send({ verified: true }) : send({ message: '支付密码错误' }, 400)
    if (path === '/api/accounts/a1') return send(account)
    if (path === '/api/payees' && req.method === 'GET') return send([payee])
    if (path === '/api/payees/p1') { payee.remark = body.remark; return send(payee) }
    if (path === '/api/cards' && req.method === 'GET') return send([card])
    if (path === '/api/cards/card1/lost' || path === '/api/cards/card1/recover') {
      assert.equal(body.paymentPassword, '888888'); card.status = path.endsWith('/lost') ? 'lost' : 'active'; card.onlinePayment = false; card.overseasPayment = false; return send(card)
    }
    if (path === '/api/transfers/recipient') return send({ kind: 'external', accountNoMasked: '6222****0000' })
    if (path === '/api/transfers/scheduled' && req.method === 'GET') return send(schedules)
    if (path === '/api/transfers/scheduled' && req.method === 'POST') {
      assert.equal(body.paymentPassword, '888888'); assert.equal(body.confirmed, true)
      const plan = { ...body, id: 'schedule1', status: 'scheduled', version: 1, currency: 'CNY', fundsReserved: false }; delete plan.paymentPassword; schedules.push(plan); return send(plan)
    }
    if (path === '/api/transfers/scheduled/schedule1' && req.method === 'DELETE') { assert.equal(body.version, schedules[0].version); schedules[0].status = 'cancelled'; return send(schedules[0]) }
    if (path === '/api/transfers/splits' && req.method === 'GET') return send(splits)
    if (path === '/api/transfers/splits' && req.method === 'POST') {
      const row = { ...body, id: 'split1', version: 1, status: 'open', participants: body.participants.map((name, i) => ({ id: 'person' + i, name, amount: i === 0 ? 51 : 50, status: 'unpaid' })) }; splits.push(row); return send(row)
    }
    if (path === '/api/transfers/splits/split1/reminders') return send({ text: '请支付 AA 份额', delivered: false })
    if (path === '/api/transfers/splits/split1/payments') return send({ ...splits[0], status: 'complete' })
    if (path === '/api/transfers/splits/split1' && req.method === 'DELETE') return send({ ...splits[0], status: 'cancelled' })
    if (path === '/api/statistics/report') return send({ period: url.searchParams.get('period'), currency: url.searchParams.get('currency'), months: Array.from({ length: 12 }, (_, i) => ({ month: i + 1 })), totalExpense: 101 })
    if (path === '/api/wealth/products') return send([product])
    if (path === '/api/wealth/products/P1') return send(product)
    if (path === '/api/wealth/overview') return send(overview)
    if (path === '/api/wealth/redeem') return send({ holdingId: 'h1', amount: 995, fee: 5, settlementMode: 'sandbox-immediate' })
    if (path === '/api/autodebits') return send([contract])
    if (path === '/api/accounts/a1/transactions') return send({ page: 1, size: 200, total: 3, items: [60, 30, 0].map((days, i) => ({ id: 't' + i, accountId: 'a1', amount: 9900, signedAmount: -9900, direction: 'out', status: 'success', counterparty: '测试视频', category: 'subscription', createdAt: new Date(Date.now() - days * 86400000 - 1000).toISOString() })) })
    if (path === '/api/linked/birthdays/preview') return send(previewBirthdayPlan(profile, body))
    if (path === '/api/linked/birthdays' && req.method === 'GET') return send(birthdays)
    if (path === '/api/linked/birthdays' && req.method === 'POST') {
      assert.equal(body.paymentPassword, '888888'); assert.equal(body.confirmed, true)
      const plan = { ...previewBirthdayPlan(profile, body), id: 'birthday1', reservation: { status: 'held' }, status: 'reserved' }; birthdays.push(plan); return send(plan)
    }
    if (path === '/api/linked/birthdays/birthday1/cancel') return send({ ...birthdays[0], status: 'cancelled' })
    if (path === '/api/linked/birthdays/birthday1/order') return send({ ...birthdays[0], status: 'awaiting_merchant', order: { status: 'awaiting_merchant_connection', merchantOrderId: null } })
    send({ message: 'unhandled fixture: ' + path }, 404)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const bank = createBankAgent({ baseUrl: `http://127.0.0.1:${server.address().port}`, sessions: new Map([['s1', { ownerId: 'alice', bankToken: 'fixture-token', activity: {} }]]), publish: (_id, event) => events.push(event), reminders: () => reminders })
  t.after(async () => { bank.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) })
  let seq = 0
  const raw = (toolName, args) => ({ sessionId: 's1', callId: 'c' + ++seq, challengeId: 'h' + seq, toolName, arguments: args, expiresAt: Date.now() + 60000 })
  async function execute(name, args, password) {
    const request = raw(name, args), review = await bank.prepare(request)
    assert.equal(review.arguments, undefined)
    await assert.rejects(bank.execute(request), { code: 'CONSENT_REQUIRED' })
    await bank.approve(review, password)
    const result = await bank.execute(request)
    await assert.rejects(bank.execute(request), { code: 'CONSENT_REQUIRED' })
    return { result: result.result, review }
  }
  await assert.rejects(bank.prepare(raw('bank_schedule_transfer', { paymentPassword: '888888' })), /凭据/)
  assert.equal((await execute('bank_list_payees', { keyword: '房东' })).result.items[0].id, 'p1')
  await execute('bank_update_payee_remark', { payeeId: 'p1', remark: '房东新备注' })
  const scheduleArgs = { fromAccountId: 'a1', payeeName: '王明', payeeAccountNo: '6222000000000000', payeeBankCode: '102', amountCents: 100, executeAt: new Date(Date.now() + 180000).toISOString() }
  const schedule = await execute('bank_schedule_transfer', scheduleArgs, '888888')
  assert.equal(schedule.review.verification, 'payment-password'); assert.equal(schedule.result.fundsReserved, false)
  assert.match(calls.find(row => row.path === '/api/transfers/scheduled' && row.method === 'POST').key, /^agent_[a-f0-9]{64}$/)
  const stale = raw('bank_cancel_scheduled_transfer', { planId: 'schedule1' })
  await bank.approve(await bank.prepare(stale)); schedules[0].version++
  await assert.rejects(bank.execute(stale), /记录已变化/)
  assert.equal(calls.filter(row => row.method === 'DELETE').length, 0)
  await execute('bank_cancel_scheduled_transfer', { planId: 'schedule1' })
  assert.equal((await execute('bank_list_scheduled_transfers', {})).result[0].status, 'cancelled')
  await execute('bank_create_split_collection', { title: '晚餐', amountCents: 101, currency: 'CNY', participantNames: '["张三","李四"]' })
  assert.equal((await execute('bank_list_split_collections', {})).result.length, 1)
  assert.equal((await execute('bank_prepare_split_reminder', { collectionId: 'split1', participantId: 'person0' })).result.delivered, false)
  await execute('bank_confirm_split_payment', { collectionId: 'split1', participantId: 'person0', transactionId: 'observed-income' })
  await execute('bank_cancel_split_collection', { collectionId: 'split1' })
  assert.equal((await execute('bank_get_billing_report', { period: 'year', value: '2026', currency: 'CNY' })).result.months.length, 12)
  assert.equal((await execute('bank_wealth_recommend', { amountCents: 10000 })).result.matches[0].code, 'P1')
  assert.equal((await execute('bank_find_subscription_candidates', { accountId: 'a1' })).result.candidates.length, 1)
  await execute('bank_report_card_lost', { cardId: 'card1' }, '888888')
  await assert.rejects(bank.prepare(raw('bank_set_card_lock', { cardId: 'card1', locked: false })), /挂失/)
  await assert.rejects(bank.prepare(raw('bank_spend', { cardId: 'card1', platform: 'meituan', amountCents: 100 })), /挂失/)
  await execute('bank_recover_card', { cardId: 'card1' }, '888888')
  assert.equal(card.onlinePayment, false)
  const redemption = await execute('bank_wealth_redeem', { holdingId: 'h1' }, '888888')
  assert(redemption.review.fields.some(row => row.label === '赎回费用' && row.value === 'CNY 0.05'))
  const birthday = await execute('bank_create_birthday_plan', { contactName: '家人', relationship: '爱人', eventDate: new Date(Date.now() + 10 * 86400000 + 8 * 3600000).toISOString().slice(0, 10), amountCents: 100000, currency: 'CNY' }, '888888')
  assert.equal(birthday.review.verification, 'payment-password')
  assert.equal((await execute('bank_list_birthday_plans', {})).result.length, 1)
  assert.equal((await execute('bank_confirm_birthday_order', { planId: 'birthday1' })).result.order.merchantOrderId, null)
  await execute('bank_cancel_birthday_plan', { planId: 'birthday1' })
  const renewal = raw('bank_create_renewal_reminder', { autoDebitId: 'debit1' })
  const review = await bank.prepare(renewal)
  assert.equal(reminderExecutions, 0); assert.equal(await bank.approveRoutineQuery(review), false)
  await bank.approve(review); contract.amount++
  await assert.rejects(bank.execute(renewal), /签约项目已变化/)
  assert.equal(reminderExecutions, 0)
  assert.equal((await execute('bank_create_renewal_reminder', { autoDebitId: 'debit1' })).result.status, 'scheduled')
  assert.equal(reminderExecutions, 1)
  assert(events.some(event => event.type === 'bank-updated'))
})
