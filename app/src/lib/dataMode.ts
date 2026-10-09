/** HTTP 是默认数据源；浏览器 mock 仅通过显式开发配置开启。 */
export const isMockMode = import.meta.env.VITE_USE_MOCK === 'true'

/** 仅移除旧版前端模拟数据，不清理服务器记录或真实的助手对话。 */
export function clearLegacyMockData(): void {
  if (isMockMode) return
  try {
    for (const key of [
      'luckycat.mock.db',
      'luckycat.mock.db.v1',
      'luckycat.mock.db.v2',
      'luckycat.luckycat.mock.user-profiles.v1',
      'luckycat.support.history.v1',
    ]) window.localStorage.removeItem(key)
    const saved = window.sessionStorage.getItem('luckycat.token')
    const token: unknown = saved ? JSON.parse(saved) : null
    if (typeof token === 'string' && token.startsWith('mock.')) {
      window.sessionStorage.removeItem('luckycat.token')
      window.sessionStorage.removeItem('luckycat.session.user')
    }
  } catch { /* 存储不可用时继续使用 HTTP，不回退模拟数据。 */ }
}
