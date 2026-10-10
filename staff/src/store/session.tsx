import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { api, type StaffUser } from '@/api'
import { SessionContext, useSession } from './session-context'

/**
 * 员工会话。token 只在 api/http/base.ts 内存里，刷新即失效（照客户端惯例）。
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<StaffUser | null>(null)

  // 刷新后内存 token 没了，静默回登录页即可，不用报错
  useEffect(() => {
    api.me().then(setUser).catch(() => setUser(null))
  }, [])

  const login = useCallback(async (name: string, password: string) => {
    const result = await api.login(name, password)
    setUser(result.staff)
  }, [])

  const logout = useCallback(async () => {
    await api.logout().catch(() => {})
    setUser(null)
  }, [])

  const value = useMemo(() => ({ user, login, logout }), [user, login, logout])
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

/** 路由守卫：未登录送去登录页（用 Navigate，保留来源页） */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useSession()
  const location = useLocation()
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />
  return <>{children}</>
}
