/**
 * agent 客户端：网页与本地 agent 演示服务之间的那一段。
 *
 * 它**刻意不进 `api/contract.ts`**：那份契约是给**银行后端**的，塞进 agent 这些东西
 * 会污染契约、也会让 `tools/check-contract.mjs` 的四方一致性检查失去意义。
 * agent 是一条独立的通道，服务端实现见
 * `framework/bridge/demo-server.mjs`，HTTP 校验见 `tools/check-agent-http.mjs`。
 *
 * 服务不在时（纯前端部署）所有调用都会失败，调用方据此回落到固定话术。
 *
 * @module app/api/agent
 */

import { isMockMode } from '../lib/dataMode'
import { AUTH_EXPIRED_EVENT, forgetSession, getAuthToken } from '../lib/authToken'
import { blobToBase64 } from '../lib/audio'

/** agent 服务地址。留空 = 关闭 agent（回到纯前端固定话术）。 */
export const AGENT_BASE = (import.meta.env.VITE_AGENT_URL ?? '/agent-api').replace(/\/$/, '')

/** agent 通道是否被配置打开。 */
export const agentEnabled = AGENT_BASE !== '' && (import.meta.env.VITE_AGENT_ENABLED ?? 'true') !== 'false'

/** 一条「展示给用户看的信息」。 */
export interface ConsentFieldInfo {
  label: string
  value: string
  emphasis?: boolean
}

/** 需要哪种身份验证。 */
export type VerificationMethod = 'payment-password' | 'sms' | 'face'

/** 一次待用户确认的敏感操作。 */
export interface ConsentChallenge {
  challengeId: string
  sessionId: string
  callId: string
  toolName: string
  kind: string
  riskAcknowledgementText?: string
  fields: ConsentFieldInfo[]
  requiresCustomerVerification?: boolean
  verification?: VerificationMethod
  consequence?: string
  createdAt: number
  expiresAt: number
}

/** 一个可选项。 */
export interface QuestionOption {
  label: string
  /** 一句话说明代价或影响（可选）。 */
  description?: string
}

/** 一道题。 */
export interface QuestionItem {
  /** 调用方给的稳定 id，答复里原样回传。 */
  id: string
  question: string
  /** 短标题（可选）。 */
  header?: string
  /** 可选项；没有就是一道纯自由输入题。 */
  options?: QuestionOption[]
  /** 允许多选；缺省是单选。 */
  multiSelect?: boolean
}

/**
 * 服务端推过来的一次问询。
 *
 * 它和确认卡片**不是一回事**：确认是"这笔操作能不能执行"（要验身份），
 * 提问只是"模型缺一句信息"，答不答都不放行任何东西。
 */
export interface PendingQuestion {
  /** 问询 id；答复时必须带同一个。 */
  questionId: string
  sessionId: string
  questions: QuestionItem[]
  createdAt: number
  expiresAt: number
}

/** 一道题的答复。 */
export interface QuestionAnswerItem {
  id: string
  /** 选中的选项标签；纯自由输入时是空数组。 */
  selected: string[]
  /** 用户自己写的答案（「其他」）。 */
  custom?: string
}

/** 服务端推送的事件。 */
export type AgentEvent =
  | { type: 'hello'; sessionId: string }
  | { type: 'bank-updated' }
  | { type: 'stopped' }
  | { type: 'session-restored'; interrupted: boolean }
  | { type: 'card-secret'; cardId: string; field: string; value: string; expiresAt: number }
  | { type: 'status'; status: 'running' | 'idle' }
  | { type: 'assistant'; text: string; messageId?: string }
  | { type: 'assistant-update'; messageId: string; text: string }
  | { type: 'assistant-reset'; messageId: string }
  | { type: 'tool-call'; callId: string; name: string; arguments: unknown }
  | { type: 'tool-result'; callId: string; isError: boolean; text: string }
  | { type: 'consent'; challenge: ConsentChallenge }
  | { type: 'consent-resolved'; challengeId: string; decision: string }
  | { type: 'question'; question: PendingQuestion }
  | { type: 'question-resolved'; questionId: string; answered: boolean }
  | { type: 'consent-asked'; callId: string; toolName: string }
  | { type: 'consent-decided'; outcome: string }
  | { type: 'error'; message: string }

/**
 * 健康探测结果。
 *
 * **刻意没有 `model` / `provider` 这类字段。** 这个响应是浏览器直接调的，
 * 用户在开发者工具里看得见——界面上"不显示模型名"挡不住这一步，
 * 所以源头就不回。运维要知道跑的是哪个模型，看服务端启动日志。
 */
export interface AgentHealth {
  ok: boolean
  /** 只有连接同一银行账户服务的助手，才能在 HTTP 网页上提供账户工具。 */
  bankDataSource?: 'http' | 'demo'
  /** 服务端的语音能力；服务端没开就是 `{ asr: false, tts: false }`。 */
  voice?: VoiceCapability
}

/** agent 服务支持哪些语音能力。**只描述"有没有"，不描述"用的哪个模型"。** */
export interface VoiceCapability {
  asr: boolean
  tts: boolean
  /** 流式播放器需要此能力；没有配置时不开启语音模式。 */
  stream?: boolean
  /** 一次录音最长多少秒（上游转录有约 60 秒的处理上限）。 */
  maxSeconds?: number
}

/** 调用失败时抛出的错误；`status` 与 `code` 让调用方能分辨失败原因。 */
export class AgentError extends Error {
  readonly status: number
  readonly code?: string

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'AgentError'
    this.status = status
    this.code = code
  }
}

/** 一个旧会话在 agent 侧还剩下什么。 */
export interface AgentSessionState {
  /** 服务端还认得这个 id。 */
  known: boolean
  /** 已有运行时上下文；重启后会从日志恢复。 */
  started: boolean
  /** 正在回答。 */
  busy: boolean
}

export interface ConsentAnswerResult {
  ok: boolean
  /** 失败原因（例如支付密码不正确）。 */
  error?: string
}

export interface TranscriptionResult {
  text: string
  /** 音频时长（秒），服务端给了才有。 */
  seconds?: number
}

export interface SpeechResult {
  /**
   * 可以直接喂给 `<audio>` 的地址。
   * **用完必须 `URL.revokeObjectURL`**，否则这段音频会一直占着内存。
   */
  url: string
  /** 文本太长被截断了（按字数计费，长回复也念不完）。 */
  truncated: boolean
}

export interface SpeechStreamHandlers {
  /** 服务端宣告的音频格式（一直是 pcm + sampleRate；播放器先等它再起）。 */
  onStart?: (meta: { format: string; sampleRate: number }) => void
  /** 一帧裸 PCM（Int16 LE）。首帧到达播放器就能出声。 */
  onAudio?: (pcm: ArrayBuffer) => void
  /** 句起止（字幕素材；播放不依赖它）。 */
  onSentence?: (info: { type: 'start' | 'end'; text: string }) => void
  /** 整段合成完毕。 */
  onEnd?: (meta: { frames: number; bytes: number; truncated: boolean }) => void
}

/** 员工与客户使用独立实例，身份、事件流和语音请求不会串用通道。 */
export interface CustomerVerification { method: string; result: 'passed' }
export interface AgentClientOptions {
  baseUrl: string
  enabled?: boolean
  mockMode?: boolean
  getToken: () => string | null | undefined
  onUnauthorized?: () => void
}
export function createAgentClient(options: AgentClientOptions) {
  const AGENT_BASE = options.baseUrl.replace(/\/$/, '')
  const agentEnabled = AGENT_BASE !== '' && options.enabled !== false
  const isMockMode = options.mockMode === true
  const getAuthToken = options.getToken
  function authHeaders(headers?: HeadersInit): Headers {
    const result = new Headers(headers)
    const token = getAuthToken()
    if (!isMockMode && token) result.set('Authorization', `Bearer ${token}`)
    return result
  }
  function checkExpired(response: Response, code?: string): void {
    if (response.status === 401 && code === 'UNAUTHORIZED' && !isMockMode) {
      options.onUnauthorized?.()
    }
  }
  async function request(path: string, init: RequestInit = {}, timeoutMs = 10_000): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error('请求超时')), timeoutMs)
    try {
      return await fetch(`${AGENT_BASE}${path}`, { ...init, headers: authHeaders(init.headers), signal: controller.signal })
    } finally {
      clearTimeout(timer)
    }
  }

  /** 读 JSON 响应；非 2xx 时带上服务端给的错误信息。 */
  async function requestJson<T>(path: string, init: RequestInit = {}, timeoutMs?: number): Promise<T> {
    let response: Response
    try {
      response = await request(path, init, timeoutMs)
    } catch (error) {
      throw new AgentError(
        error instanceof Error ? error.message : String(error),
        0,
        'UNREACHABLE',
      )
    }
    const text = await response.text()
    let parsed: unknown
    try {
      parsed = text === '' ? {} : JSON.parse(text)
    } catch {
      throw new AgentError(`agent 服务返回了非 JSON 内容：${text.slice(0, 120)}`, response.status, 'MALFORMED')
    }
    if (!response.ok) {
      checkExpired(response, (parsed as { code?: string }).code)
      const message = (parsed as { error?: unknown }).error
      throw new AgentError(
        typeof message === 'string' ? message : `agent 服务返回 ${response.status}`,
        response.status,
      )
    }
    return parsed as T
  }

  /**
   * 探测 agent 服务是否可用。**永不抛异常**：不可用只是一种状态，不是错误。
   * @returns 健康信息；服务不在时返回 null。
   */
  async function probeAgent(): Promise<AgentHealth | null> {
    if (!agentEnabled) return null
    try {
      const health = await requestJson<AgentHealth>('/health', {}, 3_000)
      if (!isMockMode && health.bankDataSource !== 'http') return null
      return health.ok === true ? health : null
    } catch {
      return null
    }
  }

  /**
   * 建一个会话。
   * @returns 会话 id。
   */
  async function createAgentSession(history?: { role: 'user' | 'assistant'; text: string }[]): Promise<string> {
    const result = await requestJson<{ sessionId: string }>('/sessions', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(history?.length ? { history } : {}),
    })
    return result.sessionId
  }

  /** 中断当前会话，服务端空闲事件到达后才允许下一条消息。 */
  async function stopAgentTurn(sessionId: string): Promise<void> {
    await requestJson(`/sessions/${encodeURIComponent(sessionId)}/stop`, { method: 'POST' }, 12_000)
  }

  /** 一个旧会话在 agent 侧还剩下什么。 */


  /**
   * 问一个旧会话还在不在。**永不抛异常**：问不到只是一种状态。
   *
   * 新版会话可直接继续；未保存可信归属的旧记录需要迁入本机文字上下文。
   * @param sessionId - agent 侧会话 id。
   * @returns 会话状态；问不到时返回 null（**不等于**"不存在"，调用方不要据此报失忆）。
   */
  async function probeAgentSession(sessionId: string): Promise<AgentSessionState | null> {
    try {
      const state = await requestJson<AgentSessionState>(
        `/sessions/${encodeURIComponent(sessionId)}`,
        {},
        3_000,
      )
      return state
    } catch {
      return null
    }
  }

  /**
   * 发一条消息。**返回即代表已入队**，不代表回答完成。
   * @param sessionId - 会话 id。
   * @param text - 用户输入；只发图片时可以是空串。
   * @param image - 一起发的图片。传了它就必须给 `accountId`——服务端按账户
   *   隔离归档，缺了会 400。
   * @param accountId - 当前登录账户 id，服务端用它决定图片落到哪个上传目录。
   */
  async function sendAgentMessage(
    sessionId: string,
    text: string,
    image?: { data: string; mimeType: string },
    accountId?: string,
    serviceIds?: readonly string[],
  ): Promise<void> {
    const body: Record<string, unknown> = { text }
    if (serviceIds !== undefined) body['serviceIds'] = [...serviceIds]
    if (image !== undefined) {
      body['image'] = image
      body['accountId'] = accountId ?? ''
    }
    await requestJson(`/sessions/${encodeURIComponent(sessionId)}/messages`, {
      method: 'POST',
      headers: authHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify(body),
      // 带图的 base64 比一句话大得多，默认 10 秒在慢网络下不够。
    }, image === undefined ? 10_000 : 30_000)
  }

  /**
   * 优先 SSE；首帧被代理缓冲或连接断开时，改用有游标的短请求接收事件。
   * 两种接收方式共用同一会话，不重新提交消息或银行操作。
   */
  function openAgentStream(
    sessionId: string,
    onEvent: (event: AgentEvent) => void,
    onError?: (error: Event) => void,
  ): () => void {
    const controller = new AbortController()
    let lastId = ''
    let busy = false
    const receive = (event: AgentEvent) => {
      if (controller.signal.aborted) return
      if (event.type === 'status') busy = event.status === 'running'
      onEvent(event)
    }
    const pause = (ms: number): Promise<void> => new Promise(resolve => {
      if (controller.signal.aborted) { resolve(); return }
      const cancel = () => { window.clearTimeout(timer); resolve() }
      const timer = window.setTimeout(() => {
        controller.signal.removeEventListener('abort', cancel)
        resolve()
      }, ms)
      controller.signal.addEventListener('abort', cancel, { once: true })
    })
    const rejected = async (response: Response): Promise<boolean> => {
      if (response.ok) return false
      const detail = await response.json().catch(() => ({})) as { code?: string }
      checkExpired(response, detail.code)
      return [401, 403, 404].includes(response.status)
    }

    void (async () => {
      const attempt = new AbortController()
      const cancel = () => attempt.abort()
      controller.signal.addEventListener('abort', cancel, { once: true })
      // 首帧超时不直接判定发送失败：释放长连接后尝试有限长度的 JSON 响应。
      const handshake = window.setTimeout(cancel, 4_000)
      try {
        const response = await fetch(`${AGENT_BASE}/sessions/${encodeURIComponent(sessionId)}/stream`, {
          headers: authHeaders({ Accept: 'text/event-stream' }),
          signal: attempt.signal,
          cache: 'no-store',
        })
        if (await rejected(response)) { onError?.(new Event('error')); return }
        if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
          throw new Error('事件流不可用')
        }
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          for (;;) {
            const match = /\r?\n\r?\n/.exec(buffer)
            if (!match || match.index === undefined) break
            const block = buffer.slice(0, match.index)
            buffer = buffer.slice(match.index + match[0].length)
            const lines = block.split(/\r?\n/)
            const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n')
            if (!data) continue
            let event: AgentEvent
            try { event = JSON.parse(data) as AgentEvent } catch { continue }
            const id = lines.find(line => line.startsWith('id:'))?.slice(3).trim()
            if (id) lastId = id
            if (event.type === 'hello') {
              window.clearTimeout(handshake)
              // 老版本服务没有 hello 游标；从零续取，避免首条回答在切换时丢失。
              if (!lastId) lastId = '0'
            }
            receive(event)
          }
        }
      } catch {
        // 等待首帧、网络中断和不支持流式读取，都由下面的短请求通道继续接收。
      } finally {
        window.clearTimeout(handshake)
        controller.signal.removeEventListener('abort', cancel)
        attempt.abort()
      }

      while (!controller.signal.aborted) {
        const poll = new AbortController()
        const stop = () => poll.abort()
        controller.signal.addEventListener('abort', stop, { once: true })
        const timeout = window.setTimeout(stop, 7_000)
        try {
          const url = new URL(`${AGENT_BASE}/sessions/${encodeURIComponent(sessionId)}/events`, window.location.origin)
          if (lastId !== '') url.searchParams.set('after', lastId)
          const response = await fetch(url, {
            headers: authHeaders({ Accept: 'application/json' }), signal: poll.signal, cache: 'no-store',
          })
          if (await rejected(response)) { onError?.(new Event('error')); return }
          if (!response.ok) throw new Error('事件接收失败')
          const body = await response.json() as { cursor: string; events: AgentEvent[] }
          if (!/^\d+$/.test(body.cursor) || !Array.isArray(body.events)) throw new Error('事件响应无效')
          if (controller.signal.aborted) return
          lastId = body.cursor
          for (const event of body.events) receive(event)
        } catch {
          if (controller.signal.aborted) return
          onError?.(new Event('error'))
        } finally {
          window.clearTimeout(timeout)
          controller.signal.removeEventListener('abort', stop)
        }
        await pause(busy ? 750 : 2_500)
      }
    })()
    return () => { controller.abort() }
  }

  /** 对一次待确认事项的答复结果。 */


  /**
   * 答复一次待确认事项。
   *
   * 支付密码只发到 agent 服务（演示环境里它代替银行后端做校验），
   * **不会**进入 agent 进程，所以也不会出现在模型上下文或会话日志里。
   * @param challengeId - 挑战 id。
   * @param decision - 同意或取消。
   * @param paymentPassword - 同意且需要验证时的支付密码。
   * @returns 答复结果；密码错时不抛异常，而是返回 ok:false 让界面可以重试。
   */
  async function answerConsent(
    challengeId: string,
    decision: 'approve' | 'reject',
    paymentPassword?: string,
    riskAcknowledgement?: string,
    customerVerification?: CustomerVerification,
  ): Promise<ConsentAnswerResult> {
    try {
      await requestJson(`/consent/${encodeURIComponent(challengeId)}`, {
        method: 'POST',
        headers: authHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({
          decision,
          ...customerVerification === undefined ? {} : { customerVerification },
          ...paymentPassword === undefined ? {} : { paymentPassword },
          ...riskAcknowledgement === undefined ? {} : { riskAcknowledgement },
        }),
      }, 20_000)
      return { ok: true }
    } catch (error) {
      if (error instanceof AgentError && error.status === 404) {
        return { ok: false, error: '这次确认已过期，请重新发起操作。' }
      }
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  /**
   * 答复一次问询。
   *
   * 送出去的就是用户在卡片上做的那几下：选了哪些、有没有自己写字。
   * **不做"默认选项"**——没答满就是没答满，由后端与插件两侧一起拒绝，
   * 这样模型不会以为用户对没答的题做了选择。
   * @param questionId - 问询 id。
   * @param answers - 每道题的答复。
   * @returns 答复结果；失败不抛异常，返回 `ok:false` 让界面可以重试。
   */
  async function answerQuestion(
    questionId: string,
    answers: QuestionAnswerItem[],
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      await requestJson(`/questions/${encodeURIComponent(questionId)}/answer`, {
        method: 'POST',
        headers: authHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ answers }),
      }, 15_000)
      return { ok: true }
    } catch (error) {
      if (error instanceof AgentError && error.status === 404) {
        return { ok: false, error: '这个问题已经过期了，模型那边不会再等。' }
      }
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  /* ------------------------------------------------------------------ 语音 */

  /** 一次转录的结果。 */


  /**
   * 把一段录音转成文字。
   *
   * 音频只发到 agent 服务（演示环境里它代替银行后端转发给语音上游），
   * **不经过 agent 进程、不进会话日志**：会话里只会多出转录出来的那句话。
   * @param audio - 录音。
   * @returns 转录文本。
   */
  async function transcribeAudio(audio: Blob): Promise<TranscriptionResult> {
    const payload = {
      audio: await blobToBase64(audio),
      // 带上完整 MIME（含 codecs）：服务端按它挑解码格式，不认识会明确拒绝。
      mimeType: audio.type,
      language: 'zh',
    }
    const result = await requestJson<{ text?: string; seconds?: number | null }>('/asr', {
      method: 'POST',
      headers: authHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify(payload),
    }, 60_000)
    return {
      text: typeof result.text === 'string' ? result.text : '',
      ...result.seconds === null || result.seconds === undefined ? {} : { seconds: result.seconds },
    }
  }

  /** 一次合成的结果。 */


  /**
   * 把一段文字合成语音。
   * @param text - 要念的文字（调用方负责先把 Markdown 去掉）。
   * @returns 音频地址与是否被截断。
   */
  async function synthesizeSpeech(text: string): Promise<SpeechResult> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error('合成超时')), 60_000)
    let response: Response
    try {
      response = await fetch(`${AGENT_BASE}/tts`, {
        method: 'POST',
        headers: authHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ text }),
        signal: controller.signal,
      })
    } catch (error) {
      throw new AgentError(error instanceof Error ? error.message : String(error), 0, 'UNREACHABLE')
    } finally {
      clearTimeout(timer)
    }
    if (!response.ok) {
      const detail = await response.text()
      let message = `合成失败（${response.status}）`
      try {
        const parsed = JSON.parse(detail) as { error?: string }
        if (typeof parsed.error === 'string') message = parsed.error
      } catch {
        // 上游非 JSON 时就用状态码，别把 HTML 塞进界面。
      }
      throw new AgentError(message, response.status)
    }
    const blob = await response.blob()
    return {
      url: URL.createObjectURL(blob),
      truncated: response.headers.get('x-luckycat-truncated') === '1',
    }
  }

  /** 流式语音合成的事件回调。 */


  /** 一段 SSE 块里的 `event:` 与 `data:` 行。 */
  interface SseBlock {
    event: string
    data: string
  }

  /**
   * 流式合成：`POST /agent-api/tts/stream`，SSE 一帧一帧把裸 PCM 交给 `onAudio`。
   *
   * 返回在收到 `end` 事件时 resolve；上游报 `error` 事件或流提前断开 → reject。
   * 外部取消（停止/打断）传 `signal`：abort 会让 `reader.read()` 以 AbortError 拒绝，
   * 由调用方按 `signal.aborted` 分辨「取消（静默）」与「真失败（上报）」。
   */
  function synthesizeSpeechStream(
    text: string,
    handlers: SpeechStreamHandlers,
    signal?: AbortSignal,
  ): Promise<void> {
    return new Promise<void>((resolvePromise, rejectPromise) => {
      void (async () => {
        let response: Response
        try {
          response = await fetch(`${AGENT_BASE}/tts/stream`, {
            method: 'POST',
            headers: authHeaders({ 'content-type': 'application/json' }),
            body: JSON.stringify({ text }),
            signal,
          })
        } catch (error) {
          rejectPromise(error instanceof Error ? error : new Error(String(error)))
          return
        }
        if (!response.ok) {
          let message = `合成失败（${response.status}）`
          try {
            const parsed = await response.json() as { error?: string }
            if (typeof parsed.error === 'string') message = parsed.error
          } catch {
            // 非 JSON 就用状态码，别把 HTML 塞进界面。
          }
          rejectPromise(new AgentError(message, response.status))
          return
        }
        const body = response.body
        if (body === null) {
          rejectPromise(new AgentError('语音流没有响应体', 0, 'EMPTY'))
          return
        }

        const reader = body.getReader()
        const decoder = new TextDecoder('utf-8')
        let buffer = ''

        /** 消费一个 SSE 块；返回 'done'（end 事件）或 null（继续）。 */
        const consume = (block: string): 'done' | null => {
          if (block.trim() === '') return null
          const sse: SseBlock = { event: '', data: '' }
          for (const line of block.split('\n')) {
            if (line.startsWith('event:')) sse.event = line.slice(6).trim()
            else if (line.startsWith('data:')) sse.data += line.slice(5).trim()
          }
          const { event, data } = sse
          if (data === '') return null
          if (event === 'audio') {
            try {
              const raw = atob(data)
              const bytes = new Uint8Array(raw.length)
              for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i)
              handlers.onAudio?.(bytes.buffer)
            } catch {
              // 坏帧：忽略这一帧，不打断整条流
            }
            return null
          }
          if (event === 'start') {
            try { handlers.onStart?.(JSON.parse(data) as { format: string; sampleRate: number }) } catch { /* 坏元数据：忽略 */ }
            return null
          }
          if (event === 'sentence') {
            try { handlers.onSentence?.(JSON.parse(data) as { type: 'start' | 'end'; text: string }) } catch { /* 忽略 */ }
            return null
          }
          if (event === 'end') {
            try { handlers.onEnd?.(JSON.parse(data) as { frames: number; bytes: number; truncated: boolean }) } catch { /* 忽略 */ }
            return 'done'
          }
          if (event === 'error') {
            let message = '合成失败'
            try { message = (JSON.parse(data) as { message?: string }).message ?? message } catch { /* 用默认 */ }
            throw new AgentError(message, 502)
          }
          return null
        }

        try {
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            for (;;) {
              const match = buffer.match(/\r?\n\r?\n/)
              if (match === null || match.index === undefined) break
              const end = match.index + match[0].length
              const block = buffer.slice(0, match.index)
              buffer = buffer.slice(end)
              if (consume(block) === 'done') {
                resolvePromise()
                return
              }
            }
          }
          // 流自然结束但没收到 end 事件
          rejectPromise(new AgentError('语音流提前结束', 0, 'STREAM'))
        } catch (error) {
          rejectPromise(error instanceof Error ? error : new Error(String(error)))
        }
      })()
    })
  }

  /**
   * 问服务端有没有语音能力。**永不抛异常**：没有只是一种状态。
   * @returns 能力；服务端没开、或问不到时返回 null。
   */
  async function probeVoiceAvailable(): Promise<VoiceCapability | null> {
    if (!agentEnabled) return null
    try {
      const health = await requestJson<AgentHealth>('/health', {}, 3_000)
      const voice = health.voice
      if (voice === undefined || !voice.asr || !voice.tts || voice.stream === false) return null
      return voice
    } catch {
      return null
    }
  }

  return { agentEnabled, probeAgent, createAgentSession, stopAgentTurn, probeAgentSession, sendAgentMessage, openAgentStream, answerConsent, answerQuestion, transcribeAudio, synthesizeSpeech, synthesizeSpeechStream, probeVoiceAvailable }
}

export type AgentClient = ReturnType<typeof createAgentClient>
export const defaultAgentClient = createAgentClient({
  baseUrl: AGENT_BASE, enabled: agentEnabled, mockMode: isMockMode, getToken: getAuthToken,
  onUnauthorized: () => { forgetSession(); window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT)) },
})
export const { probeAgent, createAgentSession, stopAgentTurn, probeAgentSession, sendAgentMessage, openAgentStream, answerConsent, answerQuestion, transcribeAudio, synthesizeSpeech, synthesizeSpeechStream, probeVoiceAvailable } = defaultAgentClient
