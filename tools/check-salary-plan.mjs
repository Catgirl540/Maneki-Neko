/**
 * 工资计划空态断言；仅内存夹具，不触碰客户数据库。
 *
 * 背景：新客档案的“未设置”工资计划用 nextPayday:'' 表达，
 * 页面若直接 formatDate('') 会得到 NaN-NaN-NaN（桌面端测试报告问题①）。
 * 这里断言两件事：判定函数口径正确；mock 种子仍用空串表达未设置（契约不漂移）。
 */
import assert from 'node:assert/strict'
class MemoryStorage {
  values = new Map()
  getItem(key) { return this.values.get(key) ?? null }
  setItem(key, value) { this.values.set(key, String(value)) }
  removeItem(key) { this.values.delete(key) }
}
globalThis.window = { localStorage: new MemoryStorage(), sessionStorage: new MemoryStorage() }
const { createMockApi } = await import('../app/src/api/mock/index.ts')
const { resetDb } = await import('../app/src/api/mock/db.ts')
const { salaryPlanConfigured } = await import('../app/src/lib/salary-plan.ts')
const { ACCOUNT_OPENING_PLEDGE } = await import('../app/src/lib/account-opening.ts')
resetDb()
const api = createMockApi()

// 纯函数口径：空串 = 未设置；有日期 = 已设置
assert.equal(salaryPlanConfigured({ nextPayday: '' }), false)
assert.equal(salaryPlanConfigured({ nextPayday: '2026-11-08' }), true)
console.log('PASS salaryPlanConfigured 判定口径正确')

// 演示账户：已设置
const sms = await api.sendSmsCode('13800138000')
await api.login('13800138000', '123456', sms.demoCode)
const demoPlan = await api.getSalaryPlan()
assert.equal(salaryPlanConfigured(demoPlan), true)
assert.match(demoPlan.nextPayday, /^\d{4}-\d{2}-\d{2}$/)
console.log('PASS 演示账户工资计划已设置，nextPayday 为合法日期')

// 新注册账户：种子为未设置形态，判定必须走空态分支
await api.logout()
const sms2 = await api.sendSmsCode('13900139000')
const face = await api.verifyIdentity('face')
await api.register({ phone: '13900139000', password: 'abc12345', paymentPassword: '123321', holderName: '空计划测试', idNumber: '110101199001010011', smsCode: sms2.demoCode, faceTicket: face.ticket, pledge: ACCOUNT_OPENING_PLEDGE })
const freshPlan = await api.getSalaryPlan()
assert.equal(freshPlan.nextPayday, '')
assert.equal(freshPlan.employer, '')
assert.equal(freshPlan.amount, 0)
assert.equal(freshPlan.history.length, 0)
assert.equal(salaryPlanConfigured(freshPlan), false)
// 与页面渲染路径等价的兜底断言：formatDate 收到该值会产出 NaN，正是被拦掉的行为
const { formatDate } = await import('../app/src/lib/format.ts')
assert.equal(formatDate(freshPlan.nextPayday), 'NaN-NaN-NaN')
console.log('PASS 新注册账户为空计划形态，salaryPlanConfigured 判定为未设置（空态分支）')

// 设置后口径翻转：updateSalary 会算出真实 nextPayday
const updated = await api.updateSalary({ salaryDay: 15, amount: 1200000 })
assert.equal(salaryPlanConfigured(updated), true)
assert.match(updated.nextPayday, /^\d{4}-\d{2}-15$/)
console.log('PASS 设置工资计划后判定翻转为已设置，nextPayday 为当月/次月 15 日')

console.log('\ncheck-salary-plan: 全部通过')
