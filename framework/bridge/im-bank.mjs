/** dsh-im Harness contract backed by the existing, authenticated bank Bridge. */
import { randomBytes, randomUUID } from 'node:crypto'
const fail = (message, status = 400) => Object.assign(new Error(message), { status })
const label = route => `${route.channel === 'weixin' ? '微信' : '企业微信'}私聊 · ${route.key.slice(-4)}`

export function createImBank({ store, publicUrl, createSession, current, run, cancel, deliver, handleReminder, onBindingChange = () => {}, onClaim = async () => {}, onRevoke = async () => {}, audience = 'customer', portalPath = '/agent-api/im', clock = Date.now, timeoutMs = 600_000 }) {
  const base = new URL(publicUrl)
  if (base.username || base.password || base.search || base.hash || !['https:', 'http:'].includes(base.protocol)
      || (base.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))) throw Error('LUCKYCAT_IM_PUBLIC_URL must use HTTPS (HTTP is only allowed on loopback)')
  const portal = new URL(portalPath, base.origin).href
  const pairings = new Map(), active = new Map(), live = new Set(), claiming = new Set(), reminderActive = new Map(), continuations = new Map()
  let closed = false
  function pairing(route, content) {
    for (const [code, item] of pairings) if (item.expiresAt <= clock()) pairings.delete(code)
    const request = audience === 'customer' && typeof content === 'string' && content.trim().length <= 4000
      && !/^(?:绑定|重新绑定|登录|重新登录|连接|重新连接)$/.test(content.trim())
      && !content.trim().startsWith('/') && !/密码|验证码|安全码|cvv/i.test(content) ? content.trim() : undefined
    for (const [code, item] of pairings) if (item.routeId === route.id) { if (content !== undefined) item.request = request; return code }
    if (pairings.size >= 1000) throw fail('绑定请求过多，请稍后重试', 429)
    const code = randomBytes(24).toString('base64url')
    pairings.set(code, { routeId: route.id, expiresAt: clock() + 600_000, request })
    return code
  }
  const loginMessage = (route, content) => audience==='staff'
    ? `请先在银行页面登录工作人员账户并绑定${label(route)}，再发送您的需求：\n${portal}#code=${pairing(route)}\n绑定码十分钟有效；密码和验证码只在银行页面填写。`
    : `请先在银行页面登录并绑定${label(route)}，恢复银行授权：\n${portal}#code=${pairing(route, content)}\n${typeof content === 'string' && pairings.get(pairing(route))?.request ? '页面会显示本次请求；恢复连接后点击“继续这次请求”，涉及资金仍需单独确认。' : '恢复后可回微信发送银行需求。'}\n绑定码十分钟有效；登录密码和支付密码只在银行页面填写。`
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
  function isReminderRoute(route) {
    const latest = store.snapshot().routes[route.id]
    return !closed && !claiming.has(route.id) && audience === 'customer' && route.channel === 'weixin'
      && typeof route.ownerId === 'string' && route.ownerId.length > 0 && !!route.bindingRevision
      && (route.audience === undefined || route.audience === 'customer')
      && latest?.ownerId === route.ownerId && latest?.sessionId === route.sessionId
      && latest?.bindingRevision === route.bindingRevision && latest?.channel === route.channel
      && latest?.botId === route.botId && latest?.key === route.key && latest?.audience === route.audience
  }
  async function tryReminder(route, content, options) {
    if (!handleReminder || !isReminderRoute(route) || typeof content !== 'string' || !content.trim()
      || content.length > 12000 || options.files?.length || options.images?.length || content.trim().startsWith('/')) return
    if (reminderActive.has(route.id)) return '上一条消息正在处理，请稍后再发送提醒。'
    const controller = new AbortController()
    reminderActive.set(route.id, controller)
    const abort = () => controller.abort()
    options.signal?.addEventListener('abort', abort, { once: true })
    if (options.signal?.aborted) abort()
    let onAbort
    const interrupted = new Promise(resolve => {
      onAbort = () => resolve({ interrupted: true })
      controller.signal.addEventListener('abort', onAbort, { once: true })
      if (controller.signal.aborted) onAbort()
    })
    const timer = setTimeout(abort, timeoutMs)
    timer.unref?.()
    const isCurrent = () => !controller.signal.aborted && isReminderRoute(route)
    try {
      const task = Promise.resolve().then(() => {
        if (!isCurrent()) return { interrupted: true }
        return Promise.resolve().then(() => handleReminder(structuredClone(route), content, { signal: controller.signal, isCurrent }))
          .then(value => ({ value }), () => ({ failed: true }))
      })
      const result = await Promise.race([task, interrupted])
      if (!isCurrent() || result.interrupted) return '本次提醒处理已取消或连接已更改，请重新发送需求。'
      if (result.failed || (result.value !== undefined && typeof result.value !== 'string')) return '本次提醒未能完成，请在微信重试并核对网页提醒记录。'
      return result.value
    } finally {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', abort)
      controller.signal.removeEventListener('abort', onAbort)
      controller.abort()
      if (reminderActive.get(route.id) === controller) reminderActive.delete(route.id)
    }
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
          draft.routes[id] = { id, channel, botId, key: conversationKey, audience }
          return id
        })
      },
      workspaceSession: (id, key) => ({
        sessionId: id,
        sessionExists: async () => { try { ownedRoute(id, channel, botId, key); return true } catch { return false } },
        isRunning: () => { const route = ownedRoute(id, channel, botId, key); return reminderActive.has(id) || active.has(route.sessionId) },
        hasActiveTurn: () => false,
        ask: async (content, options = {}) => {
          const route = ownedRoute(id, channel, botId, key)
          if (closed) return 'IM 服务正在停止，请稍后再试。'
          const reminder = await tryReminder(route, content, options)
          if (reminder !== undefined) return reminder
          if (!live.has(id) || !route.sessionId) return loginMessage(route, content)
          try { await current(route.sessionId) } catch { live.delete(id); return loginMessage(route, content) }
          if (!isLiveRoute(route)) return '账号连接已更改，请重新发送需求。'
          if (options.signal?.aborted) return '本次 IM 请求已取消。'
          if (active.has(route.sessionId)) return actionMessage(route)
          if (typeof content !== 'string' || options.files?.length || options.images?.length) return '当前银行 IM 入口支持文字办理；图片和文件请在银行助手页面发送。'
          if (!content.trim() || content.length > 12_000) return '请发送不超过 12000 字的文字需求。'
          // Native IM administration commands never become bank instructions.
          if (content.trim().startsWith('/')) return '请直接输入银行业务需求；账号连接和确认请在银行页面操作。'
          // A new bank instruction supersedes any unstarted login-recovery request for this chat.
          for (const [token, item] of continuations) if (item.route.id === id) continuations.delete(token)
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
    preview(code, ownerId) {
      const pending = pairings.get(code)
      if (!pending || pending.expiresAt <= clock()) throw fail('绑定码不存在或已过期', 404)
      const route = store.snapshot().routes[pending.routeId]
      if (!route) throw fail('绑定码不存在或已过期', 404)
      if (ownerId && route.ownerId && ownerId !== route.ownerId) throw fail('此 IM 身份已绑定其他银行账户，请使用本人账户登录', 403)
      return { label: label(route), expiresAt: pending.expiresAt, ...(ownerId && pending.request ? { request: pending.request } : {}) }
    },
    async claim(code, identity) {
      if (audience === 'staff' && !['csr','supervisor'].includes(identity?.user?.role)) throw fail('仅客服和主管可绑定工作人员 IM', 403)
      this.preview(code)
      const { routeId, request, expiresAt } = pairings.get(code)
      const route = store.snapshot().routes[routeId]
      if (route.ownerId && route.ownerId !== identity.user.id) throw fail('此 IM 身份已绑定其他银行账户，请先由原账户解除', 409)
      if (claiming.has(routeId)) throw fail('正在绑定此 IM 身份，请稍后重试', 409)
      claiming.add(routeId)
      reminderActive.get(routeId)?.abort()
      onBindingChange(routeId)
      pairings.delete(code) // Single consumption, before any asynchronous bank operation.
      try {
        if (route.sessionId) await cancel(route.sessionId)
        live.delete(routeId)
        const sessionId = await createSession(identity)
        await store.update(draft => {
          const latest = draft.routes[routeId]
          if (!latest || (latest.ownerId && latest.ownerId !== identity.user.id)) throw fail('此 IM 身份已更改，请重新连接', 409)
          Object.assign(latest, { ownerId: identity.user.id, sessionId, audience,
            bindingRevision: route.ownerId === identity.user.id && route.bindingRevision ? route.bindingRevision : randomUUID() })
        })
        try { await onClaim(store.snapshot().routes[routeId], identity) }
        catch (error) {
          await store.update(draft => { delete draft.routes[routeId].ownerId; delete draft.routes[routeId].sessionId; delete draft.routes[routeId].bindingRevision })
          await cancel(sessionId)
          throw error
        }
        live.add(routeId)
        for (const [token, item] of continuations) if (item.expiresAt <= clock() || item.route.id === routeId) continuations.delete(token)
        let continuation
        if (audience === 'customer' && request && expiresAt > clock()) {
          if (continuations.size >= 1000) throw fail('请求较多，请回微信重新发送需求', 429)
          const token = randomBytes(24).toString('base64url')
          continuations.set(token, { route: structuredClone(store.snapshot().routes[routeId]), request, expiresAt })
          continuation = { token, request, expiresAt }
        }
        return { id: routeId, sessionId, label: label(route), ...(continuation ? { continuation } : {}) }
      } finally { claiming.delete(routeId) }
    },
    async continueRequest(token, ownerId) {
      const pending = continuations.get(token)
      if (!pending || pending.expiresAt <= clock() || pending.route.ownerId !== ownerId) throw fail('这次请求不存在或已过期，请回微信重新发送', 404)
      const route = pending.route
      const unchanged = () => {
        const latest = store.snapshot().routes[route.id]
        return !closed && !claiming.has(route.id) && isLiveRoute(route) && latest?.bindingRevision === route.bindingRevision
          && latest?.channel === route.channel && latest?.botId === route.botId && latest?.key === route.key
      }
      if (!unchanged()) throw fail('连接已变化，请回微信重新发送请求', 409)
      await current(route.sessionId)
      if (!unchanged() || continuations.get(token) !== pending) throw fail('请求已处理或连接已变化，请核对会话', 409)
      if (active.has(route.sessionId) || reminderActive.has(route.id)) throw fail('会话正在处理其他请求，请稍后继续', 409)
      continuations.delete(token) // Consume before starting; a network retry never repeats a financial instruction.
      const task = harness(route.channel, route.botId).workspaceSession(route.id, route.key).ask(pending.request)
      void task.then(answer => send(route, answer)).catch(() => {})
      return { id: route.id, sessionId: route.sessionId, started: true }
    },
    list(ownerId) {
      for (const [token, item] of continuations) if (item.expiresAt <= clock()) continuations.delete(token)
      return Object.values(store.snapshot().routes).filter(route => route.ownerId === ownerId).map(route => {
        const pending = audience === 'customer' && isLiveRoute(route) && [...continuations].find(([, item]) => item.route.id === route.id && item.route.sessionId === route.sessionId && item.route.bindingRevision === route.bindingRevision)
        return { id: route.id, label: label(route), sessionId: route.sessionId, connected: live.has(route.id),
          ...(pending ? { continuation: { token: pending[0], request: pending[1].request, expiresAt: pending[1].expiresAt } } : {}) }
      })
    },
    async revoke(id, ownerId) {
      const route = store.snapshot().routes[id]
      if (!route || route.ownerId !== ownerId) throw fail('连接不存在', 404)
      if (claiming.has(id)) throw fail('此连接正在更新，请稍后重试', 409)
      claiming.add(id)
      for (const [token, item] of continuations) if (item.route.id === id) continuations.delete(token)
      reminderActive.get(id)?.abort()
      onBindingChange(id)
      try {
        await onRevoke(route)
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
      for (const route of routes) reminderActive.get(route.id)?.abort()
      for (const route of routes) onBindingChange(route.id)
      try {
        for (const route of routes) { live.delete(route.id); if (route.sessionId) await cancel(route.sessionId) }
        for (const [code, pending] of pairings) if (routes.some(route => route.id === pending.routeId)) pairings.delete(code)
        await store.update(draft => { for (const route of routes) delete draft.routes[route.id] })
      } finally { for (const route of routes) claiming.delete(route.id) }
    },
    async close() { closed = true; for (const controller of reminderActive.values()) controller.abort(); live.clear(); pairings.clear(); continuations.clear(); await Promise.allSettled([...active.keys()].map(cancel)); await store.flush() },
  }
}
