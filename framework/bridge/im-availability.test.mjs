import test from 'node:test'
import assert from 'node:assert/strict'
import { imDisabled } from './im-availability.mjs'

test('disabled IM is a feature state, not an unknown route', () => {
  const staff = imDisabled('staff')
  assert.equal(staff.status, 503)
  assert.equal(staff.body.code, 'IM_DISABLED')
  assert.match(staff.body.error, /员工微信 IM 尚未启用/)
  const customer = imDisabled('customer')
  assert.equal(customer.status, 503)
  assert.equal(customer.body.code, 'IM_DISABLED')
  assert.match(customer.body.error, /尚未启用/)
  assert.doesNotMatch(customer.body.error, /agent-api/)
})
