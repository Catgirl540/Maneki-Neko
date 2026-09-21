#!/usr/bin/env bash
# 安卓侧门禁：桥接契约测试。
#
# 分两层，**都不需要模拟器和真机**（`:contract` 是纯 JVM 模块）：
#   1. 离线：打 MockWebServer，验"客户端把桥接的字节解对了没有"
#   2. 真桥接：打 $LUCKYCAT_CONTRACT_BASE，验"桥接真的是这个形状"
#
# 第 2 层是唯一能发现"桥接改了、客户端没跟上"的门禁，桥接没起就跳过。
#
# 用法：
#   bash android/scripts/gate.sh
#   LUCKYCAT_CONTRACT_BASE=http://127.0.0.1:8788 bash android/scripts/gate.sh
#
# 注意：真桥接那层必须带 `--rerun-tasks`——Gradle 不跟踪环境变量，
# 不带的话第二次跑会直接 UP-TO-DATE，变成一条永远绿的假门禁。
set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1
fail=0
ok() { echo "  ok   $1"; }
bad() { echo "  FAIL $1"; fail=1; }

BASE="${LUCKYCAT_CONTRACT_BASE:-http://127.0.0.1:8788}"
REPORT="contract/build/reports/tests/test/index.html"

echo "== 离线契约测试（不需要桥接） =="
if ./gradlew :contract:test --console=plain -q >/tmp/luckycat-android-offline.log 2>&1; then
  ok "离线契约测试通过（报告：android/$REPORT）"
else
  bad "离线契约测试失败，日志：/tmp/luckycat-android-offline.log"
fi

echo "== 真桥接契约测试（$BASE） =="
if curl -s --max-time 3 "$BASE/agent-api/health" >/dev/null 2>&1; then
  if LUCKYCAT_CONTRACT_LIVE=1 LUCKYCAT_CONTRACT_BASE="$BASE" \
    ./gradlew :contract:test --tests '*LiveContractTest*' --rerun-tasks --console=plain -q \
    >/tmp/luckycat-android-live.log 2>&1; then
    ok "真桥接契约测试通过"
  else
    bad "真桥接契约测试失败，日志：/tmp/luckycat-android-live.log"
  fi
else
  echo "  skip $BASE 没响应（先起桥接：node framework/bridge/demo-server.mjs）"
fi

echo
if [ "$fail" -eq 0 ]; then echo "android gate: 全部通过"; else echo "android gate: 有失败项"; fi
exit "$fail"
