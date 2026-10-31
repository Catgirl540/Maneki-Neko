#!/usr/bin/env python3
"""One-time 2026-10-29 cutover to the existing public sandbox, preserving both databases.

Run as root on the deployed host after staging a complete source/web release.
No database is restored or deleted. A failure after public cutover requires forward repair.
"""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import subprocess
import tarfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

NODE = '/opt/maneki-node24/bin/node'
CONFIG = Path('/etc/maneki-vps2')
SOURCE_LINK = Path('/srv/maneki-bank/current')
WEB_LINK = Path('/var/www/bank.waveflow.men/current')
NGINX = Path('/etc/nginx/maneki-locations.conf')
SUMMARY = Path('/home/ubuntu/unify-environments-20261029-summary.json')
SERVICES = ['luckycat-agent-demo', 'luckycat-staff-agent', 'luckycat-ops-agent', 'luckycat-bank-demo', 'luckycat-bank']
ACTIVE = ['luckycat-bank-demo', 'luckycat-agent-demo', 'luckycat-staff-agent', 'luckycat-ops-agent']
DATABASES = ['maneki_bank', 'maneki_bank_demo']
ROLES = {'staff_wang': ('csr', 'BANK_CSR_PASSWORD'), 'staff_li': ('supervisor', 'BANK_SUPERVISOR_PASSWORD'), 'staff_ops': ('ops', 'BANK_OPS_PASSWORD')}


def run(args, *, data=None, env=None, cwd=None, timeout=90, check=True, binary=False):
    result = subprocess.run(args, input=data, env=env, cwd=cwd, timeout=timeout,
                            capture_output=True, text=not binary)
    if check and result.returncode:
        # Commands may handle secrets in stdin/env. Never put them in error output.
        raise RuntimeError('Command failed: ' + Path(args[0]).name)
    return result.stdout if binary else result.stdout.strip()


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def pg(database, query):
    return run(['runuser', '-u', 'postgres', '--', 'psql', '-X', '-At', '-v', 'ON_ERROR_STOP=1', '-d', database], data=query)


def service_env(service):
    pid = run(['systemctl', 'show', service, '-p', 'MainPID', '--value'])
    if not pid.isdigit() or pid == '0':
        raise RuntimeError('Required service is not running: ' + service)
    return dict(part.split('=', 1) for part in Path('/proc', pid, 'environ').read_text().split('\0') if '=' in part)


def rows(database, table):
    return json.loads(pg(database, "SELECT COALESCE(json_agg(t),'[]'::json) FROM (SELECT * FROM " + table + ') t'))


def snapshot(database):
    tables = pg(database, "SELECT schemaname||'.'||tablename FROM pg_tables WHERE schemaname IN ('public','banking','accounting','regulatory','ai_sessions') ORDER BY 1").splitlines()
    result = {}
    for table in tables:
        if not re.fullmatch(r'[a-z_]+\.[a-z_]+', table):
            raise RuntimeError('Unexpected table identifier')
        quoted = '.'.join('"' + item + '"' for item in table.split('.'))
        body = pg(database, 'COPY (SELECT row_to_json(t)::text FROM ' + quoted + ' t ORDER BY row_to_json(t)::text) TO STDOUT').encode()
        result[table] = {'rows': len(body.splitlines()), 'sha256': hashlib.sha256(body).hexdigest()}
    return result


def replace_link(link, destination):
    temporary = link.with_name(link.name + '.unify-' + uuid.uuid4().hex)
    temporary.symlink_to(destination)
    temporary.replace(link)


def http(port, path):
    try:
        with urllib.request.urlopen('http://127.0.0.1:' + str(port) + path, timeout=4) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read())


def wait_http(port, path, allowed):
    for _ in range(40):
        try:
            status, body = http(port, path)
            if status in allowed:
                return body
        except (OSError, ValueError):
            pass
        time.sleep(0.5)
    raise RuntimeError('Service health check failed on port ' + str(port))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--web', required=True, type=Path)
    parser.add_argument('--check-only', action='store_true')
    args = parser.parse_args()
    if os.name != 'posix' or os.geteuid() != 0:
        raise SystemExit('Run only as root on the deployed Ubuntu host')
    os.umask(0o077)
    source, web = args.source.resolve(strict=True), args.web.resolve(strict=True)
    old_source, old_web = SOURCE_LINK.resolve(strict=True), WEB_LINK.resolve(strict=True)
    require(source.parent == Path('/srv/maneki-bank/releases') and web.parent == Path('/var/www/bank.waveflow.men/releases'), 'Unexpected staged release location')
    require(source != old_source and web != old_web and source.name == web.name, 'A new matched source/web release is required')
    require((source / 'server/index.mjs').is_file() and (web / 'staff/index.html').is_file(), 'Incomplete staged release')
    require(not (CONFIG / 'enable-archived-live-writer').exists(), 'Archive writer override must be absent')
    envs = {service: service_env(service) for service in SERVICES}
    for service in SERVICES:
        pid = run(['systemctl', 'show', service, '-p', 'MainPID', '--value'])
        expected_cwd = old_source / 'framework' if 'agent' in service else old_source
        require(Path('/proc', pid, 'cwd').resolve() == expected_cwd, 'Running service does not match the current source release')
    live, demo = envs['luckycat-bank'], envs['luckycat-bank-demo']
    for service, database in zip(['luckycat-bank', 'luckycat-bank-demo'], DATABASES):
        require(urllib.parse.urlparse(envs[service]['BANK_DATABASE_URL']).path == '/' + database, 'Unexpected database mapping')
        require(envs[service].get('BANK_AUTO_MIGRATE') == 'false', 'Automatic schema migrations must be off')
        require(pg(database, 'SELECT max(version) FROM bank_schema_migrations') == '2026102701', 'Unexpected database schema')
    require(run(['systemctl', 'is-active', 'luckycat-bridge'], check=False) != 'active', 'Retired customer bridge is still active')
    run(['nginx', '-t'])
    source_staff = {row['id']: row for row in rows('maneki_bank', 'staff_users')}
    target_staff = {row['id']: row for row in rows('maneki_bank_demo', 'staff_users')}
    require(set(source_staff) == set(ROLES), 'Unexpected live staff identities require separate review')
    for identity, (role, _) in ROLES.items():
        require(identity in target_staff and source_staff[identity]['name'] == target_staff[identity]['name'] and source_staff[identity]['role'] == target_staff[identity]['role'] == role, 'Conflicting staff identity')
    verification = """import {verifyPassword} from './server/passwords.mjs';
      let text=''; for await(const chunk of process.stdin) text+=chunk;
      // Successful-login rehashing may have upgraded the public demo password's hash.
      // Accept the existing credential without changing its hash or claiming a password upgrade.
      for(const row of JSON.parse(text)) if(!verifyPassword(process.env[row.credential],row.password_hash) && !verifyPassword('123456',row.password_hash)) process.exit(3);
      if(process.env.BANK_OPS_PASSWORD.length<12) process.exit(4);"""
    run([NODE, '--input-type=module', '-e', verification], data=json.dumps([{**row, 'credential': ROLES[key][1]} for key, row in source_staff.items()]), env=live, cwd=old_source)
    left = {row['id']: row['phone'] for row in rows('maneki_bank', 'customers')}
    right = {row['id']: row['phone'] for row in rows('maneki_bank_demo', 'customers')}
    require(all(right.get(key) == value for key, value in left.items()), 'Unmatched live customer requires an explicit data migration')
    for table in ['tickets', 'approvals', 'staff_im_bindings', 'ai_sessions.sessions', 'ai_sessions.events', 'ai_sessions.imports']:
        require(int(pg('maneki_bank', 'SELECT count(*) FROM ' + table)) == 0, 'Nonempty live staff workload requires explicit migration')
    require(int(pg('maneki_bank_demo', "SELECT count(*) FROM ai_sessions.sessions WHERE namespace IN ('staff','ops')")) == 0, 'Target staff session namespaces must be empty')
    require(int(pg('maneki_bank_demo', "SELECT count(*) FROM ai_sessions.imports WHERE namespace IN ('staff','ops')")) == 0, 'Target staff session imports must be empty')
    for service in ['luckycat-staff-agent', 'luckycat-ops-agent']:
        require(urllib.parse.urlparse(envs[service]['LUCKYCAT_SESSION_DATABASE_URL']).path == '/maneki_bank', 'Unexpected staff session database')
    if args.check_only:
        print(json.dumps({'preflight': 'passed', 'source': str(source), 'web': str(web), 'staffIdentities': len(source_staff), 'liveCustomersAlreadyPresent': len(left), 'targetCustomers': len(right)}))
        return

    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    backup = Path('/var/backups/maneki-unify-' + stamp)
    backup.mkdir(mode=0o700)
    report = {'release': source.name, 'startedAt': stamp, 'oldSource': str(old_source), 'oldWeb': str(old_web), 'newSource': str(source), 'newWeb': str(web), 'backup': str(backup), 'schemaMigration': False, 'databases': {}, 'phase': 'preflight', 'publicSwitched': False}
    originals, stopped = {}, False

    def save():
        (backup / 'report.json').write_text(json.dumps(report, indent=2) + '\n')

    def write(path, body, mode=0o600):
        originals.setdefault(path, path.read_bytes() if path.exists() else None)
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_name(path.name + '.unify-' + uuid.uuid4().hex)
        temporary.write_text(body)
        temporary.chmod(mode)
        temporary.replace(path)

    def overlay(path, values):
        # JSON strings are valid systemd EnvironmentFile quoted values.
        write(path, ''.join(key + '=' + json.dumps(value, ensure_ascii=False) + '\n' for key, value in values.items()))

    try:
        save()
        stopped = True
        report['phase'] = 'stopping-services'
        save()
        run(['systemctl', 'stop', *SERVICES], timeout=90)
        require(all(run(['systemctl', 'show', service, '-p', 'MainPID', '--value']) == '0' for service in SERVICES), 'Service did not stop')
        # Close the preflight-to-stop race before copying any credentials or configuration.
        require({row['id']: row for row in rows('maneki_bank', 'staff_users')} == source_staff, 'Live staff changed during preflight')
        require({row['id']: row for row in rows('maneki_bank_demo', 'staff_users')} == target_staff, 'Target staff changed during preflight')
        for table in ['tickets', 'approvals', 'staff_im_bindings', 'ai_sessions.sessions', 'ai_sessions.events', 'ai_sessions.imports']:
            require(int(pg('maneki_bank', 'SELECT count(*) FROM ' + table)) == 0, 'Live staff workload changed during preflight')
        current_left = {row['id']: row['phone'] for row in rows('maneki_bank', 'customers')}
        current_right = {row['id']: row['phone'] for row in rows('maneki_bank_demo', 'customers')}
        require(current_left == left and current_right == right and all(current_right.get(key) == value for key, value in current_left.items()), 'Customer identities changed during preflight')
        for table in ['ai_sessions.sessions', 'ai_sessions.imports']:
            require(int(pg('maneki_bank_demo', "SELECT count(*) FROM " + table + " WHERE namespace IN ('staff','ops')")) == 0, 'Target staff session namespaces changed during preflight')
        report['phase'] = 'backing-up'
        save()
        with tarfile.open(backup / 'configuration-and-agent-state.tar.gz', 'w:gz', dereference=False) as archive:
            for path in ['/etc/maneki-vps2', '/etc/systemd/system', '/etc/nginx', '/var/lib/luckycat-agent', '/srv/maneki-bank/shared']:
                if Path(path).exists():
                    archive.add(path, arcname=path.lstrip('/'))
        before = {}
        for database in DATABASES:
            dump = run(['runuser', '-u', 'postgres', '--', 'pg_dump', '--format=custom', '--dbname=' + database], timeout=180, binary=True)
            path = backup / (database + '.dump')
            path.write_bytes(dump)
            require('TABLE DATA public bank_accounts' in run(['pg_restore', '--list', str(path)]), 'Invalid database dump')
            before[database] = snapshot(database)
            report['databases'][database] = {'dumpSha256': hashlib.sha256(dump).hexdigest(), 'before': before[database]}
        report['phase'] = 'backed-up'
        save()
        print(json.dumps({'phase': report['phase'], 'backup': str(backup)}), flush=True)

        identities = [{**row, 'next_auth_version': max(row['auth_version'], target_staff[key]['auth_version']) + 1} for key, row in source_staff.items()]
        payload = json.dumps(identities)
        delimiter = '$unify_' + uuid.uuid4().hex + '$'
        # No credentials are passed in command arguments or logs.
        pg('maneki_bank_demo', 'BEGIN; CREATE TEMP TABLE merge_staff ON COMMIT DROP AS SELECT * FROM jsonb_to_recordset(' + delimiter + payload + delimiter + '::jsonb) AS x(id text,name text,role text,password_hash text,next_auth_version bigint); '
           'UPDATE staff_users t SET password_hash=s.password_hash FROM merge_staff s WHERE t.id=s.id AND t.name=s.name AND t.role=s.role; '
           'UPDATE staff_users t SET auth_version=s.next_auth_version FROM merge_staff s WHERE t.id=s.id; '
           "INSERT INTO audit_logs(id,actor_type,actor_id,action,target_type,target_id,result,reason,created_at) VALUES('environment-unify-" + stamp + "','system',NULL,'environment.unify','environment','public-sandbox','ok','Unified staff routes and preserved original staff credentials; legacy database retained as historical evidence',CURRENT_TIMESTAMP::text); COMMIT;")
        report['staffCredentialsPreserved'] = sorted(source_staff)
        report['credentialChangeCommitted'] = True
        report['phase'] = 'credentials-preserved'
        save()

        values = {key: value for key, value in live.items() if key in ['BANK_CSR_PASSWORD', 'BANK_SUPERVISOR_PASSWORD', 'BANK_OPS_PASSWORD', 'LUCKYCAT_STAFF_IM_SERVICE_KEY', 'LUCKYCAT_STAFF_IM_NOTIFY_URL', 'LUCKYCAT_STAFF_IM_PUBLIC_URL'] or key.startswith('BANK_OPS_')}
        values.update(BANK_RELEASE=source.name, BANK_CLIENT_HEALTH_URL='https://bank.waveflow.men/', BANK_STAFF_HEALTH_URL='https://bank.waveflow.men/staff/', BANK_AGENT_HEALTH_URL='http://127.0.0.1:8891/agent-api/health')
        overlay(CONFIG / 'bank-unified.env', values)
        write(Path('/etc/systemd/system/luckycat-bank-demo.service.d/95-unified.conf'), '[Unit]\nDescription=Luckycat unified public bank (sandbox)\n[Service]\nEnvironmentFile=/etc/maneki-vps2/bank-unified.env\n', 0o644)
        for namespace in ['staff', 'ops']:
            service = 'luckycat-' + namespace + '-agent'
            url = urllib.parse.urlparse(envs[service]['LUCKYCAT_SESSION_DATABASE_URL'])._replace(path='/maneki_bank_demo').geturl()
            overlay(CONFIG / ('agent-unified-' + namespace + '.env'), {'LUCKYCAT_BANK_URL': 'http://127.0.0.1:8081', 'LUCKYCAT_SESSION_DATABASE_URL': url, 'LUCKYCAT_SESSION_NAMESPACE': namespace})
            write(Path('/etc/systemd/system/' + service + '.service.d/95-unified.conf'), '[Unit]\nRequires=\nRequires=luckycat-bank-demo.service\nAfter=\nAfter=network-online.target luckycat-bank-demo.service\n[Service]\nEnvironmentFile=/etc/maneki-vps2/agent-unified-' + namespace + '.env\n', 0o644)
        write(Path('/etc/systemd/system/luckycat-bank.service.d/95-archived.conf'), '[Unit]\nDescription=Archived separate bank writer (disabled after unification)\nConditionPathExists=/etc/maneki-vps2/enable-archived-live-writer\n', 0o644)
        write(NGINX, (source / 'deploy/single-host/maneki-single-host.conf').read_text() + '\n' + (source / 'deploy/single-host/staff-demo.conf').read_text(), 0o644)
        run(['nginx', '-t'])
        replace_link(SOURCE_LINK, source)
        run(['systemctl', 'daemon-reload'])
        run(['systemctl', 'disable', 'luckycat-bank'])
        for database in DATABASES:
            after = snapshot(database)
            changed = [table for table in before[database] if before[database][table] != after.get(table)]
            expected = {'public.staff_users', 'public.audit_logs'} if database == 'maneki_bank_demo' else set()
            require(set(after) == set(before[database]) and set(changed) <= expected, 'Unexpected data change before startup: ' + database)
            report['databases'][database].update(after=after, changedTables=changed)
            runtime = live if database == 'maneki_bank' else demo
            bank = pwd.getpwnam('bank')
            # Run the existing read-only reconciler as the normal service identity.
            result = subprocess.run([NODE, 'server/reconcile.mjs'], cwd=source, env=runtime, user=bank.pw_uid, group=bank.pw_gid, extra_groups=[], capture_output=True, text=True, timeout=90)
            (backup / (database + '-reconcile.json')).write_text(result.stdout + result.stderr)
            require(result.returncode == 0, 'Reconciliation failed: ' + database)
            report['databases'][database]['reconciled'] = True
        report['phase'] = 'configured-and-reconciled'
        save()
        run(['systemctl', 'start', 'luckycat-bank-demo'])
        health = wait_http(8081, '/health', {200})
        require(health.get('ok') and health.get('integrationMode') == 'sandbox' and health.get('commercialReady') is False, 'Unexpected unified bank readiness')
        run(['systemctl', 'start', 'luckycat-agent-demo', 'luckycat-staff-agent', 'luckycat-ops-agent'])
        for port in [8891, 8789, 8790]:
            wait_http(port, '/agent-api/health', {200, 401})
        require(http(8081, '/staff-api/me')[0] == 401, 'Staff authentication must remain mandatory')
        pids = {service: run(['systemctl', 'show', service, '-p', 'MainPID', '--value']) for service in ACTIVE}
        time.sleep(3)
        require(all(pid != '0' and run(['systemctl', 'show', service, '-p', 'MainPID', '--value']) == pid for service, pid in pids.items()), 'Service restarted during health check')
        require(run(['systemctl', 'show', 'luckycat-bank', '-p', 'MainPID', '--value']) == '0', 'Archived writer is still active')
        require(service_env('luckycat-bank-demo')['BANK_DATA_KEY'] == demo['BANK_DATA_KEY'], 'Customer encryption key changed')
        for namespace in ['staff', 'ops']:
            env = service_env('luckycat-' + namespace + '-agent')
            require(env['LUCKYCAT_BANK_URL'] == 'http://127.0.0.1:8081' and urllib.parse.urlparse(env['LUCKYCAT_SESSION_DATABASE_URL']).path == '/maneki_bank_demo' and env['LUCKYCAT_SESSION_DATA_KEY'] == envs['luckycat-' + namespace + '-agent']['LUCKYCAT_SESSION_DATA_KEY'], 'Agent configuration mismatch')
        # From this point all failures require forward repair, never restoring a database.
        report['publicSwitched'] = True
        report['phase'] = 'switching-public-routes'
        save()
        replace_link(WEB_LINK, web)
        run(['systemctl', 'reload', 'nginx'])
        report.update(phase='deployed-and-verified', completedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(), health=health, services={service: 'active' for service in ACTIVE}, archivedWriter='stopped-and-disabled', database='maneki_bank_demo', publicUrl='https://bank.waveflow.men')
        save()
        summary = {key: value for key, value in report.items() if key != 'databases'}
        summary['databases'] = {database: {key: value for key, value in details.items() if key not in ['before', 'after']} for database, details in report['databases'].items()}
        SUMMARY.write_text(json.dumps(summary, indent=2) + '\n')
        ubuntu = pwd.getpwnam('ubuntu')
        os.chown(SUMMARY, ubuntu.pw_uid, ubuntu.pw_gid)
        SUMMARY.chmod(0o600)
        print(json.dumps({'phase': report['phase'], 'backup': str(backup), 'summary': str(SUMMARY)}), flush=True)
    except BaseException as error:
        report.update(failedPhase=report['phase'], phase='failed', errorType=type(error).__name__, error=str(error), forwardRepairRequired=report['publicSwitched'])
        if stopped:
            try:
                if report['publicSwitched']:
                    run(['systemctl', 'start', *ACTIVE], check=False)
                else:
                    run(['systemctl', 'stop', *ACTIVE], check=False)
                    recovered = backup / 'generated-before-recovery'
                    recovered.mkdir(exist_ok=True)
                    for index, (path, body) in enumerate(originals.items()):
                        if body is None:
                            if path.exists():
                                path.replace(recovered / (str(index) + '-' + path.name))
                        else:
                            path.write_bytes(body)
                    replace_link(SOURCE_LINK, old_source)
                    replace_link(WEB_LINK, old_web)
                    run(['systemctl', 'daemon-reload'])
                    run(['systemctl', 'enable', 'luckycat-bank'])
                    run(['nginx', '-t'])
                    run(['systemctl', 'start', 'luckycat-bank', 'luckycat-bank-demo'])
                    run(['systemctl', 'start', 'luckycat-agent-demo', 'luckycat-staff-agent', 'luckycat-ops-agent'])
                    run(['systemctl', 'reload', 'nginx'])
                    report['previousRoutesRestored'] = True
                    report['demoCredentialChangeRetained'] = bool(report.get('credentialChangeCommitted'))
            except BaseException as recovery_error:
                report['recoveryErrorType'] = type(recovery_error).__name__
        save()
        print(json.dumps({'phase': 'failed', 'failedPhase': report['failedPhase'], 'backup': str(backup), 'forwardRepairRequired': report['publicSwitched']}), flush=True)
        raise SystemExit(1) from None


if __name__ == '__main__':
    main()
