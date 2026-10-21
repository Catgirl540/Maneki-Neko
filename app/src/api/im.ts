/**
 * 微信提醒（IM）通道：桥接服务 `/agent-api/im` 的客户侧接口。
 *
 * ## 为什么不复用 `api/http.ts` 里的 request
 *
 * 那份封装绑死银行 `/api` 与 `ApiError` 语义；这里要能分辨 503/404——页面据此
 * 显示「微信提醒尚未启用」而不是一条红色错误，也要能分辨 409（私聊已绑在别的账户上）。
 * 所以请求函数独立实现，但口径与它一致：同一个 Bearer 令牌（`lib/authToken`）、
 * 12 秒超时、401 时清会话并广播 `AUTH_EXPIRED_EVENT`。
 *
 * 服务端实现在 `framework/bridge/im-http.mjs`（不要在前端改动它的语义），
 * 提醒状态见 `docs/api/im-reminders.md`。
 *
 * @module app/api/im
 */

import { AUTH_EXPIRED_EVENT, forgetSession, getAuthToken } from '@/lib/authToken'

/**
 * 桥接服务地址。默认 `/agent-api/im`；部署在子路径（`VITE_AGENT_URL=/bank/agent-api`）
 * 时与助手通道共用同一个前缀，留空则回落到默认值。
 */
const AGENT_BASE = (import.meta.env.VITE_AGENT_URL ?? '/agent-api').trim().replace(/\/+$/, '')
const IM_BASE = `${AGENT_BASE === '' ? '/agent-api' : AGENT_BASE}/im`
export interface WeixinQr {
  attemptId: string
  status: string
  qrImage: string
  expiresAt: number
  verificationRequired?: boolean
  error?: { message: string }
  binding?: ImClaimResult
}
export const startWeixinQr = () => post<WeixinQr>('/weixin/qr', {})
export const getWeixinQr = (id: string) => request<WeixinQr>(`/weixin/qr/${encodeURIComponent(id)}`)
export const verifyWeixinQr = (id: string, code: string) => post<WeixinQr>(`/weixin/qr/${encodeURIComponent(id)}/verify`, { code })
export const cancelWeixinQr = (id: string) => post<WeixinQr>(`/weixin/qr/${encodeURIComponent(id)}/cancel`, {})
export const confirmWeixinQr = (id: string) => post<ImClaimResult>(`/weixin/qr/${encodeURIComponent(id)}/confirm`, { confirmed: true })
const REQUEST_TIMEOUT_MS = 12_000

/** 提醒的投递状态。语义见 `docs/api/im-reminders.md` 的「状态与恢复」。 */
export type ImReminderStatus =
  | 'scheduled'
  | 'sending'
  | 'sent'
  | 'cancelled'
  | 'suppressed'
  | 'expired'
  | 'failed'
  | 'unknown'

/** 已绑定到当前客户的 IM 私聊。 */
export interface ImBinding {
  id: string
  label: string
  sessionId?: string
  /** 服务端是否仍持有这条私聊的可用会话；否则需要回到 IM 取新绑定码。 */
  connected: boolean
}

/** 提醒可用的接收私聊（后端只列本人、且仅微信渠道）。 */
export interface ImReminderBinding {
  id: string
  label: string
}

export interface ImReminder {
  id: string
  title: string
  /** 带时区的 ISO 时间；页面统一按北京时间展示。 */
  dueAt: string
  status: ImReminderStatus
  /** 例如 `BOT_OFFLINE`、`BINDING_CHANGED`、`OVERDUE_24H`、`DELIVERY_UNCONFIRMED`。 */
  errorCode?: string
}

export interface ImReminderList {
  bindings: ImReminderBinding[]
  reminders: ImReminder[]
  /**
   * 列表只给了最近 100 条。
   * 后端目前返回的字段是 `historyMayBeTruncated`（`bank-reminders.mjs` 的 `list`），
   * 这里两个都收，页面按 `truncated ?? historyMayBeTruncated` 判断。
   */
  truncated?: boolean
  historyMayBeTruncated?: boolean
  limit?: number
}

/** 绑定码核对结果：只说明来源与有效期，不产生任何绑定。 */
export interface ImCodePreview {
  label: string
  /** 服务端给的是毫秒时间戳；`new Date()` 两种都认。 */
  expiresAt: number | string
}

/** 绑定成功的结果。 */
export interface ImClaimResult {
  id: string
  sessionId: string
  label: string
}

/** 带 HTTP 状态码的失败：页面要按 401/404/503 分别处理。 */
export class ImError extends Error {
  readonly status: number
  readonly code?: string

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'ImError'
    this.status = status
    this.code = code
  }
}

/** A database/network outage is not a disabled feature. */
export function isImFeatureUnavailable(error: ImError | null): boolean {
  return error !== null && (error.status === 404 || (error.status === 503
    && error.code !== 'SESSION_STORE_UNAVAILABLE' && /尚未启用|未启用/.test(error.message)))
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getAuthToken()
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(IM_BASE + path, {
      ...init,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
    })
    const text = await response.text()
    let payload: unknown = null
    if (text) {
      try { payload = JSON.parse(text) }
      catch {
        throw new ImError('微信提醒服务返回了无效响应，请检查桥接服务与 /agent-api 代理配置', response.status || 502)
      }
    }
    if (!response.ok) {
      const body = payload as { message?: string; error?: string; code?: string } | null
      // 这些路由全部需要登录态，401 一律按会话失效处理（与 `api/http.ts` 同口径）。
      if (response.status === 401 && token) {
        forgetSession()
        window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT))
      }
      throw new ImError(body?.message ?? body?.error ?? `请求失败（${response.status}）`, response.status, body?.code)
    }
    return payload as T
  } catch (error) {
    if (error instanceof ImError) throw error
    throw new ImError(
      controller.signal.aborted ? '微信提醒服务响应超时，请稍后重试' : '无法连接微信提醒服务，请确认桥接服务已启动',
      0,
    )
  } finally {
    window.clearTimeout(timer)
  }
}

const post = <T,>(path: string, body: unknown) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body) })

/** 本人已绑定的 IM 私聊。 */
export function listImBindings(): Promise<ImBinding[]> {
  return request('/bindings')
}

/** 解除绑定。服务端同时会让旧提醒停止投递，不把任务转给新归属。 */
export function revokeImBinding(id: string): Promise<{ ok: true }> {
  return request(`/bindings/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/** 核对绑定码来源；只读，不消费绑定码。 */
export function previewImCode(code: string): Promise<ImCodePreview> {
  return post('/preview', { code })
}

/** 把该私聊绑定到当前登录的银行账户；绑定码一次性消费。 */
export function claimImCode(code: string): Promise<ImClaimResult> {
  return post('/claim', { code })
}

/** 本人连接与最近 100 条提醒。服务未启用时是 503，路由不存在是 404。 */
export function listImReminders(): Promise<ImReminderList> {
  return request('/reminders')
}

/**
 * 创建提醒。
 * `confirmed` 只在这一处置位：页面必须先出核对卡，确认后才走到这里。
 * `dueAt` 必须带显式时区（页面按北京时间补 `+08:00`）。
 */
export function createImReminder(input: {
  title: string
  dueAt: string
  bindingId?: string
  requestId: string
}): Promise<ImReminder> {
  return post('/reminders', { ...input, confirmed: true })
}

/** 取消一条仍在等待的提醒；`requestId` 由页面生成，重复提交不会产生第二条取消。 */
export function cancelImReminder(id: string, requestId: string): Promise<ImReminder> {
  return request(`/reminders/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    body: JSON.stringify({ requestId, confirmed: true }),
  })
}
