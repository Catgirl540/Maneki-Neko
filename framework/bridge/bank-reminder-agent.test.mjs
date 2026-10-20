import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBankAgent } from './bank-agent.mjs'
import { createBankReminders } from './bank-reminders.mjs'
import { createImHttp } from './im-http.mjs'

test('bank reminder tools keep normal one-use consent; portal authenticates ownership and explicit creation confirmation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bank-reminder-agent-'))
  const routes = { r1: { id: 'r1', channel: 'weixin', botId: 'one', key: 'p2p:alice', ownerId: 'alice', sessionId: 's1', bindingRevision: 'v1' } }
  let reminders, portal, transportCalls = 0
  const server = createServer(async (req, res) => {
    const identity = req.headers.authorization === 'Bearer alice-token' ? { user: { id: 'alice' }, token: 'alice-token' } : req.headers.authorization === 'Bearer bob-token' ? { user: { id: 'bob' }, token: 'bob-token' } : undefined
    const sendJson = async (_res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
    if (!identity) return sendJson(res, 401, { error: 'UNAUTHORIZED' })
    if (req.url === '/api/auth/profile') return sendJson(res, 200, identity.user)
    try {
      const readJson = async () => { let body = ''; for await (const chunk of req) body += chunk; return JSON.parse(body || '{}') }
      if (!await portal.handle(req, res, { pathname: new URL(req.url, 'http://localhost').pathname, identity, readJson, sendJson })) return sendJson(res, 404, {})
    } catch (error) { await sendJson(res, error.status ?? 500, { error: error.message }) }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const baseUrl = `http://127.0.0.1:${server.address().port}`
  reminders = await createBankReminders({ directory, routes: () => structuredClone(routes), deliver: async () => { transportCalls++ } })
  portal = createImHttp({ bank: {}, channels: {}, bankUrl: baseUrl, reminders: () => reminders })
  const activity = {}, sessions = new Map([['s1', { id: 's1', ownerId: 'alice', bankToken: 'alice-token', activity }]])
  const agent = createBankAgent({ baseUrl, sessions, publish: () => {}, reminders: () => reminders })
  const args = { title: '查看理财', dueAt: new Date(Date.now() + 120000).toISOString().replace('.000Z', 'Z').replace(/\.\d{3}Z$/, 'Z') }
  const challenge = (toolName, arguments_, id) => ({ sessionId: 's1', callId: id, challengeId: id, toolName, arguments: arguments_, expiresAt: Date.now() + 60000 })
  const request = async (path, token, body, method = body ? 'POST' : 'GET') => {
    const response = await fetch(baseUrl + '/agent-api/im' + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
    return { status: response.status, data: await response.json() }
  }
  try {
    const raw = challenge('bank_create_im_reminder', args, 'create-one')
    const prepared = await agent.prepare(raw)
    assert.equal(prepared.verification, undefined)
    assert(prepared.consequence.includes('不查询账户'))
    assert.equal(prepared.arguments, undefined)
    await assert.rejects(agent.execute(raw), { status: 403 })
    assert.equal(await agent.approveRoutineQuery(prepared), false)
    await agent.approve(prepared)
    await assert.rejects(agent.execute({ ...raw, arguments: { ...args, title: 'forged' } }), { status: 403 })
    const created = (await agent.execute(raw)).result
    assert.equal(created.status, 'scheduled')
    await assert.rejects(agent.execute(raw), { status: 403 })
    const listRaw = challenge('bank_list_im_reminders', {}, 'list-one')
    const listPrepared = await agent.prepare(listRaw)
    assert.equal(await agent.approveRoutineQuery(listPrepared), true)
    assert.equal((await agent.execute(listRaw)).result.reminders.length, 1)
    const staleRaw = challenge('bank_create_im_reminder', { ...args, title: 'old binding' }, 'create-stale')
    const stale = await agent.prepare(staleRaw); await agent.approve(stale)
    routes.r1.bindingRevision = 'v2'
    await assert.rejects(agent.execute(staleRaw), { status: 409 })
    assert.equal((await request('/reminders')).status, 401)
    assert.equal((await request('/reminders', 'bob-token')).data.reminders.length, 0)
    assert.equal((await request('/reminders', 'alice-token', { ...args, bindingId: 'r1', requestId: 'portal-one' })).status, 400)
    const body = { ...args, title: 'portal reminder', bindingId: 'r1', confirmed: true, requestId: 'portal-one' }
    assert.equal((await request('/reminders', 'bob-token', body)).status, 409)
    const fromPortal = await request('/reminders', 'alice-token', body)
    assert.equal(fromPortal.status, 200)
    assert.equal((await request('/reminders', 'alice-token', body)).data.id, fromPortal.data.id)
    assert.equal((await request('/reminders/' + fromPortal.data.id, 'bob-token', { confirmed: true, requestId: 'cancel-bob' }, 'DELETE')).status, 404)
    assert.equal((await request('/reminders/' + fromPortal.data.id, 'alice-token', { confirmed: true, requestId: 'cancel-alice' }, 'DELETE')).data.status, 'cancelled')
    assert.equal(transportCalls, 0)
  } finally { agent.close(); await reminders.close(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }) }
})
