import test from 'node:test'
import assert from 'node:assert/strict'
import { prepareExtendedBankOperation } from './extended-bank-tools.mjs'
import { calculateSplitCollection } from '../../shared/split-collection.mjs'

test('AA agent review and submitted request use the same per-activity calculation', async () => {
  const expenses = [{ title: '聚餐', amount: 30000, participants: ['王明', '张三', '李四'] }, { title: '后续活动', amount: 20000, participants: ['王明', '张三'] }]
  const args = { title: 'AA', currency: 'CNY', allocation: { collectorName: '王明', expenses }, members: [{ phone: '13700137000', amount: 20000, memo: '聚餐与后续活动' }, { phone: '13900139000', amount: 10000, memo: '仅聚餐' }] }
  const review = await prepareExtendedBankOperation('bank_create_split_collection', args, { requestId: 'review-1' })
  assert.deepEqual(review.body.allocation.expenses, expenses)
  assert.equal(review.body.amount, undefined)
  assert.equal(calculateSplitCollection(review.body.allocation).amount, 30000)
  assert(review.fields.some(row => row.label === '13700137000' && row.value.includes('CNY 200.00')))
  assert(review.fields.some(row => row.label === '13900139000' && row.value.includes('CNY 100.00')))
  assert.equal(calculateSplitCollection(review.body.allocation).selfAmount, 20000)
  assert(review.fields.some(row => row.label === '本人份额' && row.value === 'CNY 200.00'))
  assert(review.fields.some(row => row.label === '后续活动' && !row.value.includes('李四')))
  await assert.rejects(prepareExtendedBankOperation('bank_create_split_collection', { ...args, amountCents: 50000 }, {}), /混用/)
  await assert.rejects(prepareExtendedBankOperation('bank_create_split_collection', { ...args, allocation: 'bad' }, {}), /JSON/)
})


test('AA member notification review binds exact phones, amounts, memos and sending scope', async () => {
  const args = { title: '聚餐', currency: 'CNY', members: JSON.stringify([{ phone: '13600136000', amount: 301, memo: '聚餐2元，活动1.01元' }]) }
  const review = await prepareExtendedBankOperation('bank_create_split_collection', args, { requestId: 'phone-1' })
  assert.equal(review.body.confirmed, true)
  assert.equal(review.body.members[0].amount, 301)
  assert.equal(review.body.members[0].memo, '聚餐2元，活动1.01元')
  assert(review.fields.some(row => row.label === '13600136000' && row.value.includes('CNY 3.01') && row.value.includes('聚餐2元')))
  assert(review.fields.some(row => row.label === '通知范围' && row.value.includes('站内付款通知')))
  await assert.rejects(prepareExtendedBankOperation('bank_create_split_collection', { ...args, amountCents: 301 }, {}), /混用/)
  await assert.rejects(prepareExtendedBankOperation('bank_create_split_collection', { ...args, members: '[{"phone":"13600136000","amount":301,"memo":""}]' }, {}), /备注/)
})


test('AA merged list review binds deterministic allocation to phone request', async () => {
  const args = { title: 'AA', currency: 'CNY', allocation: JSON.stringify({ amount: 101, participants: ['甲', '乙'] }), members: JSON.stringify([{ phone: '13600136000', amount: 51, memo: '聚餐' }, { phone: '13900000000', amount: 50, memo: '聚餐' }]) }
  const review = await prepareExtendedBankOperation('bank_create_split_collection', args, { requestId: 'merged' })
  assert.equal(review.body.allocation.amount, 101)
  await assert.rejects(prepareExtendedBankOperation('bank_create_split_collection', { ...args, members: args.members.replace('51', '52') }, {}), { code: 'AA_ALLOCATION_MISMATCH' })
})


test('AA rejects legacy creation instead of silently dropping phones and inbox delivery', async () => {
  for (const args of [{}, { amountCents: 200, participantNames: ['乙', '丙'] }, { amountCents: 200, participantNames: '["乙","丙"]' }, { expenses: '[]', collectorName: '甲' }]) {
    await assert.rejects(prepareExtendedBankOperation('bank_create_split_collection', { title: 'AA', currency: 'CNY', ...args }, {}), /补齐.*手机号.*members/)
  }
})

test('AA accepts native arrays and JSON strings with identical confirmation and request', async () => {
  const members = [{ phone: '13700137000', amount: 100, memo: '聚餐AA' }, { phone: '13900139000', amount: 100, memo: '聚餐AA' }]
  const allocation = { amount: 200, participants: ['乙', '丙'] }
  const prepare = (members, allocation) => prepareExtendedBankOperation('bank_create_split_collection', { title: '两元AA', currency: 'CNY', members, allocation }, { requestId: 'same-request' })
  const native = await prepare(members, allocation)
  assert.deepEqual(native, await prepare(JSON.stringify(members), JSON.stringify(allocation)))
  assert.deepEqual(native.body.members, members)
  assert.equal(native.body.confirmed, true)
  assert(native.fields.some(row => row.label === '待收总额' && row.value === 'CNY 2.00'))
  for (const invalid of ['乙,丙', '{', null, {}, [], [null], [{ phone: '乙', amount: 100, memo: 'AA' }], [{ phone: '13700137000', amount: '100', memo: 'AA' }]]) {
    await assert.rejects(prepare(invalid), /成员|数组|手机号|整数分/)
  }
})
