/** Run via run-linux.sh: every process, including PostgreSQL, shares one cgroup. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { readFile, writeFile, mkdir, statfs } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createPgClient } from '../../server/pg-client.mjs'
import { reconcileDatabase } from '../../server/database.mjs'

const root = resolve(import.meta.dirname, '../..'), disk = '/var/tmp/maneki-backend-memory-lab/disk'
const output = join(root, '.generated/backend-memory-lab'), mode = process.argv[2] ?? 'fixed'
assert(['fixed', 'before'].includes(mode))
const seed = JSON.parse(await readFile(join(output, 'seed.json'), 'utf8'))
const url = name => `postgresql://postgres@127.0.0.1:55433/${name}`
const demoUrl = url(mode === 'before' ? 'maneki_oom_before_test' : 'maneki_oom_test'), liveUrl = url('maneki_oom_live_test')
const cgroup = '/sys/fs/cgroup' + (await readFile('/proc/self/cgroup', 'utf8')).trim().split('::')[1]
const baseEnv = { PATH: '/opt/maneki-oom-node/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', HOME: '/root', LANG: 'C.UTF-8', NODE_ENV: 'test', NODE_OPTIONS: '--max-old-space-size=256', BANK_AUTO_MIGRATE: 'false', BANK_DATA_KEY: Buffer.alloc(32, 18).toString('base64'), BANK_CSR_PASSWORD: 'lab-csr-password', BANK_SUPERVISOR_PASSWORD: 'lab-supervisor-password', BANK_OPS_PASSWORD: 'lab-ops-password', BANK_WEBHOOK_ENABLED: 'false', LUCKYCAT_SESSION_DATA_KEY: Buffer.alloc(32, 27).toString('base64'), LUCKYCAT_PG_MODULE_PATH: join(root, 'server/node_modules/pg') }
baseEnv.NODE_PATH = '/var/tmp/maneki-backend-memory-lab/linux-deps/node_modules'
const children = [], peaks = new Map(), results = { mode, dataset: { customers: seed.customers, transactions: seed.totalTransactions, logicalBytes: seed.logicalBytes }, startedAt: new Date().toISOString(), phases: [], errors: [] }
// Reserve space for the VPS operating system and background services. All tested
// application processes, PostgreSQL and this reserve still share the 4 GiB cap.
const systemReserve = Buffer.alloc(512 * 1024 * 1024, 1)
results.systemReserveBytes = systemReserve.byteLength
results.cgroup = cgroup
let provider, sampler, stopping = false
await mkdir(join(disk, 'agents'), { recursive: true })
await mkdir(join(disk, 'backups'), { recursive: true })
const log = message => console.log(`${new Date().toISOString()} ${message}`)
function start(name, command, args, env = {}, cwd = root) {
  const stream = createWriteStream(join(output, `${mode}-${name}.log`), { flags: 'w' })
  const child = spawn(command, args, { cwd, env: { ...baseEnv, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.pipe(stream); child.stderr.pipe(stream)
  const record = { name, child, stream, expected: false }; children.push(record)
  child.once('exit', (code, signal) => { record.exit = { code, signal }; if (!stopping && !record.expected) results.errors.push({ process: name, code, signal }) })
  return record
}
async function stop(record) {
  record.expected = true
  if (record.child.exitCode !== null || record.child.signalCode !== null) return
  record.child.kill('SIGTERM')
  await Promise.race([new Promise(done => record.child.once('exit', done)), delay(8000)])
  if (record.child.exitCode === null && record.child.signalCode === null) record.child.kill('SIGKILL')
}
async function request(base, path, token, body, timeout = 15000) {
  const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', signal: AbortSignal.timeout(timeout), headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const text = await response.text()
  let data; try { data = JSON.parse(text) } catch { data = text }
  return { status: response.status, data }
}
async function ready(record, base, path = '/health', token, timeout = 45000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (record.exit) throw new Error(`${record.name} exited: ${JSON.stringify(record.exit)}`)
    try { if ((await request(base, path, token, undefined, 1500)).status === 200) return } catch {}
    await delay(100)
  }
  throw new Error(`${record.name} readiness timed out`)
}
async function sample() {
  try {
    const pids = (await readFile(join(cgroup, 'cgroup.procs'), 'utf8')).trim().split(/\s+/)
    for (const pid of pids) {
      try {
        const status = await readFile(`/proc/${pid}/status`, 'utf8'), rss = Number(/^VmRSS:\s+(\d+)/m.exec(status)?.[1] ?? 0) * 1024
        const command = (await readFile(`/proc/${pid}/cmdline`, 'utf8')).replaceAll('\0', ' ')
        const previous = peaks.get(pid)
        if (!previous || rss > previous.rss) peaks.set(pid, { pid: Number(pid), rss, command })
      } catch {}
    }
  } catch {}
}
function bank(name, database, port, live = false) {
  const cwd = mode === 'before' ? join(output, 'before') : root
  return start(name, process.execPath, ['--max-old-space-size=512', 'server/index.mjs'], { BANK_DATABASE_URL: database, BANK_HOST: '127.0.0.1', BANK_PORT: String(port), BANK_INTEGRATION_MODE: live ? 'live' : 'sandbox', BANK_ALLOW_DEMO_SEED: 'false', NODE_ENV: live ? 'production' : 'test', BANK_BACKUP_DIR: join(disk, 'backups', name) }, cwd)
}
async function load(concurrency, durationMs, name) {
  const samples = [], deadline = Date.now() + durationMs
  let failures = 0, count = 0
  await Promise.all(Array.from({ length: concurrency }, async (_, worker) => {
    while (Date.now() < deadline) {
      const customer = seed.tokens[(count++ + worker) % seed.tokens.length], start = performance.now()
      try {
        const path = count % 2 ? '/api/accounts' : '/api/accounts/acc_lab/transactions?page=1&size=20'
        const result = await request('http://127.0.0.1:6080', path, customer.token)
        if (result.status !== 200) failures++
      } catch { failures++ }
      samples.push(performance.now() - start)
    }
  }))
  samples.sort((a, b) => a - b)
  const phase = { name, concurrency, durationMs, requests: samples.length, failures, p50Ms: samples[Math.floor(samples.length * .5)], p95Ms: samples[Math.floor(samples.length * .95)], maxMs: samples.at(-1) }
  results.phases.push(phase); log(JSON.stringify(phase)); assert.equal(failures, 0)
}
try {
  start('postgres', '/usr/sbin/runuser', ['-u', 'postgres', '--', '/usr/lib/postgresql/16/bin/postgres', '-D', join(disk, 'pg')])
  const probe = createPgClient(demoUrl)
  for (let n = 0; ; n++) { try { await probe.query('SELECT 1'); break } catch (error) { if (n > 100) throw error; await delay(100) } }
  await probe.close()
  sampler = setInterval(() => { void sample() }, 250)
  const bootAt = performance.now(), demo = bank('bank-demo', demoUrl, 6081)
  await ready(demo, 'http://127.0.0.1:6081', '/health', undefined, mode === 'before' ? 120000 : 45000)
  results.bankStartupMs = performance.now() - bootAt
  log(`bank ready in ${Math.round(results.bankStartupMs)} ms`)
  if (mode === 'before') {
    const start = performance.now()
    const read = await request('http://127.0.0.1:6081', '/api/accounts', seed.tokens[0].token, undefined, 60000)
    results.firstRead = { status: read.status, ms: performance.now() - start }
    await delay(2000)
    results.ok = read.status === 200 && results.errors.length === 0
  } else {
    const live = bank('bank-live', liveUrl, 6082, true)
    await ready(live, 'http://127.0.0.1:6082')
    const nginxConfig = join(disk, 'nginx.conf')
    await writeFile(nginxConfig, `daemon off; pid ${disk}/nginx.pid; error_log ${disk}/logs/nginx-error.log; events { worker_connections 256; } http { access_log off; server { listen 127.0.0.1:6080; location / { proxy_pass http://127.0.0.1:6081; } } }`)
    const nginx = start('nginx', '/usr/sbin/nginx', ['-c', nginxConfig])
    await ready(nginx, 'http://127.0.0.1:6080')
    const patch = join(disk, 'provider.yml')
    await writeFile(patch, `- id: llm-pi-ai\n  config:\n    providers:\n      test:\n        apiKeyEnv: LUCKYCAT_TEST_KEY\n        api: openai-completions\n        baseURL: http://127.0.0.1:6087/v1\n        models:\n          - id: luckycat-test\n            name: Local memory fixture\n            input: [text, image]\n            contextWindow: 128000\n- id: luckycat-rag\n  disabled: true\n- id: luckycat-embedding\n  disabled: true\n`)
    provider = createServer(async (req, res) => {
      for await (const _chunk of req) {} // Consume the request without retaining model history.
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      const send = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ id: 'local-memory-fixture', object: 'chat.completion.chunk', created: 1, model: 'luckycat-test', choices: [{ index: 0, delta, finish_reason }] })}\n\n`)
      send({ role: 'assistant' })
      for (let i = 0; i < 24; i++) { send({ content: '本地容量测试文本。'.repeat(80) }); await delay(45) }
      send({}, 'stop'); res.end('data: [DONE]\n\n')
    })
    await new Promise(done => provider.listen(6087, '127.0.0.1', done))
    const roles = [
      { name: 'customer', port: 6083, file: 'demo-server', database: demoUrl, token: seed.tokens[0].token },
      { name: 'live', port: 6084, file: 'demo-server', database: liveUrl, token: seed.tokens[0].token },
      { name: 'staff', port: 6085, file: 'staff-server', database: liveUrl, staff: '王小明', password: 'lab-csr-password' },
      { name: 'ops', port: 6086, file: 'ops-server', database: liveUrl, staff: '运维人员', password: 'lab-ops-password' },
    ]
    for (const role of roles) {
      if (role.staff) {
        const login = await request('http://127.0.0.1:6082', '/staff-api/login', undefined, { name: role.staff, password: role.password })
        assert.equal(login.status, 200); role.token = login.data.token
      }
      role.base = `http://127.0.0.1:${role.port}`
      role.env = { LUCKYCAT_DEMO_PORT: String(role.port), LUCKYCAT_BANK_URL: role.name === 'customer' ? 'http://127.0.0.1:6081' : 'http://127.0.0.1:6082', LUCKYCAT_SESSION_DATABASE_URL: role.database, LUCKYCAT_PROVIDER: 'test', LUCKYCAT_MODEL: 'luckycat-test', LUCKYCAT_TEST_KEY: 'local-fixture-only', LUCKYCAT_PATCHES: patch, LUCKYCAT_DISABLE_VOICE: '1', LUCKYCAT_SESSION_DIR: join(disk, 'agents', role.name) }
      role.process = start(`agent-${role.name}`, process.execPath, [`framework/bridge/${role.file}.mjs`], role.env)
      await ready(role.process, role.base, '/agent-api/health', role.token)
      role.sessions = []
      for (let i = 0; i < 30; i++) {
        const session = await request(role.base, '/agent-api/sessions', role.token, {})
        assert.equal(session.status, 200); role.sessions.push(session.data.sessionId)
      }
    }
    log('Two banks, four agents and PostgreSQL/nginx ready; 120 sessions created')
    const turnAt = performance.now()
    await Promise.all(roles.flatMap(role => role.sessions.slice(0, 5).map(async session => {
      const answer = await request(role.base, `/agent-api/sessions/${session}/messages`, role.token, { text: '请回复一段本地容量测试文本，不调用任何工具。' })
      assert.equal(answer.status, 202)
      for (let i = 0; i < 600; i++) {
        const batch = await request(role.base, `/agent-api/sessions/${session}/events?after=0`, role.token)
        assert.equal(batch.status, 200)
        assert(!batch.data.events.some(event => event.type === 'error'), JSON.stringify(batch.data.events.filter(event => event.type === 'error')))
        if (batch.data.events.some(event => event.type === 'assistant') && batch.data.events.some(event => event.type === 'status' && event.status === 'idle')) return
        await delay(100)
      }
      throw new Error(`Agent turn timed out: ${role.name}`)
    })))
    results.agentTurns = { sessions: 120, concurrentTurns: 20, completedTurns: 20, ms: performance.now() - turnAt }
    log('20 concurrent turns completed through four real DSH subprocesses')
    await load(1, 15000, 'single')
    await load(5, 20000, 'five')
    await load(20, 30000, 'twenty')
    const backup = start('backup', '/usr/bin/pg_dump', ['-h', '127.0.0.1', '-p', '55433', '-U', 'postgres', '-Fc', '-f', join(disk, 'backups', 'memory-lab.dump'), 'maneki_oom_test'])
    backup.expected = true
    await load(5, Number(process.env.LAB_SOAK_MS ?? 120000), 'soak-with-backup')
    assert.equal(backup.child.exitCode, 0)
    for (const database of [demoUrl, liveUrl]) {
      const db = createPgClient(database)
      assert.equal((await reconcileDatabase(db)).ok, true)
      await db.close()
    }
    await stop(demo)
    const restarted = bank('bank-demo-restart', demoUrl, 6081)
    await ready(restarted, 'http://127.0.0.1:6081')
    assert.equal((await request('http://127.0.0.1:6081', '/api/accounts', seed.tokens[0].token)).status, 200)
    await stop(roles[0].process)
    roles[0].process = start('agent-customer-restart', process.execPath, ['framework/bridge/demo-server.mjs'], roles[0].env)
    await ready(roles[0].process, roles[0].base, '/agent-api/health', roles[0].token)
    const restored = await request(roles[0].base, `/agent-api/sessions/${roles[0].sessions[0]}/events?after=0`, roles[0].token)
    assert.equal(restored.status, 200)
    assert(restored.data.events.some(event => event.type === 'assistant'))
    results.restartAndReconciliation = 'passed'
    results.ok = results.errors.length === 0
  }
} catch (error) {
  results.ok = false; results.failure = error.stack; log(String(error))
} finally {
  clearInterval(sampler); await sample()
  for (const file of ['memory.max', 'memory.peak', 'memory.swap.max', 'memory.events', 'cpu.max', 'cpuset.cpus.effective']) {
    try { (results.limits ??= {})[file] = (await readFile(join(cgroup, file), 'utf8')).trim() } catch {}
  }
  results.processPeaks = [...peaks.values()].sort((a, b) => b.rss - a.rss)
  const filesystem = await statfs(disk)
  results.disk = { imageBytes: 40 * 1024 ** 3, filesystemBytes: filesystem.blocks * filesystem.bsize, usedBytes: (filesystem.blocks - filesystem.bfree) * filesystem.bsize }
  results.finishedAt = new Date().toISOString()
  await writeFile(join(output, `${mode}-results.json`), JSON.stringify(results, null, 2))
  stopping = true
  for (const record of children.reverse()) await stop(record)
  provider?.closeAllConnections(); provider?.close()
  log(JSON.stringify({ mode, ok: results.ok, failure: results.failure?.split('\n')[0], peakBytes: results.limits?.['memory.peak'], errors: results.errors }))
}
if (!results.ok) process.exitCode = 1
