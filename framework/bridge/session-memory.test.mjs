import test from 'node:test'
import assert from 'node:assert/strict'
import { compactReplay, isReplayCheckpoint, retainReplayEvent } from './session-memory.mjs'

test('live text stays transient between one-second durable checkpoints; final replies and business events stay durable', () => {
  const entry = {}, update = { type: 'assistant-update', messageId: 'reply' }
  assert.equal(isReplayCheckpoint(entry, update, 1000), true)
  assert.equal(isReplayCheckpoint(entry, update, 1040), false)
  assert.equal(isReplayCheckpoint(entry, update, 1999), false)
  assert.equal(isReplayCheckpoint(entry, update, 2000), true)
  assert.equal(isReplayCheckpoint(entry, { type: 'assistant', messageId: 'reply' }, 2001), true)
  assert.equal(isReplayCheckpoint(entry, { type: 'tool-result' }, 2001), true)
  assert.equal(isReplayCheckpoint(entry, { type: 'card-secret' }, 2001), false)
})

test('long assistant streams retain the latest cumulative text and final message without repeated prefixes', () => {
  const entry = {}
  for (let i = 1; i <= 200; i++) retainReplayEvent(entry, { id: String(i), event: { type: 'assistant-update', messageId: 'reply', text: 'x'.repeat(i * 1000) } })
  assert.equal(entry.events.length, 1)
  assert.equal(entry.events[0].event.text.length, 200_000)
  retainReplayEvent(entry, { id: '201', event: { type: 'assistant', messageId: 'reply', text: 'complete' } })
  assert.deepEqual(entry.events.map(row => row.id), ['201'])
})

test('replay history is bounded by bytes as well as event count, including restored sessions', () => {
  const entry = { events: Array.from({ length: 256 }, (_, i) => ({ id: String(i + 1), event: { type: 'tool-result', text: 'x'.repeat(20_000) } })) }
  compactReplay(entry)
  assert(entry.replayBytes <= 1024 * 1024)
  assert.equal(entry.events.at(-1).id, '256')
  assert(entry.events.length < 256)
})
