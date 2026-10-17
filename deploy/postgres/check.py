#!/usr/bin/env python3
"""Read-only PostgreSQL checks and shared, credential-safe CLI helpers."""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import parse_qs, unquote, urlsplit


class OperationsError(RuntimeError):
    pass


def utc_now():
    return dt.datetime.now(dt.timezone.utc).isoformat().replace('+00:00', 'Z')


def absolute_path(value, *, exists=False):
    path = Path(value)
    if not path.is_absolute() or path != path.resolve():
        raise OperationsError('Use a canonical absolute path without symbolic links')
    if exists and (not path.is_file() or path.is_symlink()):
        raise OperationsError('Required input is not an existing regular file')
    return path


def backup_root(value=None, *, create=False):
    root = absolute_path(value or os.environ.get('BANK_PG_BACKUP_DIR', '/var/backups/luckycat-bank/postgresql'))
    if create:
        root.mkdir(mode=0o700, parents=True, exist_ok=True)
    if not root.is_dir() or root.is_symlink():
        raise OperationsError('Backup root must be an existing ordinary directory')
    if os.name == 'posix' and root.stat().st_mode & 0o077:
        raise OperationsError('Backup root must deny all group and other access (0700)')
    return root


def inside_root(value, root, *, exists=False):
    path = absolute_path(value, exists=exists)
    if not path.is_relative_to(root) or path == root:
        raise OperationsError('Backup path must remain inside the configured backup root')
    return path


def schema_name(value=None):
    name = value or os.environ.get('BANK_DATABASE_SCHEMA', 'public')
    if not re.fullmatch(r'[a-z_][a-z0-9_]{0,62}', name):
        raise OperationsError('Invalid database schema')
    return name


def pg_environment(database=None):
    env = dict(os.environ)
    raw = env.pop('BANK_DATABASE_URL', None)
    env.pop('BANK_DATA_KEY', None)
    if raw:
        try:
            url = urlsplit(raw)
            if url.scheme not in ('postgres', 'postgresql') or not url.path or url.path == '/':
                raise ValueError()
            env['PGDATABASE'] = unquote(url.path[1:])
            if url.hostname:
                env['PGHOST'] = url.hostname
            if url.port:
                env['PGPORT'] = str(url.port)
            if url.username is not None:
                env['PGUSER'] = unquote(url.username)
            if url.password is not None:
                env['PGPASSWORD'] = unquote(url.password)
            allowed = {'sslmode': 'PGSSLMODE', 'sslrootcert': 'PGSSLROOTCERT', 'sslcert': 'PGSSLCERT', 'sslkey': 'PGSSLKEY', 'host': 'PGHOST', 'port': 'PGPORT'}
            for key, values in parse_qs(url.query, keep_blank_values=True).items():
                if key not in allowed or len(values) != 1:
                    raise ValueError()
                env[allowed[key]] = values[0]
        except (ValueError, TypeError):
            raise OperationsError('BANK_DATABASE_URL is invalid or contains unsupported connection options') from None
    if database is not None:
        env['PGDATABASE'] = database
    if not env.get('PGDATABASE'):
        raise OperationsError('Set BANK_DATABASE_URL or PGDATABASE explicitly')
    env.setdefault('PGCONNECT_TIMEOUT', '10')
    env['PGAPPNAME'] = 'luckycat-postgresql-operations'
    env['PGOPTIONS'] = f"-c search_path={schema_name()},public -c statement_timeout=900000 -c lock_timeout=15000"
    return env


def run_cli(command, env, *, sql=None, timeout=900):
    try:
        result = subprocess.run(command, input=sql, env=env, text=True, encoding='utf-8', capture_output=True, check=False, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired):
        raise OperationsError(f'{Path(command[0]).name} could not complete') from None
    if result.returncode:
        # Do not print libpq diagnostics: supplied URLs, secrets or SQL data may
        # otherwise be repeated by a third-party client or wrapper.
        raise OperationsError(f'{Path(command[0]).name} failed with exit code {result.returncode}; inspect the protected database logs')
    return result.stdout.strip()


def psql(env, sql):
    return run_cli(['psql', '-X', '--no-password', '--quiet', '--tuples-only', '--no-align', '--set=ON_ERROR_STOP=1'], env, sql=sql)


_AI_TABLES_PRESENT = "to_regclass('ai_sessions.sessions') IS NOT NULL AND to_regclass('ai_sessions.events') IS NOT NULL AND to_regclass('ai_sessions.imports') IS NOT NULL"


def optional_query_sql(base, fragments):
    r"""Have psql execute only SQL for tables visible in this same transaction.

    The outer query refers only to catalog functions. Optional table references
    remain quoted text until \gexec, avoiding parse failures on older databases.
    A partially installed AI schema is an error rather than an empty inventory.
    """
    literal = lambda text: "'" + text.replace("'", "''") + "'"
    expression = literal(base)
    for condition, fragment in fragments:
        expression += f" || CASE WHEN {condition} THEN {literal(fragment)} ELSE '' END"
    expression += " || ';'"
    return ("SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='ai_sessions') "
            f"AND NOT ({_AI_TABLES_PRESENT}) THEN 'SELECT 1/0;' ELSE {expression} END\n\\gexec\n")


def inventory_sql(schema):
    base = f'''SELECT jsonb_build_object(
      'schemaVersion',(SELECT max(version) FROM "{schema}".bank_schema_migrations),
      'counts',json_build_object(
        'customers',(SELECT count(*) FROM "{schema}".customers),
        'accounts',(SELECT count(*) FROM "{schema}".bank_accounts),
        'transactions',(SELECT count(*) FROM "{schema}".bank_transactions),
        'legacyJournalBatches',(SELECT count(*) FROM "{schema}".journal_batches),
        'legacyJournalEntries',(SELECT count(*) FROM "{schema}".journal_entries),
        'tickets',(SELECT count(*) FROM "{schema}".tickets),
        'approvals',(SELECT count(*) FROM "{schema}".approvals),
        'auditLogs',(SELECT count(*) FROM "{schema}".audit_logs),
        'bankAccountLinks',(SELECT count(*) FROM banking.account_links),
        'paymentIntents',(SELECT count(*) FROM banking.payment_intents),
        'bankReceipts',(SELECT count(*) FROM banking.receipts),
        'outbox',(SELECT count(*) FROM banking.outbox),
        'accountingJournals',(SELECT count(*) FROM accounting.journals),
        'accountingEntries',(SELECT count(*) FROM accounting.entries),
        'subjects',(SELECT count(*) FROM accounting.subjects),
        'reportRuns',(SELECT count(*) FROM regulatory.report_runs)),
      'currencyBalances',coalesce((SELECT json_agg(v ORDER BY v.currency) FROM
        (SELECT currency,sum(balance_cents)::text AS balance_cents,sum(available_cents)::text AS available_cents
         FROM "{schema}".bank_accounts GROUP BY currency) v),'[]'::json))'''
    bank_version = " || jsonb_build_object('bankingSchemaVersion',(SELECT max(version) FROM banking.schema_migrations))"
    ai_inventory = ''' || jsonb_build_object('aiSessions',jsonb_build_object(
      'sessions',(SELECT count(*) FROM ai_sessions.sessions),
      'events',(SELECT count(*) FROM ai_sessions.events),
      'imports',(SELECT count(*) FROM ai_sessions.imports),
      'namespaces',(SELECT jsonb_object_agg(ns.namespace,jsonb_build_object(
        'sessions',(SELECT count(*) FROM ai_sessions.sessions s WHERE s.namespace=ns.namespace),
        'events',(SELECT count(*) FROM ai_sessions.events e WHERE e.namespace=ns.namespace),
        'imports',(SELECT count(*) FROM ai_sessions.imports i WHERE i.namespace=ns.namespace)))
        FROM (VALUES ('customer'),('staff'),('ops')) ns(namespace))))'''
    return optional_query_sql(base, [
        ("to_regclass('banking.schema_migrations') IS NOT NULL", bank_version),
        (_AI_TABLES_PRESENT, ai_inventory),
    ])


def database_checks(env, schema):
    base = f'''SELECT jsonb_build_object(
      'legacyUnbalancedBatches',(SELECT count(*) FROM "{schema}".ledger_batch_totals WHERE debit_cents<>credit_cents),
      'legacyUnpostedBatches',(SELECT count(*) FROM "{schema}".journal_batches WHERE state<>'posted'),
      'legacyAccountMismatches',(SELECT count(*) FROM (
        SELECT a.owner_id,a.id FROM "{schema}".bank_accounts a
        LEFT JOIN "{schema}".ledger_accounts l ON l.owner_id=a.owner_id AND l.account_id=a.id
        LEFT JOIN "{schema}".journal_entries e ON e.ledger_account_id=l.id
        GROUP BY a.owner_id,a.id,a.balance_cents HAVING a.balance_cents<>coalesce(sum(e.credit_cents::numeric-e.debit_cents::numeric),0)) mismatch),
      'postedAccountingMismatches',(SELECT count(*) FROM accounting.journals j WHERE j.state='posted' AND
        ((SELECT count(*) FROM accounting.entries e WHERE e.journal_id=j.id)<2 OR EXISTS
          (SELECT currency FROM accounting.entries e WHERE e.journal_id=j.id GROUP BY currency
           HAVING sum(e.debit_cents::numeric)<>sum(e.credit_cents::numeric)))),
      'unvalidatedForeignKeys',(SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
        WHERE n.nspname IN ('{schema}','banking','accounting','regulatory','ai_sessions') AND c.contype='f' AND NOT c.convalidated),
      'disabledBusinessTriggers',(SELECT count(*) FROM pg_trigger t JOIN pg_class r ON r.oid=t.tgrelid
        JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname IN ('{schema}','banking','accounting','regulatory','ai_sessions')
        AND NOT t.tgisinternal AND t.tgenabled='D'),
      'productionProviders',(SELECT count(*) FROM banking.providers WHERE environment='production' AND status='approved'),
      'pendingReleaseGates',(SELECT count(*) FROM banking.release_gates WHERE state<>'passed'))'''
    ai_sequences = ''' || jsonb_build_object('aiEventSequenceMismatches',(SELECT count(*)
      FROM ai_sessions.sessions s LEFT JOIN
      (SELECT namespace,session_id,max(seq) AS max_seq FROM ai_sessions.events GROUP BY namespace,session_id) e
      ON e.namespace=s.namespace AND e.session_id=s.id
      WHERE s.event_seq<>coalesce(e.max_seq,0)))'''
    sql = ('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\n'
           + optional_query_sql(base, [(_AI_TABLES_PRESENT, ai_sequences)])
           + inventory_sql(schema) + 'COMMIT;')
    rows = psql(env, sql).splitlines()
    if len(rows) != 2:
        raise OperationsError('Unexpected read-only database check result')
    checks, inventory = (json.loads(row) for row in rows)
    failures = ('legacyUnbalancedBatches', 'legacyUnpostedBatches', 'legacyAccountMismatches', 'postedAccountingMismatches', 'unvalidatedForeignKeys', 'disabledBusinessTriggers', 'aiEventSequenceMismatches')
    return {'ok': all(checks.get(name, 0) == 0 for name in failures), 'checks': checks, 'inventory': inventory}


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def verify_manifest(snapshot, root):
    snapshot = inside_root(snapshot, root, exists=True)
    manifest_path = inside_root(str(snapshot) + '.manifest.json', root, exists=True)
    try:
        manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
        if (manifest.get('format') != 'postgresql-custom' or manifest.get('snapshot') != snapshot.name
                or manifest.get('sizeBytes') != snapshot.stat().st_size or manifest.get('sha256') != sha256(snapshot)
                or not isinstance(manifest.get('inventory'), dict)):
            raise ValueError()
        for field in ('createdAt', 'snapshotAt'):
            if dt.datetime.fromisoformat(manifest[field].replace('Z', '+00:00')).tzinfo is None:
                raise ValueError()
        schema_name(manifest['schema'])
    except (OSError, ValueError, KeyError, TypeError):
        raise OperationsError('Backup manifest, file size or SHA256 validation failed') from None
    return manifest


def write_new_json(path, value):
    # Never overwrite a snapshot manifest or recovery record.
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'w', encoding='utf-8') as output:
        json.dump(value, output, ensure_ascii=False, indent=2)
        output.write('\n')
        output.flush()
        os.fsync(output.fileno())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--backup-root')
    parser.add_argument('--schema')
    parser.add_argument('--max-backup-age-hours', type=float, default=2)
    parser.add_argument('--skip-backup', action='store_true', help='Use only for a new installation before its first backup')
    args = parser.parse_args()
    env, schema = pg_environment(), schema_name(args.schema)
    run_cli(['pg_isready', '--quiet', '--timeout=10'], env, timeout=15)
    report = {'checkedAt': utc_now(), **database_checks(env, schema)}
    if not args.skip_backup:
        root = backup_root(args.backup_root)
        manifests = sorted(root.glob('*.dump.manifest.json'), key=lambda path: path.stat().st_mtime, reverse=True)
        if not manifests:
            raise OperationsError('No PostgreSQL dump manifest found')
        snapshot = Path(str(manifests[0]).removesuffix('.manifest.json'))
        manifest = verify_manifest(snapshot, root)
        run_cli(['pg_restore', '--list', str(snapshot)], env)
        created = dt.datetime.fromisoformat(manifest['snapshotAt'].replace('Z', '+00:00'))
        age = (dt.datetime.now(dt.timezone.utc) - created).total_seconds() / 3600
        if age < -0.05 or age > args.max_backup_age_hours:
            raise OperationsError('Latest verified PostgreSQL backup is too old or has a future timestamp')
        report['latestBackup'] = {'file': snapshot.name, 'snapshotAt': manifest['snapshotAt'], 'createdAt': manifest['createdAt'], 'ageHours': round(age, 3), 'sha256Verified': True, 'archiveListReadable': True}
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report['ok'] else 1


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OperationsError, OSError, ValueError, json.JSONDecodeError) as error:
        print(f'PostgreSQL check failed: {error}', file=sys.stderr)
        sys.exit(1)
