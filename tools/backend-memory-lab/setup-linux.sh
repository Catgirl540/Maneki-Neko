#!/usr/bin/env bash
# Disposable local WSL/Linux lab. Never uses a production connection or data key.
set -euo pipefail
LAB=/var/tmp/maneki-backend-memory-lab
NODE=/opt/maneki-oom-node/bin/node
test "$(id -u)" = 0
test -x "$NODE"
test -x /usr/lib/postgresql/16/bin/initdb
mkdir -p "$LAB/disk"
if ! test -e "$LAB/data-40g.img"; then
  truncate -s 40G "$LAB/data-40g.img"
  mkfs.ext4 -q -F -m 0 -L maneki-oom-lab "$LAB/data-40g.img"
fi
if ! mountpoint -q "$LAB/disk"; then mount -o loop "$LAB/data-40g.img" "$LAB/disk"; fi
mkdir -p "$LAB/disk/pg" "$LAB/disk/socket" "$LAB/disk/logs"
chown postgres:postgres "$LAB/disk/pg" "$LAB/disk/socket" "$LAB/disk/logs"
if ! test -f "$LAB/disk/pg/PG_VERSION"; then
  runuser -u postgres -- /usr/lib/postgresql/16/bin/initdb -D "$LAB/disk/pg" --auth-local=trust --auth-host=trust > "$LAB/disk/logs/initdb.log"
  cat >> "$LAB/disk/pg/postgresql.conf" <<EOF
listen_addresses = '127.0.0.1'
port = 55433
unix_socket_directories = '$LAB/disk/socket'
shared_buffers = '128MB'
work_mem = '4MB'
maintenance_work_mem = '64MB'
max_connections = 60
logging_collector = off
EOF
fi
if ! /usr/lib/postgresql/16/bin/pg_isready -h 127.0.0.1 -p 55433 -q; then
  runuser -u postgres -- /usr/lib/postgresql/16/bin/pg_ctl -D "$LAB/disk/pg" -l "$LAB/disk/logs/postgres.log" start
fi
for db in maneki_bank_test maneki_connector_test maneki_http_test maneki_ai_sessions_test maneki_oom_test maneki_oom_live_test; do
  if ! runuser -u postgres -- psql -h 127.0.0.1 -p 55433 -Atqc "SELECT 1 FROM pg_database WHERE datname='$db'" | grep -qx 1; then
    runuser -u postgres -- createdb -h 127.0.0.1 -p 55433 "$db"
  fi
done
if ! test -d "$LAB/linux-deps/node_modules/@deepseek-ai/node-addon-system-linux-x64"; then
  mkdir -p "$LAB/linux-deps"
  cd "$LAB/linux-deps"
  PATH=/opt/maneki-oom-node/bin:/usr/bin:/bin npm install --ignore-scripts --no-audit --no-fund node-addon-require-builtin-linux-x64-gnu@0.1.9 @deepseek-ai/node-addon-system-linux-x64@0.1.2 > "$LAB/disk/logs/native-dependencies.log" 2>&1
fi
"$NODE" --version
psql -h 127.0.0.1 -p 55433 -U postgres -Atqc 'SHOW server_version'
df -B1 "$LAB/disk"
