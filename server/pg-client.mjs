import pg from 'pg'
import { AsyncLocalStorage } from 'node:async_hooks'

const { Pool, types } = pg
const MAX_INTEGER = BigInt(Number.MAX_SAFE_INTEGER)
function safeInteger(value) {
  const integer = BigInt(value)
  if (integer > MAX_INTEGER || integer < -MAX_INTEGER) throw new RangeError('Database integer exceeds the API safe integer range')
  return Number(integer)
}
const resultTypes = { getTypeParser(oid, format) {
  if (format !== 'binary' && oid === 20) return safeInteger
  // SUM(bigint) is NUMERIC in PostgreSQL. Keep larger/decimal results exact.
  if (format !== 'binary' && oid === 1700) return value => /^-?\d+$/.test(value) && BigInt(value) <= MAX_INTEGER && BigInt(value) >= -MAX_INTEGER ? Number(value) : value
  return types.getTypeParser(oid, format)
} }

/** Replace positional ? outside SQL strings/comments. Native query() uses $n. */
export function postgresParameters(sql) {
  let index = 0, mode = '', dollar = '', output = ''
  for (let cursor = 0; cursor < sql.length; cursor++) {
    const char = sql[cursor], next = sql[cursor + 1]
    if (mode === 'line') { output += char; if (char === '\n') mode = ''; continue }
    if (mode === 'block') { output += char; if (char === '*' && next === '/') { output += next; cursor++; mode = '' }; continue }
    if (mode === 'dollar') { if (sql.startsWith(dollar, cursor)) { output += dollar; cursor += dollar.length - 1; mode = '' } else output += char; continue }
    if (mode === "'" || mode === '"') { output += char; if (char === mode) { if (next === mode) { output += next; cursor++ } else mode = '' }; continue }
    if (char === '-' && next === '-') { output += '--'; cursor++; mode = 'line'; continue }
    if (char === '/' && next === '*') { output += '/*'; cursor++; mode = 'block'; continue }
    if (char === "'" || char === '"') { output += char; mode = char; continue }
    if (char === '$') { const match = /^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/.exec(sql.slice(cursor)); if (match) { dollar = match[0]; output += dollar; cursor += dollar.length - 1; mode = 'dollar'; continue } }
    output += char === '?' ? `$${++index}` : char
  }
  return output
}

/** The legacy profile bridge uses one explicit client; native repositories use ALS. */
export function createPgClient(connectionString = process.env.BANK_DATABASE_URL, options = {}) {
  if (typeof connectionString !== 'string' || !/^postgres(?:ql)?:\/\//i.test(connectionString)) throw new Error('BANK_DATABASE_URL must be a PostgreSQL connection URL')
  const schema = options.schema ?? process.env.BANK_DATABASE_SCHEMA
  if (schema && !/^[a-z_][a-z0-9_]{0,62}$/.test(schema)) throw new Error('Invalid PostgreSQL schema name')
  const pool = new Pool({ connectionString, max: options.max ?? 10, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 30_000,
    statement_timeout: 15_000, application_name: 'luckycat-bank', types: resultTypes,
    ...(schema ? { options: `-c search_path=${schema},public` } : {}) })
  pool.on('error', () => { /* Request probes surface unavailable connections without logging credentials. */ })
  const transactions = new AsyncLocalStorage()
  const manualOwners = new AsyncLocalStorage()
  let manualClient = null, manualOwner = null, manualStarting = false, closed = false
  const ownsManual = () => manualClient && manualOwners.getStore() === manualOwner
  const current = () => transactions.getStore() ?? (ownsManual() ? manualClient : pool)
  const query = (sql, parameters = []) => current().query(sql, parameters)
  const db = {
    pool, query,
    prepare(sql) {
      const statement = postgresParameters(sql)
      return {
        all: async (...parameters) => (await query(statement, parameters)).rows,
        get: async (...parameters) => (await query(statement, parameters)).rows[0],
        run: async (...parameters) => ({ changes: (await query(statement, parameters)).rowCount ?? 0 }),
      }
    },
    async exec(sql) {
      const command = sql.trim().replace(/;$/, '').toUpperCase()
      if (command === 'BEGIN' || command === 'BEGIN IMMEDIATE') return db.begin()
      if (command === 'COMMIT') return db.commit()
      if (command === 'ROLLBACK') return db.rollback()
      return query(sql)
    },
    async begin() {
      if (manualClient || manualStarting || transactions.getStore()) throw new Error('A PostgreSQL transaction is already active')
      manualStarting = true
      // enterWith must happen before the first await, so the caller's await
      // continuation and its business callbacks inherit this transaction owner.
      const owner = {}
      manualOwners.enterWith(owner)
      let client
      try {
        client = await pool.connect()
        await client.query('BEGIN'); manualClient = client; manualOwner = owner
      } catch (error) { client?.release(); throw error }
      finally { manualStarting = false }
    },
    async commit() {
      if (!manualClient) throw new Error('No explicit PostgreSQL transaction is active')
      if (!ownsManual()) throw new Error('Cannot commit a PostgreSQL transaction owned by another async context')
      const client = manualClient
      try {
        const result = await client.query('COMMIT')
        if (result.command !== 'COMMIT') throw new Error('PostgreSQL rolled back an aborted transaction instead of committing')
      } catch (error) { try { await client.query('ROLLBACK') } catch {}; throw error }
      finally { manualClient = null; manualOwner = null; client.release() }
    },
    async rollback() {
      if (!manualClient) return
      if (!ownsManual()) throw new Error('Cannot roll back a PostgreSQL transaction owned by another async context')
      const client = manualClient
      try { await client.query('ROLLBACK') } finally { manualClient = null; manualOwner = null; client.release() }
    },
    async transaction(work, { isolationLevel = 'READ COMMITTED', readOnly = false } = {}) {
      // Bank callbacks and audit writes join the active financial unit of work.
      if (transactions.getStore() || ownsManual()) return work(db)
      if (!['READ COMMITTED', 'REPEATABLE READ', 'SERIALIZABLE'].includes(isolationLevel)) throw new Error('Unsupported PostgreSQL transaction isolation level')
      const client = await pool.connect()
      try {
        await client.query(`BEGIN ISOLATION LEVEL ${isolationLevel}${readOnly ? ' READ ONLY' : ''}`)
        const value = await transactions.run(client, () => work(db))
        const result = await client.query('COMMIT')
        if (result.command !== 'COMMIT') throw new Error('PostgreSQL rolled back an aborted transaction instead of committing')
        return value
      } catch (error) { try { await client.query('ROLLBACK') } catch {}; throw error }
      finally { client.release() }
    },
    async close() { if (closed) return; await db.rollback(); closed = true; await pool.end() },
  }
  return db
}
