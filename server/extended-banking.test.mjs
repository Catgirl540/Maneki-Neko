/** Real HTTP + disposable PostgreSQL. Never substitutes a customer database. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { fixture, ok, login, register, transfer, account, financialState, reconcile, testOptions, routes } from './testing/http-fixture.mjs'

const future = () => new Date(Date.now() + 3600000).toISOString()
async function eventually(read, accepts, label) {
  for (let index = 0; index < 40; index++) {
    const value = await read()
    if (accepts(value)) return value
    await delay(250)
  }
  assert.fail(`Timed out: ${label}`)
}
const indexRows = (app, owner) => app.database(async db => (await db.query('SELECT id,kind,due_at FROM bank_background_tasks WHERE owner_id=$1 ORDER BY id', [owner])).rows)
const scheduleList = (app, customer) => app.call(routes.scheduledTransfers(), { token: customer.token }).then(ok)
const birthdayList = (app, customer) => app.call(routes.birthdayPlans(), { token: customer.token }).then(ok)
const scheduleInput = (owner, recipient, amount, memo) => ({ ...transfer(owner, recipient, amount, memo), executeAt: future(), confirmed: true, clientRequestId: randomUUID(), paymentPassword: '888888' })
async function forceDue(app, owner, id) {
  await app.editCustomer(owner.user.id, profile => { profile.scheduledTransfers.find(row => row.id === id).executeAt = new Date(Date.now() - 2000).toISOString() })
}

test('scoped restart preserves an existing seeded customer history when another customer is current', { ...testOptions, timeout: 90000 }, async t => {
  const app = await fixture({ holdSeconds: 300 })
  t.after(() => app.close())
  const whale = await login(app, '13900000000'), other = await login(app, '13800138000')
  const deposited = ok(await app.call(routes.deposit(whale.accounts[0].id), {
    method: 'POST', token: whale.token, body: { amount: 137, channel: 'bank' },
  }))
  assert.equal(deposited.balance, whale.accounts[0].balance + 137)
  // Reproduce a process restart whose bounded current projection excludes the
  // seeded customer. Only the dedicated fixture database is modified here.
  await app.database(db => db.query("UPDATE profile_bindings SET owner_id=$1 WHERE storage_key='luckycat.mock.db'", [other.user.id]))
  const before = await financialState(app)
  const history = async () => app.database(async db => (await db.query('SELECT * FROM bank_transactions WHERE owner_id=$1 ORDER BY id', [whale.user.id])).rows)
  const originalHistory = await history()
  assert.equal(originalHistory.length, 1, 'the seeded customer must have actual persisted activity')
  assert.equal(originalHistory[0].amount_cents, 137)
  for (let restart = 0; restart < 2; restart++) {
    await app.restart()
    assert.deepEqual(await financialState(app), before)
    assert.deepEqual(await history(), originalHistory)
    assert.equal((await account(app, whale)).balance, before.accounts.find(row => row.owner_id === whale.user.id && row.id === whale.accounts[0].id).balance_cents)
    await reconcile(app)
  }
})

test('extended HTTP tasks persist, restart, execute once, retain recall approval and roll back injected settlement faults', { ...testOptions, timeout: 180000 }, async t => {
  const app = await fixture({ reviewThreshold: 1000, holdSeconds: 300 })
  t.after(() => app.close())
  const owner = await register(app, '13900000081', '定时测试甲'), recipient = await login(app, '13600136000')
  ok(await app.call(routes.deposit(owner.accounts[0].id), { method: 'POST', token: owner.token, body: { amount: 1000000, channel: 'bank' } }))
  const create = body => app.call(routes.scheduledTransfers(), { method: 'POST', token: owner.token, body }).then(ok)
  const schedule = await create(scheduleInput(owner, recipient, 123, 'TEST ONLY scheduled persistent'))
  const baseline = await Promise.all([account(app, owner), account(app, recipient)])
  assert.equal(schedule.status, 'scheduled'); assert.equal(schedule.fundsReserved, false)
  assert((await indexRows(app, owner.user.id)).some(row => row.id === schedule.id && row.kind === 'scheduled-transfer'))
  assert(!JSON.stringify(await indexRows(app, owner.user.id)).includes(recipient.user.name))
  assert.equal((await scheduleList(app, recipient)).length, 0)
  assert.equal((await app.call(routes.scheduledTransfer(schedule.id), { method: 'DELETE', token: recipient.token, body: { version: schedule.version } })).status, 404)
  await app.restart()
  assert.equal((await scheduleList(app, owner)).find(row => row.id === schedule.id).status, 'scheduled')
  assert.deepEqual(await Promise.all([account(app, owner), account(app, recipient)]), baseline)
  await forceDue(app, owner, schedule.id)
  const executed = await eventually(() => scheduleList(app, owner), rows => rows.some(row => row.id === schedule.id && row.status === 'executed'), 'scheduled transfer execution')
  const completed = executed.find(row => row.id === schedule.id)
  assert(completed.transactionId)
  assert.equal((await account(app, owner)).available, baseline[0].available - 123)
  assert.equal((await account(app, recipient)).available, baseline[1].available + 123)
  assert(!(await indexRows(app, owner.user.id)).some(row => row.id === schedule.id))
  await app.restart()
  assert.equal((await scheduleList(app, owner)).find(row => row.id === schedule.id).transactionId, completed.transactionId)
  await delay(1250)
  assert.equal((await account(app, owner)).available, baseline[0].available - 123)
  assert.equal(await app.database(async db => (await db.query('SELECT COUNT(*) AS n FROM bank_transactions WHERE owner_id=$1 AND id=$2', [owner.user.id, completed.transactionId])).rows[0].n), 1)
  await reconcile(app)

  await t.test('scheduled large transfer enters the real hold approval and customer recall releases only its own reservation', async () => {
    const before = await account(app, owner), recipientBefore = await account(app, recipient)
    const plan = await create(scheduleInput(owner, recipient, 2500, 'TEST ONLY scheduled held'))
    await forceDue(app, owner, plan.id)
    const rows = await eventually(() => scheduleList(app, owner), rows => rows.some(row => row.id === plan.id && row.status === 'executed'), 'large schedule enters hold')
    const row = rows.find(item => item.id === plan.id), held = ok(await app.call(routes.transaction(row.transactionId), { token: owner.token }))
    assert.equal(held.pendingReason, 'inflight'); assert.equal(held.heldFrozenAmount, 2500)
    assert.equal((await account(app, owner)).balance, before.balance)
    assert.equal((await account(app, owner)).available, before.available - 2500)
    assert.equal((await account(app, recipient)).available, recipientBefore.available)
    const supervisor = await app.supervisorLogin()
    const approvals = ok(await app.call('/staff-api/approvals', { token: supervisor }))
    assert(approvals.some(approval => approval.payload.transactionId === row.transactionId && approval.status === 'pending'))
    ok(await app.call(routes.transferRecall(row.transactionId), { method: 'POST', token: owner.token, body: {} }))
    assert.equal((await account(app, owner)).available, before.available)
    assert.equal((await account(app, owner)).balance, before.balance)
    assert.equal((await app.call(routes.transferRecall(row.transactionId), { method: 'POST', token: owner.token, body: {} })).status, 409)
    await reconcile(app)
  })

  await t.test('database posting failure preserves both customers and the scheduled instruction until a clean retry', async () => {
    const marker = 'TEST-ONLY-SCHEDULE-FAULT-' + randomUUID()
    const plan = await create(scheduleInput(owner, recipient, 137, marker))
    await app.database(db => db.exec(`CREATE FUNCTION extended_schedule_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.memo='${marker}' THEN RAISE EXCEPTION 'TEST ONLY scheduled posting failure'; END IF; RETURN NEW; END; $$; CREATE TRIGGER extended_schedule_fault BEFORE INSERT ON bank_transactions FOR EACH ROW EXECUTE FUNCTION extended_schedule_fault();`))
    const before = await financialState(app)
    try {
      await forceDue(app, owner, plan.id)
      await delay(2250)
      assert.equal((await scheduleList(app, owner)).find(row => row.id === plan.id).status, 'scheduled')
      assert.deepEqual(await financialState(app), before)
      assert((await indexRows(app, owner.user.id)).some(row => row.id === plan.id))
      await reconcile(app)
    } finally { await app.database(db => db.exec('DROP TRIGGER IF EXISTS extended_schedule_fault ON bank_transactions; DROP FUNCTION IF EXISTS extended_schedule_fault()')) }
    await eventually(() => scheduleList(app, owner), rows => rows.some(row => row.id === plan.id && row.status === 'executed'), 'retry after database failure')
    assert.equal(await app.database(async db => (await db.query('SELECT COUNT(*) AS n FROM bank_transactions WHERE owner_id=$1 AND memo=$2', [owner.user.id, marker])).rows[0].n), 1)
    assert.equal((await account(app, owner)).balance, before.accounts.find(row => row.owner_id === owner.user.id && row.id === owner.accounts[0].id).balance_cents - 137)
    await reconcile(app)
  })

  await t.test('birthday task index reserves once after restart, rolls back failures and releases only its original hold', async () => {
    const before = await account(app, owner)
    const unrelated = ok(await app.call(routes.transfers(), { method: 'POST', token: owner.token, body: transfer(owner, recipient, 2000, 'TEST ONLY unrelated hold') }))
    const afterOtherHold = await account(app, owner)
    assert.equal(afterOtherHold.available, before.available - 2000)
    const eventDate = new Date(Date.now() + 40 * 86400000 + 8 * 3600000).toISOString().slice(0, 10)
    const body = { contactName: '测试爱人', relationship: '配偶', eventDate, amountCents: 100000, currency: 'CNY', accountId: owner.accounts[0].id, confirmed: true, requestId: randomUUID(), paymentPassword: '888888' }
    const plan = ok(await app.call(routes.birthdayPlans(), { method: 'POST', token: owner.token, body }))
    assert.equal(plan.status, 'scheduled'); assert.equal((await account(app, owner)).available, afterOtherHold.available)
    assert((await indexRows(app, owner.user.id)).some(row => row.id === plan.id && row.kind === 'birthday-plan'))
    assert.equal((await birthdayList(app, recipient)).length, 0)
    assert.equal((await app.call(routes.birthdayPlanCancel(plan.id), { method: 'POST', token: recipient.token, body: { confirmed: true } })).status, 404)
    await app.restart()
    assert.equal((await birthdayList(app, owner)).find(row => row.id === plan.id).status, 'scheduled')
    await app.database(db => db.exec(`CREATE FUNCTION extended_birthday_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.owner_id='${owner.user.id}' AND NEW.available_cents<OLD.available_cents THEN RAISE EXCEPTION 'TEST ONLY birthday reservation failure'; END IF; RETURN NEW; END; $$; CREATE TRIGGER extended_birthday_fault BEFORE UPDATE ON bank_accounts FOR EACH ROW EXECUTE FUNCTION extended_birthday_fault();`))
    try {
      await app.editCustomer(owner.user.id, profile => {
        const row = profile.birthdayPlans.find(item => item.id === plan.id)
        row.reserveAt = new Date(Date.now() - 2000).toISOString(); row.orderAt = new Date(Date.now() + 3600000).toISOString()
      })
      await delay(2250)
      assert.equal((await account(app, owner)).available, afterOtherHold.available)
      assert.equal((await birthdayList(app, owner)).find(row => row.id === plan.id).reservation.status, 'pending')
    } finally { await app.database(db => db.exec('DROP TRIGGER IF EXISTS extended_birthday_fault ON bank_accounts; DROP FUNCTION IF EXISTS extended_birthday_fault()')) }
    await eventually(() => birthdayList(app, owner), rows => rows.some(row => row.id === plan.id && row.reservation.status === 'held'), 'birthday reservation retry')
    assert.equal((await account(app, owner)).available, afterOtherHold.available - 100000)
    await app.restart(); await delay(1250)
    assert.equal((await account(app, owner)).available, afterOtherHold.available - 100000)
    await app.editCustomer(owner.user.id, profile => { profile.birthdayPlans.find(item => item.id === plan.id).orderAt = new Date(Date.now() - 1000).toISOString() })
    await eventually(() => birthdayList(app, owner), rows => rows.some(row => row.id === plan.id && row.order.status === 'awaiting_confirmation'), 'birthday order task')
    const order = ok(await app.call(routes.birthdayPlanOrder(plan.id), { method: 'POST', token: owner.token, body: { confirmed: true } }))
    assert.equal(order.order.status, 'awaiting_merchant_connection'); assert.equal(order.order.merchantOrderId, null)
    assert.equal((await account(app, owner)).balance, before.balance)
    ok(await app.call(routes.birthdayPlanCancel(plan.id), { method: 'POST', token: owner.token, body: { confirmed: true } }))
    assert.equal((await account(app, owner)).available, afterOtherHold.available)
    assert(!(await indexRows(app, owner.user.id)).some(row => row.id === plan.id))
    assert.equal(ok(await app.call(routes.transaction(unrelated.transactionId), { token: owner.token })).pendingReason, 'inflight')
    ok(await app.call(routes.transferRecall(unrelated.transactionId), { method: 'POST', token: owner.token, body: {} }))
    assert.equal((await account(app, owner)).available, before.available)
    await reconcile(app)
  })

  await t.test('an execution-time 4xx overflow rolls back the sender rather than committing a failed partial payment', async () => {
    const target = await register(app, '13900000082', '上限测试乙')
    await app.editCustomer(target.user.id, profile => { profile.accounts[0].balance = Number.MAX_SAFE_INTEGER; profile.accounts[0].available = Number.MAX_SAFE_INTEGER })
    const plan = await create(scheduleInput(owner, target, 151, 'TEST ONLY execution-time overflow'))
    const before = await financialState(app)
    try {
      await forceDue(app, owner, plan.id)
      await delay(2250)
      assert.equal((await scheduleList(app, owner)).find(row => row.id === plan.id).status, 'scheduled')
      assert.deepEqual(await financialState(app), before)
      assert((await indexRows(app, owner.user.id)).some(row => row.id === plan.id))
      await reconcile(app)
    } finally {
      await app.editCustomer(target.user.id, profile => { profile.accounts[0].balance = 0; profile.accounts[0].available = 0 })
    }
    await eventually(() => scheduleList(app, owner), rows => rows.some(row => row.id === plan.id && row.status === 'executed'), 'retry after recipient overflow resolves')
    assert.equal((await account(app, target)).balance, 151)
    await reconcile(app)
  })
})

test('production live mode rejects every new banking API method before demo state or background tasks can change', { ...testOptions, timeout: 60000 }, async t => {
  const app = await fixture({ production: true, mode: 'live' })
  t.after(() => app.close())
  const customer = await app.database(async db => (await db.query('SELECT id,phone FROM customers ORDER BY seq LIMIT 1')).rows[0])
  const token = randomBytes(32).toString('base64url'), sessionId = createHash('sha256').update(token).digest('hex')
  await app.database(db => db.query("INSERT INTO customer_sessions(id,owner_id,phone,device,created_at,expires_at,ended_at) VALUES($1,$2,$3,'TEST ONLY extended live session',$4,$5,NULL)", [sessionId, customer.id, customer.phone, new Date().toISOString(), Date.now() + 3600000]))
  const before = await financialState(app)
  const calls = [['GET', routes.scheduledTransfers()], ['POST', routes.scheduledTransfers()], ['DELETE', routes.scheduledTransfer('missing')],
    ['GET', routes.splitCollections()], ['POST', routes.splitCollections()], ['DELETE', routes.splitCollection('missing')], ['POST', routes.splitPayment('missing')], ['POST', routes.splitReminder('missing')],
    ['PATCH', routes.payee('missing')], ['GET', routes.billingReport()], ['GET', routes.billingReportExport()], ['POST', routes.cardLost('missing')], ['POST', routes.cardRecover('missing')],
    ['GET', routes.birthdayPlans()], ['POST', routes.birthdayPlans()], ['POST', routes.birthdayPlanPreview()], ['POST', routes.birthdayPlanCancel('missing')], ['POST', routes.birthdayPlanOrder('missing')]]
  for (const [method, path] of calls) {
    const result = await app.call(path, { method, token, ...(method === 'GET' ? {} : { body: {} }) })
    assert.equal(result.status, 503, `${method} ${path}`); assert.equal(result.body.code, 'BANK_NOT_CONNECTED')
  }
  await delay(1250)
  assert.deepEqual(await financialState(app), before)
  assert.equal((await indexRows(app, customer.id)).length, 0)
})
