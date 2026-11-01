/** Real Android HTTP calls against the disposable local PostgreSQL fixture. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { writeFile, unlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { localTestEnvironment } from './local-test-env.mjs'
await import('./check-android-catalog.mjs')
const root = resolve(import.meta.dirname, '..')
const adb = process.env.MANEKI_ADB ?? '/home/bigguga/Android/Sdk/platform-tools/adb'
const serial = process.argv[2] ?? 'emulator-5554'
assert(/^emulator-\d+$/.test(serial), 'Use a disposable local emulator only')
const env = await localTestEnvironment()
for (const name of Object.keys(process.env)) if (!(name in env)) delete process.env[name]
Object.assign(process.env, env)
const lock = join(root, '.generated/local-postgres/run.lock')
await writeFile(lock, JSON.stringify({ pid: process.pid, mode: 'android-parity' }), { flag: 'wx', mode: 0o600 })
let app, port, configured = false
const run = (args, options = {}) => execFileSync(adb, ['-s', serial, ...args], { encoding: 'utf8', timeout: 180000, ...options })
try {
  const { fixture, login, ok, reconcile } = await import('../server/testing/http-fixture.mjs')
  app = await fixture({ reviewThreshold: 100000000, holdSeconds: 300 })
  const sender = await login(app, '13800138000'), recipient = await login(app, '13600136000')
  await app.editCustomer(sender.user.id, profile => {
    profile.autoDebits = profile.autoDebits.filter(item => item.merchant !== '网易云音乐')
    profile.wealthAccount.opened = true
    profile.wealthAccount.accountNo = 'TEST-ANDROID-WEALTH'
    profile.wealthAccount.settlementAccountId = sender.accounts[0].id
    profile.riskAssessment = { done: true, level: 'C3', score: 60, assessedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 365 * 86400000).toISOString(), expired: false }
  })
  // Give pagination a real second page; all entries pass through the real posting API.
  for (let i = 0; i < 32; i++) ok(await app.call(`/api/accounts/${sender.accounts[0].id}/deposit`, { method: 'POST', token: sender.token, body: { amount: 100, channel: 'bank' } }))
  port = new URL(app.base).port
  run(['reverse', `tcp:${port}`, `tcp:${port}`])
  run(['shell', 'run-as', 'com.moneymeow.bank', 'mkdir', '-p', 'files'])
  run(['shell', 'run-as', 'com.moneymeow.bank', 'tee', 'files/parity-fixture.json'], { input: JSON.stringify({ baseUrl: app.base, sender: { token: sender.token, name: sender.user.name, phone: sender.phone }, recipient: { token: recipient.token, name: recipient.user.name, phone: recipient.phone } }) })
  configured = true
  const output = run(['shell', 'am', 'instrument', '-w', '-e', 'class', 'com.moneymeow.bank.AndroidParityTest', 'com.moneymeow.bank.test/androidx.test.runner.AndroidJUnitRunner'])
  console.log(output)
  assert.match(output, /OK \(1 test\)/, 'Android parity instrumentation did not pass')
  for (const name of ['plans', 'report', 'budgets', 'savings', 'spend', 'aa', 'aapay', 'detail', 'membership', 'delivery', 'transfers', 'fps-amount']) {
    const bytes = run(['exec-out', 'run-as', 'com.moneymeow.bank', 'cat', `files/parity-${name}.png`], { encoding: null, maxBuffer: 10000000 })
    await writeFile(`/tmp/maneki-parity-${name}.png`, bytes)
  }
  await reconcile(app)
  console.log('PASS Android → local HTTP → PostgreSQL: cross-currency/FPS transfers, scheduled/AA operations, savings, investment plans, birthday reservations, merchant subscription, support, budgets, pagination and CSV; reconciliation balanced.')
} finally {
  if (configured) run(['shell', 'run-as', 'com.moneymeow.bank', 'rm', '-f', 'files/parity-fixture.json', 'files/parity-plans.png', 'files/parity-report.png', 'files/parity-budgets.png', 'files/parity-savings.png', 'files/parity-spend.png', 'files/parity-aa.png', 'files/parity-aapay.png', 'files/parity-detail.png', 'files/parity-membership.png', 'files/parity-delivery.png', 'files/parity-transfers.png', 'files/parity-fps-amount.png'])
  if (port) run(['reverse', '--remove', `tcp:${port}`])
  if (app) await app.close()
  await unlink(lock)
}
