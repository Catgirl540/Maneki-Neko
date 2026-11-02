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
 * Screens
 * ------------------------------------------------------------------ */

function header(config) {
  const lines = [
    rule('='),
    bold('  Maneki-Neko  -  local full stack'),
    dim('  bank API + 3 agents + web client (real backend, no mock)'),
    rule('-'),
    `  Node ${process.versions.node}   ${process.platform}   ` +
      (config.bankDatabaseUrl ? green('DB configured') : yellow('DB not configured')),
    rule('-'),
  ]
  return lines.join('\n')
}

const MENU = [
  ['1', 'Environment check'],
  ['2', 'Install dependencies'],
  ['3', 'Configure database'],
  ['4', 'Bootstrap databases'],
  ['5', 'Start all services'],
  ['6', 'Stop all services'],
  ['7', 'Show status'],
  ['q', 'Quit'],
]

/**
 * Menu plus a live log tail.
 *
 * The tail matters: start/stop only append to the log buffer, so without it
 * pressing "Start all services" appears to do nothing at all.
 */
function renderMenu(config, message) {
  clear()
  out(header(config) + '\n\n')
  for (const [key, label] of MENU) out(`   ${cyan(key)}  ${label}\n`)
  out('\n' + rule('-') + '\n')
  const running = [...children.values()].map(({ service }) => service.label)
  out(`  Running: ${running.length ? green(running.join(', ')) : dim('none')}\n`)
  if (message) out(`  ${message}\n`)

  const tail = logs.slice(-8)
  out('\n' + dim('  Log') + '\n')
  if (tail.length === 0) out(dim('  (empty)\n'))
  else for (const line of tail) out(`  ${line.slice(0, WIDTH - 2)}\n`)

  out(`\n  ${dim('Press a key.')}\n`)
}

/* ------------------------------------------------------------------ *
 * Key handling
 * ------------------------------------------------------------------ */

function waitForKey() {
  return new Promise(resolve => {
    process.stdin.setRawMode?.(true)
    process.stdin.resume()
    // stdin can end (piped input, closed terminal). Without this the promise
    // never settles and the launcher looks hung instead of exiting.
    const finish = key => {
      process.stdin.removeListener('data', onData)
      process.stdin.removeListener('end', onEnd)
      resolve(key)
    }
    const onData = buf => finish(buf.toString('utf8') === '\x03' ? 'q' : buf.toString('utf8'))
    const onEnd = () => finish('q')
    process.stdin.on('data', onData)
    process.stdin.once('end', onEnd)
  })
}

/**
 * Draw a result screen and wait for a key.
 *
 * Waiting inside this function (instead of letting the menu loop handle it)
 * is what makes the screen readable at all: without it the loop immediately
 * redraws the menu and the output is cleared before anyone can see it.
 */
async function showScreen(title, lines, message) {
  clear()
  out(rule('=') + '\n' + bold(`  ${title}`) + '\n' + rule('-') + '\n\n')
  for (const line of lines) out(`  ${line}\n`)
  if (message) out(`\n  ${message}\n`)
  out('\n' + rule('-') + '\n' + dim('  Press any key to return.') + '\n')
  await waitForKey()
}

/* ------------------------------------------------------------------ *
 * Main loop
 * ------------------------------------------------------------------ */

async function main() {
  let config = loadConfig()
  altScreen(true)
  hideCursor(true)
  let message = config.bankDatabaseUrl
    ? green('Configuration found in .start.local.json')
    : yellow('No configuration yet - choose [3] to set the database URLs and keys')

  try {
    for (;;) {
      renderMenu(config, message)
      message = ''
      const key = await waitForKey()

      if (key === 'q' || key === '\x03') break

      if (key === '1') {
        const checks = await runEnvironmentCheck(config)
        await showScreen('Environment check', checks.map(([ok, name, detail]) =>
          `${ok ? green('OK  ') : red('FAIL')} ${pad(name, 34)} ${dim(detail)}`))
      } else if (key === '2') {
        message = yellow('Installing dependencies...')
        renderMenu(config, message)
        const ok = await installDependencies()
        await showScreen('Install dependencies', logs.slice(-24))
        message = ok ? green('Dependencies installed.') : red('Installation failed - see log above.')
      } else if (key === '3') {
        hideCursor(false)
        clear()
        out(rule('=') + '\n' + bold('  Configure database') + '\n' + rule('-') + '\n')
        out(dim('\n  Input is hidden for secrets. Press Enter to keep the current value.\n'))
        for (const [field, label] of CONFIG_KEYS) {
          const current = config[field] ?? ''
          const entered = await promptLine(label, current)
          if (entered) config[field] = entered
        }
        // Generate the two data keys when they are still empty: they must be
        // 32 bytes of canonical base64, and only for a brand-new empty database.
        if (!config.bankDataKey) config.bankDataKey = newKey()
        if (!config.sessionDataKey) config.sessionDataKey = newKey()
        // With an admin connection string we can create the session role and
        // derive its URL ourselves, so nobody has to invent a password or paste
        // a second connection string.
        const roleNote = []
        if (config.sessionOwnerDatabaseUrl) {
          const role = ensureSessionRole(config)
          if (role?.ok) {
            config.sessionDatabaseUrl = role.url
            roleNote.push(green(`session role ${role.created ? 'created' : 'updated'} on ${role.database}`))
          } else {
            roleNote.push(red(`session role was not created: ${role?.error ?? 'unknown error'}`))
            roleNote.push(yellow('set the session DB URL by hand if it already exists'))
          }
        }

        saveConfig(config)
        hideCursor(true)
        await showScreen('Saved', [
          `file: ${CONFIG_PATH}`,
          `bank DB:    ${maskUrl(config.bankDatabaseUrl)}`,
          `session DB: ${maskUrl(config.sessionDatabaseUrl)}`,
          `bank key:   ${mask(config.bankDataKey)}`,
          `session key:${mask(config.sessionDataKey)}`,
          '',
          ...roleNote,
          '',
          yellow('Data keys must match the database. Generating a new one for an'),
          yellow('existing database makes its encrypted rows unreadable.'),
        ])
        message = green('Configuration saved.')
      } else if (key === '4') {
        message = yellow('Bootstrapping databases...')
        renderMenu(config, message)
        const ok = await bootstrapDatabases(config, promptLine)
        await showScreen('Bootstrap databases', logs.slice(-20))
        message = ok ? green('Bootstrap finished.') : red('Bootstrap failed - see log above.')
      } else if (key === '5') {
        message = yellow('Starting services...')
        renderMenu(config, message)
        await startAll(config)
        message = green('Start requested. Press [7] for status, [6] to stop.')
      } else if (key === '6') {
        await stopAll()
        message = green('All services stopped.')
      } else if (key === '7') {
        const list = services(config)
        const lines = []
        for (const service of list) {
          const running = children.has(service.id)
          const listening = await checkPort(service.port)
          const state = listening ? green('listening') : running ? yellow('starting') : dim('stopped')
          lines.push(`${pad(service.label, 18)} :${service.port}   ${state}`)
        }
        lines.push('', dim('Web:    http://127.0.0.1:5180/login'), dim('Staff:  http://127.0.0.1:5180/staff/login'))
        await showScreen('Status', lines)
      }
    }
  } finally {
    await stopAll()
    hideCursor(false)
    altScreen(false)
    if (rl) { try { rl.close() } catch { /* already closed */ } }
    // waitForKey resumes stdin, which keeps a handle open and the process
    // alive after the menu returns. Release it so quitting actually exits.
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
