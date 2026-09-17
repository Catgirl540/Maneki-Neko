import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { api } from '@/api'
import type { User } from '@/api/types'
import { STORAGE_KEYS, storage } from '@/lib/storage'
import { SessionContext, bootstrapSession, useSession } from './session-context'

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => bootstrapSession())
  const ready = true

  const login = useCallback(async (phone: string, password: string) => {
    const { token, user: nextUser } = await api.login(phone, password)
    storage.set(STORAGE_KEYS.token, token)
    storage.set('session.user', nextUser)
    setUser(nextUser)
  }, [])

  const logout = useCallback(async () => {
    await api.logout()
    storage.remove(STORAGE_KEYS.token)
    storage.remove('session.user')
    setUser(null)
  }, [])

  const updateUser = useCallback((patch: Partial<User>) => {
    setUser((prev) => {
      if (!prev) return prev
      const next = { ...prev, ...patch }
      storage.set('session.user', next)
      return next
    })
  }, [])

  const value = useMemo(
    () => ({ user, ready, login, logout, updateUser }),
    [user, ready, login, logout, updateUser],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

/** 路由守卫：未登录一律回到登录页，并记住来源路径 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, ready } = useSession()
  const location = useLocation()
  if (!ready) return null
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <>{children}</>
}