/** Read-only operations UI/API, role migration and telemetry; isolated SQLite only. */
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { ensureStaffSchema } from '../server/staff-api.mjs'
import { createOperations } from '../server/operations.mjs'
const root = resolve(import.meta.dirname, '..')
const temp = mkdtempSync(join(tmpdir(), 'bank-ops-'))
let child, stub
try {
  const migration = new DatabaseSync(':memory:')
  migration.exec("CREATE TABLE staff_users (id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('csr','supervisor')), password_hash TEXT NOT NULL, created_at TEXT NOT NULL)")
  migration.prepare('INSERT INTO staff_users VALUES (?, ?, ?, ?, ?)').run('old', '原员工', 'csr', 'original-digest', '2025-01-01')
  ensureStaffSchema(migration); ensureStaffSchema(migration)
  assert.equal(migration.prepare("SELECT password_hash FROM staff_users WHERE id='old'").get().password_hash, 'original-digest')
  assert.equal(migration.prepare("SELECT COUNT(*) AS n FROM staff_users WHERE role='ops'").get().n, 1)
  migration.close()
  console.log('PASS 旧员工表角色迁移保留账户与密码摘要，重复启动不重复建运维账号')

  const databaseFile = join(temp, 'telemetry.sqlite')
  const db = new DatabaseSync(databaseFile)
  const backups = join(temp, 'backups')
  stub = createServer((req, res) => { res.writeHead(req.url === '/bad' ? 503 : 200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: req.url !== '/bad' })) })
  await new Promise(r => stub.listen(0, '127.0.0.1', r))
  const stubBase = `http://127.0.0.1:${stub.address().port}`
  const ops = createOperations({ db, databaseFile, root, backupDir: backups, probes: [{ id: 'ok', name: '正常服务', url: stubBase, json: true }, { id: 'bad', name: '失败服务', url: stubBase + '/bad', json: true }] })
  let view = await ops.overview()
  assert.equal(view.services.find(s => s.id === 'ok').status, 'up')
  assert.equal(view.services.find(s => s.id === 'bad').status, 'down')
  assert.equal(view.backups.status, 'missing')
  ops.record({ code: 'secret-sentinel', service: 'private-token', status: 500 })
  view = await ops.overview(); assert.equal(view.errors24h, 1); assert(!JSON.stringify(view).includes('secret-sentinel')); assert(!JSON.stringify(view).includes('private-token'))
  mkdirSync(backups)
  const valid = new DatabaseSync(join(backups, 'valid.sqlite')); valid.exec('CREATE TABLE bank_accounts(id TEXT); CREATE TABLE bank_transactions(id TEXT); CREATE TABLE app_storage(key TEXT)'); valid.close()
  assert.equal((await ops.overview()).backups.status, 'ready')
  const oldTime = new Date(Date.now() - 2 * 86400000); utimesSync(join(backups, 'valid.sqlite'), oldTime, oldTime)
  assert.equal((await ops.overview()).backups.status, 'stale')
  writeFileSync(join(backups, 'broken.sqlite'), 'broken database')
  assert.equal((await ops.overview()).backups.status, 'invalid')
  db.close()
  const reopened = new DatabaseSync(databaseFile)
  const nextOps = createOperations({ db: reopened, root, databaseFile, probes: [], backupDir: backups })
  assert.equal((await nextOps.overview()).errors24h, 1)
  reopened.close(); await new Promise(r => stub.close(r)); stub = null
  console.log('PASS 服务探测、备份缺失/有效/过期/损坏、错误脱敏及重启持久化')

  const portProbe = createServer(); await new Promise(r => portProbe.listen(0, '127.0.0.1', r)); const port = portProbe.address().port; await new Promise(r => portProbe.close(r))
  child = spawn(process.execPath, ['server/index.mjs'], { cwd: root, env: { ...process.env, BANK_PORT: String(port), BANK_DB_FILE: join(temp, 'bank.sqlite'), BANK_STATE_FILE: join(temp, 'absent.json'), BANK_BACKUP_DIR: backups }, stdio: ['ignore','pipe','pipe'] })
  let output = ''; child.stdout.on('data', b => output += b); child.stderr.on('data', b => output += b)
  const base = `http://127.0.0.1:${port}`
  for (let i = 0; i < 100; i++) { if (child.exitCode !== null) throw new Error(output); try { if ((await fetch(base + '/health')).ok) break } catch {} await new Promise(r => setTimeout(r, 100)) }
  async function call(path, token, body, method = body === undefined ? 'GET' : 'POST') {
    const response = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    return { status: response.status, value: await response.json() }
  }
  const login = async name => { const result = await call('/staff-api/login', null, { name, password: '123456' }); assert.equal(result.status, 200); return result.value.token }
  const token = await login('运维人员'), csr = await login('王小明'), supervisor = await login('李主管')
  assert.equal((await call('/staff-api/me', token)).value.role, 'ops')
  assert.equal((await call('/staff-api/ops/overview')).status, 401)
  assert.equal((await call('/staff-api/ops/overview', csr)).status, 403)
  assert.equal((await call('/staff-api/ops/overview', supervisor)).status, 403)
  for (const path of ['/staff-api/customers','/staff-api/tickets','/staff-api/approvals','/staff-api/audit-logs','/staff-api/settings/transfer-threshold']) assert.equal((await call(path, token)).status, 403)
  assert.equal((await call('/staff-api/ops/overview', token, {})).status, 405)
  assert.equal((await call('/staff-api/customers', csr)).status, 200)
  const beforeErrors = (await call('/staff-api/ops/overview', token)).value.errors24h
  await call('/api/auth/login', null, { phone: 13800138000, password: 'ops-private-sentinel', smsCode: 'ops-private-code' })
  const result = await call('/staff-api/ops/overview', token)
  assert.equal(result.status, 200); assert.equal(result.value.errors24h, beforeErrors + 1)
  for (const secret of ['ops-private-sentinel','ops-private-code',token,csr,'bank.sqlite']) assert(!JSON.stringify(result.value).includes(secret))
  await call('/staff-api/logout', token, {}); assert.equal((await call('/staff-api/ops/overview', token)).status, 401)
  console.log('PASS HTTP运维角色独立授权、业务接口拒绝、只读限制、500错误采集脱敏及注销失效')
} finally {
  if (child) { child.kill(); await new Promise(r => child.exitCode !== null ? r() : child.once('exit', r)) }
  if (stub) await new Promise(r => stub.close(r))
  rmSync(temp, { recursive: true, force: true })
}
