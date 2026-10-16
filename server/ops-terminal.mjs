import { verifyPassword } from './passwords.mjs'
import { createHash, randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import { hostname, userInfo } from 'node:os'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const require = createRequire(new URL('../framework/package.json', import.meta.url))
const MAX_TABS = 8, MAX_SESSIONS = 32, MAX_HISTORY = 512 * 1024
const PREFIX = '/staff-api/ops/terminal/sessions'
const fail = (status, message, code) => Object.assign(new Error(message), { status, code })
const ownerKey = req => createHash('sha256').update(String(req.headers.authorization ?? '')).digest('hex')
const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)) }

/** Only human ops identities can create PTYs. Disabled until explicitly configured. */
export function createOpsTerminal({ auth, writeAudit, db, root, enabled = process.env.BANK_OPS_TERMINAL_ENABLED === 'true', password = process.env.BANK_OPS_PASSWORD, idleMs = 15 * 60_000 }) {
  const sessions = new Map()
  let ptyModule
  function audit(session, action, reason) { try { Promise.resolve(writeAudit({ actorId: session.actorId, action, targetType: 'terminal', targetId: session.id, reason })).catch(() => {}) } catch {} }
  function publish(session, frame) {
    const event = { cursor: ++session.cursor, ...frame }
    const size = Buffer.byteLength(JSON.stringify(event))
    session.history.push({ event, size }); session.historyBytes += size
    while (session.historyBytes > MAX_HISTORY && session.history.length > 1) session.historyBytes -= session.history.shift().size
    for (const res of session.streams) {
      if (res.destroyed || res.writableLength > 256 * 1024) { session.streams.delete(res); res.destroy(); continue }
      res.write(`id: ${event.cursor}\ndata: ${JSON.stringify(frame)}\n\n`)
    }
  }
  function stop(session, reason) {
    if (!sessions.has(session.id)) return
    sessions.delete(session.id)
    if (!session.exited) { try { session.pty.kill() } catch {} }
    for (const res of session.streams) res.end()
    session.streams.clear()
    audit(session, 'ops.terminal.close', `${reason}; inputBytes=${session.inputBytes}`)
  }
  async function checkConfig(who) {
    if (!enabled) throw fail(503, '终端服务尚未启用', 'TERMINAL_DISABLED')
    if (process.getuid?.() === 0) throw fail(503, '终端服务须以非 root 账号运行', 'TERMINAL_ROOT_DISABLED')
    const credential = await db.prepare('SELECT password_hash FROM staff_users WHERE id = ?').get(who.actorId)
    if (typeof password !== 'string' || password.length < 12 || !credential || !verifyPassword(password, credential.password_hash)) {
      throw fail(503, '启用终端前须为运维账号配置独立的至少 12 位密码', 'TERMINAL_UNSAFE_CREDENTIAL')
    }
    if (!ptyModule) {
      try { ptyModule = require('node-pty') }
      catch { throw fail(503, '服务器未安装 PTY 运行依赖', 'TERMINAL_DEPENDENCY_MISSING') }
    }
  }
  async function body(req) {
    if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) throw fail(415, '需要 JSON 请求', 'BAD_CONTENT_TYPE')
    const chunks = []; let bytes = 0
    for await (const chunk of req) { bytes += chunk.length; if (bytes > 32_768) throw fail(413, '终端请求过大', 'TOO_LARGE'); chunks.push(chunk) }
    try {
      const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('object required')
      return value
    }
    catch { throw fail(400, '请求体不是合法 JSON', 'BAD_BODY') }
  }
  function size(value) {
    if (!Number.isInteger(value.cols) || value.cols < 2 || value.cols > 500 || !Number.isInteger(value.rows) || value.rows < 1 || value.rows > 200) throw fail(400, '终端尺寸无效', 'BAD_SIZE')
    return { cols: value.cols, rows: value.rows }
  }
  function metadata(session) { return { id: session.id, host: hostname(), user: userInfo().username, shell: session.shell, cwd: session.cwd } }
  const timer = setInterval(() => {
    for (const session of sessions.values()) {
      try { auth.resolve({ headers: { authorization: session.authorization } }, { roles: ['ops'] }) }
      catch { stop(session, 'authentication expired'); continue }
      if (!session.streams.size && Date.now() - session.touchedAt > idleMs) stop(session, 'idle timeout')
    }
  }, Math.min(5000, idleMs))
  timer.unref?.()
  const unsubscribe = auth.onLogout?.(authorization => { const key = ownerKey({ headers: { authorization } }); for (const session of sessions.values()) if (session.owner === key) stop(session, 'logout') })

  async function handle(req, res, url) {
    if (url.pathname !== PREFIX && !url.pathname.startsWith(PREFIX + '/')) return false
    const who = auth.resolve(req, { roles: ['ops'] })
    const owner = ownerKey(req)
    if (url.pathname === PREFIX) {
      if (req.method === 'GET') { json(res, 200, [...sessions.values()].filter(session => session.owner === owner).map(metadata)); return true }
      if (req.method !== 'POST') throw fail(405, '请求方式不支持', 'METHOD_NOT_ALLOWED')
      await checkConfig(who)
      const geometry = size(await body(req))
      auth.resolve(req, { roles: ['ops'] })
      if (sessions.size >= MAX_SESSIONS || [...sessions.values()].filter(session => session.actorId === who.actorId).length >= MAX_TABS) throw fail(429, '已达到终端会话数量上限，请先关闭标签', 'TERMINAL_LIMIT')
      const shell = process.env.BANK_OPS_TERMINAL_SHELL ?? (process.platform === 'win32' ? 'powershell.exe' : existsSync('/bin/bash') ? '/bin/bash' : '/bin/sh')
      const cwd = resolve(process.env.BANK_OPS_TERMINAL_CWD ?? root)
      const args = shell.endsWith('bash') ? ['--noprofile', '--norc', '-i'] : shell.endsWith('zsh') ? ['-f', '-i'] : process.platform === 'win32' ? ['-NoLogo', '-NoProfile'] : ['-i']
      // Do not pass model keys, database credentials or employee Bearer tokens to the shell environment.
      const env = Object.fromEntries(['PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'SystemRoot', 'WINDIR', 'COMSPEC', 'TMPDIR', 'TEMP', 'TMP'].filter(key => process.env[key]).map(key => [key, process.env[key]]))
      Object.assign(env, { TERM: 'xterm-256color', COLORTERM: 'truecolor' })
      let pty
      try { pty = ptyModule.spawn(shell, args, { ...geometry, name: 'xterm-256color', cwd, env }) }
      catch { throw fail(503, '无法启动服务器 Shell，请检查终端配置', 'TERMINAL_SPAWN_FAILED') }
      const session = { id: `term_${randomBytes(16).toString('hex')}`, actorId: who.actorId, owner, authorization: req.headers.authorization, pty, shell, cwd, history: [], historyBytes: 0, streams: new Set(), cursor: 0, touchedAt: Date.now(), inputBytes: 0, exited: false }
      sessions.set(session.id, session)
      pty.onData(data => { if (sessions.has(session.id)) publish(session, { type: 'output', data }) })
      pty.onExit(({ exitCode }) => { session.exited = true; if (sessions.has(session.id)) { publish(session, { type: 'exit', code: exitCode }); audit(session, 'ops.terminal.exit', `exitCode=${exitCode}`); for (const res of session.streams) res.end(); session.streams.clear(); session.touchedAt = Date.now() } })
      audit(session, 'ops.terminal.open', `shell=${shell}; cwd=${cwd}`)
      json(res, 201, metadata(session)); return true
    }
    const match = /^\/staff-api\/ops\/terminal\/sessions\/(term_[a-f0-9]{32})(?:\/(input|resize|events))?$/.exec(url.pathname)
    if (!match) throw fail(404, '终端接口不存在', 'NOT_FOUND')
    const session = sessions.get(match[1])
    if (!session || session.owner !== owner || session.actorId !== who.actorId) throw fail(404, '终端会话已失效', 'TERMINAL_NOT_FOUND')
    session.touchedAt = Date.now()
    if (!match[2] && req.method === 'DELETE') { stop(session, 'closed by operator'); json(res, 200, { ok: true }); return true }
    if (match[2] === 'input' && req.method === 'POST') {
      if (session.exited) throw fail(409, '终端进程已结束', 'TERMINAL_EXITED')
      const value = await body(req)
      auth.resolve(req, { roles: ['ops'] })
      if (!sessions.has(session.id)) throw fail(404, '终端会话已失效', 'TERMINAL_NOT_FOUND')
      if (session.exited) throw fail(409, '终端进程已结束', 'TERMINAL_EXITED')
      if (typeof value.data !== 'string' || Buffer.byteLength(value.data) > 16_384) throw fail(400, '终端输入无效或过大', 'BAD_INPUT')
      session.pty.write(value.data); session.inputBytes += Buffer.byteLength(value.data)
      json(res, 200, { ok: true }); return true
    }
    if (match[2] === 'resize' && req.method === 'POST') {
      const geometry = size(await body(req))
      auth.resolve(req, { roles: ['ops'] })
      if (!sessions.has(session.id)) throw fail(404, '终端会话已失效', 'TERMINAL_NOT_FOUND')
      if (!session.exited) session.pty.resize(geometry.cols, geometry.rows)
      json(res, 200, { ok: true }); return true
    }
    if (match[2] === 'events' && req.method === 'GET') {
      const after = Number(url.searchParams.get('after') ?? 0)
      if (!Number.isSafeInteger(after) || after < 0 || after > session.cursor) throw fail(400, '终端事件游标无效', 'BAD_CURSOR')
      if (session.streams.size >= 2) throw fail(429, '终端连接数量超限', 'TERMINAL_STREAM_LIMIT')
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' }); res.flushHeaders()
      if (session.history.length && after < session.history[0].event.cursor - 1) res.write(`id: ${session.history[0].event.cursor - 1}\ndata: {"type":"gap"}\n\n`)
      for (const { event: { cursor, ...frame } } of session.history) if (cursor > after) res.write(`id: ${cursor}\ndata: ${JSON.stringify(frame)}\n\n`)
      if (session.exited) { res.end(); return true }
      session.streams.add(res)
      res.on('error', () => { session.streams.delete(res); res.destroy() })
      const heartbeat = setInterval(() => { if (!res.destroyed) res.write(': keepalive\n\n') }, 15_000)
      heartbeat.unref?.()
      res.on('close', () => { clearInterval(heartbeat); session.streams.delete(res); session.touchedAt = Date.now() })
      return true
    }
    throw fail(405, '请求方式不支持', 'METHOD_NOT_ALLOWED')
  }
  function close() { clearInterval(timer); unsubscribe?.(); for (const session of sessions.values()) stop(session, 'server shutdown') }
  return { handle, close }
}
