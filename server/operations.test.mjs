import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createOperations } from './operations.mjs'

test('authenticated AI probes distinguish reachability from model health and reject unexpected authentication responses', async () => {
  const server = createServer((req, res) => {
    res.writeHead(401, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ code: req.url === '/known' ? 'UNAUTHORIZED' : 'UNKNOWN' }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  // The probe test isolates telemetry persistence; PostgreSQL writes are covered
  // by the real database and HTTP integration suites.
  const db = { exec: async () => {}, prepare: sql => ({
    run: async () => ({ changes: 1 }), all: async () => [],
    get: async () => sql.includes('MIN(') ? { since: null } : sql.includes('pg_database_size') ? { size: 0 } : { n: 0 },
  }) }
  try {
    const base = `http://127.0.0.1:${server.address().port}`
    const probes = [
      { id: 'protected', name: 'AI', url: base + '/known', json: true, authenticatedHealth: true },
      { id: 'unexpected', name: 'AI', url: base + '/unknown', json: true, authenticatedHealth: true },
      { id: 'regular', name: 'ordinary', url: base + '/known', json: true },
    ]
    const operations = await createOperations({ db, root: process.cwd(), probes })
    const result = await operations.overview()
    assert.equal(result.services.find(x => x.id === 'protected').status, 'up')
    assert.match(result.services.find(x => x.id === 'protected').detail, /模型可用性未核实/)
    assert.equal(result.services.find(x => x.id === 'unexpected').status, 'down')
    assert.equal(result.services.find(x => x.id === 'regular').status, 'down')
  } finally { await new Promise(resolve => server.close(resolve)) }
})
