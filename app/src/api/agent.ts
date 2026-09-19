/**
 * agent 客户端：网页与本地 agent 演示服务之间的那一段。
 *
 * 它**刻意不进 `api/contract.ts`**：那份契约是给**银行后端**的，塞进 agent 这些东西
 * 会污染契约、也会让 `tools/check-contract.mjs` 的四方一致性检查失去意义。
 * agent 是一条独立的通道，后端就绪后由后端实现同样的形状（见
 * `design/backend-handoff/AGENT-RUNTIME-CONTRACT.md`）。
 *
 * 服务不在时（纯前端部署）所有调用都会失败，调用方据此回落到固定话术。
 *
 * @module app/api/agent
 */

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
  fields: ConsentFieldInfo[]
  verification?: VerificationMethod
  consequence?: string
  createdAt: number
  expiresAt: number
}

/** 服务端推送的事件。 */
export type AgentEvent =
  | { type: 'hello'; sessionId: string }
  | { type: 'status'; status: 'running' | 'idle' }
  | { type: 'assistant'; text: string }
  | { type: 'tool-call'; callId: string; name: string; arguments: unknown }
  | { type: 'tool-result'; callId: string; isError: boolean; text: string }
  | { type: 'consent'; challenge: ConsentChallenge }
  | { type: 'consent-resolved'; challengeId: string; decision: string }
  | { type: 'consent-asked'; callId: string; toolName: string }
  | { type: 'consent-decided'; outcome: string }
  | { type: 'error'; message: string }

/** 健康探测结果。 */
export interface AgentHealth {
  ok: boolean
  provider: string
  model: string
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

/** 带超时的 fetch：agent 服务是本机的，连不上要快点失败，不能让界面一直转圈。 */
async function request(path: string, init: RequestInit = {}, timeoutMs = 10_000): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('请求超时')), timeoutMs)
  try {
    return await fetch(`${AGENT_BASE}${path}`, { ...init, signal: controller.signal })
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
export async function probeAgent(): Promise<AgentHealth | null> {
  if (!agentEnabled) return null
  try {
    const health = await requestJson<AgentHealth>('/health', {}, 3_000)
    return health.ok === true ? health : null
  } catch {
    return null
  }
}

/**
 * 建一个会话。
 * @returns 会话 id。
 */
export async function createAgentSession(): Promise<string> {
  const result = await requestJson<{ sessionId: string }>('/sessions', { method: 'POST' })
  return result.sessionId
}

/**
 * 发一条消息。**返回即代表已入队**，不代表回答完成。
 * @param sessionId - 会话 id。
 * @param text - 用户输入。
 */
export async function sendAgentMessage(sessionId: string, text: string): Promise<void> {
  await requestJson(`/sessions/${encodeURIComponent(sessionId)}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  })
}

/**
 * 打开事件流（SSE）。返回一个关闭函数。
 * @param sessionId - 会话 id。
 * @param onEvent - 每条事件的回调。
 * @param onError - 连接断开时的回调（浏览器会自动重连，所以这里只是提示）。
 * @returns 关闭函数。
 */
export function openAgentStream(
  sessionId: string,
  onEvent: (event: AgentEvent) => void,
  onError?: (error: Event) => void,
): () => void {
  const source = new EventSource(`${AGENT_BASE}/sessions/${encodeURIComponent(sessionId)}/stream`)
  source.onmessage = (message) => {
    try {
      onEvent(JSON.parse(message.data) as AgentEvent)
    } catch {
      // 单条事件坏了不该把整条流干掉；忽略它，让后续事件继续。
    }
  }
  if (onError) source.onerror = onError
  return () => { source.close() }
}

/** 对一次待确认事项的答复结果。 */
export interface ConsentAnswerResult {
  ok: boolean
  /** 失败原因（例如支付密码不正确）。 */
  error?: string
}

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
export async function answerConsent(
  challengeId: string,
  decision: 'approve' | 'reject',
  paymentPassword?: string,
): Promise<ConsentAnswerResult> {
  try {
    await requestJson(`/consent/${encodeURIComponent(challengeId)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        decision,
        ...paymentPassword === undefined ? {} : { paymentPassword },
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
