import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createOpsGate } from './ops-gate.mjs'
test('运维原生工具身份、绑定、状态和完整执行审计', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ops-gate-')), workspace = join(dir, 'workspace')
  await mkdir(workspace); await writeFile(join(workspace, 'readme.txt'), 'example')
  const entry = { ownerId: 'staff_ops', staff: { id: 'staff_ops', name: '运维人员', role: 'ops' }, busy: true, stopping: false, activity: { cancelled: false }, intent: '排查本地日志和配置' }
  let calls = 0, action = 'allow', counter = 0
  const bankAgent = { current: async id => { if (id !== 'ops') throw Error('not owned'); return entry } }
  const gate = createOpsGate({ bankAgent, sessions: new Map(), workspaceRoot: workspace, auditPath: join(dir, 'audit.jsonl'), review: async () => { calls++; return { action, source: 'clef', category: action === 'allow' ? 'read_only' : 'high_risk' } } })
  const input = (toolName = 'read', args = { path: 'readme.txt' }) => ({ sessionId: 'ops', callId: String(++counter), toolName, arguments: args })
  try {
    await t.test('只读自动授权一次；参数替换、重复消费被拒绝', async () => {
      const i = input(), c = await gate.prepare(i); assert.equal(c.risk.action, 'allow')
      await assert.rejects(gate.consume({ ...i, arguments: { path: 'other.txt' } }))
      assert.equal((await gate.consume(i)).allowed, true); await assert.rejects(gate.consume(i)); await gate.result({ ...i, isError: false })
    })
    await t.test('高危必须确认，拒绝与停止均不能执行', async () => {
      action = 'review'
      const i = input('write', { path: 'config.txt', content: 'safe' }), c = await gate.prepare(i)
      await assert.rejects(gate.consume(i)); await gate.approve(c); await gate.consume(i); await gate.result({ ...i, isError: false })
      const cancelled = input(), cancelCard = await gate.prepare(cancelled); gate.forget(cancelCard); await assert.rejects(gate.consume(cancelled))
      const stopped = input(), card = await gate.prepare(stopped); await gate.approve(card); entry.activity.cancelled = true; await assert.rejects(gate.consume(stopped)); entry.activity = { cancelled: false }; gate.forgetSession('ops')
    })
    await t.test('客服/主管、外部路径、密钥和控制数据不能使用原生工具', async () => {
      for (const role of ['csr', 'supervisor']) { entry.staff.role = role; await assert.rejects(gate.prepare(input())) }
      entry.staff.role = 'ops'; const before = calls
      for (const i of [input('read', { path: '../audit.jsonl' }), input('read', { path: '.env' }), input('read', { path: 'bank.sqlite' }), input('pwsh', { command: '$env:OPENROUTER_API_KEY' }), input('pwsh', { command: 'Get-ChildItem Env:' }), input('pwsh', { command: 'Get-Content .dsh-home/session.json' }), input('pwsh', { command: 'Copy-Item bank.sqlite copied.sqlite' }), input('pwsh', { command: 'Get-Date', sandbox_permissions: 'danger-full-access' })]) assert.equal((await gate.prepare(i)).risk.action, 'deny')
      assert.equal(calls, before)
    })
    await t.test('确认后文件父目录被换成外部链接时不能写入', async () => {
      action = 'review'; const target = join(workspace, 'nested'), outside = join(dir, 'outside'); await mkdir(target); await mkdir(outside)
      const i = input('write', { path: 'nested/file.txt', content: 'data' }), c = await gate.prepare(i); await gate.approve(c)
      await rm(target, { recursive: true }); await symlink(outside, target, process.platform === 'win32' ? 'junction' : 'dir')
      await assert.rejects(gate.consume(i)); assert.equal(await readFile(join(outside, 'file.txt')).then(() => true, () => false), false)
    })
    await t.test('日志包含真实员工、评估、一次授权和执行结果，不含原始文件内容', async () => {
      const audit = (await readFile(join(dir, 'audit.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
      assert(audit.every(a => a.employeeId === 'staff_ops')); assert(audit.some(a => a.phase === 'human-approved')); assert(audit.some(a => a.phase === 'dispatch')); assert(audit.some(a => a.phase === 'finished'))
      assert(!audit.some(a => a.arguments || a.command || a.content))
    })
  } finally { gate.close(); await rm(dir, { recursive: true, force: true }) }
})
