import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'

// Production-safe HTTP smoke: no SMS, customer creation, payment or card writes.
const [argument, ...extra] = process.argv.slice(2)
let base
try {
  if (extra.length) throw new Error('Unexpected arguments')
  base = new URL(argument ?? process.env.BANK_SMOKE_BASE_URL ?? `http://127.0.0.1:${process.env.BANK_PORT ?? 8080}/`)
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error('Invalid smoke base URL')
  if (!base.pathname.endsWith('/')) base.pathname += '/'
} catch {
  console.error('Usage: node server/smoke.mjs [http(s)://bank-host/base-path/]')
  process.exit(2)
}
async function get(path, token) {
  const res = await fetch(new URL(path.replace(/^\//, ''), base), {
    method: 'GET', signal: AbortSignal.timeout(10000), redirect: 'error',
    headers: { accept: 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  })
  const body = await res.json()
  return { status: res.status, body }
}
try {
  const health = await get('/health')
  assert.equal(health.status, 200, 'Health endpoint must return HTTP 200')
  assert.equal(health.body.ok, true, 'Backend must report available')
  assert.equal(health.body.database, 'postgresql', 'Runtime database must be PostgreSQL')
  assert.equal(typeof health.body.commercialReady, 'boolean', 'Commercial release gate must be explicit')
  const ready = await get('/ready')
  assert.equal(ready.status, 200, 'Readiness endpoint must return HTTP 200')
  assert.equal(ready.body.database, 'postgresql')
  for (const path of ['/api/accounts', '/api/bank-connections', '/staff-api/bank-connection/readiness']) {
    assert.equal((await get(path)).status, 401, 'Unauthenticated data access must be rejected')
  }
  assert.equal((await get('/api/accounts', randomBytes(32).toString('base64url'))).status, 401, 'Forged customer token must be rejected')
  assert.equal((await get('/api/__demo/reset')).status, 404, 'Demo reset endpoint must be unavailable')
  let authenticatedReadChecks = 0
  if (process.env.BANK_SMOKE_TOKEN) {
    assert.equal((await get('/api/auth/profile', process.env.BANK_SMOKE_TOKEN)).status, 200, 'Provided customer token must permit a profile read')
    authenticatedReadChecks += 1
    const links = await get('/api/bank-connections', process.env.BANK_SMOKE_TOKEN)
    assert(links.status === 200 || (links.status === 503 && links.body.code === 'BANK_NOT_CONNECTED'), 'Bank connection read must return linked accounts or explicit unconfigured state')
    authenticatedReadChecks += 1
  }
  if (process.env.BANK_SMOKE_REQUIRE_COMMERCIAL_READY === 'true') assert.equal(health.body.commercialReady, true, 'Commercial release gates are incomplete')
  console.log(JSON.stringify({ ok: true, scope: 'read-only-http', database: 'postgresql', integrationMode: health.body.integrationMode, commercialReady: health.body.commercialReady, authenticatedReadChecks }))
} catch (cause) {
  // Avoid dumping response bodies, bearer tokens, connection strings or fetch causes.
  console.error(JSON.stringify({ ok: false, code: 'SMOKE_FAILED', check: cause?.code === 'ERR_ASSERTION' ? cause.message : 'Service request failed' }))
  process.exitCode = 1
}
