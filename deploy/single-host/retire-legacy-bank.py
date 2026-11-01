#!/usr/bin/env python3
"""Retire only the obsolete 8080 unit; preserve the running 8081 bank and all data."""
import argparse
import datetime
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import urllib.request

LEGACY = 'luckycat-bank.service'
ACTIVE = ['luckycat-bank-demo.service', 'luckycat-agent-demo.service',
          'luckycat-staff-agent.service', 'luckycat-ops-agent.service']
UNIT = Path('/etc/systemd/system/luckycat-bank.service')
DROPINS = Path('/etc/systemd/system/luckycat-bank.service.d')
GUARD = Path('/etc/maneki-vps2/enable-archived-live-writer')


def run(args, check=True):
    result = subprocess.run(args, capture_output=True, text=True, timeout=30)
    if check and result.returncode:
        raise RuntimeError('Command failed: ' + ' '.join(args[:2]))
    return result.stdout.strip()


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def state(service):
    output = run(['systemctl', 'show', service, '-p', 'MainPID', '-p', 'ActiveState',
                  '-p', 'UnitFileState', '-p', 'Requires', '-p', 'Wants', '-p', 'After',
                  '-p', 'BindsTo', '-p', 'PartOf', '-p', 'Requisite', '-p', 'FragmentPath', '-p', 'DropInPaths'])
    return dict(line.split('=', 1) for line in output.splitlines() if '=' in line)


def health():
    with urllib.request.urlopen('http://127.0.0.1:8081/health', timeout=10) as response:
        body = json.load(response)
    require(body.get('ok') is True, '8081 health check failed')
    return {key: body.get(key) for key in ['ok', 'database', 'integrationMode', 'commercialReady']}


def listeners():
    output = run(['ss', '-H', '-ltn', '( sport = :8080 or sport = :8081 )'])
    addresses = [line.split()[3] for line in output.splitlines()]
    require(not any(address.endswith(':8080') for address in addresses), '8080 is still listening; investigate before retirement')
    require(addresses == ['127.0.0.1:8081'], 'Unexpected bank listener addresses')
    return addresses


def public_checks():
    results = {}
    for path, expected in [('/', '200'), ('/staff/login', '200'), ('/api/accounts', '401'),
                           ('/staff-api/customers', '401'), ('/staff-demo-api/customers', '401')]:
        code = run(['curl', '--silent', '--show-error', '--max-time', '15', '--output', '/dev/null',
                    '--write-out', '%{http_code}', '--resolve', 'bank.waveflow.men:443:127.0.0.1',
                    'https://bank.waveflow.men' + path])
        results[path] = int(code)
        require(code == expected, 'Unexpected public status: ' + path)
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    require(os.name == 'posix' and os.geteuid() == 0, 'Run as root on the deployed host')
    os.umask(0o077)
    before = {service: state(service) for service in ACTIVE}
    dependency_edits = {}
    for service, details in before.items():
        require(details['ActiveState'] == 'active' and details['MainPID'] != '0', 'Inactive current service: ' + service)
        for name in [details['FragmentPath'], *details.get('DropInPaths', '').split()]:
            path = Path(name)
            require(path.is_absolute() and path.is_relative_to('/etc/systemd/system')
                    and not path.is_symlink() and path.resolve() == path, 'Unexpected unit path')
            body = path.read_text()
            updated = re.sub(r'^(Requires|Wants|After|Before|BindsTo|PartOf|Requisite)=(.*)$',
                             lambda m: m[1] + '=' + re.sub(r'(?<!\S)luckycat-bank(?:\.service)?(?!\S)',
                                                          'luckycat-bank-demo.service', m[2]), body, flags=re.M)
            if updated != body:
                dependency_edits[path] = updated
    require(state(LEGACY)['MainPID'] == '0', 'Obsolete bank is running; investigate before retirement')
    require('127.0.0.1:8080' not in run(['nginx', '-T']), 'Nginx still references the obsolete bank')
    initial_health = health()
    addresses = listeners()
    public = public_checks()
    if not args.apply:
        print(json.dumps({'status': 'preflight-passed', 'listeners': addresses, 'health': initial_health,
                          'dependencyEdits': [str(p) for p in dependency_edits],
                          'publicChecks': public, 'currentPids': {s: v['MainPID'] for s, v in before.items()}}))
        return
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    backup = Path('/var/backups') / ('maneki-retire-8080-' + stamp)
    backup.mkdir(mode=0o700)
    report = {'status': 'in-progress', 'backup': str(backup), 'retiredUnit': LEGACY, 'moved': [],
              'databasesModified': False, 'currentServicesRestarted': False}

    def save():
        (backup / 'report.json').write_text(json.dumps(report, indent=2) + '\n')

    save()
    try:
        for index, (path, updated) in enumerate(dependency_edits.items()):
            shutil.copy2(path, backup / ('dependency-' + str(index) + '-' + path.name))
            temporary = path.with_name(path.name + '.retire-8080-tmp')
            require(not temporary.exists() and not temporary.is_symlink(), 'Temporary unit path already exists')
            temporary.write_text(updated)
            shutil.copymode(path, temporary)
            temporary.replace(path)
        report['dependencyEdits'] = [str(p) for p in dependency_edits]
        save()
        run(['systemctl', 'daemon-reload'])
        for service in ACTIVE:
            details = state(service)
            for key in ['Requires', 'Wants', 'After', 'BindsTo', 'PartOf', 'Requisite']:
                require(LEGACY not in details.get(key, '').split(), 'Obsolete dependency remains: ' + service)
        run(['systemctl', 'disable', '--now', LEGACY])
        for path in [UNIT, DROPINS, GUARD]:
            if path.is_symlink() and path == UNIT and path.readlink() == Path('/dev/null'):
                continue
            if path.exists() or path.is_symlink():
                require(not path.is_symlink(), 'Unexpected symlink: ' + str(path))
                require(path.resolve() == path, 'Unexpected resolved path: ' + str(path))
                shutil.move(str(path), str(backup / path.name))
                report['moved'].append(str(path))
                save()
        run(['systemctl', 'mask', LEGACY])
        run(['systemctl', 'daemon-reload'])
        run(['systemctl', 'reset-failed', LEGACY], check=False)
        require(UNIT.is_symlink() and UNIT.readlink() == Path('/dev/null'), 'Obsolete service is not masked')
        require(state(LEGACY)['UnitFileState'] == 'masked', 'Systemd mask was not loaded')
        require(state(LEGACY)['MainPID'] == '0', 'Obsolete bank has a process')
        for service, details in before.items():
            current = state(service)
            require(current['ActiveState'] == 'active' and current['MainPID'] == details['MainPID'],
                    'Current service changed unexpectedly: ' + service)
        run(['nginx', '-t'])
        report.update(status='retired-and-verified', completedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),
                      legacyState='masked', listeners=listeners(), health=health(), publicChecks=public_checks(),
                      currentPids={s: state(s)['MainPID'] for s in ACTIVE})
        save()
        print(json.dumps(report))
    except BaseException:
        report['status'] = 'incomplete-requires-review'
        save()
        raise


if __name__ == '__main__':
    main()
