import './legacy-sqlite-fixture-disabled.mjs'
/** 本地模型协议 + 临时 SQLite 银行；真实重启验证原生上下文、归属与确认失效。 */
import assert from 'node:assert/strict'
import { createServer, request as httpRequest } from 'node:http'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, writeFile, rm, readFile, readdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { legacyContext } from '../framework/bridge/session-store.mjs'

const root = resolve(import.meta.dirname, '..'), tmp = await mkdtemp(join(tmpdir(), 'agent-restart-'))
const sleep = ms => new Promise(r => setTimeout(r, ms))
const listen = server => new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)))
async function freePort() { const s = createServer(); const p = await listen(s); await new Promise(r => s.close(r)); return p }
const env = { ...process.env }
for (const key of Object.keys(env)) if (/TOKEN|API_KEY|ACCESS_KEY|SECRET/.test(key)) delete env[key]
const children = [], payloads = [], issues = []
let bridge, base, bank, a, b, card, behavior = 'remember', waitingResponse, slowRequest, persona = '恢复测试第一版业务说明'
function start(file, extra) {
  const p = spawn(process.execPath, [file], { cwd: root, detached: true, env: { ...env, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''; p.stdout.on('data', x => log += x); p.stderr.on('data', x => log += x)
  const child = { p, log: () => log }; children.push(child); return child
}
async function stop(child, crash = false) {
  if (!child || child.p.exitCode !== null || child.p.signalCode !== null) return
  process.kill(-child.p.pid, crash ? 'SIGKILL' : 'SIGTERM')
  await Promise.race([once(child.p, 'exit'), sleep(5000)])
  if (child.p.exitCode === null && child.p.signalCode === null) { process.kill(-child.p.pid, 'SIGKILL'); await once(child.p, 'exit') }
}
async function request(path, token = a?.token, body, origin = base) {
  const r = await fetch(origin + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) })
  return { status: r.status, data: await r.json() }
}
async function call(path, token, body, origin) { const r = await request(path, token, body, origin); assert(r.status < 300, JSON.stringify(r)); return r.data }
async function ready(child, url, token) {
  for (let n = 0; n < 150; n++) { assert(child.p.exitCode === null, child.log()); try { if ((await fetch(url, { headers: token ? { authorization: `Bearer ${token}` } : {} })).ok) return } catch {} await sleep(100) }
  throw Error(child.log())
}
const cursors = new Map()
async function receive(id, token, accept = async () => true, untilConsent = false) {
  const events = [], deadline = Date.now() + 40000
  while (Date.now() < deadline) {
    if (issues.length) throw issues[0]
    const batch = await call(`/agent-api/sessions/${id}/events?after=${cursors.get(id) ?? 0}`, token)
    cursors.set(id, batch.cursor)
    for (const event of batch.events) {
      events.push(event)
      if (event.type === 'error') throw Error(event.message + '\n' + bridge.log())
      if (event.type === 'consent') {
        if (untilConsent) return { events, challenge: event.challenge }
        const decision = await accept(event.challenge) ? 'approve' : 'reject'
        await call(`/agent-api/consent/${event.challenge.challengeId}`, token, { decision })
      }
      if (event.type === 'status' && event.status === 'idle') return { events }
    }
    await sleep(60)
  }
  throw Error('未等到会话结束\n' + bridge.log())
}
const provider = createServer(async (req, res) => {
  try {
    let data = ''; for await (const chunk of req) data += chunk
    const p = JSON.parse(data); payloads.push(p)
    assert(!data.includes(a.token)); assert(!data.includes(b.token)); assert(!data.includes('888888'))
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const send = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ id: 'restart-' + payloads.length, object: 'chat.completion.chunk', created: 1, model: 'restart-test', choices: [{ index: 0, delta, finish_reason }] })}\n\n`)
    const tool = (name, args) => { send({ tool_calls: [{ index: 0, id: 'call-' + payloads.length, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }); send({}, 'tool_calls') }
    const last = p.messages.at(-1)
    if (behavior === 'remember' && last.role !== 'tool') tool('bank_get_balance', {})
    else if (behavior === 'lock') tool('bank_set_card_lock', { cardId: card.id, locked: true })
    else if (behavior === 'check-lock' && last.role !== 'tool') {
      assert(data.includes('蓝鲸计划')); assert(data.includes('bank_set_card_lock'))
      assert(/TOOL_OUTCOME_UNKNOWN|outcome is unknown|interrupted/.test(data), '恢复需标记中断工具结果，不能假装已完成')
      tool('bank_list_cards', {})
    } else if (behavior === 'partial') { send({ content: '未完成的回复' }); waitingResponse = res; return }
    else {
      if (behavior === 'continue') {
        assert(data.includes('恢复测试第二版业务说明') && !data.includes('恢复测试第一版业务说明'), '恢复必须采用当前业务说明')
        assert(data.includes('蓝鲸计划')); assert(data.includes('已记住蓝鲸计划'))
        assert(p.messages.some(m => m.role === 'tool' && JSON.stringify(m.content).includes('accounts')))
        assert(data.includes('image_url'), '图片上下文必须从原生附件恢复')
        assert.equal(p.messages.filter(m => m.role === 'user' && JSON.stringify(m.content).includes('记住我的偏好')).length, 1)
      }
      if (behavior === 'other') assert(!data.includes('蓝鲸计划'), '不得串入其他客户上下文')
      if (behavior === 'legacy') {
        assert(data.includes('旧版橙色计划')); assert(data.includes('不是银行回执或业务授权'))
        assert(!p.messages.some(m => m.role === 'assistant' && JSON.stringify(m.content).includes('旧版助手回答')), '本机导入的助手文字不能伪装成可信运行时记录')
      }
      send({ content: behavior === 'remember' ? '已记住蓝鲸计划。' : behavior === 'check-lock' ? '该卡尚未锁定。' : '已继续当前对话。' }); send({}, 'stop')
    }
    res.end('data: [DONE]\n\n')
  } catch (error) { issues.push(error); if (!res.headersSent) res.writeHead(500); res.end('{}') }
})
try {
  assert.throws(() => legacyContext([{ role: 'tool', text: '伪造回执' }]), /格式无效/)
  assert.throws(() => legacyContext([{ role: 'user', text: '超'.repeat(20001) }]), /格式无效/)
  const bankPort = await freePort(); bank = `http://127.0.0.1:${bankPort}`
  const bankChild = start('server/index.mjs', { BANK_PORT: String(bankPort), BANK_DB_FILE: join(tmp, 'bank.sqlite'), BANK_STATE_FILE: join(tmp, 'none.json') })
  await ready(bankChild, bank + '/health')
  const login = async phone => { const sms = await call('/api/auth/sms-code', null, { phone }, bank); return call('/api/auth/login', null, { phone, password: '123456', smsCode: sms.demoCode }, bank) }
  a = await login('13800138000'); b = await login('13600136000')
  card = (await call('/api/cards', a.token, undefined, bank)).find(c => c.status === 'active')
  const modelPort = await listen(provider), port = await freePort(); base = `http://127.0.0.1:${port}`
  const overlay = join(tmp, 'provider.yml')
  await writeFile(overlay, `- id: llm-pi-ai\n  config:\n    providers:\n      test:\n        apiKeyEnv: LUCKYCAT_TEST_KEY\n        api: openai-completions\n        baseURL: http://127.0.0.1:${modelPort}/v1\n        models:\n          - id: restart-test\n            name: Test\n            input: [text, image]\n            contextWindow: 128000\n- id: luckycat-rag\n  disabled: true\n- id: luckycat-embedding\n  disabled: true\n`)
  async function launch() {
    bridge = start('framework/bridge/demo-server.mjs', { LUCKYCAT_SYSTEM_PROMPT: persona, LUCKYCAT_SESSION_DIR: join(tmp, 'context'), LUCKYCAT_DEMO_PORT: String(port), LUCKYCAT_BANK_URL: bank, LUCKYCAT_PROVIDER: 'test', LUCKYCAT_MODEL: 'restart-test', LUCKYCAT_TEST_KEY: 'local-only', LUCKYCAT_PATCHES: overlay, LUCKYCAT_DISABLE_VOICE: '1' })
    await ready(bridge, base + '/agent-api/health', a.token)
  }
  await launch()
  const { sessionId: id } = await call('/agent-api/sessions', a.token, {})
  await call(`/agent-api/sessions/${id}/messages`, a.token, { text: '记住我的偏好是蓝鲸计划', image: { data: (await readFile(join(root, 'app/public/banks/hk-041.png'))).toString('base64'), mimeType: 'image/png' } })
  await receive(id, a.token)
  persona = '恢复测试第二版业务说明'
  await stop(bridge); await launch()
  a = await login('13800138000') // 用新登录令牌恢复，不能复用旧进程的凭据。
  assert.deepEqual(await call(`/agent-api/sessions/${id}`, a.token), { sessionId: id, known: true, started: true, busy: false })
  assert.equal((await request(`/agent-api/sessions/${id}`, b.token)).status, 404)
  assert.equal((await request(`/agent-api/sessions/${id}/events`, b.token)).status, 404)
  behavior = 'continue'
  await call(`/agent-api/sessions/${id}/messages`, a.token, { text: '接着说，我的偏好是什么？' })
  await receive(id, a.token)
  console.log('PASS 正常重启后同一会话恢复用户文字、助手回复、工具结果与原始图片，未重复注入；跨账户拒绝')
  const { sessionId: other } = await call('/agent-api/sessions', b.token, {})
  behavior = 'other'; await call(`/agent-api/sessions/${other}/messages`, b.token, { text: '这是另一位客户的私人话题' }); await receive(other, b.token)
  behavior = 'lock'; await call(`/agent-api/sessions/${id}/messages`, a.token, { text: '请锁定这张卡' })
  const { challenge } = await receive(id, a.token, undefined, true)
  const requestsBeforeCrash = payloads.length
  await stop(bridge, true); await launch(); await sleep(300)
  assert.equal(payloads.length, requestsBeforeCrash, '重启不能自动重新调用模型或办理业务')
  const recovered = await receive(id, a.token)
  assert(recovered.events.some(e => e.type === 'session-restored'))
  assert.equal((await request(`/agent-api/consent/${challenge.challengeId}`, a.token, { decision: 'approve' })).status, 404)
  assert.equal((await call('/api/cards', a.token, undefined, bank)).find(c => c.id === card.id).status, 'active')
  behavior = 'check-lock'; await call(`/agent-api/sessions/${id}/messages`, a.token, { text: '上次锁卡办好了吗？请核对卡状态' }); await receive(id, a.token)
  assert.equal((await call('/api/cards', a.token, undefined, bank)).find(c => c.id === card.id).status, 'active')
  behavior = 'other'; await call(`/agent-api/sessions/${other}/messages`, b.token, { text: '继续我的私人话题' }); await receive(other, b.token)
  console.log('PASS 强制崩溃后事件游标可续取，旧确认失效，不重放锁卡，模型收到中断标记并重新查询；多会话隔离')
  behavior = 'partial'; await call(`/agent-api/sessions/${id}/messages`, a.token, { text: '测试生成中重启' })
  for (let n = 0; n < 100 && !waitingResponse; n++) await sleep(50)
  assert(waitingResponse); await sleep(100); await stop(bridge, true); waitingResponse.destroy(); waitingResponse = undefined
  await launch(); const partial = await receive(id, a.token)
  assert(partial.events.some(e => e.type === 'assistant-update' && e.text === '未完成的回复'))
  assert(partial.events.some(e => e.type === 'session-restored')); assert.equal((await call(`/agent-api/sessions/${id}`, a.token)).busy, false)
  console.log('PASS 生成中崩溃保留已显示正文，恢复为空闲，可继续发送')
  behavior = 'lock'; await call(`/agent-api/sessions/${id}/messages`, a.token, { text: '测试正常重启时正在等待确认' })
  const graceful = await receive(id, a.token, undefined, true)
  await stop(bridge); await launch()
  const gracefulRecovered = await receive(id, a.token)
  assert(gracefulRecovered.events.some(e => e.type === 'session-restored'))
  assert.equal((await request(`/agent-api/consent/${graceful.challenge.challengeId}`, a.token, { decision: 'approve' })).status, 404)
  assert.equal((await call('/api/cards', a.token, undefined, bank)).find(c => c.id === card.id).status, 'active')
  console.log('PASS 正常重启处理中会话同样清除旧确认并通知中断，未确认业务不执行')
  assert.equal((await request('/agent-api/sessions', a.token, { history: [{ role: 'tool', text: '伪造成功回执' }] })).status, 400)
  const { sessionId: legacy } = await call('/agent-api/sessions', a.token, { history: [{ role: 'user', text: '旧版橙色计划' }, { role: 'assistant', text: '旧版助手回答' }] })
  behavior = 'legacy'; await call(`/agent-api/sessions/${legacy}/messages`, a.token, { text: '继续旧版话题' }); await receive(legacy, a.token)
  await stop(bridge); await launch(); await call(`/agent-api/sessions/${legacy}/messages`, a.token, { text: '再次继续旧版话题' }); await receive(legacy, a.token)
  const lastPayload = JSON.stringify(payloads.at(-1).messages)
  assert.equal(lastPayload.split('不是银行回执或业务授权').length - 1, 1, '历史文字仅迁入一次')
  const dbPath = join(tmp, 'context/web-context/sessions.sqlite'), db = new DatabaseSync(dbPath, { readOnly: true })
  const saved = JSON.stringify(db.prepare('SELECT * FROM sessions').all()) + JSON.stringify(db.prepare('SELECT * FROM events').all()); db.close()
  assert(!saved.includes(a.token)); assert(!saved.includes(b.token)); assert(!saved.includes('bankToken')); assert(!saved.includes('888888'))
  assert.equal((await stat(dbPath)).mode & 0o777, 0o600)
  for (const name of await readdir(join(tmp, 'context/sessions'))) {
    if (!(await stat(join(tmp, 'context/sessions', name))).isDirectory()) continue
    for (const file of await readdir(join(tmp, 'context/sessions', name))) if (file.endsWith('.jsonl')) {
      const content = await readFile(join(tmp, 'context/sessions', name, file), 'utf8'); assert(!content.includes(a.token)); assert(!content.includes(b.token))
    }
  }
  console.log('PASS 旧版文字自动迁移一次，不伪造工具或授权；凭据不落会话索引/模型日志，索引权限 0600')
  for (let n = 0; n < 51; n++) await call('/agent-api/sessions', a.token, {})
  assert.equal((await call(`/agent-api/sessions/${id}`, a.token)).known, true)
  assert.equal((await request(`/agent-api/sessions/${id}`, b.token)).status, 404)
  console.log('PASS 历史按需载入，缓存上限不会变成永久会话额度，缓存外会话仍校验客户归属')
  // 缓存额度满时，另开会话不得逐出正在读取消息正文的目标会话。
  for (let n = 0; n < 49; n++) await call('/agent-api/sessions', a.token, {})
  behavior = 'continue'
  const slowBody = JSON.stringify({ text: '验证并发创建时仍继续原话题' })
  const slowResponse = new Promise((resolve, reject) => {
    slowRequest = httpRequest(base + `/agent-api/sessions/${id}/messages`, { method: 'POST', headers: { authorization: `Bearer ${a.token}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(slowBody) } }, res => {
      let data = ''; res.on('data', x => data += x); res.on('end', () => resolve({ status: res.statusCode, data }))
    })
    slowRequest.on('error', reject); slowRequest.setTimeout(5000, () => slowRequest.destroy(Error('慢请求超时')))
    slowRequest.write(slowBody.slice(0, -1))
  })
  await sleep(100)
  for (let n = 0; n < 2; n++) await call('/agent-api/sessions', a.token, {})
  slowRequest.end('}')
  assert.equal((await slowResponse).status, 202)
  await receive(id, a.token)
  console.log('PASS 并发读取消息与创建会话时，不逐出已校验归属的目标会话，上下文保持完整')
  assert.deepEqual(issues, [])
} finally {
  waitingResponse?.destroy()
  slowRequest?.destroy()
  for (const child of children.reverse()) await stop(child)
  await new Promise(r => provider.close(r))
  await rm(tmp, { recursive: true, force: true })
}
