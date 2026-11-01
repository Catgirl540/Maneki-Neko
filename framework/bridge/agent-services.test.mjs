import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadAgentServices } from './agent-services.mjs'

const base = {
  version: 1,
  updatedAt: '2026-11-01',
  services: [
    { id: 'transfer', order: 10, label: '智能转账', description: '转账与到账查询' },
    { id: 'cards', order: 20, label: '银行卡管家', description: '锁卡与限额' },
  ],
}

function withManifest(value, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'agent-services-'))
  const file = join(dir, 'agent-services.json')
  writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value))
  try { return fn(file) } finally { rmSync(dir, { recursive: true, force: true }) }
}

test('仓库清单可读、按 order 排序、字段齐全', () => {
  const loaded = loadAgentServices()
  assert.equal(loaded.version, 1)
  assert.match(loaded.updatedAt, /^\d{4}-\d{2}-\d{2}$/)
  assert(loaded.services.length > 0)
  const ids = loaded.services.map(item => item.id)
  assert.equal(new Set(ids).size, ids.length)
  const orders = loaded.services.map(item => item.order)
  assert.deepEqual(orders, [...orders].sort((a, b) => a - b))
  for (const item of loaded.services) {
    assert.match(item.id, /^[a-z][a-z0-9-]+$/)
    assert(item.label.length > 0 && item.label.length <= 16)
    assert(item.description.length > 0 && item.description.length <= 60)
  }
})

test('读取时按 order 排序并去掉首尾空白', () => {
  const value = { ...base, services: [
    { id: 'cards', order: 20, label: '  银行卡管家 ', description: ' 锁卡 ' },
    { id: 'transfer', order: 10, label: '智能转账', description: '转账' },
  ] }
  const loaded = withManifest(value, file => loadAgentServices(file))
  assert.deepEqual(loaded.services.map(item => item.id), ['transfer', 'cards'])
  assert.equal(loaded.services[1].label, '银行卡管家')
  assert.equal(loaded.services[1].description, '锁卡')
})

test('结构、id、顺序和文案不合规时拒绝启动', () => {
  const cases = {
    '非法 JSON': '{',
    'version 非正整数': { ...base, version: 0 },
    'updatedAt 格式错误': { ...base, updatedAt: '2026/11/01' },
    'services 为空': { ...base, services: [] },
    'id 重复': { ...base, services: [base.services[0], { ...base.services[1], id: 'transfer' }] },
    'order 重复': { ...base, services: [base.services[0], { ...base.services[1], order: 10 }] },
    'id 非法': { ...base, services: [base.services[0], { ...base.services[1], id: 'Bank Cards' }] },
    'label 为空': { ...base, services: [base.services[0], { ...base.services[1], label: '  ' }] },
    'label 过长': { ...base, services: [base.services[0], { ...base.services[1], label: '卡'.repeat(17) }] },
    'description 过长': { ...base, services: [base.services[0], { ...base.services[1], description: '说'.repeat(61) }] },
    'order 非整数': { ...base, services: [base.services[0], { ...base.services[1], order: 1.5 }] },
  }
  for (const [name, value] of Object.entries(cases)) {
    assert.throws(() => withManifest(value, file => loadAgentServices(file)), /agent-services\.json/, name)
  }
})
