/**
 * 招财猫 agent 演示服务：浏览器 ↔ agent 运行时之间的那一段。
 *
 * 它做三件事：
 *   1. **驱动 agent 运行时**（子进程 + stdio JSON-RPC，官方姿势）；
 *   2. 把会话事件流整理成 SSE，推给网页；
 *   3. **充当敏感操作的确认通道**：agent 插件把待确认事项 POST 到这里并挂住，
 *      等服务把用户在网页上的答复返回。
 *
 * 为什么支付密码只到这里、不到 agent：agent 进程里跑的是模型与工具，
 * 它只需要知道"这个人验证通过了"，不需要也不应该拿到密码。
 * 所以浏览器把密码交给本服务校验，agent 侧只收到一张"已验证"的答复。
 *
 * 真实后端上线时，把本文件换成后端即可：agent 侧的接口面（JSON-RPC 与确认通道的
 * JSON 形状）都不变。
 *
 * 用法：
 *   node bridge/demo-server.mjs
 *   LUCKYCAT_DEMO_PORT=8788 LUCKYCAT_PROVIDER=openrouter node bridge/demo-server.mjs
 *
 * 环境变量：
 *   LUCKYCAT_DEMO_PORT  监听端口，默认 8788
 *   LUCKYCAT_PROVIDER   模型路由，默认 openrouter
 *   LUCKYCAT_MODEL      模型名，默认 inclusionai/ling-3.0-flash-vl:free
 *   LUCKYCAT_DEMO_PASSWORD 演示用支付密码，默认 123456
 *   LUCKYCAT_DEMO_TOKEN    可选的访问口令；设了以后所有请求都要带
 *                          `x-luckycat-token` 头（演示服务默认只监听本机）
 *   LUCKYCAT_PATCHES       可选的额外 profile overlay（冒号或逗号分隔绝对路径），
 *                          用于端到端自检时改超时一类的参数
 */

import { createServer } from 'node:http'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// 硬闸：DSH_HOME 只能是仓库内的 .dsh-home（与 bridge/run.mjs 同一口径）。
const home = join(ROOT, '.dsh-home')
if (!home.startsWith(ROOT)) throw new Error(`refusing DSH_HOME outside the repo: ${home}`)
process.env.DSH_HOME = home

const PORT = Number(process.env.LUCKYCAT_DEMO_PORT ?? 8788)
const PROVIDER = process.env.LUCKYCAT_PROVIDER ?? 'openrouter'
const MODEL = process.env.LUCKYCAT_MODEL ?? 'inclusionai/ling-3.0-flash-vl:free'
const DEMO_PASSWORD = process.env.LUCKYCAT_DEMO_PASSWORD ?? '123456'
const ACCESS_TOKEN = process.env.LUCKYCAT_DEMO_TOKEN ?? ''
/** 可选的额外 overlay（冒号或逗号分隔绝对路径），端到端自检用。 */
const PATCHES = (process.env.LUCKYCAT_PATCHES ?? '')
  .split(/[:,]/)
  .map(entry => entry.trim())
  .filter(entry => entry !== '')
/** 一次确认最多等多久（毫秒）。超时即拒绝——与插件侧的超时是两道独立的闸。 */
const CONSENT_TIMEOUT_MS = Number(process.env.LUCKYCAT_CONSENT_TIMEOUT_MS ?? 180_000)
/** 请求体上限；防止有人往这里灌垃圾。 */
const MAX_BODY_BYTES = 256 * 1024

/* ------------------------------------------------------------------ 小工具 */

/** 读请求体（有上限），返回字符串。 */
function readBody(req) {
  return new Promise((resolvePromise, rejectPromise) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        rejectPromise(new Error(`请求体超过 ${MAX_BODY_BYTES} 字节`))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => { resolvePromise(Buffer.concat(chunks).toString('utf8')) })
    req.on('error', rejectPromise)
  })
}

/** 读 JSON 请求体；空体返回 {}。 */
async function readJson(req) {
  const text = await readBody(req)
  if (text.trim() === '') return {}
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('请求体不是合法 JSON')
  }
}

/** 回一个 JSON 响应。 */
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    // 演示服务只给本机网页用；不允许被别的站点带着 cookie 调。
    'access-control-allow-origin': '*',
    'cache-control': 'no-store',
  })
  res.end(body)
}

/** 读一个路径参数（已 decode）。 */
function pathParts(pathname) {
  return pathname.split('/').filter(part => part !== '').map(part => decodeURIComponent(part))
}

/* ------------------------------------------------- 确认通道（agent → 用户） */

/**
 * 待确认事项表：challengeId → { challenge, resolve, reject, timer }。
 * 键是插件生成的随机 nonce，所以答复必须带上同一个 nonce 才会被接受。
 */
const pendingConsents = new Map()

/** 每个会话的 SSE 订阅者：sessionId → Set<res>。 */
const streams = new Map()

/** 把一条 SSE 事件推给某个会话的所有订阅者。 */
function publish(sessionId, event) {
  const subscribers = streams.get(sessionId)
  if (subscribers === undefined) return
  const frame = `data: ${JSON.stringify(event)}\n\n`
  for (const res of subscribers) {
    try {
      res.write(frame)
    } catch {
      subscribers.delete(res)
    }
  }
}

/** 广播给全部订阅者（用于 health/模型变更这类全局消息）。 */
function broadcast(event) {
  for (const sessionId of streams.keys()) publish(sessionId, event)
}

/** 结束一个待确认事项。 */
function settleConsent(challengeId, answer) {
  const entry = pendingConsents.get(challengeId)
  if (entry === undefined) return false
  pendingConsents.delete(challengeId)
  clearTimeout(entry.timer)
  publish(entry.challenge.sessionId, { type: 'consent-resolved', challengeId, decision: answer?.decision ?? 'timeout' })
  entry.resolve(answer)
  return true
}

/* --------------------------------------------------------- agent 运行时 */

/** 会话表：我们的 sessionId → { harness 会话句柄, 忙碌标志, 工具调用轨迹 }。 */
const sessions = new Map()

/** 共享的 harness（一个进程带多个会话）。 */
let harness

/** 从会话事件里抽出给网页看的东西。 */
function projectEvent(sessionId, event) {
  switch (event.type) {
    case 'assistant/message': {
      const text = textOf(event.data?.message?.content ?? [])
      return text === '' ? undefined : { type: 'assistant', text }
    }
    case 'tool/call':
      return {
        type: 'tool-call',
        callId: String(event.data.callId),
        name: event.data.name,
        // 参数原样给网页，让"要展示什么"由确认卡片决定（这里不做业务判断）。
        arguments: safeParse(event.data.arguments),
      }
    case 'tool/result': {
      // 工具结果的形状与助手消息不同：文本**嵌在** `content[].content[]` 里，
      // 调用 id 在 `message.source.callId` 上（不在 message.callId）。
      // 一开始按助手消息那样读，结果界面上"已完成"后面什么都没有——工具返回的
      // 回执号就丢了，而那正是"真的执行过"的证据。
      const message = event.data?.message ?? {}
      const block = Array.isArray(message.content) ? message.content[0] : undefined
      return {
        type: 'tool-result',
        callId: String(message.source?.callId ?? ''),
        isError: block?.isError === true,
        text: textOf(block?.content ?? []),
      }
    }
    case 'approval/asked':
      return { type: 'consent-asked', callId: String(event.data.callId ?? ''), toolName: event.data.toolName }
    case 'approval/decided':
      return { type: 'consent-decided', outcome: event.data.outcome }
    default:
      return undefined
  }
}

/** 把内容块里的文本拼起来。 */
function textOf(content) {
  if (!Array.isArray(content)) return ''
  return content
    .filter(block => block?.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('')
}

/** 解析工具参数 JSON；坏了就原样给出（不抛）。 */
function safeParse(text) {
  if (typeof text !== 'string') return text
  try {
    return JSON.parse(text)
  } catch {
    return { _unparsed: text }
  }
}

/** 确保 harness 已启动。 */
async function ensureHarness() {
  if (harness !== undefined) return harness
  harness = new DeepSeekHarness({
    dshBin: join(ROOT, 'node_modules', '.bin', 'dsh'),
    profile: 'luckycat',
    provider: PROVIDER,
    model: MODEL,
    initializeTimeoutMs: 30_000,
    ...PATCHES.length === 0 ? {} : { patches: PATCHES },
  })
  await harness.start()
  return harness
}

/**
 * 取或建一个会话。
 *
 * `started` 是关键的一格：**建过**不等于**跑过**。网页把历史对话存在浏览器里，
 * 刷新之后会拿着旧的会话 id 回来问"这段对话的上下文还在吗"。只有真的往运行时
 * 递过提示词的会话，运行时里才存在这个会话；服务重启过就全没了。少了这一格，
 * 用户看到的是一段记得住的记录配一个失忆的助手，而且**界面上看不出来**。
 */
function sessionOf(sessionId) {
  let entry = sessions.get(sessionId)
  if (entry === undefined) {
    entry = { id: sessionId, busy: false, handle: undefined, started: false }
    sessions.set(sessionId, entry)
  }
  return entry
}

/**
 * 跑一轮对话：把事件推给 SSE，直到 agent 空闲。
 * 刻意**不** await 在 HTTP 处理器里——prompt 的语义是"入队"，与上游一致。
 */
async function runTurn(sessionId, text) {
  const entry = sessionOf(sessionId)
  if (entry.busy) {
    publish(sessionId, { type: 'error', message: '上一轮还在进行中，请等它结束。' })
    return
  }
  entry.busy = true
  publish(sessionId, { type: 'status', status: 'running' })
  try {
    const active = await ensureHarness()
    entry.handle ??= active.session(sessionId)
    // 递提示词之前打上标记：这一步之后运行时里就有这个会话了。
    entry.started = true
    const result = await entry.handle.run(text, {
      onNotification: (notification) => {
        if (notification.method !== 'session.event') return
        const projected = projectEvent(sessionId, notification.params.event)
        if (projected !== undefined) publish(sessionId, projected)
      },
    })
    if (result.finalResponse.trim() === '') {
      publish(sessionId, { type: 'error', message: '模型没有产出可见文本（可能上游失败），请看服务端日志。' })
    }
  } catch (error) {
    publish(sessionId, { type: 'error', message: `agent 运行失败：${error instanceof Error ? error.message : String(error)}` })
  } finally {
    entry.busy = false
    publish(sessionId, { type: 'status', status: 'idle' })
  }
}

/* ------------------------------------------------------------ HTTP 路由 */

const server = createServer((req, res) => {
  void handle(req, res).catch((error) => {
    if (!res.headersSent) sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
    else res.end()
  })
})

async function handle(req, res) {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`)
  const parts = pathParts(url.pathname)

  // 访问口令（可选）：设了就一律要带对，否则拒绝。
  if (ACCESS_TOKEN !== '' && req.headers['x-luckycat-token'] !== ACCESS_TOKEN) {
    sendJson(res, 401, { error: '缺少或错误的 x-luckycat-token' })
    return
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type,x-luckycat-token',
    })
    res.end()
    return
  }

  // 健康探测：网页据此决定走真 agent 还是回落固定话术。
  if (req.method === 'GET' && parts.join('/') === 'agent-api/health') {
    sendJson(res, 200, { ok: true, provider: PROVIDER, model: MODEL, sessions: sessions.size })
    return
  }

  // 建会话
  if (req.method === 'POST' && parts.join('/') === 'agent-api/sessions') {
    const sessionId = `web-${randomUUID()}`
    sessionOf(sessionId)
    sendJson(res, 200, { sessionId })
    return
  }

  // 问一个会话还在不在（网页恢复历史对话时用）。
  // 只读：**不会**顺手把它建出来，否则每个历史对话都被问成"还在"。
  if (req.method === 'GET' && parts.length === 3 && parts[0] === 'agent-api' && parts[1] === 'sessions') {
    const sessionId = parts[2]
    const entry = sessions.get(sessionId)
    sendJson(res, 200, {
      sessionId,
      known: entry !== undefined,
      started: entry?.started === true,
      busy: entry?.busy === true,
    })
    return
  }

  // 发消息
  if (req.method === 'POST' && parts.length === 4 && parts[0] === 'agent-api' && parts[1] === 'sessions' && parts[3] === 'messages') {
    const sessionId = parts[2]
    const body = await readJson(req)
    const text = typeof body.text === 'string' ? body.text.trim() : ''
    if (text === '') {
      sendJson(res, 400, { error: 'text 不能为空' })
      return
    }
    sessionOf(sessionId)
    void runTurn(sessionId, text)
    sendJson(res, 202, { accepted: true })
    return
  }

  // SSE 事件流
  if (req.method === 'GET' && parts.length === 4 && parts[0] === 'agent-api' && parts[1] === 'sessions' && parts[3] === 'stream') {
    const sessionId = parts[2]
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'access-control-allow-origin': '*',
      // 关掉 nginx 一类中间层的缓冲，否则事件会被攒着不发。
      'x-accel-buffering': 'no',
    })
    res.write(`data: ${JSON.stringify({ type: 'hello', sessionId })}\n\n`)
    const subscribers = streams.get(sessionId) ?? new Set()
    subscribers.add(res)
    streams.set(sessionId, subscribers)
    // 心跳：让中间层与浏览器知道连接还活着。
    const beat = setInterval(() => {
      try {
        res.write(': ping\n\n')
      } catch {
        clearInterval(beat)
      }
    }, 15_000)
    req.on('close', () => {
      clearInterval(beat)
      subscribers.delete(res)
      if (subscribers.size === 0) streams.delete(sessionId)
    })
    return
  }

  // 用户对某个挑战的答复（浏览器 → 这里）
  if (req.method === 'POST' && parts.length === 3 && parts[0] === 'agent-api' && parts[1] === 'consent') {
    const challengeId = parts[2]
    const entry = pendingConsents.get(challengeId)
    if (entry === undefined) {
      sendJson(res, 404, { error: '这个待确认事项不存在或已过期' })
      return
    }
    const body = await readJson(req)
    const decision = body.decision === 'approve' ? 'approve' : 'reject'
    if (decision === 'reject') {
      settleConsent(challengeId, { decision: 'reject', challengeId })
      sendJson(res, 200, { ok: true, decision })
      return
    }
    // 同意 → 校验支付密码。**需要验证的才要密码**；不需要的（只读查询）直接放行。
    const required = entry.challenge.verification
    if (required !== undefined) {
      if (required !== 'payment-password') {
        // 演示服务只实现支付密码；别的验证方式需要真实后端（短信网关/人脸核身）。
        settleConsent(challengeId, { decision: 'reject', challengeId })
        sendJson(res, 501, { error: `演示服务不支持 ${required} 验证方式` })
        return
      }
      const password = typeof body.paymentPassword === 'string' ? body.paymentPassword : ''
      if (password !== DEMO_PASSWORD) {
        // 密码错**不**结算挑战：让用户可以再输一次（挑战本身仍有超时兜底）。
        sendJson(res, 401, { error: '支付密码不正确' })
        return
      }
      settleConsent(challengeId, {
        decision: 'approve',
        challengeId,
        verification: {
          method: 'payment-password',
          verified: true,
          // 票据只带"验证通过"这件事与一个随机标识，**不含密码**。
          ticket: `pw-${randomUUID()}`,
        },
      })
      sendJson(res, 200, { ok: true, decision, verified: true })
      return
    }
    settleConsent(challengeId, { decision: 'approve', challengeId })
    sendJson(res, 200, { ok: true, decision })
    return
  }

  // 确认通道（agent 插件 → 这里，长轮询）
  if (req.method === 'POST' && url.pathname === '/consent/challenge') {
    const challenge = await readJson(req)
    if (typeof challenge.challengeId !== 'string' || challenge.challengeId === '') {
      sendJson(res, 400, { error: 'challenge 缺少 challengeId' })
      return
    }
    const answer = await new Promise((resolvePromise) => {
      const id = challenge.challengeId
      const timer = setTimeout(() => {
        pendingConsents.delete(id)
        publish(challenge.sessionId, { type: 'consent-resolved', challengeId: id, decision: 'timeout' })
        resolvePromise({ decision: 'reject', challengeId: id })
      }, CONSENT_TIMEOUT_MS)
      // 插件侧放弃了等待（自身超时，或会话被取消）→ 立刻把挑战摘掉。
      // 不做这一步的话，用户过一会儿再点"确认"会拿到 200，却什么都不会发生
      // ——因为 agent 早就不等了。这是实测踩到的。
      //
      // **必须监听 `res` 而不是 `req`**：请求体读完之后 `req` 的 'close' 早就发过了
      // （Node 的语义是"请求流已结束"，不是"对端断开"），挂在 req 上的清理永远不会触发。
      // `res` 的 'close' 在两处都会来，所以用 `writableEnded` 区分"正常回完"与"对端断了"。
      const onClose = () => {
        if (res.writableEnded) return
        if (!pendingConsents.has(id)) return
        clearTimeout(timer)
        pendingConsents.delete(id)
        publish(challenge.sessionId, { type: 'consent-resolved', challengeId: id, decision: 'abandoned' })
        resolvePromise({ decision: 'reject', challengeId: id })
      }
      res.on('close', onClose)
      pendingConsents.set(id, { challenge, resolve: resolvePromise, timer })
      // 把挑战推给网页：这就是"展示交易信息"那一步。
      publish(challenge.sessionId, { type: 'consent', challenge })
    })
    // 客户端已经断开时不能再写响应（会抛写入已结束）。
    if (!res.writableEnded && !res.destroyed) sendJson(res, 200, answer)
    return
  }

  sendJson(res, 404, { error: `未知路径：${req.method} ${url.pathname}` })
}

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[demo-server] http://127.0.0.1:${PORT}`)
  console.log(`[demo-server] DSH_HOME=${home}`)
  console.log(`[demo-server] provider=${PROVIDER} model=${MODEL}`)
  if (ACCESS_TOKEN !== '') console.log('[demo-server] 已启用访问口令（x-luckycat-token）')
})

/** 优雅退出：结束所有待确认事项与 SSE 连接，再关 harness。 */
async function shutdown() {
  for (const [challengeId, entry] of pendingConsents) {
    clearTimeout(entry.timer)
    entry.resolve({ decision: 'reject', challengeId })
  }
  pendingConsents.clear()
  for (const subscribers of streams.values()) {
    for (const res of subscribers) res.end()
  }
  streams.clear()
  server.close()
  if (harness !== undefined) await harness.close()
}

process.on('SIGINT', () => { void shutdown().then(() => process.exit(0)) })
process.on('SIGTERM', () => { void shutdown().then(() => process.exit(0)) })
