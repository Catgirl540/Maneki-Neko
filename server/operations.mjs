import { randomUUID } from 'node:crypto'
import { readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'

/** Operational telemetry contains categories and status codes, never request data. */
export function createOperations({ db, root, databaseFile, backupDir = join(root, 'server/data/backups'), probes = [
  { id: 'client', name: '客户端网页', url: process.env.BANK_CLIENT_HEALTH_URL ?? 'http://127.0.0.1:5180/' },
  { id: 'staff', name: '工作人员端网页', url: process.env.BANK_STAFF_HEALTH_URL ?? 'http://127.0.0.1:5180/staff/' },
  { id: 'agent', name: 'AI 服务', url: process.env.BANK_AGENT_HEALTH_URL ?? 'http://127.0.0.1:8788/agent-api/health', json: true },
] }) {
  const startedAt = new Date().toISOString()
  const revision = (() => { try { return execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 2000 }).trim() } catch { return null } })()
  const localChanges = (() => { try { return Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 2000 }).trim()) } catch { return null } })()
  db.exec(`CREATE TABLE IF NOT EXISTS operations_events (
    id TEXT PRIMARY KEY, created_at TEXT NOT NULL, level TEXT NOT NULL,
    service TEXT NOT NULL, kind TEXT NOT NULL, status INTEGER, code TEXT NOT NULL);`)
  function record({ level = 'error', service = 'bank', kind = 'http-error', status = null, code = 'HTTP_ERROR' } = {}) {
    // Only server-owned categories are accepted. No stack traces or payloads are persisted.
    const safeService = ['bank', 'staff', 'settlement'].includes(service) ? service : 'bank'
    const safeKind = ['http-error', 'startup', 'settlement-error'].includes(kind) ? kind : 'http-error'
    const safeCode = ['HTTP_ERROR', 'INTERNAL_ERROR', 'DATABASE_ERROR', 'STARTED', 'SETTLEMENT_FAILED'].includes(code) ? code : 'HTTP_ERROR'
    db.prepare('INSERT INTO operations_events VALUES (?, ?, ?, ?, ?, ?, ?)').run(randomUUID(), new Date().toISOString(), level === 'info' ? 'info' : 'error', safeService, safeKind, Number.isInteger(status) ? status : null, safeCode)
    db.exec('DELETE FROM operations_events WHERE id NOT IN (SELECT id FROM operations_events ORDER BY created_at DESC, rowid DESC LIMIT 1000)')
  }
  record({ level: 'info', kind: 'startup', code: 'STARTED' })
  async function probe(item) {
    const start = Date.now()
    try {
      const response = await fetch(item.url, { signal: AbortSignal.timeout(2000), redirect: 'error' })
      const healthy = response.ok && (!item.json || (await response.json()).ok === true)
      if (!item.json) await response.body?.cancel()
      return { id: item.id, name: item.name, status: healthy ? 'up' : 'down', detail: healthy ? '服务可访问' : `健康检查失败（HTTP ${response.status}）`, latencyMs: Date.now() - start }
    } catch { return { id: item.id, name: item.name, status: 'down', detail: '无法连接或健康检查超时', latencyMs: Date.now() - start } }
  }
  function backups() {
    if (!existsSync(backupDir)) return { status: 'missing', detail: '尚未发现备份文件', items: [] }
    const candidates = readdirSync(backupDir, { withFileTypes: true }).filter(x => x.isFile() && /\.(sqlite|db)$/.test(x.name)).map(x => {
      const file = join(backupDir, x.name), stat = statSync(file)
      return { name: x.name, sizeBytes: stat.size, createdAt: stat.mtime.toISOString(), file }
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 10)
    const items = candidates.map(({ file, ...item }) => {
      let snapshot
      try {
        snapshot = new DatabaseSync(file, { readOnly: true })
        const integrity = snapshot.prepare('PRAGMA quick_check').all().every(row => Object.values(row)[0] === 'ok')
        const bankSchema = snapshot.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name IN ('bank_accounts','bank_transactions','app_storage')").get()
        return { ...item, valid: integrity && bankSchema.n === 3 }
      } catch { return { ...item, valid: false } } finally { snapshot?.close() }
    })
    const latest = items[0]
    const status = !latest ? 'missing' : !latest.valid ? 'invalid' : Date.now() - Date.parse(latest.createdAt) > 86400000 ? 'stale' : 'ready'
    return { status, detail: status === 'ready' ? '最近备份通过 SQLite 结构与完整性检查' : status === 'stale' ? '最近备份已超过 24 小时' : status === 'invalid' ? '最近备份未通过校验' : '尚未发现备份文件', items }
  }
  async function overview() {
    let database
    try {
      db.prepare('SELECT 1').get()
      database = { id: 'database', name: 'SQLite 数据库', status: 'up', detail: '数据库可读取', latencyMs: null }
    } catch { database = { id: 'database', name: 'SQLite 数据库', status: 'down', detail: '数据库读取失败', latencyMs: null } }
    const services = [{ id: 'bank', name: '银行后端', status: 'up', detail: '当前请求已由银行后端响应', latencyMs: null }, database, ...await Promise.all(probes.map(probe))]
    let sizeBytes = null
    try { sizeBytes = statSync(databaseFile).size } catch {}
    let backupStatus
    try { backupStatus = backups() } catch { backupStatus = { status: 'unknown', detail: '无法读取备份状态', items: [] } }
    const telemetrySince = db.prepare('SELECT MIN(created_at) AS since FROM operations_events').get().since ?? startedAt
    return { checkedAt: new Date().toISOString(), startedAt, uptimeSeconds: Math.floor(process.uptime()), services,
      version: { revision, localChanges, node: process.version, environment: process.env.NODE_ENV === 'production' ? 'production' : 'development', telemetrySince },
      database: { sizeBytes }, backups: backupStatus,
      events: db.prepare('SELECT id, created_at AS createdAt, level, service, kind, status, code FROM operations_events ORDER BY created_at DESC, rowid DESC LIMIT 100').all(),
      errors24h: db.prepare("SELECT COUNT(*) AS n FROM operations_events WHERE level = 'error' AND created_at >= ?").get(new Date(Date.now() - 86400000).toISOString()).n }
  }
  return { overview, record }
}
