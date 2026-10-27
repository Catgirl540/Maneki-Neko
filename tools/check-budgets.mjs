// 支出预算口径回归：额度累计、拦截、积分补算与兑换约束都不依赖服务端与数据库。
import assert from 'node:assert/strict'
import {
  BUDGET_PASS_EXTRA_CENTS,
  BUDGET_POINTS_PER_PASS,
  BudgetError,
  addDays,
  checkBudgetLimit,
  budgetEffectiveLimit,
  budgetMerchantIds,
  budgetPoints,
  budgetSpentCents,
  budgetsOverview,
  settleBudgetPoints,
  shanghaiDay,
  validateBudgetInput,
  validateBudgetPatch,
  validatePassDay,
} from '../shared/budgets.mjs'
import { findSpendPlatform } from '../shared/spend-platforms.mjs'

let passed = 0
const check = (label, run) => {
  try {
    run()
    passed += 1
    console.log(`  ok  ${label}`)
  } catch (error) {
    console.error(`  FAIL ${label}`)
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
const failsWith = (run, code) => {
  try {
    run()
  } catch (error) {
    assert.ok(error instanceof BudgetError, `期望 BudgetError，实际 ${error?.name}`)
    assert.equal(error.code, code)
    return error
  }
  throw new Error(`期望抛出 ${code}`)
}

const luckin = findSpendPlatform('luckin')
const starbucks = findSpendPlatform('starbucks')
const meituan = findSpendPlatform('meituan')
const budget = { id: 'budget_t', name: '奶茶预算', platforms: ['luckin', 'starbucks'], dailyLimit: 2_000, pointThreshold: 1_000, enabled: true, createdAt: '2026-10-20T02:00:00.000Z', updatedAt: '2026-10-20T02:00:00.000Z' }
const tx = (merchantId, amount, iso, extra = {}) => ({ id: `tx_${Math.random()}`, direction: 'out', status: 'success', amount, createdAt: iso, detail: { merchantId }, ...extra })

console.log('上海自然日')
check('北京时间 00:30 归入次日', () => assert.equal(shanghaiDay(Date.parse('2026-10-26T16:30:00.000Z')), '2026-10-27'))
check('北京时间 23:30 仍是当天', () => assert.equal(shanghaiDay(Date.parse('2026-10-26T15:30:00.000Z')), '2026-10-26'))
check('addDays 跨月', () => assert.equal(addDays('2026-10-31', 1), '2026-11-01'))

console.log('累计口径')
check('商户号集合按平台映射', () => {
  const ids = budgetMerchantIds(budget)
  assert.ok(ids.has(luckin.merchantId) && ids.has(starbucks.merchantId))
  assert.ok(!ids.has(meituan.merchantId))
})
check('只算命中商户 + 成功 + 当日', () => {
  const rows = [
    tx(luckin.merchantId, 1_000, '2026-10-26T02:00:00.000Z'),
    tx(luckin.merchantId, 500, '2026-10-26T03:00:00.000Z'),
    tx(meituan.merchantId, 9_000, '2026-10-26T04:00:00.000Z'),
    tx(luckin.merchantId, 700, '2026-10-25T04:00:00.000Z'),
    tx(luckin.merchantId, 300, '2026-10-26T05:00:00.000Z', { status: 'failed' }),
    tx(luckin.merchantId, 200, '2026-10-26T06:00:00.000Z', { direction: 'in' }),
  ]
  assert.equal(budgetSpentCents(rows, budget, '2026-10-26'), 1_500)
})

console.log('拦截')
check('额度内放行', () => checkBudgetLimit([budget], [], [], luckin.merchantId, 500, '2026-10-26'))
check('超额度拒绝并报预算名', () => {
  const rows = [tx(luckin.merchantId, 1_500, '2026-10-26T02:00:00.000Z')]
  const error = failsWith(() => checkBudgetLimit([budget], [], rows, starbucks.merchantId, 800, '2026-10-26'), 'BUDGET_LIMIT_EXCEEDED')
  assert.equal(error.status, 409)
  assert.match(error.message, /奶茶预算/)
  assert.match(error.message, /20\.00/)
})
check('停用预算不拦', () => checkBudgetLimit([{ ...budget, enabled: false }], [], [], luckin.merchantId, 99_999, '2026-10-26'))
check('未命中平台不拦', () => checkBudgetLimit([budget], [], [], meituan.merchantId, 99_999, '2026-10-26'))
check('额度券抬高当天限额', () => {
  const passes = [{ id: 'pass_1', budgetId: budget.id, day: '2026-10-26', extra: BUDGET_PASS_EXTRA_CENTS, createdAt: '2026-10-26T01:00:00.000Z' }]
  assert.equal(budgetEffectiveLimit(budget, passes, '2026-10-26'), 4_000)
  assert.equal(budgetEffectiveLimit(budget, passes, '2026-10-27'), 2_000)
  const rows = [tx(luckin.merchantId, 3_000, '2026-10-26T02:00:00.000Z')]
  checkBudgetLimit([budget], passes, rows, luckin.merchantId, 1_000, '2026-10-26')
})

console.log('积分补算')
check('创建日到昨天逐日记 1 分，今天不结算，幂等', () => {
  const db = { budgets: [budget], budgetPointDays: [], budgetPasses: [], transactions: [] }
  const now = Date.parse('2026-10-26T02:00:00.000Z')
  assert.equal(settleBudgetPoints(db, now), 6)
  assert.deepEqual(db.budgetPointDays.map(row => row.day), ['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'])
  assert.equal(settleBudgetPoints(db, now), 0)
  assert.equal(db.budgetPointDays.length, 6)
})
check('花超门槛的日子不给分', () => {
  const db = { budgets: [{ ...budget, createdAt: '2026-10-23T02:00:00.000Z' }], budgetPointDays: [], budgetPasses: [], transactions: [
    tx(luckin.merchantId, 1_500, '2026-10-24T02:00:00.000Z'),
    tx(luckin.merchantId, 200, '2026-10-25T02:00:00.000Z'),
  ] }
  settleBudgetPoints(db, Date.parse('2026-10-26T02:00:00.000Z'))
  assert.deepEqual(db.budgetPointDays.map(row => row.day).sort(), ['2026-10-23', '2026-10-25'])
})
check('积分 = 达标天数 − 已兑换', () => {
  const pointDays = [{ budgetId: budget.id, day: '2026-10-24' }, { budgetId: budget.id, day: '2026-10-25' }]
  const passes = [{ id: 'pass_1', budgetId: budget.id, day: '2026-10-26', extra: BUDGET_PASS_EXTRA_CENTS }]
  assert.deepEqual(budgetPoints(pointDays, passes, budget.id), { awarded: 2, used: BUDGET_POINTS_PER_PASS, available: 0 })
  assert.deepEqual(budgetPoints(pointDays, [], budget.id), { awarded: 2, used: 0, available: 2 })
})
check('概览带今日用量与剩余', () => {
  const db = { budgets: [budget], budgetPointDays: [], budgetPasses: [], transactions: [tx(luckin.merchantId, 700, '2026-10-26T02:00:00.000Z')] }
  const [row] = budgetsOverview(db, Date.parse('2026-10-26T03:00:00.000Z'))
  assert.equal(row.today.day, '2026-10-26')
  assert.equal(row.today.used, 700)
  assert.equal(row.today.limit, 2_000)
  assert.equal(row.today.remaining, 1_300)
  assert.deepEqual(row.merchantNames, ['瑞幸咖啡', '星巴克'])
})

console.log('校验')
check('预算名与平台校验', () => {
  failsWith(() => validateBudgetInput({ name: '', platforms: ['luckin'], dailyLimit: 2_000 }), 'INVALID_BUDGET_NAME')
  failsWith(() => validateBudgetInput({ name: '奶茶'.repeat(11), platforms: ['luckin'], dailyLimit: 2_000 }), 'INVALID_BUDGET_NAME')
  failsWith(() => validateBudgetInput({ name: '奶茶', platforms: [], dailyLimit: 2_000 }), 'INVALID_BUDGET_PLATFORMS')
  failsWith(() => validateBudgetInput({ name: '奶茶', platforms: ['nope'], dailyLimit: 2_000 }), 'INVALID_BUDGET_PLATFORMS')
  failsWith(() => validateBudgetInput({ name: '奶茶', platforms: ['custom'], dailyLimit: 2_000 }), 'INVALID_BUDGET_PLATFORMS')
})
check('额度与门槛范围', () => {
  failsWith(() => validateBudgetInput({ name: '奶茶', platforms: ['luckin'], dailyLimit: 99 }), 'INVALID_BUDGET_LIMIT')
  failsWith(() => validateBudgetInput({ name: '奶茶', platforms: ['luckin'], dailyLimit: 5_000_001 }), 'INVALID_BUDGET_LIMIT')
  failsWith(() => validateBudgetInput({ name: '奶茶', platforms: ['luckin'], dailyLimit: 2_000, pointThreshold: -1 }), 'INVALID_BUDGET_THRESHOLD')
  assert.deepEqual(validateBudgetInput({ name: ' 奶茶 ', platforms: ['luckin', 'luckin'], dailyLimit: 2_000 }), {
    name: '奶茶', platforms: ['luckin'], dailyLimit: 2_000, pointThreshold: 1_000,
  })
})
check('局部更新保留原值', () => {
  const next = validateBudgetPatch({ dailyLimit: 3_000 }, budget)
  assert.equal(next.dailyLimit, 3_000)
  assert.equal(next.name, '奶茶预算')
  assert.deepEqual(next.platforms, ['luckin', 'starbucks'])
  failsWith(() => validateBudgetPatch({ enabled: 'yes' }, budget), 'INVALID_BUDGET_ENABLED')
})
check('额度券只能换今天到 30 天内', () => {
  const now = Date.parse('2026-10-26T02:00:00.000Z')
  assert.equal(validatePassDay('2026-10-26', now), '2026-10-26')
  assert.equal(validatePassDay(addDays('2026-10-26', 30), now), '2026-11-25')
  failsWith(() => validatePassDay('2026-10-25', now), 'INVALID_PASS_DAY')
  failsWith(() => validatePassDay(addDays('2026-10-26', 31), now), 'INVALID_PASS_DAY')
  failsWith(() => validatePassDay('2026/10/26', now), 'INVALID_PASS_DAY')
})

if (process.exitCode) {
  console.error('\n支出预算口径回归失败')
} else {
  console.log(`\n支出预算口径回归通过：${passed} 项`)
}
