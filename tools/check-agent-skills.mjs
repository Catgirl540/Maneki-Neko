/** 本地协议夹具 → 真实 Harness 技能加载 → 临时银行确认。不是模型路由准确率测试。 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { validateSkills } from '../framework/scripts/check-skills.mjs'
import { fixture as bankFixture } from '../server/testing/http-fixture.mjs'
import { createPgClient } from '../server/pg-client.mjs'
import { randomBytes } from 'node:crypto'

const root = resolve(import.meta.dirname, '..')
const dir = await mkdtemp(join(tmpdir(), 'bank-skills-harness-'))
const cases = JSON.parse(await readFile(join(root, 'framework/packages/skills/tests/cases.json'), 'utf8'))
const skills = validateSkills().skills
const children = [], requests = [], issues = [], fixtures = new Map(), cursors = new Map()
const sleep = ms => new Promise(r => setTimeout(r, ms))
const listen = server => new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)))
async function freePort() { const s = createServer(); const p = await listen(s); await new Promise(r => s.close(r)); return p }
const env = { ...process.env }
for (const name of Object.keys(env)) if (/TOKEN|API_KEY|ACCESS_KEY|SECRET/.test(name)) delete env[name]
let bank, backend, sessionDb, sessionFixtureReady = false, agent, bridge, a, b, launch, fixtureSeq = 0
function start(file, extra) {
  const p = spawn(process.execPath, [join(root, file)], { cwd: root, detached: true, env: { ...env, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] })
  const child = { p, log: '' }; children.push(child)
  p.stdout.on('data', x => child.log += x); p.stderr.on('data', x => child.log += x)
  return child
}
async function stop(child) {
  if (child.p.exitCode !== null || child.p.signalCode !== null) return
  process.kill(-child.p.pid, 'SIGTERM')
  await Promise.race([once(child.p, 'exit'), sleep(5000)])
  if (child.p.exitCode === null && child.p.signalCode === null) { process.kill(-child.p.pid, 'SIGKILL'); await once(child.p, 'exit') }
}
async function api(origin, path, token, body) {
  const response = await fetch(origin + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) })
  return { status: response.status, data: await response.json() }
}
async function call(origin, path, token, body) { const r = await api(origin, path, token, body); assert(r.status < 300, JSON.stringify(r)); return r.data }
async function ready(child, origin, path, token) {
  for (let n = 0; n < 150; n++) {
    assert(child.p.exitCode === null, child.log)
    try { if ((await api(origin, path, token)).status === 200) return } catch {}
    await sleep(100)
  }
  throw Error(child.log)
}
const provider = createServer(async (req, res) => {
  try {
    let body = ''; for await (const chunk of req) body += chunk
    const data = JSON.parse(body); requests.push(data)
    assert(!body.includes(a.token) && !body.includes(b.token) && !body.includes('888888'), '凭据进入模型请求')
    const fixture = [...fixtures.values()].reverse().find(f => JSON.stringify(data.messages).includes(f.marker))
    assert(fixture, '未知协议夹具')
    fixture.requests.push(data)
    const index = fixture.next++, tool = fixture.steps[index]
    if (fixture.inspect) fixture.inspect(data, index)
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const send = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ id: 'skills-' + requests.length, object: 'chat.completion.chunk', created: 1, model: 'skills-test', choices: [{ index: 0, delta, finish_reason }] })}\n\n`)
    if (tool) {
      send({ role: 'assistant', tool_calls: [{ index: 0, id: `skill_call_${requests.length}`, type: 'function', function: { name: tool.name, arguments: JSON.stringify(tool.args) } }] })
      send({}, 'tool_calls')
    } else {
      // 两帧可见正文，验证技能没有改变增量输出通道。
      send({ role: 'assistant', content: '已取得本轮处理结果，' })
      await sleep(120)
      send({ content: '请以银行回执状态为准。' }); send({}, 'stop')
    }
    res.end('data: [DONE]\n\n')
  } catch (error) { issues.push(error); if (!res.headersSent) res.writeHead(500); res.end('{}') }
})
async function receive(id, consent) {
  const events = [], deadline = Date.now() + 45000
  while (Date.now() < deadline) {
    if (issues.length) throw issues[0]
    const batch = await call(agent, `/agent-api/sessions/${id}/events?after=${cursors.get(id) ?? 0}`, a.token)
    cursors.set(id, batch.cursor)
    for (const event of batch.events) {
      events.push(event)
      if (event.type === 'error') throw Error(event.message + '\n' + bridge.log)
      if (event.type === 'consent') {
        assert(consent, '技能加载不应该产生业务确认')
        await consent(event.challenge)
      }
      if (event.type === 'question') {
        const q = event.question
        await call(agent, `/agent-api/questions/${q.questionId}/answer`, a.token, { answers: [{ id: 'purpose', selected: ['生活'] }] })
      }
      if (event.type === 'status' && event.status === 'idle') return events
    }
    await sleep(30)
  }
  throw Error('等待技能轮次超时 ' + JSON.stringify(events) + '\n' + bridge.log)
}
async function run(text, steps, options = {}) {
  const marker = `skills_fixture_${++fixtureSeq}_end`
  const fixture = { marker, steps, next: 0, requests: [], inspect: options.inspect }
  fixtures.set(marker, fixture)
  const id = options.sessionId ?? (await call(agent, '/agent-api/sessions', a.token, {})).sessionId
  assert.equal((await api(agent, `/agent-api/sessions/${id}`, b.token)).status, 404)
  await call(agent, `/agent-api/sessions/${id}/messages`, a.token, { text: `${text}\n${marker}`, ...(options.image ? { image: options.image } : {}), ...(options.serviceIds !== undefined ? { serviceIds: options.serviceIds } : {}) })
  const events = await receive(id, options.consent)
  assert(events.some(e => e.type === 'assistant-update'), '缺少流式正文')
  return { id, events, fixture }
}
const strings = value => typeof value === 'string' ? value : Array.isArray(value) ? value.map(strings).join('\n') : value && typeof value === 'object' ? Object.values(value).map(strings).join('\n') : ''
const load = name => ({ name: 'skill', args: { name } })
const approve = c => call(agent, `/agent-api/consent/${c.challengeId}`, a.token, { decision: 'approve', ...(c.verification === 'payment-password' ? { paymentPassword: '888888' } : {}) })

try {
  const sessionUrl = process.env.LUCKYCAT_SESSION_TEST_DATABASE_URL
  assert(sessionUrl, '必须显式提供独立的 PostgreSQL Agent 测试库')
  const parsed = new URL(sessionUrl)
  assert(['postgres:', 'postgresql:'].includes(parsed.protocol))
  assert.match(parsed.pathname, /^\/maneki_ai_sessions_test(?:_[a-z0-9_]+)?$/)
  sessionDb = createPgClient(sessionUrl)
  assert.match((await sessionDb.query('SELECT current_database() AS name')).rows[0].name, /^maneki_ai_sessions_test(?:_[a-z0-9_]+)?$/)
  sessionFixtureReady = true
  await sessionDb.query('DROP SCHEMA IF EXISTS ai_sessions CASCADE')
  await sessionDb.query(await readFile(join(root, 'framework/bridge/session-schema.sql'), 'utf8'))
  const sessionKey = randomBytes(32).toString('base64')
  backend = await bankFixture({ reviewThreshold: 50000000 })
  bank = backend.base; agent = `http://127.0.0.1:${await freePort()}`
  const login = async phone => { const sms = await call(bank, '/api/auth/sms-code', null, { phone }); return call(bank, '/api/auth/login', null, { phone, password: '123456', smsCode: sms.demoCode }) }
  a = await login('13800138000'); b = await login('13600136000')
  const providerPort = await listen(provider), patch = join(dir, 'provider.yml')
  await writeFile(patch, JSON.stringify([
    { id: 'llm-pi-ai', config: { providers: { test: { apiKeyEnv: 'LUCKYCAT_TEST_KEY', api: 'openai-completions', baseURL: `http://127.0.0.1:${providerPort}/v1`, models: [{ id: 'skills-test', name: 'Test', contextWindow: 128000, input: ['text', 'image'] }] } } } },
    { id: 'luckycat-embedding', disabled: true },
  ]))
  launch = async () => {
    bridge = start('framework/bridge/demo-server.mjs', { LUCKYCAT_DEMO_PORT: new URL(agent).port, LUCKYCAT_BANK_URL: bank, LUCKYCAT_SESSION_DATABASE_URL: sessionUrl, LUCKYCAT_SESSION_DATA_KEY: sessionKey, LUCKYCAT_SESSION_DIR: join(dir, 'context'), LUCKYCAT_PROVIDER: 'test', LUCKYCAT_MODEL: 'skills-test', LUCKYCAT_TEST_KEY: 'local-only', LUCKYCAT_PATCHES: patch, LUCKYCAT_DISABLE_VOICE: '1' })
    await ready(bridge, agent, '/agent-api/health', a.token)
  }
  await launch()
  for (const c of cases) {
    const result = await run(c.query, c.expectedSkills.map(load))
    const first = JSON.stringify(result.fixture.requests[0])
    for (const s of skills) assert(first.includes(s.skillName) && first.includes(s.header.description), '技能目录不完整')
    for (const s of skills) assert(!strings(result.fixture.requests[0].messages).includes(s.content), '初始目录不应全量加载正文')
    const toolResults = result.events.filter(e => e.type === 'tool-result')
    assert.equal(toolResults.length, c.expectedSkills.length)
    assert(toolResults.every(e => !e.isError))
    const after = strings(result.fixture.requests.at(-1).messages)
    for (const name of c.expectedSkills) assert(after.includes(skills.find(s => s.skillName === name).content), `${c.id}: 正文没有进入模型上下文`)
    for (const phrase of c.instructionIncludes) assert(after.includes(phrase), `${c.id}: 缺少完整业务条件`)
  }
  console.log(`PASS ${cases.length} 个协议用例：目录、自动调用加载、多技能组合、完整正文与流式返回（不代表真实模型意图准确率）`)
  const explicit = await run('/bank-transfer /bank-cards 先核对再办理', [], { inspect: data => {
    const text = strings(data.messages)
    for (const name of ['bank-transfer', 'bank-cards']) assert(text.includes(skills.find(s => s.skillName === name).content), '显式调用未注入完整技能')
  } })
  assert(!explicit.events.some(e => e.type === 'tool-result'))
  const unknown = await run('加载一个未知技能', [load('bank-unknown')])
  assert(unknown.events.some(e => e.type === 'tool-result' && e.isError))
  const traversal = await run('不能读任意路径', [load('../../etc/passwd')])
  assert(traversal.events.some(e => e.type === 'tool-result' && e.isError))
  console.log('PASS 显式技能无需模型再次加载；未知名称和路径输入被拒绝')

  const selected = await run('只说明使用方法', [], { serviceIds: ['cards', 'transfer'], inspect: data => {
    const text = strings(data.messages)
    for (const name of ['bank-cards', 'bank-transfer']) assert(text.includes(skills.find(s => s.skillName === name).content))
  } })
  assert(!selected.events.some(e => e.type === 'consent'))
  await run('清除选择后问普通问题', [], { sessionId: selected.id, serviceIds: [], inspect: data => {
    const current = data.messages.filter(m => m.role === 'user').findLast(m => strings(m).includes('清除选择后问普通问题'))
    assert(strings(current).includes('本轮未指定智能服务'))
    assert(!strings(current).includes('/bank-'))
  } })
  for (const serviceIds of [['bank-cards'], ['../../etc/passwd'], null, Array(11).fill('cards')]) {
    const result = await api(agent, `/agent-api/sessions/${selected.id}/messages`, a.token, { text: '无效选择', serviceIds })
    assert.equal(result.status, 400)
    assert.equal(result.data.code, 'INVALID_SERVICE_SELECTION')
  }
  console.log('PASS 网页功能 ID 自动注入对应完整技能，多选/清除按轮生效；非法选择在入队前拒绝')

  const context = await run('/bank-cards 记住本轮的紫鲸卡片计划', [], { image: { mimeType: 'image/png', data: (await readFile(join(root, 'app/public/banks/hk-041.png'))).toString('base64') } })
  await stop(bridge); await launch()
  await run('继续刚才计划', [], { sessionId: context.id, inspect: data => {
    const text = strings(data.messages)
    assert(text.includes('紫鲸卡片计划') && text.includes('image_url'))
    assert(text.includes(skills.find(s => s.skillName === 'bank-cards').content), '恢复后丢失已加载技能')
  } })
  console.log('PASS 重启恢复原会话、已加载技能与图片；跨客户访问始终拒绝')

  const accounts = await call(bank, '/api/accounts', a.token), other = await call(bank, '/api/accounts', b.token)
  const transfer = { name: 'bank_transfer', args: { fromAccountId: accounts[0].id, payeeName: b.user.name, payeeAccountNo: other[0].accountNo, payeeBankCode: 'LCB', payeeBankRegion: 'CN', amountCents: 500 } }
  const balance = accounts[0].balance
  const cancelled = await run('转账但在确认卡取消', [load('bank-transfer'), transfer], { consent: async c => {
    assert.equal((await call(bank, '/api/accounts', a.token))[0].balance, balance)
    await call(agent, `/agent-api/consent/${c.challengeId}`, a.token, { decision: 'reject' })
  } })
  assert(cancelled.events.some(e => e.type === 'tool-result' && e.isError))
  assert.equal((await call(bank, '/api/accounts', a.token))[0].balance, balance)
  await run('转账并验证支付密码', [load('bank-transfer'), transfer], { consent: async c => {
    assert.equal(c.verification, 'payment-password')
    assert.equal((await api(agent, `/agent-api/consent/${c.challengeId}`, b.token, { decision: 'approve' })).status, 404)
    assert.equal((await api(agent, `/agent-api/consent/${c.challengeId}`, a.token, { decision: 'approve', paymentPassword: '000000' })).status, 401)
    assert.equal((await call(bank, '/api/accounts', a.token))[0].balance, balance)
    await approve(c)
  } })
  assert.equal((await call(bank, '/api/accounts', a.token))[0].balance, balance - 500)
  const cards = await call(bank, '/api/cards', a.token), card = cards.find(c => c.status === 'active')
  await run('锁定已查得的卡', [load('bank-security'), { name: 'bank_set_card_lock', args: { cardId: card.id, locked: true } }], { consent: async c => {
    assert.notEqual(c.verification, 'payment-password'); await approve(c)
  } })
  assert.equal((await call(bank, '/api/cards', a.token)).find(c => c.id === card.id).status, 'locked')
  const products = await call(bank, '/api/cards/products', a.token), count = cards.length
  await run('申请新卡', [load('bank-cards'), { name: 'bank_apply_card', args: { productCode: products[0].code, recipient: a.user.name, phone: a.user.phone, region: '上海市', city: '上海市', detail: '测试路一号一栋一室' } }], { consent: async c => {
    assert.equal(c.verification, 'payment-password'); assert.equal((await call(bank, '/api/cards', a.token)).length, count); await approve(c)
  } })
  assert.equal((await call(bank, '/api/cards', a.token)).length, count + 1)
  assert((await call(bank, '/api/cards', a.token)).some(c => c.status === 'pending'))
  const wealth = await call(bank, '/api/wealth/products', a.token)
  const precondition = await run('未开户不能申购', [load('bank-wealth'), { name: 'bank_wealth_subscribe', args: { productCode: wealth[0].code, amountCents: wealth[0].minAmount } }])
  assert(precondition.events.some(e => e.type === 'tool-result' && e.isError))
  assert.equal((await call(bank, '/api/wealth/overview', a.token)).holdings.length, 0)
  // 仅在临时测试银行准备测评和账户，不把这些操作新增为 Agent 能力。
  const questions = await call(bank, '/api/wealth/risk/questions', a.token)
  await call(bank, '/api/wealth/risk/assess', a.token, { answers: questions.map(q => q.options.reduce((best, o, i, all) => o.score > all[best].score ? i : best, 0)) })
  await import('./ts-resolve-hook.mjs')
  const { WEALTH_INVESTMENT_AGREEMENT } = await import('../app/src/lib/wealth.ts')
  const sms = await call(bank, '/api/auth/sms-code', a.token, { phone: a.user.phone })
  const face = await call(bank, '/api/security/verify', a.token, { channel: 'face' })
  await call(bank, '/api/wealth/account/open', a.token, { smsCode: sms.demoCode, faceTicket: face.ticket, settlementAccountId: accounts[0].id, agreement: WEALTH_INVESTMENT_AGREEMENT })
  const product = wealth.find(p => p.openEnded)
  const subscription = { name: 'bank_wealth_subscribe', args: { productCode: product.code, amountCents: Math.max(product.minAmount, product.stepAmount) } }
  await run('取消理财申购', [load('bank-wealth'), subscription], { consent: c => call(agent, `/agent-api/consent/${c.challengeId}`, a.token, { decision: 'reject' }) })
  assert.equal((await call(bank, '/api/wealth/overview', a.token)).holdings.length, 0)
  await run('确认理财申购', [load('bank-wealth'), subscription], { consent: async c => {
    assert(c.riskAcknowledgementText)
    const missing = await api(agent, `/agent-api/consent/${c.challengeId}`, a.token, { decision: 'approve', paymentPassword: '888888' })
    assert.equal(missing.status, 400)
    assert.equal((await call(bank, '/api/wealth/overview', a.token)).holdings.length, 0)
    await call(agent, `/agent-api/consent/${c.challengeId}`, a.token, { decision: 'approve', paymentPassword: '888888', riskAcknowledgement: c.riskAcknowledgementText })
  } })
  assert.equal((await call(bank, '/api/wealth/overview', a.token)).holdings.length, 1)
  console.log('PASS 技能不绕过取消、归属、支付验密、锁卡、新卡寄送状态与理财前置条件和风险抄录')

  const kb = await run('转账费用规则', [load('bank-transfer'), { name: 'knowledge_lookup', args: { query: '转账手续费最低费用与费用上限' } }])
  assert(kb.events.filter(e => e.type === 'tool-result').every(e => !e.isError))
  assert(JSON.stringify(kb.fixture.requests.at(-1).messages).includes('50 元不是费用上限'))
  const question = await run('缺少用途需补充', [load('bank-transfer'), { name: 'ask_user_question', args: { questions: [{ id: 'purpose', question: '请选择用途', options: [{ label: '生活', description: '日常支出' }, { label: '其他', description: '其他用途' }] }] } }])
  assert(question.events.some(e => e.type === 'question'))
  console.log('PASS 关键词知识检索、提问卡片、图片和增量输出继续工作；所有服务及数据均隔离在本地')
  console.log('ALL PASS')
} catch (error) { console.error(bridge?.log); throw error }
finally {
  for (const child of children.toReversed()) await stop(child)
  provider.closeAllConnections(); await new Promise(r => provider.close(r))
  await backend?.close()
  if (sessionDb) {
    try { if (sessionFixtureReady) await sessionDb.query('DROP SCHEMA IF EXISTS ai_sessions CASCADE') }
    finally { await sessionDb.close() }
  }
  await rm(dir, { recursive: true, force: true })
}
