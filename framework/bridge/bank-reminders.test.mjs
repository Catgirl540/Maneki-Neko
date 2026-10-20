import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBankReminders, validateReminder } from './bank-reminders.mjs'
import { openImStore, migrateImBindingRevisions } from './im-store.mjs'
import { randomBytes, createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

test('legacy encrypted binding upgrade preserves ownership and credentials, is repeatable and does not bind strangers', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bank-binding-upgrade-'))
  const file = join(directory, 'bindings.enc.json'), key = randomBytes(32).toString('base64')
  try {
    const store = await openImStore(file, key)
    await store.update(draft => {
      draft.credentials.token = 'fixture-secret'
      draft.routes.a = { id: 'a', ownerId: 'alice', sessionId: 'old-session', channel: 'weixin', key: 'p2p:fixture', botId: 'one' }
      draft.routes.b = { id: 'b', channel: 'weixin', key: 'p2p:stranger', botId: 'one' }
    })
    assert.equal(await migrateImBindingRevisions(store), 1)
    const revision = store.snapshot().routes.a.bindingRevision
    assert(revision)
    const reopened = await openImStore(file, key)
    assert.equal(await migrateImBindingRevisions(reopened), 0)
    assert.equal(reopened.snapshot().routes.a.bindingRevision, revision)
    assert.equal(reopened.snapshot().routes.a.ownerId, 'alice')
    assert.equal(reopened.snapshot().routes.a.sessionId, 'old-session')
    assert.equal(reopened.snapshot().routes.b.bindingRevision, undefined)
    assert.equal((await reopened.credentials.resolve('token')).value, 'fixture-secret')
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('reminder time validates calendar, explicit zone, future range and content', () => {
  const now = Date.parse('2026-10-20T01:00:00Z')
  assert.deepEqual(validateReminder({ title: ' 查理财 ', dueAt: '2026-10-20T09:02:00+08:00' }, now), { title: '查理财', dueAt: '2026-10-20T01:02:00.000Z' })
  for (const dueAt of ['2026-02-30T09:00:00+08:00', '2026-10-21T09:00', '2026-10-20T09:00:01+08:00', '2029-01-01T00:00:00Z', '2026-10-21T00:00:00+99:00']) assert.throws(() => validateReminder({ title: 'test', dueAt }, now))
  assert.throws(() => validateReminder({ title: 'a\nb', dueAt: '2026-10-21T00:00:00Z' }, now))
})

test('real workbench library: owned reminder lifecycle, restart, idempotency, revocation, retries and uncertain outcomes', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'bank-workbench-'))
  let now = Date.parse('2026-10-20T01:00:00Z'), online = true, mode = 'ok', entered, release
  const sent = [], routes = {
    a: { id: 'a', channel: 'weixin', key: 'p2p:alice', botId: 'one', ownerId: 'alice', sessionId: 's1', bindingRevision: 'v1' },
    b: { id: 'b', channel: 'weixin', key: 'p2p:bob', botId: 'one', ownerId: 'bob', sessionId: 's2', bindingRevision: 'v2' },
  }
  const options = { directory, routes: () => structuredClone(routes), clock: () => now, ready: () => online, deliver: async (route, text, { signal }) => {
    if (mode === 'wait') { entered(); await new Promise(resolve => { release = resolve }); signal.throwIfAborted() }
    if (mode === 'unknown') throw Error('Network outcome unknown')
    sent.push({ key: route.key, text })
  } }
  let service = await createBankReminders(options)
  const prepare = (title, bindingId = 'a', owner = 'alice') => service.prepare(owner, 'create', { title, bindingId, dueAt: new Date(now + 60000).toISOString().replace('.000Z', 'Z') })
  const create = (title, id, bindingId = 'a', owner = 'alice') => service.execute(owner, prepare(title, bindingId, owner), id)
  try {
    await t.test('owner isolation, request idempotency and cancellation', async () => {
      const prepared = prepare('检查理财')
      const first = service.execute('alice', prepared, 'request-one')
      assert.equal(service.execute('alice', prepared, 'request-one').id, first.id)
      assert.throws(() => service.execute('alice', prepare('different'), 'request-one'), /不同提醒/)
      assert.equal(service.list('bob').reminders.length, 0)
      assert.throws(() => service.prepare('bob', 'cancel', { reminderId: first.id }), /不属于/)
      assert.throws(() => prepare('cross', 'b'), /明确选择/)
      service.execute('alice', service.prepare('alice', 'cancel', { reminderId: first.id }), 'request-cancel')
      now += 61000; await service.tick(); assert.equal(sent.length, 0)
    })
    await t.test('restart retains due tasks; concurrent ticks deliver once to the original route', async () => {
      create('检查续费', 'request-two')
      await service.close(); service = await createBankReminders(options)
      now += 61000
      await Promise.all([service.tick(), service.tick()]); await service.tick()
      assert.equal(sent.length, 1); assert.equal(sent[0].key, 'p2p:alice')
      assert(sent[0].text.includes('未查询账户或执行交易'))
      assert.equal(service.list('alice').reminders.find(r => r.title === '检查续费').status, 'sent')
    })
    await t.test('changed bindings suppress old reminders and cannot be silently reassigned', async () => {
      create('old route', 'request-three')
      routes.a.bindingRevision = 'v3'
      now += 61000; await service.tick(); assert.equal(sent.length, 1)
      assert.equal(service.list('alice').reminders.find(r => r.title === 'old route').status, 'suppressed')
    })
    await t.test('offline preflight retries without sending; unknown network outcome never auto-retries after restart', async () => {
      create('offline', 'request-four'); online = false; now += 61000; await service.tick()
      assert.equal(service.list('alice').reminders.find(r => r.title === 'offline').status, 'scheduled')
      online = true; now += 31000; await service.tick(); assert.equal(sent.length, 2)
      create('uncertain', 'request-five'); mode = 'unknown'; now += 61000; await service.tick()
      assert.equal(service.list('alice').reminders.find(r => r.title === 'uncertain').status, 'unknown')
      await service.close(); service = await createBankReminders(options)
      mode = 'ok'; await service.tick(); assert.equal(sent.length, 2)
    })
    await t.test('a crashed send stays unknown after restart; an unrelated corrupt store does not block due reminders', async () => {
      const interrupted = create('interrupted', 'request-crash')
      await service.close()
      const db = new DatabaseSync(join(directory, createHash('sha256').update('alice').digest('hex'), 'workbench.db'))
      db.prepare("UPDATE bank_reminders SET status='sending' WHERE id=?").run(interrupted.id)
      db.close()
      const broken = join(directory, '0'.repeat(64))
      await mkdir(broken); await writeFile(join(broken, 'workbench.db'), 'fixture: invalid SQLite')
      service = await createBankReminders(options)
      assert.equal(service.list('alice').reminders.find(r => r.id === interrupted.id).status, 'unknown')
      create('healthy customer store', 'request-healthy')
      now += 61000; await service.tick()
      assert.equal(sent.length, 3)
      await rm(broken, { recursive: true })
    })
    await t.test('revocation aborts an in-flight queued delivery before it reaches the transport', async () => {
      create('cancel in queue', 'request-six'); mode = 'wait'; now += 61000
      const waiting = new Promise(resolve => { entered = resolve })
      const scan = service.tick(); await waiting
      delete routes.a.ownerId; service.invalidateRoute('a'); release(); await scan
      assert.equal(sent.length, 3)
      assert.equal(service.list('alice').reminders.find(r => r.title === 'cancel in queue').status, 'unknown')
    })
  } finally { await service.close(); await rm(directory, { recursive: true, force: true }) }
})
