// Offline maintenance only. node:sqlite is used solely to read an existing snapshot.
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { openSessionStore } from './session-store.mjs'

const [option, input, ...extra] = process.argv.slice(2)
const namespace = process.env.LUCKYCAT_SESSION_NAMESPACE
if (option !== '--source' || !input || !isAbsolute(input) || extra.length || process.env.LUCKYCAT_SESSION_MAINTENANCE !== '1' || !['customer','staff','ops'].includes(namespace) || !/^postgres(?:ql)?:\/\//i.test(process.env.LUCKYCAT_SESSION_DATABASE_URL ?? '')) {
  console.error('Usage: LUCKYCAT_SESSION_MAINTENANCE=1 LUCKYCAT_SESSION_NAMESPACE=customer|staff|ops LUCKYCAT_SESSION_DATABASE_URL=<PostgreSQL URL> LUCKYCAT_SESSION_DATA_KEY=<Base64 key> node bridge/migrate-sessions-sqlite-to-postgres.mjs --source /absolute/offline/sessions.sqlite')
  process.exit(2)
}
let source, target
try {
  const path = resolve(input)
  if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw new Error('Source must be a regular offline snapshot')
  if (existsSync(`${path}-wal`) && statSync(`${path}-wal`).size > 0) throw new Error('Source WAL is not empty; use a consistent stopped snapshot')
  const original = readFileSync(path), sha256 = createHash('sha256').update(original).digest('hex')
  source = new DatabaseSync(path, { readOnly: true })
  source.exec('PRAGMA query_only=ON; BEGIN')
  const owners = source.prepare('SELECT * FROM sessions ORDER BY id').all(), orphan = source.prepare('SELECT 1 FROM events e LEFT JOIN sessions s ON s.id=e.session_id WHERE s.id IS NULL LIMIT 1').get()
  if (orphan) throw new Error('Source has events without trustworthy session ownership')
  const entries = owners.map(row => ({
    id: row.id, ownerId: row.owner_id, started: Boolean(row.started), busy: Boolean(row.busy), interrupted: false,
    eventSeq: row.event_seq, legacyContext: row.legacy_context ?? undefined,
    events: source.prepare('SELECT seq,body FROM events WHERE session_id=? ORDER BY seq').all(row.id).map(item => ({ id: String(item.seq), event: JSON.parse(item.body) })),
  }))
  source.exec('COMMIT')
  source.close(); source = undefined
  if (createHash('sha256').update(readFileSync(path)).digest('hex') !== sha256) throw new Error('Source changed while being read')
  target = await openSessionStore(process.env.LUCKYCAT_SESSION_DATABASE_URL, { namespace, requireEmpty: true })
  const result = await target.importLegacy(entries, sha256)
  await target.flush()
  console.log(JSON.stringify({ ok: true, database: 'postgresql', namespace, sourceSha256: sha256, ...result }))
} catch {
  console.error('{"ok":false,"code":"AI_SESSION_IMPORT_REFUSED"}')
  process.exitCode = 1
} finally {
  source?.close()
  if (target) await target.close().catch(() => { process.exitCode = 1 })
}
