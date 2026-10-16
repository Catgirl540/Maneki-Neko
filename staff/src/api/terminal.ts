import { ApiError } from './contract'
import { getStaffToken, request } from './http/base'
import { STAFF_AUTH_EXPIRED_EVENT } from './agent'

export interface TerminalSession { id: string; host: string; user: string; shell: string; cwd: string }
export type TerminalFrame = { type: 'output'; data: string } | { type: 'exit'; code: number } | { type: 'gap' }
const route = '/staff-api/ops/terminal/sessions'
const base = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')
async function terminalRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getStaffToken()
  try { return await request<T>(path, init) }
  catch (error) { if (error instanceof ApiError && error.status === 401 && token && token === getStaffToken()) window.dispatchEvent(new Event(STAFF_AUTH_EXPIRED_EVENT)); throw error }
}
export const terminalApi = {
  create: (size: { cols: number; rows: number }) => terminalRequest<TerminalSession>(route, { method: 'POST', body: JSON.stringify(size) }),
  input: (id: string, data: string) => terminalRequest<void>(`${route}/${encodeURIComponent(id)}/input`, { method: 'POST', body: JSON.stringify({ data }) }),
  resize: (id: string, cols: number, rows: number) => terminalRequest<void>(`${route}/${encodeURIComponent(id)}/resize`, { method: 'POST', body: JSON.stringify({ cols, rows }) }),
  close: (id: string) => terminalRequest<void>(`${route}/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  async events(id: string, after: number, signal: AbortSignal, onFrame: (frame: TerminalFrame, cursor: number) => void) {
    const token = getStaffToken()
    if (!token) throw new ApiError('请重新登录', 401, 'UNAUTHORIZED')
    const response = await fetch(`${base}${route}/${encodeURIComponent(id)}/events?after=${after}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' }, signal, cache: 'no-store' })
    if (response.status === 401 && token === getStaffToken()) window.dispatchEvent(new Event(STAFF_AUTH_EXPIRED_EVENT))
    if (!response.ok) throw new ApiError('终端连接失败，请重新连接', response.status)
    if (!response.headers.get('content-type')?.includes('text/event-stream') || !response.body) throw new Error('终端服务返回了无效响应')
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        buffer += decoder.decode(chunk.value, { stream: true }).replace(/\r\n/g, '\n')
        if (buffer.length > 2_000_000) throw new Error('终端响应过大，请重新连接')
        let boundary: number
        while ((boundary = buffer.indexOf('\n\n')) !== -1) {
          const event = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)
          const lines = event.split('\n')
          const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
          if (!data) continue
          const cursor = Number(lines.find(line => line.startsWith('id:'))?.slice(3).trim())
          if (!Number.isSafeInteger(cursor) || cursor <= 0) throw new Error('终端事件编号无效')
          const frame = JSON.parse(data) as TerminalFrame
          if (frame.type === 'output' && typeof frame.data !== 'string') throw new Error('终端输出无效')
          if (!['output', 'exit', 'gap'].includes(frame.type)) throw new Error('终端事件无效')
          onFrame(frame, cursor)
        }
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
  },
}
