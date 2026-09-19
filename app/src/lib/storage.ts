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
  remove(key: string): void {
    try {
      window.localStorage.removeItem(PREFIX + key)
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
