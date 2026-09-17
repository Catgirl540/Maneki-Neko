/** 带命名空间的 localStorage 封装：读写失败（隐私模式 / 配额）时静默降级 */
const PREFIX = 'luckycat.'

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
    try {
      window.localStorage.setItem(PREFIX + key, JSON.stringify(value))
    } catch {
      /* 忽略 */
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

export const STORAGE_KEYS = {
  token: 'token',
  // 结构版本写在载荷内部（MockDb.schema），不再靠改 key 做版本管理 ——
  // 改 key 只能防住改 key 那一次，防不住同一个 key 下字段又变了
  mockDb: 'mock.db',
  supportHistory: 'support.history.v1',
  sidebarCollapsed: 'ui.sidebarCollapsed',
} as const