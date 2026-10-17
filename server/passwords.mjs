import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

// Parameters are encoded for upgrades, but untrusted hashes cannot choose an
// arbitrarily expensive KDF. At most 64 MiB is allocated by verification.
const COST = 32768
const BLOCK_SIZE = 8
const PARALLELISM = 1
const KEY_BYTES = 64
const MAX_PASSWORD_BYTES = 1024
const ALLOWED_COSTS = new Set([16384, COST])
const validPassword = plain => typeof plain === 'string' && plain.length > 0 && Buffer.byteLength(plain, 'utf8') <= MAX_PASSWORD_BYTES

function parseHash(encoded) {
  if (typeof encoded !== 'string' || encoded.length > 256) return null
  const match = /^scrypt\$(\d{1,5})\$(\d)\$(\d)\$([a-f0-9]{32})\$([a-f0-9]{128})$/.exec(encoded)
  if (!match) return null
  const [, cost, blockSize, parallelism, salt, key] = match
  const n = Number(cost)
  if (!ALLOWED_COSTS.has(n) || cost !== String(n) || Number(blockSize) !== BLOCK_SIZE || Number(parallelism) !== PARALLELISM) return null
  return { cost: n, salt: Buffer.from(salt, 'hex'), key: Buffer.from(key, 'hex') }
}

/** Salted password hash; synchronous for the bank's single-process adapter. */
export function hashPassword(plain) {
  if (!validPassword(plain)) throw new TypeError('密码必须为非空字符串，且不超过 1024 字节')
  const salt = randomBytes(16)
  const key = scryptSync(plain, salt, KEY_BYTES, { N: COST, r: BLOCK_SIZE, p: PARALLELISM, maxmem: 64 * 1024 * 1024 })
  return `scrypt$${COST}$${BLOCK_SIZE}$${PARALLELISM}$${salt.toString('hex')}$${key.toString('hex')}`
}

/** Legacy unsalted SHA-256 is accepted only to allow successful-login upgrades. */
export function verifyPassword(plain, encoded) {
  if (!validPassword(plain) || typeof encoded !== 'string' || encoded.length > 256) return false
  const legacy = /^(?:sha256:)?([a-fA-F0-9]{64})$/.exec(encoded)
  if (legacy) return timingSafeEqual(createHash('sha256').update(plain).digest(), Buffer.from(legacy[1], 'hex'))
  const parsed = parseHash(encoded)
  if (!parsed) return false
  try {
    const actual = scryptSync(plain, parsed.salt, KEY_BYTES, { N: parsed.cost, r: BLOCK_SIZE, p: PARALLELISM, maxmem: 64 * 1024 * 1024 })
    return timingSafeEqual(actual, parsed.key)
  } catch { return false }
}

export function needsRehash(encoded) {
  const parsed = parseHash(encoded)
  return parsed === null || parsed.cost !== COST
}

/** Compare bounded secrets using fixed-size digests, including unequal lengths. */
export function timingSafeTextEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || !left || !right || Buffer.byteLength(left) > 4096 || Buffer.byteLength(right) > 4096) return false
  return timingSafeEqual(createHash('sha256').update(left).digest(), createHash('sha256').update(right).digest())
}
