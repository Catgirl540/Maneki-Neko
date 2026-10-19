#!/usr/bin/env python3
"""Install VPS2 backup/reconciliation units using its existing protected passwords."""
import json
import os
from pathlib import Path
import subprocess

if os.geteuid() != 0:
    raise SystemExit('Run as root on the deployed VPS only')
os.umask(0o077)
config = Path('/etc/maneki-vps2')
passwords = json.loads((config / 'database-passwords.json').read_text())
root = Path('/var/backups/luckycat-bank/postgresql')
root.mkdir(parents=True, exist_ok=True, mode=0o700)
root.chmod(0o700)
units = Path('/etc/systemd/system')
for target, database in [('live', 'maneki_bank'), ('demo', 'maneki_bank_demo')]:
    backup_dir = root / target
    backup_dir.mkdir(exist_ok=True, mode=0o700)
    values = {
        'PGHOST': '127.0.0.1', 'PGPORT': '5432', 'PGDATABASE': database,
        'PGUSER': 'maneki_backup', 'PGPASSWORD': passwords['maneki_backup'],
        'BANK_PG_BACKUP_DIR': str(backup_dir),
    }
    values['BANK_PG_STATUS_FILE'] = ('/var/lib/luckycat-bank/backup-status.json' if target == 'live'
                                    else '/var/lib/luckycat-bank/demo-backup-status.json')
    path = config / f'backup-{target}.env'
    path.write_text(''.join(f'{key}={value}\n' for key, value in values.items()))
    path.chmod(0o600)
    for operation in ['backup', 'reconcile']:
        name = f'maneki-{target}-{operation}'
        environment = f'backup-{target}' if operation == 'backup' else f'bank-{target}'
        command = ('/usr/bin/python3 -B deploy/postgres/backup.py' if operation == 'backup'
                   else '/opt/maneki-node24/bin/node server/reconcile.mjs')
        user = 'root' if operation == 'backup' else 'bank'
        writable = (f'ReadWritePaths={root} /var/lib/luckycat-bank\n'
                    if operation == 'backup' else '')
        (units / f'{name}.service').write_text(f'''[Unit]
Description=Maneki {target} PostgreSQL {operation}
After=postgresql.service
[Service]
Type=oneshot
User={user}
WorkingDirectory=/srv/maneki-bank/current
EnvironmentFile={config}/{environment}.env
ExecStart={command}
TimeoutStartSec=70min
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
{writable}''')
        schedule = 'hourly' if operation == 'backup' else '*-*-* 03:15:00 UTC'
        (units / f'{name}.timer').write_text(f'''[Unit]
Description=Scheduled Maneki {target} {operation}
[Timer]
OnCalendar={schedule}
Persistent=true
RandomizedDelaySec=120
Unit={name}.service
[Install]
WantedBy=timers.target
''')
subprocess.run(['systemctl', 'daemon-reload'], check=True)
print('Maintenance units installed; run and verify each service before enabling timers')
