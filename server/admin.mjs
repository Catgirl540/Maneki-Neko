// Run only while the service is stopped, via deploy/postgres/admin.py.
import { readFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { openBankDatabase, CURRENT_KEY, PROFILES_KEY } from './database.mjs'
import { hashPassword } from './passwords.mjs'

const [action, owner, ...extra] = process.argv.slice(2)
const actions = ['set-staff-password', 'set-customer-password', 'set-payment-password', 'unlock-payment']
if (!actions.includes(action) || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(owner ?? '') || extra.length || process.env.BANK_MAINTENANCE !== '1' || !/^postgres(?:ql)?:\/\//i.test(process.env.BANK_DATABASE_URL ?? '') || !process.env.BANK_DATA_KEY) {
  console.error('Use deploy/postgres/admin.py with PostgreSQL maintenance mode while the bank service is stopped')
  process.exit(2)
}
let password = '', bank
try {
  // Stdin only: never accept passwords in arguments or include them in diagnostics.
  password = action === 'unlock-payment' ? '' : readFileSync(0, 'utf8').replace(/[\r\n]+$/, '')
  if (action !== 'unlock-payment' && (/[\0\r\n]/.test(password) || (action === 'set-payment-password' ? !/^\d{6}$/.test(password) : password.length < 12 || password.length > 20))) {
    throw Object.assign(new Error('Invalid maintenance password format'), { code: 'INVALID_PASSWORD_FORMAT' })
  }
  bank = await openBankDatabase(process.env.BANK_DATABASE_URL, { autoMigrate: false })
  await bank.storage.beginUnitOfWork({ requestId: randomUUID() })
  if (action === 'set-staff-password') {
    const staff = await bank.db.prepare('SELECT name FROM staff_users WHERE id=? FOR UPDATE').get(owner)
    if (!staff) throw Object.assign(new Error('Unknown staff user'), { code: 'UNKNOWN_ACCOUNT' })
    await bank.db.prepare('UPDATE staff_users SET password_hash=? WHERE id=?').run(hashPassword(password), owner)
    password = ''
    await bank.db.prepare('DELETE FROM staff_login_attempts WHERE identifier=?').run(createHash('sha256').update(staff.name.trim()).digest('hex'))
  } else {
    const profiles = JSON.parse(bank.storage.getItem(PROFILES_KEY) ?? '{}')
    const current = JSON.parse(bank.storage.getItem(CURRENT_KEY) ?? 'null')
    const profile = Object.values(profiles).find(item => item.user.id === owner) ?? (current?.user.id === owner ? current : null)
    if (!profile) throw Object.assign(new Error('Unknown customer'), { code: 'UNKNOWN_ACCOUNT' })
    if (action === 'set-customer-password') profile.passwordDigest = hashPassword(password)
    if (action === 'set-payment-password') profile.payPassword = hashPassword(password)
    password = ''
    if (action !== 'set-customer-password') profile.payPasswordFailures = 0
    profiles[profile.user.phone] = profile
    const entries = [[PROFILES_KEY, JSON.stringify(profiles)]]
    if (current?.user.id === owner) entries.unshift([CURRENT_KEY, JSON.stringify(profile)])
    bank.storage.setItemsAtomically(entries)
    await bank.db.prepare('UPDATE customer_sessions SET ended_at=? WHERE owner_id=? AND ended_at IS NULL').run(new Date().toISOString(), owner)
    if (action === 'set-customer-password') await bank.db.prepare("DELETE FROM bank_security_limits WHERE scope='login-phone' AND subject=?").run(createHash('sha256').update(profile.user.phone).digest('hex'))
  }
  // Owner bootstrap creates this table. Maintenance uses DML privileges only.
  await bank.db.prepare('INSERT INTO bank_admin_audit (id,action,owner_id,created_at) VALUES(?,?,?,?)').run(randomUUID(), action, owner, new Date().toISOString())
  await bank.storage.commitUnitOfWork()
  console.log(JSON.stringify({ ok: true, database: 'postgresql', action, id: owner }))
} catch (cause) {
  if (bank) await bank.storage.rollbackUnitOfWork().catch(() => {})
  const code = ['INVALID_PASSWORD_FORMAT', 'UNKNOWN_ACCOUNT'].includes(cause?.code) ? cause.code : 'MAINTENANCE_FAILED'
  // Database error messages may contain SQL values; never echo them to logs.
  console.error(JSON.stringify({ ok: false, code }))
  process.exitCode = code === 'INVALID_PASSWORD_FORMAT' ? 2 : 1
} finally {
  password = ''
  if (bank) await bank.close().catch(() => { console.error('{"ok":false,"code":"MAINTENANCE_CLEANUP_FAILED"}'); process.exitCode = 1 })
}
