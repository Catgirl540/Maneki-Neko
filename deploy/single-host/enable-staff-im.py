#!/usr/bin/env python3
"""One-time staff IM repair for the existing 20261029 unified release.

Run as root: --check-only [--package-dir DIR], or --apply --package-dir DIR.
The package contains framework/bridge/{demo-server,im-availability}.mjs,
staff/src/pages/im/StaffImPage.tsx, and staff-dist/{index.html,assets/}.
No schema migration, database restore, or IM/session-state replacement is done.
"""
import argparse
import base64
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import time
import urllib.parse
import urllib.request
import uuid


SOURCE = Path('/srv/maneki-bank/releases/20261029-unified-environment')
WEB = Path('/var/www/bank.waveflow.men/releases/20261029-unified-environment')
CONFIG = Path('/etc/maneki-vps2/staff-im.env')
BANK, STAFF = 'luckycat-bank-demo', 'luckycat-staff-agent'
UNITS = {name: Path('/etc/systemd/system') / (name + '.service.d/zz-staff-im.conf')
         for name in (BANK, STAFF)}
DATABASE = 'maneki_bank_demo'
NODE = '/opt/maneki-node24/bin/node'
PUBLIC_URL = 'https://bank.waveflow.men'
IM_TABLES = ['staff_im_' + name for name in
             ('bindings', 'preferences', 'rules', 'outbox', 'cycles', 'notifications', 'attempts')]
EXPECTED = {
    'framework/bridge/demo-server.mjs': '792c45814e24fff5da1af95b49855d950e2f243a5855c76ea7efc9933de71e41',
    'framework/bridge/im-http.mjs': '78faca8ba85d64b84e1716f334e35468f17a30947b00e88fcb62e07efc048433',
    'server/staff-im-schema.sql': 'c7500999386844b72c8de57d263bf2353020ebd50070efa27ec66a306faa1975',
}
SOURCES = ('framework/bridge/demo-server.mjs', 'framework/bridge/im-availability.mjs',
           'staff/src/pages/im/StaffImPage.tsx')


class CheckError(Exception):
    pass


def require(condition, message):
    if not condition:
        raise CheckError(message)


def run(args, *, data=None, timeout=90, check=True):
    result = subprocess.run(args, input=data, capture_output=True, text=True, timeout=timeout)
    require(not check or result.returncode == 0, 'Command failed: ' + Path(args[0]).name)
    return result.stdout.strip()


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def ordinary_path(path):
    require(not path.is_symlink() and path.resolve() == path, 'Unexpected symlink: ' + str(path))


def process_env(service):
    pid = run(['systemctl', 'show', service, '-p', 'MainPID', '--value'])
    require(pid.isdigit() and pid != '0', 'Service is not running: ' + service)
    require(run(['systemctl', 'is-active', service]) == 'active', 'Service is not active: ' + service)
    expected = SOURCE / 'framework' if service == STAFF else SOURCE
    require(Path('/proc', pid, 'cwd').resolve() == expected, 'Unexpected service working directory')
    command = Path('/proc', pid, 'cmdline').read_bytes().split(b'\0')
    entry = 'bridge/staff-server.mjs' if service == STAFF else 'server/index.mjs'
    require(any((expected / argument.decode(errors='replace')).resolve() == expected / entry
                for argument in command if argument and not argument.startswith(b'-')),
            'Unexpected service entry point')
    return dict(item.split('=', 1) for item in
                Path('/proc', pid, 'environ').read_text().split('\0') if '=' in item)


def pg(query):
    return run(['runuser', '-u', 'postgres', '--', 'psql', '-X', '-At', '-v',
                'ON_ERROR_STOP=1', '-d', DATABASE], data=query)


def session_directory(env):
    return Path(env.get('LUCKYCAT_SESSION_DIR', str(SOURCE / 'framework/.dsh-home/staff-context'))).resolve()


def check_environment(bank, staff):
    database = urllib.parse.urlparse(bank.get('BANK_DATABASE_URL', ''))
    require(database.scheme in ('postgres', 'postgresql') and database.path == '/' + DATABASE
            and database.username == 'maneki_app', 'Unexpected bank database or runtime role')
    require(bank.get('BANK_AUTO_MIGRATE') == 'false', 'Automatic database migration must remain disabled')
    require(staff.get('LUCKYCAT_BANK_URL') == 'http://127.0.0.1:8081', 'Unexpected staff bank URL')
    require(staff.get('LUCKYCAT_SESSION_NAMESPACE') == 'staff'
            and staff.get('LUCKYCAT_AUDIENCE') in (None, 'staff')
            and staff.get('LUCKYCAT_STAFF_MODE') != 'ops', 'Unexpected staff audience or namespace')
    require(urllib.parse.urlparse(staff.get('LUCKYCAT_SESSION_DATABASE_URL', '')).path == '/' + DATABASE,
            'Unexpected staff session database')
    key = staff.get('LUCKYCAT_SESSION_DATA_KEY', '')
    try:
        decoded = base64.b64decode(key, validate=True)
        valid = len(decoded) == 32 and base64.b64encode(decoded).decode() == key
    except ValueError:
        valid = False
    require(valid, 'Existing staff session encryption key is invalid')
    require(session_directory(staff).is_dir(), 'Existing staff state directory is missing')
    left, right = bank.get('LUCKYCAT_STAFF_IM_SERVICE_KEY'), staff.get('LUCKYCAT_STAFF_IM_SERVICE_KEY')
    require((not left and not right) or
            (left == right and len(left.encode()) >= 32 and '\n' not in left and '\0' not in left),
            'Existing staff IM service keys are incomplete, different, or invalid')


def preflight(package):
    require(SOURCE.resolve(strict=True) == SOURCE and WEB.resolve(strict=True) == WEB,
            'Unexpected release directories')
    require(Path('/srv/maneki-bank/current').resolve(strict=True) == SOURCE
            and Path('/var/www/bank.waveflow.men/current').resolve(strict=True) == WEB,
            'Current releases do not match this one-time repair')
    for relative, expected in EXPECTED.items():
        ordinary_path(SOURCE / relative)
        require(sha(SOURCE / relative) == expected, 'Unexpected original hash: ' + relative)
    for target in [*(SOURCE / path for path in SOURCES), WEB / 'staff/index.html', CONFIG, *UNITS.values()]:
        ordinary_path(target)
        require(not target.exists() or target.is_file(), 'Expected a regular target file')
    envs = {name: process_env(name) for name in (BANK, STAFF)}
    check_environment(envs[BANK], envs[STAFF])
    tables = ','.join("'" + name + "'" for name in IM_TABLES)
    require(pg("SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename IN (" + tables + ')') == '7',
            'The seven existing staff IM tables are required; no migration is allowed')
    require(pg("SELECT has_schema_privilege('maneki_app','public','USAGE') AND bool_and("
               "has_table_privilege('maneki_app','public.'||tbl,priv)) FROM unnest(ARRAY[" + tables +
               "]) t(tbl) CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) p(priv)") == 't',
            'maneki_app lacks required staff IM table privileges')
    require(pg("SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgenabled='O' AND tgname IN "
               "('staff_im_tickets','staff_im_messages','staff_im_approvals') "
               "AND tgfoid='public.staff_im_task_events()'::regprocedure") == '3',
            'Existing staff IM event triggers are missing or disabled')
    require(pg('SELECT count(*) FROM staff_im_bindings') == '0'
            and pg('SELECT count(*) FROM staff_im_notifications') == '0',
            'Existing staff IM workload requires a separate repair plan')
    manifest = {}
    if package:
        ordinary_path(package / 'manifest.json')
        declared = json.loads((package / 'manifest.json').read_text())
        require(isinstance(declared, dict) and declared, 'Package manifest must be a nonempty path-to-SHA256 dictionary')
        for relative, digest in declared.items():
            require(isinstance(relative, str) and not relative.startswith('/') and '\\' not in relative
                    and '..' not in Path(relative).parts and isinstance(digest, str)
                    and re.fullmatch(r'[a-f0-9]{64}', digest), 'Invalid package manifest entry')
            require(relative in SOURCES or relative.startswith('staff-dist/'), 'Unexpected package content')
            path = package / relative
            ordinary_path(path)
            require(path.is_file() and sha(path) == digest, 'Package SHA256 mismatch: ' + relative)
        files = {path.relative_to(package).as_posix() for path in package.rglob('*') if path.is_file()
                 and path != package / 'manifest.json'}
        require(files == set(declared), 'Package files do not match manifest')
        for relative in SOURCES:
            path = package / relative
            ordinary_path(path)
            require(path.is_file(), 'Package source is missing: ' + relative)
            manifest[relative] = sha(path)
        for relative in SOURCES[:2]:
            run([NODE, '--check', str(package / relative)])
        index, assets = package / 'staff-dist/index.html', package / 'staff-dist/assets'
        ordinary_path(index)
        ordinary_path(assets)
        require(index.is_file() and assets.is_dir(), 'Package must contain staff-dist/index.html and assets')
        manifest['staff-dist/index.html'] = sha(index)
        for asset in sorted(assets.rglob('*')):
            ordinary_path(asset)
            if not asset.is_file():
                require(asset.is_dir(), 'Unexpected asset entry')
                continue
            relative = asset.relative_to(package / 'staff-dist')
            target = WEB / 'staff' / relative
            ordinary_path(target)
            require(not target.exists() or (target.is_file() and sha(target) == sha(asset)),
                    'An existing staff asset would be overwritten')
            manifest['staff-dist/' + relative.as_posix()] = sha(asset)
        refs = re.findall(r'(?:src|href)=[\"\'](/staff/assets/[^\"\']+)[\"\']', index.read_text())
        require(refs and all('..' not in Path(ref).parts and
                            ('staff-dist/' + ref.removeprefix('/staff/')) in manifest for ref in refs),
                'Staff index contains missing assets or an unexpected base path')
        require(all(declared.get(relative) == digest for relative, digest in manifest.items()),
                'Deployable package files do not match manifest')
        manifest = declared
    return envs, manifest


def atomic_write(path, data, mode=0o644, uid=0, gid=0):
    ordinary_path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
    temporary = path.with_name(path.name + '.staff-im-' + uuid.uuid4().hex)
    try:
        with temporary.open('xb') as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        os.chmod(temporary, mode)
        os.chown(temporary, uid, gid)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def health(port, path, staff=False):
    for _ in range(60):
        try:
            with urllib.request.urlopen('http://127.0.0.1:' + str(port) + path, timeout=2) as response:
                body = response.read()
                if staff:
                    valid = b'data-audience="staff"' in body and b'/staff-agent-api/im/portal.js' in body
                else:
                    data = json.loads(body)
                    valid = data.get('ok') and data.get('integrationMode') == 'sandbox' and data.get('commercialReady') is False
                if response.status == 200 and valid:
                    return
        except (OSError, ValueError):
            pass
        time.sleep(0.5)
    raise CheckError('Startup health check failed on port ' + str(port))


def apply(package, envs, manifest):
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    backup = Path('/var/backups/maneki-staff-im-' + stamp)
    backup.mkdir(mode=0o700)
    report = {'phase': 'backup', 'backup': str(backup), 'database': DATABASE,
              'schemaMigration': False, 'databaseRestore': False, 'packageSha256': manifest,
              'authenticatedBindingsCheck': 'pending separate verification with a valid employee token'}
    originals, mutated = {}, False

    def save():
        atomic_write(backup / 'report.json', (json.dumps(report, indent=2) + '\n').encode(), 0o600)

    def remember(path):
        ordinary_path(path)
        if not path.exists():
            originals[path] = None
            return
        stat = path.stat()
        saved = backup / 'originals' / str(path).lstrip('/')
        atomic_write(saved, path.read_bytes(), 0o600)
        originals[path] = {'file': str(saved), 'mode': stat.st_mode & 0o7777, 'uid': stat.st_uid, 'gid': stat.st_gid}

    def replace(path, data, mode=None, root_owned=False):
        original = originals.get(path)
        atomic_write(path, data, mode if mode is not None else original['mode'] if original else 0o644,
                     original['uid'] if original and not root_owned else 0,
                     original['gid'] if original and not root_owned else 0)

    try:
        for path in [*(SOURCE / relative for relative in SOURCES), WEB / 'staff/index.html', CONFIG, *UNITS.values()]:
            remember(path)
        (backup / 'originals.json').write_text(json.dumps({str(path): value for path, value in originals.items()}, indent=2) + '\n')
        dump = backup / (DATABASE + '.dump')
        with dump.open('xb') as output:
            result = subprocess.run(['runuser', '-u', 'postgres', '--', 'pg_dump', '--format=custom', '--dbname=' + DATABASE],
                                    stdout=output, stderr=subprocess.PIPE, timeout=180)
        require(result.returncode == 0, 'Database backup failed')
        require('TABLE DATA public staff_im_bindings' in run(['pg_restore', '--list', str(dump)]),
                'Database backup validation failed')
        report['databaseDumpSha256'] = sha(dump)
        save()
        # Do not apply against a release, process configuration, or package changed after preflight.
        current_envs, current_manifest = preflight(package)
        require(current_envs == envs and current_manifest == manifest, 'Preflight inputs changed before apply')
        key = envs[BANK].get('LUCKYCAT_STAFF_IM_SERVICE_KEY') or secrets.token_urlsafe(48)
        common = ''.join(name + '=' + json.dumps(value) + '\n' for name, value in {
            'LUCKYCAT_STAFF_IM_SERVICE_KEY': key, 'LUCKYCAT_STAFF_IM_PUBLIC_URL': PUBLIC_URL}.items())
        report['phase'] = 'installing'; save()
        mutated = True
        replace(CONFIG, common.encode(), 0o600, root_owned=True)
        for service, path in UNITS.items():
            body = '[Service]\nEnvironmentFile=' + str(CONFIG) + '\n'
            if service == STAFF:
                body += 'Environment=LUCKYCAT_STAFF_IM_ENABLED=1\nEnvironment=LUCKYCAT_STAFF_IM_NOTIFICATIONS_ENABLED=1\n'
            replace(path, body.encode(), 0o644, root_owned=True)
        for relative in SOURCES:
            replace(SOURCE / relative, (package / relative).read_bytes())
        # Existing fingerprinted assets are immutable; add the new files before switching the index.
        for relative in manifest:
            if relative.startswith('staff-dist/assets/'):
                asset = Path(relative).relative_to('staff-dist')
                target = WEB / 'staff' / asset
                if not target.exists():
                    atomic_write(target, (package / relative).read_bytes())
        run(['systemctl', 'daemon-reload'])
        run(['systemctl', 'restart', BANK])
        health(8081, '/health')
        run(['systemctl', 'restart', STAFF])
        health(8789, '/agent-api/im', staff=True)
        after = {name: process_env(name) for name in (BANK, STAFF)}
        for name in (BANK, STAFF):
            expected_env = {**envs[name], 'LUCKYCAT_STAFF_IM_SERVICE_KEY': key,
                            'LUCKYCAT_STAFF_IM_PUBLIC_URL': PUBLIC_URL}
            if name == STAFF:
                expected_env.update(LUCKYCAT_STAFF_IM_ENABLED='1', LUCKYCAT_STAFF_IM_NOTIFICATIONS_ENABLED='1')
            # systemd may change invocation metadata; preserve every pre-existing application setting.
            expected_env = {k: v for k, v in expected_env.items() if k.startswith(('BANK_', 'LUCKYCAT_', 'DSH_'))}
            require(all(after[name].get(k) == v for k, v in expected_env.items()), 'Application configuration changed unexpectedly')
        require(session_directory(after[STAFF]) == session_directory(envs[STAFF]), 'Staff state directory changed')
        for relative in ('framework/bridge/im-http.mjs', 'server/staff-im-schema.sql'):
            require(sha(SOURCE / relative) == EXPECTED[relative], 'An out-of-scope source file changed')
        replace(WEB / 'staff/index.html', (package / 'staff-dist/index.html').read_bytes())
        time.sleep(2)
        for service in (BANK, STAFF):
            require(run(['systemctl', 'is-active', service]) == 'active', 'Service failed after startup')
        report.update(phase='applied', portal='200 with staff audience marker',
                      preservedStaffState=True, preservedSessionKey=True,
                      completedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
        save()
        print(json.dumps(report))
    except BaseException as error:
        report.update(phase='failed', error=str(error) if isinstance(error, CheckError) else type(error).__name__)
        if mutated:
            try:
                run(['systemctl', 'stop', STAFF, BANK], check=False)
                for path, original in reversed(list(originals.items())):
                    if original is None:
                        path.unlink(missing_ok=True)
                    else:
                        atomic_write(path, Path(original['file']).read_bytes(), original['mode'], original['uid'], original['gid'])
                run(['systemctl', 'daemon-reload'])
                run(['systemctl', 'restart', BANK]); health(8081, '/health')
                run(['systemctl', 'restart', STAFF])
                require(run(['systemctl', 'is-active', STAFF]) == 'active', 'Old staff service did not recover')
                report['previousFilesAndServicesRestored'] = True
            except BaseException as recovery:
                report['recoveryError'] = str(recovery) if isinstance(recovery, CheckError) else type(recovery).__name__
        save()
        print(json.dumps(report))
        raise SystemExit(1) from None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--check-only', action='store_true')
    mode.add_argument('--apply', action='store_true')
    parser.add_argument('--package-dir', type=Path)
    args = parser.parse_args()
    require(os.name == 'posix' and os.geteuid() == 0, 'Run only as root on the deployed Linux host')
    os.umask(0o077)
    require(not args.apply or args.package_dir, '--apply requires --package-dir')
    package = args.package_dir.resolve(strict=True) if args.package_dir else None
    envs, manifest = preflight(package)
    if args.check_only:
        print(json.dumps({'preflight': 'passed', 'source': str(SOURCE), 'web': str(WEB),
                          'database': DATABASE, 'runtimeRole': 'maneki_app', 'staffImTables': 7,
                          'schemaMigration': False, 'existingServiceKey': bool(envs[BANK].get('LUCKYCAT_STAFF_IM_SERVICE_KEY')),
                          'packageSha256': manifest}))
        return
    apply(package, envs, manifest)


if __name__ == '__main__':
    try:
        main()
    except CheckError as error:
        print(json.dumps({'preflight': 'failed', 'error': str(error)}))
        raise SystemExit(1) from None
