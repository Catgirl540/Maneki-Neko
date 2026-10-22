#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
MODE=${1:-fixed}
case "$MODE" in fixed|before) ;; *) exit 2 ;; esac
LAB=/var/tmp/maneki-backend-memory-lab/disk
# Stop only this lab's PostgreSQL so the runner can start it inside the same cgroup.
if test -f "$LAB/pg/postmaster.pid"; then runuser -u postgres -- /usr/lib/postgresql/16/bin/pg_ctl -D "$LAB/pg" -m fast stop; fi
exec systemd-run --wait --pipe --collect --unit="maneki-memory-lab-$MODE" \
  --property=MemoryMax=4G --property=MemorySwapMax=0 --property=CPUQuota=200% \
  --property=AllowedCPUs=0,1 --property=TasksMax=512 --property="WorkingDirectory=$ROOT" \
  /opt/maneki-oom-node/bin/node "$ROOT/tools/backend-memory-lab/run.mjs" "$MODE"
