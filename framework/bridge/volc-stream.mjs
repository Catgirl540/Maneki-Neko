/**
 * 火山引擎语音技术「单向流式 TTS」的协议层（浏览器侧永远看不到这里）。
 *
 * 只做一件事：把一段文字交给火山，把回来的 PCM 音频帧**一帧一帧**交给调用方。
 * 帧格式来自官方文档（`wss://openspeech.bytedance.com/api/v3/tts/unidirectional/stream`），
 * 并用 `scripts/probe-volc-stream.mjs` 实测对准过：
 *
 *   · 客户端 SendText：4 字节头 `[0x11, 0x10, 0x10, 0x00]` + 大端长度 + JSON
 *   · 服务端事件帧：4 字节头（byte1 低 4 位含「带事件号」标志）+ 事件号 +
 *     session_id + payload
 *   · 352（音频帧）：**裸二进制 PCM16 LE**（serialization=0x00，不是 JSON）
 *   · 350/351：句起止，payload 是 JSON（含 text）
 *   · 152：会话结束（JSON，带 usage）；52：连接结束
 *
 * 帧构造与解析都是纯函数（`tools/check-volc-frame.mjs` 离线测，不起网络）。
 * 密钥只来自环境变量，本模块不打印、不落盘。
 *
 * @module bridge/volc-stream
 */

import WebSocket from 'ws'

/** 火山单向流式 TTS 的地址（官方文档固定值）。 */
export const VOLC_WSS_URL = 'wss://openspeech.bytedance.com/api/v3/tts/unidirectional/stream'

/** 文档里的事件号。 */
export const EVT_SENTENCE_START = 350
export const EVT_SENTENCE_END = 351
export const EVT_AUDIO = 352
export const EVT_SESSION_FINISHED = 152

/* ------------------------------------------------------------------ 帧构造 */

/**
 * SendText 帧：把要合成的文字一次性发出去。
 * @param params - `text`、`speaker`、`sampleRate`（默认 24000）、`uid`。
 * @returns 完整二进制帧。
 */
export function buildSendTextFrame({ text, speaker, sampleRate = 24000, uid = 'luckycat' }) {
  const payload = JSON.stringify({
    user: { uid },
    req_params: {
      text,
      speaker,
      audio_params: { format: 'pcm', sample_rate: sampleRate },
      // 实测：`additions` 必须是 JSON **字符串**，给对象会报
      // "cannot unmarshal object into … additions of type string"
      additions: '{}',
    },
  })
  return buildFrame([0x11, 0x10, 0x10, 0x00], Buffer.from(payload, 'utf8'))
}

/**
 * FinishConnection 帧：会话结束后告诉服务端可以收尾（带事件号 2）。
 * @returns 完整二进制帧。
 */
export function buildFinishFrame() {
  const payload = Buffer.from('{}')
  const out = Buffer.alloc(4 + 4 + 4 + payload.length)
  Buffer.from([0x11, 0x14, 0x10, 0x00]).copy(out, 0)
  out.writeUInt32BE(2, 4)
  out.writeUInt32BE(payload.length, 8)
  payload.copy(out, 12)
  return out
}

/** 通用组帧：4 字节头 + 大端 payload 长度 + payload。 */
function buildFrame(header, payload) {
  const out = Buffer.alloc(4 + 4 + payload.length)
  Buffer.from(header).copy(out, 0)
  out.writeUInt32BE(payload.length, 4)
  payload.copy(out, 8)
  return out
}

/* ------------------------------------------------------------------ 帧解析 */

/** 解析结果：`{ event, serialization, sessionId, payload }`；解析不了时 `payload` 为 null。 */
export function parseServerFrame(buf) {
  if (buf.length < 4) return { event: null, serialization: null, sessionId: null, payload: null }
  const byte1 = buf[1]
  const serialization = buf[2]
  let at = 4
  const hasEventNumber = (byte1 & 0x04) !== 0
  let event = null
  if (hasEventNumber) {
    if (buf.length < at + 4) return { event: null, serialization, sessionId: null, payload: null }
    event = buf.readUInt32BE(at)
    at += 4
  }
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
    /* 布局不对：payload 保持 null，调用方按解析失败处理 */
  }
  return { event, serialization, sessionId, payload }
}

/** payload 是 JSON 时解析成对象；不是就返回 null。 */
export function jsonPayload(parsed) {
  if (parsed.payload === null || parsed.serialization !== 0x10) return null
  try {
    return JSON.parse(parsed.payload.toString('utf8'))
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ 流式助手 */

/**
 * 跑一次单向流式合成，把每一帧音频（裸 PCM16）通过 `onAudio` 交出去。
 *
 * @param options
 *   - `text` 要合成的文字。
 *   - `speaker` 音色 id。
 *   - `sampleRate` 请求的采样率（默认 24000）。
 *   - `resourceId` 资源 id（默认 seed-tts-2.0）。
 *   - `appId` / `accessToken` 火山旧版控制台凭据（必填）。
 *   - `onAudio(buffer)` 每收到一个 352 帧调一次。
 *   - `onEvent(parsed, json)` 每个事件帧调一次（350/351/152 等，方便日志/字幕）。
 *   - `signal` AbortSignal：客户端断开时用来掐断上游。
 *   - `timeoutMs` 总超时（默认 30 秒）；`idleMs` 帧间空闲超时（默认 15 秒）。
 * @returns Promise<{ frames, bytes }>，152 结束时 resolve；出错 reject（message 为原因）。
 */
export function streamVolcTTS({
  text,
  speaker,
  sampleRate = 24000,
  resourceId = 'seed-tts-2.0',
  appId,
  accessToken,
  onAudio,
  onEvent,
  signal,
  timeoutMs = 30_000,
  idleMs = 15_000,
}) {
  return new Promise((resolvePromise, rejectPromise) => {
    if (appId === '' || accessToken === '') {
      rejectPromise(new Error('服务端没有配置火山语音凭据（VOLC_APP_ID / VOLC_ACCESS_TOKEN）'))
      return
    }
    const ws = new WebSocket(VOLC_WSS_URL, {
      headers: {
        'X-Api-App-Id': appId,
        'X-Api-Access-Key': accessToken,
        'X-Api-Resource-Id': resourceId,
        'X-Api-Request-Id': `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        'X-Control-Require-Usage-Tokens-Return': '*',
      },
    })

    let settled = false
    let sessionFinished = false
    let audioFrames = 0
    let audioBytes = 0
    let lastFrameAt = Date.now()
    const stats = () => ({ frames: audioFrames, bytes: audioBytes })

    const finish = (error) => {
      if (settled) return
      settled = true
      clearTimers()
      try { ws.close() } catch { /* 已经关了就算了 */ }
      if (error === null || error === undefined) resolvePromise(stats())
      else rejectPromise(error instanceof Error ? error : new Error(String(error)))
    }

    const timer = setTimeout(() => {
      finish(new Error(`火山流式合成超时（${timeoutMs}ms）`))
    }, timeoutMs)
    const idleTimer = setInterval(() => {
      if (Date.now() - lastFrameAt > idleMs) {
        finish(new Error(`火山流式合成帧间空闲超时（${idleMs}ms）`))
      }
    }, 2000)
    const clearTimers = () => {
      clearTimeout(timer)
      clearInterval(idleTimer)
    }
    if (signal !== undefined) {
      if (signal.aborted) {
        finish(new Error('aborted'))
        return
      }
      signal.addEventListener('abort', () => finish(new Error('aborted')), { once: true })
    }

    ws.on('open', () => {
      ws.send(buildSendTextFrame({ text, speaker, sampleRate }))
    })

    ws.on('message', (data) => {
      lastFrameAt = Date.now()
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data)
      const parsed = parseServerFrame(buf)
      if (parsed.payload !== null) {
        const json = jsonPayload(parsed)
        if (json !== null && typeof json.error === 'string') {
          finish(new Error(`火山语音：${json.error}`))
          return
        }
        if (onEvent !== undefined) onEvent(parsed, json)
      }
      if (parsed.event === EVT_AUDIO && parsed.payload !== null) {
        audioFrames += 1
        audioBytes += parsed.payload.length
        onAudio(parsed.payload)
      } else if (parsed.event === EVT_SESSION_FINISHED) {
        sessionFinished = true
        // 文档要求：收尾帧之后客户端发 FinishConnection 再关连接
        try { ws.send(buildFinishFrame()) } catch { /* 已经关了就算了 */ }
        // 服务端可能马上关连接（close 也会触发），也可能等我们发完再关：
        // 两条路都按成功结算
        setTimeout(() => finish(null), 150)
      }
    })

    ws.on('error', (err) => {
      finish(new Error(`火山流式连接错误：${err.message}`))
    })

    ws.on('close', (code, reason) => {
      if (!settled) {
        if (sessionFinished) {
          finish(null)
        } else {
          finish(new Error(`火山流式连接提前关闭 code=${code} reason=${reason.toString()}`))
        }
      }
    })
  })
}
