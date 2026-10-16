import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStaffAuth, ensureStaffSchema, makeWriteAudit } from './staff-api.mjs'
import { createOpsTerminal } from './ops-terminal.mjs'

const PASSWORD = 'terminal-isolated-test-2026'
async function fixture({ enabled = true, password = PASSWORD, idleMs } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'bank-terminal-test-'))
  await mkdir(join(root, 'tab-one'))
  const db = new DatabaseSync(':memory:'); ensureStaffSchema(db)
  if (password) db.prepare("UPDATE staff_users SET password_hash = ? WHERE id = 'staff_ops'").run(`sha256:${createHash('sha256').update(password).digest('hex')}`)
  const auth = createStaffAuth(db), audit = makeWriteAudit(db)
  const terminal = createOpsTerminal({ auth, db, root, writeAudit: audit, enabled, password, ...(idleMs ? { idleMs } : {}) })
  const server = createServer(async (req, res) => {
    try { if (!await terminal.handle(req, res, new URL(req.url, 'http://localhost'))) { res.writeHead(404); res.end() } }
    catch (e) { res.writeHead(e.status ?? 500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ code: e.code, message: e.message })) }
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const base = `http://127.0.0.1:${server.address().port}/staff-api/ops/terminal/sessions`
  const ops = auth.login('运维人员', password ?? '123456').token
  async function call(path = '', method = 'GET', body, token = ops) {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    return { status: res.status, body: await res.json() }
  }
  async function stream(id, token = ops, after = 0) {
    const controller = new AbortController()
    const response = await fetch(`${base}/${id}/events?after=${after}`, { headers: { authorization: `Bearer ${token}` }, signal: controller.signal })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('x-accel-buffering'), 'no')
    const reader = response.body.getReader(), decoder = new TextDecoder()
    let buffer = '', text = '', cursor = after
    async function until(pattern) {
      const timeout = setTimeout(() => controller.abort(), 5000)
      try {
        while (!pattern.test(text)) {
          const value = await reader.read(); if (value.done) throw new Error('stream ended before expected output')
          buffer += decoder.decode(value.value, { stream: true })
          let end
          while ((end = buffer.indexOf('\n\n')) >= 0) {
            const event = buffer.slice(0, end); buffer = buffer.slice(end + 2)
            const data = event.split('\n').find(line => line.startsWith('data: '))?.slice(6)
            if (!data) continue
            cursor = Number(event.split('\n').find(line => line.startsWith('id: '))?.slice(4))
            const frame = JSON.parse(data); if (frame.type === 'output') text += frame.data
          }
        }
        return text
      } finally { clearTimeout(timeout) }
    }
    return { reader, controller, until, cursor: () => cursor, close: async () => { controller.abort(); await reader.cancel().catch(() => {}) } }
  }
  return { root, db, auth, ops, call, stream, close: async () => { terminal.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close(); await rm(root, { recursive: true, force: true }) } }
}

const ptySkip = process.getuid?.() === 0 ? 'PTY backend deliberately refuses root' : false

test('terminal denies anonymous, business staff and Agent; explicit enable is required', async () => {
  const f = await fixture({ enabled: false })
  try {
    assert.equal((await f.call('', 'POST', { cols: 80, rows: 24 }, null)).status, 401)
    for (const name of ['王小明', '李主管']) assert.equal((await f.call('', 'POST', { cols: 80, rows: 24 }, f.auth.login(name, '123456').token)).status, 403)
    assert.equal((await f.call('', 'POST', { cols: 80, rows: 24 }, 'demo-agent-token')).status, 401)
    assert.equal((await f.call('', 'POST', { cols: 80, rows: 24 })).body.code, 'TERMINAL_DISABLED')
  } finally { await f.close() }
})

test('public demo credential cannot enable a shell', { skip: ptySkip }, async () => {
  const f = await fixture({ password: '123456' })
  try { const result = await f.call('', 'POST', { cols: 80, rows: 24 }); assert.equal(result.status, 503); assert.equal(result.body.code, 'TERMINAL_UNSAFE_CREDENTIAL') }
  finally { await f.close() }
})

test('real PTYs: independent tabs, ANSI output, resize, Ctrl+C, reconnect and ownership', { skip: ptySkip }, async () => {
  const f = await fixture(); let one, two, resumed
  try {
    assert.equal((await f.call('', 'POST', { cols: 0, rows: 24 })).status, 400)
    assert.equal((await f.call('', 'POST', null)).status, 400)
    const first = await f.call('', 'POST', { cols: 80, rows: 24 }), second = await f.call('', 'POST', { cols: 80, rows: 24 })
    assert.equal(first.status, 201); assert.equal(second.status, 201)
    const id1 = first.body.id, id2 = second.body.id
    assert.notEqual(id1, id2)
    const otherToken = f.auth.login('运维人员', PASSWORD).token
    assert.equal((await f.call(`/${id1}/input`, 'POST', { data: 'echo forbidden\r' }, otherToken)).status, 404)
    assert.deepEqual((await f.call('', 'GET', undefined, otherToken)).body, [])
    one = await f.stream(id1); two = await f.stream(id2)
    await f.call(`/${id1}/input`, 'POST', { data: 'cd tab-one\rprintf "\\033[32m%s%s\\033[0m\\n" "__TAB_" "ONE__"\rpwd\r' })
    const firstText = await one.until(/__TAB_ONE__/); assert.match(firstText, /\x1b\[32m/)
    await one.until(new RegExp(f.root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/tab-one'))
    await f.call(`/${id2}/input`, 'POST', { data: 'printf "%s%s\\n" "__TAB_" "TWO__"\rpwd\r' })
    const secondText = await two.until(/__TAB_TWO__/); assert(!secondText.includes('__TAB_ONE__'))
    await f.call(`/${id2}/resize`, 'POST', { cols: 100, rows: 32 })
    await f.call(`/${id2}/input`, 'POST', { data: 'stty size\r' }); await two.until(/32 100/)
    await f.call(`/${id2}/input`, 'POST', { data: 'sleep 20\r' })
    await new Promise(resolve => setTimeout(resolve, 100))
    await f.call(`/${id2}/input`, 'POST', { data: '\x03' })
    await f.call(`/${id2}/input`, 'POST', { data: 'printf "%s%s\\n" "__INTERRUPT_" "OK__"\r' }); await two.until(/__INTERRUPT_OK__/)
    const cursor = one.cursor(); await one.close()
    await f.call(`/${id1}/input`, 'POST', { data: 'printf "%s%s\\n" "__RESUME_" "OK__"\r' })
    resumed = await f.stream(id1, f.ops, cursor); const replay = await resumed.until(/__RESUME_OK__/); assert(!replay.includes('__TAB_ONE__'))
    assert.equal((await f.call(`/${id1}/input`, 'POST', { data: 'x'.repeat(20_000) })).status, 400)
    assert.equal((await f.call(`/${id1}/events?after=-1`)).status, 400)
    await resumed.close(); await two.close()
    assert.equal((await f.call(`/${id1}`, 'DELETE')).status, 200)
    assert.equal((await f.call(`/${id1}/input`, 'POST', { data: '\r' })).status, 404)
    f.auth.logout({ headers: { authorization: `Bearer ${f.ops}` } })
    assert.equal((await f.call(`/${id2}/input`, 'POST', { data: '\r' })).status, 401)
    assert.deepEqual((await f.call('', 'GET', undefined, otherToken)).body, [])
    const logs = f.db.prepare("SELECT * FROM audit_logs WHERE action LIKE 'ops.terminal.%'").all()
    assert(logs.some(log => log.action === 'ops.terminal.open') && logs.some(log => log.action === 'ops.terminal.close'))
    assert(!JSON.stringify(logs).includes(f.ops)); assert(!JSON.stringify(logs).includes('__TAB_ONE__'))
  } finally { await one?.close(); await two?.close(); await resumed?.close(); await f.close() }
})

test('concurrent session limit and idle cleanup release terminal processes', { skip: ptySkip }, async () => {
  const f = await fixture({ idleMs: 1000 })
  try {
    const result = await Promise.all(Array.from({ length: 10 }, () => f.call('', 'POST', { cols: 80, rows: 24 })))
    assert.equal(result.filter(value => value.status === 201).length, 8)
    assert.equal(result.filter(value => value.status === 429).length, 2)
    await new Promise(resolve => setTimeout(resolve, 2200))
    assert.deepEqual((await f.call()).body, [])
  } finally { await f.close() }
})
