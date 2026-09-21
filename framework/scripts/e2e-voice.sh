#!/usr/bin/env bash
# 语音通道的端到端验证（需要联网 + OPENROUTER_API_KEY，会产生**极少量**费用）。
#
# 验证的是"这条链真的通"：**合成出一段真音频，再把它喂回去识别**，
# 看转出来的字是不是原来那些。这一步非做不可——
# 语音最容易接错的地方不是"请求发出去了"，而是：
#   · 音频是**二进制**不是 JSON，拿 .json() 去解会得到一堆乱码；
#   · 上游要的是**裸** base64，带上 `data:` 前缀会被当成非法音频；
#   · 格式名完全不存在时上游会 400，但**写错成另一个存在的名字它照样正确转录**
#     （按容器内容嗅探，实测：webm 的字节标成 mp3 也一模一样）。
# 这几件事都不会在应用层报错，只能靠真跑一遍看结果。
#
# 用例：
#   1. health 里如实报出语音能力（含模型名与录音上限）
#   2. 合成：中文文本 → audio/mpeg，且是能解码的真文件
#   3. 识别：把刚合成的音频喂回去 → 关键词都在（这就是"往返"）
#   4. 不认识的录音格式 → 415，**不许猜**（猜错会静默产生乱码）
#   5. 空文本 / 空音频 → 400，不往上打
#   6. 超长文本 → 截断，并且用响应头**明说被截断了**
#   7. 关掉语音的服务（LUCKYCAT_DISABLE_VOICE=1）→ health 报 false、接口 503
#
# 用法：OPENROUTER_API_KEY=... bash scripts/e2e-voice.sh
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_home.sh"

if [ -z "${OPENROUTER_API_KEY:-}" ]; then
  echo "e2e-voice: 需要 OPENROUTER_API_KEY（只检查是否存在，不打印内容）" >&2
  exit 2
fi

PORT="${LUCKYCAT_E2E_VOICE_PORT:-8801}"
OFF_PORT="${LUCKYCAT_E2E_VOICE_OFF_PORT:-8802}"
BASE="http://127.0.0.1:$PORT"
OFF_BASE="http://127.0.0.1:$OFF_PORT"
WORK="$(mktemp -d)"
fail=0
ok() { echo "  ok   $1"; }
bad() { echo "  FAIL $1"; fail=1; }

server_pid=''
off_pid=''
cleanup() {
  for pid in "$server_pid" "$off_pid"; do
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    fi
  done
  rm -rf "$WORK"
}
trap cleanup EXIT

# 等某个服务起来。
wait_for_server() {
  local base="$1" pid="$2" log="$3"
  for _ in $(seq 1 60); do
    if curl -sf "$base/agent-api/health" >/dev/null 2>&1; then return 0; fi
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "e2e-voice: 演示服务启动失败，日志尾部：" >&2
      tail -20 "$log" >&2
      return 1
    fi
    sleep 1
  done
  return 1
}

echo "== 启动演示服务（端口 $PORT） =="
LUCKYCAT_DEMO_PORT="$PORT" \
  node "$LUCKYCAT_ROOT/bridge/demo-server.mjs" >"$WORK/server.log" 2>&1 &
server_pid=$!
wait_for_server "$BASE" "$server_pid" "$WORK/server.log" || exit 1
ok "演示服务已就绪"

echo
echo "== 关闭语音的演示服务（端口 $OFF_PORT） =="
LUCKYCAT_DEMO_PORT="$OFF_PORT" LUCKYCAT_DISABLE_VOICE=1 \
  node "$LUCKYCAT_ROOT/bridge/demo-server.mjs" >"$WORK/server-off.log" 2>&1 &
off_pid=$!
wait_for_server "$OFF_BASE" "$off_pid" "$WORK/server-off.log" || exit 1
ok "关闭语音的服务已就绪"

echo
echo "== 用例 1：health 只报「有没有」语音能力，不报模型名 =="
health="$(curl -sf "$BASE/agent-api/health")"
if python3 - "$health" <<'PY'
import json, sys
health = json.loads(sys.argv[1])
voice = health.get('voice') or {}
assert voice.get('asr') is True, voice
assert voice.get('tts') is True, voice
assert isinstance(voice.get('maxSeconds'), int) and voice['maxSeconds'] > 0, voice
# 隐藏模型名：这个响应在浏览器开发者工具里看得见，所以**不许**夹带模型信息。
# 以前这条断言是反过来的（要求必须有 ttsModel/asrModel）——那和"隐藏模型名"冲突，
# 所以翻转成现在这样：确认它们真的不在了。
raw = json.dumps(health, ensure_ascii=False).lower()
for forbidden in ('ttsmodel', 'asrmodel', 'model', 'provider'):
    assert forbidden not in raw, f'health 里出现了 {forbidden}：{health}'
PY
then ok "health.voice 报了 asr/tts/录音上限，且不含任何模型名/厂商名"; else bad "health 的语音能力不对或夹带了模型信息：$health"; fi

echo
echo "== 用例 2：合成中文 → 真音频 =="
PHRASE='我的理财产品收益怎么样'
code="$(curl -s -o "$WORK/speech.mp3" -w '%{http_code} %{content_type}' \
  -X POST "$BASE/agent-api/tts" -H 'content-type: application/json' \
  -d "{\"text\":\"$PHRASE\"}")"
status="${code%% *}"; ctype="${code##* }"
size="$(wc -c < "$WORK/speech.mp3")"
if [ "$status" = "200" ] && [ "$ctype" = "audio/mpeg" ]; then
  ok "合成的响应是 200 + audio/mpeg"
else
  bad "合成的响应不对：$code"
fi
# 上游有可能"200 但内容是一段 JSON 错误"，所以还要确认这真是音频：
# MP3 要么以 ID3 开头，要么前两字节是帧同步 0xFF 0xFx。
if head -c 3 "$WORK/speech.mp3" | grep -q 'ID3' || [ "$(xxd -p -l1 "$WORK/speech.mp3")" = "ff" ]; then
  ok "回来的是真的 MP3（不是一段 JSON 错误）"
else
  bad "回来的不是 MP3，头部是：$(head -c 40 "$WORK/speech.mp3" | tr -d '\0')"
fi
if [ "$size" -gt 5000 ]; then ok "音频有实际内容（$size 字节）"; else bad "音频太小（$size 字节）"; fi

echo
echo "== 用例 3：把刚合成的音频喂回去识别（往返） =="
python3 - "$WORK/speech.mp3" "$WORK/asr.json" <<'PY'
import base64, json, sys
raw = open(sys.argv[1], 'rb').read()
# 裸 base64：不能带 data: 前缀。
with open(sys.argv[2], 'w', encoding='utf8') as f:
    json.dump({'audio': base64.b64encode(raw).decode(), 'mimeType': 'audio/mpeg', 'language': 'zh'}, f)
PY
curl -sf -X POST "$BASE/agent-api/asr" -H 'content-type: application/json' \
  -d @"$WORK/asr.json" > "$WORK/asr-out.json" 2>/dev/null
if python3 - "$WORK/asr-out.json" <<'PY'
import json, sys
try:
    data = json.load(open(sys.argv[1], encoding='utf8'))
except Exception as e:
    print(f'识别响应不是 JSON：{e}')
    raise SystemExit(1)
text = data.get('text') or ''
# 关键词必须都在：只要有一个丢了，就说明音频/格式这条链有问题。
missing = [w for w in ('理财', '收益') if w not in text]
if missing:
    print(f'转录里缺了 {missing}，实际：{text}')
    raise SystemExit(1)
if not isinstance(data.get('seconds'), (int, float)):
    print(f'没有回音频时长：{data}')
    raise SystemExit(1)
PY
then
  text="$(python3 -c "import json,sys;print(json.load(open(sys.argv[1],encoding='utf8'))['text'])" "$WORK/asr-out.json")"
  ok "往返成功：合成「$PHRASE」，识别回来「$text」"
else
  bad "往返失败：$(cat "$WORK/asr-out.json" 2>/dev/null | head -c 200)"
fi

echo
echo "== 用例 3b：浏览器真正会产生的格式（webm/opus）也要能往返 =="
# 上一条走的是 mp3（服务端合成的产物），而浏览器录出来的是 webm/opus。
# 两条路径的 MIME → 格式名映射不同，所以浏览器那个必须单独跑一遍。
if command -v ffmpeg >/dev/null 2>&1; then
  if ffmpeg -hide_banner -loglevel error -y -i "$WORK/speech.mp3" -c:a libopus -b:a 32k -f webm "$WORK/speech.webm" 2>/dev/null; then
    python3 - "$WORK/speech.webm" "$WORK/asr-webm.json" <<'WEBMJSON'
import base64, json, sys
raw = open(sys.argv[1], 'rb').read()
with open(sys.argv[2], 'w', encoding='utf8') as f:
    json.dump({'audio': base64.b64encode(raw).decode(), 'mimeType': 'audio/webm;codecs=opus', 'language': 'zh'}, f)
WEBMJSON
    curl -sf -X POST "$BASE/agent-api/asr" -H 'content-type: application/json' \
      -d @"$WORK/asr-webm.json" > "$WORK/asr-webm-out.json" 2>/dev/null
    if python3 - "$WORK/asr-webm-out.json" <<'WEBMCHECK'
import json, sys
try:
    text = (json.load(open(sys.argv[1], encoding='utf8')).get('text') or '')
except Exception:
    raise SystemExit(1)
missing = [w for w in ('理财', '收益') if w not in text]
if missing:
    print(f'缺了 {missing}，实际：{text}')
    raise SystemExit(1)
WEBMCHECK
    then ok "webm/opus（浏览器录制的格式）也能往返"; else bad "webm/opus 的往返失败：$(head -c 200 "$WORK/asr-webm-out.json" 2>/dev/null)"; fi
  else
    bad "ffmpeg 转 webm 失败"
  fi
else
  echo "  skip 没有 ffmpeg，跳过 webm/opus 往返（浏览器录的就是这个格式，建议装上再跑）"
fi

echo
echo "== 用例 4：不认识的录音格式必须被拒（不许猜） =="
code4="$(curl -s -o "$WORK/bad.json" -w '%{http_code}' -X POST "$BASE/agent-api/asr" \
  -H 'content-type: application/json' \
  -d '{"audio":"AAAA","mimeType":"audio/definitely-not-a-real-format"}')"
if [ "$code4" = "415" ]; then ok "不认识的格式返回 415"; else bad "不认识的格式返回了 $code4，应为 415"; fi
if grep -q 'accepted' "$WORK/bad.json"; then ok "拒绝时把支持的格式一并告诉调用方"; else bad "拒绝时没说支持哪些格式"; fi
# 这条断言的是"我们**拒绝**"，不是"上游会失败"：实测上游对写错的格式名是宽容的
# （按容器嗅探），所以从结果上分辨不出格式名对不对。拒绝的价值在于
# 不让一个可能静默出错的组合上路。

echo
echo "== 用例 5：空输入不往上打 =="
code5a="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/agent-api/tts" \
  -H 'content-type: application/json' -d '{"text":"   "}')"
if [ "$code5a" = "400" ]; then ok "空文本返回 400"; else bad "空文本返回了 $code5a，应为 400"; fi
code5b="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/agent-api/asr" \
  -H 'content-type: application/json' -d '{"audio":"","mimeType":"audio/mpeg"}')"
if [ "$code5b" = "400" ]; then ok "空音频返回 400"; else bad "空音频返回了 $code5b，应为 400"; fi

echo
echo "== 用例 6：超长文本截断，而且明说截断了 =="
LONG="$(python3 -c "print('余额查询结果说明。' * 200)")"
trunc="$(curl -s -o /dev/null -D - -X POST "$BASE/agent-api/tts" \
  -H 'content-type: application/json' \
  -d "$(python3 -c "import json,sys;print(json.dumps({'text':sys.argv[1]}))" "$LONG")" \
  | tr -d '\r' | grep -i '^x-luckycat-truncated:' | awk '{print $2}')"
if [ "$trunc" = "1" ]; then ok "超长文本被截断，并在响应头里写明（x-luckycat-truncated: 1）"; else bad "超长文本的截断标记是「$trunc」，应为 1"; fi

echo
echo "== 用例 7：关掉语音的服务 =="
off_health="$(curl -sf "$OFF_BASE/agent-api/health")"
if python3 - "$off_health" <<'PY'
import json, sys
voice = (json.loads(sys.argv[1]).get('voice') or {})
assert voice.get('asr') is False and voice.get('tts') is False, voice
PY
then ok "关掉语音时 health 报 asr/tts 都是 false（页面据此不显示开关）"; else bad "关掉语音时 health 还报着能力：$off_health"; fi
code7="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$OFF_BASE/agent-api/tts" \
  -H 'content-type: application/json' -d '{"text":"你好"}')"
if [ "$code7" = "503" ]; then ok "关掉语音时 /tts 返回 503（不是静默成功）"; else bad "关掉语音时 /tts 返回了 $code7，应为 503"; fi

echo
if [ "$fail" -eq 0 ]; then echo "e2e-voice: 全部通过"; else echo "e2e-voice: 有失败项"; fi
exit "$fail"
