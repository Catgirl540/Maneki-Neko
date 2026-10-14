import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { api } from '@/api'
import type { User } from '@/api/types'
import { AUTH_EXPIRED_EVENT, forgetSession, rememberSession, rememberUser, restoreSession } from '@/lib/authToken'
import { SessionContext, useSession } from './session-context'

/**
 * 登录态。
 *
 * ## 存在 sessionStorage 里：刷新还在，关掉浏览器才退出
 *
 * 用户信息与令牌都存在 sessionStorage（见 `lib/authToken.ts`），于是：
 *
 *   · 同一个标签页里**刷新** = 还在（不用重新登录）
 *   · **关掉标签页 / 浏览器** = 没了，下次要重新登录
 *   · **新开标签页** = 空的
 *
 * 银行业务数据由后端保存；助手对话可保存在本机，两者互不影响。
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  // 初值从 sessionStorage 恢复：同一个标签页刷新之后不该再登一次
  const [user, setUser] = useState<User | null>(() => restoreSession()?.user ?? null)
  const ready = true
  useEffect(() => {
    const expired = () => setUser(null)
    window.addEventListener(AUTH_EXPIRED_EVENT, expired)
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, expired)
  }, [])

  const login = useCallback(async (phone: string, password: string, smsCode: string) => {
    const { token, user: nextUser } = await api.login(phone, password, smsCode)
    rememberSession(token, nextUser)
    setUser(nextUser)
  }, [])

  const acceptSession = useCallback((token: string, nextUser: User) => {
    rememberSession(token, nextUser)
    setUser(nextUser)
  }, [])

  const logout = useCallback(async () => {
    try { await api.logout() }
    catch { /* 后端不可达时仍允许退出本机会话。 */ }
    finally { forgetSession(); setUser(null) }
  }, [])

  const updateUser = useCallback((patch: Partial<User>) => {
    setUser((prev) => {
      if (prev === null) return prev
      const next = { ...prev, ...patch }
      // 改了用户信息也要写回去，否则刷新之后又变回旧的
      rememberUser(next)
      return next
    })
  }, [])

  const value = useMemo(
    () => ({ user, ready, login, acceptSession, logout, updateUser }),
    [user, ready, login, acceptSession, logout, updateUser],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

/** 路由守卫：未登录一律回到登录页，并记住来源路径 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, ready } = useSession()
  const location = useLocation()
  if (!ready) return null
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search + location.hash }} />
  return <>{children}</>
}
