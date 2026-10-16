import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHash, scryptSync } from 'node:crypto'
import { hashPassword, verifyPassword, needsRehash, timingSafeTextEqual } from './passwords.mjs'

const secret = 'unit-test-银行-credential'
const legacy = value => createHash('sha256').update(value).digest('hex')

test('scrypt uses independent salts and validates UTF-8 passwords', () => {
  const first = hashPassword(secret), second = hashPassword(secret)
  assert.notEqual(first, second)
  assert.equal(verifyPassword(secret, first), true)
  assert.equal(verifyPassword('wrong', first), false)
  assert.equal(needsRehash(first), false)
  assert.throws(() => hashPassword(''))
  assert.throws(() => hashPassword('字'.repeat(342)))
  assert.equal(verifyPassword('字'.repeat(342), first), false)
  assert.equal(verifyPassword(null, first), false)
})

test('legacy hashes can be verified and require upgrade', () => {
  for (const encoded of [legacy(secret), `sha256:${legacy(secret)}`, legacy(secret).toUpperCase()]) {
    assert.equal(verifyPassword(secret, encoded), true)
    assert.equal(verifyPassword('wrong', encoded), false)
    assert.equal(needsRehash(encoded), true)
  }
})

test('untrusted scrypt parameters are bounded before running the KDF', () => {
  const salt = 'ab'.repeat(16), key = 'cd'.repeat(64)
  for (const encoded of [
    `scrypt$99999$8$1$${salt}$${key}`,
    `scrypt$32768$9$1$${salt}$${key}`,
    `scrypt$32768$8$9$${salt}$${key}`,
    `scrypt$032768$8$1$${salt}$${key}`,
    `scrypt$32768$8$1$${salt.slice(2)}$${key}`,
    `scrypt$32768$8$1$${salt}$${key.slice(2)}`,
    `scrypt$32768$8$1$${salt}$${key}trailing`,
    'x'.repeat(10000), '', null,
  ]) assert.equal(verifyPassword(secret, encoded), false)
  const oldKey = scryptSync(secret, Buffer.from(salt, 'hex'), 64, { N: 16384, r: 8, p: 1 }).toString('hex')
  const oldCost = `scrypt$16384$8$1$${salt}$${oldKey}`
  assert.equal(verifyPassword(secret, oldCost), true)
  assert.equal(needsRehash(oldCost), true)
})

test('secret comparison handles different lengths and rejects missing or oversized values', () => {
  assert.equal(timingSafeTextEqual(secret, secret), true)
  assert.equal(timingSafeTextEqual(secret, `${secret}x`), false)
  assert.equal(timingSafeTextEqual('', ''), false)
  assert.equal(timingSafeTextEqual(undefined, secret), false)
  assert.equal(timingSafeTextEqual('x'.repeat(4097), 'x'.repeat(4097)), false)
})
