/** 网页表单与展示函数；不启动或写入银行后端。 */
import assert from 'node:assert/strict'
import { parseAmountInput } from '../app/src/lib/amountInput.ts'
for (const [input, cents] of [['100.01', 10001], ['0', 0], ['.50', 50], ['1.', 100]]) {
  assert.equal(parseAmountInput(input), cents)
}
for (const input of ['', '.', '1.2.3', '12abc', '1e4', '-1', '1.001', '999999999999999999999999']) {
  assert.equal(parseAmountInput(input), null, input)
}
console.log('PASS 金额完整解析、两位小数、安全整数')
