/** Isolated IM credentials and routing metadata. Bank login tokens stay in memory. */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

// Existing encrypted, bank-verified ownership remains valid across upgrades.
// This metadata migration never restores an in-memory bank login or a grant.
export async function migrateImBindingRevisions(store) {
  const eligible = route => route.ownerId && route.sessionId && !route.bindingRevision
    && route.channel === 'weixin' && typeof route.key === 'string' && route.key.startsWith('p2p:')
  if (!Object.values(store.snapshot().routes).some(eligible)) return 0
  return store.update(draft => {
    let count = 0
    for (const route of Object.values(draft.routes)) if (eligible(route)) { route.bindingRevision = randomUUID(); count++ }
    return count
  })
}

export async function openImStore(path, encodedKey, { audience = 'customer' } = {}) {
  const source = Buffer.from(encodedKey ?? '', 'base64')
  if (source.length !== 32 || source.toString('base64') !== encodedKey) throw Error('IM requires a canonical Base64 32-byte AI session data key')
  if (!['customer','staff'].includes(audience)) throw Error('Invalid IM audience')
  const domain = audience === 'staff' ? 'luckycat-staff-im-store-v1' : 'luckycat-im-store-v1'
  const key = Buffer.from(hkdfSync('sha256', source, Buffer.alloc(0), domain, 32))
  const aad = Buffer.from(domain)
  let document = { version: 1, credentials: {}, routes: {} }
  try {
    const envelope = JSON.parse(await readFile(path, 'utf8'))
    if (envelope.version !== 1 || typeof envelope.cipher !== 'string') throw Error('Invalid IM store')
    const bytes = Buffer.from(envelope.cipher, 'base64url')
    const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12))
    decipher.setAAD(aad); decipher.setAuthTag(bytes.subarray(12, 28))
    document = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8'))
    if (document.version !== 1 || !document.credentials || !document.routes) throw Error('Invalid IM store')
  } catch (error) { if (error.code !== 'ENOENT') throw Error('IM store cannot be decrypted or validated; preserve the original file and key') }
  let writes = Promise.resolve()
  function update(change) {
    const next = writes.then(async () => {
      const draft = structuredClone(document)
      const value = change(draft)
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv)
      cipher.setAAD(aad)
      const bytes = Buffer.concat([cipher.update(JSON.stringify(draft), 'utf8'), cipher.final()])
      const temp = `${path}.${randomUUID()}.tmp`
      await mkdir(dirname(path), { recursive: true, mode: 0o700 })
      try {
        await writeFile(temp, JSON.stringify({ version: 1, cipher: Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString('base64url') }), { mode: 0o600, flag: 'wx' })
        await rename(temp, path)
        document = draft
        return value
      } finally { await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error }) }
    })
    writes = next.catch(() => {})
    return next
  }
  return {
    snapshot: () => structuredClone(document), update, flush: () => writes,
    credentials: {
      resolve: async name => ({ value: Object.hasOwn(document.credentials, name) ? document.credentials[name] : undefined }),
      set: (name, value) => update(draft => { draft.credentials[name] = value }),
      unset: name => update(draft => { delete draft.credentials[name] }),
    },
  }
}
