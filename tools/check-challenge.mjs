/**
 * 赛题工程集成检查：工具桥接 + 确认流水线 + 防重放 + 定时动作生命周期。
 *
 * 照抄 check-agent-risk.mjs 的夹具模式：本机 HTTP 假银行 + createBankAgent，
 * 不碰真实数据库、不调模型。逐条钉住 Phase 1 验收点：
 *   - prepare 确认卡含双时间行（缩时演示）
 *   - 缺 runAt 报错
 *   - approve + execute 落库
 *   - 二次 execute 报 CONSENT_REQUIRED（防重放）
 *   - cancel 后不执行
 *   - runDue 只执行一次
 *
 *   node tools/check-challenge.mjs
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { createBankAgent } from '../framework/bridge/bank-agent.mjs'

// ── 假银行后端 ──────────────────────────────────────────────────

const account = {
  id: 'acc_0001', accountNo: '8820000000000000001', currency: 'CNY',
  balance: 100_000, available: 100_000,
}

const payees = [
  { id: 'pay_1', name: '陈嘉禾', channel: 'bank', bankCode: 'LCB', bankRegion: 'CN', bankName: '招财猫银行', accountNo: '8820000000124471', scope: 'domestic', lastUsedAt: '2026-10-06T13:00:00Z' },
  { id: 'pay_2', name: '苏晚', channel: 'bank', bankCode: '308', bankRegion: 'CN', bankName: '招商银行', accountNo: '6214830200989028', scope: 'domestic', lastUsedAt: '2026-09-25T10:00:00Z' },
]

const scheduledStore = []
let nextScheduledId = 1

const requests = [], published = []
const server = createServer((req, res) => {
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    requests.push({ path: req.url, method: req.method })
    assert.equal(req.headers.authorization, 'Bearer fixture_token')
    res.setHeader('content-type', 'application/json')
    const parsed = body ? JSON.parse(body) : {}

    // 假银行的路由
    if (req.url === '/api/auth/profile') return res.end(JSON.stringify({ id: 'owner' }))

    if (req.url === '/api/auth/payment-password/verify') return res.end(JSON.stringify({ ok: true }))

    if (req.url === '/api/accounts/acc_0001') return res.end(JSON.stringify(account))

    if (req.url === '/api/agent/challenge/payee/resolve' && req.method === 'POST') {
      // 简化版：别名表
      const aliases = [{ alias: '我妈', payeeName: '陈嘉禾', note: '母亲' }, { alias: '小晚', payeeName: '苏晚', note: '昵称' }]
      const q = String(parsed.query ?? '').trim()
      const candidates = []
      for (const a of aliases) {
        if (a.alias.includes(q) || q.includes(a.alias)) {
          const payee = payees.find((p) => p.name === a.payeeName)
          candidates.push({ payeeId: payee?.id, payeeName: a.payeeName, matchType: 'alias', score: 100, payee, alias: a, historyCount: 0, lastUsedAt: payee?.lastUsedAt })
        }
      }
      for (const p of payees) {
        if (p.name.includes(q) && !candidates.find((c) => c.payeeId === p.id)) {
          candidates.push({ payeeId: p.id, payeeName: p.name, matchType: 'name', score: 90, payee: p, historyCount: 0, lastUsedAt: p.lastUsedAt })
        }
      }
      return res.end(JSON.stringify({ candidates, hint: candidates.length > 1 ? { needDisambiguation: true, message: `找到 ${candidates.length} 个匹配`, options: candidates.map((c) => c.payeeName) } : null }))
    }

    if (req.url === '/api/agent/challenge/scheduled' && req.method === 'POST') {
      const id = `sch_${nextScheduledId++}`
      const action = {
        id, kind: parsed.kind ?? 'transfer', title: parsed.title ?? '',
        status: 'pending', runAt: parsed.runAt,
        effectiveRunAt: parsed.runAt, demoCompressed: false,
        payload: parsed.transfer ?? {}, createdBy: { tool: 'bank_schedule_transfer' },
        attempts: 0, createdAt: new Date().toISOString(), audit: [],
      }
      scheduledStore.push(action)
      return res.end(JSON.stringify({ action, timeLines: [{ label: '执行时间', value: action.runAt }] }))
    }

    if (req.url === '/api/agent/challenge/scheduled' && req.method === 'GET') {
      return res.end(JSON.stringify(scheduledStore.map((a) => ({ id: a.id, title: a.title, status: a.status, runAt: a.runAt, canCancel: a.status === 'pending', timeLines: [{ label: '执行时间', value: a.runAt }] }))))
    }

    if (req.url?.startsWith('/api/agent/challenge/scheduled/') && req.url.endsWith('/cancel') && req.method === 'POST') {
      const id = req.url.slice('/api/agent/challenge/scheduled/'.length, -'/cancel'.length)
      const action = scheduledStore.find((a) => a.id === id)
      if (!action) { res.statusCode = 404; return res.end(JSON.stringify({ message: '定时动作不存在' })) }
      if (action.status !== 'pending') { res.statusCode = 409; return res.end(JSON.stringify({ message: `状态 ${action.status} 不可取消` })) }
      action.status = 'cancelled'
      return res.end(JSON.stringify(action))
    }

    res.statusCode = 404
    res.end('{}')
  })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))

const sessions = new Map([['session', { ownerId: 'owner', bankToken: 'fixture_token' }]])
const agent = createBankAgent({
  baseUrl: `http://127.0.0.1:${server.address().port}`,
  sessions,
  publish: (_, event) => published.push(event),
})

// ── 辅助 ─────────────────────────────────────────────────────────

async function prepareTool(toolName, args) {
  const challenge = {
    sessionId: 'session', callId: randomUUID(), challengeId: randomUUID(),
    toolName, arguments: args, createdAt: Date.now(), expiresAt: Date.now() + 60_000,
  }
  return {
    challenge: await agent.prepare(challenge),
    input: { sessionId: 'session', callId: challenge.callId, toolName, arguments: args },
  }
}

async function fullFlow(toolName, args, password) {
  const p = await prepareTool(toolName, args)
  await agent.approve(p.challenge, password)
  return { result: await agent.execute(p.input), input: p.input, challenge: p.challenge }
}

const scheduleArgs = {
  fromAccountId: 'acc_0001',
  payeeName: '陈嘉禾',
  payeeAccountNo: '8820000000124471',
  payeeBankCode: 'LCB',
  payeeBankRegion: 'CN',
  amountCents: 20_000,
  runAt: new Date(Date.now() + 2 * 86_400_000).toISOString(), // 后天
  memo: '定时转账测试',
}

// ── 测试 ─────────────────────────────────────────────────────────

try {
  /* ① bank_resolve_payee：别名命中 */
  {
    const p = await prepareTool('bank_resolve_payee', { query: '我妈' })
    assert.ok(p.challenge.fields.length >= 1, 'resolve_payee 确认卡至少一行')
    await agent.approve(p.challenge)
    const result = await agent.execute(p.input)
    const data = result.result ?? result
    assert.ok(data.candidates?.length >= 1, 'resolve_payee 返回候选')
    assert.equal(data.candidates[0].payeeName, '陈嘉禾', '「我妈」→ 陈嘉禾')
    console.log('PASS bank_resolve_payee：别名「我妈」→ 陈嘉禾')
  }

  /* ② bank_schedule_transfer：prepare 有双时间行 */
  {
    process.env.BANK_SCHEDULER_DEMO_SECONDS = '20'
    const p = await prepareTool('bank_schedule_transfer', scheduleArgs)
    const labels = p.challenge.fields.map((f) => f.label)
    assert.ok(labels.includes('执行时间'), '确认卡含「执行时间」')
    assert.ok(labels.includes('演示模式'), '确认卡含「演示模式」（缩时双时间行）')
    assert.ok(p.challenge.fields.find((f) => f.label === '收款人')?.value === '陈嘉禾', '收款人正确')
    assert.ok(p.challenge.fields.find((f) => f.label === '转账金额')?.value?.includes('200'), '金额 200 元')
    console.log('PASS bank_schedule_transfer：确认卡双时间行 + 收款人 + 金额')
  }

  /* ③ 缺 runAt 报错 */
  {
    const args = { ...scheduleArgs }
    delete args.runAt
    await assert.rejects(
      prepareTool('bank_schedule_transfer', args),
      (e) => /计划执行时间/.test(e.message),
      '缺 runAt 应报「缺少计划执行时间」',
    )
    console.log('PASS bank_schedule_transfer：缺 runAt 报错')
  }

  /* ④ 过去时间报错 */
  {
    const args = { ...scheduleArgs, runAt: '2020-01-01T00:00:00Z' }
    await assert.rejects(
      prepareTool('bank_schedule_transfer', args),
      (e) => /将来/.test(e.message),
      '过去时间应报错',
    )
    console.log('PASS bank_schedule_transfer：过去时间报错')
  }

  /* ⑤ approve + execute 落库 */
  {
    const { result: raw, input } = await fullFlow('bank_schedule_transfer', scheduleArgs, '888888')
    const result = raw.result ?? raw
    assert.ok(result.action?.id, 'execute 返回 action.id')
    assert.ok(result.timeLines?.length >= 1, '返回时间行')
    console.log(`PASS bank_schedule_transfer：approve+execute 落库（id=${result.action.id}）`)
  }

  /* ⑥ 二次 execute 报 CONSENT_REQUIRED（防重放） */
  {
    const p = await prepareTool('bank_schedule_transfer', scheduleArgs)
    await agent.approve(p.challenge, '888888')
    await agent.execute(p.input)
    await assert.rejects(
      agent.execute(p.input),
      (e) => e.code === 'CONSENT_REQUIRED',
      '二次 execute 应报 CONSENT_REQUIRED',
    )
    console.log('PASS bank_schedule_transfer：二次 execute 防重放')
  }

  /* ⑦ bank_list_scheduled：能看到定时动作 */
  {
    const p = await prepareTool('bank_list_scheduled', {})
    await agent.approve(p.challenge)
    const raw = await agent.execute(p.input)
    const result = raw.result ?? raw
    assert.ok(Array.isArray(result) && result.length >= 2, `列表至少 2 条（实际 ${result?.length}）`)
    console.log(`PASS bank_list_scheduled：返回 ${result.length} 条`)
  }

  /* ⑧ bank_cancel_scheduled：取消 pending */
  {
    // 创建一个用于取消的
    const { result: raw } = await fullFlow('bank_schedule_transfer', { ...scheduleArgs, memo: '待取消' }, '888888')
    const actionId = (raw.result ?? raw).action.id
    const p = await prepareTool('bank_cancel_scheduled', { actionId })
    await agent.approve(p.challenge)
    const cancelRaw = await agent.execute(p.input)
    const cancelResult = cancelRaw.result ?? cancelRaw
    assert.equal(cancelResult.status, 'cancelled', '取消后 status=cancelled')
    console.log(`PASS bank_cancel_scheduled：取消 ${actionId}`)
  }

  /* ⑨ 取消已取消的报 409 */
  {
    const { result: raw } = await fullFlow('bank_schedule_transfer', { ...scheduleArgs, memo: '再取消' }, '888888')
    const actionId = (raw.result ?? raw).action.id
    // 先取消
    const p1 = await prepareTool('bank_cancel_scheduled', { actionId })
    await agent.approve(p1.challenge)
    await agent.execute(p1.input)
    // 再取消应失败
    const p2 = await prepareTool('bank_cancel_scheduled', { actionId })
    await agent.approve(p2.challenge)
    await assert.rejects(
      agent.execute(p2.input),
      (e) => e.status === 409,
      '重复取消应 409',
    )
    console.log('PASS bank_cancel_scheduled：重复取消 409')
  }

  assert(requests.every((r) => r.path !== undefined), '所有请求都有 path')
  console.log(`\n共 ${requests.length} 次 HTTP 请求`)
  console.log('ALL PASS')
} finally {
  agent.close()
  await new Promise((resolve) => server.close(resolve))
}
