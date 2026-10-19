/** 交易自动分类门禁：OpenRouter 分类器与记账接线。全部用夹具，不调用真实模型。 */

class MemoryStorage {
  #items = new Map()
  getItem(key) { return this.#items.get(key) ?? null }
  setItem(key, value) { this.#items.set(key, String(value)) }
  setItemsAtomically(entries) { for (const [k, v] of entries) this.#items.set(k, String(v)); return true }
  removeItem(key) { this.#items.delete(key) }
  clear() { this.#items.clear() }
}

globalThis.window = { localStorage: new MemoryStorage(), sessionStorage: new MemoryStorage() }

const [{ createCategorizer }] = await Promise.all([
  import('../server/lib/categorize.mjs'),
])

let failures = 0
function check(ok, label) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) failures += 1
}

/* ---------------- ① 分类器本体：枚举约束 / 缓存 / 失败回落 ---------------- */

const tx = { counterparty: '星巴克咖啡', memo: '咖啡消费', direction: 'out', channel: 'card', amount: 3200, currency: 'CNY' }

let calls = 0
const disabled = createCategorizer({})
check(disabled.enabled === false && (await disabled.classify(tx)) === 'other', '未配置密钥时禁用并回落 other')
check(calls === 0, '禁用时不发起任何模型请求')

calls = 0
const stubOk = () => { calls += 1; return Promise.resolve({ ok: true, json: async () => ({ answers: { category: { type: 'choice', choice: 'dining', probabilities: { dining: 1 } } } }) }) }
const cat = createCategorizer({ apiKey: 'test-only', fetchImpl: async () => stubOk() })
check(cat.enabled && (await cat.classify(tx)) === 'dining', '模型返回合法枚举时采用该分类')
check(await cat.classify(tx) === 'dining' && calls === 1, '相同流水命中缓存，不重复调用模型')
check(await cat.classify({ ...tx, counterparty: '上海地铁' }) === 'dining' && calls === 2, '不同对方户名独立调用')

const catGarbage = createCategorizer({ apiKey: 'test-only', fetchImpl: async () => ({ ok: true, json: async () => ({ answers: { category: { type: 'choice', choice: 'luxury' } } }) }) })
check(await catGarbage.classify(tx) === 'other', '模型返回枚举外取值时回落 other')

const catFail = createCategorizer({ apiKey: 'test-only', fetchImpl: async () => { throw new Error('network down') } })
check(await catFail.classify(tx) === 'other', '模型调用失败回落 other，不影响记账')

const catHttp = createCategorizer({ apiKey: 'test-only', fetchImpl: async () => ({ ok: false, status: 429 }) })
check(await catHttp.classify(tx) === 'other', '模型限流/错误响应回落 other')

/* ---------------- ② 记账接线：'other' 支出流水被自动分类 ---------------- */

const storageShim = globalThis.window.localStorage
const [{ createBankBusinessApi }, { resetDb }] = await Promise.all([
  import('../server/domain/index.mjs'),
  import('../server/domain/state.mjs'),
])
resetDb()
const securityStub = {
  verifySms: async () => {},
  issueIdentityTicket: async (channel) => ({ ticket: `test.${channel}` }),
}
let classified = []
const api = createBankBusinessApi({
  security: securityStub,
  classify: async (row) => { classified.push(row); return 'dining' },
})
await api.login('13800138000', '123456', '000000')

await api.openCard({
  productCode: 'LCB-UP-DEBIT',
  paymentPassword: '888888',
  address: { recipient: '林小满', phone: '13800138000', region: '上海市', city: '上海市', detail: '世纪大道 100 号 5 栋 802', postalCode: '200120' },
})
const { items } = await api.listTransactions('acc_0001', { page: 1, size: 5 })
const fee = items.find((t) => t.counterparty === '制卡工本费')
check(Boolean(fee) && fee.category === 'dining', '制卡费流水按模型结果落库为 dining')
check(classified.length === 1 && classified[0].counterparty === '制卡工本费', '分类器只收到归类流水要素')

classified = []
const accounts = await api.listAccounts()
await api.deposit(accounts[0].id, 100_00, 'card')
check(classified.length === 0, '收入方向流水不进入自动分类')

if (failures) {
  console.error(`\n${failures} categorize check(s) failed.`)
  process.exit(1)
}
console.log('\nCategorize checks passed.')
