/**
 * 理财扩展契约与健康告知门禁。
 *
 * 钉住三件事：
 *   1. 投保健康告知 3 项——任一为「是」拒绝并转人工；缺项拒绝；
 *      **密码校验仍在前**（check-issue-fixes 依赖缺失密码报 INVALID_PAY_PASSWORD）。
 *   2. 存钱目标自动归集 setSavingsSweep 设置/取消。
 *   3. 定投计划 pauseInvestPlan / terminateInvestPlan 状态机（含终止不可恢复）。
 *
 * 用内存 localStorage，不碰真实数据库、不调模型。
 *
 *   node --import ./tools/ts-resolve-hook.mjs tools/check-wealth-ext.mjs
 */
import assert from 'node:assert/strict'

class MemoryStorage {
  #items = new Map()
  getItem(key) { return this.#items.get(key) ?? null }
  setItem(key, value) { this.#items.set(key, String(value)) }
  removeItem(key) { this.#items.delete(key) }
  clear() { this.#items.clear() }
}
globalThis.window = { localStorage: new MemoryStorage(), sessionStorage: new MemoryStorage() }

const [{ createMockApi }, { loadDb, resetDb }] = await Promise.all([
  import('../app/src/api/mock/index.ts'),
  import('../app/src/api/mock/db.ts'),
])
const api = createMockApi()
resetDb(); loadDb()
const productId = loadDb().insurance.products[0].id

await assert.rejects(
  api.enrollInsurance({ productId, insuredName: 'Test' }),
  (e) => e.code === 'INVALID_PAY_PASSWORD',
)
console.log('PASS 缺支付密码 → INVALID_PAY_PASSWORD（先于健康告知）')

await assert.rejects(
  api.enrollInsurance({ productId, insuredName: 'Test', healthAnswers: 'no,no,no', paymentPassword: '000000' }),
  (e) => e.code === 'BAD_PAY_PASSWORD',
)
console.log('PASS 密码错 → INVALID_PAY_PASSWORD')

await assert.rejects(
  api.enrollInsurance({ productId, insuredName: 'Test', healthAnswers: 'no,no', paymentPassword: '888888' }),
  (e) => e.code === 'HEALTH_DISCLOSURE_INCOMPLETE',
)
console.log('PASS 健康告知少于 3 项 → HEALTH_DISCLOSURE_INCOMPLETE')

for (const answers of ['yes,no,no', 'no,是,no', 'no,no,true']) {
  await assert.rejects(
    api.enrollInsurance({ productId, insuredName: 'Test', healthAnswers: answers, paymentPassword: '888888' }),
    (e) => e.code === 'HEALTH_DECLINED',
  )
}
console.log('PASS 健康告知任一异常（yes/是/true）→ HEALTH_DECLINED')

// 投保扣保费走理财结算账户；演示档案默认未开立，先就位再测成功路径
{
  const db = loadDb()
  db.wealthAccount = { ...(db.wealthAccount ?? {}), opened: true, settlementAccountId: db.accounts[0].id }
}
const policy = await api.enrollInsurance({ productId, insuredName: '测试', healthAnswers: 'no,no,no', paymentPassword: '888888' })
assert.equal(policy.insuredName, '测试')
assert.ok(policy.id)
assert.ok(loadDb().insurance.policies.some((p) => p.insuredName === '测试'))
console.log('PASS 全否 → 投保成功，保单落库')

// 新契约：setSavingsSweep / pauseInvestPlan / terminateInvestPlan 真实可用
const overview = await api.getSavingsOverview()
const goal = overview.goals[0]
assert.ok(goal)
const updated = await api.setSavingsSweep(goal.id, { enabled: true, amount: 1000, cycle: '每周', accountId: loadDb().accounts[0].id })
assert.equal(updated.sweep?.amount, 1000)
const cleared = await api.setSavingsSweep(goal.id, { enabled: false })
assert.equal(cleared.sweep, null)
console.log('PASS setSavingsSweep 设置/取消归集')

const investments = await api.getInvestments()
const plan = investments.plans[0]
assert.ok(plan, '演示档案应有定投计划')
const paused = await api.pauseInvestPlan(plan.id)
assert.equal(paused.status, 'paused')
await assert.rejects(api.pauseInvestPlan(plan.id), (e) => e.code === 'CONFLICT')
const terminated = await api.terminateInvestPlan(plan.id)
assert.equal(terminated.status, 'terminated')
assert.ok(terminated.terminatedAt)
await assert.rejects(api.terminateInvestPlan(plan.id), (e) => e.code === 'CONFLICT')
console.log('PASS pauseInvestPlan / terminateInvestPlan 状态机')

console.log('ALL PASS')
