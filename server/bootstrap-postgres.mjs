// Schema deployment is a separate owner-only operation, never an application privilege.
import { readFileSync } from 'node:fs'
import { openBankDatabase } from './database.mjs'
import { ensureStaffSchema } from './staff-api.mjs'
import { createCustomerAuth } from './customer-auth.mjs'
import { createCustomerSupportApi } from './support-api.mjs'
import { createSecurityGateway } from './security-gateway.mjs'
import { createOperations } from './operations.mjs'
process.env.BANK_AUTO_MIGRATE = 'true'
const bank = await openBankDatabase(process.env.BANK_DATABASE_URL, { autoMigrate: true, profileProjection: 'scoped', max: 2 })
try {
  await ensureStaffSchema(bank.db)
  const auth = await createCustomerAuth(bank.db)
  await createCustomerSupportApi({ db: bank.db, auth })
  await createSecurityGateway(bank.db, auth)
  await createOperations({ db: bank.db, root: process.cwd(), probes: [] })
  await bank.db.exec('CREATE TABLE IF NOT EXISTS bank_admin_audit(id TEXT PRIMARY KEY, action TEXT NOT NULL, owner_id TEXT NOT NULL, created_at TEXT NOT NULL)')
  await bank.db.exec(readFileSync(new URL('./bank-connect-schema.sql', import.meta.url), 'utf8'))
  console.log(JSON.stringify({ ok: true, database: 'postgresql', externalBankConfigured: false }))
} finally { await bank.close() }
