/**
 * 流式 TTS 的本地夹具（给浏览器门禁用的假上游）。
 *
 * 为什么需要它：**流式的本质是"首帧先到、后面的慢慢来"**，而 Playwright 的
 * `route.fulfill` 是把整段响应一次交出去的——用它测不出"不等全文合成完就出声"
 * 这件事（这正是整个功能的意义所在）。所以这里起一个真的 HTTP 服务，
 * 一帧一帧、可延迟地写 SSE，门禁把它接到 `/agent-api/tts/stream` 上。
 *
 * 音频是**渐强正弦**：于是"波形右高左低"成了一个有确定答案的判据，
 * 随机画出来的波形过不了。
 *
 * @module tools/lib/ttsFixture
 */

import { createServer } from 'node:http'

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms) })

/**
 * 造一段渐强正弦的 PCM16 LE 帧。
 *
 * 振幅按**整段**的进度算（不是按帧），所以拼起来是一条单调渐强的包络——
 * 分帧不改变"波形应当右高左低"这个判据。
 * @param seconds - 总时长（秒）。
 * @param sampleRate - 采样率。
 * @param frameSeconds - 每帧多长（秒）。
 * @returns 每帧的 Buffer（PCM16 LE）。
 */
export function rampFrames(seconds = 4, sampleRate = 24000, frameSeconds = 0.1) {
  const total = Math.round(seconds * sampleRate)
  const per = Math.max(1, Math.round(frameSeconds * sampleRate))
  const frames = []
  for (let start = 0; start < total; start += per) {
    const count = Math.min(per, total - start)
    const buffer = Buffer.alloc(count * 2)
    for (let i = 0; i < count; i += 1) {
      const at = start + i
      const amp = 0.08 + 0.92 * (at / total)
      const value = Math.sin((2 * Math.PI * 220 * at) / sampleRate) * amp
      buffer.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(value * 32767))), i * 2)
    }
    frames.push(buffer)
  }
  return frames
}

/**
 * 起一个假的上游流式 TTS。
 *
 * URL 参数：
 *   · `seconds`    音频总时长（默认 4）
 *   · `delay`      每帧之间的延迟毫秒（默认 0；用来造"合成还在进行中"的窗口）
 *   · `mode=error` 直接回一个 error 事件（模拟上游失败）
 *   · `errorAfter=N` 发到第 N 帧之后回 error（模拟合成中断）
 * @returns `{ port, calls, close }`；`calls` 记下每次请求的文本与时刻。
 */
export function startTtsFixture() {
  /** 每次请求：文本、模式、收到的时刻、结束的时刻。 */
  const calls = []
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://fixture')
    const mode = url.searchParams.get('mode') ?? 'normal'
    const seconds = Number(url.searchParams.get('seconds') ?? 4)
    const delay = Number(url.searchParams.get('delay') ?? 0)
    const errorAfter = Number(url.searchParams.get('errorAfter') ?? -1)
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      let text = ''
      try { text = String(JSON.parse(body).text ?? '') } catch { /* 体坏了就空文本 */ }
      const call = { text, mode, startedAt: Date.now(), endedAt: null }
      calls.push(call)

      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        'access-control-allow-origin': '*',
        connection: 'keep-alive',
      })
      const write = (chunk) => { try { res.write(chunk) } catch { /* 对端断了 */ } }
      const end = () => { call.endedAt = Date.now(); try { res.end() } catch { /* 已关 */ } }
      const event = (name, data) => { write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`) }

      event('start', { format: 'pcm', sampleRate: 24000 })
      if (mode === 'error') {
        event('error', { message: '上游合成失败（门禁注入）' })
        end()
        return
      }
      const frames = rampFrames(seconds, 24000)
      void (async () => {
        for (const [index, frame] of frames.entries()) {
          if (errorAfter >= 0 && index === errorAfter) {
            event('error', { message: '上游合成中断（门禁注入）' })
            end()
            return
          }
          write(`event: audio\ndata: ${frame.toString('base64')}\n\n`)
          if (delay > 0) await sleep(delay)
        }
        event('end', {
          frames: frames.length,
          bytes: frames.reduce((sum, frame) => sum + frame.length, 0),
          truncated: false,
        })
        end()
      })()
    })
  })

  return new Promise((resolve, reject) => {
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: server.address().port,
        calls,
        close: () => new Promise((done) => {
          server.closeAllConnections()
          server.close(() => done())
        }),
      })
    })
  })
}
