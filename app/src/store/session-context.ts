import { createContext, useContext } from 'react'
import type { User } from '@/api/types'
import { STORAGE_KEYS, storage } from '@/lib/storage'

export interface SessionValue {
  user: User | null
  ready: boolean
  login: (phone: string, password: string) => Promise<void>
  logout: () => Promise<void>
  updateUser: (patch: Partial<User>) => void
}

/** 单独放这里，让 session.tsx 只导出组件（React Fast Refresh 要求） */
export const SessionContext = createContext<SessionValue | null>(null)

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession 必须在 SessionProvider 内使用')
  return ctx
}

/** 演示环境：先读缓存的用户信息，避免刷新后闪回登录页 */
export function bootstrapSession(): User | null {
  const token = storage.get<string | null>(STORAGE_KEYS.token, null)
  return token ? storage.get<User | null>('session.user', null) : null
}