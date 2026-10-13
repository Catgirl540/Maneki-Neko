import { createHash, randomUUID } from 'node:crypto'
import { appendFile, mkdir, realpath } from 'node:fs/promises'
import { dirname, resolve, relative, isAbsolute } from 'node:path'
import { bankError } from './bank-error.mjs'
import { OPS_NATIVE_TOOLS } from '../packages/ops-native/src/names.mjs'
const stable = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v)
const digest = value => createHash('sha256').update(stable(value)).digest('hex')
const key = c => `${c.sessionId}\0${c.callId}`
const protectedPath = /(?:^|[\\/\s"'])(?:\.dsh-home|\.git|\.codex|\.aws|\.ssh)(?:[\\/\s"']|$)|(?:^|[\\/\s"'])\.env(?:\.|[\\/\s"']|$)|(?:bank|sessions)\.sqlite(?:-wal|-shm)?(?:[\\/\s"']|$)/i
const forbiddenText = /sk-or-v1-[\w-]+|Bearer\s+[\w-]+|\$(?:env:)?(?:OPENROUTER_API_KEY|CLEF_FLASH_API_KEY|LUCKYCAT_INTERNAL_TOKEN)|\/proc\/\d+\/environ|Get-ChildItem\s+(?:-Path\s+)?Env:|Get-Content[^\n]*(?:\.env|\.ssh)|(?:update|delete\s+from)\s+(?:accounts|staff_users|audit_logs)|LUCKYCAT_CONTROL_SOCKET/i
export function createOpsGate({ bankAgent, sessions, review, workspaceRoot, auditPath }) {
  const grants = new Map(), receipts = new Map()
  let root
  async function current(sessionId) {
    const entry = await bankAgent.current(sessionId)
    if (entry.staff.role !== 'ops') throw bankError('原生 DSH 工具仅限运维人员', 403)
    if (!entry.busy || entry.stopping || entry.activity?.cancelled) throw bankError('运维运行已停止或不存在', 409)
    return entry
  }
  async function audit(entry, input, phase, extra = {}) {
    await mkdir(dirname(auditPath), { recursive: true })
    await appendFile(auditPath, JSON.stringify({ at: new Date().toISOString(), employeeId: entry.ownerId, sessionId: input.sessionId, callId: input.callId, tool: input.toolName, phase, ...extra }) + '\n', { mode: 0o600 })
  }
  async function checkPath(value) {
    if (typeof value !== 'string') return
    const path = resolve(root, value)
    let canonical
    try { canonical = await realpath(path) } catch (e) {
      if (e.code !== 'ENOENT') throw e
      // Walk all existing ancestors; never treat a non-existing path beneath a symlink as trusted.
      let parent = dirname(path)
      while (true) { try { canonical = resolve(await realpath(parent), relative(parent, path)); break } catch (error) { if (error.code !== 'ENOENT' || dirname(parent) === parent) throw error; parent = dirname(parent) } }
    }
    const rel = relative(root, canonical)
    if (rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(rel) || protectedPath.test(canonical)) throw bankError('路径超出运维工作区或指向受保护的凭据、会话或数据库', 403)
  }
  async function prepare(input) {
    root ??= await realpath(workspaceRoot)
    const entry = await current(input.sessionId), activity = entry.activity
    if (!OPS_NATIVE_TOOLS.includes(input.toolName) || !input.callId || !input.arguments || typeof input.arguments !== 'object' || Array.isArray(input.arguments)) throw bankError('原生工具请求无效', 400)
    const serialized = stable(input.arguments)
    let denied = forbiddenText.test(serialized) || protectedPath.test(serialized) || input.arguments.sandbox_permissions !== undefined
    if (['read', 'read_image', 'write', 'edit', 'glob', 'grep'].includes(input.toolName)) {
      for (const name of ['path', 'file_path', 'filePath', 'cwd', 'workdir']) if (input.arguments[name]) { try { await checkPath(input.arguments[name]) } catch { denied = true } }
    }
    if (input.arguments.workdir) { try { await checkPath(input.arguments.workdir) } catch { denied = true } }
    let risk = denied ? { action: 'deny', source: 'policy', category: 'protected_resource', reason: '凭据、受保护路径和扩大沙箱权限不能通过运维工具访问' } : await review({ operation: { tool: input.toolName, arguments: input.arguments }, employeeTask: entry.intent ?? '', workspace: root, role: 'ops' })
    if (input.forceReview && risk.action === 'allow') risk = { ...risk, action: 'review', reason: '原生工具另有审批要求' }
    await current(input.sessionId)
    if (activity !== entry.activity) throw bankError('运行轮次已变化', 409)
    await audit(entry, input, 'reviewed', { fingerprint: digest(input.arguments), risk })
    if (risk.action === 'deny') return { risk }
    const challenge = { challengeId: `ops-${randomUUID()}`, sessionId: input.sessionId, callId: input.callId, toolName: input.toolName,
      kind: '运维操作确认', createdAt: Date.now(), expiresAt: Date.now() + 180_000, risk,
      fields: [{ label: '操作员工', value: `${entry.staff.name} · 运维人员` }, { label: '原生工具', value: input.toolName }, { label: '工作区', value: root }, { label: '完整操作参数', value: serialized, emphasis: true }, { label: '风险判断', value: risk.reason ?? `${({ read_only: '只读操作', routine_change: '普通变更', high_risk: '高危操作', prohibited: '禁止操作' })[risk.category] ?? risk.category}；需要您确认本次完整操作` }, ...(risk.probabilities ? [{ label: 'Clef 风险概率', value: Object.entries(risk.probabilities).map(([k, p]) => `${({ read_only: '只读', routine_change: '普通变更', high_risk: '高危', prohibited: '禁止' })[k]} ${(p * 100).toFixed(1)}%`).join(' · ') }] : [])],
      consequence: '确认后仅执行本次操作；涉及删除、覆盖、服务停止等效果时，以所展示的完整参数为准。' }
    const k = key(input)
    if (grants.has(k) || receipts.has(k)) throw bankError('本次调用已经评估或执行', 409)
    const grant = { challenge, ownerId: entry.ownerId, fingerprint: digest(input.arguments), arguments: input.arguments, activity, approved: risk.action === 'allow' }
    grant.timer = setTimeout(() => grants.delete(k), 180_000); grant.timer.unref(); grants.set(k, grant)
    return challenge
  }
  function grantFor(c) {
    const g = grants.get(key(c))
    if (!g || g.challenge.challengeId !== c.challengeId || g.challenge.expiresAt <= Date.now()) throw bankError('运维确认不存在或已过期', 404)
    return g
  }
  async function challenge(c) { await current(c.sessionId); return grantFor(c).challenge }
  async function approve(c) {
    const entry = await current(c.sessionId), g = grantFor(c)
    if (g.approved || g.activity !== entry.activity || g.ownerId !== entry.ownerId) throw bankError('运维授权已处理或运行变化', 409)
    await audit(entry, c, 'human-approved', { fingerprint: g.fingerprint }); await current(c.sessionId)
    if (!grants.has(key(c)) || entry.stopping || entry.activity !== g.activity) throw bankError('运维确认已取消', 409)
    g.approved = true
  }
  function forget(c) { const g = grants.get(key(c)); if (g) clearTimeout(g.timer); grants.delete(key(c)) }
  async function consume(input) {
    const entry = await current(input.sessionId), g = grants.get(key(input))
    if (!g || !g.approved || g.ownerId !== entry.ownerId || g.activity !== entry.activity || g.challenge.toolName !== input.toolName || g.fingerprint !== digest(input.arguments) || g.challenge.expiresAt <= Date.now()) throw bankError('缺少与本次参数匹配的运维授权', 403)
    forget(g.challenge)
    // File targets can be swapped while a human is reading the confirmation card.
    if (['read', 'read_image', 'write', 'edit', 'glob', 'grep'].includes(input.toolName)) for (const name of ['path', 'file_path', 'filePath', 'cwd', 'workdir']) if (input.arguments[name]) await checkPath(input.arguments[name])
    if (input.arguments.workdir) await checkPath(input.arguments.workdir)
    await audit(entry, input, 'dispatch', { fingerprint: g.fingerprint, decision: g.challenge.risk.action })
    await current(input.sessionId)
    if (g.activity !== entry.activity || entry.stopping) throw bankError('本轮已停止，未执行运维工具', 409)
    const timer = setTimeout(() => receipts.delete(key(input)), 600_000); timer.unref()
    receipts.set(key(input), { ownerId: entry.ownerId, toolName: input.toolName, timer })
    return { allowed: true }
  }
  async function result(input) {
    const receipt = receipts.get(key(input)); const entry = await bankAgent.current(input.sessionId)
    if (!receipt || receipt.ownerId !== entry.ownerId || receipt.toolName !== input.toolName) throw bankError('不存在对应运维执行回执', 403)
    receipts.delete(key(input)); clearTimeout(receipt.timer)
    await audit(entry, input, 'finished', { isError: input.isError === true }); return { ok: true }
  }
  function forgetSession(id) { for (const g of grants.values()) if (g.challenge.sessionId === id) forget(g.challenge) }
  function close() { for (const g of grants.values()) clearTimeout(g.timer); for (const r of receipts.values()) clearTimeout(r.timer); grants.clear(); receipts.clear() }
  return { prepare, challenge, approve, forget, forgetSession, consume, result, close }
}
