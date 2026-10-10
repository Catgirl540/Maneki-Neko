import { createContext, useContext } from 'react'
import type { StaffUser } from '@/api'

export interface SessionValue {
  user: StaffUser | null
  login: (name: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

/** 单独放这里，让 session.tsx 只导出组件（React Fast Refresh 要求，照客户端惯例） */
export const SessionContext = createContext<SessionValue | null>(null)

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession 必须在 SessionProvider 内使用')
  return ctx
}
