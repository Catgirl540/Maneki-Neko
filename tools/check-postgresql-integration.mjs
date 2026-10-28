/** Required integration gate: missing test databases are a failure, never a skip. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
for (const [variable, database] of [
  ['BANK_TEST_DATABASE_URL', 'maneki_bank_test'],
  ['BANK_CONNECT_TEST_DATABASE_URL', 'maneki_connector_test'],
  ['BANK_HTTP_TEST_DATABASE_URL', 'maneki_http_test'],
  ['LUCKYCAT_SESSION_TEST_DATABASE_URL', 'maneki_ai_sessions_test'],
]) {
  assert(process.env[variable], `${variable} must explicitly name a disposable test database`)
  const url = new URL(process.env[variable])
  assert(['postgres:', 'postgresql:'].includes(url.protocol), `${variable} must be a PostgreSQL URL`)
  assert(new RegExp(`^${database}(?:_[a-z0-9_]+)?$`).test(decodeURIComponent(url.pathname.slice(1))), `${variable} must use ${database} or its suffixed test name`)
}
const run = args => {
  const result = spawnSync(process.execPath, args, { cwd: root, env: process.env, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
run(['--test', '--test-concurrency=1', ...['postgres-database', 'pg-auth-support', 'pg-staff', 'staff-im', 'staff-unfreeze', 'bank-connect', 'banking-http', 'account-security', 'transfer-hold-currency', 'card-state', 'payment-plans', 'billing-reports', 'linked-plans', 'subscriptions', 'wealth-redemption', 'extended-banking'].map(name => `server/${name}.test.mjs`)])
run(['--test', '--test-concurrency=1', ...readdirSync(resolve(root, 'framework/bridge')).filter(name => name.endsWith('.test.mjs')).sort().map(name => `framework/bridge/${name}`)])
run(['tools/check-agent-http.mjs'])
