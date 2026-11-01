#!/usr/bin/env bash
# 本机内网穿透：通过百度云 frps 中转，让其他电脑从公网访问本地网页。
#
# 用法：scripts/frp-tunnel.sh [start|stop|restart|status|log]
# 依赖：.generated/frp/{frpc,frpc.toml}（本机生成，不纳入仓库）；frpc.toml 权限应为 600。
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
DIR="$ROOT/.generated/frp"
BIN="$DIR/frpc"
CONF="$DIR/frpc.toml"
PIDFILE="$DIR/frpc.pid"
LOG="$DIR/frpc.log"

running() {
  [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null
}

case "${1:-status}" in
  start)
    if [[ ! -x "$BIN" || ! -f "$CONF" ]]; then
      echo "缺少 $BIN 或 $CONF；先按 docs/local-tunnel.md 准备 frpc 与配置" >&2
      exit 1
    fi
    if running; then echo "已在运行（pid $(cat "$PIDFILE")）"; exit 0; fi
    setsid "$BIN" -c "$CONF" >>"$LOG" 2>&1 < /dev/null &
    echo $! > "$PIDFILE"
    sleep 2
    if running; then echo "已启动（pid $(cat "$PIDFILE")），日志 $LOG"; else echo "启动失败，检查 $LOG" >&2; exit 1; fi
    ;;
  stop)
    if running; then kill "$(cat "$PIDFILE")"; echo "已停止"; else echo "未在运行"; fi
    rm -f "$PIDFILE"
    ;;
  restart)
    "$0" stop; sleep 1; "$0" start
    ;;
  status)
    if running; then
      echo "运行中（pid $(cat "$PIDFILE")）"
      grep -E "start proxy success|login to server" "$LOG" | tail -2
    else
      echo "未运行"
    fi
    ;;
  log) tail -n 30 "$LOG" ;;
  *) echo "用法：$0 [start|stop|restart|status|log]" >&2; exit 2 ;;
esac
