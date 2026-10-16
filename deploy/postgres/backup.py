#!/usr/bin/env python3
"""Create a new custom-format PostgreSQL dump and SHA256 inventory manifest."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import uuid
from datetime import datetime, timezone

from check import (OperationsError, backup_root, inside_root, inventory_sql,
                   absolute_path, pg_environment, psql, run_cli, schema_name, sha256,
                   utc_now, verify_manifest, write_new_json)


def snapshot_line(process):
    line = process.stdout.readline().strip()
    if not line:
        raise OperationsError('Could not establish the read-only PostgreSQL snapshot')
    return line


def publish_status(manifest):
    configured = os.environ.get('BANK_PG_STATUS_FILE')
    if not configured:
        return False
    if sys.platform != 'linux' or os.geteuid() != 0:
        raise OperationsError('Publishing backup status requires Linux root')
    import grp
    import pwd
    import stat
    path = absolute_path(configured)
    allowed = Path('/var/lib/luckycat-bank')
    if not path.is_relative_to(allowed) or path == allowed:
        raise OperationsError('Backup status must remain inside /var/lib/luckycat-bank')
    descriptor = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    temporary = '.backup-status-' + uuid.uuid4().hex + '.tmp'
    try:
        info = os.fstat(descriptor)
        if (not stat.S_ISDIR(info.st_mode) or info.st_uid not in (0, pwd.getpwnam('bank').pw_uid)
                or info.st_mode & 0o022):
            raise OperationsError('Backup status parent must be a trusted, non-publicly-writable directory')
        status = {key: manifest[key] for key in ('format', 'snapshot', 'sha256', 'sizeBytes', 'snapshotAt', 'createdAt')}
        status.update({'status': 'ready', 'verifiedAt': utc_now()})
        target = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=descriptor)
        with os.fdopen(target, 'w', encoding='utf-8') as output:
            os.fchown(output.fileno(), 0, grp.getgrnam('bank').gr_gid)
            os.fchmod(output.fileno(), 0o640)
            json.dump(status, output, ensure_ascii=False, indent=2)
            output.write('\n')
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path.name, src_dir_fd=descriptor, dst_dir_fd=descriptor)
        os.fsync(descriptor)
        return True
    finally:
        try:
            os.unlink(temporary, dir_fd=descriptor)
        except FileNotFoundError:
            pass
        os.close(descriptor)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--backup-root')
    parser.add_argument('--output', help='New absolute .dump path within backup-root')
    parser.add_argument('--schema')
    parser.add_argument('--timeout-seconds', type=int, default=3600)
    args = parser.parse_args()
    os.umask(0o077)
    root = backup_root(args.backup_root, create=True)
    schema, env = schema_name(args.schema), pg_environment()
    name = 'bank-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + uuid.uuid4().hex[:12] + '.dump'
    output = inside_root(args.output or str(root / name), root)
    if output.suffix != '.dump':
        raise OperationsError('Backup output must end with .dump')
    manifest_path = Path(str(output) + '.manifest.json')
    partial = Path(str(output) + '.partial')
    if output.exists() or manifest_path.exists() or partial.exists():
        raise OperationsError('Refusing to replace an existing dump, manifest or partial file')
    dump_version = run_cli(['pg_dump', '--version'], env)
    server_version = psql(env, 'SHOW server_version_num;')
    descriptor = os.open(partial, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    os.close(descriptor)
    session = None
    try:
        # Keep an exported snapshot alive so pg_dump and all manifest counts
        # describe exactly the same committed view, even during online writes.
        session = subprocess.Popen(['psql', '-X', '--no-password', '--quiet', '--tuples-only', '--no-align', '--set=ON_ERROR_STOP=1'],
                                   env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, text=True, encoding='utf-8', bufsize=1)
        snapshot_at = utc_now()
        session.stdin.write('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\nSELECT pg_export_snapshot();\n')
        session.stdin.flush()
        snapshot = snapshot_line(session)
        if not re.fullmatch(r'[A-Fa-f0-9-]+', snapshot):
            raise OperationsError('PostgreSQL returned an invalid exported snapshot identifier')
        # inventory_sql uses catalog-directed psql \gexec: optional AI/session
        # tables and bank migration metadata are detected inside this exported
        # snapshot, and absent schemas never appear in parsed business SQL.
        session.stdin.write(inventory_sql(schema) + '\n')
        session.stdin.flush()
        inventory = json.loads(snapshot_line(session))
        run_cli(['pg_dump', '--no-password', '--format=custom', '--lock-wait-timeout=15000',
                 '--snapshot=' + snapshot, '--file=' + str(partial)], env, timeout=args.timeout_seconds)
        run_cli(['pg_restore', '--list', str(partial)], env)
        with partial.open('r+b') as complete:
            os.fsync(complete.fileno())
        manifest = {'format': 'postgresql-custom', 'manifestVersion': 1,
                    'snapshot': output.name, 'snapshotAt': snapshot_at, 'createdAt': utc_now(),
                    'sourceDatabase': env['PGDATABASE'], 'schema': schema,
                    'sizeBytes': partial.stat().st_size, 'sha256': sha256(partial),
                    'serverVersionNum': server_version, 'pgDumpVersion': dump_version,
                    'inventory': inventory,
                    'scope': 'whole single database; roles, keys and server configuration are separate'}
        # A hard link publishes the completed dump without replacing any file.
        os.link(partial, output)
        partial.unlink()
        write_new_json(manifest_path, manifest)
        verify_manifest(output, root)
        status_published = publish_status(manifest)
        print(json.dumps({'ok': True, 'snapshot': str(output), 'manifest': str(manifest_path),
                          'snapshotAt': snapshot_at, 'sizeBytes': manifest['sizeBytes'],
                          'sha256': manifest['sha256'], 'statusPublished': status_published}, ensure_ascii=False, indent=2))
        return 0
    finally:
        if session is not None:
            try:
                session.communicate('ROLLBACK;\n', timeout=10)
            except (OSError, subprocess.TimeoutExpired):
                session.kill()
                session.communicate()


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OperationsError, OSError, ValueError, json.JSONDecodeError):
        print('PostgreSQL backup failed; no existing backup was overwritten. Inspect protected database logs and any .partial file.', file=sys.stderr)
        sys.exit(1)
