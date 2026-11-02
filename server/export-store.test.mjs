import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createExportStore } from './export-store.mjs'

test('export files are single use, expire, and are never served to another owner', () => {
  let stamp = 1_000
  const store = createExportStore({ ttlMs: 1_000, now: () => stamp })
  const { token, expiresAt } = store.put({ ownerId: 'alice', fileName: 'a.csv', csv: 'x,y\r\n' })
  assert.equal(expiresAt, 2_000)
  assert.equal(store.take(token, 'mallory'), null)
  assert.equal(store.take(token), null)
  const first = store.take(token, 'alice')
  assert.equal(first.ownerId, 'alice')
  assert.equal(first.csv, 'x,y\r\n')
  assert.equal(store.take(token, 'alice'), null, 'second download must fail')

  const other = store.put({ ownerId: 'bob', fileName: 'b.csv', csv: 'ok' })
  stamp = 2_000
  assert.equal(store.take(other.token, 'bob'), null, 'expired token must fail')

  assert.equal(store.take('not-a-real-token'), null)
  assert.equal(store.take(undefined), null)
  assert.throws(() => store.put({ ownerId: '', fileName: 'x', csv: 'y' }), /owner/)
  assert.throws(() => store.put({ ownerId: 'a', fileName: 'x', csv: 'x'.repeat(9 * 1024 * 1024) }), /过大/)
})
