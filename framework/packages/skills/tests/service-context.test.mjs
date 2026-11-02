import assert from 'node:assert/strict'
import { test } from 'node:test'
import { serviceSkillContext } from '../../../bridge/service-skills.mjs'

test('多选按清单解析并去重，技能只提供指导不代替授权', () => {
  const text = serviceSkillContext(['cards', 'transfer', 'cards'])
  assert(text.includes('/bank-transfer /bank-cards'))
  assert.equal(text.match(/\/bank-cards/g).length, 1)
  assert(text.includes('不是业务授权'))
})

test('清除选择与旧客户端都恢复自动匹配，不粘住历史选择', () => {
  assert.equal(serviceSkillContext([]), serviceSkillContext(undefined))
  assert(serviceSkillContext([]).includes('自动匹配'))
  assert(!serviceSkillContext([]).includes('/bank-'))
})

test('拒绝任意技能名、路径、非数组和超长选择', () => {
  for (const value of [null, 'cards', {}, ['bank-cards'], ['../cards'], [2], ['cards', 'unknown'], Array(11).fill('cards')]) {
    assert.throws(() => serviceSkillContext(value), error => error.status === 400 && error.code === 'INVALID_SERVICE_SELECTION')
  }
})


test('当前问题为月度支出、持仓、汇率与预算选择具体工具，历史选择不覆盖当前请求', () => {
  for (const [question, skill, tool] of [
    ['本月花了多少钱？', 'bank-analysis', 'bank_get_spending'],
    ['查一下2026-10月度支出', 'bank-analysis', 'bank_get_spending'],
    ['我的理财持仓怎么样？', 'bank-wealth', 'bank_get_wealth_overview'],
    ['人民币兑美元的牌价是多少？', 'bank-exchange', 'bank_get_exchange_rates'],
    ['设置本月餐饮预算2000元', 'bank-analysis', 'bank_set_monthly_budget'],
  ]) {
    const context = serviceSkillContext(['cards'], question)
    assert(context.includes('/' + skill))
    assert(context.includes(tool))
    assert(!context.includes('/bank-cards'), 'unrelated service selection must not override current request')
    assert(context.includes('不是业务授权'))
  }
  assert(!serviceSkillContext(undefined, '明天出门带伞吗').includes('/bank-'))
  const spending = serviceSkillContext(undefined, '看看本月支出')
  assert(spending.includes('无需先查余额或月度账单'))
})
