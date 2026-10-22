#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
export PATH=/opt/maneki-oom-node/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PGHOST=127.0.0.1 PGPORT=55433 PGUSER=postgres
for name in maneki_oom_live_test maneki_oom_before_test; do
  # These names are private to setup-linux.sh and never accepted as arguments.
  dropdb --if-exists "$name"
  createdb -T maneki_oom_test "$name"
done
psql -d maneki_oom_before_test -v ON_ERROR_STOP=1 -c 'DELETE FROM bank_schema_migrations WHERE version>2026101502; INSERT INTO bank_schema_migrations(version) VALUES (2026101502) ON CONFLICT DO NOTHING'
for name in maneki_oom_test maneki_oom_live_test; do
  psql -d "$name" -v ON_ERROR_STOP=1 -f "$ROOT/framework/bridge/session-schema.sql" > /dev/null
done
echo 'Prepared identical synthetic demo/live/before datasets and independent AI namespaces.'
