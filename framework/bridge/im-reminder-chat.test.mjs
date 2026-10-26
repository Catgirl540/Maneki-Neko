import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { createImBank } from './im-bank.mjs'
import { openImStore } from './im-store.mjs'
import { createBankReminders } from './bank-reminders.mjs'
import { createImReminderChat } from './im-reminder-chat.mjs'

test('real reminder store + persistent WeChat binding: no browser consent or bank login, clarification, restart, list, cancel and isolation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'im-reminder-chat-')), key = randomBytes(32).toString('base64'), file = join(directory, 'bindings.json')
  let now = Date.parse('2026-10-26T08:00:00+08:00'), im, reminders, chat, bankReads = 0, modelRuns = 0
  const boot = async () => {
    const store = await openImStore(file, key)
    chat = createImReminderChat({ reminders: () => reminders, clock: () => now })
    im = createImBank({ store, clock: () => now, publicUrl: 'https://bank.test', createSession: async () => 'bank-session',
      current: async () => { bankReads++; throw Error('bank login expired') }, run: async () => { modelRuns++; throw Error('No model') }, cancel: async () => {}, deliver: () => assert.fail('No transport'),
      handleReminder: chat.handle, onBindingChange: id => { chat.invalidateRoute(id); reminders?.invalidateRoute(id) } })
    reminders = await createBankReminders({ directory: join(directory, 'tasks'), routes: () => im.reminderRoutes(), clock: () => now, deliver: () => assert.fail('Do not send') })
    const harness = im.harness('weixin', 'fixture-bot'), route = await harness.createSession({ conversationKey: 'p2p:alice' })
    return { harness, route, session: harness.workspaceSession(route, 'p2p:alice') }
  }
  try {
    let current = await boot()
    const first = await current.session.ask('提醒我明天买花给女朋友')
    assert.match(first, /请先.*登录.*绑定/)
    const code = /#code=([\w-]+)/.exec(first)[1]
    await im.claim(code, { user: { id: 'alice' }, token: 'fixture-token' })
    await im.close(); chat.close(); await reminders.close()
    current = await boot() // The restarted process has no live bank login.
    assert.equal(im.list('alice')[0].connected, false)
    const supplement = await current.session.ask('提醒我明天买花给女朋友')
    assert.match(supplement, /具体几点/); assert(!supplement.includes('https://'))
    assert.equal(reminders.list('alice').reminders.length, 0)
    const saved = await current.session.ask('上午九点')
    assert.match(saved, /已设置提醒：买花给女朋友/); assert(!saved.includes('#session='))
    let rows = reminders.list('alice').reminders
    assert.equal(rows.length, 1); assert.equal(rows[0].dueAt, '2026-10-27T01:00:00.000Z')
    assert.equal(rows[0].title, '买花给女朋友')
    assert.equal(bankReads, 0); assert.equal(modelRuns, 0)
    assert.match(await current.session.ask('每天上午九点提醒我喝水'), /一次性提醒/)
    assert.equal(reminders.list('alice').reminders.length, 1)
    assert.match(await current.session.ask('明天下午三点提醒我买花'), /已设置提醒/)
    assert.match(await current.session.ask('明天下午三点提醒我买花'), /已设置提醒/)
    assert.equal(reminders.list('alice').reminders.length, 2)
    const ambiguous = await current.session.ask('明天9点提醒我复诊')
    assert.match(ambiguous, /上午/); assert.equal(reminders.list('alice').reminders.length, 2)
    assert.match(await current.session.ask('上午'), /已设置提醒：复诊/)
    assert.match(await current.session.ask('10分钟后提醒我喝水'), /已设置提醒：喝水/)
    now += 1000
    assert.match(await current.session.ask('10分钟后提醒我喝水'), /已设置提醒：喝水/)
    assert.equal(reminders.list('alice').reminders.length, 4)
    assert.match(await current.session.ask('查看提醒'), /买花给女朋友/)
    assert.match(await current.session.ask('取消刚才那条提醒'), /已取消提醒：喝水/)
    rows = reminders.list('alice').reminders
    assert.equal(rows.filter(r => r.status === 'cancelled').length, 1)
    assert.match(await current.session.ask('明天上午九点提醒我支付密码888888'), /请勿/)
    assert.equal(reminders.list('alice').reminders.length, 4)
    assert.match(await current.session.ask('查余额'), /请先.*登录.*绑定/)
    assert.equal(bankReads, 0); assert.equal(modelRuns, 0)
    assert.deepEqual(reminders.list('bob').reminders, [])
    const another = await current.harness.createSession({ conversationKey: 'p2p:bob' })
    assert.match(await current.harness.workspaceSession(another, 'p2p:bob').ask('明天下午三点提醒我买花'), /请先.*绑定/)
    await im.revoke(current.route, 'alice'); now += 2 * 86400000; await reminders.tick()
    assert.equal(reminders.list('alice').reminders.filter(r => r.status === 'scheduled').length, 0)
    assert.match(await current.session.ask('明天上午九点提醒我买花'), /请先.*绑定/)
  } finally {
    await im?.close(); chat?.close(); await reminders?.close()
    assert(resolve(directory).startsWith(resolve(tmpdir()) + sep))
    await rm(directory, { recursive: true, force: true })
  }
})

test('route guard is checked again immediately before durable creation; unavailable service never reports success', async () => {
  const route = { id: 'im-a', ownerId: 'alice', bindingRevision: 'one', botId: 'bot', key: 'p2p:a', channel: 'weixin' }
  let checks = 0, writes = 0
  const service = { prepare: () => ({ title: '买花', dueAt: '2026-10-27T01:00:00.000Z' }), execute: () => { writes++; assert.fail('Revoked route') } }
  const chat = createImReminderChat({ reminders: () => service, clock: () => Date.parse('2026-10-26T08:00:00+08:00') })
  assert.match(await chat.handle(route, '明天上午九点提醒我买花', { isCurrent: () => ++checks < 3 }), /绑定已变化/)
  assert.equal(writes, 0)
  const disabled = createImReminderChat({ reminders: () => undefined })
  assert.match(await disabled.handle(route, '明天上午九点提醒我买花', { isCurrent: () => true }), /尚未启用/)
  chat.close(); disabled.close()
})
