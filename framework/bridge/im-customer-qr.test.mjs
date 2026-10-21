import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { openImStore } from './im-store.mjs'
import { createImBank } from './im-bank.mjs'
import { createImHttp } from './im-http.mjs'
import { createCustomerQr } from './im-customer-qr.mjs'
import { createImChannels, loadImVendor } from './im-channels.mjs'

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1kAAAAASUVORK5CYII='
test('authenticated customer QR: same-page lifecycle, no automatic claim, scoped ownership and repeat confirmation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bank-customer-qr-'))
  const store = await openImStore(join(directory, 'bank.enc.json'), randomBytes(32).toString('base64'))
  const sessions = [], states = new Map()
  let seq = 0
  const bank = createImBank({ store, publicUrl: 'https://bank.example.com',
    createSession: async identity => { sessions.push(identity.user.id); return 'session-' + sessions.length },
    current: async () => {}, run: async () => {}, cancel: async () => {}, deliver: async () => { throw Error('Must never send') },
  })
  const channels = {
    async provision(channel, options) {
      assert.equal(channel, 'weixin'); assert.deepEqual(options, { fresh: true })
      const id = 'attempt-' + ++seq
      const state = { attemptId: id, status: 'pending', expiresAt: Date.now() + 300000, qrImage: png }
      states.set(id, state); return { ...state }
    },
    registration: (_, id) => states.get(id),
    status: () => ({ channels: { weixin: { bots: [...states.values()].filter(s => s.botId).map(s => ({ botId: s.botId, connected: s.status === 'connected' })) } } }),
    privateWeixinRecipient: () => 'p2p:confirmed-provider-user',
    verify: async (_, id, code) => { assert.equal(code, '123456'); states.get(id).status = 'scanned' },
    cancelProvision: async (_, id) => { states.get(id).status = 'cancelled' },
  }
  const handler = createImHttp({ bank, channels, bankUrl: 'http://127.0.0.1:1' })
  const sendJson = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
  const server = createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, 'http://127.0.0.1').pathname
      const readJson = async request => { let body = ''; for await (const part of request) body += part; return body ? JSON.parse(body) : {} }
      if (await handler.handle(req, res, { pathname, sendJson, readJson })) return
      const who = ['alice', 'bob'].find(id => req.headers.authorization === 'Bearer ' + id)
      if (!who) return sendJson(res, 401, { error: 'Bank login required' })
      await handler.handle(req, res, { pathname, sendJson, readJson, identity: { user: { id: who }, token: who } })
    } catch (error) { sendJson(res, error.status ?? 500, { error: error.message }) }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}/agent-api/im/weixin/qr`
  const call = async (who, suffix = '', body) => {
    const response = await fetch(base + suffix, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', ...(who ? { authorization: 'Bearer ' + who } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    return { status: response.status, data: await response.json() }
  }
  try {
    assert.equal((await call(null, '', {})).status, 401); assert.equal(seq, 0)
    const started = await call('alice', '', { ownerId: 'bob', botId: 'other-bot' })
    assert.equal(started.status, 200); assert.equal(started.data.qrImage, png)
    const id = started.data.attemptId
    assert.equal((await call('alice', '', {})).data.attemptId, id); assert.equal(seq, 1)
    assert.equal(sessions.length, 0)
    for (const [suffix, body] of [['', undefined], ['/cancel', {}], ['/verify', { code: '123456' }], ['/confirm', { confirmed: true }]]) assert.equal((await call('bob', '/' + id + suffix, body)).status, 404)
    states.get(id).status = 'needs_verification'
    assert.equal((await call('alice', '/' + id + '/verify', { code: '123456' })).data.status, 'scanned')
    Object.assign(states.get(id), { status: 'connected', botId: 'new-verified-bot' })
    assert.equal((await call('alice', '/' + id)).data.status, 'connected'); assert.equal(sessions.length, 0)
    assert.equal((await call('alice', '/' + id + '/confirm', { confirmed: false })).status, 400)
    const confirms = await Promise.all([call('alice', '/' + id + '/confirm', { confirmed: true, recipient: 'forged' }), call('alice', '/' + id + '/confirm', { confirmed: true })])
    assert(confirms.every(r => r.status === 200)); assert.equal(sessions.length, 1)
    assert.equal(confirms[0].data.id, confirms[1].data.id)
    assert.equal(bank.list('alice').length, 1); assert.equal(bank.list('bob').length, 0)
    const bob = await call('bob', '', {})
    Object.assign(states.get(bob.data.attemptId), { status: 'connected', botId: 'another-bot-same-wechat' })
    assert.equal((await call('bob', '/' + bob.data.attemptId + '/confirm', { confirmed: true })).status, 409)
    assert.equal(sessions.length, 1); assert.equal(bank.list('bob').length, 0)
    states.get(bob.data.attemptId).alreadyConnected = true
    assert.equal((await call('bob', '/' + bob.data.attemptId + '/confirm', { confirmed: true })).status, 409)
    assert.equal(sessions.length, 1)
  } finally { await bank.close(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }) }
})

test('customer QR expiry, cancellation, generation quota and concurrent global start are bounded', async () => {
  let now = 100000, calls = 0, release
  const states = new Map(), identity = { user: { id: 'alice' } }
  const channels = {
    provision: async () => { calls++; if (release === null) await new Promise(resolve => { release = resolve }); const s = { attemptId: 'q-' + calls, status: 'pending', qrImage: png, expiresAt: now + 300000 }; states.set(s.attemptId, s); return s },
    registration: (_, id) => states.get(id), cancelProvision: async (_, id) => { states.get(id).status = 'cancelled' },
  }
  const service = createCustomerQr({ bank: {}, channels, clock: () => now })
  release = null
  const starting = service.start(identity)
  await assert.rejects(service.start({ user: { id: 'bob' } }), /已有扫码任务/)
  release(); const first = await starting
  now += 300001; assert.throws(() => service.poll(identity, first.attemptId), error => error.status === 410)
  for (let i = 0; i < 2; i++) { const qr = await service.start(identity); await service.cancel(identity, qr.attemptId) }
  await assert.rejects(service.start(identity), error => error.status === 429)
  assert.equal(calls, 3)
})

test('real pinned controller fresh customer QR excludes existing credentials; pending QR cannot be stolen by another start', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bank-qr-vendor-'))
  const vendor = await loadImVendor()
  const identity = vendor.deriveWeixinBotIdentity('fixture-existing-bot')
  const config = await new vendor.WeixinConfigStore(join(directory, 'weixin.json')).load()
  await config.save({ ...identity, accountId: 'fixture-existing-bot', ownerUserId: 'other-customer-provider-user', baseUrl: 'https://ilinkai.weixin.qq.com/' })
  const hints = []
  const channels = await createImChannels({ directory, vendor, credentials: { resolve: async () => ({ value: 'fixture-other-customer-token' }), set: async () => {}, unset: async () => {} }, harness: () => ({}), weixinApi: {
    beginLogin: async options => { hints.push(options.localTokens); return { qrcode: 'fixture-qr', qrcodeUrl: 'https://weixin.qq.com/fixture' } },
    pollLogin: async ({ signal }) => { await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true })); return { status: 'expired' } },
  } })
  try {
    const qr = await channels.provision('weixin', { fresh: true })
    assert.deepEqual(hints, [[]]); assert(qr.qrImage.startsWith('data:image/png;base64,'))
    await assert.rejects(channels.provision('weixin'), error => error.status === 409)
    await channels.cancelProvision('weixin', qr.attemptId)
    const ops = await channels.provision('weixin')
    assert.deepEqual(hints[1], ['fixture-other-customer-token'])
    await channels.cancelProvision('weixin', ops.attemptId)
  } finally { await channels.close(); await rm(directory, { recursive: true, force: true }) }
})
