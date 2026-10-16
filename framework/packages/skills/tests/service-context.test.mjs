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
