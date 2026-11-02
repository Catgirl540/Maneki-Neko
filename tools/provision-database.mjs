#!/usr/bin/env node
/**
 * Create the local database, the AI-session role, and both connection strings.
 *
 * The point is to stop asking people to assemble PostgreSQL URLs by hand. Given
 * one admin connection string and a database name, everything else is derived:
 * the bank URL, the session role with a generated password, and the session URL.
 *
 * Scope note: this reuses the admin credentials for the bank URL. That is fine
 * for a local single-user install, where bootstrap and runtime are the same
 * person. A deployment with real money should split owner and application roles
 * -- see server/README.md -- and this helper is not a substitute for that.
 *
 * Owner URL, database name and generated passwords arrive on stdin: arguments
 * are visible in `ps` to every local user.
 *
 *   echo '{"adminUrl":"postgres://u:p@host:5432/postgres","database":"maneki_bank",
 *          "sessionRole":"maneki_ai_session","sessionPassword":"..."}' \
 *     | node tools/provision-database.mjs
 *
 * Prints one JSON line: { ok, bankUrl, sessionUrl, ... } or { ok: false, error }.
 */
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(fileURLToPath(new URL('../framework/bridge/pg-runtime/package.json', import.meta.url)))

const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

/** Replace the path component of a postgres URL without touching credentials. */
function withDatabase(url, database) {
  const parsed = new URL(url)
  parsed.pathname = `/${database}`
  return parsed.toString()
}

try {
  const input = JSON.parse(await readStdin())
  const { adminUrl, database, sessionRole, sessionPassword } = input ?? {}
  if (!/^postgres(ql)?:\/\//i.test(adminUrl ?? '')) throw new Error('adminUrl must be a postgres:// URL')
  if (!IDENTIFIER.test(database ?? '')) throw new Error('database name must be a plain lowercase identifier')
  if (!IDENTIFIER.test(sessionRole ?? '')) throw new Error('session role name must be a plain identifier')
  // Hex, so it needs no SQL quoting and cannot terminate the string early.
  if (!/^[A-Za-z0-9]{16,128}$/.test(sessionPassword ?? '')) throw new Error('session password must be 16-128 alphanumeric characters')

  const { Client } = require('pg')
  const result = { ok: true, database, createdDatabase: false, createdSessionRole: false }

  // CREATE DATABASE cannot run inside a transaction and cannot target the
  // database being created, so the existence check and the DDL both run on
  // the maintenance database.
  const admin = new Client({ connectionString: adminUrl, application_name: 'maneki-provision' })
  await admin.connect()
  try {
    const exists = (await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [database])).rowCount > 0
    if (!exists) {
      await admin.query(`CREATE DATABASE "${database}"`)
      result.createdDatabase = true
    }
  } finally {
    await admin.end()
  }

  const db = new Client({ connectionString: withDatabase(adminUrl, database), application_name: 'maneki-provision' })
  await db.connect()
  try {
    const exists = (await db.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [sessionRole])).rowCount > 0
    if (exists) await db.query(`ALTER ROLE "${sessionRole}" LOGIN PASSWORD '${sessionPassword}'`)
    else await db.query(`CREATE ROLE "${sessionRole}" LOGIN PASSWORD '${sessionPassword}'`)
    result.createdSessionRole = !exists
    // Connect only: no ownership, no schema creation, no bank table access.
    await db.query(`GRANT CONNECT ON DATABASE "${database}" TO "${sessionRole}"`)
  } finally {
    await db.end()
  }

  result.bankUrl = withDatabase(adminUrl, database)
  const session = new URL(withDatabase(adminUrl, database))
  session.username = sessionRole
  session.password = sessionPassword
  result.sessionUrl = session.toString()
  console.log(JSON.stringify(result))
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: error?.message ?? String(error) }))
  process.exitCode = 1
}
