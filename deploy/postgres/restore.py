#!/usr/bin/env python3
"""Restore a verified dump only into an explicitly named, new isolated database."""
import argparse
import json
import os
from pathlib import Path
import re
import sys

from check import (OperationsError, backup_root, database_checks, inside_root,
                   pg_environment, psql, run_cli, utc_now, verify_manifest,
                   write_new_json)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot', required=True, help='Existing absolute .dump path inside backup-root')
    parser.add_argument('--target-database', required=True, help='Unused name starting bank_restore_')
    parser.add_argument('--backup-root')
    parser.add_argument('--maintenance-database', default='postgres')
    parser.add_argument('--timeout-seconds', type=int, default=3600)
    args = parser.parse_args()
    os.umask(0o077)
    target = args.target_database
    if not re.fullmatch(r'bank_restore_[a-z0-9_]{1,45}', target):
        raise OperationsError('Target must be a new isolated name matching bank_restore_[a-z0-9_]{1,45}')
    if not re.fullmatch(r'[a-z_][a-z0-9_]{0,62}', args.maintenance_database):
        raise OperationsError('Invalid maintenance database name')
    root = backup_root(args.backup_root)
    snapshot = inside_root(args.snapshot, root, exists=True)
    manifest = verify_manifest(snapshot, root)
    original = pg_environment()
    if target in (original['PGDATABASE'], manifest['sourceDatabase'], args.maintenance_database):
        raise OperationsError('Recovery target must differ from source and maintenance databases')
    maintenance = pg_environment(args.maintenance_database)
    run_cli(['pg_restore', '--list', str(snapshot)], maintenance)
    if psql(maintenance, f"SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname='{target}');") != 'f':
        raise OperationsError('Target database already exists; refusing to alter or drop it')
    record_path = Path(str(snapshot) + '.' + target + '.restore.json')
    if record_path.exists():
        raise OperationsError('A recovery record already exists for this target')
    record = {'startedAt': utc_now(), 'sourceSnapshot': snapshot.name, 'sha256': manifest['sha256'],
              'targetDatabase': target, 'productionSwitched': False, 'ok': False}
    created = False
    try:
        run_cli(['createdb', '--no-password', '--template=template0',
                 '--maintenance-db=' + args.maintenance_database, '--', target], maintenance)
        created = True
        psql(maintenance, f'REVOKE ALL PRIVILEGES ON DATABASE "{target}" FROM PUBLIC;')
        recovered = pg_environment(target)
        # No --clean, --create, --disable-triggers or automatic production switch.
        run_cli(['pg_restore', '--no-password', '--no-owner', '--no-privileges',
                 '--exit-on-error', '--single-transaction', '--dbname=' + target, str(snapshot)],
                recovered, timeout=args.timeout_seconds)
        report = database_checks(recovered, manifest['schema'])
        matches = report['inventory'] == manifest['inventory']
        record.update({'finishedAt': utc_now(), 'inventoryMatchesSnapshot': matches,
                       'databaseChecks': report, 'ok': report['ok'] and matches})
        if not record['ok']:
            raise OperationsError('Recovered database failed inventory or accounting checks; isolated database retained')
        write_new_json(record_path, record)
        print(json.dumps({'ok': True, 'targetDatabase': target, 'record': str(record_path),
                          'productionSwitched': False,
                          'nextStep': 'Validate application decryption and partner-bank reconciliation before an independently approved switch'},
                         ensure_ascii=False, indent=2))
        return 0
    except Exception:
        record.update({'finishedAt': utc_now(), 'targetCreated': created,
                       'error': 'Recovery failed; existing production database was not modified; isolated target retained if created'})
        if not record_path.exists():
            write_new_json(record_path, record)
        raise


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OperationsError, OSError, ValueError, KeyError, json.JSONDecodeError):
        print('PostgreSQL restore failed; no production database was overwritten. Check the protected recovery record and database logs.', file=sys.stderr)
        sys.exit(1)
