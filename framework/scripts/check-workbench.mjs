import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { frameworkRoot } from './setup-workbench.mjs'
import { startWorkbench, workbenchEnvironment } from './start-workbench.mjs'

const baseDirectory = join(frameworkRoot, '.generated')
await mkdir(baseDirectory, { recursive: true })
const directory = await mkdtemp(join(baseDirectory, 'workbench-test-'))
const socket = createServer()
await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve))
const port = socket.address().port
await new Promise(resolve => socket.close(resolve))
let running, log = '', launchUrl, cookie
async function stop() {
  if (!running || running.child.exitCode !== null) return
  const { child } = running
  const exited = once(child, 'exit')
  if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
  else child.kill('SIGTERM')
  await exited
}
async function start() {
  launchUrl = undefined; cookie = undefined
  running = await startWorkbench({ directory, port, stdio: ['ignore', 'pipe', 'pipe'] })
  for (const stream of [running.child.stdout, running.child.stderr]) stream.on('data', value => {
    const text = value.toString()
    const found = text.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[A-Za-z0-9_-]+/)
    if (found) launchUrl = found[0]
    log = (log + text.replace(/token=[A-Za-z0-9_-]+/g, 'token=[redacted]')).slice(-24000)
  })
  const deadline = Date.now() + 120000
  while (Date.now() < deadline) {
    if (running.child.exitCode !== null) throw Error('Workbench exited during startup:\n' + log)
    try {
      if (launchUrl && (await fetch(running.url + '/api/workbench/tasks', { signal: AbortSignal.timeout(1000) })).status === 200) {
        const response = await fetch(launchUrl, { redirect: 'manual', signal: AbortSignal.timeout(1000) })
        assert.equal(response.status, 303)
        cookie = response.headers.get('set-cookie')?.split(';')[0]
        assert(cookie)
        return
      }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw Error('Workbench startup timed out:\n' + log)
}
async function api(path, body) {
  const response = await fetch(running.url + '/api/workbench' + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(5000) })
  const data = await response.json()
  assert(response.ok && data.ok, `${path}: ${response.status} ${JSON.stringify(data)}`)
  return data
}
try {
  const env = workbenchEnvironment(directory)
  assert(!Object.keys(env).some(key => /^(BANK_|LUCKYCAT_)|TOKEN|API_KEY|APIKEY|SECRET|PASSWORD/.test(key)))
  await start()
  const html = await fetch(running.url, { headers: { cookie } }).then(response => { assert.equal(response.status, 200); return response.text() })
  assert(html.includes('personal-workbench'), 'Official web bootstrap must include the installed client plugin')
  assert(!html.includes('@luckycat/dsh-bank-demo'))
  console.log('PASS official DSH Web loads pinned workbench host and client in an independent profile')
  const task = (await api('/tasks', { title: '独立提醒回归', typeCode: 'personal', priorityCode: 'p0', dueAt: new Date(Date.now() - 60000).toISOString() })).task
  const reminder = await api(`/tasks/${task.id}/reminders`, { offsetMinutes: 0, methodCode: 'browser' })
  await api('/reminders/policy', { enabled: true })
  assert((await api('/reminders/due')).reminders.some(item => item.reminderId === reminder.reminderId))
  console.log('PASS task creation, persisted reminder policy and due reminder API')
  const channel = await api('/reminders/channel')
  assert.equal(channel.status.installed, false)
  assert.equal(channel.status.configured, false)
  await stop()
  await start()
  assert((await api('/tasks')).tasks.some(item => item.id === task.id))
  assert((await api('/reminders/due')).reminders.some(item => item.reminderId === reminder.reminderId))
  await api(`/reminders/${reminder.reminderId}/ack`, {})
  assert(!(await api('/reminders/due')).reminders.some(item => item.reminderId === reminder.reminderId))
  console.log('PASS restart preserves tasks/reminders; acknowledgment stops repeats; IM remains unconfigured')
  const profile = JSON.parse(await readFile(join(running.paths.profile, 'package.json'), 'utf8'))
  assert.deepEqual(profile.dsh.profile.bundles, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@dely0/dsh-personal-workbench'])
  console.log('ALL PASS — no bank database, external message or model request used')
} finally {
  await stop()
  await rm(directory, { recursive: true, force: true, maxRetries: 4, retryDelay: 200 })
}
