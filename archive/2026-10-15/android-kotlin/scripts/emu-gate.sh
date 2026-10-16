#!/usr/bin/env bash
# 模拟器门禁：instrumented 测试（确认卡片、提问卡片、聊天链路、登录页）。
#
# 和 gate.sh 的分工：
#   gate.sh      —— 纯 JVM，不需要模拟器（契约层 + 业务逻辑）
#   emu-gate.sh  —— 需要 Android 设备，测的是**界面上的规矩**
#
# 用法：
#   bash android/scripts/emu-gate.sh              # 用已在跑的设备
#   bash android/scripts/emu-gate.sh --boot       # 没有设备就自己起一个，跑完关掉
#
# ⚠️ 模拟器吃内存（这台机器上配了 4G）。--boot 那条路径有 trap 兜底，
# 但**脚本被 kill -9 时 trap 不会跑**，那种情况下要自己 adb emu kill。
set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-/data/sdk/Android/Sdk}}"
ADB="$SDK/platform-tools/adb"
AVD="${LUCKYCAT_AVD:-luckycat_test}"
BOOT=0
[ "${1:-}" = "--boot" ] && BOOT=1

fail=0
ok() { echo "  ok   $1"; }
bad() { echo "  FAIL $1"; fail=1; }

emulator_pid=''
cleanup() {
  if [ -n "$emulator_pid" ]; then
    echo "== 关掉模拟器 =="
    "$ADB" -s emulator-5554 emu kill >/dev/null 2>&1 || kill "$emulator_pid" 2>/dev/null
    wait "$emulator_pid" 2>/dev/null
    echo "  已关闭"
  fi
}
trap cleanup EXIT INT TERM

have_device() {
  "$ADB" devices 2>/dev/null | grep -qE '^[^ ]+\s+device$'
}

if ! have_device; then
  if [ "$BOOT" != "1" ]; then
    echo "  skip 没有已连接的设备"
    echo "       起一个：bash android/scripts/emu-gate.sh --boot"
    exit 2
  fi
  echo "== 启动模拟器 $AVD =="
  "$SDK/emulator/emulator" -avd "$AVD" -no-window -no-snapshot -no-boot-anim \
    -gpu swiftshader_indirect -no-audio >/tmp/luckycat-emu.log 2>&1 &
  emulator_pid=$!
  for _ in $(seq 1 90); do
    [ "$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ] && break
    sleep 2
  done
  if ! have_device; then
    bad "模拟器没起来（日志 /tmp/luckycat-emu.log）"
    exit 1
  fi
  ok "模拟器已就绪"
fi

echo "== instrumented 测试 =="
if ./gradlew :app:connectedDebugAndroidTest --console=plain -q \
    >/tmp/luckycat-android-emu.log 2>&1; then
  count=$(grep -oE 'tests="[0-9]+"' app/build/outputs/androidTest-results/connected/debug/*.xml 2>/dev/null \
    | grep -oE '[0-9]+' | head -1)
  ok "instrumented 测试通过（${count:-?} 条）"
else
  bad "instrumented 测试失败，日志：/tmp/luckycat-android-emu.log"
  grep -E "FAILED|AssertionError|Error" /tmp/luckycat-android-emu.log | head -6 | sed 's/^/      /'
fi

echo
if [ "$fail" -eq 0 ]; then echo "android emu gate: 全部通过"; else echo "android emu gate: 有失败项"; fi
exit "$fail"
