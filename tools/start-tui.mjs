#!/usr/bin/env node
/**
 * Maneki-Neko local stack launcher (TUI).
 *
 * Runs the real stack -- bank API, three agents and the web client -- not the
 * browser mock. Everything is ASCII on purpose: a Windows console started with
 * a non-UTF-8 code page renders Chinese and box-drawing characters as mojibake,
 * and this launcher must be readable on cmd.exe, macOS Terminal and Linux alike.
 *
 * Only Node built-ins are used, so it runs before `npm ci` has been executed.
 *
 *   node tools/start-tui.mjs        (or ./start.sh / start.cmd)
 *
 * Secrets live in .start.local.json at the repo root (gitignored, mode 0600).
 * They are never printed back, never passed on a command line, and never
 * written into VITE_* variables that would ship to the browser.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import { connect } from 'node:net'
import { createInterface } from 'node:readline'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CONFIG_PATH = path.join(ROOT, '.start.local.json')
const IS_WIN = process.platform === 'win32'

/* ------------------------------------------------------------------ *
 * Terminal
 * ------------------------------------------------------------------ */

const CSI = '\x1b['
const out = text => process.stdout.write(text)
const clear = () => out(`${CSI}2J${CSI}H`)
const hideCursor = on => out(`${CSI}${on ? '?25l' : '?25h'}`)
const altScreen = on => out(`${CSI}${on ? '?1049h' : '?1049l'}`)
const color = (code, text) => `${CSI}${code}m${text}${CSI}0m`
const dim = t => color('2', t)
const bold = t => color('1', t)
const green = t => color('32', t)
const red = t => color('31', t)
const yellow = t => color('33', t)
const cyan = t => color('36', t)

const WIDTH = Math.max(60, Math.min(100, (process.stdout.columns || 80) - 1))
const rule = char => char.repeat(WIDTH)
const pad = (text, width) => {
  const visible = text.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
  return text + ' '.repeat(Math.max(0, width - visible.length))
}

/* ------------------------------------------------------------------ *
 * Config
 * ------------------------------------------------------------------ */

const CONFIG_KEYS = [
  // Bank database: the running API reads these on every start.
  ['bankDatabaseUrl', 'Bank DB URL (app role)'],
  ['bankDataKey', 'Bank data key (base64, 32 bytes)'],
  // AI session database: separate role and key, never the bank credentials.
  ['sessionDatabaseUrl', 'AI session DB URL (session role)'],
  ['sessionDataKey', 'AI session data key (base64, 32 bytes)'],
  // Owner connection, used only for one-off schema bootstrap.
  ['sessionOwnerDatabaseUrl', 'AI session DB URL (owner, bootstrap only)'],
  // Optional: chat needs a model. Without it the agents boot but cannot answer.
  ['openRouterKey', 'OPENROUTER_API_KEY (optional; chat needs it)'],
]

function loadConfig() {
  if (!existsSync(CONFIG_PATH)) return {}
  try { return JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) } catch { return {} }
}

function saveConfig(config) {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 })
  try { chmodSync(CONFIG_PATH, 0o600) } catch { /* Windows ignores POSIX modes */ }
}

const mask = value => (value ? `${value.slice(0, 4)}${'*'.repeat(8)} (set)` : '(not set)')
/** Never echo a password from a postgres URL. */
const maskUrl = value => {
  if (!value) return '(not set)'
  return value.replace(/\/\/([^:/@]+):([^@]*)@/, (_m, user) => `//${user}:********@`)
}

/* ------------------------------------------------------------------ *
 * Services
 * ------------------------------------------------------------------ */

const PORTS = { bank: 8080, agent: 8788, staff: 8789, ops: 8790, web: 5180 }

/** `npm` is `npm.cmd` on Windows; spawning the bare name there fails. */
const NPM = IS_WIN ? 'npm.cmd' : 'npm'

function services(config) {
  const bankUrl = `http://127.0.0.1:${PORTS.bank}`
  // Agents get the bank URL plus the AI session store; they never see the
  // bank's own data key, so a session-store compromise cannot decrypt accounts.
  const agentEnv = {
    LUCKYCAT_BANK_URL: bankUrl,
    ...(config.sessionDatabaseUrl ? { LUCKYCAT_SESSION_DATABASE_URL: config.sessionDatabaseUrl } : {}),
    ...(config.sessionDataKey ? { LUCKYCAT_SESSION_DATA_KEY: config.sessionDataKey } : {}),
    ...(config.openRouterKey ? { OPENROUTER_API_KEY: config.openRouterKey } : {}),
  }
  return [
    {
      id: 'bank', label: 'bank-api', port: PORTS.bank,
      cmd: process.execPath, args: ['server/index.mjs'], cwd: ROOT,
      env: {
        NODE_ENV: 'development',
        BANK_INTEGRATION_MODE: 'sandbox',
        BANK_AUTO_MIGRATE: 'false',
        BANK_PORT: String(PORTS.bank),
        ...(config.bankDatabaseUrl ? { BANK_DATABASE_URL: config.bankDatabaseUrl } : {}),
        ...(config.bankDataKey ? { BANK_DATA_KEY: config.bankDataKey } : {}),
      },
      needs: ['bankDatabaseUrl', 'bankDataKey'],
    },
    {
      id: 'agent', label: 'agent-customer', port: PORTS.agent,
      cmd: process.execPath, args: ['bridge/demo-server.mjs'], cwd: path.join(ROOT, 'framework'),
      env: { ...agentEnv, LUCKYCAT_DEMO_PORT: String(PORTS.agent) },
      needs: ['sessionDatabaseUrl', 'sessionDataKey'],
    },
    {
      id: 'staff', label: 'agent-staff', port: PORTS.staff,
      cmd: process.execPath, args: ['bridge/staff-server.mjs'], cwd: path.join(ROOT, 'framework'),
      env: { ...agentEnv, LUCKYCAT_DEMO_PORT: String(PORTS.staff) },
      needs: ['sessionDatabaseUrl', 'sessionDataKey'],
    },
    {
      id: 'ops', label: 'agent-ops', port: PORTS.ops,
      cmd: process.execPath, args: ['bridge/ops-server.mjs'], cwd: path.join(ROOT, 'framework'),
      env: { ...agentEnv, LUCKYCAT_DEMO_PORT: String(PORTS.ops) },
      needs: ['sessionDatabaseUrl', 'sessionDataKey'],
    },
    {
      id: 'web', label: 'web', port: PORTS.web,
      cmd: NPM, args: ['run', 'dev'], cwd: path.join(ROOT, 'app'),
      env: {
        VITE_USE_MOCK: 'false',
        VITE_PROXY_TARGET: bankUrl,
        VITE_AGENT_TARGET: `http://127.0.0.1:${PORTS.agent}`,
        VITE_STAFF_AGENT_TARGET: `http://127.0.0.1:${PORTS.staff}`,
      },
      needs: [],
    },
  ]
}

/* ------------------------------------------------------------------ *
 * Child processes
 * ------------------------------------------------------------------ */

const children = new Map()   // id -> { child, service }
const logs = []              // ring buffer of prefixed lines
const LOG_LIMIT = 400

function pushLog(prefix, line) {
  logs.push(`${dim(prefix)} ${line}`)
  if (logs.length > LOG_LIMIT) logs.splice(0, logs.length - LOG_LIMIT)
}

function startService(service, config) {
  const missing = service.needs.filter(key => !config[key])
  if (missing.length) return { ok: false, reason: `missing config: ${missing.join(', ')}` }
  if (children.has(service.id)) return { ok: false, reason: 'already running' }

  const child = spawn(service.cmd, service.args, {
    cwd: service.cwd,
    env: { ...process.env, ...service.env },
    // Keep stdout/stderr as pipes so the TUI can prefix and buffer them.
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    // POSIX: give the child its own process group. `npm run dev` spawns
    // sh -c vite, so signalling the npm pid alone leaves vite orphaned and
    // still holding the port. Windows has no process groups; taskkill /T
    // walks the tree instead.
    detached: !IS_WIN,
  })
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  const onData = buf => {
    for (const line of String(buf).split(/\r?\n/)) if (line.trim()) pushLog(service.label, line)
  }
  child.stdout.on('data', onData)
  child.stderr.on('data', onData)
  child.on('exit', (code, signal) => {
    children.delete(service.id)
    pushLog(service.label, red(`exited (code=${code ?? '-'} signal=${signal ?? '-'})`))
  })
  children.set(service.id, { child, service })
  return { ok: true }
}

/** Windows has no POSIX process groups; kill the tree explicitly. */
function killTree(pid) {
  if (IS_WIN) { spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); return }
  try { process.kill(-pid, 'SIGTERM') } catch { try { process.kill(pid, 'SIGTERM') } catch { /* gone */ } }
}

async function stopAll() {
  const entries = [...children.values()]
  if (entries.length === 0) return
  // Signal by process group on POSIX so grandchildren die too; on Windows
  // fall back to the direct child and let killTree clean up the tree.
  for (const { child } of entries) {
    try { if (IS_WIN) child.kill('SIGINT'); else process.kill(-child.pid, 'SIGINT') } catch { /* already gone */ }
  }
  await new Promise(done => setTimeout(done, 1500))
  for (const { child } of entries) if (child.exitCode === null) killTree(child.pid)
  children.clear()
  pushLog('stop', green('all services stopped'))
}

/* ------------------------------------------------------------------ *
 * Checks
 * ------------------------------------------------------------------ */

function nodeMajor() {
  const [major] = process.versions.node.split('.').map(Number)
  return major
}

function checkPort(port, host = '127.0.0.1', timeout = 700) {
  return new Promise(resolve => {
    const socket = connect({ port, host })
    const done = ok => { socket.destroy(); resolve(ok) }
    socket.setTimeout(timeout)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

function runCapture(cmd, args, cwd, env) {
  const result = spawnSync(cmd, args, { cwd, env: { ...process.env, ...env }, encoding: 'utf8', windowsHide: true, shell: false })
  return { code: result.status, out: (result.stdout ?? '') + (result.stderr ?? '') }
}

async function runEnvironmentCheck(config) {
  const checks = []
  const major = nodeMajor()
  checks.push([major >= 24, `Node.js ${process.versions.node}`, major >= 24 ? 'ok (>= 24)' : 'requires Node.js 24 or newer'])

  const npm = spawnSync(NPM, ['--version'], { encoding: 'utf8', windowsHide: true })
  checks.push([npm.status === 0, 'npm', npm.status === 0 ? `ok (${(npm.stdout ?? '').trim()})` : 'not found in PATH'])

  const git = spawnSync('git', ['--version'], { encoding: 'utf8', windowsHide: true })
  checks.push([git.status === 0, 'git', git.status === 0 ? 'ok' : 'not found (optional)'])

  for (const dir of ['server', 'app', 'staff', 'framework', 'framework/bridge/pg-runtime']) {
    const installed = existsSync(path.join(ROOT, dir, 'node_modules'))
    checks.push([installed, `deps ${dir}`, installed ? 'installed' : 'missing -> run "Install dependencies"'])
  }
  // bank-demo ships TypeScript only; lib/ is a tsc product that never enters git.
  const libBuilt = existsSync(path.join(ROOT, 'framework/packages/bank-demo/lib/index.js'))
  checks.push([libBuilt, 'bank-demo lib/', libBuilt ? 'built' : 'missing -> run "Install dependencies"'])

  const dbTargets = [
    ['bank DB', config.bankDatabaseUrl],
    ['session DB', config.sessionDatabaseUrl],
  ]
  for (const [label, url] of dbTargets) {
    if (!url) { checks.push([false, label, 'not configured -> run "Configure"']); continue }
    const parsed = parsePgUrl(url)
    if (!parsed) { checks.push([false, label, 'URL is not a postgres:// string']); continue }
    const reachable = await checkPort(parsed.port, parsed.host)
    checks.push([reachable, `${label} ${parsed.host}:${parsed.port}`, reachable ? 'reachable' : 'not reachable (is PostgreSQL running?)'])
  }
  return checks
}

function parsePgUrl(value) {
  try {
    const url = new URL(value)
    if (!/^postgres(ql)?:$/.test(url.protocol)) return null
    return { host: url.hostname || '127.0.0.1', port: Number(url.port || 5432) }
  } catch { return null }
}

/* ------------------------------------------------------------------ *
 * Actions
 * ------------------------------------------------------------------ */

async function installDependencies() {
  const steps = [
    { label: 'server deps', cwd: ROOT, args: ['ci', '--no-audit', '--no-fund'], prefix: 'server' },
    { label: 'app deps', cwd: ROOT, args: ['ci', '--no-audit', '--no-fund'], prefix: 'app' },
    { label: 'staff deps', cwd: ROOT, args: ['ci', '--no-audit', '--no-fund'], prefix: 'staff' },
    { label: 'framework deps', cwd: ROOT, args: ['ci', '--no-audit', '--no-fund'], prefix: 'framework' },
    { label: 'pg-runtime deps', cwd: ROOT, args: ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], prefix: 'framework/bridge/pg-runtime' },
  ]
  for (const step of steps) {
    pushLog('install', cyan(step.label))
    const result = runCapture(NPM, ['--prefix', step.prefix, ...step.args], step.cwd)
    const tail = result.out.trim().split('\n').slice(-2).join(' | ')
    pushLog('install', result.code === 0 ? green(`ok ${step.label}`) : red(`failed ${step.label}: ${tail}`))
    if (result.code !== 0) return false
  }
  // Bridge imports the compiled package, not the TypeScript source.
  pushLog('install', cyan('build bank-demo lib/'))
  const tsc = runCapture(
    process.execPath,
    [path.join(ROOT, 'framework/node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json'],
    path.join(ROOT, 'framework/packages/bank-demo'),
  )
  const built = existsSync(path.join(ROOT, 'framework/packages/bank-demo/lib/index.js'))
  pushLog('install', built ? green('ok bank-demo lib/') : red(`failed bank-demo lib/: ${tsc.out.split('\n').slice(-3).join(' | ')}`))
  return built
}

async function bootstrapDatabases(config, ask) {
  if (!config.bankDatabaseUrl || !config.bankDataKey) {
    pushLog('bootstrap', red('bank DB is not configured'))
    return false
  }
  pushLog('bootstrap', cyan('bank schema (owner connection required)'))
  const bank = runCapture(process.execPath, ['server/bootstrap-postgres.mjs'], ROOT, {
    NODE_ENV: 'development',
    BANK_INTEGRATION_MODE: 'sandbox',
    BANK_ALLOW_DEMO_SEED: 'true',
    BANK_DATABASE_URL: config.bankDatabaseUrl,
    BANK_DATA_KEY: config.bankDataKey,
  })
  pushLog('bootstrap', bank.code === 0 ? green('ok bank schema') : red(`bank bootstrap failed: ${bank.out.split('\n').slice(-4).join(' | ')}`))
  if (bank.code !== 0) return false

  if (!config.sessionOwnerDatabaseUrl) {
    pushLog('bootstrap', yellow('session owner URL not set - skip AI session schema'))
    return true
  }
  pushLog('bootstrap', cyan('AI session schema (owner connection)'))
  const session = runCapture(process.execPath, ['bridge/bootstrap-session-store.mjs'], path.join(ROOT, 'framework'), {
    LUCKYCAT_SESSION_MAINTENANCE: '1',
    LUCKYCAT_SESSION_OWNER_DATABASE_URL: config.sessionOwnerDatabaseUrl,
    LUCKYCAT_SESSION_DATABASE_URL: config.sessionDatabaseUrl ?? '',
    LUCKYCAT_SESSION_DATA_KEY: config.sessionDataKey ?? '',
  })
  pushLog('bootstrap', session.code === 0 ? green('ok AI session schema') : red(`session bootstrap failed: ${session.out.split('\n').slice(-4).join(' | ')}`))
  return session.code === 0
}

async function startAll(config) {
  const list = services(config)
  const started = []
  for (const service of list) {
    // A port that is already open belongs to some other process. Starting on
    // top of it would either fail to bind or silently talk to the wrong server,
    // and "listening" would then be reported for a process we do not own.
    if (await checkPort(service.port)) {
      pushLog('start', red(`${service.label}: port ${service.port} already in use by another process - stop it first`))
      continue
    }
    const result = startService(service, config)
    if (!result.ok) pushLog('start', red(`${service.label}: ${result.reason}`))
    else { pushLog('start', green(`${service.label} starting on port ${service.port}`)); started.push(service) }
  }
  if (started.length === 0) { pushLog('start', red('nothing was started - see the lines above')); return }
  // Give each one a moment, then report what actually opened a port.
  await new Promise(done => setTimeout(done, 3000))
  for (const service of started) {
    const ours = children.has(service.id)
    if (!ours) continue // it already exited; the exit line is in the log
    const listening = await checkPort(service.port)
    pushLog('start', listening ? green(`${service.label} listening :${service.port}`) : yellow(`${service.label} not listening yet :${service.port}`))
  }
}

/* ------------------------------------------------------------------ *
 * Prompts
 * ------------------------------------------------------------------ */

let rl = null
async function promptLine(label, current = '') {
  process.stdin.setRawMode?.(false)
  process.stdin.pause()
  hideCursor(false)
  rl = createInterface({ input: process.stdin, output: process.stdout })
  const suffix = current ? ` [${current ? 'keep current' : ''}]` : ''
  const answer = await new Promise(resolve => rl.question(`\n  ${label}${suffix}: `, resolve))
  rl.close(); rl = null
  process.stdin.setRawMode?.(true)
  process.stdin.resume()
  hideCursor(true)
  return answer.trim()
}

const newKey = () => randomBytes(32).toString('base64')

/**
 * Create the AI-session login role and hand back its connection URL.
 *
 * The session store keeps a separate least-privilege role on the same database.
 * Asking a person to create it by hand (and to invent a password, and to paste
 * the resulting URL) is the slowest and most error-prone part of a local setup,
 * so the only thing required here is an admin connection string.
 *
 * The password is hex: it is generated by us, needs no SQL quoting, and is
 * passed to the helper on stdin so it never shows up in `ps`.
 */
function ensureSessionRole(config) {
  if (!config.sessionOwnerDatabaseUrl) return null
  const password = randomBytes(24).toString('hex')
  const result = spawnSync(process.execPath, [path.join(ROOT, 'tools/create-session-role.mjs')], {
    input: JSON.stringify({ ownerUrl: config.sessionOwnerDatabaseUrl, role: 'maneki_ai_session', password }),
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30000,
  })
  const line = (result.stdout ?? '').trim().split('\n').filter(Boolean).pop()
  let parsed = null
  try { parsed = JSON.parse(line) } catch { /* reported below */ }
  if (!parsed?.ok) {
    const reason = parsed?.error ?? ((result.stderr ?? '').trim() || 'unknown error')
    return { ok: false, error: reason }
  }
  return { ok: true, url: parsed.url, created: parsed.created, database: parsed.database }
}

/* ------------------------------------------------------------------ *
 * Theme and drawing
 * ------------------------------------------------------------------ */

/** Colours degrade to plain text when disabled, so logs stay readable when piped. */
const NO_COLOR = Boolean(process.env.NO_COLOR) || process.env.TERM === 'dumb'
const can = code => (NO_COLOR ? (t => t) : code)
const ink = can(t => `${CSI}97m${t}${CSI}0m`)          // bright white
const muted = can(t => `${CSI}90m${t}${CSI}0m`)        // grey
const accent = can(t => `${CSI}96m${t}${CSI}0m`)       // cyan
const ok = can(t => `${CSI}92m${t}${CSI}0m`)           // green
const warn = can(t => `${CSI}93m${t}${CSI}0m`)         // yellow
const bad = can(t => `${CSI}91m${t}${CSI}0m`)          // red
const strong = can(t => `${CSI}1m${t}${CSI}0m`)

/**
 * Selected rows use reverse video. The `>` marker is drawn by the caller, so the
 * no-colour fallback must not add a second one.
 */
const selected = text => (NO_COLOR ? text : `${CSI}7m${text}${CSI}0m`)

const termWidth = () => Math.max(56, Math.min(92, (process.stdout.columns || 80) - 2))
const termHeight = () => Math.max(16, process.stdout.rows || 24)
const width = () => termWidth()
const strip = t => t.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
const fit = (text, w) => {
  const visible = strip(text)
  if (visible.length >= w) return strip(text).slice(0, w)
  return text + ' '.repeat(w - visible.length)
}
const wrap = (text, w) => {
  const words = strip(text).split(/\s+/)
  const lines = []
  let line = ''
  for (const word of words) {
    if (line.length + word.length + 1 > w) { if (line) lines.push(line); line = word }
    else line = line ? `${line} ${word}` : word
  }
  if (line) lines.push(line)
  return lines
}

function draw(lines) {
  const w = width()
  let buffer = `${CSI}H`
  for (const line of lines) buffer += fit(line, w) + `${CSI}K\n`
  buffer += `${CSI}J`
  out(buffer)
}

/**
 * The frame is sized from the visible width of each row, not from guesses about
 * how long the text is: ANSI escapes are invisible, and hardcoded padding makes
 * the right border drift out of alignment the moment a label changes.
 */
function banner() {
  const w = width()
  const row = content => `${muted('|')} ${fit(content, w - 4)} ${muted('|')}`
  return [
    muted('+' + '-'.repeat(w - 2) + '+'),
    row(`${strong('Maneki-Neko')}  ${muted('-')}  ${ink('local full stack')}`),
    row(muted('bank API + 3 agents + web client, real backend')),
    muted('+' + '-'.repeat(w - 2) + '+'),
  ]
}

function stepBar(current, total, label) {
  const w = width()
  const cells = []
  for (let i = 0; i < total; i++) cells.push(i < current ? ok('#') : i === current ? accent('#') : muted('.'))
  const left = `Step ${Math.min(current + 1, total)}/${total}`
  return `${accent(left)}  ${cells.join('')}  ${muted(label)}`
}

/* ------------------------------------------------------------------ *
 * Keys
 * ------------------------------------------------------------------ */

let stdinEnded = false
let listenerInstalled = false
/**
 * Keys are buffered by one permanent listener.
 *
 * Reading a key per prompt loses anything typed while a long job is running
 * (npm ci, bootstrap): during that window no promise is waiting, and stdin is
 * already flowing, so the keystroke is emitted and dropped. Pressing Enter
 * during an install then appears to do nothing. Queueing fixes that.
 */
const keyQueue = []
const keyWaiters = []

function decodeKeys(chunk) {
  const keys = []
  let rest = chunk
  while (rest.length) {
    if (rest.startsWith('\x1b[A')) { keys.push('up'); rest = rest.slice(3) }
    else if (rest.startsWith('\x1b[B')) { keys.push('down'); rest = rest.slice(3) }
    else if (rest.startsWith('\x1b[C')) { keys.push('right'); rest = rest.slice(3) }
    else if (rest.startsWith('\x1b[D')) { keys.push('left'); rest = rest.slice(3) }
    else if (rest.startsWith('\x1b')) { keys.push('escape'); rest = rest.slice(1) }
    else {
      const ch = rest[0]
      rest = rest.slice(1)
      if (ch === '\r' || ch === '\n') keys.push('enter')
      else if (ch === '\x03') keys.push('interrupt')
      else if (ch === '\x7f' || ch === '\b') keys.push('backspace')
      else if (ch === ' ') keys.push('enter')
      else keys.push(ch)
    }
  }
  return keys
}

function pushKey(key) {
  if (keyWaiters.length) keyWaiters.shift()(key)
  else keyQueue.push(key)
}

function installKeyListener() {
  if (listenerInstalled) return
  listenerInstalled = true
  process.stdin.setRawMode?.(true)
  process.stdin.resume()
  process.stdin.on('data', chunk => { for (const key of decodeKeys(chunk.toString('utf8'))) pushKey(key) })
  process.stdin.once('end', () => {
    stdinEnded = true
    while (keyWaiters.length) keyWaiters.shift()('eof')
  })
}

function readKey() {
  installKeyListener()
  if (keyQueue.length) return Promise.resolve(keyQueue.shift())
  if (stdinEnded) return Promise.resolve('eof')
  return new Promise(resolve => keyWaiters.push(resolve))
}

/* ------------------------------------------------------------------ *
 * Widgets
 * ------------------------------------------------------------------ */

/**
 * A vertical list of buttons driven by the arrow keys.
 *
 * Resolves with the chosen item's `value`, or 'back' / 'quit' for the
 * implied actions. Nothing has to be typed: the selection is the input.
 */
async function choose({ title, intro = [], items, hint, footer, step }) {
  let index = Math.max(0, items.findIndex(item => item.default))
  for (;;) {
    const w = width()
    const lines = [...banner(), '']
    if (step) { lines.push(`  ${stepBar(step.index, step.total, step.label)}`, '') }
    lines.push(`  ${strong(title)}`)
    for (const line of intro) lines.push(`  ${muted(line)}`)
    if (intro.length) lines.push('')
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      const label = `${item.label}${item.detail ? `  ${muted(item.detail)}` : ''}`
      // One marker column either way, so labels do not shift when the selection moves.
      lines.push(i === index
        ? `  ${selected(fit(`> ${strip(label)}`, w - 4))}`
        : `    ${label}`)
    }
    lines.push('')
    for (const line of footer ?? []) lines.push(`  ${line}`)
    lines.push(`  ${muted(hint ?? 'Up/Down to move   Enter to select   Esc to go back   q to quit')}`)
    draw(lines)

    const key = await readKey()
    if (key === 'up') index = (index - 1 + items.length) % items.length
    else if (key === 'down') index = (index + 1) % items.length
    else if (key === 'enter') return items[index].value
    else if (key === 'escape' || key === 'left') return 'back'
    else if (key === 'quit' || key === 'interrupt' || key === 'eof') return 'quit'
    else if (/^[1-9]$/.test(key) && Number(key) <= items.length) return items[Number(key) - 1].value
  }
}

/** Yes/No as two buttons; the safe answer is preselected. */
async function confirm({ title, question, yes = 'Yes', no = 'No', danger = false }) {
  const answer = await choose({
    title,
    intro: wrap(question, width() - 6),
    items: [
      { label: no, value: false, default: danger },
      { label: yes, value: true, default: !danger },
    ],
    hint: 'Up/Down to move   Enter to confirm',
  })
  if (answer === 'quit' || answer === 'back') return 'back'
  return answer
}

/** Read-only screen with a single Continue button. */
async function notice({ title, lines, button = 'Continue', intro = [] }) {
  return choose({
    title,
    intro,
    items: [{ label: button, value: 'ok', default: true }],
    footer: lines,
    hint: 'Enter to continue   q to quit',
  })
}

/**
 * Run an async job while showing progress.
 *
 * Without this the screen freezes for the tens of seconds an `npm ci` takes and
 * looks like a crash. The spinner plus the log tail proves it is still working.
 */
async function withProgress(title, job) {
  let done = false
  let result
  let error
  const frames = ['-', '\\', '|', '/']
  let frame = 0
  const started = Date.now()

  const painter = setInterval(() => {
    if (done) return
    const w = width()
    const lines = [...banner(), '']
    lines.push(`  ${strong(title)}`)
    lines.push('')
    lines.push(`  ${accent(frames[frame++ % frames.length])} ${muted(`${Math.round((Date.now() - started) / 1000)}s`)}`)
    lines.push('')
    const tail = logs.slice(-(termHeight() - 10))
    for (const line of tail) lines.push(`  ${line.slice(0, w - 4)}`)
    if (tail.length === 0) lines.push(`  ${muted('(no output yet)')}`)
    draw(lines)
  }, 120)

  try {
    result = await job()
  } catch (caught) {
    error = caught
  } finally {
    done = true
    clearInterval(painter)
  }
  if (error) throw error
  return result
}

/* ------------------------------------------------------------------ *
 * Text input (only for connection strings)
 * ------------------------------------------------------------------ */

/**
 * The one place that still needs typing: a PostgreSQL URL cannot be chosen.
 * A value that is already configured is shown masked and kept on Enter.
 */
async function askLine({ title, label, hint, current, secret = true }) {
  const shown = current ? (secret ? maskUrl(current) : current) : ''
  let buffer = ''
  for (;;) {
    const w = width()
    const lines = [...banner(), '']
    lines.push(`  ${strong(title)}`)
    lines.push('')
    lines.push(`  ${ink(label)}`)
    for (const line of wrap(hint, w - 6)) lines.push(`  ${muted(line)}`)
    lines.push('')
    const display = buffer || ''
    lines.push(`  ${accent('>')} ${display}${NO_COLOR ? '_' : ''}`)
    if (buffer === '' && shown) lines.push(`  ${muted(`Enter keeps the current value: ${shown}`)}`)
    lines.push('')
    lines.push(`  ${muted('Enter to confirm   Esc to go back   Ctrl+U to clear')}`)
    draw(lines)

    const key = await readKey()
    if (key === 'enter') return buffer === '' ? (current ?? '') : buffer
    if (key === 'escape' || key === 'left') return 'back'
    if (key === 'quit' || key === 'interrupt' || key === 'eof') return 'quit'
    if (key === 'up' || key === 'down') continue
    if (key === '\x15') { buffer = ''; continue }   // Ctrl+U
    if (key === '\x7f' || key === 'backspace') { buffer = buffer.slice(0, -1); continue }
    if (key.length === 1 && key >= ' ') buffer += key
  }
}

/* ------------------------------------------------------------------ *
 * Steps
 * ------------------------------------------------------------------ */

const TOTAL_STEPS = 5

const STEP_ENV = { index: 0, total: TOTAL_STEPS, label: 'Environment' }
async function stepEnvironment(config) {
  for (;;) {
    const checks = await withProgress('Environment check', async () => runEnvironmentCheck(config))
    const failing = checks.filter(([passed]) => !passed)
    const body = checks.map(([passed, name, detail]) =>
      `${passed ? ok('OK  ') : bad('FAIL')} ${fit(name, 34)} ${muted(detail)}`)
    const action = await choose({
      title: 'Environment',
      intro: failing.length === 0
        ? ['Everything this launcher needs is present.']
        : [`${failing.length} item(s) need attention before the stack can run.`],
      step: STEP_ENV,
      items: [
        { label: 'Continue', value: 'next', default: failing.length === 0 },
        { label: 'Re-check', value: 'retry' },
        ...(failing.length ? [{ label: 'Install dependencies', value: 'install' }] : []),
        { label: 'Quit', value: 'quit' },
      ],
      footer: ['', ...body],
      hint: 'Up/Down to move   Enter to select',
    })
    if (action === 'next') return 'next'
    if (action === 'quit' || action === 'back') return 'quit'
    if (action === 'install') {
      await withProgress('Installing dependencies', async () => installDependencies())
      continue
    }
  }
}

const STEP_DEPS = { index: 1, total: TOTAL_STEPS, label: 'Dependencies' }
async function stepDependencies(config) {
  for (;;) {
    const installed = ['server', 'app', 'staff', 'framework', 'framework/bridge/pg-runtime']
      .every(dir => existsSync(path.join(ROOT, dir, 'node_modules')))
    const libBuilt = existsSync(path.join(ROOT, 'framework/packages/bank-demo/lib/index.js'))
    if (installed && libBuilt) return 'next'
    const action = await choose({
      title: 'Dependencies',
      intro: ['Node modules and the compiled bank-demo package are required.'],
      step: STEP_DEPS,
      items: [
        { label: 'Install now', value: 'install', default: true },
        { label: 'Skip', value: 'next' },
        { label: 'Back', value: 'back' },
        { label: 'Quit', value: 'quit' },
      ],
      footer: [
        `${installed ? ok('OK  ') : bad('MISS')} node modules`,
        `${libBuilt ? ok('OK  ') : bad('MISS')} framework/packages/bank-demo/lib`,
      ],
      hint: 'Up/Down to move   Enter to select   Esc to go back',
    })
    if (action === 'install') { await withProgress('Installing dependencies', async () => installDependencies()); continue }
    return action
  }
}

const STEP_DB = { index: 2, total: TOTAL_STEPS, label: 'Database' }
async function stepDatabase(config) {
  for (;;) {
    const ready = Boolean(config.bankDatabaseUrl && config.bankDataKey && config.sessionDatabaseUrl && config.sessionDataKey)
    const action = await choose({
      title: 'Database',
      intro: ready
        ? ['Both databases are configured. Keys are generated, never typed.']
        : ['Two PostgreSQL connection strings are needed. Everything else is generated.'],
      step: STEP_DB,
      items: [
        // When everything is already configured the first button must move on,
        // not re-open the prompt: "Continue" that re-asks is a trap.
        ready
          ? { label: 'Continue', value: 'next', default: true }
          : { label: 'Set up now', value: 'edit', default: true },
        ...(ready ? [{ label: 'Edit settings', value: 'edit' }] : []),
        { label: 'Back', value: 'back' },
        { label: 'Quit', value: 'quit' },
      ],
      footer: [
        `${config.bankDatabaseUrl ? ok('OK  ') : bad('MISS')} bank DB   ${muted(maskUrl(config.bankDatabaseUrl))}`,
        `${config.sessionOwnerDatabaseUrl ? ok('OK  ') : warn('OPT ')} admin DB  ${muted(maskUrl(config.sessionOwnerDatabaseUrl))}`,
        `${config.sessionDatabaseUrl ? ok('OK  ') : bad('MISS')} session DB ${muted(maskUrl(config.sessionDatabaseUrl))}`,
        `${config.bankDataKey ? ok('OK  ') : bad('MISS')} bank data key`,
        `${config.sessionDataKey ? ok('OK  ') : bad('MISS')} session data key`,
      ],
      hint: 'Up/Down to move   Enter to select   Esc to go back',
    })
    if (action !== 'edit') return action

    // Guided entry: two URLs, then everything else is derived.
    const bankUrl = await askLine({
      title: 'Database 1/2',
      label: 'Bank database URL',
      hint: 'Application role connection string, e.g. postgresql://app:secret@127.0.0.1:5432/maneki_bank',
      current: config.bankDatabaseUrl,
    })
    if (bankUrl === 'quit' || bankUrl === 'back') return bankUrl === 'quit' ? 'quit' : 'back'
    if (bankUrl) config.bankDatabaseUrl = bankUrl

    const adminUrl = await askLine({
      title: 'Database 2/2',
      label: 'Admin (owner) connection string',
      hint: 'Used once to create the AI session role and schema. Leave empty to skip.',
      current: config.sessionOwnerDatabaseUrl,
    })
    if (adminUrl === 'quit') return 'quit'
    if (adminUrl && adminUrl !== 'back') config.sessionOwnerDatabaseUrl = adminUrl

    if (!config.bankDataKey) config.bankDataKey = newKey()
    if (!config.sessionDataKey) config.sessionDataKey = newKey()

    const notes = []
    if (config.sessionOwnerDatabaseUrl) {
      const role = await withProgress('Creating AI session role', async () => ensureSessionRole(config))
      if (role?.ok) {
        config.sessionDatabaseUrl = role.url
        notes.push(ok(`session role ${role.created ? 'created' : 'updated'} on ${role.database}`))
      } else {
        notes.push(bad(`session role was not created: ${role?.error ?? 'unknown error'}`))
        notes.push(warn('an existing session DB URL is kept as-is'))
      }
    }
    saveConfig(config)
    await notice({
      title: 'Configuration saved',
      intro: [CONFIG_PATH],
      lines: [
        ...notes,
        `${muted('bank DB   ')} ${maskUrl(config.bankDatabaseUrl)}`,
        `${muted('session DB')} ${maskUrl(config.sessionDatabaseUrl)}`,
        `${muted('data keys ')} generated`,
        '',
        ...wrap('Keys must match the database. A new key for an existing database makes its encrypted rows unreadable.', width() - 6).map(muted),
      ],
    })
  }
}

const STEP_SCHEMA = { index: 3, total: TOTAL_STEPS, label: 'Schema' }
async function stepBootstrap(config) {
  const action = await choose({
    title: 'Schema',
    intro: ['Create the bank schema and the AI session schema. Safe to re-run.'],
    step: STEP_SCHEMA,
    items: [
      { label: 'Bootstrap databases', value: 'run', default: true },
      { label: 'Skip', value: 'next' },
      { label: 'Back', value: 'back' },
      { label: 'Quit', value: 'quit' },
    ],
    hint: 'Up/Down to move   Enter to select   Esc to go back',
  })
  if (action !== 'run') return action
  await withProgress('Bootstrapping databases', async () => bootstrapDatabases(config, askLine))
  const failed = logs.filter(line => /failed/i.test(strip(line))).length
  const next = await choose({
    title: 'Schema',
    intro: [failed ? bad(`${failed} step(s) failed - see the log below`) : ok('Bootstrap finished')],
    items: [
      { label: 'Start services', value: 'next', default: !failed },
      { label: 'Retry', value: 'retry' },
      { label: 'Back', value: 'back' },
    ],
    footer: logs.slice(-14),
  })
  if (next === 'retry') return stepBootstrap(config)
  return next
}

const STEP_START = { index: 4, total: TOTAL_STEPS, label: 'Start' }
async function stepStart(config) {
  const action = await choose({
    title: 'Ready to start',
    intro: ['The bank API, three agents and the web client start together.'],
    step: STEP_START,
    items: [
      { label: 'Start all services', value: 'start', default: true },
      { label: 'Back', value: 'back' },
      { label: 'Quit', value: 'quit' },
    ],
    footer: [
      `${muted('bank API')}  http://127.0.0.1:8080`,
      `${muted('agents  ')}  :8788  :8789  :8790`,
      `${muted('web     ')}  http://127.0.0.1:5180/login`,
    ],
  })
  if (action !== 'start') return action
  await withProgress('Starting services', async () => startAll(config))
  return 'next'
}

/* ------------------------------------------------------------------ *
 * Dashboard
 * ------------------------------------------------------------------ */

async function dashboard(config) {
  await choose({
    title: 'Running',
    intro: [],
    items: [
      { label: 'Stop all services', value: 'stop' },
      { label: 'Restart', value: 'restart' },
      { label: 'Refresh status', value: 'refresh' },
      { label: 'Quit (leaves services running)', value: 'detach' },
    ],
    footer: await statusLines(config),
    hint: 'Up/Down to move   Enter to select',
  }).then(async action => {
    if (action === 'stop' || action === 'quit') { await stopAll(); return }
    if (action === 'detach') return
    if (action === 'restart') { await stopAll(); await withProgress('Restarting services', async () => startAll(config)); return dashboard(config) }
    if (action === 'refresh') return dashboard(config)
  })
}

async function statusLines(config) {
  const list = services(config)
  const lines = []
  for (const service of list) {
    const running = children.has(service.id)
    const listening = await checkPort(service.port)
    const state = listening ? ok('listening') : running ? warn('starting') : bad('stopped')
    lines.push(`${fit(service.label, 16)} ${muted(`:${service.port}`)}  ${state}`)
  }
  lines.push('', `${muted('Web  ')} http://127.0.0.1:5180/login`)
  lines.push(`${muted('Staff')} http://127.0.0.1:5180/staff/login`)
  const tail = logs.slice(-4)
  if (tail.length) lines.push('', muted('log'), ...tail)
  return lines
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */

async function main() {
  const config = loadConfig()
  altScreen(true)
  hideCursor(true)

  const start = await choose({
    title: 'Local full stack',
    intro: [
      'Runs the real backend, not mock data.',
      'Five guided steps, then the services start together.',
    ],
    items: [
      { label: 'Start setup', value: 'go', default: true },
      { label: 'Quit', value: 'quit' },
    ],
  })

  try {
    if (start === 'go') {
      const steps = [stepEnvironment, stepDependencies, stepDatabase, stepBootstrap, stepStart]
      let index = 0
      while (index < steps.length) {
        const result = await steps[index](config)
        if (result === 'quit') return
        if (result === 'back') { index = Math.max(0, index - 1); continue }
        index++
      }
      await dashboard(config)
    }
  } finally {
    await stopAll()
    hideCursor(false)
    altScreen(false)
    if (rl) { try { rl.close() } catch { /* already closed */ } }
    process.stdin.setRawMode?.(false)
    process.stdin.pause()
    process.stdin.unref?.()
  }
}

/**
 * Non-interactive mode for scripts and CI: run the checks and print plain text.
 * The TUI needs a TTY; this path does not, so it also works when the output is
 * piped into a log or another process.
 */
async function runCheckMode() {
  const config = loadConfig()
  const checks = await runEnvironmentCheck(config)
  const failed = checks.filter(([ok]) => !ok).length
  out(`Maneki-Neko local stack - environment check\n${rule('-')}\n`)
  for (const [ok, name, detail] of checks) out(`${ok ? 'OK  ' : 'FAIL'} ${pad(name, 34)} ${detail}\n`)
  out(`${rule('-')}\n${failed === 0 ? 'All checks passed.' : `${failed} check(s) failed.`}\n`)
  return failed === 0 ? 0 : 1
}

const argv = process.argv.slice(2)
if (argv.includes('--help') || argv.includes('-h')) {
  out(`Maneki-Neko local stack launcher\n\n  ./start.sh          (macOS / Linux)\n  start.cmd           (Windows)\n  node tools/start-tui.mjs --check    run checks and exit (no TTY needed)\n`)
  process.exit(0)
}
if (argv.includes('--check')) {
  runCheckMode().then(code => { process.exitCode = code }).catch(error => {
    console.error(`Check failed: ${error?.message ?? error}`)
    process.exitCode = 1
  })
} else {
main().catch(async error => {
  hideCursor(false)
  altScreen(false)
  console.error(`\nLauncher failed: ${error?.message ?? error}\n`)
  process.exitCode = 1
})
}
