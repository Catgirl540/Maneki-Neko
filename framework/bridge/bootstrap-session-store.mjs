// Owner-only database bootstrap; runtime workers never execute DDL.
import { readFileSync } from 'node:fs'
import { loadSessionPg } from './session-store.mjs'

if (process.env.LUCKYCAT_SESSION_MAINTENANCE !== '1' || !/^postgres(?:ql)?:\/\//i.test(process.env.LUCKYCAT_SESSION_OWNER_DATABASE_URL ?? '')) {
  console.error('Owner bootstrap requires LUCKYCAT_SESSION_MAINTENANCE=1 and LUCKYCAT_SESSION_OWNER_DATABASE_URL')
  process.exit(2)
}
const role = process.env.LUCKYCAT_SESSION_RUNTIME_ROLE ?? 'maneki_ai_session'
if (!/^[a-z_][a-z0-9_]{0,62}$/.test(role)) throw new Error('Invalid runtime role')
const backupRole = process.env.LUCKYCAT_SESSION_BACKUP_ROLE ?? 'maneki_backup'
if (!/^[a-z_][a-z0-9_]{0,62}$/.test(backupRole)) throw new Error('Invalid backup role')
const { Pool } = loadSessionPg(), pool = new Pool({ connectionString: process.env.LUCKYCAT_SESSION_OWNER_DATABASE_URL, max: 1, connectionTimeoutMillis: 10000, application_name: 'maneki-ai-session-bootstrap' })
pool.on('error', () => {})
let client
try {
  client = await pool.connect()
  await client.query('BEGIN')
  await client.query('SELECT pg_advisory_xact_lock(782614102)')
  const known = (await client.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).rows[0]
  if (!known) throw new Error('Create the dedicated NOINHERIT NOSUPERUSER runtime role before bootstrapping')
  await client.query(readFileSync(new URL('./session-schema.sql', import.meta.url), 'utf8'))
  await client.query(`GRANT USAGE ON SCHEMA ai_sessions TO "${role}";
    GRANT SELECT,INSERT,UPDATE ON ai_sessions.sessions TO "${role}";
    GRANT SELECT,INSERT ON ai_sessions.events,ai_sessions.imports TO "${role}";
    REVOKE CREATE ON SCHEMA ai_sessions FROM "${role}";
    REVOKE DELETE,TRUNCATE,REFERENCES,TRIGGER ON ai_sessions.sessions FROM "${role}";
    REVOKE UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON ai_sessions.events,ai_sessions.imports FROM "${role}";`)
  const hasBackupRole = Boolean((await client.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [backupRole])).rows[0])
  if (hasBackupRole) await client.query(`GRANT USAGE ON SCHEMA ai_sessions TO "${backupRole}";
    GRANT SELECT ON ALL TABLES IN SCHEMA ai_sessions TO "${backupRole}";
    GRANT SELECT ON ALL SEQUENCES IN SCHEMA ai_sessions TO "${backupRole}";`)
  await client.query('COMMIT')
  console.log(JSON.stringify({ ok: true, database: 'postgresql', schema: 'ai_sessions', runtimeRole: role, backupRoleGranted: hasBackupRole }))
} catch {
  if (client) await client.query('ROLLBACK').catch(() => {})
  console.error('{"ok":false,"code":"AI_SESSION_BOOTSTRAP_FAILED"}')
  process.exitCode = 1
} finally { client?.release(); await pool.end() }
