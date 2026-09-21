#!/usr/bin/env bash
# 端到端验证（需要联网 + OPENROUTER_API_KEY）：问一道银行问题，然后查会话日志断言：
#   A. 模型真的调用了 knowledge_lookup
#   B. 会话日志里留下了注入块，且字节数不超过预算（model-visible ⟺ logged）
#   C. 检索走了向量（mode=hybrid），不是降级成关键词
#   D. 回答里出现语料才有的事实（千分之一 / 50）
#
# 用法：OPENROUTER_API_KEY=... bash scripts/e2e-bank.sh ["自定义问题"]
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_home.sh"

if [ -z "${OPENROUTER_API_KEY:-}" ]; then
  echo "e2e-bank: 需要 OPENROUTER_API_KEY（只检查是否存在，不打印内容）" >&2
  exit 2
fi

question="${1:-转账手续费怎么收？单笔最高收多少？}"
echo "e2e-bank: 提问：$question"

out="$(timeout 240 node "$LUCKYCAT_ROOT/bridge/run.mjs" "$question" 2>&1)"
bridge_status=$?
echo "$out" | sed 's/^/    /'

if [ "$bridge_status" -ne 0 ]; then
  echo "e2e-bank: FAIL 桥退出码 $bridge_status"
  exit 1
fi

session_id="$(sed -n 's/.*session=\(session-[0-9a-f]*\).*/\1/p' <<<"$out" | head -1)"
if [ -z "$session_id" ]; then
  echo "e2e-bank: FAIL 没能从输出里取到 session id"
  exit 1
fi

log_file="$(find "$LUCKYCAT_HOME/sessions" -name 'session.v*.jsonl' -path "*$session_id*" -print -quit 2>/dev/null)"
if [ -z "$log_file" ]; then
  echo "e2e-bank: FAIL 找不到会话日志：$session_id"
  exit 1
fi

python3 - "$log_file" "$out" <<'PY'
import json, sys

log_path, bridge_out = sys.argv[1], sys.argv[2]
events = []
with open(log_path, encoding='utf8') as handle:
    for line in handle:
        line = line.strip()
        if line:
            events.append(json.loads(line))

failures = []
def check(ok, label, detail=''):
    print(('  ok   ' if ok else '  FAIL ') + label + ('' if ok or not detail else f'  <- {detail}'))
    if not ok:
        failures.append(label)

def walk(node):
    """递归遍历，方便在任意深度找字段。"""
    if isinstance(node, dict):
        yield node
        for value in node.values():
            yield from walk(value)
    elif isinstance(node, list):
        for value in node:
            yield from walk(value)

# A. 工具调用
tool_calls = [n for n in walk(events) if n.get('name') == 'knowledge_lookup']
check(bool(tool_calls), 'A. 会话日志里有 knowledge_lookup 工具调用')

# B. 注入块与字节数
injections = []
for n in walk(events):
    if n.get('role') != 'user':
        continue
    for block in n.get('content') or []:
        text = block.get('text') if isinstance(block, dict) else None
        if isinstance(text, str) and '<knowledge_reference>' in text:
            injections.append(text)
check(bool(injections), 'B1. 会话日志里有 <knowledge_reference> 注入块')
if injections:
    biggest = max(len(text.encode('utf8')) for text in injections)
    check(biggest <= 2000, f'B2. 注入字节数不超预算（实测 {biggest} ≤ 2000）')

# C. 检索模式。
# 注意：工具结果的 canonical value **有意不进** durable 事件，落盘的是渲染后的文本，
# 所以必须把文本块当 JSON 解析回来才能读到 mode。
modes = []
for node in walk(events):
    for block in node.get('content') or []:
        text = block.get('text') if isinstance(block, dict) else None
        if not isinstance(text, str) or 'indexedChunks' not in text:
            continue
        try:
            modes.append(json.loads(text).get('mode'))
        except json.JSONDecodeError:
            pass
check('hybrid' in modes, f'C. 检索走了向量（mode=hybrid，实测 {modes}）')

# D. 回答里的事实
check('千分之一' in bridge_out, 'D1. 回答含「千分之一」')
check('50' in bridge_out, 'D2. 回答含「50」（单笔上限）')

print()
print(f'e2e-bank: {"全部通过" if not failures else "有失败项: " + ", ".join(failures)}')
sys.exit(1 if failures else 0)
PY