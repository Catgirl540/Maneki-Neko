import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { createDataCipher } from './database-crypto.mjs'
import { createPgClient } from './pg-client.mjs'
import { createScopedProfileStorage, fingerprint } from './profile-store.mjs'

export const CURRENT_KEY = 'luckycat.mock.db'
export const PROFILES_KEY = 'luckycat.luckycat.mock.user-profiles.v1'
export const CORE_SCHEMA_VERSION = 2026102201
const PROFILE_KEYS = new Set([CURRENT_KEY, PROFILES_KEY])
const DOMAINS = {
  customer_wealth_state: ['holdings', 'riskAssessment', 'wealthAccount'],
  customer_savings_state: ['savings'],
  customer_credit_state: ['salaryPlan', 'overdraft', 'credit'],
  customer_investment_state: ['cashManagement', 'investments'],
  customer_insurance_state: ['insurance'],
  customer_security_state: ['security', 'pendingSms'],
  customer_membership_state: ['invitations', 'membership', 'assetSnapshots'],
  customer_payment_state: ['virtualCards'],
  customer_reference_state: ['banks'],
}
const CORE_FIELDS = new Set(['user', 'accounts', 'currencyBalances', 'retiredBalances', 'transactions', 'cards', 'cardSecrets', 'payees', 'autoDebits', 'fpsRegistrations'])
const DOMAIN_FIELDS = new Set(Object.values(DOMAINS).flat())
const isCredential = key => /password|credential|secret|pinDigest/i.test(key)
const clone = value => JSON.parse(JSON.stringify(value))
const own = (value, key) => Object.hasOwn(value, key)

export function assertCents(value, label, { positive = false, signed = false } = {}) {
  if (!Number.isSafeInteger(value) || (!signed && value < (positive ? 1 : 0))) throw new Error(`${label} must be safe integer minor units`)
  return value
}
const requireText = (value, label) => {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} is required`)
  return value
}
const without = (value, keys) => Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)))

/** PostgreSQL is authoritative. Synchronous domain storage is a transaction-local projection. */
export async function openBankDatabase(connectionString = process.env.BANK_DATABASE_URL, options = {}) {
  if (!process.env.BANK_DATA_KEY) throw new Error('BANK_DATA_KEY is required for PostgreSQL encrypted customer data')
  const settings = typeof options === 'object' ? options : {}
  const autoMigrate = settings.autoMigrate ?? process.env.BANK_AUTO_MIGRATE !== 'false'
  const cipher = createDataCipher(':memory:'), db = createPgClient(connectionString, settings)
  const query = (sql, ...args) => db.prepare(sql).all(...args)
  const get = (sql, ...args) => db.prepare(sql).get(...args)
  const run = (sql, ...args) => db.prepare(sql).run(...args)
  let pending = null, starting = false, migrationImport = false, committed = new Map()
  let staged = { entries: new Map(), profiles: new Map() }
  try {
    await db.transaction(async () => {
      await db.query('SELECT pg_advisory_xact_lock(782614100)')
      const found = await get("SELECT 1 FROM information_schema.tables WHERE table_schema=current_schema() AND table_name='bank_schema_migrations'")
      const version = found ? (await get('SELECT MAX(version) AS version FROM bank_schema_migrations')).version ?? 0 : 0
      if (version > CORE_SCHEMA_VERSION) throw new Error('Database schema is newer than this server; refusing to downgrade')
      if (version < CORE_SCHEMA_VERSION && !autoMigrate) throw new Error('PostgreSQL schema requires owner bootstrap; BANK_AUTO_MIGRATE=false forbids runtime DDL')
      if (version < CORE_SCHEMA_VERSION) {
        await db.exec(readFileSync(new URL('./postgres-schema.sql', import.meta.url), 'utf8'))
        for (const table of [...Object.keys(DOMAINS), 'customer_extension_state']) await db.exec(`CREATE TABLE IF NOT EXISTS ${table} (owner_id TEXT PRIMARY KEY REFERENCES customers(id), payload_cipher TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text))`)
        await run('INSERT INTO bank_schema_migrations(version) VALUES (?) ON CONFLICT DO NOTHING', CORE_SCHEMA_VERSION)
      }
    })
    if (settings.profileProjection !== 'scoped') committed = await hydrate()
  } catch (error) { await db.close(); throw error }

  async function upsertPayload(table, owner, payload) {
    await run(`INSERT INTO ${table}(owner_id,payload_cipher) VALUES (?,?) ON CONFLICT(owner_id) DO UPDATE SET payload_cipher=excluded.payload_cipher,updated_at=CURRENT_TIMESTAMP`, owner, cipher.seal(payload, `${table}:${owner}`))
  }
  async function saveProfile(profile, changes, original) {
    const owner = requireText(profile?.user?.id, 'customer id')
    requireText(profile.user.phone, 'customer phone'); requireText(profile.user.name, 'customer name')
    if (!Array.isArray(profile.accounts) || !Array.isArray(profile.transactions)) throw new Error('Customer accounts and transactions arrays are required')
    await run(`INSERT INTO customers(id,phone,name,user_cipher,profile_fields_json) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET phone=excluded.phone,name=excluded.name,user_cipher=excluded.user_cipher,profile_fields_json=excluded.profile_fields_json,updated_at=CURRENT_TIMESTAMP`,
      owner, profile.user.phone, profile.user.name, cipher.seal(profile.user, `customers:${owner}`), JSON.stringify(Object.keys(profile)))
    const credentials = {}, extensions = {}
    for (const [key, value] of Object.entries(profile)) {
      if (isCredential(key) && key !== 'cardSecrets') credentials[key] = value
      else if (!CORE_FIELDS.has(key) && !DOMAIN_FIELDS.has(key)) extensions[key] = value
    }
    await upsertPayload('customer_credentials', owner, credentials); await upsertPayload('customer_extension_state', owner, extensions)
    for (const [table, fields] of Object.entries(DOMAINS)) await upsertPayload(table, owner, Object.fromEntries(fields.filter(f => own(profile, f)).map(f => [f, profile[f]])))
    const ids = new Set()
    const typed = profile.schema >= 20
    const records = [...profile.accounts.map(a => ({ ...a, ...(typed ? { __recordKind: 'funding' } : {}) })),
      ...(profile.currencyBalances ?? []).map(a => ({ ...a, __recordKind: 'currency' })),
      ...(profile.retiredBalances ?? []).map(a => ({ ...a, __recordKind: 'retired' }))]
    for (const [ordinal, a] of records.entries()) {
      requireText(a.id, 'account id'); requireText(a.accountNo, 'account number')
      if (ids.has(a.id)) throw new Error(`Duplicate account id: ${a.id}`)
      ids.add(a.id); assertCents(a.balance, 'account balance'); assertCents(a.available, 'available balance')
      if (a.available > a.balance) throw new Error('Available balance exceeds ledger balance')
      if (a.monthNetChange !== undefined) assertCents(a.monthNetChange, 'month net change', { signed: true })
      const old = await get('SELECT balance_cents,currency,account_no FROM bank_accounts WHERE owner_id=? AND id=?', owner, a.id)
      if (old && (old.currency !== a.currency || old.account_no !== a.accountNo)) throw new Error('Existing account currency and account number are immutable')
      await run(`INSERT INTO bank_accounts(owner_id,id,account_no,label,currency,kind,balance_cents,available_cents,ordinal,payload_cipher) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(owner_id,id) DO UPDATE SET label=excluded.label,kind=excluded.kind,balance_cents=excluded.balance_cents,available_cents=excluded.available_cents,ordinal=excluded.ordinal,payload_cipher=excluded.payload_cipher,updated_at=CURRENT_TIMESTAMP`,
        owner, a.id, a.accountNo, a.label, a.currency, a.kind ?? 'current', a.balance, a.available, ordinal, cipher.seal(without(a, ['id', 'accountNo', 'label', 'currency', 'kind', 'balance', 'available']), `account:${owner}:${a.id}`))
      const glId = `deposit:${owner}:${a.id}`
      await run("INSERT INTO ledger_accounts(id,code,name,currency,kind,owner_id,account_id) VALUES (?,'2101','Customer deposits',?,'liability',?,?) ON CONFLICT DO NOTHING", glId, a.currency, owner, a.id)
      if ((!old && a.balance !== 0) || (old && old.balance_cents !== a.balance)) changes.push({ owner, account: a.id, currency: a.currency, before: old?.balance_cents ?? 0, after: a.balance, opening: !old, glId })
    }
    for (const a of await query('SELECT id FROM bank_accounts WHERE owner_id=?', owner)) if (!ids.has(a.id)) throw new Error(`Cannot remove existing account: ${a.id}`)
    await saveTransactions(owner, profile.transactions, profile.accountAliases ?? {}, original?.transactions); await saveCards(owner, profile.cards ?? [], profile.cardSecrets ?? {})
    await saveRows('bank_payees', owner, profile.payees ?? [], (item, i) => [item.id, item.bankCode ?? null, item.bankRegion ?? null, i, cipher.seal(item, `payee:${owner}:${item.id}`)], ['id', 'bank_code', 'bank_region', 'ordinal', 'payload_cipher'])
    await saveRows('payment_mandates', owner, profile.autoDebits ?? [], (item, i) => [item.id, i, cipher.seal(item, `mandate:${owner}:${item.id}`)], ['id', 'ordinal', 'payload_cipher'])
    await saveRows('fps_registrations', owner, profile.fpsRegistrations ?? [], (item, i) => { const id = `${item.idType}:${item.id}`; return [id, item.accountId, i, cipher.seal(item, `fps:${owner}:${id}`)] }, ['id', 'account_id', 'ordinal', 'payload_cipher'])
  }
  async function saveRows(table, owner, rows, values, columns) {
    const seen = new Set()
    for (const [i, item] of rows.entries()) {
      const list = values(item, i); requireText(list[0], `${table} id`)
      if (seen.has(list[0])) throw new Error(`Duplicate ${table} id`)
      seen.add(list[0])
      await run(`INSERT INTO ${table}(owner_id,${columns.join(',')}) VALUES (${Array(columns.length + 1).fill('?').join(',')}) ON CONFLICT(owner_id,id) DO UPDATE SET ${columns.slice(1).map(c => `${c}=excluded.${c}`).join(',')}`, owner, ...list)
    }
    for (const row of await query(`SELECT id FROM ${table} WHERE owner_id=?`, owner)) if (!seen.has(row.id)) {
      if (table === 'virtual_cards') await run('DELETE FROM virtual_card_secrets WHERE owner_id=? AND card_id=?', owner, row.id)
      await run(`DELETE FROM ${table} WHERE owner_id=? AND id=?`, owner, row.id)
    }
  }
  async function saveTransactions(owner, transactions, aliases = {}, original) {
    const ids = new Set()
    // New business rows are prepended. Keep existing ordinal values so adding one
    // row never rewrites the entire historical ledger just to shift its indices.
    const firstKnown = original ? transactions.findIndex(tx => original.has(tx.id)) : -1
    const prefixOnly = original && firstKnown >= 0 && transactions.slice(firstKnown).every(tx => original.has(tx.id))
    let minimum = 0
    if (original?.size) { minimum = Infinity; for (const row of original.values()) minimum = Math.min(minimum, row.ordinal) }
    for (const [index, tx] of transactions.entries()) {
      const previous = original?.get(tx.id)
      const ordinal = prefixOnly ? previous?.ordinal ?? minimum - firstKnown + index : index
      requireText(tx.id, 'transaction id')
      if (ids.has(tx.id)) throw new Error(`Duplicate transaction id: ${tx.id}`)
      ids.add(tx.id); assertCents(tx.amount, 'transaction amount', { positive: true }); assertCents(tx.signedAmount, 'signed transaction amount', { signed: true })
      if (tx.signedAmount !== (tx.direction === 'in' ? tx.amount : -tx.amount)) throw new Error('Transaction sign does not match direction')
      if (tx.heldFrozenAmount !== undefined) assertCents(tx.heldFrozenAmount, 'held frozen amount')
      for (const field of ['balanceBefore', 'balanceAfter', 'originAmount']) if (tx.detail?.[field] !== undefined) assertCents(tx.detail[field], `transaction detail ${field}`)
      if (previous?.hash === fingerprint(tx) && previous.ordinal === ordinal) continue
      const old = await get('SELECT account_id,direction,amount_cents,signed_amount_cents,created_at FROM bank_transactions WHERE owner_id=? AND id=?', owner, tx.id)
      if (old && ((aliases[old.account_id] ?? old.account_id) !== tx.accountId || old.direction !== tx.direction || old.amount_cents !== tx.amount || old.signed_amount_cents !== tx.signedAmount || old.created_at !== tx.createdAt)) throw new Error('Transaction financial identity is immutable')
      const extra = without(tx, ['id', 'accountId', 'direction', 'amount', 'signedAmount', 'counterparty', 'memo', 'category', 'status', 'pendingReason', 'createdAt', 'detail'])
      await run(`INSERT INTO bank_transactions(owner_id,id,account_id,direction,amount_cents,signed_amount_cents,counterparty,memo,category,status,pending_reason,created_at,detail_json,payload_cipher,ordinal,provenance) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(owner_id,id) DO UPDATE SET counterparty=excluded.counterparty,memo=excluded.memo,category=excluded.category,status=excluded.status,pending_reason=excluded.pending_reason,detail_json=excluded.detail_json,payload_cipher=excluded.payload_cipher,ordinal=excluded.ordinal,updated_at=CURRENT_TIMESTAMP`,
        owner, tx.id, tx.accountId, tx.direction, tx.amount, tx.signedAmount, tx.counterparty, tx.memo, tx.category, tx.status, tx.pendingReason ?? null, tx.createdAt,
        cipher.seal(tx.detail ?? null, `transaction-detail:${owner}:${tx.id}`), cipher.seal(extra, `transaction:${owner}:${tx.id}`), ordinal, migrationImport ? 'historical-import' : 'operational-state')
    }
    const existing = original ? [...original.keys()].map(id => ({ id })) : await query('SELECT id FROM bank_transactions WHERE owner_id=?', owner)
    for (const old of existing) if (!ids.has(old.id)) throw new Error(`Cannot remove transaction history: ${old.id}`)
  }
  async function saveCards(owner, cards, secrets) {
    await saveRows('virtual_cards', owner, cards, (card, ordinal) => {
      assertCents(card.dailyLimit, 'card daily limit')
      if (card.issuingFee !== undefined) assertCents(card.issuingFee, 'card issuing fee')
      const core = ['id', 'accountId', 'productName', 'last4', 'cardholder', 'expiry', 'theme', 'network', 'kind', 'status', 'onlinePayment', 'overseasPayment', 'dailyLimit', 'shippingAddress', 'issuingFee']
      return [card.id, card.accountId, card.productName, card.last4, card.cardholder, card.expiry, card.theme, card.network, card.kind, card.status, Number(card.onlinePayment), Number(card.overseasPayment), card.dailyLimit,
        card.shippingAddress === undefined ? null : cipher.seal(card.shippingAddress, `shipping:${owner}:${card.id}`), card.issuingFee ?? null, ordinal, cipher.seal(without(card, core), `card:${owner}:${card.id}`)]
    }, ['id', 'account_id', 'product_name', 'last4', 'cardholder', 'expiry', 'theme', 'network', 'kind', 'status', 'online_payment', 'overseas_payment', 'daily_limit_cents', 'shipping_address_json', 'issuing_fee_cents', 'ordinal', 'payload_cipher'])
    for (const card of cards) {
      if (card.status === 'replaced') { await run('DELETE FROM virtual_card_secrets WHERE owner_id=? AND card_id=?', owner, card.id); continue }
      const secret = secrets[card.id]
      if (secret) await run('INSERT INTO virtual_card_secrets(owner_id,card_id,pan,cvv) VALUES (?,?,?,?) ON CONFLICT(owner_id,card_id) DO UPDATE SET pan=excluded.pan,cvv=excluded.cvv', owner, card.id, cipher.seal(secret.pan, `pan:${owner}:${card.id}`), cipher.seal(secret.cvv, `cvv:${owner}:${card.id}`))
    }
  }
  async function postChanges(changes, requestId) {
    for (const opening of [true, false]) {
      const byCurrency = new Map()
      for (const c of changes.filter(c => c.opening === opening)) { const values = byCurrency.get(c.currency) ?? []; values.push(c); byCurrency.set(c.currency, values) }
      for (const [currency, values] of byCurrency) {
        let volume = 0n
        for (const c of values) volume += BigInt(Math.abs(c.after - c.before))
        if (volume > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Atomic posting volume exceeds safe integer range')
        const batch = randomUUID(), clearing = `${opening ? 'opening' : 'clearing'}:${currency}`
        await run('INSERT INTO ledger_accounts(id,code,name,currency,kind) VALUES (?,?,?,?,?) ON CONFLICT DO NOTHING', clearing, opening ? '3101' : '1101', opening ? 'Imported opening balance offset' : 'Unallocated settlement clearing', currency, opening ? 'equity' : 'asset')
        await run('INSERT INTO journal_batches(id,kind,source,request_id) VALUES (?,?,?,?)', batch, opening ? 'opening' : 'balance-change', opening ? 'Opening balances only; historical activity is not replayed' : 'Atomic account balance changes; clearing requires business reconciliation', requestId)
        let net = 0
        for (const c of values) {
          const delta = c.after - c.before; net += delta
          await run('INSERT INTO journal_entries(batch_id,ledger_account_id,currency,debit_cents,credit_cents) VALUES (?,?,?,?,?)', batch, c.glId, currency, delta < 0 ? -delta : 0, delta > 0 ? delta : 0)
          await run('INSERT INTO balance_changes(batch_id,owner_id,account_id,before_cents,after_cents) VALUES (?,?,?,?,?)', batch, c.owner, c.account, c.before, c.after)
        }
        if (net !== 0) await run('INSERT INTO journal_entries(batch_id,ledger_account_id,currency,debit_cents,credit_cents) VALUES (?,?,?,?,?)', batch, clearing, currency, net > 0 ? net : 0, net < 0 ? -net : 0)
        await run("UPDATE journal_batches SET state='posted' WHERE id=?", batch)
      }
    }
  }
  async function persistEntries(entries, forcedProfiles, requestId = `${migrationImport ? 'migration:' : 'storage:'}${randomUUID()}`) {
    const profiles = forcedProfiles ?? new Map(), bindings = new Map()
    for (const [key, raw] of entries) {
      if (raw === null) { await run('DELETE FROM app_storage WHERE key=?', key); if (PROFILE_KEYS.has(key)) await run('DELETE FROM profile_bindings WHERE storage_key=?', key); continue }
      if (!PROFILE_KEYS.has(key)) { await run('INSERT INTO app_storage(key,value_json) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=CURRENT_TIMESTAMP', key, String(raw)); continue }
      const value = JSON.parse(raw), members = key === CURRENT_KEY ? [['', value]] : Object.entries(value)
      bindings.set(key, members.map(([member, profile], ordinal) => ({ member, owner: profile.user.id, ordinal })))
      if (!forcedProfiles) for (const [, profile] of members) profiles.set(profile.user.id, profile)
    }
    const changes = []
    for (const p of profiles.values()) await saveProfile(p, changes)
    await postChanges(changes, requestId)
    for (const [key, members] of bindings) {
      await run('DELETE FROM profile_bindings WHERE storage_key=?', key)
      const preview = key === CURRENT_KEY ? null : {}
      for (const { member, owner, ordinal } of members) {
        await run('INSERT INTO profile_bindings(storage_key,member_key,owner_id,ordinal) VALUES (?,?,?,?)', key, member, owner, ordinal)
        const row = await get('SELECT name,phone FROM customers WHERE id=?', owner)
        if (preview) preview[member] = { user: { id: owner, name: row.name, phone: row.phone } }
      }
      const current = members[0] ? await get('SELECT id,name,phone FROM customers WHERE id=?', members[0].owner) : null
      await run('INSERT INTO app_storage(key,value_json) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=CURRENT_TIMESTAMP', key, JSON.stringify(preview ?? (current ? { user: current } : null)))
    }
  }
  async function readProfile(owner, original) {
    const customer = await get('SELECT * FROM customers WHERE id=?', owner)
    if (!customer) throw new Error('Profile binding refers to missing customer')
    const result = { user: cipher.open(customer.user_cipher, `customers:${owner}`) }
    for (const table of ['customer_credentials', 'customer_extension_state', ...Object.keys(DOMAINS)]) {
      const row = await get(`SELECT payload_cipher FROM ${table} WHERE owner_id=?`, owner)
      if (row) Object.assign(result, cipher.open(row.payload_cipher, `${table}:${owner}`))
    }
    const accountRows = (await query('SELECT * FROM bank_accounts WHERE owner_id=? ORDER BY ordinal,id', owner)).map(a => ({
      ...cipher.open(a.payload_cipher, `account:${owner}:${a.id}`), id: a.id, accountNo: a.account_no, label: a.label, currency: a.currency, kind: a.kind, balance: a.balance_cents, available: a.available_cents,
    }))
    const stripKind = row => without(row, ['__recordKind'])
    result.accounts = accountRows.filter(row => !row.__recordKind || row.__recordKind === 'funding').map(stripKind)
    if (JSON.parse(customer.profile_fields_json).includes('currencyBalances')) result.currencyBalances = accountRows.filter(row => row.__recordKind === 'currency').map(stripKind)
    if (JSON.parse(customer.profile_fields_json).includes('retiredBalances')) result.retiredBalances = accountRows.filter(row => row.__recordKind === 'retired').map(stripKind)
    const transactionRows = await query('SELECT * FROM bank_transactions WHERE owner_id=? ORDER BY ordinal,id', owner)
    result.transactions = transactionRows.map(t => ({
      ...cipher.open(t.payload_cipher, `transaction:${owner}:${t.id}`), id: t.id, accountId: result.accountAliases?.[t.account_id] ?? t.account_id, direction: t.direction, amount: t.amount_cents, signedAmount: t.signed_amount_cents,
      counterparty: t.counterparty, memo: t.memo, category: t.category, status: t.status, createdAt: t.created_at, detail: cipher.open(t.detail_json, `transaction-detail:${owner}:${t.id}`), ...(t.pending_reason === null ? {} : { pendingReason: t.pending_reason }),
    }))
    if (original) original.transactions = new Map(result.transactions.map((tx, index) => [tx.id, { hash: fingerprint(tx), ordinal: transactionRows[index].ordinal }]))
    result.cards = (await query('SELECT * FROM virtual_cards WHERE owner_id=? ORDER BY ordinal,id', owner)).map(c => ({
      ...cipher.open(c.payload_cipher, `card:${owner}:${c.id}`), id: c.id, accountId: c.account_id, productName: c.product_name, last4: c.last4, cardholder: c.cardholder, expiry: c.expiry, theme: c.theme, network: c.network, kind: c.kind,
      status: c.status, onlinePayment: Boolean(c.online_payment), overseasPayment: Boolean(c.overseas_payment), dailyLimit: c.daily_limit_cents,
      ...(c.shipping_address_json === null ? {} : { shippingAddress: cipher.open(c.shipping_address_json, `shipping:${owner}:${c.id}`) }), ...(c.issuing_fee_cents === null ? {} : { issuingFee: c.issuing_fee_cents }),
    }))
    result.cardSecrets = Object.fromEntries((await query('SELECT * FROM virtual_card_secrets WHERE owner_id=?', owner)).map(s => [s.card_id, { pan: cipher.open(s.pan, `pan:${owner}:${s.card_id}`), cvv: cipher.open(s.cvv, `cvv:${owner}:${s.card_id}`) }]))
    for (const [field, table, context] of [['payees', 'bank_payees', 'payee'], ['autoDebits', 'payment_mandates', 'mandate'], ['fpsRegistrations', 'fps_registrations', 'fps']]) result[field] = (await query(`SELECT id,payload_cipher FROM ${table} WHERE owner_id=? ORDER BY ordinal,id`, owner)).map(r => cipher.open(r.payload_cipher, `${context}:${owner}:${r.id}`))
    const fields = new Set([...JSON.parse(customer.profile_fields_json), 'cards', 'cardSecrets'])
    return Object.fromEntries(Object.entries(result).filter(([key]) => fields.has(key)))
  }
  async function hydrate() {
    const entries = new Map((await query('SELECT key,value_json FROM app_storage')).map(row => [row.key, row.value_json]))
    const profiles = new Map()
    for (const row of await query('SELECT id FROM customers ORDER BY id')) profiles.set(row.id, await readProfile(row.id))
    for (const key of PROFILE_KEYS) {
      if (!entries.has(key)) continue
      const bindings = await query('SELECT member_key,owner_id FROM profile_bindings WHERE storage_key=? ORDER BY ordinal', key)
      entries.set(key, JSON.stringify(key === CURRENT_KEY ? bindings.length ? profiles.get(bindings[0].owner_id) : null : Object.fromEntries(bindings.map(row => [row.member_key, profiles.get(row.owner_id)]))))
    }
    return entries
  }
  function activeBuffer() { return pending ?? staged }
  function stage(key, raw) {
    const work = activeBuffer(), value = raw === null ? null : String(raw)
    if (value !== null && PROFILE_KEYS.has(key)) {
      const parsed = JSON.parse(value), profiles = key === CURRENT_KEY ? [parsed] : Object.values(parsed)
      for (const profile of profiles) { requireText(profile?.user?.id, 'customer id'); work.profiles.set(profile.user.id, profile) }
    }
    work.entries.delete(key); work.entries.set(key, value)
  }
  function readMemory(key) {
    const work = activeBuffer(), raw = work.entries.has(key) ? work.entries.get(key) : committed.get(key) ?? null
    if (raw === null || !PROFILE_KEYS.has(key)) return raw
    const value = JSON.parse(raw)
    if (key === CURRENT_KEY) return value?.user?.id ? JSON.stringify(work.profiles.get(value.user.id) ?? value) : raw
    return JSON.stringify(Object.fromEntries(Object.entries(value).map(([member, p]) => [member, work.profiles.get(p.user.id) ?? p])))
  }
  const storage = {
    getItem: readMemory,
    setItem: stage,
    setItemsAtomically(entries) { for (const [key, raw] of entries) stage(key, raw) },
    removeItem(key) { stage(key, null) },
    clear() { throw new Error('Financial records cannot be cleared; use an isolated PostgreSQL database') },
    hasPendingWrites() { return Boolean(pending || staged.entries.size) },
    async beginUnitOfWork({ requestId = randomUUID(), historicalImport = false } = {}) {
      if (pending || starting) throw new Error('A database unit of work is already active')
      requireText(requestId, 'request id')
      if (requestId.length > 200) throw new Error('Request id is too long')
      starting = true
      try {
        await db.begin()
        // The synchronous legacy projection remains serialized across processes.
        await db.query('SELECT pg_advisory_xact_lock(782614101)')
        committed = await hydrate()
        pending = { entries: staged.entries, profiles: staged.profiles, requestId, baseline: new Map(committed) }
        staged = { entries: new Map(), profiles: new Map() }
        migrationImport = historicalImport
      } catch (error) { await db.rollback(); throw error } finally { starting = false }
    },
    async commitUnitOfWork() {
      if (!pending) throw new Error('No database unit of work is active')
      const work = pending
      try {
        await persistEntries(work.entries, work.profiles, work.requestId)
        const snapshot = await hydrate()
        await db.commit()
        committed = snapshot; pending = null; migrationImport = false
      } catch (error) { await db.rollback(); committed = work.baseline; pending = null; migrationImport = false; throw error }
    },
    async rollbackUnitOfWork() {
      if (!pending) return
      const work = pending
      try { await db.rollback() } finally { committed = work.baseline; pending = null; migrationImport = false }
    },
    async flush({ requestId } = {}) {
      if (pending) throw new Error('Commit the active unit of work instead of flushing')
      if (!staged.entries.size) return
      await storage.beginUnitOfWork({ requestId })
      await storage.commitUnitOfWork()
    },
    async refresh() {
      if (pending || staged.entries.size) throw new Error('Cannot refresh while profile writes are pending')
      committed = await db.transaction(hydrate)
    },
  }
  const runtimeStorage = settings.profileProjection === 'scoped'
    ? await createScopedProfileStorage({ db, query, get, run, readProfile, saveProfile, postChanges,
      openCardPan: row => cipher.open(row.pan, `pan:${row.owner_id}:${row.card_id}`), currentKey: CURRENT_KEY, profilesKey: PROFILES_KEY })
    : storage
  return { db, storage: runtimeStorage, migrationBackup: null, async close() {
    const unflushed = settings.profileProjection === 'scoped' ? false : staged.entries.size
    await runtimeStorage.rollbackUnitOfWork()
    await db.close()
    if (unflushed) throw new Error('Unflushed profile writes: call storage.flush() before closing')
  } }
}

/** PostgreSQL constraints validate references and exact accounting at commit. */
export async function reconcileDatabase(db) {
  return db.transaction(async () => {
    const unbalancedBatches = (await db.query('SELECT * FROM ledger_batch_totals WHERE debit_cents<>credit_cents')).rows
    const unpostedBatches = (await db.query("SELECT id FROM journal_batches WHERE state<>'posted'")).rows
    const accountMismatches = (await db.query(`SELECT a.owner_id,a.id,a.balance_cents,COALESCE(SUM(e.credit_cents-e.debit_cents),0) AS ledger_cents FROM bank_accounts a LEFT JOIN ledger_accounts l ON l.owner_id=a.owner_id AND l.account_id=a.id LEFT JOIN journal_entries e ON e.ledger_account_id=l.id GROUP BY a.owner_id,a.id HAVING a.balance_cents<>COALESCE(SUM(e.credit_cents-e.debit_cents),0)`)).rows
    const historicalActivity = (await db.query("SELECT COUNT(*) AS count FROM bank_transactions WHERE provenance='historical-import'")).rows[0].count
    const clearingBalances = (await db.query(`SELECT l.id,l.code,l.currency,COALESCE(SUM(e.debit_cents-e.credit_cents),0) AS balance_cents FROM ledger_accounts l LEFT JOIN journal_entries e ON e.ledger_account_id=l.id WHERE l.code='1101' GROUP BY l.id ORDER BY l.currency`)).rows
    const foreignKeys = (await db.query("SELECT conname AS name FROM pg_constraint WHERE connamespace=current_schema()::regnamespace AND contype='f' AND NOT convalidated")).rows
    const ok = !unbalancedBatches.length && !unpostedBatches.length && !accountMismatches.length && !foreignKeys.length
    return { ok, database: 'postgresql', integrity: ['PostgreSQL constraints'], foreignKeys, unbalancedBatches, unpostedBatches, accountMismatches, clearingBalances, historicalActivity,
      historicalActivityNote: 'Imported activity is preserved separately. Historical journals are retained by migration; profile imports post opening balances only. External clearing requires partner confirmation.' }
  }, { isolationLevel: 'REPEATABLE READ', readOnly: true })
}
