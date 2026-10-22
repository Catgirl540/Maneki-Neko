/** Narrow server-to-server notification protocol; never an employee business credential. */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
export function staffImHeaders(secret, path, body, { now = Date.now(), nonce = randomBytes(20).toString('hex') } = {}) {
  if (typeof secret !== 'string' || Buffer.byteLength(secret) < 32) throw Error('Staff IM service key must contain at least 32 bytes')
  const timestamp = String(now)
  const signature = createHmac('sha256', secret).update(`POST\n${path}\n${timestamp}\n${nonce}\n${body}`).digest('hex')
  return { 'x-staff-im-time': timestamp, 'x-staff-im-nonce': nonce, 'x-staff-im-signature': signature }
}
export function staffImVerifier(secret, clock = Date.now) {
  const used = new Map()
  return (headers, path, body) => {
    if (!secret || Buffer.byteLength(secret) < 32) return false
    const time = headers['x-staff-im-time'], nonce = headers['x-staff-im-nonce'], received = headers['x-staff-im-signature']
    if (!/^\d{13}$/.test(time ?? '') || Math.abs(clock() - Number(time)) > 30_000 || !/^[a-f0-9]{40}$/.test(nonce ?? '') || !/^[a-f0-9]{64}$/.test(received ?? '')) return false
    for (const [id, until] of used) if (until < clock()) used.delete(id)
    if (used.has(nonce) || used.size >= 10000) return false
    const expected = staffImHeaders(secret, path, body, { now: Number(time), nonce })['x-staff-im-signature']
    if (!timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(received, 'hex'))) return false
    used.set(nonce, clock() + 60_000)
    return true
  }
}
