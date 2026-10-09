#!/usr/bin/env bash
# 敏感操作闸门的端到端验证（需要联网 + OPENROUTER_API_KEY）。
#
# 验证的是**用户提的那条要求**：涉及交易与敏感信息查看时，
# 必须先展示交易信息、用户确认、身份验证，才允许执行。
#
# 用例（每条都查会话日志，不靠肉眼）：
#   1. 转账：确认前**没有**回执占位；确认 + 正确支付密码后才出现
#   2. 点取消：工具体**没有**执行
#   3. 确认但密码错：执行未发生
#   4. 不回答（超时）：执行未发生
#   5. 只读查询（余额）：有确认卡片、**不**要密码，确认后返回占位余额
#   6. 一次确认只能消费一次（重复答复被拒）
#   7. 会话状态查询（`GET /agent-api/sessions/:id`）：语义正确，且**只读**（不许把会话建出来）
#
# 用法：OPENROUTER_API_KEY=... bash scripts/e2e-consent.sh
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_home.sh"

if [ -z "${OPENROUTER_API_KEY:-}" ]; then
  echo "e2e-consent: 需要 OPENROUTER_API_KEY（只检查是否存在，不打印内容）" >&2
  exit 2
fi

PORT="${LUCKYCAT_E2E_PORT:-8799}"
BASE="http://127.0.0.1:$PORT"
export LUCKYCAT_CONSENT_URL="$BASE/consent/challenge"
DEMO_PASSWORD='123456'
WRONG_PASSWORD='000000'

fail=0
ok() { echo "  ok   $1"; }
bad() { echo "  FAIL $1"; fail=1; }

server_pid=''
cleanup() {
  if [ -n "$server_pid" ] && kill -0 "$server_pid" 2>/dev/null; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT

echo "== 启动演示服务（端口 $PORT） =="
LUCKYCAT_BANK_MODE=demo LUCKYCAT_DEMO_PORT="$PORT" \
LUCKYCAT_PATCHES="$LUCKYCAT_HOME/profiles/luckycat/consent-fast-timeout.patch.yml" \
  node "$LUCKYCAT_ROOT/bridge/demo-server.mjs" >"$LUCKYCAT_HOME/e2e-consent-server.log" 2>&1 &
server_pid=$!

# 等它起来（最多 60 秒）。
for _ in $(seq 1 60); do
  if curl -sf "$BASE/agent-api/health" >/dev/null 2>&1; then break; fi
  if ! kill -0 "$server_pid" 2>/dev/null; then
    echo "e2e-consent: 演示服务启动失败，日志尾部：" >&2
    tail -20 "$LUCKYCAT_HOME/e2e-consent-server.log" >&2
    exit 1
  fi
  sleep 1
done
if ! curl -sf "$BASE/agent-api/health" >/dev/null 2>&1; then
  echo "e2e-consent: 演示服务 60 秒内没就绪，日志尾部：" >&2
  tail -20 "$LUCKYCAT_HOME/e2e-consent-server.log" >&2
  exit 1
fi
ok "演示服务已就绪"

# 每个用例用独立会话，日志互不干扰。
new_session() { curl -sf -X POST "$BASE/agent-api/sessions" | python3 -c 'import json,sys;print(json.load(sys.stdin)["sessionId"])'; }

log_for() {
  find "$LUCKYCAT_HOME/sessions" -name 'session.v*.jsonl' -path "*$1*" -print -quit 2>/dev/null
}

# 后台收 SSE 到文件，返回它的 pid。
start_stream() {
  local session="$1" out="$2"
  curl -sN "$BASE/agent-api/sessions/$session/stream" >"$out" 2>/dev/null &
  echo $!
}

# 等某个文件里出现某个模式（最多 $3 秒）。
wait_for() {
  local file="$1" pattern="$2" seconds="${3:-60}"
  for _ in $(seq 1 "$((seconds * 2))"); do
    if grep -q "$pattern" "$file" 2>/dev/null; then return 0; fi
    sleep 0.5
  done
  return 1
}

# 从 SSE 文件里取最近一条 consent 事件的 challengeId。
latest_challenge_id() {
  python3 - "$1" <<'PY'
import json, sys
found = None
for line in open(sys.argv[1], encoding='utf8'):
    line = line.strip()
    if not line.startswith('data: '):
        continue
    try:
        event = json.loads(line[6:])
    except json.JSONDecodeError:
        continue
    if event.get('type') == 'consent':
        found = event['challenge']['challengeId']
print(found or '')
PY
}

# 取 SSE 里最近一次 consent 事件的完整 JSON（用于断言展示内容）。
latest_challenge_json() {
  python3 - "$1" <<'PY'
import json, sys
found = None
for line in open(sys.argv[1], encoding='utf8'):
    line = line.strip()
    if not line.startswith('data: '):
        continue
    try:
        event = json.loads(line[6:])
    except json.JSONDecodeError:
        continue
    if event.get('type') == 'consent':
        found = event['challenge']
print(json.dumps(found or {}, ensure_ascii=False))
PY
}

# 断言会话日志里**没有**演示回执号（= 工具体没执行）。
assert_not_executed() {
  local session="$1" label="$2"
  local log; log="$(log_for "$session")"
  if [ -z "$log" ]; then bad "$label：找不到会话日志"; return; fi
  if grep -q 'LCB-DEMO-' "$log"; then bad "$label：工具体竟然执行了（日志里出现回执号）"; else ok "$label：工具体未执行"; fi
}

# 断言会话日志里**有**演示回执号。
assert_executed() {
  local session="$1" label="$2"
  local log; log="$(log_for "$session")"
  if [ -z "$log" ]; then bad "$label：找不到会话日志"; return; fi
  if grep -q 'LCB-DEMO-' "$log"; then ok "$label：工具体已执行"; else bad "$label：没有回执号，工具体没跑"; fi
}

echo
echo "== 用例 1：转账必须「展示 → 确认 → 验密码」才执行 =="
s1="$(new_session)"; f1="$LUCKYCAT_HOME/e2e-1.sse"; p1="$(start_stream "$s1" "$f1")"
curl -sf -X POST "$BASE/agent-api/sessions/$s1/messages" -H 'content-type: application/json' \
  -d '{"text":"帮我转 800 元给梁乐怡，账号尾号 9123，备注房租。"}' >/dev/null
if wait_for "$f1" '"type": *"consent"' 120; then ok "收到了待确认事项（这就是「展示交易信息」那一步）"; else bad "120 秒内没收到待确认事项"; fi

challenge_json="$(latest_challenge_json "$f1")"
cid="$(latest_challenge_id "$f1")"
echo "    挑战内容：$challenge_json"
if python3 - "$challenge_json" <<'PY'
import json, sys
challenge = json.loads(sys.argv[1])
fields = {f['label']: f['value'] for f in challenge.get('fields', [])}
assert challenge.get('toolName') == 'bank_transfer', f"toolName={challenge.get('toolName')}"
assert challenge.get('verification') == 'payment-password', 'verification 不是 payment-password'
assert '梁乐怡' in fields.get('收款人', ''), f"收款人={fields.get('收款人')}"
assert '800.00' in fields.get('转账金额', ''), f"金额={fields.get('转账金额')}"
assert fields.get('收款账号') == '**** 9123', f"收款账号={fields.get('收款账号')}"
PY
then ok "挑战里含工具名、收款人、金额、尾号，且要求支付密码"; else bad "挑战内容不完整或验证方式不对"; fi

# 确认之前：工具体绝不能执行。
assert_not_executed "$s1" "确认前"

curl -sf -X POST "$BASE/agent-api/consent/$cid" -H 'content-type: application/json' \
  -d "{\"decision\":\"approve\",\"paymentPassword\":\"$DEMO_PASSWORD\"}" >/dev/null
if wait_for "$f1" 'LCB-DEMO-\|tool-result' 120; then ok "确认 + 验证后收到工具结果"; else bad "确认后没有工具结果"; fi
sleep 2
assert_executed "$s1" "确认 + 正确密码后"

# 审计事件成对：approval/asked 与 approval/decided 的 id 必须一致。
log1="$(log_for "$s1")"
if python3 - "$log1" <<'PY'
import json, sys
asked = decided = None
for line in open(sys.argv[1], encoding='utf8'):
    line = line.strip()
    if not line:
        continue
    event = json.loads(line)
    if event['type'] == 'approval/asked':
        asked = event['data']['id']
    elif event['type'] == 'approval/decided':
        decided = event['data']
assert asked is not None, '没有 approval/asked 审计事件'
assert decided is not None, '没有 approval/decided 审计事件'
assert decided['id'] == asked, 'asked/decided 的 id 不成对'
assert decided['outcome'] == 'allowed-once', f"outcome={decided['outcome']}"
PY
then ok "审计事件成对，且结果是 allowed-once（一次性批准）"; else bad "审计事件不成对或结果不是 allowed-once"; fi

if grep -qF "$DEMO_PASSWORD" "$log1" 2>/dev/null; then
  bad "支付密码进了 agent 会话日志"
else
  ok "支付密码没有进 agent 会话日志"
fi
kill "$p1" 2>/dev/null || true

echo
echo "== 用例 2：用户取消 → 不执行 =="
s2="$(new_session)"; f2="$LUCKYCAT_HOME/e2e-2.sse"; p2="$(start_stream "$s2" "$f2")"
curl -sf -X POST "$BASE/agent-api/sessions/$s2/messages" -H 'content-type: application/json' \
  -d '{"text":"转 300 元给陈嘉禾，账号尾号 6688，备注水电。"}' >/dev/null
wait_for "$f2" '"type": *"consent"' 120 || bad "用例 2：没收到待确认事项"
cid2="$(latest_challenge_id "$f2")"
curl -sf -X POST "$BASE/agent-api/consent/$cid2" -H 'content-type: application/json' \
  -d '{"decision":"reject"}' >/dev/null
wait_for "$f2" 'consent-decided' 60 || true
sleep 2
assert_not_executed "$s2" "取消后"
kill "$p2" 2>/dev/null || true

echo
echo "== 用例 3：确认但支付密码错误 → 不执行 =="
s3="$(new_session)"; f3="$LUCKYCAT_HOME/e2e-3.sse"; p3="$(start_stream "$s3" "$f3")"
curl -sf -X POST "$BASE/agent-api/sessions/$s3/messages" -H 'content-type: application/json' \
  -d '{"text":"转 500 元给梁乐怡，账号尾号 9123，备注测试。"}' >/dev/null
wait_for "$f3" '"type": *"consent"' 120 || bad "用例 3：没收到待确认事项"
cid3="$(latest_challenge_id "$f3")"
code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/agent-api/consent/$cid3" \
  -H 'content-type: application/json' -d "{\"decision\":\"approve\",\"paymentPassword\":\"$WRONG_PASSWORD\"}")"
if [ "$code" = "401" ]; then ok "错误密码被拒（HTTP 401）"; else bad "错误密码的响应码是 $code，应为 401"; fi
sleep 2
assert_not_executed "$s3" "密码错误后"
kill "$p3" 2>/dev/null || true

echo
echo "== 用例 4：不回答（超时）→ 不执行 =="
s4="$(new_session)"; f4="$LUCKYCAT_HOME/e2e-4.sse"; p4="$(start_stream "$s4" "$f4")"
curl -sf -X POST "$BASE/agent-api/sessions/$s4/messages" -H 'content-type: application/json' \
  -d '{"text":"转 120 元给梁乐怡，账号尾号 9123，备注不回答测试。"}' >/dev/null
wait_for "$f4" '"type": *"consent"' 120 || bad "用例 4：没收到待确认事项"
# 什么都不做，等插件的 20 秒超时（overlay 压过）走完。
wait_for "$f4" 'consent-resolved' 60 || bad "用例 4：超时后没有结算事件"
sleep 3
assert_not_executed "$s4" "超时后"
kill "$p4" 2>/dev/null || true

echo
echo "== 用例 5：只读查询只要确认、不要密码 =="
s5="$(new_session)"; f5="$LUCKYCAT_HOME/e2e-5.sse"; p5="$(start_stream "$s5" "$f5")"
curl -sf -X POST "$BASE/agent-api/sessions/$s5/messages" -H 'content-type: application/json' \
  -d '{"text":"我的账户余额还有多少？"}' >/dev/null
if wait_for "$f5" '"type": *"consent"' 120; then ok "余额查询也走确认（敏感信息查看）"; else bad "余额查询没有确认"; fi
challenge5="$(latest_challenge_json "$f5")"
cid5="$(latest_challenge_id "$f5")"
if python3 - "$challenge5" <<'PY'
import json, sys
challenge = json.loads(sys.argv[1])
assert challenge.get('verification') is None, f"只读查询不该要求验证，实际 {challenge.get('verification')}"
PY
then ok "只读查询不要求身份验证（当前口径）"; else bad "只读查询被要求验证"; fi
curl -sf -X POST "$BASE/agent-api/consent/$cid5" -H 'content-type: application/json' \
  -d '{"decision":"approve"}' >/dev/null
if wait_for "$f5" 'balance' 120; then ok "确认后返回了占位余额"; else bad "确认后没有余额结果"; fi
sleep 1
log5="$(log_for "$s5")"
if grep -q '演示占位数据' "$log5" 2>/dev/null; then ok "工具结果带「演示占位数据」声明"; else bad "工具结果没带演示声明"; fi
kill "$p5" 2>/dev/null || true

echo
echo "== 用例 6：一次确认只能消费一次（重复答复被拒） =="
s6="$(new_session)"; f6="$LUCKYCAT_HOME/e2e-6.sse"; p6="$(start_stream "$s6" "$f6")"
curl -sf -X POST "$BASE/agent-api/sessions/$s6/messages" -H 'content-type: application/json' \
  -d '{"text":"转 60 元给陈嘉禾，账号尾号 6688，备注一次性测试。"}' >/dev/null
wait_for "$f6" '"type": *"consent"' 120 || bad "用例 6：没收到待确认事项"
cid6="$(latest_challenge_id "$f6")"
first="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/agent-api/consent/$cid6" \
  -H 'content-type: application/json' -d '{"decision":"approve","paymentPassword":"123456"}')"
second="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/agent-api/consent/$cid6" \
  -H 'content-type: application/json' -d '{"decision":"approve","paymentPassword":"123456"}')"
if [ "$first" = "200" ]; then ok "第一次答复被接受（200）"; else bad "第一次答复的响应码是 $first"; fi
if [ "$second" = "404" ]; then ok "第二次答复被拒（404，挑战已消费）"; else bad "第二次答复的响应码是 $second，应为 404"; fi
sleep 3
log6="$(log_for "$s6")"
# 工具体只应执行一次：日志里只出现一个回执号。
refs="$(grep -o 'LCB-DEMO-[0-9]*' "$log6" 2>/dev/null | sort -u | wc -l)"
if [ "$refs" = "1" ]; then ok "工具体只执行了一次（回执号唯一）"; else bad "回执号数量是 $refs，应为 1"; fi
kill "$p6" 2>/dev/null || true

echo
echo "== 用例 7：网页问「这段对话的上下文还在吗」时不许有副作用 =="
# 网页把历史对话存在浏览器里，刷新后拿着旧 id 回来问一句。这一问必须是**只读**的：
# 顺手把它建出来，每个历史对话都会被问成「还在」，失忆提示就永远不会出现。
s7="$(new_session)"
state7="$(curl -sf "$BASE/agent-api/sessions/$s7")"
if python3 - "$state7" <<'PY'
import json, sys
state = json.loads(sys.argv[1])
assert state['known'] is True, state
assert state['started'] is False, state   # 建过 ≠ 跑过
PY
then ok "刚建、还没跑过的会话报 known=true / started=false（建过不等于跑过）"; else bad "新建会话的状态不对：$state7"; fi

before7="$(curl -sf "$BASE/agent-api/health" | python3 -c 'import json,sys;print(json.load(sys.stdin)["sessions"])')"
for _ in 1 2 3; do curl -sf "$BASE/agent-api/sessions/web-never-existed" >/dev/null; done
after7="$(curl -sf "$BASE/agent-api/health" | python3 -c 'import json,sys;print(json.load(sys.stdin)["sessions"])')"
if [ "$before7" = "$after7" ]; then ok "问一个不存在的会话不会把它建出来（服务端会话数 $before7 → $after7）"; else bad "查询竟然建了会话（$before7 → $after7）"; fi
ghost7="$(curl -sf "$BASE/agent-api/sessions/web-never-existed")"
if python3 - "$ghost7" <<'PY'
import json, sys
state = json.loads(sys.argv[1])
assert state['known'] is False and state['started'] is False, state
PY
then ok "不存在的会话报 known=false / started=false"; else bad "不存在的会话状态不对：$ghost7"; fi

# 跑过一轮之后，同一个 id 必须变成 started=true —— 这是"上下文还在"的唯一依据。
curl -sf -X POST "$BASE/agent-api/sessions/$s7/messages" -H 'content-type: application/json' \
  -d '{"text":"你好，只回复两个字：收到。"}' >/dev/null
ran7=0
for _ in $(seq 1 120); do
  if curl -sf "$BASE/agent-api/sessions/$s7" | grep -q '"started": *true'; then ran7=1; break; fi
  sleep 1
done
if [ "$ran7" = "1" ]; then ok "跑过一轮之后同一个会话变成 started=true（网页据此判断上下文还在）"; else bad "跑过一轮之后 started 仍然是 false"; fi

echo
if [ "$fail" -eq 0 ]; then echo "e2e-consent: 全部通过"; else echo "e2e-consent: 有失败项"; fi
exit "$fail"
