-- Run as database owner or postgres after owner bootstrap; never from HTTP startup.
-- Roles must already exist with NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA banking, accounting, regulatory FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public, banking, accounting, regulatory FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA banking, accounting, regulatory FROM PUBLIC;

GRANT CONNECT ON DATABASE maneki_bank TO maneki_app, maneki_bank_worker;
GRANT USAGE ON SCHEMA public, banking, accounting, regulatory TO maneki_app;
REVOKE ALL ON ALL TABLES IN SCHEMA public, banking, accounting, regulatory FROM maneki_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO maneki_app;
-- Evidence logs are append only for the serving process.
REVOKE UPDATE, DELETE, TRUNCATE ON public.audit_logs, public.bank_request_audit,
  public.customer_auth_audit, public.customer_access_logs, public.bank_admin_audit FROM maneki_app;
REVOKE INSERT, UPDATE, DELETE ON public.bank_schema_migrations FROM maneki_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO maneki_app;
GRANT SELECT ON ALL TABLES IN SCHEMA banking, accounting, regulatory TO maneki_app;
-- No runtime role may claim a structure upgrade has happened.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON banking.schema_migrations FROM maneki_app, maneki_bank_worker;
GRANT INSERT ON banking.payment_intents, banking.payment_events TO maneki_app;
-- PostgreSQL SELECT FOR UPDATE/SHARE requires UPDATE on one column. This
-- constant-zero column grants locking without permitting financial changes.
GRANT UPDATE(lock_version) ON banking.providers, banking.release_gates,
  banking.account_links, banking.consents, banking.payment_intents TO maneki_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA banking TO maneki_app;

-- Worker credentials are kept separate; no live worker is started before a real
-- bank adapter, mutual authentication and acceptance evidence exist.
GRANT USAGE ON SCHEMA public, banking, accounting, regulatory TO maneki_bank_worker;
GRANT SELECT ON public.customers TO maneki_bank_worker;
GRANT SELECT ON ALL TABLES IN SCHEMA banking, accounting, regulatory TO maneki_bank_worker;
GRANT UPDATE(lock_version) ON banking.providers, banking.release_gates,
  accounting.charts TO maneki_bank_worker;
GRANT INSERT, UPDATE ON banking.account_links, banking.consents, banking.payment_intents,
  banking.outbox, banking.statement_imports, banking.reconciliation_runs,
  banking.reconciliation_exceptions TO maneki_bank_worker;
GRANT INSERT ON banking.receipts, banking.payment_events, banking.statement_lines TO maneki_bank_worker;
GRANT INSERT, UPDATE ON accounting.journals, accounting.business_days TO maneki_bank_worker;
GRANT INSERT ON accounting.entries, accounting.daily_balances TO maneki_bank_worker;
GRANT EXECUTE ON FUNCTION accounting.close_business_day(uuid,date) TO maneki_bank_worker;
GRANT INSERT, UPDATE ON regulatory.report_runs TO maneki_bank_worker;
GRANT INSERT ON regulatory.report_lineage, regulatory.validation_results TO maneki_bank_worker;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA banking, accounting, regulatory TO maneki_bank_worker;

-- Future owner migrations must explicitly grant their runtime capabilities.
ALTER DEFAULT PRIVILEGES FOR ROLE maneki_owner IN SCHEMA public, banking, accounting, regulatory
  REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE maneki_owner IN SCHEMA banking, accounting, regulatory
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
