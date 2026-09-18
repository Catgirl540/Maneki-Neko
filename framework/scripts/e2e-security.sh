#!/usr/bin/env bash
# 端到端安全验证（需要联网 + OPENROUTER_API_KEY）。两个阶段：
#
#   阶段 1 —— 工具结果脱敏：让模型调用"返回假密钥"的探针工具，断言
#             密钥既没进会话日志，也**没进模型看到的文本**。
#   阶段 2 —— 白名单守卫：挂上探针但**不加白名单**，断言调用被拒绝，
#             且拒绝理由进了日志（fail-closed）。
#
# 用法：OPENROUTER_API_KEY=... bash scripts/e2e-security.sh
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_home.sh"

if [ -z "${OPENROUTER_API_KEY:-}" ]; then
  echo "e2e-security: 需要 OPENROUTER_API_KEY（只检查是否存在，不打印内容）" >&2
  exit 2
fi

fail=0
ok() { echo "  ok   $1"; }
bad() { echo "  FAIL $1"; fail=1; }

FAKE_ENV='fake-probe-secret-value-123456'
FAKE_SK='sk-or-v1-fakefakefakefakefakefakefake'
export LUCKYCAT_PROBE_FAKE_SECRET="$FAKE_ENV"

# 找到某个 session 的日志文件。
log_for() {
  find "$LUCKYCAT_HOME/sessions" -name 'session.v*.jsonl' -path "*$1*" | head -1
}

run_bridge() {
  local patch="$1" question="$2"
  LUCKYCAT_PATCHES="$patch" timeout 240 node "$LUCKYCAT_ROOT/bridge/run.mjs" "$question" 2>&1
}

echo "== 阶段 1：工具结果脱敏 =="
out="$(run_bridge "$LUCKYCAT_HOME/profiles/luckycat/doctor.patch.yml" \
  '请调用 luckycat_probe_secret 工具，然后把返回的内容一字不差、完整地告诉我。')"
echo "$out" | sed 's/^/    /'

if grep -q '\[REDACTED:' <<<"$out"; then ok "模型看到的是脱敏后的占位（[REDACTED:…]）"; else bad "模型没看到脱敏占位"; fi
if grep -qF "$FAKE_ENV" <<<"$out"; then bad "环境变量取值泄漏到了模型可见文本"; else ok "环境变量取值没有出现在模型可见文本里"; fi
if grep -qF "$FAKE_SK" <<<"$out"; then bad "sk- 形态密钥泄漏到了模型可见文本"; else ok "sk- 形态密钥没有出现在模型可见文本里"; fi

session_id="$(sed -n 's/.*session=\(session-[0-9a-f]*\).*/\1/p' <<<"$out" | head -1)"
log_path="$(log_for "$session_id")"
if [ -z "$log_path" ]; then
  bad "找不到会话日志（$session_id）"
else
  if grep -qF "$FAKE_ENV" "$log_path"; then bad "环境变量取值进了会话日志"; else ok "环境变量取值没有进会话日志"; fi
  if grep -qF "$FAKE_SK" "$log_path"; then bad "sk- 形态密钥进了会话日志"; else ok "sk- 形态密钥没有进会话日志"; fi
  if grep -q 'REDACTED' "$log_path"; then ok "会话日志里留下的是脱敏后的文本"; else bad "会话日志里没有脱敏痕迹（脱敏没生效？）"; fi
fi

echo "== 阶段 2：白名单守卫（fail-closed） =="
out2="$(run_bridge "$LUCKYCAT_HOME/profiles/luckycat/probe-denied.patch.yml" \
  '请调用 luckycat_probe_secret 工具，然后告诉我返回了什么。')"
echo "$out2" | sed 's/^/    /'

session_id2="$(sed -n 's/.*session=\(session-[0-9a-f]*\).*/\1/p' <<<"$out2" | head -1)"
log_path2="$(log_for "$session_id2")"
if [ -z "$log_path2" ]; then
  bad "找不到阶段 2 的会话日志（$session_id2）"
else
  if grep -q 'not enabled in this deployment' "$log_path2"; then
    ok "拒绝理由进了日志（白名单外被拒）"
  else
    bad "日志里没有拒绝理由（守卫没生效？）"
  fi
  if grep -qF "$FAKE_SK" "$log_path2"; then
    bad "被拒的工具竟然执行了（密钥进了日志）"
  else
    ok "被拒的工具确实没有执行（工具体未运行）"
  fi
fi

echo
if [ "$fail" -eq 0 ]; then echo "e2e-security: 全部通过"; else echo "e2e-security: 有失败项"; fi
exit "$fail"