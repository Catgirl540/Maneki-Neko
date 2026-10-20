/** Local disposable PostgreSQL test setup. Never accepts a remote database URL. */
import { spawnSync, spawn } from 'node:child_process'
import { mkdir, readFile, writeFile, unlink, readdir } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { resolve, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const directory = join(root, '.generated', 'local-postgres')
const container = 'maneki-local-tests-pg16'
const label = 'io.maneki.local-tests'
const databases = {
  BANK_TEST_DATABASE_URL: 'maneki_bank_test',
  BANK_CONNECT_TEST_DATABASE_URL: 'maneki_connector_test',
  BANK_HTTP_TEST_DATABASE_URL: 'maneki_http_test',
  LUCKYCAT_SESSION_TEST_DATABASE_URL: 'maneki_ai_sessions_test',
}
function docker(args, allowFailure = false) {
  const r = spawnSync('docker', args, { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30_000 })
  if (r.error || (!allowFailure && r.status !== 0)) throw Error(`Docker ${args[0]} failed; check Docker Desktop and local execution permissions.`)
  return r
}
export async function localTestEnvironment() {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const configPath = join(directory, 'config.json')
  let config
  try { config = JSON.parse(await readFile(configPath, 'utf8')) }
  catch (error) {
    if (error.code !== 'ENOENT') throw error
    config = { container, port: 55432, password: randomBytes(32).toString('hex') }
    await writeFile(configPath, JSON.stringify(config), { mode: 0o600, flag: 'wx' })
  }
  if (config.container !== container || config.port !== 55432 || !/^[a-f0-9]{64}$/.test(config.password)) throw Error('Unexpected local test configuration; preserve it and inspect before continuing.')
  const inspected = docker(['inspect', container], true)
  if (inspected.status === 0) {
    const [state] = JSON.parse(inspected.stdout)
    if (state.Config.Labels?.[label] !== '1' || state.Config.Image !== 'postgres:16-alpine') throw Error('Refusing to reuse a container owned by another purpose.')
    const port = state.HostConfig.PortBindings?.['5432/tcp']?.[0]
    if (port?.HostIp !== '127.0.0.1' || port?.HostPort !== '55432') throw Error('Unexpected local test port mapping.')
    if (!state.State.Running) docker(['start', container])
  } else {
    const envFile = join(directory, 'postgres.env')
    await writeFile(envFile, `POSTGRES_USER=postgres\nPOSTGRES_PASSWORD=${config.password}\nPOSTGRES_DB=postgres\n`, { mode: 0o600, flag: 'wx' })
    try {
      docker(['run', '-d', '--name', container, '--label', `${label}=1`, '--env-file', envFile,
        '-p', '127.0.0.1:55432:5432', '--memory', '768m', '--cpus', '1', 'postgres:16-alpine'])
    } finally { await unlink(envFile) }
  }
  let ready = false
  for (let i = 0; i < 40; i++) {
    if (docker(['exec', container, 'pg_isready', '-U', 'postgres', '-d', 'postgres'], true).status === 0) { ready = true; break }
    await new Promise(done => setTimeout(done, 500))
  }
  if (!ready) throw Error('Local PostgreSQL did not become ready.')
  const version = docker(['exec', container, 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-Atc', 'SHOW server_version_num']).stdout.trim()
  if (!(Number(version) >= 160000 && Number(version) < 170000)) throw Error('Expected PostgreSQL 16 for local integration.')
  const existing = new Set(docker(['exec', container, 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-Atc', 'SELECT datname FROM pg_database']).stdout.trim().split(/\r?\n/))
  for (const name of Object.values(databases)) if (!existing.has(name)) docker(['exec', container, 'createdb', '-U', 'postgres', name])
  const env = { ...process.env }
  // Local fixtures must not inherit model credentials, robot switches or real bank connections.
  for (const name of Object.keys(env)) if (/TOKEN|API_KEY|APIKEY|ACCESS_KEY|SECRET|PASSWORD/.test(name)
      || ['BANK_DATABASE_URL', 'BANK_DATA_KEY', 'LUCKYCAT_SESSION_DATABASE_URL', 'LUCKYCAT_SESSION_DATA_KEY', 'LUCKYCAT_BANK_URL'].includes(name)
      || name.startsWith('LUCKYCAT_IM_')) delete env[name]
  env.LUCKYCAT_PG_MODULE_PATH = join(root, 'server', 'node_modules', 'pg')
  // All four destructive fixture connections are explicitly pinned to this local container.
  for (const [key, name] of Object.entries(databases)) env[key] = `postgresql://postgres:${config.password}@127.0.0.1:55432/${name}`
  return env
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const mode = process.argv[2] ?? 'integration'
  if (!['setup', 'integration', 'server', 'agent'].includes(mode)) throw Error('Usage: node tools/local-test-env.mjs [setup|integration|server|agent]')
  const extra = process.argv.slice(3)
  if (extra.length && !(extra.length === 1 && ((mode === 'server' && extra[0].startsWith('--test-name-pattern=')) || (mode === 'agent' && ['--browser', '--browser-only'].includes(extra[0]))))) throw Error('Optional flags: server --test-name-pattern=... or agent --browser[-only]')
  const env = await localTestEnvironment()
  console.log('Local PostgreSQL 16 ready: four disposable test databases on 127.0.0.1:55432; credentials kept in ignored local configuration.')
  if (mode !== 'setup') {
    const lockPath = join(directory, 'run.lock')
    try { await writeFile(lockPath, JSON.stringify({ pid: process.pid, mode }), { mode: 0o600, flag: 'wx' }) }
    catch (error) {
      if (error.code === 'EEXIST') throw Error('Another local test run owns these disposable databases. Wait for it to finish; inspect run.lock and its PID before removing a stale lock.')
      throw error
    }
    const args = mode === 'integration' ? ['tools/check-postgresql-integration.mjs'] : mode === 'agent' ? ['tools/check-agent-http.mjs', ...extra]
      : ['--test', '--test-concurrency=1', ...extra, ...(await readdir(join(root, 'server'))).filter(n => n.endsWith('.test.mjs')).sort().map(n => `server/${n}`)]
    try {
      process.exitCode = await new Promise(done => {
        const child = spawn(process.execPath, args, { cwd: root, env, stdio: 'inherit', windowsHide: true })
        child.on('error', () => { console.error('Unable to start local test runner.'); done(1) })
        child.on('exit', code => done(code ?? 1))
      })
    } finally { await unlink(lockPath) }
  }
}
