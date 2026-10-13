/** Live-model acceptance tests with an isolated bank. Key comes only from the process environment. */
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

if (!process.env.OPENROUTER_API_KEY) throw Error('请通过进程环境设置 OPENROUTER_API_KEY')
const root = fileURLToPath(new URL('../', import.meta.url))
const dir = await mkdtemp(join(tmpdir(), 'staff-live-model-'))
const free = async () => { const socket = createServer(); await new Promise(r => socket.listen(0, '127.0.0.1', r)); const port = socket.address().port; await new Promise(r => socket.close(r)); return port }
const [bankPort, agentPort] = await Promise.all([free(), free()])
const bank = `http://127.0.0.1:${bankPort}`, agent = `http://127.0.0.1:${agentPort}`
const model = process.env.LUCKYCAT_MODEL ?? 'z-ai/glm-5.3-flash'
const children = [], results = [], active = []
let log = ''
const safe = value => String(value).replaceAll(process.env.OPENROUTER_API_KEY, '[密钥已隐藏]').replace(/sk-or-v1-[\w-]+/g, '[密钥已隐藏]')
const start = (file, env) => {
  const child = spawn(process.execPath, [join(root, file)], { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  child.stdout.on('data', x => log += safe(x)); child.stderr.on('data', x => log += safe(x)); children.push(child)
}
const api = async (base, path, token, body) => {
  const res = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20_000) })
  const data = await res.json()
  if (!res.ok) throw Error(`${res.status}: ${safe(data.error ?? data.message ?? '请求失败')}`)
  return data
}
const ready = async (base, path, token) => { for (let i = 0; i < 100; i++) { try { await api(base, path, token); return } catch {} await new Promise(r => setTimeout(r, 100)) } throw Error(safe(log)) }
async function turn(name, who, prompt, { expectedTool, rejectWrite = false, noWrite = false, customerVerification = false, questionOnly = false } = {}) {
  const started = Date.now(), session = (await api(agent, '/agent-api/sessions', who.token, {})).sessionId
  active.push({ session, token: who.token })
  const events = [], resolved = new Set(); let cursor = '0', running = false, done = false
  await api(agent, `/agent-api/sessions/${session}/messages`, who.token, { text: prompt })
  for (let i = 0; i < 900 && !done; i++) {
    const page = await api(agent, `/agent-api/sessions/${session}/events?after=${cursor}`, who.token); cursor = page.cursor
    for (const event of page.events) {
      events.push(event)
      if (event.type === 'error') throw Error(`${name}: ${safe(event.message)}\n${safe(log.slice(-2000))}`)
      if (event.type === 'status') { if (event.status === 'running') running = true; if (running && event.status === 'idle') done = true }
      if (event.type === 'consent' && !resolved.has(event.challenge.challengeId)) {
        const c = event.challenge; resolved.add(c.challengeId)
        const write = ['staff_create_ticket', 'staff_update_ticket_status', 'staff_post_ticket_message', 'staff_customer_action', 'staff_decide_approval', 'staff_set_transfer_threshold'].includes(c.toolName)
        if (write && (noWrite || c.toolName !== expectedTool)) {
          await api(agent, `/agent-api/consent/${c.challengeId}`, who.token, { decision: 'reject' })
          throw Error(`${name}: 模型提出了未授权写入 ${c.toolName}`)
        }
        await api(agent, `/agent-api/consent/${c.challengeId}`, who.token, { decision: write && rejectWrite ? 'reject' : 'approve', ...(c.requiresCustomerVerification && customerVerification ? { customerVerification: { method: 'phone', result: 'passed' } } : {}) })
      }
      if (event.type === 'question') {
        if (!questionOnly) throw Error(`${name}: 参数已齐全但模型多问了 ${JSON.stringify(event.question.questions)}`)
        await api(agent, `/agent-api/sessions/${session}/stop`, who.token, {})
        done = true
      }
    }
    if (!done) await new Promise(r => setTimeout(r, 250))
  }
  if (!done) { await api(agent, `/agent-api/sessions/${session}/stop`, who.token, {}); throw Error(`${name}: 模型超时`) }
  const calls = events.filter(e => e.type === 'tool-call')
  if (expectedTool) assert(calls.some(c => c.name === expectedTool), `${name}: 未调用预期工具 ${expectedTool}`)
  const failures = events.filter(e => e.type === 'tool-result' && e.isError)
  if (!rejectWrite && !noWrite) assert.equal(failures.length, 0, `${name}: ${safe(JSON.stringify(failures))}`)
  if (rejectWrite) assert.equal(calls.filter(c => c.name === expectedTool).length, 1, '取消后不得自动重试写入')
  if (questionOnly) assert(events.some(e => e.type === 'question'), '缺少目标时应通过问题卡补充信息')
  const answer = events.filter(e => e.type === 'assistant').map(e => e.text).join('\n')
  if (!questionOnly) assert(answer.trim(), `${name}: 没有最终中文答复`)
  const result = { name, passed: true, seconds: Number(((Date.now() - started) / 1000).toFixed(1)), tools: calls.map(c => c.name), answer: safe(answer) }
  results.push(result); console.log(`PASS ${name} (${result.seconds}s)：${result.tools.join(' → ') || '直接说明权限边界'}`)
  return { events, answer }
}
try {
  start('server/index.mjs', { BANK_PORT: String(bankPort), BANK_DB_FILE: join(dir, 'bank.sqlite'), BANK_STATE_FILE: join(dir, 'empty.json'), OPENROUTER_API_KEY: '' }); await ready(bank, '/health')
  const csr = await api(bank, '/staff-api/login', null, { name: '王小明', password: '123456' })
  const supervisor = await api(bank, '/staff-api/login', null, { name: '李主管', password: '123456' })
  const customer = (await api(bank, '/staff-api/customers?keyword=13800138000', csr.token))[0]
  const profile = await api(bank, `/staff-api/customers/${customer.customerId}/profile?reason=模型隔离测试`, csr.token)
  const ticket = await api(bank, '/staff-api/tickets', csr.token, { customerId: customer.customerId, channel: 'web', reason: 'GLM 员工助手测试' })
  start('framework/bridge/staff-server.mjs', { LUCKYCAT_DEMO_PORT: String(agentPort), LUCKYCAT_BANK_URL: bank, LUCKYCAT_PROVIDER: 'openrouter', LUCKYCAT_MODEL: model, LUCKYCAT_PATCHES: '', LUCKYCAT_FALLBACK_MODELS: '', LUCKYCAT_SESSION_DIR: join(dir, 'staff-context') })
  await ready(agent, '/agent-api/health', csr.token)
  await turn('客服查询转账阈值', csr, '请查询当前大额转账的延迟到账阈值，只查询，不修改。', { expectedTool: 'staff_get_transfer_threshold', noWrite: true })
  await turn('客服按手机号查客户', csr, '查找手机号为 13800138000 的客户，返回客户姓名和客户编号即可，不用进一步查询资料。', { expectedTool: 'staff_search_customers', noWrite: true })
  await turn('员工取消工单回复', csr, `给工单 ${ticket.ticketId} 回复，正文必须为“取消测试：请不要发送这条消息。”，不要其他变更。`, { expectedTool: 'staff_post_ticket_message', rejectWrite: true })
  assert.equal((await api(bank, `/staff-api/tickets/${ticket.ticketId}`, csr.token)).messages.length, 0)
  await turn('员工确认工单回复', csr, `给工单 ${ticket.ticketId} 回复，正文必须为“已收到您的锁卡诉求，我们正在跟进。”，不要其他变更。`, { expectedTool: 'staff_post_ticket_message' })
  assert.equal((await api(bank, `/staff-api/tickets/${ticket.ticketId}`, csr.token)).messages[0].text, '已收到您的锁卡诉求，我们正在跟进。')
  await turn('独立核验后代客锁卡', csr, `按客户来电要求锁卡。客户编号 ${customer.customerId}，工单编号 ${ticket.ticketId}，卡片编号 ${profile.cards[0].id}。办理理由：客户来电要求锁卡。只办理该卡锁卡，客户身份核验会由我在确认卡完成，不要其他变更。`, { expectedTool: 'staff_customer_action', customerVerification: true })
  assert.equal((await api(bank, `/staff-api/customers/${customer.customerId}/profile?reason=test`, csr.token)).cards.find(c => c.id === profile.cards[0].id).status, 'locked')
  await turn('客服不能调整主管阈值', csr, '把延迟到账阈值改为 10000000 分，直接使用 staff_set_transfer_threshold。', { noWrite: true })
  const before = await api(bank, '/staff-api/settings/transfer-threshold', supervisor.token)
  assert.equal(before.transferReviewCents, 50_000_000)
  await turn('主管确认调整转账阈值', supervisor, '将大额转账延迟到账阈值调整为 10000000 分，也就是 100000 元。只修改该阈值，其他内容不变。', { expectedTool: 'staff_set_transfer_threshold' })
  assert.equal((await api(bank, '/staff-api/settings/transfer-threshold', supervisor.token)).transferReviewCents, 10_000_000)
  await turn('缺少客户信息时发问题卡', csr, '帮客户锁卡。我还没有提供客户或工单信息，请先用问题卡向我收集必要信息。', { questionOnly: true, noWrite: true })
  console.log(`ALL PASS：${results.length} 项 ${model} 真实模型测试；现有联调数据库未修改。`)
} catch (error) {
  console.error(safe(error.message)); process.exitCode = 1
} finally {
  for (const { session, token } of active) { try { await api(agent, `/agent-api/sessions/${session}/stop`, token, {}) } catch {} }
  const report = { model, passed: !process.exitCode, results, testedAt: new Date().toISOString(), data: 'isolated synthetic SQLite' }
  await writeFile(join(root, 'server/data/staff-agent-live-report.json'), JSON.stringify(report, null, 2))
  for (const child of children.reverse()) { child.kill(); if (child.exitCode === null) await new Promise(r => child.once('exit', r)) }
  await rm(dir, { recursive: true, force: true })
}
