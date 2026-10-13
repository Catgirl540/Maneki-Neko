import { randomBytes, randomUUID, createHash } from 'node:crypto'

/** Tokens stay in memory. Audit and device history survive restarts. */
export function createCustomerAuth(db, { lifetimeMs = 12 * 60 * 60 * 1000, now = Date.now } = {}) {
  db.exec(`CREATE TABLE IF NOT EXISTS customer_sessions (
    id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, phone TEXT NOT NULL,
    device TEXT NOT NULL, created_at TEXT NOT NULL, expires_at INTEGER NOT NULL, ended_at TEXT);
    CREATE TABLE IF NOT EXISTS customer_auth_audit (
    id TEXT PRIMARY KEY, owner_id TEXT, action TEXT NOT NULL, created_at TEXT NOT NULL, level TEXT NOT NULL);`)
  const sessions = new Map()
  const stamp = () => new Date(now()).toISOString()
  const audit = (owner, action, level = 'info') => db.prepare('INSERT INTO customer_auth_audit VALUES (?, ?, ?, ?, ?)').run(randomUUID(), owner, action, stamp(), level)
  // Restart invalidates memory tokens; mark the same sessions inactive in history.
  for (const row of db.prepare('SELECT id, owner_id FROM customer_sessions WHERE ended_at IS NULL').all()) {
    db.prepare('UPDATE customer_sessions SET ended_at = ? WHERE id = ?').run(stamp(), row.id)
    audit(row.owner_id, '服务重启，会话失效')
  }
  const key = req => /^Bearer ([A-Za-z0-9_-]+)$/.exec(req.headers.authorization ?? '')?.[1]
  function end(token, action) {
    const entry = sessions.get(token)
    if (!entry) return
    db.prepare('UPDATE customer_sessions SET ended_at = ? WHERE id = ?').run(stamp(), entry.id)
    audit(entry.ownerId, action)
    sessions.delete(token)
  }
  function expire() { for (const [token, entry] of sessions) if (entry.expiresAt <= now()) end(token, '会话过期') }
  function current(req) { expire(); return sessions.get(key(req)) }
  return {
    resolve(req, route) {
      if (route === 'login' || route === 'register') return null
      const entry = current(req)
      if (route === 'smsCode' || route === 'verifyIdentity') return entry?.phone ?? null
      if (!entry) throw Object.assign(new Error('请重新登录'), { status: 401, code: 'UNAUTHORIZED' })
      return entry.phone
    },
    issue(user, req) {
      const token = randomBytes(32).toString('base64url')
      const id = createHash('sha256').update(token).digest('hex')
      const entry = { id, ownerId: user.id, phone: user.phone, expiresAt: now() + lifetimeMs }
      // Classify, never persist arbitrary headers that could contain secrets.
      const ua = req?.headers['user-agent'] ?? ''
      const device = /Android/i.test(ua) ? 'Android 浏览器' : /iPhone|iPad/i.test(ua) ? 'iOS 浏览器' : /Firefox/i.test(ua) ? 'Firefox' : /Edg/i.test(ua) ? 'Edge' : /Chrome/i.test(ua) ? 'Chrome' : '未知设备'
      db.prepare('INSERT INTO customer_sessions VALUES (?, ?, ?, ?, ?, ?, NULL)').run(id, user.id, user.phone, device, stamp(), entry.expiresAt)
      audit(user.id, '登录成功')
      sessions.set(token, entry)
      return token
    },
    logout(req) { end(key(req), '退出登录') },
    failure(user) { audit(user?.id ?? null, '登录失败', 'warn') },
    phoneChanged(previous, next) {
      for (const entry of sessions.values()) if (entry.phone === previous) {
        entry.phone = next
        db.prepare('UPDATE customer_sessions SET phone = ? WHERE id = ?').run(next, entry.id)
      }
    },
    security(req, overview) {
      const entry = current(req)
      const devices = db.prepare('SELECT * FROM customer_sessions WHERE owner_id = ? ORDER BY created_at DESC').all(entry.ownerId).map(row => ({
        id: row.id, name: row.device, location: '未知', lastActiveAt: row.created_at,
        active: row.ended_at === null && row.expires_at > now(), current: row.id === entry.id && row.ended_at === null,
      }))
      const logs = db.prepare('SELECT * FROM customer_auth_audit WHERE owner_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 200').all(entry.ownerId).map(row => ({ id: row.id, action: row.action, detail: '银行会话审计 · 位置未知', createdAt: row.created_at, level: row.level }))
      return { ...overview, devices, logs, sessionAuditSupported: true }
    },
  }
}
