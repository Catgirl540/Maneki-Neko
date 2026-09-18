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

# 断言"某行确实被禁用"：按 id 取出该条目**整块**（直到下一个 - id: 为止）再找 disabled。
# 不能用固定行数窗口——带 config 的条目会把 disabled: true 推到更后面
# （llm-deepseek 就因此曾被误判为未禁用）。
entry_block() {
  awk -v id="$1" '
    $0 == "- id: " id { inside = 1; print; next }
    inside && /^- id: / { exit }
    inside { print }
  ' <<<"$dump"
}

for id in persistent-bash persistent-pwsh terminal-bash terminal-pwsh pty mcp-resources jobs \
          session-log-deepseek plugin-package-inventory-deepseek deepseek-llm-api-extensions \
          llm-deepseek; do
  if grep -q '^  disabled: true$' <<<"$(entry_block "$id")"; then
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

# V2b 多供应商路由：llm-pi-ai 必须在树中，且路由与重试策略正确。
if grep -q "id: llm-pi-ai" <<<"$dump"; then ok "多供应商适配器 llm-pi-ai 在树中"; else bad "llm-pi-ai 缺失（会没有可用模型）"; fi
if grep -q 'apiKeyEnv: OPENROUTER_API_KEY' <<<"$dump"; then ok "OpenRouter 路由已配置"; else bad "OpenRouter 路由缺失"; fi
if grep -q '^          mode: normal$' <<<"$dump"; then ok "重试策略显式为 normal（不会无限计费重试）"; else bad "重试策略不是 normal"; fi
if grep -q 'always' <<<"$dump"; then bad "树里出现 always 重试（会无限重试并计费）"; else ok "树里无 always 重试"; fi
if grep -q 'LUCKYCAT_SYSTEM_PROMPT' <<<"$dump"; then ok "业务人设覆盖已生效（可被环境变量替换）"; else bad "business persona 覆盖未生效"; fi

# V2c 向量服务：DSH 没有 embedding 通道，这一行是我们自己加的服务。
if grep -q 'id: luckycat-embedding' <<<"$dump"; then ok "向量服务行 luckycat-embedding 在树中"; else bad "向量服务行缺失"; fi
if grep -q 'api: openai-embeddings' <<<"$dump"; then ok "向量路由协议 openai-embeddings 已配置"; else bad "向量路由协议缺失"; fi
if grep -q 'model: nvidia/llama-nemotron-embed-vl-1b-v2:free' <<<"$dump"; then ok "向量默认模型已配置（2048 维免费档）"; else bad "向量默认模型缺失"; fi

# V2d 知识库检索
rag_block="$(entry_block luckycat-rag)"
if [ -n "$rag_block" ]; then ok "知识库插件行 luckycat-rag 在树中"; else bad "知识库插件行缺失"; fi
if grep -q 'corpusPath: /' <<<"$rag_block"; then ok "语料路径已替换为绝对路径"; else bad "语料路径未替换（占位符没处理？）"; fi
if grep -q 'maxInjectBytes: 2000' <<<"$rag_block"; then ok "注入预算已显式配置（2000 字节）"; else bad "注入预算未显式配置"; fi

# V2e 加固
hard_block="$(entry_block luckycat-hardening)"
if [ -n "$hard_block" ]; then ok "加固插件行 luckycat-hardening 在树中"; else bad "加固插件行缺失"; fi
if grep -q 'allowedTools:' <<<"$hard_block"; then ok "工具白名单已显式配置（fail-closed）"; else bad "工具白名单缺失"; fi
if grep -q 'secretEnv:' <<<"$hard_block"; then ok "按环境变量名脱敏已配置（取值不进配置）"; else bad "secretEnv 未配置"; fi

echo "== V3 工具真的注册了（注册表探针）=="
probe_out="$(sleep 6 | timeout 30 bash "$LUCKYCAT_ROOT/scripts/dsh-profile.sh" --patch "$LUCKYCAT_HOME/profiles/luckycat/doctor.patch.yml" 2>&1 >/dev/null)"
if grep -q 'luckycat_ping=REGISTERED' <<<"$probe_out"; then
  ok "luckycat_ping 已注册"
else
  bad "luckycat_ping 未注册: $(tr '\n' ' ' <<<"$probe_out")"
fi
if grep -q 'knowledge_lookup' <<<"$probe_out"; then
  ok "knowledge_lookup 已注册"
else
  bad "knowledge_lookup 未注册: $(tr '\n' ' ' <<<"$probe_out")"
fi
# 工具面用**集合同等**断言，而不是数字：数字看不出增删的是哪一个。
# 探针是 --patch 挂载的，所以它自己那个诊断工具也在（多出的必须只是它）。
if grep -q 'names=knowledge_lookup,luckycat_ping,luckycat_probe_secret' <<<"$probe_out"; then
  ok "工具面集合完全匹配（生产 2 个 + 探针 1 个）"
else
  bad "工具面集合不匹配（有意外增删）: $(grep 'names=' <<<"$probe_out")"
fi
# 反过来确认生产树里**没有**探针插件。
if grep -q 'luckycat-probe' <<<"$dump"; then
  bad "生产树里混进了探针插件"
else
  ok "生产树里没有探针插件（只在 --patch 时挂载）"
fi
# 关键不变式：整棵树的工具面里不许出现 shell / 编码类工具。
if grep -Eq 'names=.*(bash|shell|apply_patch|view_image|read_file|write_file|edit_file|web_search|web_fetch|exec)' <<<"$probe_out"; then
  bad "工具面里出现了 shell / 编码类工具: $(grep 'names=' <<<"$probe_out")"
else
  ok "工具面里没有任何 shell / 编码类工具"
fi

echo "== V4 离线单测（不联网） =="
unit_out="$(node --test "$LUCKYCAT_ROOT"/packages/*/tests/*.test.mjs 2>&1)"
unit_fail_count="$(sed -n 's/^# fail \([0-9]*\)$/\1/p' <<<"$unit_out")"
if [ "${unit_fail_count:-1}" = "0" ]; then
  ok "离线单测全过（$(sed -n 's/^# pass \([0-9]*\)$/\1/p' <<<"$unit_out") 个用例）"
else
  bad "离线单测有失败: $(grep '^not ok' <<<"$unit_out" | head -3 | tr '\n' ' ')"
fi

echo "== V6 日志权限（上游显式收紧，这里做回归断言） =="
# DSH 是**显式**建 0600/0700 的，不靠 umask（实测：本机 umask 0002 时仍是 600/700）。
# 这条断言的意义是：一旦上游改成依赖 umask，这里会立刻发现。
sample_log="$(find "$LUCKYCAT_HOME/sessions" -name 'session.v*.jsonl' 2>/dev/null | head -1)"
if [ -n "$sample_log" ]; then
  file_mode="$(stat -c '%a' "$sample_log")"
  if [ "$file_mode" = "600" ]; then ok "会话日志文件权限 600"; else bad "会话日志权限是 $file_mode，应为 600"; fi
  dir_mode="$(stat -c '%a' "$(dirname "$sample_log")")"
  if [ "$dir_mode" = "700" ]; then ok "会话目录权限 700"; else bad "会话目录权限是 $dir_mode，应为 700"; fi
else
  echo "  skip 还没有会话日志"
fi

echo "== V5 端到端 =="
if [ "${LUCKYCAT_E2E:-0}" = "1" ]; then
  if bash "$LUCKYCAT_ROOT/scripts/e2e-bank.sh"; then ok "端到端（知识库问答）通过"; else bad "端到端（知识库问答）失败"; fi
  if bash "$LUCKYCAT_ROOT/scripts/e2e-security.sh"; then ok "端到端（脱敏 + 白名单守卫）通过"; else bad "端到端（安全）失败"; fi
else
  echo "  skip 默认跳过（需要联网与 OPENROUTER_API_KEY；设 LUCKYCAT_E2E=1 启用）"
fi

echo
if [ "$fail" -eq 0 ]; then echo "verify: 全部通过"; else echo "verify: 有失败项"; fi
exit "$fail"