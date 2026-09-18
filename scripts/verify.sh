#!/usr/bin/env bash
# luckycat 框架机械验收门。
# 退出码 0 = 全部断言通过；非 0 = 有断言失败（会逐条打印）。
#
# 刻意不使用 set -e：我们要跑完全部断言再汇总，而不是第一条失败就退出。
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_home.sh"

fail=0
ok() { echo "  ok   $1"; }
bad() { echo "  FAIL $1"; fail=1; }

node_eval() {
  node --input-type=module -e "$1"
}

echo "== V1 零内核改动 =="

# 只读参考副本必须一尘不染。
ref="$LUCKYCAT_ROOT/../reference/deepseek-harness"
if [ -d "$ref/.git" ]; then
  dirty="$(git -C "$ref" status --porcelain)"
  if [ -z "$dirty" ]; then ok "reference/deepseek-harness 工作树干净"; else bad "参考副本被改动: $dirty"; fi
else
  echo "  skip 参考副本不存在"
fi

# 用户的真实 ~/.dsh 绝不允许出现我们的 profile。
if [ -e "$HOME/.dsh/profiles/luckycat" ]; then
  bad "用户的 ~/.dsh 被污染（存在 profiles/luckycat）"
else
  ok "用户 ~/.dsh 未被污染"
fi

# 已安装的 dsh 必须是钉死版本。
pin="$(node_eval "import {readFileSync} from 'node:fs'; const p=JSON.parse(readFileSync('$LUCKYCAT_ROOT/package.json','utf8')); console.log(p.dependencies['@deepseek-ai/dsh'])")"
installed="$(node_eval "import {readFileSync} from 'node:fs'; console.log(JSON.parse(readFileSync('$LUCKYCAT_ROOT/node_modules/@deepseek-ai/dsh/package.json','utf8')).version)")"
if [ "$pin" = "$installed" ]; then ok "dsh 版本 == 钉死版本 ($pin)"; else bad "dsh 版本 $installed != 钉死 $pin"; fi

echo "== V2 组合正确 =="
dump="$(bash "$LUCKYCAT_ROOT/scripts/dsh-profile.sh" --dump-config 2>/tmp/luckycat-verify-dump.err)"
if [ -s /tmp/luckycat-verify-dump.err ]; then
  bad "dump-config 有告警: $(tr '\n' ' ' < /tmp/luckycat-verify-dump.err)"
else
  ok "dump-config 零告警（每条补丁都匹配到了目标行）"
fi

if grep -q '^    mode: read-only$' <<<"$dump"; then ok "sandbox mode = read-only"; else bad "sandbox mode 不是 read-only"; fi
if grep -q '^    policy: ask$' <<<"$dump"; then ok "approval policy = ask"; else bad "approval policy 不是 ask"; fi

for id in persistent-bash persistent-pwsh terminal-bash terminal-pwsh pty mcp-resources jobs \
          session-log-deepseek plugin-package-inventory-deepseek deepseek-llm-api-extensions; do
  if grep -A4 "^- id: $id$" <<<"$dump" | grep -q 'disabled: true'; then
    ok "删行已禁用: $id"
  else
    bad "删行未禁用: $id"
  fi
done

if grep -q 'danger-full-access' <<<"$dump"; then
  bad "树里仍有 danger-full-access（不该挂 permission-presets）"
else
  ok "树里无 danger-full-access"
fi

if grep -q 'id: luckycat-hello' <<<"$dump"; then ok "插件行 luckycat-hello 在树中"; else bad "插件行 luckycat-hello 缺失"; fi

echo "== V3 工具真的注册了（注册表探针）=="
probe_out="$(sleep 6 | timeout 30 bash "$LUCKYCAT_ROOT/scripts/dsh-profile.sh" --patch "$LUCKYCAT_HOME/profiles/luckycat/doctor.patch.yml" 2>&1 >/dev/null)"
if grep -q 'luckycat_ping=REGISTERED' <<<"$probe_out"; then
  ok "luckycat_ping 已注册"
else
  bad "luckycat_ping 未注册: $(tr '\n' ' ' <<<"$probe_out")"
fi
if grep -q 'tools=1' <<<"$probe_out"; then
  ok "工具面 = 1（无 shell / coding 工具）"
else
  bad "工具面不是 1: $(tr '\n' ' ' <<<"$probe_out")"
fi

echo
if [ "$fail" -eq 0 ]; then echo "verify: 全部通过"; else echo "verify: 有失败项"; fi
exit "$fail"