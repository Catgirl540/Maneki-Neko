import { createPgClient } from './pg-client.mjs'
import { reconcileDatabase } from './database.mjs'

if (process.argv.length !== 2 || !process.env.BANK_DATABASE_URL) {
  console.error('Usage: BANK_DATABASE_URL=<protected PostgreSQL URL> node server/reconcile.mjs')
  process.exit(2)
}
const db = createPgClient()
try {
  const report = { checkedAt: new Date().toISOString(), database: 'postgresql', ...await reconcileDatabase(db) }
  console.log(JSON.stringify(report, null, 2))
  if (!report.ok) process.exitCode = 1
} catch {
  console.error('PostgreSQL reconciliation failed; inspect service and database diagnostics')
  process.exitCode = 2
} finally { await db.close() }
