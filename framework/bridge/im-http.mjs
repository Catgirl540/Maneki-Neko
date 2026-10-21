import { readFile } from 'node:fs/promises'
import { createCustomerQr } from './im-customer-qr.mjs'

const files = new Map([
  ['/agent-api/im', ['im-portal.html', 'text/html']],
  ['/agent-api/im/portal.js', ['im-portal.js', 'text/javascript']],
])
export function createImHttp({ bank, channels, bankUrl, fetchImpl = fetch, authorizeAdmin, connectionTestStatus, reminders = () => undefined }) {
  const attempts = new Map()
  const customerQr = createCustomerQr({ bank, channels })
  async function bankRequest(path, { authorization, body } = {}) {
    const response = await fetchImpl(new URL(path, bankUrl), { method: body ? 'POST' : 'GET', redirect: 'error', headers: { 'content-type': 'application/json', ...(authorization ? { authorization } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(12_000) })
    const data = await response.json()
    if (!response.ok) throw Object.assign(Error(data.message ?? data.error ?? '银行认证失败'), { status: response.status })
    return data
  }
  return {
    async handle(req, res, { pathname, identity, readJson, sendJson }) {
      if (!pathname.startsWith('/agent-api/im')) return false
      if (req.method === 'GET' && files.has(pathname)) {
        const [file, type] = files.get(pathname)
        res.writeHead(200, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" })
        res.end(await readFile(new URL(file, import.meta.url)))
        return true
      }
      // A standalone transport check has no bank login, customer or transaction API.
      if (connectionTestStatus) {
        if (pathname === '/agent-api/im/local/status' && req.method === 'GET') {
          await authorizeAdmin(req)
          await sendJson(res, 200, connectionTestStatus())
          return true
        }
        if (!pathname.startsWith('/agent-api/im/admin/')) return false
      }
      if (pathname.startsWith('/agent-api/im/auth/')) {
        if (req.method !== 'POST') throw Object.assign(Error('请求方式不支持'), { status: 405 })
        const address = req.socket.remoteAddress, time = Date.now()
        for (const [key, value] of attempts) if (value.until <= time) attempts.delete(key)
        const attempt = attempts.get(address) ?? { count: 0, until: time + 60_000 }
        if (++attempt.count > 20 || attempts.size > 1000) throw Object.assign(Error('登录请求过多，请稍后重试'), { status: 429 })
        attempts.set(address, attempt)
        const body = await readJson(req, 8192)
        let data
        if (pathname.endsWith('/sms')) data = await bankRequest('/api/auth/sms-code', { body: { phone: body.phone } })
        else if (pathname.endsWith('/login')) {
          if (body.admin === true) {
            const result = await bankRequest('/staff-api/login', { body: { name: body.name, password: body.password } })
            if (result.staff?.role !== 'ops') {
              await bankRequest('/staff-api/logout', { authorization: `Bearer ${result.token}`, body: {} }).catch(() => {})
              throw Object.assign(Error('仅运维人员可以管理 IM 机器人'), { status: 403 })
            }
            data = { token: result.token, name: result.staff.name }
          } else {
            const result = await bankRequest('/api/auth/login', { body: { phone: body.phone, password: body.password, smsCode: body.smsCode } })
            data = { token: result.token, name: result.user.name }
          }
        } else throw Object.assign(Error('接口不存在'), { status: 404 })
        await sendJson(res, 200, data)
        return true
      }
      if (pathname.startsWith('/agent-api/im/admin/')) {
        if (authorizeAdmin) await authorizeAdmin(req)
        else {
          const staff = await bankRequest('/staff-api/me', { authorization: req.headers.authorization })
          if (staff.role !== 'ops') throw Object.assign(Error('仅运维人员可以管理 IM 机器人'), { status: 403 })
        }
        const parts = pathname.split('/').slice(4)
        const [channel, operation, id] = parts
        let result
        if (req.method === 'GET' && channel === 'status' && parts.length === 1) result = channels.status()
        else if (operation === 'provision' && req.method === 'POST' && !id) result = await channels.provision(channel)
        else if (operation === 'provision' && req.method === 'GET' && id) result = await channels.registration(channel, id)
        else if (operation === 'cancel' && req.method === 'POST' && id) result = await channels.cancelProvision(channel, id)
        else if (operation === 'verify' && req.method === 'POST' && id) result = await channels.verify(channel, id, (await readJson(req, 8192)).code)
        else if (channel === 'wecom' && operation === 'bind' && req.method === 'POST') result = await channels.bindWecom(await readJson(req, 8192))
        else if (operation === 'reconnect' && req.method === 'POST' && id) result = await channels.reconnect(channel, id)
        else if (operation === 'bots' && req.method === 'DELETE' && id) { await bank.removeBot(channel, id); result = await channels.remove(channel, id) }
        else throw Object.assign(Error('接口不存在'), { status: 404 })
        await sendJson(res, 200, result ?? { ok: true }); return true
      }
      if (!identity) return false // The normal Bridge authenticates all remaining routes.
      let result
      const qr = /^\/agent-api\/im\/weixin\/qr(?:\/([\w-]{1,128})(?:\/(verify|cancel|confirm))?)?$/.exec(pathname)
      if (qr) {
        const [, id, action] = qr
        if (!id && req.method === 'POST') result = await customerQr.start(identity)
        else if (id && !action && req.method === 'GET') result = customerQr.poll(identity, id)
        else if (id && action && req.method === 'POST') {
          const body = await readJson(req, 8192)
          if (action === 'confirm') result = await customerQr.confirm(identity, id, body.confirmed)
          else if (action === 'verify') result = await customerQr.verify(identity, id, body.code)
          else result = await customerQr.cancel(identity, id)
        } else throw Object.assign(Error('请求方式不支持'), { status: 405 })
      }
      else if (pathname === '/agent-api/im/reminders' || /^\/agent-api\/im\/reminders\/rem-[\w-]+$/.test(pathname)) {
        const service = reminders()
        if (!service) throw Object.assign(Error('微信提醒尚未启用'), { status: 503 })
        if (pathname === '/agent-api/im/reminders' && req.method === 'GET') result = service.list(identity.user.id)
        else {
          const body = await readJson(req, 8192)
          if (body.confirmed !== true) throw Object.assign(Error('请先核对并确认提醒操作'), { status: 400 })
          if (pathname === '/agent-api/im/reminders' && req.method === 'POST') {
            const prepared = service.prepare(identity.user.id, 'create', { title: body.title, dueAt: body.dueAt, bindingId: body.bindingId })
            result = service.execute(identity.user.id, prepared, body.requestId)
          } else if (req.method === 'DELETE' && pathname !== '/agent-api/im/reminders') {
            const prepared = service.prepare(identity.user.id, 'cancel', { reminderId: pathname.split('/').at(-1) })
            result = service.execute(identity.user.id, prepared, body.requestId)
          } else throw Object.assign(Error('请求方式不支持'), { status: 405 })
        }
      }
      else if (pathname === '/agent-api/im/preview' && req.method === 'POST') result = bank.preview((await readJson(req, 8192)).code)
      else if (pathname === '/agent-api/im/claim' && req.method === 'POST') result = await bank.claim((await readJson(req, 8192)).code, identity)
      else if (pathname === '/agent-api/im/bindings' && req.method === 'GET') result = bank.list(identity.user.id)
      else if (/^\/agent-api\/im\/bindings\/im-[\w-]+$/.test(pathname) && req.method === 'DELETE') { await bank.revoke(pathname.split('/').at(-1), identity.user.id); result = { ok: true } }
      else throw Object.assign(Error('接口不存在'), { status: 404 })
      await sendJson(res, 200, result); return true
    },
  }
}
