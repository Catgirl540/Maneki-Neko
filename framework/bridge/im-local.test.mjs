import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep, basename } from 'node:path'
import { createConnectionTestHarness, startLocalIm } from '../scripts/start-im-local.mjs'

test('connection trial accepts scoped private sessions and stops without model or bank', async () => {
  const trial = createConnectionTestHarness()
  const wx = trial.harness('weixin', 'one'), other = trial.harness('weixin', 'two')
  await assert.rejects(wx.createSession({ conversationKey: 'group:123' }))
  const id = await wx.createSession({ conversationKey: 'p2p:person' })
  await assert.rejects(other.workspaceSession(id, 'p2p:person').ask('hello'))
  assert.match(await wx.workspaceSession(id, 'p2p:person').ask('hello'), /消息收发连接正常/)
  assert.deepEqual(trial.status().received, { weixin: 1, wecom: 0 })
  trial.close()
  await assert.rejects(wx.workspaceSession(id, 'p2p:person').ask('hello'))
})

test('loopback manager requires launch credential, excludes bank APIs, and stops its listener', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'luckycat-im-local-'))
  let closed = false
  const app = await startLocalIm({ port: 0, directory, makeChannels: async () => ({
    initialize: async () => {}, close: async () => { closed = true },
    status: () => ({ version: '5.1.0', channels: { weixin: { bots: [] }, wecom: { bots: [] } } }),
  }) })
  t.after(async () => {
    await app.close()
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep) || !basename(directory).startsWith('luckycat-im-local-')) throw Error('Unexpected cleanup target')
    await rm(directory, { recursive: true, force: true })
  })
  const headers = { authorization: `Bearer ${new URLSearchParams(new URL(app.url).hash.slice(1)).get('local')}` }
  assert.equal((await fetch(`${app.base}/agent-api/im`)).status, 200)
  assert.equal((await fetch(`${app.base}/agent-api/im/local/status`)).status, 401)
  assert.equal((await fetch(`${app.base}/agent-api/im/admin/status`)).status, 401)
  assert.equal((await fetch(`${app.base}/agent-api/im/admin/status`, { headers })).status, 200)
  assert.equal((await (await fetch(`${app.base}/agent-api/im/local/status`, { headers })).json()).mode, 'connection-test')
  assert.equal((await fetch(`${app.base}/agent-api/im/auth/login`, { method: 'POST', headers, body: '{}' })).status, 404)
  assert.equal((await fetch(`${app.base}/agent-api/im/local/stop`, { method: 'POST' })).status, 401)
  assert.equal((await fetch(`${app.base}/agent-api/im/local/stop`, { method: 'POST', headers })).status, 200)
  for (let i = 0; i < 50 && !closed; i++) await new Promise(done => setTimeout(done, 10))
  assert.equal(closed, true)
  await assert.rejects(fetch(`${app.base}/agent-api/im/local/status`, { headers, signal: AbortSignal.timeout(1000) }))
})
