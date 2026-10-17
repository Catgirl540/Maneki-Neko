-- Core v2: integer minor units; single SQLite writer; no claim of bank certification.
CREATE TABLE IF NOT EXISTS bank_schema_migrations (
  version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS app_storage (
  key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY, phone TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  user_cipher TEXT NOT NULL, profile_fields_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS customer_credentials (
  owner_id TEXT PRIMARY KEY REFERENCES customers(id), payload_cipher TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS profile_bindings (
  storage_key TEXT NOT NULL, member_key TEXT NOT NULL, owner_id TEXT NOT NULL REFERENCES customers(id),
  ordinal INTEGER NOT NULL, PRIMARY KEY(storage_key, member_key)
);
CREATE TABLE IF NOT EXISTS bank_accounts (
  owner_id TEXT NOT NULL REFERENCES customers(id), id TEXT NOT NULL, account_no TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL, currency TEXT NOT NULL CHECK(currency IN ('CNY','HKD','USD')),
  kind TEXT NOT NULL, balance_cents INTEGER NOT NULL CHECK(typeof(balance_cents)='integer' AND balance_cents BETWEEN 0 AND 9007199254740991),
  available_cents INTEGER NOT NULL CHECK(typeof(available_cents)='integer' AND available_cents BETWEEN 0 AND balance_cents),
  ordinal INTEGER NOT NULL, payload_cipher TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(owner_id,id)
);
CREATE TABLE IF NOT EXISTS bank_transactions (
  owner_id TEXT NOT NULL REFERENCES customers(id), id TEXT NOT NULL, account_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK(direction IN ('in','out')),
  amount_cents INTEGER NOT NULL CHECK(typeof(amount_cents)='integer' AND amount_cents BETWEEN 1 AND 9007199254740991),
  signed_amount_cents INTEGER NOT NULL CHECK(typeof(signed_amount_cents)='integer' AND signed_amount_cents = CASE direction WHEN 'in' THEN amount_cents ELSE -amount_cents END),
  counterparty TEXT NOT NULL, memo TEXT NOT NULL, category TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('success','pending','failed')), pending_reason TEXT, created_at TEXT NOT NULL,
  detail_json TEXT NOT NULL, payload_cipher TEXT NOT NULL, ordinal INTEGER NOT NULL,
  provenance TEXT NOT NULL CHECK(provenance IN ('historical-import','operational-state')),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(owner_id,id), FOREIGN KEY(owner_id,account_id) REFERENCES bank_accounts(owner_id,id)
);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_account_time ON bank_transactions(owner_id,account_id,created_at DESC);
CREATE TABLE IF NOT EXISTS virtual_cards (
  owner_id TEXT NOT NULL REFERENCES customers(id), id TEXT NOT NULL, account_id TEXT NOT NULL,
  product_name TEXT NOT NULL, last4 TEXT NOT NULL, cardholder TEXT NOT NULL, expiry TEXT NOT NULL,
  theme TEXT NOT NULL CHECK(theme IN ('ink','gold')), network TEXT NOT NULL CHECK(network IN ('visa','unionpay')),
  kind TEXT NOT NULL CHECK(kind IN ('debit','credit')),
  status TEXT NOT NULL CHECK(status IN ('active','locked','pending','replaced')),
  online_payment INTEGER NOT NULL CHECK(online_payment IN (0,1)), overseas_payment INTEGER NOT NULL CHECK(overseas_payment IN (0,1)),
  daily_limit_cents INTEGER NOT NULL CHECK(typeof(daily_limit_cents)='integer' AND daily_limit_cents BETWEEN 0 AND 9007199254740991),
  shipping_address_json TEXT, issuing_fee_cents INTEGER CHECK(issuing_fee_cents IS NULL OR (typeof(issuing_fee_cents)='integer' AND issuing_fee_cents BETWEEN 0 AND 9007199254740991)),
  ordinal INTEGER NOT NULL, payload_cipher TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(owner_id,id), FOREIGN KEY(owner_id,account_id) REFERENCES bank_accounts(owner_id,id)
);
CREATE INDEX IF NOT EXISTS idx_virtual_cards_owner ON virtual_cards(owner_id);
CREATE TABLE IF NOT EXISTS virtual_card_secrets (
  owner_id TEXT NOT NULL, card_id TEXT NOT NULL, pan TEXT NOT NULL, cvv TEXT NOT NULL,
  PRIMARY KEY(owner_id,card_id), FOREIGN KEY(owner_id,card_id) REFERENCES virtual_cards(owner_id,id)
);
CREATE TABLE IF NOT EXISTS bank_payees (
  owner_id TEXT NOT NULL REFERENCES customers(id), id TEXT NOT NULL, bank_code TEXT, bank_region TEXT,
  ordinal INTEGER NOT NULL, payload_cipher TEXT NOT NULL, PRIMARY KEY(owner_id,id)
);
CREATE TABLE IF NOT EXISTS payment_mandates (
  owner_id TEXT NOT NULL REFERENCES customers(id), id TEXT NOT NULL, ordinal INTEGER NOT NULL,
  payload_cipher TEXT NOT NULL, PRIMARY KEY(owner_id,id)
);
CREATE TABLE IF NOT EXISTS fps_registrations (
  owner_id TEXT NOT NULL REFERENCES customers(id), id TEXT NOT NULL, account_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL, payload_cipher TEXT NOT NULL, PRIMARY KEY(owner_id,id),
  FOREIGN KEY(owner_id,account_id) REFERENCES bank_accounts(owner_id,id)
);
CREATE TABLE IF NOT EXISTS ledger_accounts (
  id TEXT PRIMARY KEY, code TEXT NOT NULL, name TEXT NOT NULL, currency TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('asset','liability','equity')),
  owner_id TEXT, account_id TEXT,
  UNIQUE(owner_id,account_id), FOREIGN KEY(owner_id,account_id) REFERENCES bank_accounts(owner_id,id)
);
CREATE TABLE IF NOT EXISTS journal_batches (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('opening','balance-change')),
  source TEXT NOT NULL, request_id TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','posted')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS journal_entries (
  id INTEGER PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES journal_batches(id),
  ledger_account_id TEXT NOT NULL REFERENCES ledger_accounts(id), currency TEXT NOT NULL,
  debit_cents INTEGER NOT NULL CHECK(typeof(debit_cents)='integer' AND debit_cents BETWEEN 0 AND 9007199254740991),
  credit_cents INTEGER NOT NULL CHECK(typeof(credit_cents)='integer' AND credit_cents BETWEEN 0 AND 9007199254740991),
  CHECK((debit_cents > 0 AND credit_cents = 0) OR (credit_cents > 0 AND debit_cents = 0))
);
CREATE INDEX IF NOT EXISTS idx_journal_entries_account ON journal_entries(ledger_account_id,batch_id);
CREATE TABLE IF NOT EXISTS balance_changes (
  id INTEGER PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES journal_batches(id),
  owner_id TEXT NOT NULL, account_id TEXT NOT NULL, before_cents INTEGER NOT NULL, after_cents INTEGER NOT NULL,
  FOREIGN KEY(owner_id,account_id) REFERENCES bank_accounts(owner_id,id), UNIQUE(batch_id,owner_id,account_id)
);
CREATE TRIGGER IF NOT EXISTS journal_entries_insert_guard BEFORE INSERT ON journal_entries BEGIN
  SELECT CASE WHEN (SELECT state FROM journal_batches WHERE id=NEW.batch_id) <> 'draft' THEN RAISE(ABORT,'posted journal is immutable') END;
  SELECT CASE WHEN (SELECT currency FROM ledger_accounts WHERE id=NEW.ledger_account_id) <> NEW.currency THEN RAISE(ABORT,'journal currency mismatch') END;
END;
CREATE TRIGGER IF NOT EXISTS journal_batches_insert_guard BEFORE INSERT ON journal_batches WHEN NEW.state<>'draft' BEGIN SELECT RAISE(ABORT,'journal must be posted after entries are balanced'); END;
CREATE TRIGGER IF NOT EXISTS journal_entries_no_update BEFORE UPDATE ON journal_entries BEGIN SELECT RAISE(ABORT,'journal entries are immutable'); END;
CREATE TRIGGER IF NOT EXISTS journal_entries_no_delete BEFORE DELETE ON journal_entries BEGIN SELECT RAISE(ABORT,'journal entries are immutable'); END;
CREATE TRIGGER IF NOT EXISTS journal_batches_post_guard BEFORE UPDATE OF state ON journal_batches WHEN NEW.state='posted' BEGIN
  SELECT CASE WHEN (SELECT COUNT(*) FROM journal_entries WHERE batch_id=NEW.id)<2 THEN RAISE(ABORT,'journal requires two entries') END;
  SELECT CASE WHEN EXISTS(SELECT currency FROM journal_entries WHERE batch_id=NEW.id GROUP BY currency HAVING SUM(debit_cents)<>SUM(credit_cents)) THEN RAISE(ABORT,'journal is unbalanced') END;
END;
CREATE TRIGGER IF NOT EXISTS journal_batches_no_update BEFORE UPDATE ON journal_batches WHEN OLD.state='posted' BEGIN SELECT RAISE(ABORT,'posted journal is immutable'); END;
CREATE TRIGGER IF NOT EXISTS journal_batches_no_delete BEFORE DELETE ON journal_batches BEGIN SELECT RAISE(ABORT,'journal is immutable'); END;
CREATE TRIGGER IF NOT EXISTS balance_changes_no_update BEFORE UPDATE ON balance_changes BEGIN SELECT RAISE(ABORT,'balance changes are immutable'); END;
CREATE TRIGGER IF NOT EXISTS balance_changes_no_delete BEFORE DELETE ON balance_changes BEGIN SELECT RAISE(ABORT,'balance changes are immutable'); END;
CREATE TRIGGER IF NOT EXISTS balance_changes_insert_guard BEFORE INSERT ON balance_changes BEGIN
  SELECT CASE WHEN (SELECT state FROM journal_batches WHERE id=NEW.batch_id)<>'draft' THEN RAISE(ABORT,'posted journal is immutable') END;
END;
CREATE TRIGGER IF NOT EXISTS ledger_accounts_no_update BEFORE UPDATE ON ledger_accounts BEGIN SELECT RAISE(ABORT,'ledger accounts are immutable'); END;
CREATE TRIGGER IF NOT EXISTS ledger_accounts_no_delete BEFORE DELETE ON ledger_accounts BEGIN SELECT RAISE(ABORT,'ledger accounts are immutable'); END;
CREATE TRIGGER IF NOT EXISTS bank_transactions_no_delete BEFORE DELETE ON bank_transactions BEGIN SELECT RAISE(ABORT,'transaction history cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS bank_accounts_no_delete BEFORE DELETE ON bank_accounts BEGIN SELECT RAISE(ABORT,'accounts cannot be deleted'); END;
CREATE VIEW IF NOT EXISTS ledger_batch_totals AS
 SELECT batch_id,currency,SUM(debit_cents) AS debit_cents,SUM(credit_cents) AS credit_cents
 FROM journal_entries GROUP BY batch_id,currency;
