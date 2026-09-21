import { createContext, useContext } from 'react'
import type { User } from '@/api/types'

export interface SessionValue {
  user: User | null
  ready: boolean
  /**
   * 登录。三步都对才能进：手机号格式、密码、短信验证码。
   * @param phone - 11 位手机号。
   * @param password - 登录密码。
   * @param smsCode - 短信验证码（先调 `api.sendSmsCode(phone)` 获取）。
   */
  login: (phone: string, password: string, smsCode: string) => Promise<void>
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

/*
 * 这里原来有一个 `bootstrapSession()`：从 localStorage 里读回令牌和用户信息，
 * 让刷新之后不用重新登录。**已经删掉**，因为那正是"登录态一直留着"的来源。
 * 现在登录态存在 sessionStorage 里（见 `lib/authToken.ts`）：刷新还在，关标签页才没。
 */
