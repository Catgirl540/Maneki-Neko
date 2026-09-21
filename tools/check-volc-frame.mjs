/**
 * 火山流式 TTS 协议层的离线门禁（不起网络、不花钱）。
 *
 * 帧构造与解析是纯函数（`framework/bridge/volc-stream.mjs`），可以直接喂
 * 合成的字节断言。网络那一层（真连、真合成）由 check-voice 的流式段覆盖，
 * 而且那段只验证「接线」，不重复这里已经钉死的格式。
 *
 *   node tools/check-volc-frame.mjs
 */
import {
  buildSendTextFrame,
  buildFinishFrame,
  parseServerFrame,
  jsonPayload,
} from '../framework/bridge/volc-stream.mjs'

let failures = 0
const report = (ok, title, lines = []) => {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${title}`)
  for (const line of lines) console.log(`      ${line}`)
}

/** 拼一个服务端事件帧（350/351/152：JSON；352：raw 音频）。 */
function serverFrame(event, sid, payload, serialization = 0x10) {
  const sidBuf = Buffer.from(sid, 'utf8')
  const body = Buffer.concat([
    Buffer.alloc(4), // 事件号占位
    uint32(sidBuf.length), sidBuf,
    uint32(payload.length), payload,
  ])
  body.writeUInt32BE(event, 0)
  const header = Buffer.from([0x11, 0x94, serialization, 0x00])
  return Buffer.concat([header, body])
}

const uint32 = (n) => {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(n)
  return b
}

console.log('== A. 客户端帧构造 ==')

{
  const frame = buildSendTextFrame({ text: '你好。', speaker: 'zh_female_xiaohe_uranus_bigtts', sampleRate: 24000 })
  const header = [...frame.subarray(0, 4)]
  report(
    header[0] === 0x11 && header[1] === 0x10 && header[2] === 0x10 && header[3] === 0x00,
    'A1 SendText 头是 [0x11,0x10,0x10,0x00]（v1 / Full-client / JSON / 无压缩）',
    [`实际：${header.map((b) => '0x' + b.toString(16).padStart(2, '0')).join(',')}`],
  )
  const len = frame.readUInt32BE(4)
  const json = JSON.parse(frame.subarray(8, 8 + len).toString('utf8'))
  report(
    json.req_params.text === '你好。' &&
      json.req_params.speaker === 'zh_female_xiaohe_uranus_bigtts' &&
      json.req_params.audio_params.format === 'pcm' &&
      json.req_params.audio_params.sample_rate === 24000,
    'A2 SendText 载荷带 text/speaker/pcm/采样率',
    [`JSON：${JSON.stringify(json)}`],
  )
  report(
    typeof json.req_params.additions === 'string',
    'A3 additions 必须是字符串（实测：给对象会被服务端拒绝）',
    [`typeof = ${typeof json.req_params.additions}`],
  )
}

{
  const frame = buildFinishFrame()
  report(
    [...frame.subarray(0, 4)].join(',') === [0x11, 0x14, 0x10, 0x00].join(',') &&
      frame.readUInt32BE(4) === 2,
    'A4 FinishConnection 头对、事件号是 2',
  )
  const len = frame.readUInt32BE(8)
  report(JSON.parse(frame.subarray(12, 12 + len).toString('utf8')) && len === 2, 'A5 FinishConnection 载荷是空对象')
}

console.log('\n== B. 服务端帧解析 ==')

{
  const sid = '9842cf26-463e-415a-a92b-7655a6d83ca6'
  const text = '你好，我是招财猫银行的智能助手。'
  const parsed = parseServerFrame(serverFrame(350, sid, Buffer.from(JSON.stringify({ text }), 'utf8')))
  report(parsed.event === 350, 'B1 350（句开始）事件号解析正确', [`event=${parsed.event}`])
  report(parsed.sessionId === sid, 'B2 session_id 原样读出', [`sessionId=${parsed.sessionId}`])
  const json = jsonPayload(parsed)
  report(json !== null && json.text === text, 'B3 350 的 payload 是 JSON 且 text 正确', [`text=${json?.text}`])
}

{
  // 352：raw 音频帧，serialization=0x00
  const audio = Buffer.from([0x00, 0x01, 0xff, 0xfe, 0x10, 0x00, 0x20, 0x00])
  const parsed = parseServerFrame(serverFrame(352, 's1', audio, 0x00))
  report(parsed.event === 352, 'B4 352（音频）事件号解析正确')
  report(parsed.serialization === 0x00, 'B5 352 是 raw 序列化（不是 JSON）', [`serialization=${parsed.serialization}`])
  report(parsed.payload !== null && parsed.payload.equals(audio), 'B6 352 的 payload 就是裸二进制 PCM', [
    `payload ${parsed.payload?.length} 字节`,
  ])
  report(jsonPayload(parsed) === null, 'B7 352 的 payload 不是 JSON（别按 JSON 去读）')
}

{
  const parsed = parseServerFrame(serverFrame(152, 's1', Buffer.from(JSON.stringify({ usage: { text_words: 26 } }), 'utf8')))
  const json = jsonPayload(parsed)
  report(parsed.event === 152 && json !== null && json.usage.text_words === 26, 'B8 152（会话结束）带 usage', [
    JSON.stringify(json),
  ])
}

{
  // 错误帧：JSON 里有 error 字段，桥接靠它把上游错误转成 error 事件
  const parsed = parseServerFrame(serverFrame(0, 's1', Buffer.from(JSON.stringify({ error: 'resource ID is mismatched' }), 'utf8')))
  const json = jsonPayload(parsed)
  report(json !== null && typeof json.error === 'string' && json.error.includes('mismatched'), 'B9 错误帧的 error 文本可读', [
    `error=${json?.error}`,
  ])
}

{
  const parsed = parseServerFrame(Buffer.from([0x11, 0x94]))
  report(parsed.event === null && parsed.payload === null, 'B10 太短的帧解析失败但不抛异常')
}

console.log(failures === 0 ? '\ncheck-volc-frame: 全部通过' : `\ncheck-volc-frame: ${failures} 项失败`)
process.exit(failures === 0 ? 0 : 1)
