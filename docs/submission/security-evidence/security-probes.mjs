/** 本地特征核查；仅使用合成数据，不连接业务库或外部模型。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { toCsv } from '../../../shared/csv.mjs'
import { createExportStore } from '../../../server/export-store.mjs'
import { createDataCipher } from '../../../server/database-crypto.mjs'
import { createCredentialGuard } from '../../../framework/bridge/credential-guard.mjs'
import { prepareExtendedBankOperation } from '../../../framework/bridge/extended-bank-tools.mjs'

test('R01: CSV neutralizes formula-leading untrusted cells', () => {
  const csv = toCsv([{ key: 'memo', label: '备注' }], [{ memo: '=1+1' }])
  assert(csv.includes("\r\n'=1+1\r\n"))
})
test('R02: export capability requires the exact owner and resists foreign consumption', () => {
  const store = createExportStore()
  const { token } = store.put({ ownerId: 'synthetic-owner', fileName: 'fixture.csv', csv: 'fixture' })
  assert.equal(store.take(token), null)
  assert.equal(store.take(token, 'different-owner'), null)
  assert.equal(store.take(token, 'synthetic-owner').ownerId, 'synthetic-owner')
  assert.equal(store.take(token), null)
})
test('data cipher authenticates ownership context and detects ciphertext changes', () => {
  const previous = process.env.BANK_DATA_KEY
  process.env.BANK_DATA_KEY = randomBytes(32).toString('base64')
  try {
    const cipher = createDataCipher(':memory:'), encoded = cipher.seal({ fixture: true }, 'synthetic:one')
    assert.deepEqual(cipher.open(encoded, 'synthetic:one'), { fixture: true })
    assert.throws(() => cipher.open(encoded, 'synthetic:two'))
    const bytes = Buffer.from(encoded.slice(10), 'base64url'); bytes[bytes.length - 1] ^= 1
    assert.throws(() => cipher.open('aesgcm:v1:' + bytes.toString('base64url'), 'synthetic:one'))
  } finally { if (previous === undefined) delete process.env.BANK_DATA_KEY; else process.env.BANK_DATA_KEY = previous }
})
test('R03: empty text returns without invoking credential decision model', async () => {
  let calls = 0
  await createCredentialGuard({ endpoints: [], fetcher: async () => { calls++; throw Error('not used') } })('')
  assert.equal(calls, 0)
})
test('R07: AA confirmation includes the self share and preserves allocation', async () => {
  const review = await prepareExtendedBankOperation('bank_create_split_collection', {
    title: 'synthetic', currency: 'CNY',
    allocation: { collectorName: '甲', expenses: [{ title: '合成活动', amount: 200, participants: ['甲', '乙'] }] },
    members: [{ phone: '13700137000', amount: 100, memo: 'synthetic' }],
  }, { requestId: 'synthetic-audit' })
  assert.equal(review.body.allocation.expenses[0].amount, 200)
  assert.equal(review.fields.some(row => row.label === '本人份额'), true)
})
