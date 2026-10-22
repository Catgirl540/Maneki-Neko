/**
 * 员工企微（WeCom）通道：桥接服务 `/agent-api/im` 的员工侧接口。
 *
 * 走 `/staff-agent-api` 前缀（见 vite/nginx 代理与 `api/agent.ts`），令牌是
 * 员工 token；与客户侧 `app/src/api/im.ts` 完全隔离——绑定、私聊与会话都
 * 记在工作台身份上。服务端实现见 `framework/bridge/im-http.mjs`（staff 模式）。
 *
 * @module staff/api/im
 */

import { ApiError } from './contract'
import { request } from './http/base'

const IM_BASE = '/staff-agent-api/im'

/** 已绑定到当前员工的 IM 私聊。 */
export interface ImBinding {
  id: string
  label: string
  sessionId?: string
  /** 服务端是否仍持有这条私聊的可用会话；否则需要重新绑定。 */
  connected: boolean
}

/** 绑定码核对结果：只说明来源与有效期，不产生任何绑定。 */
export interface ImCodePreview {
  label: string
  expiresAt: number | string
}

/** 绑定成功的结果。 */
export interface ImClaimResult {
  id: string
  sessionId: string
  label: string
}

/** 员工 IM 未启用/不可用时页面的回落提示。 */
export function isImUnavailable(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 503)
}

/** 本人已绑定的 IM 私聊。 */
export function listImBindings(): Promise<ImBinding[]> {
  return request<ImBinding[]>(`${IM_BASE}/bindings`)
}

/** 解除绑定。 */
export function revokeImBinding(id: string): Promise<{ ok: true }> {
  return request(`${IM_BASE}/bindings/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/** 核对绑定码来源；只读，不消费绑定码。 */
export function previewImCode(code: string): Promise<ImCodePreview> {
  return request(`${IM_BASE}/preview`, { method: 'POST', body: JSON.stringify({ code }) })
}

/** 把该私聊绑定到当前登录员工；绑定码一次性消费。 */
export function claimImCode(code: string): Promise<ImClaimResult> {
  return request(`${IM_BASE}/claim`, { method: 'POST', body: JSON.stringify({ code }) })
}
