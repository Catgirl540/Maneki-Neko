import './legacy-sqlite-fixture-disabled.mjs'
/** #7/#9: isolated SQLite fixtures, no external model or production data. */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { openBankDatabase, CURRENT_KEY, PROFILES_KEY } from '../server/database.mjs'
import { createDemoBank } from '../framework/bridge/demo-bank.mjs'
import { createCustomerAuth } from '../server/customer-auth.mjs'
const reload = process.argv[2] === '--reload'
const dir = reload ? process.argv[3] : mkdtempSync(join(tmpdir(), 'luckycat-issues-'))
let store = openBankDatabase(join(dir, 'bank.sqlite'), join(dir, 'absent.json'))
try {
  const bank = await createDemoBank({ searchFrom: resolve(import.meta.dirname, '..'), storage: store.storage, reviewThreshold: 500000, holdWindowMs: 0 })
  const { createMockApi } = await import('../app/src/api/mock/index.ts')
  const { loadDb, resetDb, persist, findProfileByPhone, activateDb, migrateProfile, emptyCustomerDomains, FX_MID_RATES, ledgerBalances } = await import('../app/src/api/mock/db.ts')
  const { ACCOUNT_OPENING_PLEDGE } = await import('../app/src/lib/account-opening.ts')
  const api = createMockApi()
  if (reload) {
    assert.equal(loadDb().schema, 19)
    assert.equal(loadDb().accounts[0].balance, 4321)
    assert(loadDb().transactions.some(t => t.memo === 'migration-preserve'))
    assert.equal(findProfileByPhone('13600136000').accounts[0].balance, 6543)
    assert.deepEqual(findProfileByPhone('13600136000').insurance.policies, [])
    assert.equal((await api.resolveFps('fpsid', '7654321')).registered, true)
    assert.equal((await api.listCards())[0].paymentEnabled, false)
    console.log('PASS 重启增量迁移全部客户；余额/流水/FPS/卡设置保留')
  } else {
    resetDb(); loadDb()
    const original = structuredClone(loadDb())
    const old = structuredClone(original); old.schema = 14; old.accounts[0].balance = old.accounts[0].available = 4321
    delete old.insurance; delete old.credit
    const migrated = migrateProfile(old)
    assert.equal(migrated.accounts[0].balance, 4321); assert.deepEqual(migrated.transactions, original.transactions)
    assert.deepEqual(migrated.insurance.policies, []); assert.throws(() => migrateProfile({ ...old, schema: 99 }))
    console.log('PASS 旧档案增量迁移保留资金/流水，未来版本拒绝覆盖')
    const balances = structuredClone(loadDb().accounts)
    const loan = { productId: 'loan_quick', accountId: original.accounts[0].id, amount: 100000, termMonths: 3, purpose: 'test', paymentPassword: '888888' }
    for (const amount of ['100000', NaN, Infinity, -1, 1.2, Number.MAX_SAFE_INTEGER + 1]) await assert.rejects(api.applyLoan({ ...loan, amount }), e => e.code === 'INVALID_AMOUNT')
    await assert.rejects(api.applyLoan({ ...loan, termMonths: '3' }), e => e.code === 'INVALID_TERM')
    await assert.rejects(api.applyLoan({ ...loan, paymentPassword: undefined }), e => e.code === 'INVALID_PAY_PASSWORD')
    await assert.rejects(api.enrollInsurance({ productId: original.insurance.products[0].id, insuredName: 'Test' }), e => e.code === 'INVALID_PAY_PASSWORD')
    assert.deepEqual(loadDb().accounts, balances)
    console.log('PASS 非整数金额/字符串期数/缺失支付密码拒绝，无余额变化')
    const depositAccountId = original.accounts[0].id
    const depositBefore = await api.getAccount(depositAccountId)
    const existingTransactionIds = new Set(loadDb().transactions.map(t => t.id))
    const depositAmount = 12345
    const deposited = await api.deposit(depositAccountId, depositAmount, 'card')
    const depositAfter = await api.getAccount(depositAccountId)
    assert.equal(deposited.balance, depositBefore.balance + depositAmount)
    assert.equal(deposited.available, depositBefore.available + depositAmount)
    assert.equal(deposited.balance, depositAfter.balance)
    assert.equal(deposited.available, depositAfter.available)
    const depositTransactions = loadDb().transactions.filter(t => !existingTransactionIds.has(t.id))
    assert.equal(depositTransactions.length, 1)
    const depositReceipt = await api.getTransaction(depositTransactions[0].id)
    assert.equal(depositReceipt.accountId, depositAccountId)
    assert.equal(depositReceipt.direction, 'in')
    assert.equal(depositReceipt.status, 'success')
    assert.equal(depositReceipt.amount, depositAmount)
    assert.equal(depositReceipt.signedAmount, depositAmount)
    assert.equal(depositReceipt.detail.balanceBefore, depositBefore.balance)
    assert.equal(depositReceipt.detail.balanceAfter, deposited.balance)
    console.log('PASS 转入响应与重新查询的余额/可用余额一致，同笔入账金额与回单一致')
    const spending = original.transactions.find(t => t.status === 'success' && t.direction === 'out' && t.category === 'shopping' && ['card','quickpay'].includes(t.detail.channel))
    assert(spending); await api.convertToInstallment(spending.id, { periods: 3 })
    await assert.rejects(api.convertToInstallment(spending.id, { periods: 3 }), e => e.code === 'ALREADY_INSTALLED')
    const transfer = original.transactions.find(t => t.category === 'transfer')
    await assert.rejects(api.convertToInstallment(transfer.id, { periods: 3 }), e => e.code === 'INVALID_TARGET')
    await assert.rejects(api.createInvestPlan({ productCode: 'CSI300', accountId: 'not-owned', amount: 10000, cycle: '每月', paymentPassword: '888888' }), e => e.status === 404)
    await assert.rejects(api.createInvestPlan({ productCode: 'CSI300', accountId: original.accounts[0].id, amount: 10000, cycle: '每月', paymentPassword: '888888' }), e => e.code === 'WEALTH_PREREQUISITE')
    const risk = (await api.getWealthOverview()).risk; assert.equal(risk.expired, false); assert.equal(risk.level, null); assert.equal(risk.score, null)
    console.log('PASS 分期唯一性/消费资格、定投账户归属与前置条件、未测评语义')
    const exchange = { fromAccountId: original.accounts[0].id, toCurrency: 'HKD', amount: 10000 }
    const quote = await api.quoteExchange(exchange)
    await assert.rejects(api.submitExchange({ ...exchange, amount: 10001, quoteId: quote.quoteId, paymentPassword: '888888' }), e => e.code === 'QUOTE_CHANGED')
    const prior = FX_MID_RATES.HKD; FX_MID_RATES.HKD *= 1.1
    await assert.rejects(api.submitExchange({ ...exchange, quoteId: quote.quoteId, paymentPassword: '888888' }), e => e.code === 'QUOTE_CHANGED')
    FX_MID_RATES.HKD = prior
    const result = await api.submitExchange({ ...exchange, quoteId: quote.quoteId, paymentPassword: '888888' })
    await assert.rejects(api.submitExchange({ ...exchange, quoteId: quote.quoteId, paymentPassword: '888888' }), e => e.code === 'QUOTE_EXPIRED')
    console.log('PASS 换汇报价绑定金额/汇率，不能重复扣款')
    const payer = loadDb(); const payerHKD = ledgerBalances(payer).find(a => a.id === result.toAccountId)
    payerHKD.balance = payerHKD.available = 1000000; persist()
    activateDb(findProfileByPhone('13600136000'))
    loadDb().currencyBalances ??= []
    loadDb().currencyBalances.push({ ...payerHKD, id: 'acc_recipient_hkd', accountNo: '8820000000999001', balance: 0, available: 0 }); persist()
    const registration = { idType: 'fpsid', id: '7654321', accountId: 'acc_recipient_hkd', region: 'HK', currency: 'HKD', paymentPassword: '888888' }
    await assert.rejects(api.registerFps({ ...registration, accountId: original.accounts[0].id }), e => e.status === 404)
    await assert.rejects(api.registerFps({ ...registration, region: 'CN' }), e => e.code === 'FPS_UNSUPPORTED')
    await assert.rejects(api.registerFps({ ...registration, id: '123' }), e => e.code === 'INVALID_FPS_ID')
    await api.registerFps(registration)
    await assert.rejects(api.registerFps(registration), e => e.code === 'FPS_DUPLICATE')
    const resolved = await api.resolveFps('fpsid', registration.id); assert(resolved.registered)
    activateDb(payer)
    const body = { fromAccountId: payerHKD.id, channel: 'fps', scope: 'overseas', fpsMethod: 'fpsid', fpsId: registration.id, payeeName: resolved.name, payeeBankCode: resolved.bankCode, payeeBankRegion: 'HK', payeeCurrency: 'HKD', amount: 10000, memo: 'registered-credit' }
    await assert.rejects(api.submitTransfer({ ...body, fpsId: '7654322' }), e => e.code === 'FPS_NOT_REGISTERED')
    const before = (await api.getAccount(payerHKD.id)).balance
    await api.submitTransfer(body)
    assert.equal((await api.getAccount(payerHKD.id)).balance, before - 10000)
    const credited = findProfileByPhone('13600136000')
    assert.equal(ledgerBalances(credited).find(a => a.id === 'acc_recipient_hkd').balance, 10000)
    assert.equal(credited.transactions.filter(t => t.memo === 'registered-credit' && t.direction === 'in').length, 1)
    console.log('PASS FPS唯一性/格式/地区/归属校验及双方账务')
    const heldApi = createMockApi({ reviewThreshold: 10000, holdWindowMs: 0 })
    const senderBefore = (await api.getAccount(payerHKD.id)).balance
    for (let i = 0; i < 2; i++) assert.equal((await heldApi.submitTransfer({ ...body, memo: `tick-credit-${i}` })).pendingReason, 'inflight')
    activateDb(findProfileByPhone('13600136000'))
    await bank.tickHolds(); await bank.tickHolds()
    assert.equal(ledgerBalances(loadDb()).find(a => a.id === 'acc_recipient_hkd').balance, 30000)
    assert.equal(loadDb().transactions.filter(t => t.memo.startsWith('tick-credit-') && t.direction === 'in').length, 2)
    activateDb(payer)
    assert.equal((await api.getAccount(payerHKD.id)).balance, senderBefore - 20000)
    for (const tx of loadDb().transactions.filter(t => t.memo.startsWith('tick-credit-'))) assert.equal(tx.status, 'success')
    console.log('PASS 多笔跨客户自动到账，收款方为扫描原上下文，重复扫账不重复入账')
    for (const phone of ['13900139000','13700137000']) {
      const sms = await api.sendSmsCode(phone), face = await api.verifyIdentity('face')
      await api.register({ phone, password: 'safe123', paymentPassword: '888888', holderName: '测试客户', idNumber: '310101199001011234', smsCode: sms.demoCode, faceTicket: face.ticket, pledge: ACCOUNT_OPENING_PLEDGE })
      const fresh = loadDb(), empty = emptyCustomerDomains(fresh.user, fresh.accounts[0].id)
      for (const key of ['virtualCards','insurance','credit','investments','savings','membership']) assert.deepEqual(fresh[key], empty[key])
      const info = await api.getReceivingInfo(); assert.equal(info.fpsRegistered, false); assert.equal(info.fpsMobile, ''); assert.equal(info.fpsId, '')
    }
    console.log('PASS 两个新客户新增域独立，未登记不返回样例 FPS')
    let clock = Date.now()
    let auth = createCustomerAuth(store.db, { lifetimeMs: 100, now: () => clock })
    const req = token => ({ headers: { authorization: `Bearer ${token}`, 'user-agent': 'Chrome password=never-store' } })
    const t1 = auth.issue(payer.user, req()), t2 = auth.issue(payer.user, req()), tb = auth.issue(credited.user, req())
    auth.failure(payer.user); auth.failure(null)
    const security = auth.security(req(t1), {})
    assert.equal(security.devices.filter(d => d.current).length, 1)
    assert.equal(security.devices.filter(d => d.active).length, 2)
    assert.equal(auth.security(req(tb), {}).devices.length, 1)
    assert(security.logs.some(l => l.action === '登录失败'))
    assert(!JSON.stringify(security).includes(t1)); assert(!JSON.stringify(security).includes('never-store'))
    auth.logout(req(t2)); assert.equal(auth.security(req(t1), {}).devices.filter(d => d.active).length, 1)
    clock += 101; assert.throws(() => auth.resolve(req(t1), 'security'), e => e.code === 'UNAUTHORIZED')
    const restartedToken = auth.issue(payer.user, req()); auth = createCustomerAuth(store.db)
    assert.throws(() => auth.resolve(req(restartedToken), 'security'))
    const renewed = auth.issue(payer.user, req())
    assert(auth.security(req(renewed), {}).logs.some(l => l.action === '会话过期'))
    assert.equal(auth.security(req(renewed), {}).devices.filter(d => d.active).length, 1)
    console.log('PASS 审计持久化、客户隔离、当前会话/退出/过期/重启状态，无密码令牌')
    activateDb(payer)
    const beforeFailure = structuredClone(loadDb())
    const write = store.storage.setItemsAtomically.bind(store.storage)
    let writes = 0
    store.storage.setItemsAtomically = entries => { if (++writes === 2) throw new Error('injected storage failure'); return write(entries) }
    await assert.rejects(api.applyLoan(loan), /写入失败/)
    store.storage.setItemsAtomically = write
    assert.deepEqual(loadDb().accounts, beforeFailure.accounts)
    assert.deepEqual(loadDb().credit.loans, beforeFailure.credit.loans)
    assert.deepEqual(loadDb().transactions, beforeFailure.transactions)
    console.log('PASS 借款最终写入失败回滚，余额/贷款/流水无部分写入')
    activateDb(payer); loadDb().cards[0].paymentEnabled = false
    loadDb().cards[0].channelLimits = { online: 100, offline: 200, overseas: 300 }; persist()
    assert.equal(JSON.parse(store.storage.getItem(CURRENT_KEY)).cards[0].paymentEnabled, false)
    const current = JSON.parse(store.storage.getItem(CURRENT_KEY)); current.schema = 14
    current.accounts[0].balance = current.accounts[0].available = 4321
    current.transactions.push({ ...current.transactions[0], id: 'txn_migration', memo: 'migration-preserve' }); delete current.insurance
    const all = JSON.parse(store.storage.getItem(PROFILES_KEY)); all[current.user.phone] = current
    all['13600136000'].schema = 14; all['13600136000'].accounts[0].balance = all['13600136000'].accounts[0].available = 6543; delete all['13600136000'].insurance
    store.storage.setItemsAtomically([[CURRENT_KEY, JSON.stringify(current)], [PROFILES_KEY, JSON.stringify(all)]])
    store.close(); store = null
    const restarted = spawnSync(process.execPath, [import.meta.filename, '--reload', dir], { encoding: 'utf8' })
    assert.equal(restarted.status, 0, restarted.stdout + restarted.stderr); process.stdout.write(restarted.stdout)
  }
} finally { store?.close(); if (!reload) rmSync(dir, { recursive: true, force: true }) }
