import { DatabaseSync } from 'node:sqlite'
import { existsSync, readFileSync } from 'node:fs'

// storage.ts prepends `luckycat.`; the profile key itself already starts with it.
const CURRENT_KEY = 'luckycat.mock.db'
const PROFILES_KEY = 'luckycat.luckycat.mock.user-profiles.v1'
const PROFILE_KEYS = new Set([CURRENT_KEY, PROFILES_KEY])

/** SQLite stores the demo profile snapshots and owns the virtual card records. */
export function openBankDatabase(path, legacyStateFile) {
  const db = new DatabaseSync(path)
  // Early demo builds keyed cards by phone. Migrate to the stable user id so a
  // phone change does not orphan cards. This also upgrades an existing demo DB.
  const oldColumns = db.prepare('PRAGMA table_info(virtual_cards)').all()
  if (oldColumns.some((column) => column.name === 'owner_phone')) {
    const idByPhone = new Map()
    const savedProfiles = db.prepare('SELECT value_json FROM app_storage WHERE key = ?').get(PROFILES_KEY)
    if (savedProfiles) {
      for (const [phone, profile] of Object.entries(JSON.parse(savedProfiles.value_json))) {
        idByPhone.set(phone, profile.user.id)
      }
    }
    const current = db.prepare('SELECT value_json FROM app_storage WHERE key = ?').get(CURRENT_KEY)
    if (current) {
      const profile = JSON.parse(current.value_json)
      idByPhone.set(profile.user.phone, profile.user.id)
    }
    db.exec('PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE')
    try {
      db.exec('ALTER TABLE virtual_cards RENAME COLUMN owner_phone TO owner_id')
      db.exec('ALTER TABLE virtual_card_secrets RENAME COLUMN owner_phone TO owner_id')
      const updateCards = db.prepare('UPDATE virtual_cards SET owner_id = ? WHERE owner_id = ?')
      const updateSecrets = db.prepare('UPDATE virtual_card_secrets SET owner_id = ? WHERE owner_id = ?')
      for (const [phone, id] of idByPhone) {
        updateCards.run(id, phone)
        updateSecrets.run(id, phone)
      }
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    } finally {
      db.exec('PRAGMA foreign_keys = ON')
    }
  }
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS app_storage (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS virtual_cards (
      id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      product_name TEXT NOT NULL,
      last4 TEXT NOT NULL,
      cardholder TEXT NOT NULL,
      expiry TEXT NOT NULL,
      theme TEXT NOT NULL CHECK (theme IN ('ink', 'gold')),
      network TEXT NOT NULL CHECK (network IN ('visa', 'unionpay')),
      kind TEXT NOT NULL CHECK (kind IN ('debit', 'credit')),
      status TEXT NOT NULL CHECK (status IN ('active', 'locked', 'pending', 'replaced')),
      online_payment INTEGER NOT NULL CHECK (online_payment IN (0, 1)),
      overseas_payment INTEGER NOT NULL CHECK (overseas_payment IN (0, 1)),
      daily_limit_cents INTEGER NOT NULL CHECK (daily_limit_cents >= 0),
      shipping_address_json TEXT,
      issuing_fee_cents INTEGER,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (owner_id, id)
    );
    CREATE INDEX IF NOT EXISTS idx_virtual_cards_owner ON virtual_cards(owner_id);
    CREATE TABLE IF NOT EXISTS virtual_card_secrets (
      owner_id TEXT NOT NULL,
      card_id TEXT NOT NULL,
      pan TEXT NOT NULL,
      cvv TEXT NOT NULL,
      PRIMARY KEY (owner_id, card_id),
      FOREIGN KEY (owner_id, card_id)
        REFERENCES virtual_cards(owner_id, id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS bank_accounts (
      owner_id TEXT NOT NULL,
      id TEXT NOT NULL,
      account_no TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      currency TEXT NOT NULL,
      balance_cents INTEGER NOT NULL CHECK (balance_cents >= 0),
      available_cents INTEGER NOT NULL CHECK (available_cents >= 0),
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (owner_id, id)
    );
    CREATE TABLE IF NOT EXISTS bank_transactions (
      owner_id TEXT NOT NULL,
      id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
      amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
      signed_amount_cents INTEGER NOT NULL,
      counterparty TEXT NOT NULL,
      memo TEXT NOT NULL,
      category TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('success', 'pending', 'failed')),
      created_at TEXT NOT NULL,
      detail_json TEXT NOT NULL,
      PRIMARY KEY (owner_id, id),
      FOREIGN KEY (owner_id, account_id) REFERENCES bank_accounts(owner_id, id)
    );
    CREATE INDEX IF NOT EXISTS idx_bank_transactions_account_time
      ON bank_transactions(owner_id, account_id, created_at DESC);
  `)

  const getValue = db.prepare('SELECT value_json FROM app_storage WHERE key = ?')
  const putValue = db.prepare(`
    INSERT INTO app_storage(key, value_json) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = CURRENT_TIMESTAMP
  `)
  const removeValue = db.prepare('DELETE FROM app_storage WHERE key = ?')
  const cardsForOwner = db.prepare('SELECT * FROM virtual_cards WHERE owner_id = ? ORDER BY rowid')
  const secretsForOwner = db.prepare(`
    SELECT card_id, pan, cvv FROM virtual_card_secrets WHERE owner_id = ?
  `)
  const putCard = db.prepare(`
    INSERT INTO virtual_cards (
      id, owner_id, account_id, product_name, last4, cardholder, expiry,
      theme, network, kind, status, online_payment, overseas_payment,
      daily_limit_cents, shipping_address_json, issuing_fee_cents
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(owner_id, id) DO UPDATE SET
      account_id = excluded.account_id,
      product_name = excluded.product_name, last4 = excluded.last4,
      cardholder = excluded.cardholder, expiry = excluded.expiry,
      theme = excluded.theme, network = excluded.network, kind = excluded.kind,
      status = excluded.status, online_payment = excluded.online_payment,
      overseas_payment = excluded.overseas_payment,
      daily_limit_cents = excluded.daily_limit_cents,
      shipping_address_json = excluded.shipping_address_json,
      issuing_fee_cents = excluded.issuing_fee_cents, updated_at = CURRENT_TIMESTAMP
  `)
  const putSecret = db.prepare(`
    INSERT INTO virtual_card_secrets(owner_id, card_id, pan, cvv) VALUES (?, ?, ?, ?)
    ON CONFLICT(owner_id, card_id) DO UPDATE SET pan = excluded.pan, cvv = excluded.cvv
  `)
  const deleteSecret = db.prepare('DELETE FROM virtual_card_secrets WHERE owner_id = ? AND card_id = ?')
  const deleteCard = db.prepare('DELETE FROM virtual_cards WHERE id = ? AND owner_id = ?')
  const deleteTransactions = db.prepare('DELETE FROM bank_transactions WHERE owner_id = ?')
  const deleteAccounts = db.prepare('DELETE FROM bank_accounts WHERE owner_id = ?')
  const putAccount = db.prepare(`INSERT INTO bank_accounts
    (owner_id, id, account_no, label, currency, balance_cents, available_cents)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
  const putTransaction = db.prepare(`INSERT INTO bank_transactions
    (owner_id, id, account_id, direction, amount_cents, signed_amount_cents,
     counterparty, memo, category, status, created_at, detail_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)

  function withTransaction(work) {
    db.exec('BEGIN IMMEDIATE')
    try {
      const result = work()
      db.exec('COMMIT')
      return result
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  function saveCards(profile) {
    const owner = profile?.user?.id
    if (!owner || !Array.isArray(profile.cards)) return
    const ids = new Set()
    for (const card of profile.cards) {
      if (ids.has(card.id)) throw new Error(`重复卡片 id：${card.id}`)
      ids.add(card.id)
      putCard.run(
        card.id, owner, card.accountId, card.productName, card.last4,
        card.cardholder, card.expiry, card.theme, card.network, card.kind,
        card.status, Number(card.onlinePayment), Number(card.overseasPayment),
        card.dailyLimit, card.shippingAddress === undefined ? null : JSON.stringify(card.shippingAddress),
        card.issuingFee ?? null,
      )
      const secret = profile.cardSecrets?.[card.id]
      if (card.status === 'replaced') deleteSecret.run(owner, card.id)
      else if (secret) putSecret.run(owner, card.id, secret.pan, secret.cvv)
    }
    for (const existing of cardsForOwner.all(owner)) {
      if (!ids.has(existing.id)) deleteCard.run(existing.id, owner)
    }
  }

  function saveLedger(profile) {
    const owner = profile?.user?.id
    if (!owner || !Array.isArray(profile.accounts) || !Array.isArray(profile.transactions)) return
    deleteTransactions.run(owner)
    deleteAccounts.run(owner)
    for (const account of profile.accounts) {
      putAccount.run(owner, account.id, account.accountNo, account.label,
        account.currency, account.balance, account.available)
    }
    for (const tx of profile.transactions) {
      putTransaction.run(owner, tx.id, tx.accountId, tx.direction, tx.amount,
        tx.signedAmount, tx.counterparty, tx.memo, tx.category, tx.status,
        tx.createdAt, JSON.stringify(tx.detail))
    }
  }

  // Earlier builds could restart their in-memory id counter and reuse a tx id.
  // Preserve every historical row while assigning a stable unique id to later copies.
  function normalizeLegacyTransactionIds(profile) {
    if (!Array.isArray(profile?.transactions)) return
    const used = new Set()
    for (const [index, tx] of profile.transactions.entries()) {
      if (used.has(tx.id)) {
        const original = tx.id
        let replacement = `${original}_legacy_${index}`
        while (used.has(replacement)) replacement += '_x'
        tx.id = replacement
        if (tx.detail) tx.detail.referenceNo = `LEGACY-${profile.user.id}-${index}`
      }
      used.add(tx.id)
    }
  }

  function hydrate(profile) {
    const owner = profile?.user?.id
    if (!owner) return profile
    profile.cards = cardsForOwner.all(owner).map((card) => ({
      id: card.id,
      accountId: card.account_id,
      productName: card.product_name,
      last4: card.last4,
      cardholder: card.cardholder,
      expiry: card.expiry,
      theme: card.theme,
      network: card.network,
      kind: card.kind,
      status: card.status,
      onlinePayment: Boolean(card.online_payment),
      overseasPayment: Boolean(card.overseas_payment),
      dailyLimit: card.daily_limit_cents,
      ...(card.shipping_address_json ? { shippingAddress: JSON.parse(card.shipping_address_json) } : {}),
      ...(card.issuing_fee_cents === null ? {} : { issuingFee: card.issuing_fee_cents }),
    }))
    profile.cardSecrets = Object.fromEntries(
      secretsForOwner.all(owner).map((secret) => [secret.card_id, { pan: secret.pan, cvv: secret.cvv }]),
    )
    return profile
  }

  function stripCards(profile) {
    const { cards, cardSecrets, ...rest } = profile
    return rest
  }

  function saveItemRaw(key, raw) {
    if (!PROFILE_KEYS.has(key)) {
      putValue.run(key, String(raw))
      return
    }
    const value = JSON.parse(raw)
    if (key === CURRENT_KEY) {
      normalizeLegacyTransactionIds(value)
      saveCards(value)
      saveLedger(value)
      putValue.run(key, JSON.stringify(stripCards(value)))
    } else {
      const stripped = {}
      for (const [phone, profile] of Object.entries(value)) {
        normalizeLegacyTransactionIds(profile)
        saveCards(profile)
        saveLedger(profile)
        stripped[phone] = stripCards(profile)
      }
      putValue.run(key, JSON.stringify(stripped))
    }
  }

  const storage = {
    getItem(key) {
      const row = getValue.get(key)
      if (!row) return null
      if (!PROFILE_KEYS.has(key)) return row.value_json
      const value = JSON.parse(row.value_json)
      if (key === CURRENT_KEY) return JSON.stringify(hydrate(value))
      return JSON.stringify(Object.fromEntries(
        Object.entries(value).map(([phone, profile]) => [phone, hydrate(profile)]),
      ))
    },
    setItem(key, raw) {
      withTransaction(() => saveItemRaw(key, raw))
    },
    setItemsAtomically(entries) {
      withTransaction(() => {
        for (const [key, raw] of entries) saveItemRaw(key, raw)
      })
    },
    removeItem(key) { removeValue.run(key) },
    clear() {
      withTransaction(() => {
        db.exec('DELETE FROM virtual_cards; DELETE FROM bank_transactions; DELETE FROM bank_accounts; DELETE FROM app_storage;')
      })
    },
  }

  // One-time import from the previous JSON-backed demo server.
  if (!getValue.get(CURRENT_KEY) && legacyStateFile && existsSync(legacyStateFile)) {
    const legacy = JSON.parse(readFileSync(legacyStateFile, 'utf8'))
    for (const [key, value] of Object.entries(legacy)) storage.setItem(key, value)
  }

  // Earlier SQLite builds left card arrays inside the profile snapshot. Import
  // them once into the card tables, then keep only non-card state in app_storage.
  const savedProfiles = getValue.get(PROFILES_KEY)
  if (savedProfiles && Object.values(JSON.parse(savedProfiles.value_json))
    .some((profile) => Array.isArray(profile.cards))) {
    storage.setItem(PROFILES_KEY, savedProfiles.value_json)
  }

  // Existing demo files predate the queryable account and transaction tables.
  if (db.prepare('SELECT count(*) AS n FROM bank_accounts').get().n === 0) {
    const snapshots = [CURRENT_KEY, PROFILES_KEY]
      .map((key) => [key, storage.getItem(key)])
      .filter(([, value]) => value !== null)
    if (snapshots.length) storage.setItemsAtomically(snapshots)
  }

  return { db, storage, close: () => db.close() }
}
