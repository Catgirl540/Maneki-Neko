/** Offline, one-time import only. The running bank server never imports SQLite. */
import { DatabaseSync } from 'node:sqlite'
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { createDataCipher } from './database-crypto.mjs'
import { openBankDatabase, reconcileDatabase } from './database.mjs'

const identifier = value => {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error('Unexpected source database identifier')
  return `"${value}"`
}
const FIRST = ['bank_schema_migrations', 'customers', 'app_storage', 'customer_credentials', 'profile_bindings', 'bank_accounts', 'bank_transactions', 'virtual_cards', 'virtual_card_secrets', 'bank_payees', 'payment_mandates', 'fps_registrations', 'ledger_accounts', 'journal_batches', 'journal_entries', 'balance_changes', 'staff_users', 'tickets', 'ticket_messages', 'approvals']
const generatedName = (kind, table, suffix) => `${kind}_${table.slice(0, 30)}_${createHash('sha256').update(`${table}:${suffix}`).digest('hex').slice(0, 12)}`
function defaultClause(column) {
  if (column.dflt_value == null) return ''
  const value = column.dflt_value.trim()
  if (/^CURRENT_TIMESTAMP$/i.test(value)) return ' DEFAULT (CURRENT_TIMESTAMP::text)'
  if (/^(?:NULL|-?\d+(?:\.\d+)?|'(?:[^']|'')*')$/i.test(value)) return ` DEFAULT ${value}`
  throw new Error('Source auxiliary default requires an explicit owner schema migration')
}
function compatibleExpression(value) {
  if (!/^[\w\s'"(),.<>!=+*/%-]+$/.test(value) || /\b(?:typeof|strftime|julianday|json_extract|glob|collate|select|randomblob)\b/i.test(value)) throw new Error('Source auxiliary constraint/index requires an explicit owner schema migration')
  return value
}
function checksFromDefinition(sql) {
  const checks = []
  for (const match of sql.matchAll(/\bCHECK\s*\(/gi)) {
    let cursor = match.index + match[0].length, depth = 1, quote = false, expression = ''
    for (; cursor < sql.length && depth; cursor++) {
      const char = sql[cursor]
      if (char === "'") { if (quote && sql[cursor + 1] === "'") { expression += "''"; cursor++; continue }; quote = !quote }
      if (!quote) { if (char === '(') depth++; else if (char === ')') depth-- }
      if (depth) expression += char
    }
    if (depth) throw new Error('Invalid source auxiliary CHECK definition')
    checks.push(`CHECK (${compatibleExpression(expression)})`)
  }
  return checks
}

export async function migrateSqliteToPostgres({ sourcePath, connectionString = process.env.BANK_DATABASE_URL, schema } = {}) {
  if (!sourcePath || !existsSync(sourcePath)) throw new Error('A readable SQLite source snapshot is required')
  if (!process.env.BANK_DATA_KEY) throw new Error('Use the existing BANK_DATA_KEY to preserve encrypted customer data')
  const source = new DatabaseSync(sourcePath, { readOnly: true })
  let bank
  try {
    const integrity = source.prepare('PRAGMA integrity_check').all()
    if (integrity.length !== 1 || Object.values(integrity[0])[0] !== 'ok' || source.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Source database integrity verification failed')
    const tables = source.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(row => row.name)
    if (!['customers', 'bank_accounts', 'bank_transactions', 'journal_batches', 'journal_entries'].every(table => tables.includes(table))) throw new Error('Migration requires the normalized core-v2 source; preserve the source and upgrade it offline first')
    if (source.prepare("SELECT COUNT(*) n FROM journal_batches WHERE state<>'posted'").get().n) throw new Error('Source contains unposted journals; reconcile before migration')
    const sample = source.prepare('SELECT id,user_cipher FROM customers LIMIT 1').get()
    if (sample) createDataCipher(':memory:').open(sample.user_cipher, `customers:${sample.id}`)
    bank = await openBankDatabase(connectionString, { schema, autoMigrate: true })
    const report = await bank.db.transaction(async () => {
      await bank.db.query('SELECT pg_advisory_xact_lock(782614101)')
      const targetTables = (await bank.db.query("SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_type='BASE TABLE'")).rows.map(row => row.table_name)
      for (const table of targetTables.filter(table => table !== 'bank_schema_migrations')) {
        const count = (await bank.db.query(`SELECT COUNT(*) n FROM ${identifier(table)}`)).rows[0].n
        if (count) throw new Error(`Target must be empty before migration: ${table}`)
      }
      const order = [...FIRST.filter(table => tables.includes(table)), ...tables.filter(table => !FIRST.includes(table)).sort()]
      const counts = {}, posted = [], createdAuxiliary = []
      for (const table of order) {
        const sourceColumns = source.prepare(`PRAGMA table_info(${identifier(table)})`).all()
        if (!targetTables.includes(table)) {
          // Preserve simple operational schema semantics. Unsupported expressions
          // stop migration instead of silently dropping a source constraint.
          const primary = sourceColumns.filter(column => column.pk).sort((a, b) => a.pk - b.pk)
          if (source.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND tbl_name=? LIMIT 1").get(table)) throw new Error('Source auxiliary trigger requires an explicit owner schema migration')
          const definitions = sourceColumns.map(column => `${identifier(column.name)} ${/INT/i.test(column.type) ? `BIGINT${primary.length === 1 && column.pk ? ' GENERATED BY DEFAULT AS IDENTITY' : ''}` : /BLOB/i.test(column.type) ? 'BYTEA' : /REAL|FLOA|DOUB/i.test(column.type) ? 'DOUBLE PRECISION' : 'TEXT'}${column.notnull ? ' NOT NULL' : ''}${defaultClause(column)}`)
          if (!sourceColumns.some(column => column.name === 'seq')) definitions.unshift('seq BIGINT GENERATED BY DEFAULT AS IDENTITY UNIQUE')
          if (primary.length) definitions.push(`PRIMARY KEY (${primary.map(column => identifier(column.name)).join(',')})`)
          const definition = source.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table).sql
          definitions.push(...checksFromDefinition(definition))
          await bank.db.query(`CREATE TABLE ${identifier(table)} (${definitions.join(',')})`)
          createdAuxiliary.push(table)
        }
        const columns = sourceColumns.map(column => column.name).filter(name => name !== 'seq')
        const rows = source.prepare(`SELECT * FROM ${identifier(table)} ORDER BY rowid`).all()
        counts[table] = rows.length
        for (const row of rows) {
          if (table === 'journal_batches') { posted.push(row.id); row.state = 'draft' }
          await bank.db.query(`INSERT INTO ${identifier(table)} (${columns.map(identifier).join(',')}) VALUES (${columns.map((_, index) => `$${index + 1}`).join(',')})${table === 'bank_schema_migrations' ? ' ON CONFLICT DO NOTHING' : ''}`, columns.map(name => row[name]))
        }
      }
      for (const table of createdAuxiliary) {
        for (const index of source.prepare(`PRAGMA index_list(${identifier(table)})`).all()) {
          if (index.origin === 'pk') continue
          const columns = source.prepare(`PRAGMA index_info(${identifier(index.name)})`).all()
          if (columns.some(column => column.name == null)) throw new Error('Source expression index requires an explicit owner schema migration')
          const details = source.prepare(`PRAGMA index_xinfo(${identifier(index.name)})`).all().filter(column => column.key)
          if (details.some(column => column.coll && column.coll !== 'BINARY')) throw new Error('Source collation index requires an explicit owner schema migration')
          const definition = source.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name=?").get(index.name)?.sql
          const predicate = index.partial ? /\bWHERE\s+([\s\S]+)$/i.exec(definition ?? '')?.[1] : null
          if (index.partial && !predicate) throw new Error('Invalid source partial index definition')
          await bank.db.query(`CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX ${identifier(generatedName('legacy_idx', table, index.name))} ON ${identifier(table)} (${columns.map(column => `${identifier(column.name)}${details.find(item => item.seqno === column.seqno)?.desc ? ' DESC' : ''}`).join(',')})${predicate ? ` WHERE ${compatibleExpression(predicate)}` : ''}`)
        }
        const groups = new Map()
        for (const relation of source.prepare(`PRAGMA foreign_key_list(${identifier(table)})`).all()) {
          const group = groups.get(relation.id) ?? []; group.push(relation); groups.set(relation.id, group)
        }
        for (const [id, group] of groups) {
          group.sort((a, b) => a.seq - b.seq)
          const relation = group[0]
          if (![relation.on_update, relation.on_delete].every(value => ['NO ACTION','RESTRICT','CASCADE','SET NULL','SET DEFAULT'].includes(value))) throw new Error('Invalid source foreign key action')
          const target = group.every(item => item.to) ? ` (${group.map(item => identifier(item.to)).join(',')})` : ''
          await bank.db.query(`ALTER TABLE ${identifier(table)} ADD CONSTRAINT ${identifier(generatedName('legacy_fk', table, String(id)))} FOREIGN KEY (${group.map(item => identifier(item.from)).join(',')}) REFERENCES ${identifier(relation.table)}${target} ON UPDATE ${relation.on_update} ON DELETE ${relation.on_delete} DEFERRABLE INITIALLY DEFERRED`)
        }
      }
      for (const id of posted) await bank.db.query("UPDATE journal_batches SET state='posted' WHERE id=$1", [id])
      for (const [table, expected] of Object.entries(counts)) {
        if (table === 'bank_schema_migrations') continue
        const actual = (await bank.db.query(`SELECT COUNT(*) n FROM ${identifier(table)}`)).rows[0].n
        if (actual !== expected) throw new Error(`Migration row count mismatch: ${table}`)
      }
      const accounts = source.prepare('SELECT owner_id,id,balance_cents,available_cents FROM bank_accounts ORDER BY owner_id,id').all()
      const migrated = (await bank.db.query('SELECT owner_id,id,balance_cents,available_cents FROM bank_accounts ORDER BY owner_id,id')).rows
      if (JSON.stringify(accounts) !== JSON.stringify(migrated)) throw new Error('Migration account balances differ from the source')
      const check = await reconcileDatabase(bank.db)
      if (!check.ok) throw new Error('Target accounting reconciliation failed')
      const identities = (await bank.db.query("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=current_schema() AND is_identity='YES'")).rows
      for (const { table_name: table, column_name: column } of identities) {
        const maximum = (await bank.db.query(`SELECT COALESCE(MAX(${identifier(column)}),0) n FROM ${identifier(table)}`)).rows[0].n
        await bank.db.query('SELECT setval(pg_get_serial_sequence($1,$2),$3,$4)', [table, column, Math.max(maximum, 1), maximum > 0])
      }
      return { ok: true, database: 'postgresql', tables: counts, accounts: accounts.length, transactions: counts.bank_transactions, journalEntries: counts.journal_entries, balanceVerified: true, auxiliarySchemaVerified: true,
        note: 'Owner bootstrap must install application PostgreSQL indexes/constraints before the runtime role starts. Source SQLite triggers are not executed or translated.' }
    })
    await bank.storage.refresh()
    return report
  } finally { source.close(); if (bank) await bank.close() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.env.BANK_MAINTENANCE !== '1') throw new Error('Stop writers, take a source backup, and set BANK_MAINTENANCE=1 before migration')
    const args = process.argv.slice(2)
    if (args.length !== 2 || args[0] !== '--source') throw new Error('Usage: BANK_MAINTENANCE=1 node server/migrate-sqlite-to-postgres.mjs --source SOURCE_SNAPSHOT')
    console.log(JSON.stringify(await migrateSqliteToPostgres({ sourcePath: args[1] }), null, 2))
  } catch (error) { console.error(`Migration failed (${error?.code ?? error?.name ?? 'ERROR'}). Source was opened read-only; target transaction was rolled back. ${/^(A readable|Use the existing|Migration requires|Source contains|Source database|Target must|Stop writers|Usage:)/.test(error?.message ?? '') ? error.message : 'Inspect local database diagnostics without exposing credentials.'}`); process.exitCode = 1 }
}
