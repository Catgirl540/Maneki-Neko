/** Customer-scoped workbench tasks, delivered by the existing bank IM controller. */
import { createRequire } from 'node:module'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { mkdir, readdir, lstat, chmod } from 'node:fs/promises'
import { bankError } from './bank-error.mjs'

const hash = value => createHash('sha256').update(value).digest('hex')
const ownerKey = owner => {
  if (typeof owner !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(owner)) throw bankError('客户身份无效', 403)
  return hash(owner)
}
export const beijingReminderTime = value => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'short', hour12: false }).format(new Date(value))
export function validateReminder(input, now = Date.now()) {
  const title = typeof input.title === 'string' ? input.title.trim() : ''
  if (!title || title.length > 160 || /[\x00-\x1f\x7f]/.test(title)) throw bankError('提醒内容须为 1–160 字的单行文字')
  const dueText = typeof input.dueAt === 'string' ? input.dueAt.replace(/\.000(Z|[+-]\d{2}:\d{2})$/, '$1') : ''
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})$/.exec(dueText)
  if (!match) throw bankError('请提供带时区的具体提醒时间，例如 2026-10-21T15:00:00+08:00')
  const [, year, month, day, hour, minute, second = '00', zone] = match
  const local = `${year}-${month}-${day}T${hour}:${minute}:${second}`
  const offset = zone === 'Z' ? 0 : (zone[0] === '-' ? -1 : 1) * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(4)))
  const milliseconds = Date.parse(local + zone)
  if (Math.abs(offset) > 840 || (zone !== 'Z' && Number(zone.slice(4)) > 59) || !Number.isFinite(milliseconds)
    || new Date(milliseconds + offset * 60000).toISOString().slice(0, 19) !== local) throw bankError('提醒日期或时区不合法')
  if (milliseconds < now + 15000 || milliseconds > now + 365 * 86400000) throw bankError('提醒时间须在 15 秒后至未来 365 天内')
  return { title, dueAt: new Date(milliseconds).toISOString() }
}
const routeVersion = route => hash(JSON.stringify([route.id, route.ownerId, route.channel, route.botId, route.key, route.bindingRevision]))
const publicRecord = row => ({ id: row.id, title: row.title, dueAt: row.due_at, timeZone: 'Asia/Shanghai', status: row.status, createdAt: row.created_at, sentAt: row.sent_at, attempts: row.attempts, errorCode: row.error_code })

export async function createBankReminders({ directory, routes, deliver, ready = () => true, clock = Date.now, intervalMs = 15000 }) {
  const require = createRequire(import.meta.url)
  const manifest = require.resolve('@dely0/dsh-personal-workbench/package.json')
  if (require(manifest).version !== '1.17.0') throw Error('Bank reminders require workbench 1.17.0')
  const root = dirname(manifest)
  const load = name => import(pathToFileURL(join(root, 'lib', name)).href)
  const [{ openWorkbenchDb }, { seedDictionaries }, repo] = await Promise.all([load('db/database.js'), load('db/seed.js'), load('db/repo.js')])
  await mkdir(directory, { recursive: true, mode: 0o700 })
  await chmod(directory, 0o700)
  const initialized = new Set()
  const deliveries = new Map()
  let closed = false, timer, scanning
  function withDb(owner, operation) {
    const key = ownerKey(owner), file = join(directory, key, 'workbench.db')
    const db = openWorkbenchDb({ dbPath: file })
    try {
      db.exec(`PRAGMA busy_timeout=5000;
        CREATE TABLE IF NOT EXISTS bank_context(owner_id TEXT PRIMARY KEY);
        CREATE TABLE IF NOT EXISTS bank_reminders(
          id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, fingerprint TEXT NOT NULL,
          task_id TEXT NOT NULL UNIQUE, reminder_id TEXT NOT NULL UNIQUE,
          route_id TEXT NOT NULL, route_version TEXT NOT NULL, title TEXT NOT NULL, due_at TEXT NOT NULL,
          status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_attempt INTEGER NOT NULL DEFAULT 0,
          error_code TEXT, created_at TEXT NOT NULL, sent_at TEXT);
        CREATE INDEX IF NOT EXISTS bank_reminders_due ON bank_reminders(status,due_at);`)
      const context = db.prepare('SELECT owner_id FROM bank_context').get()
      if (context && context.owner_id !== owner) throw Error('Workbench owner mismatch; preserve original database')
      if (!context) db.prepare('INSERT INTO bank_context(owner_id) VALUES(?)').run(owner)
      if (!initialized.has(key)) {
        // A crash after sending but before acknowledgement cannot safely be retried.
        db.prepare("UPDATE bank_reminders SET status='unknown',error_code='DELIVERY_UNCONFIRMED' WHERE status='sending'").run()
        initialized.add(key)
      }
      seedDictionaries(db)
      return operation(db)
    } finally { db.close() }
  }
  function getRoute(owner, id) {
    const route = routes()[id]
    if (!route || route.ownerId !== owner || route.channel !== 'weixin' || !route.bindingRevision) throw bankError('请先重新绑定本人的微信私聊，再设置提醒', 409)
    return route
  }
  function bindings(owner) {
    ownerKey(owner)
    return Object.values(routes()).filter(r => r.ownerId === owner && r.channel === 'weixin' && r.bindingRevision).map(r => ({ id: r.id, label: '微信私聊 · ' + r.key.slice(-4), sessionId: r.sessionId }))
  }
  function list(owner) {
    const records = withDb(owner, db => db.prepare('SELECT * FROM bank_reminders ORDER BY created_at DESC LIMIT 100').all().map(publicRecord))
    return { enabled: true, engine: 'dsh-personal-workbench', timeZone: 'Asia/Shanghai', bindings: bindings(owner).map(({ sessionId, ...r }) => r), reminders: records, limit: 100, historyMayBeTruncated: records.length === 100 }
  }
  function prepare(owner, operation, input = {}, sessionId) {
    ownerKey(owner)
    if (closed) throw bankError('提醒服务正在停止', 503)
    if (operation === 'list') return { operation }
    if (operation === 'create') {
      const clean = validateReminder(input, clock())
      const available = bindings(owner)
      const candidate = input.bindingId ? available.find(r => r.id === input.bindingId) : available.find(r => r.sessionId === sessionId) ?? (available.length === 1 ? available[0] : undefined)
      if (!candidate) throw bankError('请先查询本人提醒连接，并明确选择接收微信私聊', 409)
      const route = getRoute(owner, candidate.id)
      return { operation, ...clean, routeId: route.id, routeVersion: routeVersion(route), label: candidate.label }
    }
    if (operation === 'cancel') {
      const row = withDb(owner, db => db.prepare('SELECT * FROM bank_reminders WHERE id=?').get(input.reminderId))
      if (!row) throw bankError('提醒不存在或不属于当前客户', 404)
      if (row.status !== 'scheduled') throw bankError('提醒已进入投递或终态，不能撤回；投递未确认的消息不会自动重发', 409)
      return { operation, id: row.id, title: row.title, dueAt: row.due_at }
    }
    throw bankError('不支持的提醒操作')
  }
  function execute(owner, prepared, requestId) {
    ownerKey(owner)
    if (closed) throw bankError('提醒服务正在停止', 503)
    if (prepared.operation === 'list') return list(owner)
    if (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(requestId)) throw bankError('缺少有效的提醒请求编号')
    return withDb(owner, db => {
      if (prepared.operation === 'cancel') {
        db.exec('BEGIN IMMEDIATE')
        try {
          const changed = db.prepare("UPDATE bank_reminders SET status='cancelled' WHERE id=? AND status='scheduled'").run(prepared.id)
          if (!changed.changes) throw bankError('提醒状态已变化，请重新查询', 409)
          const row = db.prepare('SELECT * FROM bank_reminders WHERE id=?').get(prepared.id)
          repo.acknowledgeReminder(db, row.reminder_id)
          db.exec('COMMIT')
          return publicRecord(row)
        } catch (error) { db.exec('ROLLBACK'); throw error }
      }
      const fingerprint = hash(JSON.stringify(prepared))
      const previous = db.prepare('SELECT * FROM bank_reminders WHERE request_id=?').get(requestId)
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw bankError('请求编号已用于不同提醒', 409)
        return publicRecord(previous)
      }
      const route = getRoute(owner, prepared.routeId)
      if (routeVersion(route) !== prepared.routeVersion) throw bankError('微信连接已变化，请重新确认', 409)
      validateReminder(prepared, clock())
      if (db.prepare("SELECT COUNT(*) AS n FROM bank_reminders WHERE status='scheduled'").get().n >= 100 || db.prepare('SELECT COUNT(*) AS n FROM bank_reminders').get().n >= 1000) throw bankError('提醒数量已达上限', 429)
      db.exec('BEGIN IMMEDIATE')
      try {
        const task = repo.createTask(db, { title: prepared.title, typeCode: 'personal', priorityCode: 'p1', dueAt: prepared.dueAt })
        const reminderId = repo.addReminder(db, task.id, 0, 'browser')
        const id = 'rem-' + randomUUID()
        db.prepare("INSERT INTO bank_reminders(id,request_id,fingerprint,task_id,reminder_id,route_id,route_version,title,due_at,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,'scheduled',?)")
          .run(id, requestId, fingerprint, task.id, reminderId, route.id, prepared.routeVersion, prepared.title, prepared.dueAt, new Date(clock()).toISOString())
        db.exec('COMMIT')
        return publicRecord(db.prepare('SELECT * FROM bank_reminders WHERE id=?').get(id))
      } catch (error) { db.exec('ROLLBACK'); throw error }
    })
  }
  async function scan() {
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      if (closed) break
      try { await scanOwner(entry) }
      catch { console.error('[bank-reminders] customer task store unavailable; preserved for inspection') }
    }
  }
  async function scanOwner(entry) {
      if (!entry.isDirectory() || !/^[a-f0-9]{64}$/.test(entry.name)) return
      const file = join(directory, entry.name, 'workbench.db')
      if (!(await lstat(file)).isFile()) return
      const probe = openWorkbenchDb({ dbPath: file })
      let owner
      try { owner = probe.prepare('SELECT owner_id FROM bank_context').get()?.owner_id } finally { probe.close() }
      if (!owner || ownerKey(owner) !== entry.name) throw Error('Workbench owner directory mismatch')
      const due = withDb(owner, db => {
        const ids = new Set(repo.listDueReminders(db, new Date(clock())).map(r => r.reminderId))
        return db.prepare("SELECT * FROM bank_reminders WHERE status='scheduled' AND next_attempt<=? ORDER BY due_at LIMIT 20").all(clock()).filter(r => ids.has(r.reminder_id))
      })
      for (const row of due) {
        if (closed) break
        const route = routes()[row.route_id]
        if (!route || route.ownerId !== owner || routeVersion(route) !== row.route_version) {
          withDb(owner, db => db.prepare("UPDATE bank_reminders SET status='suppressed',error_code='BINDING_CHANGED' WHERE id=? AND status='scheduled'").run(row.id))
          continue
        }
        if (clock() - Date.parse(row.due_at) > 86400000) {
          withDb(owner, db => db.prepare("UPDATE bank_reminders SET status='expired',error_code='OVERDUE_24H' WHERE id=? AND status='scheduled'").run(row.id))
          continue
        }
        if (!ready(route)) {
          withDb(owner, db => db.prepare("UPDATE bank_reminders SET attempts=attempts+1,next_attempt=?,status=CASE WHEN attempts>=19 THEN 'failed' ELSE 'scheduled' END,error_code='BOT_OFFLINE' WHERE id=? AND status='scheduled'").run(clock() + 30000, row.id))
          continue
        }
        const claimed = withDb(owner, db => db.prepare("UPDATE bank_reminders SET status='sending',attempts=attempts+1 WHERE id=? AND status='scheduled'").run(row.id).changes)
        if (!claimed) continue
        const controller = new AbortController()
        deliveries.set(row.id, { routeId: route.id, controller })
        try {
          await deliver(route, `【银行日程提醒】${row.title}\n约定时间：${beijingReminderTime(row.due_at)}（北京时间）\n此消息仅为您设置的提醒，未查询账户或执行交易。`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) })
          withDb(owner, db => {
            db.exec('BEGIN IMMEDIATE')
            try {
              db.prepare("UPDATE bank_reminders SET status='sent',sent_at=?,error_code=NULL WHERE id=? AND status='sending'").run(new Date(clock()).toISOString(), row.id)
              repo.fireReminder(db, row.reminder_id)
              db.exec('COMMIT')
            } catch (error) { db.exec('ROLLBACK'); throw error }
          })
        } catch {
          withDb(owner, db => db.prepare("UPDATE bank_reminders SET status='unknown',error_code='DELIVERY_UNCONFIRMED' WHERE id=? AND status='sending'").run(row.id))
        } finally { deliveries.delete(row.id) }
      }
  }
  function tick() {
    if (closed) return Promise.resolve()
    if (!scanning) scanning = scan().finally(() => { scanning = undefined })
    return scanning
  }
  return {
    list, prepare, execute, tick,
    invalidateRoute(id) { for (const item of deliveries.values()) if (item.routeId === id) item.controller.abort() },
    start() { if (timer || closed) return; timer = setInterval(() => { void tick().catch(() => console.error('[bank-reminders] scan failed; reminders preserved')) }, intervalMs); timer.unref?.(); void tick().catch(() => console.error('[bank-reminders] startup scan failed; reminders preserved')) },
    async close() { closed = true; clearInterval(timer); for (const item of deliveries.values()) item.controller.abort(); await scanning },
  }
}
