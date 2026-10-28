import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { assertMaintenancePassword, PASSWORD_MAINTENANCE_ACTIONS, setCustomerMaintenancePassword } from './maintenance-passwords.mjs'
import { verifyPassword } from './passwords.mjs'

test('customer maintenance enforces the same password composition and byte bounds', () => {
  for (const value of ['Abcdefg!', 'Abcdefg。', 'Aa!' + 'x'.repeat(1021)]) {
    assert.doesNotThrow(() => assertMaintenancePassword('set-customer-password', value))
  }
  for (const value of ['Abcdef!', 'abcdefgh!', 'ABCDEFGH!', 'Abcdefgh', 'Abcdefg ', 'Aa!' + 'x'.repeat(1022), 'Abcdefg!\n']) {
    assert.throws(() => assertMaintenancePassword('set-customer-password', value), { code: 'INVALID_PASSWORD_FORMAT' })
  }
})

test('staff and payment maintenance retain their own credential formats', () => {
  assert.doesNotThrow(() => assertMaintenancePassword('set-staff-password', '123456789012'))
  assert.throws(() => assertMaintenancePassword('set-staff-password', 'Abcdefg!'), { code: 'INVALID_PASSWORD_FORMAT' })
  assert.doesNotThrow(() => assertMaintenancePassword('set-payment-password', '123456'))
  for (const value of ['12345', '1234567', '12345a', '１２３４５６']) {
    assert.throws(() => assertMaintenancePassword('set-payment-password', value), { code: 'INVALID_PASSWORD_FORMAT' })
  }
})

test('frozen accounts cannot reset payment credentials through maintenance', () => {
  for (const failures of [5, 6]) {
    const profile = { payPassword: 'existing-payment-hash', payPasswordFailures: failures }
    const before = structuredClone(profile)
    assert.throws(() => setCustomerMaintenancePassword(profile, 'set-payment-password', '654321'), { code: 'ACCOUNT_FROZEN' })
    assert.deepEqual(profile, before)
  }
})

test('customer login password maintenance preserves account freezing', () => {
  const profile = { passwordDigest: 'old-login-hash', payPassword: 'payment-hash', payPasswordFailures: 5 }
  setCustomerMaintenancePassword(profile, 'set-customer-password', 'Abcdefg!')
  assert.equal(verifyPassword('Abcdefg!', profile.passwordDigest), true)
  assert.equal(profile.payPasswordFailures, 5)
  assert.equal(profile.payPassword, 'payment-hash')
})

test('payment maintenance resets subthreshold failures only after setting a valid credential', () => {
  const profile = { passwordDigest: 'login-hash', payPassword: 'old-payment-hash', payPasswordFailures: 4 }
  setCustomerMaintenancePassword(profile, 'set-payment-password', '654321')
  assert.equal(verifyPassword('654321', profile.payPassword), true)
  assert.equal(profile.payPasswordFailures, 0)
  assert.equal(profile.passwordDigest, 'login-hash')
})

test('removed unlock action is rejected before any database connection', () => {
  assert.equal(PASSWORD_MAINTENANCE_ACTIONS.includes('unlock-payment'), false)
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./admin.mjs', import.meta.url)), 'unlock-payment', 'customer_test'], {
    encoding: 'utf8', timeout: 10_000, env: {},
  })
  assert.equal(result.error, undefined)
  assert.equal(result.status, 2)
  assert.deepEqual(JSON.parse(result.stderr), { ok: false, code: 'STAFF_UNFREEZE_REQUIRED' })
  assert.equal(result.stdout, '')
})
