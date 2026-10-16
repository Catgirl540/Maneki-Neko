import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'

export function createDataCipher(databasePath) {
  let key
  if (process.env.BANK_DATA_KEY) {
    const encoded = process.env.BANK_DATA_KEY.trim()
    key = Buffer.from(encoded, 'base64')
    if (key.length !== 32 || key.toString('base64') !== encoded) throw new Error('BANK_DATA_KEY must be a canonical base64 encoded 32-byte key')
  } else if (process.env.NODE_ENV === 'production') {
    throw new Error('BANK_DATA_KEY is required in production')
  } else if (databasePath === ':memory:') {
    key = randomBytes(32)
  } else {
    const keyPath = `${databasePath}.key`
    if (!existsSync(keyPath)) {
      try { writeFileSync(keyPath, randomBytes(32).toString('base64'), { flag: 'wx', mode: 0o600 }) }
      catch (error) { if (error.code !== 'EEXIST') throw error }
    }
    key = Buffer.from(readFileSync(keyPath, 'utf8').trim(), 'base64')
    if (key.length !== 32) throw new Error('Invalid local database encryption key')
    chmodSync(keyPath, 0o600)
  }
  return {
    seal(value, context) {
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv)
      cipher.setAAD(Buffer.from(context))
      const bytes = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
      return `aesgcm:v1:${Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString('base64url')}`
    },
    open(value, context) {
      if (typeof value !== 'string' || !value.startsWith('aesgcm:v1:')) throw new Error('Unencrypted value in encrypted column')
      const bytes = Buffer.from(value.slice(10), 'base64url'), decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12))
      decipher.setAuthTag(bytes.subarray(12, 28)); decipher.setAAD(Buffer.from(context))
      return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8'))
    },
  }
}
