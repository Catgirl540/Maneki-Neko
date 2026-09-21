/**
 * 流式语音的播放器：把一帧一帧进来的裸 PCM 拼起来**边收边播**。
 *
 * ## 为什么不用 `<audio>` + MediaSource
 *
 * 流式 TTS 给的是**裸 PCM**（火山单向流式，见 `bridge/volc-stream.mjs`）。
 * MediaSource 对裸 PCM 的支持在浏览器里很差（要 `audio/pcm;codecs=…` 且各浏览器
 * 实现不一），而 Web Audio 天生就是干这个的：`AudioBufferSourceNode` 可以直接
 * 拿采样数据，还会按缓冲区的采样率自动重采样到上下文采样率。
 *
 * ## 播放模型：尾巴排片（tail scheduling）
 *
 * 每个新到的帧立刻排一个 `AudioBufferSourceNode`，起点是**上一段结束的时刻**
 * （`nextStart`），这样帧与帧无缝衔接；音频来得比播放慢（网络卡了）就把下一段
 * 从"现在"起排（接受一个小停顿）。`seek` 只能跳到**已经收到**的采样范围内——
 * 没收到的地方还没有数据，这不是实现偷懒，是流式播放的物理限制。
 *
 * ## 波形不是这里算的
 *
 * 这个播放器只负责出声和报位置。波形由调用方在**整段合成完毕**后从
 * {@link StreamPlayer.samples} 一次性算（见 `useVoice` 与 `lib/waveform.ts`）——
 * 边收边解波形没必要，还会把"播放"和"解码"耦合在一起。
 *
 * ## 给门禁的诊断口
 *
 * 和 `window.__audios` / `window.__voiceLogs` 同一个惯例：把播放状态暴露到
 * `window.__voicePlay`，浏览器门禁拿它断言"真的在播 / 只在一路在播 / 位置在走"。
 *
 * @module app/lib/streamPlayer
 */

import { pcm16ToFloat32 } from '@/lib/pcm'

/** 采样率不知道的时候先按这个（与桥接默认一致）。 */
const DEFAULT_SAMPLE_RATE = 24000

/** 进度回调的节流：约 5Hz，跟旧 `<audio>` 的 `timeupdate`（4Hz）一个量级。 */
const TICK_MS = 200

/** 排片时给下一段的提前量（秒），避免帧与帧之间咔哒一声。 */
const SCHEDULE_AHEAD = 0.02

/** 自动播放被挡时 `resume()` 最多等多久（毫秒）。 */
const RESUME_TIMEOUT_MS = 1500

export type StreamPlayerState = 'idle' | 'playing' | 'paused' | 'ended'

export interface StreamPlayer {
  /** 设定采样率（来自 SSE `start` 事件；起播前调用）。 */
  setSampleRate(rate: number): void
  /** 追加一帧裸 PCM16 LE；播放中会立刻排片。 */
  append(pcm: ArrayBuffer): void
  /** 追加一段已解码的采样（缓存命中的快路径，不用再走 PCM 解码）。 */
  appendFloat(samples: Float32Array): void
  /**
   * 告诉播放器：**不会再有音频了**（流结束 / 缓存整段已给完）。
   *
   * 这是"播完了"的判据里**必须**的一半：不调它的话，第一帧播完就会被当成
   * "整段念完了"——后面的帧还在路上，声音却已经收摊（实测被门禁抓住，
   * 真机上就是"只念出第一小段"）。
   */
  markComplete(): void
  /** 采样率。 */
  sampleRate(): number
  /** 开始/恢复播放。返回 false = 浏览器挡了自动播放。 */
  play(): Promise<boolean>
  /** 暂停（位置冻结，可再 play 续播）。 */
  pause(): void
  /** 停止并清空已收采样（一次朗读结束/被打断后调用）。 */
  stop(): void
  /** 跳到已缓冲范围内的某个秒数（越界夹到边界）。 */
  seek(seconds: number): void
  /** 已缓冲时长（秒）。 */
  duration(): number
  /** 当前播放位置（秒）。 */
  position(): number
  /** 播放器状态。 */
  state(): StreamPlayerState
  /** 已累计的采样（只读拷贝；波形在这里算）。 */
  samples(): Float32Array
  /** 进度/状态变化回调（约 5Hz，播放期间）。 */
  onUpdate?: () => void
  /** 播到已缓冲末尾（且没有更多数据）时回调。 */
  onEnded?: () => void
  /** 释放资源。 */
  destroy(): void
}

interface ScheduledNode {
  node: AudioBufferSourceNode
  gen: number
}

/**
 * 建一个流式播放器。
 *
 * 一个 `useVoice` 实例对应一个播放器（模块内多次 `speak` 共用，每次 `stop()` 清场）。
 * AudioContext **懒创建**：不点朗读就不占音频资源。
 */
export function createStreamPlayer(): StreamPlayer {
  let context: AudioContext | null = null
  let sourceRate = DEFAULT_SAMPLE_RATE
  /** 已累计的全部采样（单声道 -1~1）。 */
  let samples = new Float32Array(0)
  /** 当前这一段已排片的采样数（seek/play 之后从这个数接着排）。 */
  let scheduledUpTo = 0
  /** 下一段音频应该从哪个上下文时刻开始。 */
  let nextStart = 0
  /** 这一段起点对应的"位置秒数"与上下文时刻。 */
  let playedBase = 0
  let timelineStart = 0
  let playing = false
  let gen = 0
  let state: StreamPlayerState = 'idle'
  /** 音频是不是已经**全部**到齐（`markComplete` 置位）。见接口上的说明。 */
  let complete = false
  let live = new Set<ScheduledNode>()
  let tick: ReturnType<typeof setInterval> | undefined
  let destroyed = false

  /** 诊断口：门禁从页面外读播放状态。 */
  const debug: Record<string, unknown> = {
    state: 'idle', position: 0, duration: 0, generation: 0, samples: 0, sampleRate: sourceRate, playing: false,
  }
  ;(window as unknown as { __voicePlay?: Record<string, unknown> }).__voicePlay = debug

  const updateDebug = () => {
    debug['state'] = state
    debug['position'] = Number(position().toFixed(3))
    debug['duration'] = Number(duration().toFixed(3))
    debug['generation'] = gen
    debug['samples'] = samples.length
    debug['sampleRate'] = sourceRate
    debug['playing'] = playing
  }

  const duration = () => samples.length / sourceRate

  const position = () => {
    if (!playing || context === null) return playedBase
    return playedBase + (context.currentTime - timelineStart)
  }

  /** 掐掉这一世代所有已排片的节点（seek/stop/pause 时用）。 */
  const stopNodes = () => {
    gen += 1
    for (const entry of live) {
      try { entry.node.stop() } catch { /* 已经停了的无所谓 */ }
    }
    live.clear()
  }

  const stopTick = () => {
    if (tick !== undefined) {
      clearInterval(tick)
      tick = undefined
    }
  }

  /** 从 `from` 采样开始排一段，起点是 `nextStart`（或"现在"，晚了就顺延）。 */
  const scheduleFrom = (from: number) => {
    if (context === null) return
    if (from >= samples.length) {
      /*
       * 没有可排的音频（比如 `End` 把位置跳到了已缓冲的末尾）。
       * **这里也要把 `scheduledUpTo` 顶到末尾**：它表达的是"到哪儿为止都排过了"，
       * 而"从末尾往后"当然是排完了。不顶的话"播完了"这个判据永远不成立，
       * 表现是按 End 之后播放器停在原地不动（实测被门禁抓住）。
       */
      scheduledUpTo = samples.length
      return
    }
    const length = samples.length - from
    const buffer = context.createBuffer(1, length, sourceRate)
    buffer.copyToChannel(samples.subarray(from), 0)
    const node = context.createBufferSource()
    node.buffer = buffer
    node.connect(context.destination)
    const myGen = gen
    const start = Math.max(nextStart, context.currentTime + SCHEDULE_AHEAD)
    const entry: ScheduledNode = { node, gen: myGen }
    live.add(entry)
    node.onended = () => {
      if (live.has(entry)) live.delete(entry)
    }
    try {
      node.start(start)
    } catch {
      live.delete(entry)
      return
    }
    nextStart = start + length / sourceRate
    scheduledUpTo = samples.length
  }

  return {
    setSampleRate(rate: number) {
      if (samples.length > 0) return // 已经收了音频就不该再改
      if (Number.isFinite(rate) && rate > 0) {
        sourceRate = rate
        debug['sampleRate'] = rate
      }
    },

    append(pcm: ArrayBuffer) {
      if (pcm.byteLength === 0) return
      // PCM16 LE → 浮点采样（纯函数，离线门禁在 tools/check-pcm.mjs）
      this.appendFloat(pcm16ToFloat32(pcm))
    },

    appendFloat(f32: Float32Array) {
      if (f32.length === 0) return
      const next = new Float32Array(samples.length + f32.length)
      next.set(samples)
      next.set(f32, samples.length)
      samples = next
      if (playing) scheduleFrom(scheduledUpTo)
      updateDebug()
      this.onUpdate?.()
    },

    markComplete() {
      complete = true
      // 已经在末尾了（例如只有一帧、且刚好播完）：让 tick 立刻收尾，不用等下一个 200ms
      if (playing) {
        updateDebug()
        this.onUpdate?.()
      }
    },

    sampleRate: () => sourceRate,

    async play() {
      if (destroyed || playing) return true
      if (context === null) {
        // 懒创建：只在真正要出声的时候才碰音频上下文
        context = new AudioContext()
        timelineStart = 0
        playedBase = 0
      }
      if (context.state === 'suspended') {
        let running = false
        try {
          running = await Promise.race([
            context.resume().then(() => context?.state === 'running'),
            new Promise<boolean>((resolvePromise) => {
              setTimeout(() => resolvePromise(false), RESUME_TIMEOUT_MS)
            }),
          ])
        } catch {
          running = false
        }
        if (!running) return false // 自动播放被挡；调用方按真失败上报
      }
      playing = true
      state = 'playing'
      timelineStart = context.currentTime
      // 从当前"位置"对应的采样起重新排整段（pause 过的话上次的节点已经掐了）
      nextStart = context.currentTime + SCHEDULE_AHEAD
      scheduledUpTo = 0
      scheduleFrom(Math.round(playedBase * sourceRate))
      stopTick()
      tick = setInterval(() => {
        updateDebug()
        this.onUpdate?.()
        // 播到已缓冲末尾：**而且不会再有音频了**（`markComplete`），才算念完
        if (playing && complete && samples.length > 0 && position() >= duration() - 0.06) {
          playing = false
          state = 'ended'
          stopTick()
          updateDebug()
          this.onUpdate?.()
          this.onEnded?.()
        }
      }, TICK_MS)
      updateDebug()
      this.onUpdate?.()
      return true
    },

    pause() {
      if (!playing) return
      playedBase = position()
      stopNodes()
      playing = false
      state = 'paused'
      stopTick()
      updateDebug()
      this.onUpdate?.()
    },

    stop() {
      stopNodes()
      playing = false
      state = 'idle'
      samples = new Float32Array(0)
      scheduledUpTo = 0
      nextStart = 0
      complete = false
      /*
       * **位置也要归零。** 不重置的话，下一次起播会从"上一段念到的末尾"开始排片
       * ——那里已经没有音频了，于是 tick 立刻判定"播完"、播放器一闪就收。
       * （实测被 6g 的拖动断言抓住：End 念完之后重新点朗读，起不来。）
       */
      playedBase = 0
      timelineStart = 0
      stopTick()
      updateDebug()
      this.onUpdate?.()
    },

    seek(seconds: number) {
      if (context === null || samples.length === 0) return
      const clamped = Math.min(duration(), Math.max(0, seconds))
      const from = Math.round(clamped * sourceRate)
      stopNodes()
      playedBase = clamped
      timelineStart = context.currentTime
      if (playing) {
        nextStart = context.currentTime + SCHEDULE_AHEAD
        scheduledUpTo = 0
        scheduleFrom(from)
      } else {
        scheduledUpTo = from
        nextStart = context.currentTime + SCHEDULE_AHEAD
      }
      updateDebug()
      this.onUpdate?.()
    },

    duration,
    position,
    state: () => state,

    samples() {
      return samples.slice()
    },

    destroy() {
      destroyed = true
      stopNodes()
      stopTick()
      if (context !== null) { void context.close() }
      context = null
    },
  }
}
