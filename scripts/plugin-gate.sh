#!/usr/bin/env bash
# 增删门：证明"不改内核、增删插件"是真的——
#   1. 现状：luckycat_ping 在工具面里；
#   2. 卸载 @luckycat/dsh-hello：profile 清单不再列它、组合树里那行消失、
#      **系统仍然能启动**、工具面少一个；
#   3. 重新安装：一切恢复。
#
# 用法：bash scripts/plugin-gate.sh
# 注意：会改动仓库内 profile 的已装 bundle（.dsh-home 下，gitignore）。
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_home.sh"

fail=0
ok() { echo "  ok   $1"; }
bad() { echo "  FAIL $1"; fail=1; }

PKG='@luckycat/dsh-hello'
manifest="$DSH_HOME/profiles/luckycat/package.json"
doctor="$DSH_HOME/profiles/luckycat/doctor.patch.yml"

# 这一次调用会保持 stdin 打开若干秒，让探针的延迟自检能跑完。
probe_names() {
  sleep 8 | timeout 60 bash "$LUCKYCAT_ROOT/scripts/dsh-profile.sh" --patch "$doctor" 2>&1 >/dev/null | sed -n 's/^\[luckycat-probe\] names=//p'
}

dump_rows() {
  bash "$LUCKYCAT_ROOT/scripts/dsh-profile.sh" --dump-config 2>/dev/null | grep -c 'id: luckycat-hello' || true
}

echo "== 步骤 1：卸载前 =="
names_before="$(probe_names)"
if grep -q 'luckycat_ping' <<<"$names_before"; then ok "卸载前 luckycat_ping 在工具面里"; else bad "卸载前就没有 luckycat_ping：$names_before"; fi
if [ "$(dump_rows)" -gt 0 ]; then ok "组合树里有 luckycat-hello 行"; else bad "组合树里没有 luckycat-hello 行"; fi

echo "== 步骤 2：卸载 $PKG =="
if bash "$LUCKYCAT_ROOT/scripts/plugin.sh" remove "$PKG" >"$DSH_HOME/plugin-remove.log" 2>&1; then
  ok "卸载命令成功"
else
  bad "卸载命令失败（日志：$DSH_HOME/plugin-remove.log）"
fi
if grep -q "$PKG" "$manifest"; then bad "profile 清单里仍然列着 $PKG"; else ok "profile 清单已摘掉 $PKG"; fi
if [ "$(dump_rows)" = "0" ]; then ok "组合树里那行已消失"; else bad "组合树里那行还在"; fi

names_removed="$(probe_names)"
if grep -q 'luckycat_ping' <<<"$names_removed"; then
  bad "插件已卸载但工具仍在：$names_removed"
else
  ok "工具面已少一个（剩余：$names_removed）"
fi
if [ -n "$names_removed" ]; then
  ok "卸载后系统**仍能启动**并完成自检"
else
  bad "卸载后系统起不来了（探针没有输出）"
fi

echo "== 步骤 3：重新安装 =="
if bash "$LUCKYCAT_ROOT/scripts/plugin.sh" add "$LUCKYCAT_ROOT/packages/hello" >"$DSH_HOME/plugin-add.log" 2>&1; then
  ok "重新安装成功"
else
  bad "重新安装失败（日志：$DSH_HOME/plugin-add.log）"
fi
names_restored="$(probe_names)"
if grep -q 'luckycat_ping' <<<"$names_restored"; then ok "工具面已恢复"; else bad "工具面没恢复：$names_restored"; fi

echo
if [ "$fail" -eq 0 ]; then echo "plugin-gate: 全部通过"; else echo "plugin-gate: 有失败项"; fi
exit "$fail"