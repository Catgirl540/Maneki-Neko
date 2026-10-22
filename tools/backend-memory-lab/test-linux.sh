#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
export PATH=/opt/maneki-oom-node/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export NODE_PATH=/var/tmp/maneki-backend-memory-lab/linux-deps/node_modules
export BANK_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/maneki_bank_test
export BANK_CONNECT_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/maneki_connector_test
export BANK_HTTP_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/maneki_http_test
export LUCKYCAT_SESSION_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/maneki_ai_sessions_test
export LUCKYCAT_PG_MODULE_PATH="$ROOT/server/node_modules/pg"
cd "$ROOT"
if test "$#" -gt 0; then exec node "$@"; fi
exec node tools/check-postgresql-integration.mjs
