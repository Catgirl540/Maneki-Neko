import test from 'node:test'
import assert from 'node:assert/strict'
import { createScopedProfileStorage } from './profile-store.mjs'

async function fixture() {
  let committed = { profile: { user: { id: 'u1', phone: '13000000001' }, accounts: [{ balance: 1000 }], payPasswordFailures: 4 }, audit: [] }
  let work, checkpoint
  const events = []
  const controls = { failCommit: false, failSnapshot: false }
  const active = () => work ?? committed
  const db = {
    async transaction(fn) { return fn() },
    async begin() { events.push('BEGIN'); work = structuredClone(committed) },
    async query(sql) {
      events.push(sql)
      if (sql === 'SAVEPOINT bank_business') checkpoint = structuredClone(work)
      if (sql === 'ROLLBACK TO SAVEPOINT bank_business') work = structuredClone(checkpoint)
    },
    async commit() { events.push('COMMIT'); if (controls.failCommit) throw Error('Commit failed'); committed = structuredClone(work); work = null },
    async rollback() { events.push('ROLLBACK'); work = null },
  }
  const storage = await createScopedProfileStorage({ db,
    query: async () => { if (controls.failSnapshot) throw Error('Snapshot failed'); return [] },
    get: async sql => sql.includes('profile_bindings') ? { owner_id: 'u1' } : { id: 'u1' },
    run: async () => {},
    readProfile: async () => structuredClone(active().profile),
    saveProfile: async profile => { work.profile = structuredClone(profile) },
    postChanges: async (_changes, id) => { events.push(`post:${id}`) },
    openCardPan: () => '', currentKey: 'current', profilesKey: 'profiles',
  })
  return { storage, events, controls, businessAudit: () => { work.audit.push('business audit') }, persisted: () => committed, working: () => work }
}

test('savepoint recovery discards business projection and SQL but keeps the lock until the security event commits', async () => {
  const { storage, events, businessAudit, persisted, working } = await fixture()
  await assert.rejects(storage.recoverUnitOfWork(), /No database unit/)
  await storage.beginUnitOfWork({ requestId: 'payment-attempt' })
  assert.deepEqual(events, ['BEGIN', 'SELECT pg_advisory_xact_lock(782614101)', 'SAVEPOINT bank_business'])
  const dirty = storage.getValue('current')
  dirty.accounts[0].balance = 100
  dirty.payPasswordFailures = 5
  storage.setValuesAtomically([['current', dirty], ['business-extra', { changed: true }]])
  businessAudit()
  await storage.recoverUnitOfWork()
  const clean = storage.getValue('current')
  assert.notEqual(clean, dirty)
  assert.equal(clean.accounts[0].balance, 1000)
  assert.equal(clean.payPasswordFailures, 4)
  assert.equal(storage.getValue('business-extra'), null)
  assert.deepEqual(working().audit, [])
  assert.equal(events.at(-1), 'ROLLBACK TO SAVEPOINT bank_business')
  assert.equal(events.includes('ROLLBACK'), false)
  assert.equal(events.includes('COMMIT'), false)
  clean.payPasswordFailures += 1
  storage.setValuesAtomically([['current', clean]])
  await storage.commitUnitOfWork()
  assert.deepEqual(persisted().profile, { user: clean.user, accounts: [{ balance: 1000 }], payPasswordFailures: 5 })
  assert.deepEqual(events.slice(-2), ['post:payment-attempt', 'COMMIT'])
  await assert.rejects(storage.recoverUnitOfWork(), /No database unit/)
})

test('recovery preserves an unloaded current projection and repeated recovery is safe', async () => {
  const { storage, events } = await fixture()
  await storage.beginUnitOfWork({ loadCurrent: false })
  assert.equal(storage.getValue('current'), null)
  const profile = await storage.findProfileByUserId('u1')
  profile.accounts[0].balance = 1
  storage.setValuesAtomically([['profiles', { [profile.user.phone]: profile }]])
  await storage.recoverUnitOfWork()
  await storage.recoverUnitOfWork()
  assert.equal(storage.getValue('current'), null)
  assert.equal(Object.keys(storage.getValue('profiles')).length, 0)
  assert.equal((await storage.findProfileByUserId('u1')).accounts[0].balance, 1000)
  await storage.rollbackUnitOfWork()
  assert.equal(events.at(-1), 'ROLLBACK')
})

test('commit/recovery failures leave no recoverable unit or dirty security state', async () => {
  const { storage, controls, persisted, events } = await fixture()
  await storage.beginUnitOfWork()
  const profile = storage.getValue('current')
  profile.payPasswordFailures = 5
  storage.setValuesAtomically([['current', profile]])
  controls.failCommit = true
  await assert.rejects(storage.commitUnitOfWork(), /Commit failed/)
  await assert.rejects(storage.recoverUnitOfWork(), /No database unit/)
  assert.equal(persisted().profile.payPasswordFailures, 4)
  controls.failCommit = false
  await storage.beginUnitOfWork()
  controls.failSnapshot = true
  await assert.rejects(storage.recoverUnitOfWork(), /Snapshot failed/)
  await assert.rejects(storage.recoverUnitOfWork(), /No database unit/)
  assert.equal(events.at(-1), 'ROLLBACK')
  assert.equal(storage.hasPendingWrites(), false)
})
