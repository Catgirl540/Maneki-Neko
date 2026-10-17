-- Bank-hosted funds platform. A bank receipt is evidence; a local intention is not settlement.
CREATE SCHEMA IF NOT EXISTS banking;
CREATE SCHEMA IF NOT EXISTS accounting;
CREATE SCHEMA IF NOT EXISTS regulatory;
CREATE TABLE IF NOT EXISTS banking.schema_migrations (
  version bigint PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS banking.providers (
  lock_version bigint NOT NULL DEFAULT 0 CHECK(lock_version=0),
  id uuid PRIMARY KEY, name text NOT NULL, driver text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('test','production')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','suspended')),
  license_reference text, contract_evidence_sha256 text,
  reviewed_by text, approved_by text, approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'approved' OR (license_reference IS NOT NULL AND contract_evidence_sha256 IS NOT NULL AND contract_evidence_sha256 ~ '^[a-f0-9]{64}$'
    AND reviewed_by IS NOT NULL AND approved_by IS NOT NULL AND reviewed_by <> approved_by AND approved_at IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS banking.release_gates (
  lock_version bigint NOT NULL DEFAULT 0 CHECK(lock_version=0),
  provider_id uuid NOT NULL REFERENCES banking.providers(id), gate text NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','passed','failed')),
  evidence_sha256 text, reviewed_by text, approved_by text, verified_at timestamptz, expires_at timestamptz,
  PRIMARY KEY(provider_id,gate),
  CHECK (gate IN ('bank_contract','production_api','receipt_authentication','strong_customer_authentication',
    'bank_uat','trusted_https','backup_restore','incident_response','privacy_review')),
  CHECK (state <> 'passed' OR (evidence_sha256 IS NOT NULL AND evidence_sha256 ~ '^[a-f0-9]{64}$' AND reviewed_by IS NOT NULL
    AND approved_by IS NOT NULL AND reviewed_by <> approved_by AND verified_at IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS banking.account_links (
  lock_version bigint NOT NULL DEFAULT 0 CHECK(lock_version=0),
  id uuid PRIMARY KEY, owner_id text NOT NULL REFERENCES customers(id),
  provider_id uuid NOT NULL REFERENCES banking.providers(id), bank_account_hash text NOT NULL,
  bank_reference_cipher text NOT NULL, masked_account text NOT NULL,
  label text NOT NULL, currency char(3) NOT NULL CHECK (currency='CNY'),
  state text NOT NULL CHECK (state IN ('pending','active','suspended','closed')),
  bank_balance_cents bigint CHECK (bank_balance_cents BETWEEN 0 AND 9007199254740991),
  bank_available_cents bigint CHECK (bank_available_cents BETWEEN 0 AND 9007199254740991),
  bank_sequence bigint, balance_observed_at timestamptz, verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(provider_id,bank_account_hash),
  UNIQUE(id,owner_id,provider_id), CHECK (state <> 'active' OR verified_at IS NOT NULL),
  CHECK ((bank_balance_cents IS NULL) = (bank_available_cents IS NULL))
);
CREATE TABLE IF NOT EXISTS banking.consents (
  lock_version bigint NOT NULL DEFAULT 0 CHECK(lock_version=0),
  id uuid PRIMARY KEY, owner_id text NOT NULL REFERENCES customers(id), provider_id uuid NOT NULL REFERENCES banking.providers(id),
  account_link_id uuid NOT NULL, scopes text[] NOT NULL,
  bank_authorization_cipher text NOT NULL, proof_sha256 text NOT NULL CHECK (proof_sha256 ~ '^[a-f0-9]{64}$'),
  granted_at timestamptz NOT NULL, expires_at timestamptz NOT NULL, revoked_at timestamptz,
  FOREIGN KEY(account_link_id,owner_id,provider_id) REFERENCES banking.account_links(id,owner_id,provider_id),
  UNIQUE(id,owner_id,provider_id,account_link_id),
  CHECK (expires_at > granted_at), CHECK (cardinality(scopes)>0),
  CHECK (scopes <@ ARRAY['accounts:read','transactions:read','payments:initiate']::text[])
);
CREATE TABLE IF NOT EXISTS banking.payment_intents (
  lock_version bigint NOT NULL DEFAULT 0 CHECK(lock_version=0),
  id uuid PRIMARY KEY, owner_id text NOT NULL REFERENCES customers(id), provider_id uuid NOT NULL REFERENCES banking.providers(id),
  source_account_id uuid NOT NULL, consent_id uuid NOT NULL REFERENCES banking.consents(id),
  idempotency_key text NOT NULL, request_sha256 text NOT NULL, payee_cipher text NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents BETWEEN 1 AND 9007199254740991),
  currency char(3) NOT NULL CHECK (currency='CNY'),
  status text NOT NULL DEFAULT 'awaiting_authorization' CHECK (status IN ('awaiting_authorization','queued','submitting','bank_pending','unknown','succeeded','rejected','cancelled')),
  bank_payment_reference text, bank_authorization_reference text, authorization_verified_at timestamptz,
  bank_settled_at timestamptz, final_receipt_id uuid, authorization_receipt_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id,idempotency_key), UNIQUE(provider_id,bank_payment_reference), UNIQUE(provider_id,bank_authorization_reference),
  FOREIGN KEY(consent_id,owner_id,provider_id,source_account_id) REFERENCES banking.consents(id,owner_id,provider_id,account_link_id),
  FOREIGN KEY(source_account_id,owner_id,provider_id) REFERENCES banking.account_links(id,owner_id,provider_id),
  CHECK (status IN ('awaiting_authorization','cancelled','rejected') OR (authorization_verified_at IS NOT NULL AND bank_authorization_reference IS NOT NULL AND authorization_receipt_id IS NOT NULL)),
  CHECK (status <> 'succeeded' OR (final_receipt_id IS NOT NULL AND bank_settled_at IS NOT NULL AND bank_payment_reference IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS banking.outbox (
  id uuid PRIMARY KEY, payment_id uuid NOT NULL UNIQUE REFERENCES banking.payment_intents(id),
  state text NOT NULL DEFAULT 'ready' CHECK (state IN ('ready','leased','delivered','unknown','dead')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0), available_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid, leased_until timestamptz, last_error_code text, created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (state <> 'leased' OR (lease_token IS NOT NULL AND leased_until IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS bank_outbox_claim ON banking.outbox(state,available_at);
CREATE TABLE IF NOT EXISTS banking.receipts (
  id uuid PRIMARY KEY, provider_id uuid NOT NULL REFERENCES banking.providers(id), provider_event_id text NOT NULL,
  payment_id uuid REFERENCES banking.payment_intents(id), event_type text NOT NULL,
  normalized_json jsonb NOT NULL CHECK(jsonb_typeof(normalized_json)='object'),
  body_sha256 text NOT NULL CHECK (body_sha256 ~ '^[a-f0-9]{64}$'), body_cipher text NOT NULL,
  verification_method text NOT NULL CHECK (verification_method IN ('bank_signature','bank_mtls_query','test_fixture')),
  verification_reference text NOT NULL, verified_at timestamptz NOT NULL, received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider_id,provider_event_id)
);
ALTER TABLE banking.payment_intents DROP CONSTRAINT IF EXISTS bank_payment_final_receipt_fk;
ALTER TABLE banking.payment_intents ADD CONSTRAINT bank_payment_final_receipt_fk
 FOREIGN KEY(final_receipt_id) REFERENCES banking.receipts(id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE banking.payment_intents DROP CONSTRAINT IF EXISTS bank_payment_authorization_receipt_fk;
ALTER TABLE banking.payment_intents ADD CONSTRAINT bank_payment_authorization_receipt_fk
 FOREIGN KEY(authorization_receipt_id) REFERENCES banking.receipts(id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE IF NOT EXISTS banking.payment_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, payment_id uuid NOT NULL REFERENCES banking.payment_intents(id),
  previous_status text, next_status text NOT NULL, receipt_id uuid REFERENCES banking.receipts(id),
  request_id uuid, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS banking.statement_imports (
  id uuid PRIMARY KEY, provider_id uuid NOT NULL REFERENCES banking.providers(id), account_link_id uuid NOT NULL REFERENCES banking.account_links(id),
  business_date date NOT NULL, file_sha256 text NOT NULL CHECK(file_sha256 ~ '^[a-f0-9]{64}$'),
  verification_reference text NOT NULL, opening_cents bigint NOT NULL, closing_cents bigint NOT NULL,
  state text NOT NULL DEFAULT 'received' CHECK(state IN ('received','validated','reconciled','exception')),
  received_at timestamptz NOT NULL DEFAULT now(), UNIQUE(provider_id,account_link_id,business_date,file_sha256)
);
CREATE TABLE IF NOT EXISTS banking.statement_lines (
  id uuid PRIMARY KEY, import_id uuid NOT NULL REFERENCES banking.statement_imports(id), bank_transaction_reference text NOT NULL,
  bank_payment_reference text, direction text NOT NULL CHECK(direction IN ('debit','credit')),
  amount_cents bigint NOT NULL CHECK(amount_cents>0), currency char(3) NOT NULL CHECK(currency='CNY'),
  booked_at timestamptz NOT NULL, detail_cipher text NOT NULL, UNIQUE(import_id,bank_transaction_reference)
);
CREATE TABLE IF NOT EXISTS banking.reconciliation_runs (
  id uuid PRIMARY KEY, import_id uuid NOT NULL REFERENCES banking.statement_imports(id),
  state text NOT NULL CHECK(state IN ('running','matched','exception')), started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz
);
CREATE TABLE IF NOT EXISTS banking.reconciliation_exceptions (
  id uuid PRIMARY KEY, run_id uuid NOT NULL REFERENCES banking.reconciliation_runs(id), payment_id uuid REFERENCES banking.payment_intents(id),
  statement_line_id uuid REFERENCES banking.statement_lines(id),
  kind text NOT NULL CHECK(kind IN ('missing_bank_record','missing_local_record','amount_mismatch','status_mismatch','balance_mismatch')),
  state text NOT NULL DEFAULT 'open' CHECK(state IN ('open','investigating','resolved')),
  resolution_evidence_sha256 text, resolved_by text, reviewed_by text, created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(state <> 'resolved' OR (resolution_evidence_sha256 IS NOT NULL AND resolution_evidence_sha256 ~ '^[a-f0-9]{64}$' AND resolved_by IS NOT NULL AND reviewed_by IS NOT NULL AND resolved_by<>reviewed_by))
);

CREATE TABLE IF NOT EXISTS accounting.charts (
  lock_version bigint NOT NULL DEFAULT 0 CHECK(lock_version=0),
  id text PRIMARY KEY, name text NOT NULL, version integer NOT NULL,
  purpose text NOT NULL CHECK(purpose IN ('platform_financial','external_bank_memorandum')),
  status text NOT NULL CHECK(status IN ('draft','approved','retired')),
  policy_evidence_sha256 text, approved_by text, effective_from date NOT NULL, effective_to date,
  CHECK(effective_to IS NULL OR effective_to>=effective_from)
);
CREATE TABLE IF NOT EXISTS accounting.subjects (
  chart_id text NOT NULL REFERENCES accounting.charts(id), code text NOT NULL, name text NOT NULL,
  parent_code text, category text NOT NULL CHECK(category IN ('asset','liability','equity','income','expense','memorandum')),
  normal_side char(1) NOT NULL CHECK(normal_side IN ('D','C')), posting_allowed boolean NOT NULL DEFAULT true,
  PRIMARY KEY(chart_id,code), FOREIGN KEY(chart_id,parent_code) REFERENCES accounting.subjects(chart_id,code), CHECK(code<>parent_code)
);
CREATE TABLE IF NOT EXISTS accounting.books (
  id uuid PRIMARY KEY, chart_id text NOT NULL REFERENCES accounting.charts(id), name text NOT NULL,
  currency char(3) NOT NULL CHECK(currency='CNY'), purpose text NOT NULL CHECK(purpose IN ('platform_financial','external_bank_memorandum')),
  UNIQUE(id,chart_id)
);
CREATE TABLE IF NOT EXISTS accounting.accounts (
  id uuid PRIMARY KEY, book_id uuid NOT NULL, chart_id text NOT NULL, subject_code text NOT NULL,
  owner_id text REFERENCES customers(id), bank_account_link_id uuid REFERENCES banking.account_links(id),
  name text NOT NULL, currency char(3) NOT NULL CHECK(currency='CNY'),
  FOREIGN KEY(book_id,chart_id) REFERENCES accounting.books(id,chart_id),
  FOREIGN KEY(chart_id,subject_code) REFERENCES accounting.subjects(chart_id,code), UNIQUE(book_id,bank_account_link_id,subject_code)
);
CREATE TABLE IF NOT EXISTS accounting.business_days (
  book_id uuid NOT NULL REFERENCES accounting.books(id), business_date date NOT NULL,
  state text NOT NULL CHECK(state IN ('open','closing','closed')), closed_at timestamptz, PRIMARY KEY(book_id,business_date)
);
CREATE TABLE IF NOT EXISTS accounting.journals (
  id uuid PRIMARY KEY, book_id uuid NOT NULL REFERENCES accounting.books(id), business_date date NOT NULL,
  source_kind text NOT NULL CHECK(source_kind IN ('bank_receipt','platform_fee','platform_expense','opening','reversal')),
  source_reference text NOT NULL, receipt_id uuid REFERENCES banking.receipts(id),
  reverses_id uuid UNIQUE REFERENCES accounting.journals(id), memo text NOT NULL,
  state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','posted')),
  created_at timestamptz NOT NULL DEFAULT now(), posted_at timestamptz,
  UNIQUE(book_id,source_kind,source_reference), FOREIGN KEY(book_id,business_date) REFERENCES accounting.business_days(book_id,business_date),
  CHECK(source_kind<>'bank_receipt' OR receipt_id IS NOT NULL), CHECK(source_kind<>'reversal' OR reverses_id IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS accounting.entries (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, journal_id uuid NOT NULL REFERENCES accounting.journals(id),
  account_id uuid NOT NULL REFERENCES accounting.accounts(id), currency char(3) NOT NULL CHECK(currency='CNY'),
  debit_cents bigint NOT NULL DEFAULT 0, credit_cents bigint NOT NULL DEFAULT 0,
  CHECK((debit_cents>0 AND credit_cents=0) OR (credit_cents>0 AND debit_cents=0))
);
CREATE INDEX IF NOT EXISTS bank_account_entries ON accounting.entries(account_id,journal_id);
CREATE TABLE IF NOT EXISTS accounting.daily_balances (
  book_id uuid NOT NULL REFERENCES accounting.books(id), account_id uuid NOT NULL REFERENCES accounting.accounts(id), business_date date NOT NULL,
  debit_cents numeric(30,0) NOT NULL, credit_cents numeric(30,0) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(book_id,account_id,business_date)
);
ALTER TABLE banking.providers ADD COLUMN IF NOT EXISTS lock_version bigint NOT NULL DEFAULT 0 CHECK(lock_version=0);
ALTER TABLE banking.release_gates ADD COLUMN IF NOT EXISTS lock_version bigint NOT NULL DEFAULT 0 CHECK(lock_version=0);
ALTER TABLE banking.account_links ADD COLUMN IF NOT EXISTS lock_version bigint NOT NULL DEFAULT 0 CHECK(lock_version=0);
ALTER TABLE banking.consents ADD COLUMN IF NOT EXISTS lock_version bigint NOT NULL DEFAULT 0 CHECK(lock_version=0);
ALTER TABLE banking.payment_intents ADD COLUMN IF NOT EXISTS lock_version bigint NOT NULL DEFAULT 0 CHECK(lock_version=0);
ALTER TABLE accounting.charts ADD COLUMN IF NOT EXISTS lock_version bigint NOT NULL DEFAULT 0 CHECK(lock_version=0);

CREATE OR REPLACE FUNCTION accounting.immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'immutable accounting or bank evidence record' USING ERRCODE='23514'; END $$;
CREATE OR REPLACE FUNCTION accounting.guard_entry() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE j accounting.journals; a accounting.accounts; s accounting.subjects; b accounting.books;
BEGIN
 SELECT * INTO j FROM accounting.journals WHERE id=NEW.journal_id FOR UPDATE;
 SELECT * INTO a FROM accounting.accounts WHERE id=NEW.account_id;
 SELECT * INTO s FROM accounting.subjects WHERE chart_id=a.chart_id AND code=a.subject_code;
 SELECT * INTO b FROM accounting.books WHERE id=j.book_id;
 IF j.state<>'draft' OR a.book_id<>j.book_id OR a.currency<>NEW.currency OR NOT s.posting_allowed THEN
   RAISE EXCEPTION 'invalid entry account, currency, subject or posted journal' USING ERRCODE='23514'; END IF;
 IF b.purpose='external_bank_memorandum' AND s.category<>'memorandum' THEN
   RAISE EXCEPTION 'externally held customer funds cannot enter platform financial subjects' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION accounting.guard_post() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE day_state text; policy accounting.charts; book accounting.books;
BEGIN
 IF (NEW.book_id,NEW.business_date,NEW.source_kind,NEW.source_reference,NEW.receipt_id,NEW.reverses_id) IS DISTINCT FROM (OLD.book_id,OLD.business_date,OLD.source_kind,OLD.source_reference,OLD.receipt_id,OLD.reverses_id) THEN RAISE EXCEPTION 'journal identity is immutable' USING ERRCODE='23514'; END IF;
 IF OLD.state='posted' THEN RAISE EXCEPTION 'posted journal is immutable' USING ERRCODE='23514'; END IF;
 IF NEW.state='draft' AND NEW.posted_at IS NOT NULL THEN RAISE EXCEPTION 'draft journal cannot have a posting timestamp' USING ERRCODE='23514'; END IF;
 IF NEW.state='posted' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('accounting-book:'||NEW.book_id::text,0));
  SELECT state INTO day_state FROM accounting.business_days WHERE book_id=NEW.book_id AND business_date=NEW.business_date FOR UPDATE;
  SELECT * INTO book FROM accounting.books WHERE id=NEW.book_id;
  SELECT * INTO policy FROM accounting.charts WHERE id=book.chart_id FOR SHARE;
  IF day_state IS DISTINCT FROM 'open' OR policy.status IS DISTINCT FROM 'approved' OR policy.purpose IS DISTINCT FROM book.purpose OR NEW.business_date<policy.effective_from OR (policy.effective_to IS NOT NULL AND NEW.business_date>policy.effective_to)
   OR EXISTS(SELECT 1 FROM accounting.business_days WHERE book_id=NEW.book_id AND business_date>=NEW.business_date AND state IN ('closing','closed')) THEN
   RAISE EXCEPTION 'closed date or unapproved, expired or mismatched accounting policy' USING ERRCODE='23514'; END IF;
  IF (SELECT count(*) FROM accounting.entries WHERE journal_id=NEW.id)<2 OR EXISTS(SELECT currency FROM accounting.entries WHERE journal_id=NEW.id GROUP BY currency HAVING sum(debit_cents::numeric)<>sum(credit_cents::numeric)) THEN
   RAISE EXCEPTION 'journal is not balanced per currency' USING ERRCODE='23514'; END IF;
  NEW.posted_at=now();
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION banking.guard_payment_transition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r banking.receipts; a banking.receipts;
BEGIN
 IF TG_OP='INSERT' THEN
   IF NEW.status<>'awaiting_authorization' THEN RAISE EXCEPTION 'new payment must await bank authorization' USING ERRCODE='23514'; END IF;
   RETURN NEW;
 END IF;
 IF OLD.status IN ('succeeded','rejected','cancelled') AND NEW IS DISTINCT FROM OLD THEN
   RAISE EXCEPTION 'terminal payment is immutable' USING ERRCODE='23514'; END IF;
 IF NEW.owner_id<>OLD.owner_id OR NEW.provider_id<>OLD.provider_id OR NEW.amount_cents<>OLD.amount_cents OR NEW.currency<>OLD.currency OR NEW.source_account_id<>OLD.source_account_id OR NEW.request_sha256<>OLD.request_sha256 OR NEW.consent_id<>OLD.consent_id THEN
   RAISE EXCEPTION 'payment financial identity is immutable' USING ERRCODE='23514'; END IF;
 IF NEW.status NOT IN ('awaiting_authorization','cancelled','rejected') THEN
  SELECT * INTO a FROM banking.receipts WHERE id=NEW.authorization_receipt_id;
  IF a.id IS NULL OR a.provider_id<>NEW.provider_id OR a.payment_id<>NEW.id OR a.event_type<>'payment.authorized'
    OR (a.normalized_json->>'amountCents')::numeric IS DISTINCT FROM NEW.amount_cents::numeric OR (a.normalized_json->>'currency') IS DISTINCT FROM NEW.currency::text
    OR (a.normalized_json->>'sourceAccountId') IS DISTINCT FROM NEW.source_account_id::text
    OR (a.normalized_json->>'bankAuthorizationReference') IS DISTINCT FROM NEW.bank_authorization_reference THEN
    RAISE EXCEPTION 'payment requires bank authorization bound to its financial details' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.status IN ('succeeded','rejected') OR (NEW.status='cancelled' AND OLD.status<>'awaiting_authorization') THEN
  SELECT * INTO r FROM banking.receipts WHERE id=NEW.final_receipt_id;
  IF r.id IS NULL OR r.provider_id<>NEW.provider_id OR r.payment_id<>NEW.id OR r.event_type<>('payment.'||NEW.status)
    OR (r.normalized_json->>'amountCents')::numeric IS DISTINCT FROM NEW.amount_cents::numeric OR (r.normalized_json->>'currency') IS DISTINCT FROM NEW.currency::text
    OR (r.normalized_json->>'sourceAccountId') IS DISTINCT FROM NEW.source_account_id::text THEN
    RAISE EXCEPTION 'finality requires a bank receipt with matching amount, currency and account' USING ERRCODE='23514'; END IF;
  IF NEW.status='succeeded' AND (r.normalized_json->>'bankPaymentReference') IS DISTINCT FROM NEW.bank_payment_reference THEN
    RAISE EXCEPTION 'bank payment reference mismatch' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION banking.guard_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (SELECT environment FROM banking.providers WHERE id=NEW.provider_id)='production' AND NEW.verification_method='test_fixture' THEN
  RAISE EXCEPTION 'test evidence cannot authorize production funds' USING ERRCODE='23514'; END IF;
 IF NEW.event_type LIKE 'payment.%' AND (NEW.payment_id IS NULL OR NOT NEW.normalized_json ?& ARRAY['amountCents','currency','sourceAccountId'] OR NOT coalesce((NEW.normalized_json->>'amountCents') ~ '^[1-9][0-9]*$',false) OR (NEW.normalized_json->>'currency') IS DISTINCT FROM 'CNY' OR NEW.normalized_json->>'sourceAccountId' IS NULL) THEN
  RAISE EXCEPTION 'payment receipt is missing financial identity' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION accounting.guard_new_journal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE day_state text;
BEGIN
 IF NEW.state<>'draft' OR NEW.posted_at IS NOT NULL THEN RAISE EXCEPTION 'new journal must be draft' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('accounting-book:'||NEW.book_id::text,0));
 SELECT state INTO day_state FROM accounting.business_days WHERE book_id=NEW.book_id AND business_date=NEW.business_date FOR UPDATE;
 IF day_state IS DISTINCT FROM 'open' OR EXISTS(SELECT 1 FROM accounting.business_days WHERE book_id=NEW.book_id AND business_date>=NEW.business_date AND state IN ('closing','closed')) THEN
  RAISE EXCEPTION 'cannot create a journal on a closed accounting period' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS journal_insert_guard ON accounting.journals;
CREATE TRIGGER journal_insert_guard BEFORE INSERT ON accounting.journals FOR EACH ROW EXECUTE FUNCTION accounting.guard_new_journal();
DROP TRIGGER IF EXISTS receipt_verification_guard ON banking.receipts;
CREATE TRIGGER receipt_verification_guard BEFORE INSERT ON banking.receipts FOR EACH ROW EXECUTE FUNCTION banking.guard_receipt();
DROP TRIGGER IF EXISTS entry_insert_guard ON accounting.entries;
CREATE TRIGGER entry_insert_guard BEFORE INSERT ON accounting.entries FOR EACH ROW EXECUTE FUNCTION accounting.guard_entry();
DROP TRIGGER IF EXISTS entry_immutable ON accounting.entries;
CREATE TRIGGER entry_immutable BEFORE UPDATE OR DELETE ON accounting.entries FOR EACH ROW EXECUTE FUNCTION accounting.immutable();
DROP TRIGGER IF EXISTS journal_post_guard ON accounting.journals;
CREATE TRIGGER journal_post_guard BEFORE UPDATE ON accounting.journals FOR EACH ROW EXECUTE FUNCTION accounting.guard_post();
DROP TRIGGER IF EXISTS journal_no_delete ON accounting.journals;
CREATE TRIGGER journal_no_delete BEFORE DELETE ON accounting.journals FOR EACH ROW EXECUTE FUNCTION accounting.immutable();
DROP TRIGGER IF EXISTS receipt_immutable ON banking.receipts;
CREATE TRIGGER receipt_immutable BEFORE UPDATE OR DELETE ON banking.receipts FOR EACH ROW EXECUTE FUNCTION accounting.immutable();
DROP TRIGGER IF EXISTS payment_event_immutable ON banking.payment_events;
CREATE TRIGGER payment_event_immutable BEFORE UPDATE OR DELETE ON banking.payment_events FOR EACH ROW EXECUTE FUNCTION accounting.immutable();
DROP TRIGGER IF EXISTS payment_transition_guard ON banking.payment_intents;
CREATE TRIGGER payment_transition_guard BEFORE INSERT OR UPDATE ON banking.payment_intents FOR EACH ROW EXECUTE FUNCTION banking.guard_payment_transition();
DROP TRIGGER IF EXISTS daily_balance_immutable ON accounting.daily_balances;
CREATE TRIGGER daily_balance_immutable BEFORE UPDATE OR DELETE ON accounting.daily_balances FOR EACH ROW EXECUTE FUNCTION accounting.immutable();

CREATE TABLE IF NOT EXISTS regulatory.report_definitions (
 id text NOT NULL, version integer NOT NULL, recipient text NOT NULL, purpose text NOT NULL,
 schema_sha256 text NOT NULL, effective_from date NOT NULL, effective_to date,
 approval_state text NOT NULL DEFAULT 'draft' CHECK(approval_state IN ('draft','approved','retired')),
 approved_by text, approval_evidence_sha256 text, PRIMARY KEY(id,version),
 CHECK(approval_state<>'approved' OR (approved_by IS NOT NULL AND approval_evidence_sha256 IS NOT NULL AND approval_evidence_sha256 ~ '^[a-f0-9]{64}$'))
);
CREATE TABLE IF NOT EXISTS regulatory.report_runs (
 id uuid PRIMARY KEY, definition_id text NOT NULL, definition_version integer NOT NULL,
 as_of_date date NOT NULL, state text NOT NULL CHECK(state IN ('draft','validated','approved','exported','submitted','rejected')),
 artifact_sha256 text, prepared_by text NOT NULL, reviewed_by text, source_cutoff timestamptz NOT NULL,
 external_submission_reference text, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(definition_id,definition_version) REFERENCES regulatory.report_definitions(id,version),
 CHECK(state NOT IN ('approved','exported','submitted') OR (reviewed_by IS NOT NULL AND reviewed_by<>prepared_by AND artifact_sha256 IS NOT NULL AND artifact_sha256 ~ '^[a-f0-9]{64}$')),
 CHECK(state<>'submitted' OR external_submission_reference IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS regulatory.report_lineage (
 run_id uuid NOT NULL REFERENCES regulatory.report_runs(id), metric text NOT NULL,
 receipt_id uuid REFERENCES banking.receipts(id), journal_id uuid REFERENCES accounting.journals(id),
 source_reference text NOT NULL, source_sha256 text NOT NULL, PRIMARY KEY(run_id,metric,source_reference)
);
CREATE TABLE IF NOT EXISTS regulatory.validation_results (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, run_id uuid NOT NULL REFERENCES regulatory.report_runs(id),
 rule_code text NOT NULL, severity text NOT NULL CHECK(severity IN ('error','warning','info')),
 passed boolean NOT NULL, evidence_sha256 text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO accounting.charts(id,name,version,purpose,status,effective_from) VALUES
 ('CN-PLATFORM-DRAFT-1','内地人民币银行合作平台会计科目模板（待会计政策审批）',1,'platform_financial','draft','2026-10-15'),
 ('BANK-MEMO-1','合作银行客户资金备查账（非平台自有资产负债）',1,'external_bank_memorandum','approved','2026-10-15') ON CONFLICT DO NOTHING;
INSERT INTO accounting.subjects(chart_id,code,name,category,normal_side,posting_allowed) VALUES
 ('CN-PLATFORM-DRAFT-1','1','资产','asset','D',false),('CN-PLATFORM-DRAFT-1','2','负债','liability','C',false),
 ('CN-PLATFORM-DRAFT-1','3','权益','equity','C',false),('CN-PLATFORM-DRAFT-1','4','收入','income','C',false),
 ('CN-PLATFORM-DRAFT-1','5','费用','expense','D',false),('CN-PLATFORM-DRAFT-1','9','表外备查','memorandum','D',false),
 ('BANK-MEMO-1','901001','银行已确认客户资金备查','memorandum','D',true),
 ('BANK-MEMO-1','902001','银行客户资金备查对方科目','memorandum','C',true) ON CONFLICT DO NOTHING;
INSERT INTO accounting.subjects(chart_id,code,name,parent_code,category,normal_side) VALUES
 ('CN-PLATFORM-DRAFT-1','1001','库存现金','1','asset','D'),('CN-PLATFORM-DRAFT-1','1002','平台自有银行存款','1','asset','D'),
 ('CN-PLATFORM-DRAFT-1','1012','其他货币资金','1','asset','D'),('CN-PLATFORM-DRAFT-1','1122','应收账款','1','asset','D'),
 ('CN-PLATFORM-DRAFT-1','1123','预付账款','1','asset','D'),('CN-PLATFORM-DRAFT-1','1132','应收利息','1','asset','D'),
 ('CN-PLATFORM-DRAFT-1','1221','其他应收款','1','asset','D'),('CN-PLATFORM-DRAFT-1','1231','应收款损失准备','1','asset','C'),
 ('CN-PLATFORM-DRAFT-1','1601','固定资产','1','asset','D'),('CN-PLATFORM-DRAFT-1','1602','累计折旧','1','asset','C'),
 ('CN-PLATFORM-DRAFT-1','1701','无形资产','1','asset','D'),('CN-PLATFORM-DRAFT-1','1702','累计摊销','1','asset','C'),
 ('CN-PLATFORM-DRAFT-1','1801','长期待摊费用','1','asset','D'),('CN-PLATFORM-DRAFT-1','2001','短期借款','2','liability','C'),
 ('CN-PLATFORM-DRAFT-1','2202','应付账款','2','liability','C'),('CN-PLATFORM-DRAFT-1','2203','预收款及合同负债明细','2','liability','C'),
 ('CN-PLATFORM-DRAFT-1','2211','应付职工薪酬','2','liability','C'),('CN-PLATFORM-DRAFT-1','2221','应交税费','2','liability','C'),
 ('CN-PLATFORM-DRAFT-1','2231','应付利息','2','liability','C'),('CN-PLATFORM-DRAFT-1','2241','其他应付款','2','liability','C'),
 ('CN-PLATFORM-DRAFT-1','2501','长期借款','2','liability','C'),('CN-PLATFORM-DRAFT-1','2801','长期应付款','2','liability','C'),
 ('CN-PLATFORM-DRAFT-1','4001','实收资本','3','equity','C'),('CN-PLATFORM-DRAFT-1','4002','资本公积','3','equity','C'),
 ('CN-PLATFORM-DRAFT-1','4101','盈余公积','3','equity','C'),('CN-PLATFORM-DRAFT-1','4103','本年利润','3','equity','C'),
 ('CN-PLATFORM-DRAFT-1','4104','利润分配','3','equity','C'),('CN-PLATFORM-DRAFT-1','6001','技术服务收入','4','income','C'),
 ('CN-PLATFORM-DRAFT-1','6051','其他业务收入','4','income','C'),('CN-PLATFORM-DRAFT-1','6111','投资收益','4','income','C'),
 ('CN-PLATFORM-DRAFT-1','6301','营业外收入','4','income','C'),('CN-PLATFORM-DRAFT-1','6401','主营业务成本','5','expense','D'),
 ('CN-PLATFORM-DRAFT-1','6402','其他业务成本','5','expense','D'),('CN-PLATFORM-DRAFT-1','6403','税金及附加','5','expense','D'),
 ('CN-PLATFORM-DRAFT-1','6601','销售费用','5','expense','D'),('CN-PLATFORM-DRAFT-1','6602','管理费用','5','expense','D'),
 ('CN-PLATFORM-DRAFT-1','6603','财务费用','5','expense','D'),('CN-PLATFORM-DRAFT-1','6604','研发费用','5','expense','D'),
 ('CN-PLATFORM-DRAFT-1','6702','信用减值损失','5','expense','D'),('CN-PLATFORM-DRAFT-1','6711','营业外支出','5','expense','D'),
 ('CN-PLATFORM-DRAFT-1','6801','所得税费用','5','expense','D'),('CN-PLATFORM-DRAFT-1','9001','合作银行业务备查','9','memorandum','D') ON CONFLICT DO NOTHING;


CREATE OR REPLACE FUNCTION accounting.close_business_day(p_book uuid,p_day date) RETURNS void LANGUAGE plpgsql AS $$
DECLARE day_state text;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('accounting-book:'||p_book::text,0));
 SELECT state INTO day_state FROM accounting.business_days WHERE book_id=p_book AND business_date=p_day FOR UPDATE;
 IF day_state IS DISTINCT FROM 'open' THEN RAISE EXCEPTION 'business day is not open' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM accounting.journals WHERE book_id=p_book AND business_date<=p_day AND state='draft') THEN
  RAISE EXCEPTION 'unposted journals prevent day closing' USING ERRCODE='23514'; END IF;
 UPDATE accounting.business_days SET state='closing' WHERE book_id=p_book AND business_date=p_day;
 INSERT INTO accounting.daily_balances(book_id,account_id,business_date,debit_cents,credit_cents)
 SELECT p_book,a.id,p_day,coalesce(sum(e.debit_cents::numeric) FILTER(WHERE j.state='posted' AND j.business_date<=p_day),0),
  coalesce(sum(e.credit_cents::numeric) FILTER(WHERE j.state='posted' AND j.business_date<=p_day),0)
 FROM accounting.accounts a LEFT JOIN accounting.entries e ON e.account_id=a.id LEFT JOIN accounting.journals j ON j.id=e.journal_id
 WHERE a.book_id=p_book GROUP BY a.id;
 UPDATE accounting.business_days SET state='closed',closed_at=now() WHERE book_id=p_book AND business_date=p_day;
END $$;

CREATE OR REPLACE FUNCTION accounting.guard_account_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR (NEW.book_id,NEW.chart_id,NEW.subject_code,NEW.currency,NEW.owner_id,NEW.bank_account_link_id) IS DISTINCT FROM (OLD.book_id,OLD.chart_id,OLD.subject_code,OLD.currency,OLD.owner_id,OLD.bank_account_link_id) THEN
   RAISE EXCEPTION 'accounting account identity cannot be changed' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS accounting_account_identity ON accounting.accounts;
CREATE TRIGGER accounting_account_identity BEFORE UPDATE OR DELETE ON accounting.accounts FOR EACH ROW EXECUTE FUNCTION accounting.guard_account_identity();
INSERT INTO banking.schema_migrations(version) VALUES(2026101504) ON CONFLICT DO NOTHING;

-- Posting and day close share one book lock, including backdated journals.


CREATE OR REPLACE FUNCTION accounting.guard_business_day() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'open' OR NEW.closed_at IS NOT NULL THEN RAISE EXCEPTION 'business day must start open' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'business days cannot be deleted' USING ERRCODE='23514'; END IF;
 IF (NEW.book_id,NEW.business_date) IS DISTINCT FROM (OLD.book_id,OLD.business_date) OR OLD.state='closed' THEN RAISE EXCEPTION 'closed day and business date are immutable' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('accounting-book:'||NEW.book_id::text,0));
 IF NOT ((OLD.state='open' AND NEW.state='closing' AND NEW.closed_at IS NULL) OR (OLD.state='closing' AND NEW.state='closed' AND NEW.closed_at IS NOT NULL)) THEN
  RAISE EXCEPTION 'invalid business day transition' USING ERRCODE='23514'; END IF;
 IF NEW.state='closed' THEN
  IF EXISTS(SELECT 1 FROM accounting.journals WHERE book_id=NEW.book_id AND business_date<=NEW.business_date AND state='draft') OR EXISTS(
   SELECT 1 FROM accounting.accounts a LEFT JOIN accounting.daily_balances d ON d.book_id=a.book_id AND d.account_id=a.id AND d.business_date=NEW.business_date WHERE a.book_id=NEW.book_id AND d.account_id IS NULL) OR EXISTS(
   SELECT 1 FROM accounting.daily_balances d WHERE d.book_id=NEW.book_id AND d.business_date=NEW.business_date AND
    (d.debit_cents IS DISTINCT FROM (SELECT coalesce(sum(e.debit_cents::numeric),0) FROM accounting.entries e JOIN accounting.journals j ON j.id=e.journal_id WHERE e.account_id=d.account_id AND j.state='posted' AND j.business_date<=NEW.business_date)
     OR d.credit_cents IS DISTINCT FROM (SELECT coalesce(sum(e.credit_cents::numeric),0) FROM accounting.entries e JOIN accounting.journals j ON j.id=e.journal_id WHERE e.account_id=d.account_id AND j.state='posted' AND j.business_date<=NEW.business_date))) THEN
   RAISE EXCEPTION 'draft journals or missing snapshots prevent day close' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION accounting.guard_daily_balance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE day_state text; account_book uuid; expected_debit numeric; expected_credit numeric;
BEGIN
 SELECT state INTO day_state FROM accounting.business_days WHERE book_id=NEW.book_id AND business_date=NEW.business_date FOR UPDATE;
 SELECT book_id INTO account_book FROM accounting.accounts WHERE id=NEW.account_id;
 IF day_state IS DISTINCT FROM 'closing' OR account_book IS DISTINCT FROM NEW.book_id THEN RAISE EXCEPTION 'daily balance requires a matching account and closing business day' USING ERRCODE='23514'; END IF;
 SELECT coalesce(sum(e.debit_cents::numeric),0),coalesce(sum(e.credit_cents::numeric),0) INTO expected_debit,expected_credit FROM accounting.entries e JOIN accounting.journals j ON j.id=e.journal_id WHERE e.account_id=NEW.account_id AND j.state='posted' AND j.business_date<=NEW.business_date;
 IF NEW.debit_cents IS DISTINCT FROM expected_debit OR NEW.credit_cents IS DISTINCT FROM expected_credit THEN RAISE EXCEPTION 'daily balance differs from posted journal totals' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION accounting.guard_book_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.purpose IS DISTINCT FROM (SELECT purpose FROM accounting.charts WHERE id=NEW.chart_id) THEN RAISE EXCEPTION 'book and chart purposes must match' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND (NEW.id,NEW.chart_id,NEW.currency,NEW.purpose) IS DISTINCT FROM (OLD.id,OLD.chart_id,OLD.currency,OLD.purpose) THEN RAISE EXCEPTION 'book financial identity is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS business_day_transition ON accounting.business_days;
CREATE TRIGGER business_day_transition BEFORE INSERT OR UPDATE OR DELETE ON accounting.business_days FOR EACH ROW EXECUTE FUNCTION accounting.guard_business_day();
DROP TRIGGER IF EXISTS daily_balance_insert_guard ON accounting.daily_balances;
CREATE TRIGGER daily_balance_insert_guard BEFORE INSERT ON accounting.daily_balances FOR EACH ROW EXECUTE FUNCTION accounting.guard_daily_balance();
DROP TRIGGER IF EXISTS accounting_book_identity ON accounting.books;
CREATE TRIGGER accounting_book_identity BEFORE INSERT OR UPDATE ON accounting.books FOR EACH ROW EXECUTE FUNCTION accounting.guard_book_identity();
DROP TRIGGER IF EXISTS accounting_entries_no_truncate ON accounting.entries;
CREATE TRIGGER accounting_entries_no_truncate BEFORE TRUNCATE ON accounting.entries FOR EACH STATEMENT EXECUTE FUNCTION accounting.immutable();
DROP TRIGGER IF EXISTS accounting_journals_no_truncate ON accounting.journals;
CREATE TRIGGER accounting_journals_no_truncate BEFORE TRUNCATE ON accounting.journals FOR EACH STATEMENT EXECUTE FUNCTION accounting.immutable();
DROP TRIGGER IF EXISTS accounting_balances_no_truncate ON accounting.daily_balances;
CREATE TRIGGER accounting_balances_no_truncate BEFORE TRUNCATE ON accounting.daily_balances FOR EACH STATEMENT EXECUTE FUNCTION accounting.immutable();
