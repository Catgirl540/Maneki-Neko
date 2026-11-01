import test from 'node:test'
import assert from 'node:assert/strict'
import { fixture, ok, login, account, reconcile, testOptions, routes } from './testing/http-fixture.mjs'

test('subscription purchase persists its mandate atomically and rejects duplicates and cross-owner cards', { ...testOptions, timeout: 90000 }, async t => {
  const app = await fixture()
  t.after(() => app.close())
  const owner = await login(app, '13800138000'), other = await login(app, '13600136000')
  const card = ok(await app.call(routes.cards(), { token: owner.token })).find(item => item.status === 'active')
  const path = routes.cardSpend(card.id)
  const buy = (key, token = owner.token) => app.call(path, { method: 'POST', token, key, body: { platform: 'baidu-drive', amount: 3000, subscription: true } })
  const before = await account(app, owner, owner.accounts[0].id)
  assert.equal((await buy('subscription-other-owner', other.token)).status, 404)
  const receipt = ok(await buy('subscription-first'))
  assert.equal(receipt.autoDebit.merchant, '百度网盘')
  assert.equal(receipt.autoDebit.amount, 3000)
  assert.deepEqual(ok(await buy('subscription-first')), receipt)
  const persisted = ok(await app.call(routes.autoDebits(), { token: owner.token }))
  assert.equal(persisted.filter(item => item.id === receipt.autoDebit.id).length, 1)
  assert.equal((await buy('subscription-duplicate')).body.code, 'INVALID_SUBSCRIPTION')
  assert.equal((await account(app, owner, owner.accounts[0].id)).balance, before.balance - 3000)
  assert.equal(ok(await app.call(routes.autoDebits(), { token: other.token })).some(item => item.id === receipt.autoDebit.id), false)
  await app.database(db => db.exec(`CREATE FUNCTION reject_subscription_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    RAISE EXCEPTION 'fixture subscription write failure'; END $$;
    CREATE TRIGGER reject_subscription_fixture BEFORE INSERT OR UPDATE ON payment_mandates FOR EACH ROW EXECUTE FUNCTION reject_subscription_fixture()`))
  try {
    const failed = await app.call(path, { method: 'POST', token: owner.token, key: 'subscription-rollback',
      body: { platform: 'iqiyi', amount: 2500, subscription: true } })
    assert.equal(failed.status, 500)
  } finally {
    await app.database(db => db.exec('DROP TRIGGER reject_subscription_fixture ON payment_mandates; DROP FUNCTION reject_subscription_fixture()'))
  }
  assert.equal((await account(app, owner, owner.accounts[0].id)).balance, before.balance - 3000)
  assert.equal(ok(await app.call(routes.autoDebits(), { token: owner.token })).some(item => item.merchant === '爱奇艺会员'), false)
  await app.restart()
  const again = await login(app, '13800138000')
  assert.equal(ok(await app.call(routes.autoDebits(), { token: again.token })).some(item => item.id === receipt.autoDebit.id), true)
  await reconcile(app)
})
