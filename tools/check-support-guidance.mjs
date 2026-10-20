/** Browser BankApi fallback parity, with disposable in-memory storage only. */
import assert from 'node:assert/strict'
import { supportGuidance } from '../shared/support-guidance.mjs'
class Storage {
  values = new Map()
  getItem(key) { return this.values.get(key) ?? null }
  setItem(key, value) { this.values.set(key, String(value)) }
  removeItem(key) { this.values.delete(key) }
}
globalThis.window = { localStorage: new Storage(), sessionStorage: new Storage() }
const { createMockApi } = await import('../app/src/api/mock/index.ts')
const { resetDb, loadDb } = await import('../app/src/api/mock/db.ts')
resetDb()
const api = createMockApi(), funds = () => structuredClone({ accounts: loadDb().accounts, currencyBalances: loadDb().currencyBalances,
  transactions: loadDb().transactions, cards: loadDb().cards, autoDebits: loadDb().autoDebits })
const before = funds()
for (const text of ['查余额', '当前利率', '转账并立即到账', '停用自动扣款', '锁卡', '转人工']) {
  const reply = await api.sendSupportMessage(text)
  assert.equal(reply.canned, true)
  assert.equal(reply.message.text, supportGuidance(text).text)
  assert.deepEqual(reply.message.actions, supportGuidance(text).actions)
}
assert.deepEqual(funds(), before)
console.log('PASS 浏览器模拟固定引导与共享规则一致，不查询或修改金融数据、不冒称工单受理')
