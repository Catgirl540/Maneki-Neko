/** Real IM transport trial. No bank database, model, bank identity or transaction tools. */
import { createServer } from 'node:http'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { openImStore } from '../bridge/im-store.mjs'
import { createImChannels } from '../bridge/im-channels.mjs'
import { createImHttp } from '../bridge/im-http.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
export function createConnectionTestHarness() {
  const sessions = new Map(), received = { weixin: 0, wecom: 0 }
  let closed = false
  return {
    status: () => ({ mode: 'connection-test', received: { ...received } }),
    close: () => { closed = true; sessions.clear() },
    harness(channel, botId) {
      if (!['weixin', 'wecom'].includes(channel)) throw Error('Unsupported trial channel')
      return {
        ensureRunning: async () => { if (closed) throw Error('连接验证服务已停止'); return true },
        createSession: async ({ conversationKey } = {}) => {
          const prefix = channel === 'weixin' ? 'p2p:' : 'direct:'
          if (closed || typeof conversationKey !== 'string' || !conversationKey.startsWith(prefix) || conversationKey.length <= prefix.length) throw Error('连接验证仅支持私聊')
          if (sessions.size >= 1000) throw Error('本地验证会话数量已达上限')
          const id = `im-connect-${randomUUID()}`
          sessions.set(id, { channel, botId, key: conversationKey })
          return id
        },
        workspaceSession: (id, key) => {
          const owned = () => {
            const value = sessions.get(id)
            return !closed && value?.channel === channel && value?.botId === botId && value?.key === key
          }
          return {
            sessionId: id, sessionExists: async () => owned(), isRunning: () => false, hasActiveTurn: () => false,
            ask: async () => {
              if (!owned()) throw Error('连接验证会话不存在')
              received[channel]++
              return '【本地 IM 连接测试】已收到您的私聊消息，消息收发连接正常。当前未启用大模型和银行业务，不会办理查询或交易。'
            },
          }
        },
      }
    },
  }
}

export async function startLocalIm({ port = Number(process.env.LUCKYCAT_IM_LOCAL_PORT ?? 8791), directory = join(root, '.dsh-home', 'im-connection-test'), makeChannels = createImChannels } = {}) {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const keyPath = join(directory, 'data-key')
  let dataKey
  try { dataKey = (await readFile(keyPath, 'utf8')).trim() }
  catch (error) {
    if (error.code !== 'ENOENT') throw error
    dataKey = randomBytes(32).toString('base64')
    await writeFile(keyPath, dataKey + '\n', { mode: 0o600, flag: 'wx' })
  }
  const store = await openImStore(join(directory, 'credentials.enc.json'), dataKey)
  const transport = createConnectionTestHarness()
  const ticket = randomBytes(32).toString('base64url')
  const authorize = async req => {
    const supplied = Buffer.from(req.headers.authorization ?? '')
    const expected = Buffer.from(`Bearer ${ticket}`)
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw Object.assign(Error('本地管理访问已过期，请通过启动入口重新打开。'), { status: 401 })
  }
  const channels = await makeChannels({ directory, credentials: store.credentials, harness: transport.harness })
  const router = createImHttp({ bank: { removeBot: async () => {} }, channels, authorizeAdmin: authorize, connectionTestStatus: transport.status })
  const sendJson = async (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(JSON.stringify(body)) }
  let stopping = false
  const close = async () => {
    if (stopping) return
    stopping = true; transport.close()
    server.closeAllConnections()
    await Promise.all([new Promise(done => server.close(done)), channels.close()])
    await store.flush()
  }
  const server = createServer((req, res) => {
    void (async () => {
      if (stopping) return sendJson(res, 503, { error: '连接验证服务正在停止' })
      const pathname = new URL(req.url, 'http://127.0.0.1').pathname
      if (pathname === '/agent-api/im/local/stop' && req.method === 'POST') {
        await authorize(req)
        res.once('finish', () => { setImmediate(() => { void close() }) })
        await sendJson(res, 200, { ok: true })
        return
      }
      const readJson = async (request, max = 8192) => {
        let size = 0; const chunks = []
        for await (const chunk of request) { size += chunk.length; if (size > max) throw Object.assign(Error('请求体过大'), { status: 413 }); chunks.push(chunk) }
        try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') } catch { throw Object.assign(Error('JSON 请求格式无效'), { status: 400 }) }
      }
      if (await router.handle(req, res, { pathname, readJson, sendJson })) return
      await sendJson(res, 404, { error: '此模式只验证 IM 连接，未提供银行或模型接口。' })
    })().catch(error => { if (!res.headersSent) void sendJson(res, error.status ?? 500, { error: error.status ? error.message : '连接操作失败，请查看本地日志。' }); else res.destroy() })
  })
  await new Promise((done, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', done) })
  const base = `http://127.0.0.1:${server.address().port}`
  const access = { mode: 'connection-test', pid: process.pid, base, url: `${base}/agent-api/im?mode=connection-test#local=${ticket}` }
  try {
    await channels.initialize()
    await writeFile(join(directory, 'access.json'), JSON.stringify(access, null, 2), { mode: 0o600 })
  } catch (error) { await close(); throw error }
  return { ...access, close, channels, status: transport.status }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    await startLocalIm()
    console.log(`本地 IM 连接验证已启动：http://127.0.0.1:${process.env.LUCKYCAT_IM_LOCAL_PORT ?? 8791}/agent-api/im`)
    console.log('模式：真实扫码与私聊收发；不启用模型或银行业务。管理入口保存在仓库内隔离的 access.json。')
  } catch (error) { console.error(`本地 IM 连接验证启动失败：${error.code ?? error.message}`); process.exitCode = 1 }
}
