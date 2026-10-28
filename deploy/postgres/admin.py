#!/usr/bin/env python3
"""Root-only PostgreSQL account maintenance while the bank service is stopped."""
import argparse
import getpass
import hmac
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import unicodedata
import warnings

from check import OperationsError, absolute_path

SERVICE = 'luckycat-bank.service'
ACTIONS = ('set-staff-password', 'set-customer-password', 'set-payment-password')


def read_environment(path):
    path = absolute_path(path, exists=True)
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, 'r', encoding='utf-8') as source:
        info = os.fstat(source.fileno())
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_gid != 0
                or stat.S_IMODE(info.st_mode) != 0o600 or info.st_size > 65536):
            raise OperationsError('Environment must be a root:root 0600 regular file no larger than 64 KiB')
        values = {}
        for number, raw in enumerate(source, 1):
            line = raw.rstrip('\r\n')
            if not line.strip() or line.lstrip().startswith('#'):
                continue
            match = re.fullmatch(r'([A-Za-z_][A-Za-z0-9_]*)=([^\x00\r\n]*)', line)
            if not match:
                raise OperationsError(f'Invalid environment line {number}')
            name, value = match.groups()
            if name in values or value != value.strip() or any(char in value for char in ("'", '"', '\\')):
                raise OperationsError(f'Environment line {number} must use a unique key and unquoted literal value')
            values[name] = value
        return values


def assert_stopped():
    result = subprocess.run(['systemctl', 'show', SERVICE, '--property=LoadState', '--property=ActiveState', '--property=MainPID'],
                            text=True, capture_output=True, timeout=15, check=False)
    state = dict(line.split('=', 1) for line in result.stdout.splitlines() if '=' in line)
    if (result.returncode or state.get('LoadState') != 'loaded' or state.get('ActiveState') not in ('inactive', 'failed')
            or state.get('MainPID') != '0'):
        raise OperationsError('Stop luckycat-bank.service and verify MainPID=0 before maintenance')


def prompt_password(action):
    with warnings.catch_warnings():
        warnings.simplefilter('error', getpass.GetPassWarning)
        password = getpass.getpass('新密码（输入不回显）：')
        again = getpass.getpass('再次输入新密码：')
    if not hmac.compare_digest(password.encode('utf-8'), again.encode('utf-8')):
        raise OperationsError('Password confirmation did not match')
    if any(char in password for char in ('\0', '\r', '\n')):
        raise OperationsError('Password must not contain NUL or line breaks')
    if action == 'set-payment-password':
        if not re.fullmatch(r'[0-9]{6}', password):
            raise OperationsError('Payment password must contain exactly six digits')
    elif action == 'set-customer-password':
        if (len(password) < 8 or len(password.encode('utf-8')) > 1024
                or not re.search(r'[A-Z]', password) or not re.search(r'[a-z]', password)
                or not any(unicodedata.category(char)[0] in ('P', 'S') for char in password)):
            raise OperationsError('Customer login password requires at least 8 characters, uppercase and lowercase letters, and a special character; maximum 1024 UTF-8 bytes')
    elif action != 'set-staff-password' or not 12 <= len(password) <= 20:
        raise OperationsError('Staff login password must contain 12–20 characters without line breaks')
    return password


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=ACTIONS)
    parser.add_argument('id', help='Stable employee or customer ID')
    parser.add_argument('--env-file', default='/etc/luckycat-bank/bank.env')
    parser.add_argument('--database-env-file', default='/etc/luckycat-bank/pg-app.env')
    args = parser.parse_args()
    if sys.platform != 'linux' or os.geteuid() != 0:
        raise OperationsError('Account maintenance requires Linux root and systemd')
    import fcntl
    import pwd
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}', args.id):
        raise OperationsError('Invalid stable account ID')
    release = Path(__file__).resolve(strict=True).parents[2]
    releases = Path('/srv/maneki-bank/releases')
    if releases.resolve(strict=True) != releases or release == releases or not release.is_relative_to(releases):
        raise OperationsError('Run maintenance from an installed /srv/maneki-bank/releases/<release>')
    entry = absolute_path(str(release / 'server/admin.mjs'), exists=True)
    configured = read_environment(args.env_file)
    configured.update(read_environment(args.database_env_file))
    if (configured.get('NODE_ENV') != 'production' or not configured.get('BANK_DATA_KEY')
            or not re.match(r'^postgres(?:ql)?://', configured.get('BANK_DATABASE_URL', ''))):
        raise OperationsError('Production PostgreSQL and matching field encryption configuration is required')
    environment = {**os.environ, **configured, 'BANK_MAINTENANCE': '1', 'BANK_AUTO_MIGRATE': 'false'}
    configured.clear()
    account = pwd.getpwnam('bank')
    lock_path = absolute_path('/var/lib/luckycat-bank/.maintenance.lock')
    descriptor = os.open(lock_path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    password = ''
    try:
        os.fchown(descriptor, account.pw_uid, account.pw_gid)
        os.fchmod(descriptor, 0o600)
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise OperationsError('Bank service or another maintenance process holds the maintenance lock') from None
        assert_stopped()
        password = prompt_password(args.action)
        assert_stopped()
        result = subprocess.run(['/opt/maneki-node24/bin/node', str(entry), args.action, args.id],
                                cwd=release, env=environment, input=password, text=True,
                                capture_output=True, timeout=120, check=False,
                                user=account.pw_uid, group=account.pw_gid, extra_groups=[])
        if result.returncode:
            raise OperationsError('Account maintenance failed; inspect the protected audit and database logs')
        report = json.loads(result.stdout)
        if report.get('ok') is not True:
            raise OperationsError('Account maintenance did not confirm success')
        print(json.dumps({'ok': True, 'database': 'postgresql', 'action': args.action, 'id': args.id}))
        return 0
    finally:
        password = ''
        environment.clear()
        os.close(descriptor)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (KeyboardInterrupt, EOFError, getpass.GetPassWarning):
        print('Maintenance cancelled; service state was not changed.', file=sys.stderr)
        sys.exit(1)
    except (OperationsError, OSError, ValueError, subprocess.TimeoutExpired):
        print('PostgreSQL account maintenance refused or failed; service state was not changed. Check protected configuration and logs.', file=sys.stderr)
        sys.exit(1)
