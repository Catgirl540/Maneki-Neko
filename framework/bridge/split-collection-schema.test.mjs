import test from 'node:test'
import assert from 'node:assert/strict'
import { validateArgs, parameterSchemaSpecToJsonSchema } from '@deepseek-ai/dsh-tools'
import { extendedHttpTools } from '../packages/bank-demo/lib/extended-http-tools.js'

test('published AA tool requires member identities and accepts structured arrays', () => {
  const tool = extendedHttpTools.find(tool => tool.name === 'bank_create_split_collection')
  const schema = parameterSchemaSpecToJsonSchema(tool.parameters)
  assert(schema.required.includes('members'))
  for (const key of ['participantNames', 'amountCents', 'collectorName', 'expenses']) assert.equal(schema.properties[key], undefined)
  const members = [{ name: '张三', phone: '13700137000', amount: 100, memo: '聚餐AA' }]
  const args = { title: '聚餐', currency: 'CNY', members }
  assert.deepEqual(validateArgs(tool.parameters, args), [])
  assert.deepEqual(validateArgs(tool.parameters, { ...args, members: JSON.stringify(members) }), [])
  assert(validateArgs(tool.parameters, { title: 'AA', currency: 'CNY' }).length)
  assert(validateArgs(tool.parameters, { ...args, members: [{ name: '张三', phone: '13700137000', amount: 100 }] }).length)
  // 姓名必填；手机号与账号二者有一个即可。
  assert(validateArgs(tool.parameters, { ...args, members: [{ phone: '13700137000', amount: 100, memo: '聚餐AA' }] }).length)
  assert.deepEqual(validateArgs(tool.parameters, { ...args, members: [{ name: '张三', accountNo: '8820000000003605', amount: 100, memo: '聚餐AA' }] }), [])
})
