/** 带命名空间的 localStorage 封装：读写失败（隐私模式 / 配额）时静默降级 */
const PREFIX = 'luckycat.'

/**
 * 和 {@link storage.set} 一样，但**告诉调用方有没有写进去**。
 *
 * 会话存档需要这个返回值：配额满的时候要能丢掉最旧的一段再试，
 * 而不是无声无息地什么都存不下（用户下次打开发现历史全没了）。
 * @param key - 不含命名空间的键。
 * @param value - 会被 JSON 序列化的值。
 * @returns 是否写入成功。
 */
export function trySet(key: string, value: unknown): boolean {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export const storage = {
  get<T>(key: string, fallback: T): T {
    try {
      const raw = window.localStorage.getItem(PREFIX + key)
      return raw === null ? fallback : (JSON.parse(raw) as T)
    } catch {
      return fallback
    }
  },
  set(key: string, value: unknown): void {
    trySet(key, value)
  },
  /** 服务端适配器可把多份用户档案放进同一个 SQLite 事务。 */
  setMany(entries: [string, unknown][]): boolean {
    try {
      const raw = entries.map(([key, value]) => [PREFIX + key, JSON.stringify(value)] as [string, string])
      const target = window.localStorage as Storage & {
        setItemsAtomically?: (items: [string, string][]) => void
      }
      if (target.setItemsAtomically) target.setItemsAtomically(raw)
      else for (const [key, value] of raw) target.setItem(key, value)
      return true
    } catch {
      return false
    }
  },
  remove(key: string): void {
    try {
      window.localStorage.removeItem(PREFIX + key)
    } catch {
      /* 忽略 */
    }
  },
}

/**
 * 和 {@link storage} 同一套命名空间与降级策略，但存在 **sessionStorage** 里。
 *
 * 只给登录态用。两者的区别正是登录态需要的那条界线：
 *
 *   · `localStorage` —— 关掉浏览器还在（业务数据：账户、流水、聊天记录）
 *   · `sessionStorage` —— **关掉标签页就没了**，但同一个标签页里刷新还在
 *
 * 所以登录态放这里 = 「关掉浏览器退出登录」，而刷新不用重新登录。
 */
export const sessionStore = {
  get<T>(key: string, fallback: T): T {
    try {
      const raw = window.sessionStorage.getItem(PREFIX + key)
      return raw === null ? fallback : (JSON.parse(raw) as T)
    } catch {
      return fallback
    }
  },
  set(key: string, value: unknown): void {
    try {
      window.sessionStorage.setItem(PREFIX + key, JSON.stringify(value))
    } catch {
      /* 忽略：写不进去最多是这一次登录不持久，不该让登录本身失败 */
    }
  },
  remove(key: string): void {
    try {
      window.sessionStorage.removeItem(PREFIX + key)
    } catch {
      /* 忽略 */
    }
  },
}

export const STORAGE_KEYS = {
  token: 'token',
  // 结构版本写在载荷内部（MockDb.schema），不再靠改 key 做版本管理 ——
  // 改 key 只能防住改 key 那一次，防不住同一个 key 下字段又变了
  mockDb: 'mock.db',
  supportHistory: 'support.history.v1',
  sidebarCollapsed: 'ui.sidebarCollapsed',
  /** 客服页的历史对话抽屉是不是开着。 */
  agentHistoryOpen: 'ui.agentHistoryOpen',
  /** agent 的历史对话（只存在这台设备上）。 */
  agentSessions: 'agent.sessions.v1',
} as const
