/**
 * 语音模式：按住说话 → 转成文字 → 朗读回复。
 *
 * ## 三条刻意的取舍
 *
 * **1. 按住说话，不做"一直听着"。**
 * 常开的麦克风在银行页面上是不能接受的：浏览器会一直挂着录音标识，
 * 而且会把旁边人的谈话一起送去转录。所以只有手指（或空格键）按着的时候才录，
 * 松手立刻停止并释放麦克风轨道——`getUserMedia` 拿到的流不停掉的话，
 * 系统的"正在使用麦克风"提示会一直亮着。
 *
 * **2. 这不是"全双工实时对话"。**
 * 真正的实时要 WebSocket + 流式识别 + 流式合成。这里是一轮一轮的：说完一整句、
 * 松开、等转录、等回答、念出来。原因不只是工作量——转录端点是"约 60 秒处理时间"
 * 的整段接口，而且**银行场景下"想清楚再按"比"抢话"更合适**。
 *
 * **3. 说话不能算数。**
 * 语音只用来**发起**，绝不用来**确认**。敏感操作的确认卡片必须手点 + 手输支付密码：
 * 电视里的声音、放一段录音，都能骗过"用语音说同意"。这条界线写在这里，
 * 也写在 `design/P8-VOICE.md` 里。
 *
 * @module app/lib/useVoice
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { probeVoiceAvailable, transcribeAudio, synthesizeSpeechStream } from '@/api/agent'
import { pickRecorderMime } from '@/lib/audio'
import { peaksFromSamples, DEFAULT_BUCKETS } from '@/lib/waveform'
import { createStreamPlayer, type StreamPlayer } from '@/lib/streamPlayer'
import { createSpeechCache } from '@/lib/speechCache'
import { callerFrame, preview, voiceLog } from '@/lib/voiceLog'

/**
 * 朗读缓存：按文本复用整段采样（详见 `lib/speechCache.ts`）。
 *
 * 放在模块级而不是每次 `useVoice` 一个：同一个页面里可能同时挂着几个朗读入口
 * （自动朗读、消息上的播放按钮），缓存必须共享才拦得住重复合成。
 * 流式合成完成时把整段采样 + 波形放进来，同一句话重播直接出声、不再走网络。
 */
const speechCache = createSpeechCache()

/** 语音通道现在在干什么。 */
export type VoiceState =
  | 'idle'
  | 'asking'       // 正在要麦克风权限
  | 'recording'    // 正在录
  | 'transcribing' // 录完了，正在转文字
  | 'speaking'     // 正在念回复
  | 'thinking'     // 说完了，等 agent 回答

export interface Voice {
  /** 语音通道能不能用。 */
  available: boolean
  /** 不能用时给用户看的原因。 */
  unavailableReason?: string
  state: VoiceState
  /** 录音已经录了多久（秒）。 */
  seconds: number
  /** 最近一次失败的原因。 */
  error?: string
  /**
   * 跳到某个位置。
   *
   * `ratio` 是 0–1 的比例（进度条拖到哪儿就是哪儿），**不是秒**：
   * 调用方手上只有比例，而秒数要等音频元数据到了才知道。
   * @param ratio - 0 到 1；越界的会被夹住。
   */
  seek: (ratio: number) => void
  /**
   * 正在朗读的是哪一条内容（`speak` 传进来的 key）。
   *
   * 有它，消息上那个按钮才知道自己是"朗读"还是"停止"——
   * 靠"现在有没有在响"是不够的：同时只有一条在念，但页面上有十条消息。
   */
  speakingKey?: string
  /**
   * 正在朗读那一条的播放状态。没在念的时候是 `undefined`。
   *
   * `waveform` 是**真解码出来的**峰值包络（见 `lib/waveform.ts`）：
   * 解码还没完成时是空数组，界面据此先用普通进度条兜着。
   */
  playback?: {
    /** 已经播了多少秒。 */
    position: number
    /** 总时长（秒）；元数据还没到时是 0。 */
    duration: number
    /** 已经播了百分之多少（0–1）。时长未知时是 0。 */
    ratio: number
    /** 波形包络（0.06–1），每项对应一根柱子。 */
    waveform: number[]
  }
  /** 按下：开始录（会先打断正在念的回复）。 */
  start: () => void
  /** 松开：停止录音并转录。 */
  stop: () => void
  /** 打断朗读。 */
  stopSpeaking: () => void
  /** 念一段文字；`key` 用来让调用方认领"正在念的是我这一条"。 */
  speak: (text: string, key?: string) => void
  /** agent 开始回答时调用：把状态从"等回答"里放出来。 */
  thinking: () => void
}

/** 正在朗读那一条的播放状态（从 {@link Voice} 里取出来单独命名，方便别处引用）。 */
export type VoicePlayback = NonNullable<Voice['playback']>

/** 录音秒数的上限兜底（服务端也会告诉他自己的上限）。 */
const DEFAULT_MAX_SECONDS = 60

/**
 * 语音模式的全部状态与副作用。
 *
 * `micEnabled` 管的**只是麦克风那一半**（要不要出现"按住说话"、要不要留一条录音状态条）。
 * 朗读那一半是每条消息自己的动作，和"要不要开麦克风"无关——消息上就有播放按钮，
 * 不需要用户先打开一个模式才能听。两者唯一的耦合是：按下麦克风会打断正在念的回复
 * （用户按下来说话，就是"别念了，听我说"）。
 * @param micEnabled - 用户有没有打开语音输入。
 * @param onTranscript - 转录出文字之后交给谁（一般是发进对话）。
 * @param serverMaxSeconds - 服务端给的录音上限。
 * @returns 见 {@link Voice}。
 */
export function useVoice(
  micEnabled: boolean,
  onTranscript: (text: string) => void,
  serverMaxSeconds?: number,
): Voice {
  const maxSeconds = serverMaxSeconds ?? DEFAULT_MAX_SECONDS
  const [state, setState] = useState<VoiceState>('idle')
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState<string | undefined>(undefined)
  const [unavailableReason, setUnavailableReason] = useState<string | undefined>(undefined)
  const [speakingKey, setSpeakingKey] = useState<string | undefined>(undefined)
  const [playback, setPlayback] = useState<Voice['playback']>(undefined)

  const recorder = useRef<MediaRecorder | undefined>(undefined)
  const stream = useRef<MediaStream | undefined>(undefined)
  const chunks = useRef<Blob[]>([])
  const ticker = useRef<number | undefined>(undefined)
  const mounted = useRef(true)
  /**
   * 流式播放器（Web Audio）。整个 hook 生命周期只有一个，每次 `speak` 用 `stop()` 清场
   * （懒建：不点朗读就不碰音频上下文）。
   */
  const playerRef = useRef<StreamPlayer | null>(null)
  /** 正在飞的流式合成请求；停止/打断时用它掐断上游，别让没人听的合成白烧钱。 */
  const streamAbortRef = useRef<AbortController | undefined>(undefined)
  /**
   * 朗读的世代号。**这是"不重叠播放"的关键**：
   * `speak` 里有 `await`（合成要几秒），如果这期间又来了一次 `speak`，
   * 先来的那次会在 await 之后照样 `play()` 起来——两段声音就叠在一起了。
   * 每次 `speak` 领一个号，`await` 回来发现号变了就放弃；
   * `stopSpeaking` 也让号前进，从而作废所有在飞的请求。
   */
  const speakSeq = useRef(0)
  /** 这次录音已经作废（用户把语音输入关了）：`onstop` 里只收尾，不转录、不发送。 */
  const suppress = useRef(false)
  /** `onTranscript` 每次渲染都是新的，用 ref 拿最新那个，免得把它塞进依赖里。 */
  const transcriptRef = useRef(onTranscript)
  // ref 只能在渲染之外写：渲染期改 ref 会让 React Compiler 认为这次渲染是脏的。
  useEffect(() => {
    transcriptRef.current = onTranscript
  }, [onTranscript])

  const stopTicker = useCallback(() => {
    if (ticker.current !== undefined) {
      window.clearInterval(ticker.current)
      ticker.current = undefined
    }
  }, [])

  /** 彻底放开麦克风。**必须在录完之后调用**，否则系统的录音提示会一直亮着。 */
  const releaseMic = useCallback(() => {
    stream.current?.getTracks().forEach(track => { track.stop() })
    stream.current = undefined
    recorder.current = undefined
  }, [])

  /**
   * 停掉正在播的音频并掐掉在飞的流式请求。**不改状态**——"关闭语音模式"那个 effect
   * 可以只做副作用，不用在 effect 里 setState（会多一轮渲染，也会被 lint 拦）。
   *
   * 等价旧版的 `haltAudio`：旧版是掐 `<audio>` 元素，现在是停 Web Audio 播放器
   * （采样在播放器自己的缓冲里，掐播放器就掐了声音）+ abort 掉还在合成的请求。
   */
  const teardownPlayback = useCallback(() => {
    streamAbortRef.current?.abort()
    streamAbortRef.current = undefined
    playerRef.current?.stop()
    voiceLog('teardownPlayback：掐掉播放器与在飞请求', { 调用者: callerFrame(2) })
  }, [])

  const stopSpeaking = useCallback(() => {
    // 号一前进，所有还在 await 里的 speak 都会放弃，不会再冒出声音来
    speakSeq.current += 1
    voiceLog('stopSpeaking：世代号 →', speakSeq.current, '调用者', callerFrame(2))
    teardownPlayback()
    setSpeakingKey(undefined)
    setPlayback(undefined)
    setState(prev => (prev === 'speaking' ? 'idle' : prev))
  }, [teardownPlayback])

  /**
   * 懒建流式播放器并接上进度/播完回调（只接一次）。
   *
   * `onUpdate` 驱动进度条：位置/时长从播放器读（流式播放时时长随帧增长），
   * 波形保持原样（在整段合成完毕后由 `speak` 一次性放进来）。
   */
  const ensurePlayer = useCallback((): StreamPlayer => {
    if (playerRef.current !== null) return playerRef.current
    const player = createStreamPlayer()
    player.onUpdate = () => {
      if (!mounted.current) return
      const current = playerRef.current
      if (current === null) return
      const duration = current.duration()
      const position = current.position()
      setPlayback(prev => (prev === undefined ? prev : {
        position,
        duration,
        ratio: duration > 0 ? Math.min(1, position / duration) : 0,
        waveform: prev.waveform,
      }))
    }
    player.onEnded = () => {
      if (!mounted.current) return
      voiceLog('播放完毕（onEnded）')
      stopSpeaking()
    }
    playerRef.current = player
    return player
  }, [stopSpeaking])

  /**
   * 跳到某个位置。
   *
   * 只在**正在播**的时候有意义：没在念就什么都不做，
   * 而不是偷偷从缓存里找一段开始播——用户点的是"跳到这儿"，不是"开始念"。
   * 流式播放只能跳到**已经缓冲**的范围（没收到的地方没有数据），越界夹到边界。
   */
  const seek = useCallback((ratio: number) => {
    const player = playerRef.current
    if (player === null || player.state() === 'idle') {
      voiceLog('seek：没有正在播的音频，忽略')
      return
    }
    const duration = player.duration()
    if (duration <= 0) {
      // 还没收到任何音频，不知道能跳到哪儿。按说不该发生（我们起播才有播放器），
      // 但真的发生了就明确记一笔，别静默。
      voiceLog('seek：还不知道总时长，忽略')
      return
    }
    const clamped = Math.min(1, Math.max(0, ratio))
    player.seek(clamped * duration)
    // 播放器的 seek 会触发 onUpdate，界面立刻画到新位置（手感即时，不用等下一个 tick）
    voiceLog('seek：跳转', { ratio: Number(clamped.toFixed(3)), 目标秒: Number((clamped * duration).toFixed(2)), duration: Number(duration.toFixed(2)) })
  }, [])

  const speak = useCallback((text: string, key?: string) => {
    const spoken = text.trim()
    /*
     * 每次开念都先清掉上一次的错误。
     *
     * 不清的话会出现这种局面：用户点了朗读、失败了（例如浏览器挡了自动播放），
     * 报错留在界面上；他换个说法再点一次、这次成功了，那行红色错误还挂着，
     * 让人以为又失败了。实测踩到。
     */
    setError(undefined)
    if (spoken === '') {
      voiceLog('speak：文本是空的，忽略')
      return
    }
    // 先停掉上一段：否则两段会叠在一起念。
    voiceLog('speak：开始', { key, 文本: preview(spoken) })
    stopSpeaking()
    const mine = speakSeq.current
    const player = ensurePlayer()
    voiceLog('speak：我的世代号', mine)
    // 起手先画一条空进度（还没出声，但已经在"准备"）；波形等整段合成完才有
    setSpeakingKey(key)
    setState('speaking')
    setPlayback({ position: 0, duration: 0, ratio: 0, waveform: [] })

    const ac = new AbortController()
    void (async () => {
      try {
        // ① 缓存命中：整段采样直接播（波形也即时），不再走网络
        const cached = speechCache.get(spoken)
        if (cached !== undefined) {
          voiceLog('speak：缓存命中，直接播', { 缓存条数: speechCache.size(), 世代号: speakSeq.current, 我的: mine })
          if (!mounted.current || speakSeq.current !== mine) return
          player.setSampleRate(cached.sampleRate)
          player.appendFloat(cached.samples)
          // 缓存的是一整段：告诉播放器"不会再有音频了"，否则第一帧播完就收摊
          player.markComplete()
          setPlayback({
            position: 0,
            duration: player.duration(),
            ratio: 0,
            waveform: cached.waveform,
          })
          const ok = await player.play()
          if (!ok) throw new Error('浏览器阻止了自动播放，请点一下页面再试。')
          return
        }

        // ② 未命中：流式合成。首帧音频一到就开播，不等整段合成完
        voiceLog('speak：未命中，走流式合成', { 世代号: speakSeq.current, 我的: mine })
        streamAbortRef.current = ac
        let played = false
        let playBlocked = false
        let truncated = false
        await synthesizeSpeechStream(spoken, {
          onStart: (meta) => {
            if (!mounted.current || speakSeq.current !== mine) return
            player.setSampleRate(meta.sampleRate)
          },
          onAudio: (pcm) => {
            if (!mounted.current || speakSeq.current !== mine) return
            player.append(pcm)
            if (!played) {
              played = true
              // 首帧到达：立刻起播。被浏览器挡了（不是用户手势触发的自动播放）
              // 就记下来，等流结束后按真失败上报。
              void player.play().then((ok) => {
                if (!ok && mounted.current && speakSeq.current === mine) playBlocked = true
              })
            }
          },
          onSentence: () => {},
          onEnd: (meta) => {
            truncated = meta.truncated
            // 流结束：从现在起"播到末尾"才等于"整段念完了"
            player.markComplete()
          },
        }, ac.signal)

        if (!mounted.current || speakSeq.current !== mine) {
          voiceLog('speak：流结束后发现已被取代或已卸载', { mounted: mounted.current, 当前号: speakSeq.current, 我的: mine })
          return
        }
        streamAbortRef.current = undefined
        if (playBlocked) throw new Error('浏览器阻止了自动播放，请点一下页面再试。')
        const samples = player.samples()
        if (samples.length === 0) throw new Error('合成结果为空。')
        // 波形在**整段合成完毕后**一次性算（流式播放期间不算波形——用户定的）。
        // 不挡播放：这时候声音已经开播了，算完放进状态，界面从普通进度条切到波形。
        const waveform = peaksFromSamples(samples, DEFAULT_BUCKETS)
        setPlayback(prev => (prev === undefined ? prev : { ...prev, waveform }))
        speechCache.put(spoken, {
          samples,
          sampleRate: player.sampleRate(),
          truncated,
          waveform,
        })
      } catch (cause) {
        if (!mounted.current) return
        /*
         * 被取代了：新的那次 speak 拥有状态，这里什么都不该动。
         */
        if (speakSeq.current !== mine) {
          voiceLog('catch：已被取代，静默让位', { 当前号: speakSeq.current, 我的: mine })
          return
        }
        /*
         * 到这里说明**还是"我"这一次**：不管因为什么失败，都必须把状态收拾干净。
         * （等价旧版 catch 里的 haltAudio；少了这一步，按钮会永远停在「停止朗读」。）
         */
        /*
         * **先记下"是不是被取消"，再收拾。**
         *
         * `teardownPlayback` 会 abort 这个 controller，那之后再读 `ac.signal.aborted`
         * 就永远是 true——真失败会被误判成"用户取消"，界面上一句话都没有
         * （实测被门禁抓住：上游明明回了 error 事件，用户只看到没声音）。
         */
        const wasAborted = ac.signal.aborted
        teardownPlayback()
        /*
         * 取消（abort / AbortError）不是失败：用户没有任何可采取的动作，
         * 报出来只会让人以为坏了。收拾干净，静静收场。
         * 别的错误（例如上游报错、自动播放被挡）是**真失败**，必须说出来。
         */
        const aborted = wasAborted || (cause instanceof DOMException && cause.name === 'AbortError')
        if (aborted) {
          voiceLog('catch：取消，收拾干净但不报错')
          return
        }
        voiceLog('catch：真失败，报给用户', { cause: cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause) })
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    })()
  }, [ensurePlayer, stopSpeaking])


  const finishRecording = useCallback(() => {
    const active = recorder.current
    if (active === undefined) return
    stopTicker()
    setState('transcribing')
    active.stop()   // onstop 里做转录
  }, [stopTicker])

  const start = useCallback(() => {
    if (state === 'recording' || state === 'asking' || state === 'transcribing') return
    // 立刻打断正在念的回复：用户按下来说话，就是"别念了，听我说"。
    stopSpeaking()
    // 上一次"关掉语音输入"可能留下了作废标记而 `onstop` 从没触发（录音已经停了）。
    // 不在这里清掉的话，这一次的录音会被上一次的标记吃掉——表现是"按了没反应"。
    suppress.current = false
    setError(undefined)
    setSeconds(0)
    setState('asking')
    void (async () => {
      try {
        const media = await navigator.mediaDevices.getUserMedia({ audio: true })
        if (!mounted.current) {
          media.getTracks().forEach(track => { track.stop() })
          return
        }
        stream.current = media
        const mimeType = pickRecorderMime()
        const instance = mimeType === ''
          ? new MediaRecorder(media)
          : new MediaRecorder(media, { mimeType })
        recorder.current = instance
        chunks.current = []
        instance.ondataavailable = (event) => {
          if (event.data.size > 0) chunks.current.push(event.data)
        }
        instance.onstop = () => {
          const type = instance.mimeType === '' ? 'audio/webm' : instance.mimeType
          const blob = new Blob(chunks.current, { type })
          chunks.current = []
          releaseMic()
          if (!mounted.current) return
          // 关掉语音输入把它作废了：这次录音连转录都不要发出去。
          if (suppress.current) {
            suppress.current = false
            setState('idle')
            return
          }
          if (blob.size === 0) {
            setState('idle')
            setError('没有录到声音，请按住按钮说话。')
            return
          }
          void (async () => {
            try {
              const result = await transcribeAudio(blob)
              if (!mounted.current) return
              const text = result.text.trim()
              if (text === '') {
                setState('idle')
                setError('没听清，请再说一遍。')
                return
              }
              setState('thinking')
              transcriptRef.current(text)
            } catch (cause) {
              if (!mounted.current) return
              setState('idle')
              setError(cause instanceof Error ? cause.message : String(cause))
            }
          })()
        }
        // 带 timeslice（250ms 一块）而不是裸的 `start()`：
        // 裸 start() 只在 stop() 时吐一次数据，而那一次可能**是 0 字节**——
        // webm 的头还没写出来就停了。表现是"按得快一点就说没录到声音"，
        // 而且时快时慢、很难复现（实测：同一条浏览器检查一会儿过一会儿不过）。
        instance.start(250)
        setState('recording')
        ticker.current = window.setInterval(() => {
          setSeconds((prev) => {
            const next = prev + 1
            // 到上限自动停：上游转录有约 60 秒的处理上限，录太久的会整段失败，
            // 所以宁可在这里收住，也不要让用户白说两分钟。
            if (next >= maxSeconds) finishRecording()
            return next
          })
        }, 1000)
      } catch (cause) {
        if (!mounted.current) return
        releaseMic()
        setState('idle')
        const name = cause instanceof DOMException ? cause.name : ''
        setError(
          name === 'NotAllowedError'
            ? '麦克风权限被拒绝。要在地址栏的权限设置里允许之后才能用语音。'
            : `打不开麦克风：${cause instanceof Error ? cause.message : String(cause)}`,
        )
      }
    })()
  }, [finishRecording, maxSeconds, releaseMic, state, stopSpeaking])

  const stop = useCallback(() => {
    if (recorder.current === undefined) return
    if (recorder.current.state === 'inactive') return
    finishRecording()
  }, [finishRecording])

  const thinking = useCallback(() => {
    setState(prev => (prev === 'thinking' ? 'idle' : prev))
  }, [])

  /**
   * 关掉语音输入时，把手头**录音**这一半停干净：麦克风、计时器、以及"这次录音不算数"。
   *
   * `suppress` 是必须的：`recorder.stop()` 会照常触发 `onstop`，而 `onstop` 里
   * 接着就是转录 + 把话发进对话。用户点的是"关掉语音输入"，不是"把这段发出去"。
   * 有了它，这一路的收尾就**不需要在 effect 里 setState**，也就不会多一轮渲染。
   *
   * 刻意**不**停朗读：朗读是每条消息自己的动作（消息上就有播放/停止按钮），
   * 关掉一个管麦克风的开关顺手把声音掐掉，会让"我只是不想说话"变成"我什么都听不到了"。
   */
  useEffect(() => {
    if (micEnabled) return
    suppress.current = true
    if (recorder.current !== undefined && recorder.current.state !== 'inactive') recorder.current.stop()
    stopTicker()
    releaseMic()
  }, [micEnabled, releaseMic, stopTicker])

  // 挂载时问一次服务端有没有语音能力；不支持的浏览器也在这里挡住。
  const [available, setAvailable] = useState(false)
  useEffect(() => {
    /*
     * 这一对日志是为了回答"谁在播放中途把音频掐了"。
     *
     * 用户那份日志里出现过一次 `stopSpeaking` 的调用者是 React 的 effect 清理，
     * 当时正在播（8.551 / 16.128 秒）。这个 effect 的依赖全是稳定值，
     * **正常不该重跑**——所以要么组件真的被卸载重挂了，要么有我没看出来的重跑。
     * 打上这两条，下一次日志就能直接分辨。
     */
    voiceLog('useVoice：effect 开始（挂载或重跑）')
    mounted.current = true
    void (async () => {
      if (typeof navigator === 'undefined' || navigator.mediaDevices === undefined) {
        setUnavailableReason(window.isSecureContext ? '当前浏览器不支持录音。' : '当前连接不支持录音，请使用 HTTPS 地址。')
        return
      }
      if (typeof MediaRecorder === 'undefined') {
        setUnavailableReason('当前浏览器不支持录音。')
        return
      }
      const capability = await probeVoiceAvailable()
      if (!mounted.current) return
      if (capability === null) {
        setUnavailableReason('当前没有语音能力。')
        return
      }
      setAvailable(true)
    })()
    return () => {
      voiceLog('useVoice：effect 清理（卸载或重跑）—— 会掐掉正在播的音频', { 调用者: callerFrame(2) })
      mounted.current = false
      stopSpeaking()
      playerRef.current?.destroy()
      playerRef.current = null
      if (recorder.current !== undefined && recorder.current.state !== 'inactive') recorder.current.stop()
      stopTicker()
      releaseMic()
    }
  }, [releaseMic, stopSpeaking, stopTicker])

  return {
    available,
    seek,
    ...unavailableReason === undefined ? {} : { unavailableReason },
    // `state` 不再按"模式开没开"压成 idle：朗读可以在模式关着的时候进行
    // （消息上就有播放按钮），压成 idle 的话那个按钮永远显示"朗读"、变不成"停止"。
    // 录音那一半由上面的 suppress 收干净——关掉模式之后不会留下 recording 这种状态。
    state,
    seconds,
    ...error === undefined ? {} : { error },
    ...speakingKey === undefined ? {} : { speakingKey },
    ...playback === undefined ? {} : { playback },
    start,
    stop,
    stopSpeaking,
    speak,
    thinking,
  }
}
