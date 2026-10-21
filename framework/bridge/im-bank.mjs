/** dsh-im Harness contract backed by the existing, authenticated bank Bridge. */
import { randomBytes, randomUUID } from 'node:crypto'
const fail = (message, status = 400) => Object.assign(new Error(message), { status })
const label = route => `${route.channel === 'weixin' ? '微信' : '企业微信'}私聊 · ${route.key.slice(-4)}`

export function createImBank({ store, publicUrl, createSession, current, run, cancel, deliver, onBindingChange = () => {}, clock = Date.now, timeoutMs = 600_000 }) {
  const base = new URL(publicUrl)
  if (base.username || base.password || base.search || base.hash || !['https:', 'http:'].includes(base.protocol)
      || (base.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))) throw Error('LUCKYCAT_IM_PUBLIC_URL must use HTTPS (HTTP is only allowed on loopback)')
  const portal = new URL('agent-api/im', base.origin).href
  const pairings = new Map(), active = new Map(), live = new Set(), claiming = new Set()
  let closed = false
  function pairing(route) {
    for (const [code, item] of pairings) if (item.expiresAt <= clock()) pairings.delete(code)
    for (const [code, item] of pairings) if (item.routeId === route.id) return code
    if (pairings.size >= 1000) throw fail('绑定请求过多，请稍后重试', 429)
    const code = randomBytes(24).toString('base64url')
    pairings.set(code, { routeId: route.id, expiresAt: clock() + 600_000 })
    return code
  }
  const loginMessage = route => `请先在银行页面登录并绑定${label(route)}，再发送您的需求：\n${portal}#code=${pairing(route)}\n绑定码十分钟有效；登录密码和支付密码只在银行页面填写。`
  const actionMessage = route => `有一项操作需要您在银行页面核对或补充信息：\n${portal}#session=${encodeURIComponent(route.sessionId)}\n请在页面中完成确认，我会继续办理并在这里回复结果。`
  function isLiveRoute(route) {
    const latest = store.snapshot().routes[route.id]
    return !closed && live.has(route.id) && latest?.sessionId === route.sessionId && latest?.ownerId === route.ownerId
  }
  function ownedRoute(id, channel, botId, key) {
    const route = store.snapshot().routes[id]
    if (!route || route.channel !== channel || route.botId !== botId || (key !== undefined && route.key !== key)) throw fail('IM 会话不存在', 404)
    return route
  }
  async function send(route, text) {
    if (!isLiveRoute(route)) return
    try { await current(route.sessionId) } catch { live.delete(route.id); return }
    if (!isLiveRoute(route)) return
    await deliver(route, text)
  }
  function harness(channel, botId) {
    if (!['weixin', 'wecom'].includes(channel)) throw fail('不支持的 IM 渠道', 404)
    return {
      ensureRunning: async () => { if (closed) throw fail('IM 服务正在停止', 503); return true },
      createSession: async ({ conversationKey } = {}) => {
        const prefix = channel === 'weixin' ? 'p2p:' : 'direct:'
        if (typeof conversationKey !== 'string' || !conversationKey.startsWith(prefix) || conversationKey.length <= prefix.length || conversationKey.length > 300) throw fail('银行 IM 仅支持本人私聊', 403)
        return store.update(draft => {
          const existing = Object.values(draft.routes).find(route => route.channel === channel && route.botId === botId && route.key === conversationKey)
          if (existing) return existing.id
          if (Object.keys(draft.routes).length >= 1000) throw fail('IM 会话数量已达上限', 429)
          const id = `im-${randomUUID()}`
          draft.routes[id] = { id, channel, botId, key: conversationKey }
          return id
        })
      },
      workspaceSession: (id, key) => ({
        sessionId: id,
        sessionExists: async () => { try { ownedRoute(id, channel, botId, key); return true } catch { return false } },
        isRunning: () => { const route = ownedRoute(id, channel, botId, key); return active.has(route.sessionId) },
        hasActiveTurn: () => false,
        ask: async (content, options = {}) => {
          const route = ownedRoute(id, channel, botId, key)
          if (!live.has(id) || !route.sessionId) return loginMessage(route)
          try { await current(route.sessionId) } catch { live.delete(id); return loginMessage(route) }
          if (!isLiveRoute(route)) return '账号连接已更改，请重新发送需求。'
          if (options.signal?.aborted) return '本次 IM 请求已取消。'
          if (active.has(route.sessionId)) return actionMessage(route)
          if (typeof content !== 'string' || options.files?.length || options.images?.length) return '当前银行 IM 入口支持文字办理；图片和文件请在银行助手页面发送。'
          if (!content.trim() || content.length > 12_000) return '请发送不超过 12000 字的文字需求。'
          // Native IM administration commands never become bank instructions.
          if (content.trim().startsWith('/')) return '请直接输入银行业务需求；账号连接和确认请在银行页面操作。'
          return new Promise(resolve => {
            const waiter = { route, resolve, handedOff: false, messages: new Map(), notices: new Set(), error: false }
            waiter.timer = setTimeout(() => {
              if (!waiter.handedOff) { waiter.handedOff = true; resolve(`任务仍在处理中，请在银行页面查看状态：\n${portal}#session=${encodeURIComponent(route.sessionId)}`) }
              // An unbounded background turn must not retain an IM reply callback.
              void cancel(route.sessionId).catch(() => {})
            }, timeoutMs)
            waiter.timer.unref?.()
            active.set(route.sessionId, waiter)
            const abort = () => { void cancel(route.sessionId).catch(() => {}) }
            options.signal?.addEventListener('abort', abort, { once: true })
            void Promise.resolve().then(() => {
              if (!isLiveRoute(route)) throw fail('IM 连接已更改', 409)
              return run(route.sessionId, content)
            }).catch(() => { waiter.error = true }).finally(async () => {
              options.signal?.removeEventListener('abort', abort)
              clearTimeout(waiter.timer)
              active.delete(route.sessionId)
              const answer = waiter.error ? '本次处理未完成，请到银行页面查看状态和实际业务记录。' : [...waiter.messages.values()].join('\n\n') || '本次处理已结束，请以银行页面的实际业务记录为准。'
              if (!waiter.handedOff) {
                try {
                  await current(route.sessionId)
                  const latest = store.snapshot().routes[id]
                  resolve(live.has(id) && latest?.sessionId === route.sessionId && latest?.ownerId === route.ownerId ? answer : '账号连接已更改，请重新发送需求。')
                }
                catch { live.delete(id); resolve(loginMessage(route)) }
              } else { await send(route, answer).catch(() => {}) }
            }).catch(() => { resolve('IM 处理暂时中断，请在银行页面核对实际业务状态。') })
          })
        },
      }),
    }
  }
  function observe(sessionId, event) {
    const waiter = active.get(sessionId)
    if (!waiter) return
    if (event.type === 'assistant') waiter.messages.set(event.messageId ?? 'final', event.text)
    if (event.type === 'assistant-reset') waiter.messages.delete(event.messageId)
    if (event.type === 'error') waiter.error = true
    if (event.type !== 'consent' && event.type !== 'question') return
    const id = event.challenge?.challengeId ?? event.question?.questionId
    if (waiter.notices.has(id)) return
    waiter.notices.add(id)
    if (!waiter.handedOff) { waiter.handedOff = true; waiter.resolve(actionMessage(waiter.route)) }
    else void send(waiter.route, actionMessage(waiter.route)).catch(() => {})
  }
  return {
    harness, observe,
    async bindScannedWeixin(botId, conversationKey, identity) {
      // Identity comes from the provider's confirmed QR result, never a browser-supplied recipient.
      const conflict = Object.values(store.snapshot().routes).some(route => route.channel === 'weixin'
        && route.key === conversationKey && route.ownerId && route.ownerId !== identity.user.id)
      if (conflict) throw fail('此微信私聊已绑定其他银行账户，请由原账户先解除', 409)
      const id = await harness('weixin', botId).createSession({ conversationKey })
      return this.claim(pairing(store.snapshot().routes[id]), identity)
    },
    reminderRoutes() { return Object.fromEntries(Object.entries(store.snapshot().routes).filter(([id]) => !claiming.has(id))) },
    async authorizeQuery(challenge, approve) {
      const route = active.get(challenge.sessionId)?.route
      if (!route || !isLiveRoute(route)) return false
      await current(route.sessionId)
      if (!isLiveRoute(route)) return false
      const approved = await approve(challenge)
      if (approved && !isLiveRoute(route)) throw fail('IM 连接已更改，请重新发送需求', 409)
      return approved
    },
    preview(code) {
      const pending = pairings.get(code)
      if (!pending || pending.expiresAt <= clock()) throw fail('绑定码不存在或已过期', 404)
      const route = store.snapshot().routes[pending.routeId]
      if (!route) throw fail('绑定码不存在或已过期', 404)
      return { label: label(route), expiresAt: pending.expiresAt }
    },
    async claim(code, identity) {
      this.preview(code)
      const { routeId } = pairings.get(code)
      const route = store.snapshot().routes[routeId]
      if (route.ownerId && route.ownerId !== identity.user.id) throw fail('此 IM 身份已绑定其他银行账户，请先由原账户解除', 409)
      if (claiming.has(routeId)) throw fail('正在绑定此 IM 身份，请稍后重试', 409)
      claiming.add(routeId)
      onBindingChange(routeId)
      pairings.delete(code) // Single consumption, before any asynchronous bank operation.
      try {
        if (route.sessionId) await cancel(route.sessionId)
        live.delete(routeId)
        const sessionId = await createSession(identity)
        await store.update(draft => {
          const latest = draft.routes[routeId]
          if (!latest || (latest.ownerId && latest.ownerId !== identity.user.id)) throw fail('此 IM 身份已更改，请重新连接', 409)
          Object.assign(latest, { ownerId: identity.user.id, sessionId, bindingRevision: randomUUID() })
        })
        live.add(routeId)
        return { id: routeId, sessionId, label: label(route) }
      } finally { claiming.delete(routeId) }
    },
    list(ownerId) { return Object.values(store.snapshot().routes).filter(route => route.ownerId === ownerId).map(route => ({ id: route.id, label: label(route), sessionId: route.sessionId, connected: live.has(route.id) })) },
    async revoke(id, ownerId) {
      const route = store.snapshot().routes[id]
      if (!route || route.ownerId !== ownerId) throw fail('连接不存在', 404)
      if (claiming.has(id)) throw fail('此连接正在更新，请稍后重试', 409)
      claiming.add(id)
      onBindingChange(id)
      try {
        live.delete(id)
        for (const [code, pending] of pairings) if (pending.routeId === id) pairings.delete(code)
        await cancel(route.sessionId)
        await store.update(draft => { delete draft.routes[id].ownerId; delete draft.routes[id].sessionId })
      } finally { claiming.delete(id) }
    },
    async removeBot(channel, botId) {
      const routes = Object.values(store.snapshot().routes).filter(route => route.channel === channel && route.botId === botId)
      if (routes.some(route => claiming.has(route.id))) throw fail('机器人有连接正在更新，请稍后重试', 409)
      for (const route of routes) claiming.add(route.id)
      for (const route of routes) onBindingChange(route.id)
      try {
        for (const route of routes) { live.delete(route.id); if (route.sessionId) await cancel(route.sessionId) }
        for (const [code, pending] of pairings) if (routes.some(route => route.id === pending.routeId)) pairings.delete(code)
        await store.update(draft => { for (const route of routes) delete draft.routes[route.id] })
      } finally { for (const route of routes) claiming.delete(route.id) }
    },
    async close() { closed = true; live.clear(); pairings.clear(); await Promise.allSettled([...active.keys()].map(cancel)); await store.flush() },
  }
}
