/** SSE 不可用时的短请求收件箱；卡密不进入可重放事件或持久化存储。 */
export function createEventPolling() {
  const secrets = new Map()
  const leases = new WeakMap()
  return {
    remember(entry, event) {
      if (event.type !== 'card-secret' || (leases.get(entry) ?? 0) <= Date.now()) return
      const ttl = Math.min(60_000, event.expiresAt - Date.now())
      if (!(ttl > 0)) return
      // 每个会话只保留最近一次授权的展示结果，领取或过期后立即清除。
      const previous = secrets.get(entry)
      if (previous) clearTimeout(previous.timer)
      const timer = setTimeout(() => secrets.delete(entry), ttl)
      timer.unref()
      secrets.set(entry, { event, timer })
    },
    read(entry, after, initialEvents) {
      if (after !== null && (!/^\d+$/.test(after) || !Number.isSafeInteger(Number(after)) || Number(after) > (entry.eventSeq ?? 0))) {
        throw Object.assign(new Error('事件游标无效'), { status: 400 })
      }
      leases.set(entry, Date.now() + 15_000)
      const events = after === null
        ? initialEvents
        : (entry.events ?? []).filter(item => Number(item.id) > Number(after)).map(item => item.event)
      const secret = secrets.get(entry)
      if (secret) {
        clearTimeout(secret.timer)
        secrets.delete(entry)
        if (secret.event.expiresAt > Date.now()) events.push(secret.event)
      }
      return { cursor: String(entry.eventSeq ?? 0), events }
    },
    close() {
      for (const secret of secrets.values()) clearTimeout(secret.timer)
      secrets.clear()
    },
  }
}
