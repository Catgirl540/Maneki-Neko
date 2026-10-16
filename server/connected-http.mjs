const fail = (message, status, code) => { throw Object.assign(new Error(message), { status, code }) }
async function rawBody(req, max = 128 * 1024) {
  const chunks = []; let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > max) fail('请求体过大', 413, 'PAYLOAD_TOO_LARGE')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}
async function objectBody(req) {
  let value
  try { value = JSON.parse((await rawBody(req, 16 * 1024)).toString('utf8')) }
  catch (error) { if (error.status) throw error; fail('请求体不是合法 JSON', 400, 'INVALID_JSON') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('请求体必须是对象', 400, 'INVALID_JSON')
  return value
}
const json = (res, value, status = 200) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
  res.end(JSON.stringify(value))
}
export function createConnectedHttp({ connections, auth, staffAuth, mode }) {
  return { async handle(req, res, url) {
    if (url.pathname === '/staff-api/bank-connection/readiness') {
      staffAuth.resolve(req, { roles: ['ops','supervisor'] })
      if (req.method !== 'GET') fail('只支持查询', 405, 'METHOD_NOT_ALLOWED')
      json(res, await connections.readiness()); return true
    }
    const webhook = /^\/api\/bank-webhooks\/([a-f0-9-]{36})$/.exec(url.pathname)
    if (webhook) {
      if (process.env.BANK_WEBHOOK_ENABLED !== 'true') fail('银行回执通道尚未配置', 503, 'BANK_NOT_CONNECTED')
      if (req.method !== 'POST') fail('不支持此请求方法', 405, 'METHOD_NOT_ALLOWED')
      const peer = req.socket.remoteAddress
      if (!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(peer) || req.headers['x-forwarded-proto'] !== 'https') fail('回执必须通过已配置的 HTTPS 入口', 403, 'SECURE_TRANSPORT_REQUIRED')
      json(res, await connections.processBankReceipt(webhook[1], await rawBody(req), req.headers)); return true
    }
    if (url.pathname === '/api/bank-connections' || (mode === 'live' && url.pathname === '/api/accounts')) {
      if (req.method !== 'GET') fail('不支持此请求方法', 405, 'METHOD_NOT_ALLOWED')
      const owner = (await auth.identity(req)).id
      json(res, await connections.listAccounts(owner)); return true
    }
    const account = mode === 'live' ? /^\/api\/accounts\/([^/]+)$/.exec(url.pathname) : null
    if (account) {
      if (req.method !== 'GET') fail('不支持此请求方法', 405, 'METHOD_NOT_ALLOWED')
      json(res, await connections.getAccount((await auth.identity(req)).id, account[1])); return true
    }
    if (url.pathname === '/api/bank-payments') {
      if (req.method !== 'POST') fail('不支持此请求方法', 405, 'METHOD_NOT_ALLOWED')
      const owner = (await auth.identity(req)).id
      json(res, await connections.createPayment(owner, await objectBody(req), req.headers['idempotency-key']), 201); return true
    }
    const payment = /^\/api\/bank-payments\/([^/]+)$/.exec(url.pathname)
    if (payment) {
      if (req.method !== 'GET') fail('不支持此请求方法', 405, 'METHOD_NOT_ALLOWED')
      json(res, await connections.getPayment((await auth.identity(req)).id, payment[1])); return true
    }
    return false
  } }
}
