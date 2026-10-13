/* ==========================================================================
   公共 HTTP 封装 —— 两人共用，不许各写 fetch（Phase 0 产物）
   统一：员工 token 注入、{message, code} 错误体解析、超时
   ========================================================================== */

import { ApiError, routes } from '../contract'

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? ''
const TIMEOUT_MS = 15_000

/** 员工 token 只存内存（照客户端惯例，刷新即失效） */
let authToken: string | null = null

export function setStaffToken(token: string | null) {
  authToken = token
}

export function getStaffToken() {
  return authToken
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(BASE_URL + path, {
      ...init,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        ...(init.headers ?? {}),
      },
    })

    const text = await res.text()
    const payload = text ? (JSON.parse(text) as unknown) : null

    if (!res.ok) {
      const body = payload as { message?: string; code?: string } | null
      throw new ApiError(body?.message ?? `请求失败（${res.status}）`, res.status, body?.code)
    }
    return payload as T
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError('请求超时，请检查网络', 0, 'TIMEOUT')
    }
    // 后端没起 / 断网：给一句人话，前端据此渲染回落提示而不是白屏
    throw new ApiError('无法连接服务器，请确认后端已启动', 0, 'NETWORK')
  } finally {
    clearTimeout(timer)
  }
}

export const get = <T,>(path: string) => request<T>(path)
export const post = <T,>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })
export const patch = <T,>(path: string, body?: unknown) =>
  request<T>(path, { method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) })
export const put = <T,>(path: string, body?: unknown) =>
  request<T>(path, { method: 'PUT', body: body === undefined ? undefined : JSON.stringify(body) })

/** 健康检查（不走鉴权），给「后端没起」的回落提示用 */
export async function ping(): Promise<boolean> {
  try {
    await request<{ ok: boolean }>(routes.health())
    return true
  } catch {
    return false
  }
}
