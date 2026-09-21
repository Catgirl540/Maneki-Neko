/**
 * 探针：验证火山引擎语音技术「单向流式 TTS」的线上协议（先于桥接实现跑）。
 *
 * 目的：文档里的帧格式（4 字节头 + 事件号 + session_id + payload）与实际线上返回
 * 对准——音频帧到底是 JSON 里 base64 的 audio_binary，还是 raw 二进制 PCM；
 * 事件号、结束帧、错误帧长什么样。对准之后桥接才照着写，避免猜。
 *
 * 用法（凭据来自环境变量，不打印）：
 *   VOLC_APP_ID=… VOLC_ACCESS_TOKEN=… node framework/scripts/probe-volc-stream.mjs
 *   （也可先 source ~/.zshrc）
 */
import WebSocket from 'ws'

const APP_ID = process.env.VOLC_APP_ID ?? ''
const ACCESS_TOKEN = process.env.VOLC_ACCESS_TOKEN ?? ''
const RESOURCE_ID = process.env.LUCKYCAT_VOLC_RESOURCE ?? 'seed-tts-2.0'
const SPEAKER = process.env.LUCKYCAT_VOLC_SPEAKER ?? 'zh_female_cancan_mars_bigtts'
const SAMPLE_RATE = Number(process.env.LUCKYCAT_VOLC_SAMPLE_RATE ?? 24000)
const TEXT = process.argv[2] ?? '你好，我是招财猫银行的智能助手。请问有什么可以帮您？'

if (APP_ID === '' || ACCESS_TOKEN === '') {
  console.error('缺少 VOLC_APP_ID / VOLC_ACCESS_TOKEN（放 ~/.zshrc 或环境变量里）')
  process.exit(2)
}

const URL = 'wss://openspeech.bytedance.com/api/v3/tts/unidirectional/stream'

/** 组一帧：4 字节头 + 大端长度 + payload。 */
function frame(header, payload) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8')
  const out = Buffer.alloc(4 + 4 + body.length)
  header.copy(out, 0)
  out.writeUInt32BE(body.length, 4)
  body.copy(out, 8)
  return out
}

/** SendText：无事件号。byte1=0x10（Full-client request，无事件号），byte2=0x10（JSON）。 */
function sendTextFrame(text) {
  const payload = JSON.stringify({
    user: { uid: 'luckycat' },
    req_params: {
      text,
      speaker: SPEAKER,
      audio_params: { format: 'pcm', sample_rate: SAMPLE_RATE },
      additions: '{}',
    },
  })
  return frame(Buffer.from([0x11, 0x10, 0x10, 0x00]), payload)
}

/** FinishConnection：带事件号 2。byte1=0x14，字节 4-7 放事件号，之后 payload。 */
function finishFrame() {
  const payload = Buffer.from('{}')
  const out = Buffer.alloc(4 + 4 + 4 + payload.length)
  Buffer.from([0x11, 0x14, 0x10, 0x00]).copy(out, 0)
  out.writeUInt32BE(2, 4)
  out.writeUInt32BE(payload.length, 8)
  payload.copy(out, 12)
  return out
}

/** 解析一个服务端帧；返回描述对象。解析失败时返回原始 hex 前 32 字节。 */
function parseServerFrame(buf) {
  if (buf.length < 4) return { raw: buf.toString('hex') }
  const versionHeader = buf[0]
  const byte1 = buf[1]
  const serialization = buf[2]
  let at = 4
  const hasEventNumber = (byte1 & 0x04) !== 0
  let event = null
  if (hasEventNumber) {
    if (buf.length < at + 4) return { raw: buf.toString('hex') }
    event = buf.readUInt32BE(at)
    at += 4
  }
  // 事件帧之后：session_id 长度 + session_id + payload 长度 + payload
  let sessionId = null
  let payload = null
  try {
    if (buf.length >= at + 4) {
      const sidLen = buf.readUInt32BE(at)
      at += 4
      if (sidLen > 0 && buf.length >= at + sidLen) {
        sessionId = buf.toString('utf8', at, at + sidLen)
        at += sidLen
      }
    }
    if (buf.length >= at + 4) {
      const payloadLen = buf.readUInt32BE(at)
      at += 4
      if (payloadLen > 0 && buf.length >= at + payloadLen) {
        payload = buf.subarray(at, at + payloadLen)
      }
    }
  } catch {
    /* 布局不对就退回 raw */
  }
  return { versionHeader, byte1, serialization, hasEventNumber, event, sessionId, payload }
}

function describe(p) {
  if (p.payload === null) return { ...p, payload: null, note: 'payload 解析失败' }
  if (p.serialization === 0x10) {
    const text = p.payload.toString('utf8')
    try {
      const json = JSON.parse(text)
      const keys = Object.keys(json)
      const audio = typeof json.audio_binary === 'string' ? json.audio_binary : null
      return {
        ...p,
        payload: null,
        note: `JSON keys=[${keys.join(',')}]`,
        audioBase64: audio === null ? null : audio.length,
        audioBytes: audio === null ? null : Buffer.from(audio, 'base64').length,
        text: json.text ?? json.message ?? null,
        full: keys.includes('error') ? JSON.stringify(json) : null,
      }
    } catch {
      return { ...p, payload: null, note: `JSON 解析失败，头 80 字节：${text.slice(0, 80)}` }
    }
  }
  // raw（音频二进制）：按 PCM16 校验
  const bytes = p.payload
  const even = bytes.length % 2 === 0
  let first = null
  let peak = 0
  if (even) {
    for (let i = 0; i < Math.min(bytes.length, 4000); i += 2) {
      const v = bytes.readInt16LE(i)
      if (Math.abs(v) > peak) peak = Math.abs(v)
    }
    first = bytes.readInt16LE(0)
  }
  return { ...p, payload: null, note: `raw ${bytes.length} 字节 PCM16${even ? '' : '（长度非偶数!）'} first=${first} peak≈${peak}` }
}

console.log(`连接 ${URL}`)
console.log(`模型 ${RESOURCE_ID} 音色 ${SPEAKER} 采样率 ${SAMPLE_RATE} pcm`)
console.log(`文本（${TEXT.length} 字）：${TEXT.slice(0, 40)}${TEXT.length > 40 ? '…' : ''}`)

const ws = new WebSocket(URL, {
  headers: {
    'X-Api-App-Id': APP_ID,
    'X-Api-Access-Key': ACCESS_TOKEN,
    'X-Api-Resource-Id': RESOURCE_ID,
    'X-Api-Request-Id': `${Date.now()}-probe`,
    'X-Control-Require-Usage-Tokens-Return': '*',
  },
})

let audioBytes = 0
let audioFrames = 0
let finished = false

const timeout = setTimeout(() => {
  console.error('探针超时（15 秒无结束）')
  ws.close()
  process.exit(1)
}, 15000)

ws.on('open', () => {
  console.log('握手成功，发送 SendText…')
  ws.send(sendTextFrame(TEXT))
})

ws.on('message', (data) => {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data)
  const p = parseServerFrame(buf)
  if (p.raw !== undefined) {
    console.log(`[未知帧] ${buf.length} 字节：${buf.subarray(0, 32).toString('hex')}`)
    return
  }
  const d = describe(p)
  if (d.event === 352) {
    audioFrames += 1
    audioBytes += p.payload === null ? 0 : p.payload.length
    console.log(`[352 音频帧] 第 ${audioFrames} 帧 ${d.note ?? ''}`)
  } else {
    console.log(`[${d.event ?? '?'}] serialization=${d.serialization} ${d.note ?? ''}${d.text !== null ? ` text=${d.text}` : ''}${d.full !== null ? ` FULL=${d.full}` : ''}`)
  }
  if (d.event === 152) {
    finished = true
    console.log(`会话结束：共 ${audioFrames} 个音频帧、${audioBytes} 字节 PCM`)
    clearTimeout(timeout)
    // 按文档走 FinishConnection 再关
    try { ws.send(finishFrame()) } catch { /* 已经关了就算了 */ }
    setTimeout(() => ws.close(), 300)
  }
})

ws.on('error', (err) => {
  console.error('WS 错误：', err.message)
  clearTimeout(timeout)
  process.exit(1)
})

ws.on('close', (code, reason) => {
  clearTimeout(timeout)
  console.log(`连接关闭 code=${code} reason=${reason.toString()}`)
  process.exit(finished ? 0 : 1)
})
