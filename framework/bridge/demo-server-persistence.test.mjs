import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'

// Execute the real publisher without starting HTTP, the model SDK or a bank call.
const source = readFileSync(new URL('./demo-server.mjs', import.meta.url), 'utf8')
const start = source.indexOf('let persistenceFailureLogged = false')
const end = source.indexOf('/** 广播给全部订阅者', start)
assert(start >= 0 && end > start, 'publisher source boundaries must remain explicit')
const publisher = source.slice(start, end)
const tick = () => new Promise(resolve => setImmediate(resolve))
function fixture(store) {
  const state = { frames: [], ended: 0, warnings: 0, records: 0 }
  const entry = { id: 'session', ownerId: 'owner', eventSeq: 0, events: [] }
  const response = { write(frame) { state.frames.push(frame) }, end() { state.ended++ } }
  const context = createContext({
    sessions: new Map([['session', entry]]), streams: new Map([['session', new Set([response])]]),
    HTTP_BANK: true, eventPolling: { remember() {} },
    sessionStore: { flush: async () => {}, record(...args) { state.records++; return store(...args) } },
    console: { warn() { state.warnings++ } },
  })
  runInContext(publisher, context)
  return { context, state, entry }
}

test('SSE replay events are sent only after their PostgreSQL persistence promise resolves', async () => {
  let commit
  const { context, state } = fixture(() => new Promise(resolve => { commit = resolve }))
  const sent = context.publish('session', { type: 'assistant-token', text: 'committed token' })
  assert.equal(state.frames.length, 0)
  commit()
  await sent
  assert.equal(state.frames.length, 1)
  assert.match(state.frames[0], /id: 1/)
})

test('ignored failed publication promises are handled, close streams and latch a fatal state', async () => {
  const { context, state } = fixture(() => Promise.reject(new Error('database unavailable')))
  context.publish('session', { type: 'status', status: 'running' }) // SDK callback intentionally does not await.
  await tick(); await tick()
  assert.equal(state.frames.length, 0)
  assert.equal(state.ended, 1)
  assert.equal(state.warnings, 1)
  assert.equal(runInContext('persistenceFailureLogged', context), true)
})

test('synchronous storage validation failures also become handled publication failures', async () => {
  const { context, state } = fixture(() => { throw new Error('invalid event') })
  assert.doesNotThrow(() => { context.publish('session', { type: 'status', status: 'running' }) })
  await tick(); await tick()
  assert.equal(state.frames.length, 0)
  assert.equal(state.ended, 1)
  assert.equal(runInContext('persistenceFailureLogged', context), true)
})

test('card secrets remain transient and never enter replay storage or sequence allocation', async () => {
  const { context, state, entry } = fixture(() => { throw new Error('card secret reached persistence') })
  await context.publish('session', { type: 'card-secret', pan: 'TEST ONLY SECRET' })
  assert.equal(state.records, 0)
  assert.equal(entry.eventSeq, 0)
  assert.equal(entry.events.length, 0)
  assert.equal(state.frames.length, 1)
})
