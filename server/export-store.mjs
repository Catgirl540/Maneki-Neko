/**
 * 一次性导出文件的短时存放。
 *
 * 为什么放在内存里：导出内容只在**已登录请求**里生成，链接只用于把文件交给
 * 同一位客户下载，几十秒内就该失效。放内存可以避免把对账单再落一份盘、
 * 也不需要为此新增表结构或迁移。
 *
 * 已知限制（写在这里，别当成已支持）：
 * - 单进程有效：服务重启或换实例后链接立即失效，需要重新生成；
 * - 只在本机部署成立。多实例部署必须换成共享存储 + 签名校验，
 *   否则某个实例收到的链接会在另一个实例上 404。
 */
import { randomBytes } from 'node:crypto'

export const EXPORT_TTL_SECONDS = 300
const MAX_FILES = 200
const MAX_BYTES = 8 * 1024 * 1024

export function createExportStore({ ttlMs = EXPORT_TTL_SECONDS * 1000, now = Date.now } = {}) {
  const files = new Map()
  const prune = () => {
    const stamp = now()
    for (const [token, file] of files) if (file.expiresAt <= stamp) files.delete(token)
  }
  return {
    /** 存入一份文件，返回一次性 token 与过期时间。 */
    put({ ownerId, fileName, csv }) {
      if (typeof ownerId !== 'string' || !ownerId) throw new Error('export file requires an owner')
      if (Buffer.byteLength(csv) > MAX_BYTES) throw Object.assign(new Error('导出文件过大，请缩小查询范围'), { status: 413, code: 'EXPORT_TOO_LARGE' })
      prune()
      while (files.size >= MAX_FILES) files.delete(files.keys().next().value)
      const token = randomBytes(24).toString('base64url')
      const expiresAt = now() + ttlMs
      files.set(token, { ownerId, fileName, csv, expiresAt })
      return { token, expiresAt }
    },
    /**
     * 取走文件：**一次性**。取不到（过期、已用过、伪造）一律返回 null，
     * 不区分原因，避免用错误信息探测有效的 token。
     */
    take(token) {
      prune()
      if (typeof token !== 'string') return null
      const file = files.get(token)
      if (!file) return null
      files.delete(token)
      if (file.expiresAt <= now()) return null
      return file
    },
    size() { return files.size },
  }
}
