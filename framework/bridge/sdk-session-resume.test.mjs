import test from 'node:test'
import assert from 'node:assert/strict'
import { cancelSession } from './sdk-session-resume.mjs'

test('private stdio cancellation requires its credential and targets only the requested running agent', () => {
  const calls = []
  const agents = new Map([
    ['running', { status: 'running', cancel(cause) { calls.push(cause) } }],
    ['idle', { status: 'idle', cancel() { throw new Error('Idle work must not be cancelled') } }],
  ])
  const token = 'private-fixture-control-token'
  for (const params of [{ sessionId: 'running' }, { sessionId: 'running', token: 'wrong' }, { sessionId: '../running', token }]) {
    assert.throws(() => cancelSession(agents, params, token))
  }
  assert.deepEqual(calls, [])
  for (const sessionId of ['missing', 'idle']) assert.deepEqual(cancelSession(agents, { sessionId, token }, token), { cancelled: false })
  assert.deepEqual(cancelSession(agents, { sessionId: 'running', token }, token), { cancelled: true })
  assert.deepEqual(calls, [{ kind: 'user' }])
})
