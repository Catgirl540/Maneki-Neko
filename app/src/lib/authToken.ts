/**
 * 登录态的存放处：令牌与用户信息都放在 **sessionStorage** 里。
 *
 * ## 为什么是 sessionStorage
 *
 * 它正好给出想要的那条界线：
 *
 *   · **同一个标签页里刷新** —— 还在（不用重新登录）
 *   · **关掉标签页 / 关掉浏览器** —— 没了（下次打开要重新登录）
 *   · **新开一个标签页** —— 空的（sessionStorage 是按标签页隔离的）
 *
 * 换成 `localStorage` 就是"登录一次管一辈子"（原来那样，门一直开着）；
 * 换成纯内存就是"刷新都要重新登录"（太严）。sessionStorage 是这两者之间
 * 唯一说得通的位置，也正是"关掉浏览器退出登录"这句话的字面实现。
 *
 * ## 这不是安全边界，别误会
 *
 * 令牌由后端签发与校验，前端收到未授权响应后会清除会话。
 * `RequireAuth` 挡的是**迷路的用户**，不是攻击者：能在 devtools 里执行代码的人，
 * 一样能把这两个值塞进 sessionStorage。真正的边界在后端：
 * `server/index.mjs` 与 `framework/bridge/demo-server.mjs`，验证见 `tools/check-agent-http.mjs`。
 *
 * ## 业务数据**不在这里**
 *
 * HTTP 模式下账户、流水和银行卡均由服务端保存，助手对话走 `localStorage`（见 `lib/storage.ts` 的
 * `storage`）——"关掉浏览器"不该把用户的聊天记录也清掉。
 * 这条界线很容易搞混，所以两边各写一句。
 *
 * @module app/lib/authToken
 */

import { STORAGE_KEYS, sessionStore } from '@/lib/storage'
import type { User } from '@/api/types'

/** 用户信息在 sessionStorage 里的键（与令牌分开存，但同生共死）。 */
const USER_KEY = 'session.user'
export const AUTH_EXPIRED_EVENT = 'luckycat:auth-expired'

/**
 * 记住这次登录。
 * @param token - 登录接口返回的令牌。
 * @param user - 登录接口返回的用户信息。
 */
export function rememberSession(token: string, user: User): void {
  sessionStore.set(STORAGE_KEYS.token, token)
  sessionStore.set(USER_KEY, user)
}

/**
 * 读回这次登录（同一个标签页刷新之后用）。
 * @returns 令牌与用户；**两者缺一就算没登录**，返回 `null`。
 */
export function restoreSession(): { token: string; user: User } | null {
  const token = sessionStore.get<string | null>(STORAGE_KEYS.token, null)
  const user = sessionStore.get<User | null>(USER_KEY, null)
  // 两个都要有：只写进去一个的话状态是半截的，宁可当作没登录
  if (token === null || user === null) return null
  return { token, user }
}

/** 忘掉这次登录（退出登录、或令牌不可用时）。 */
export function forgetSession(): void {
  sessionStore.remove(STORAGE_KEYS.token)
  sessionStore.remove(USER_KEY)
}

/**
 * 只更新用户信息（改昵称、换手机号这类），令牌不动。
 * @param user - 新的用户信息。
 */
export function rememberUser(user: User): void {
  sessionStore.set(USER_KEY, user)
}

/**
 * 取当前令牌，给请求头用。
 * @returns 令牌；未登录时 `null`。
 */
export function getAuthToken(): string | null {
  return sessionStore.get<string | null>(STORAGE_KEYS.token, null)
}
