/** Persists only hashes and random operation IDs, never request bodies or passwords. */
export function createClientOperations(storage, cryptoApi = globalThis.crypto) {
  const storageKey = 'bank.pending-operations.v1'
  const hash = async value => Array.from(new Uint8Array(await cryptoApi.subtle.digest('SHA-256', new TextEncoder().encode(value))), n => n.toString(16).padStart(2, '0')).join('')
  const read = () => { const raw = JSON.parse(storage.getItem(storageKey) ?? '[]'); if (!Array.isArray(raw) || raw.length > 256 || raw.some(r => !/^[a-f0-9]{64}$/.test(r.scope) || !/^[a-f0-9]{64}$/.test(r.fingerprint) || !/^[a-f0-9-]{36}$/.test(r.key))) throw Error('操作恢复记录无效'); return raw }
  const save = rows => storage.setItem(storageKey, JSON.stringify(rows))
  const clean = value => Array.isArray(value) ? value.map(clean) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).filter(k => !/password|secret|cvv|cvc|token|smsCode/i.test(k)).sort().map(k => [k, clean(value[k])])) : value
  return {
    async begin(owner, method, path, body) {
      const scope = await hash(JSON.stringify([owner, method, path]))
      const fingerprint = await hash(JSON.stringify(clean(body ?? null)))
      const rows = read(), prior = rows.find(r => r.scope === scope)
      if (prior && prior.fingerprint !== fingerprint) throw Object.assign(Error('上一笔操作结果尚未确认'), { code: 'OPERATION_UNRESOLVED', operation: prior })
      if (prior) return prior
      if (rows.length >= 256) throw Error('待确认操作过多，请先核对已有操作')
      const operation = { scope, fingerprint, key: cryptoApi.randomUUID() }; rows.push(operation); save(rows); return operation
    },
    finish(operation) { save(read().filter(r => r.key !== operation.key)) },
  }
}
