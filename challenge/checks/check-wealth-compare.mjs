/**
 * 理财产品对比纯逻辑断言。不调模型、不调 HTTP，直接 import 纯函数验证。
 * 运行：node challenge/checks/check-wealth-compare.mjs
 */
import assert from 'node:assert/strict'
import { compareWealthProducts } from '../bridge/wealth-compare.mjs'

let passed = 0
function ok(label, actual, expected) {
  assert.deepEqual(actual, expected, `${label}: 实际 ${JSON.stringify(actual)}，期望 ${JSON.stringify(expected)}`)
  console.log(`PASS  ${label}`)
  passed++
}

// 最小产品夹具（形状对齐 WEALTH_PRODUCTS）
const FIXTURES = [
  { code: 'AAA-EQ', name: '权益', risk: 'R4', category: 'equity', term: '随时赎回', openEnded: true, principalProtected: false, minAmount: 1000000, stepAmount: 100000, benchmark: { kind: 'range', low: 0.04, high: 0.08, basis: '沪深300' }, volatility: 0.18, ongoingFees: [{ label: '管理费', rate: 0.015 }] },
  { code: 'BBB-CASH', name: '现金', risk: 'R1', category: 'cash', term: '随时赎回', openEnded: true, principalProtected: false, minAmount: 100, stepAmount: 100, benchmark: { kind: 'range', low: 0.016, high: 0.021, basis: '同业存单' }, sevenDayYield: 0.0186, volatility: 0.0004, ongoingFees: [{ label: '管理费', rate: 0.0015 }, { label: '托管费', rate: 0.0002 }] },
  { code: 'CCC-FIX', name: '固收', risk: 'R2', category: 'fixed', term: '90 天', openEnded: false, principalProtected: false, minAmount: 1000000, stepAmount: 100000, benchmark: { kind: 'range', low: 0.025, high: 0.03, basis: '中债指数' }, volatility: 0.003, ongoingFees: [] },
]

// 1) 全量对比：按风险升序 R1 → R2 → R4
const all = compareWealthProducts(FIXTURES)
ok('全量对比：数量 3', all.count, 3)
ok('全量对比：风险升序', all.products.map(p => p.risk), ['R1', 'R2', 'R4'])

// 2) 指定产品对比
const two = compareWealthProducts(FIXTURES, ['CCC-FIX', 'AAA-EQ'])
ok('指定对比：数量 2', two.count, 2)
ok('指定对比：风险升序', two.products.map(p => p.risk), ['R2', 'R4'])

// 3) 字段格式化
const cash = all.products[0]
ok('风险等级', cash.risk, 'R1')
ok('分类标签', cash.category, '现金管理类')
ok('起购金额', cash.minAmount, '¥1.00')
ok('基准文本', cash.benchmark, '1.60% ~ 2.10%')
ok('七日年化', cash.sevenDayYield, '1.86%')
ok('波动率', cash.volatility, '0.04%')
ok('费率合计', cash.totalOngoingFeeRate, '0.17%')
ok('费率明细', cash.feeBreakdown, '管理费 0.15% + 托管费 0.02%')
ok('保本', cash.principalProtected, false)

// 4) 无费用产品
const fix = all.products[1]
ok('无费用：合计 null', fix.totalOngoingFeeRate, null)
ok('无费用：明细「无」', fix.feeBreakdown, '无')

// 5) 合规文本
ok('免责文本含「不保本」', all.disclaimer.includes('不保本'), true)
ok('免责文本含「不构成投资建议」', all.disclaimer.includes('不构成投资建议'), true)
ok('免责文本不含推荐语', all.disclaimer.includes('推荐') || all.disclaimer.includes('适合'), false)

// 6) 不足两个产品报错
let threw = false
try { compareWealthProducts(FIXTURES, ['BBB-CASH']) } catch (e) { threw = e.code === 'INSUFFICIENT_PRODUCTS' }
ok('不足两产品抛 INSUFFICIENT_PRODUCTS', threw, true)

console.log(`\n共 ${passed} 项断言通过`)
