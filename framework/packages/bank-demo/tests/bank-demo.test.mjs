/**
 * 银行示例消费者的离线测试：数据校验、金额格式、敏感操作规则表。
 *
 * 关键断言（安全相关）：
 *   · 规则表与工具表一一对应（漏一条 = 某工具绕过确认闸门）；
 *   · 展示字段里不出现完整卡号/CVV；
 *   · 每条 `describe` 都是纯函数、缺字段也不抛异常（抛了会被闸门转成拒绝）。
 *
 * 跑法：node --test packages/bank-demo/tests/bank-demo.test.mjs
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  BANK_TOOL_NAMES,
  SENSITIVE_OPERATIONS,
  formatCents,
  formatTime,
  loadDemoData,
  maskTail,
  specToolNames,
} from '../lib/index.js'

const DATA_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../demo-data.json')

/**
 * 把演示数据改一处、写进临时文件、跑一段断言、再删掉。
 * 用来验证"加载期校验真的会拦"，而不是只验证正常路径能过。
 * @param mutate - 就地修改解析出来的数据。
 * @param pattern - 期望 loadDemoData 抛出的错误。
 */
function withMutatedData(mutate, pattern) {
  const data = JSON.parse(readFileSync(DATA_PATH, 'utf8'))
  mutate(data)
  const tmp = path.join(path.dirname(DATA_PATH), `.tmp-mutated-${process.pid}-${Math.random().toString(36).slice(2)}.json`)
  writeFileSync(tmp, JSON.stringify(data))
  try {
    assert.throws(() => loadDemoData(tmp), pattern)
  } finally {
    rmSync(tmp, { force: true })
  }
}

describe('loadDemoData（加载期校验，fail loud）', () => {
  it('读出账户、流水与产品', () => {
    const data = loadDemoData(DATA_PATH)
    assert.ok(data.accounts.length >= 2)
    assert.ok(data.transactions.length >= 4)
    assert.ok(data.products.length >= 2)
    assert.equal(data.accounts[0].id, 'acc-cny-1')
  })

  it('路径不存在时明确报错', () => {
    assert.throws(() => loadDemoData('/nonexistent/demo-data.json'), /读不到文件/)
  })

  it('JSON 坏了时明确报错', () => {
    assert.throws(() => loadDemoData(fileURLToPath(import.meta.url)), /不是合法 JSON/)
  })

  it('流水引用不存在的账户时报错（引用完整性）', () => {
    withMutatedData((data) => { data.transactions[0].accountId = 'acc-does-not-exist' }, /引用了不存在的账户/)
  })

  it('金额不是整数时报错（金额一律用「分」）', () => {
    withMutatedData((data) => { data.accounts[0].balanceCents = 12.5 }, /必须是整数/)
  })

  it('风险等级非法时报错', () => {
    withMutatedData((data) => { data.products[0].riskLevel = 'R9' }, /riskLevel 非法/)
  })
})

describe('formatCents', () => {
  it('分转元并加千分位', () => {
    assert.equal(formatCents(80_000), '800.00 CNY')
    assert.equal(formatCents(1_286_450), '12,864.50 CNY')
    assert.equal(formatCents(0), '0.00 CNY')
    assert.equal(formatCents(-38_800), '-388.00 CNY')
    assert.equal(formatCents(1), '0.01 CNY')
  })

  it('可以换币种', () => {
    assert.equal(formatCents(86_420, 'HKD'), '864.20 HKD')
  })
})

describe('maskTail / formatTime', () => {
  it('只保留尾号，不补全成完整卡号', () => {
    assert.equal(maskTail('6688'), '**** 6688')
  })

  it('ISO 时刻格式化成分钟精度', () => {
    assert.match(formatTime('2026-09-15T10:24:00+08:00'), /^2026-09-15 \d{2}:\d{2}$/)
  })

  it('无法解析的时刻原样返回（不抛异常）', () => {
    assert.equal(formatTime('不是时间'), '不是时间')
  })
})

describe('敏感操作规则表', () => {
  it('规则与工具一一对应（漏一条就是绕过闸门）', () => {
    assert.deepEqual(specToolNames().sort(), [...BANK_TOOL_NAMES].sort())
  })

  it('转账、理财申赎、查看卡密必须验支付密码', () => {
    const requireVerify = ['bank_transfer', 'bank_wealth_subscribe', 'bank_wealth_redeem', 'bank_reveal_card_secret']
    for (const tool of requireVerify) {
      const spec = SENSITIVE_OPERATIONS.find(item => item.toolName === tool)
      assert.equal(spec?.verification, 'payment-password', `${tool} 必须要求支付密码验证`)
    }
  })

  it('只读查询只确认、不验密码（当前口径）', () => {
    const readOnly = ['bank_get_balance', 'bank_list_transactions', 'bank_get_transaction_detail', 'bank_wealth_quote']
    for (const tool of readOnly) {
      const spec = SENSITIVE_OPERATIONS.find(item => item.toolName === tool)
      assert.equal(spec?.verification, undefined, `${tool} 当前口径不要求验证`)
    }
  })

  it('每条规则都有 kind 与至少一个展示字段', () => {
    for (const spec of SENSITIVE_OPERATIONS) {
      assert.ok(spec.kind.trim() !== '', `${spec.toolName} 缺 kind`)
      assert.ok(spec.describe({}).length > 0, `${spec.toolName} 没有展示字段`)
    }
  })

  it('describe 是纯函数：同样的输入给同样的输出', () => {
    const spec = SENSITIVE_OPERATIONS.find(item => item.toolName === 'bank_transfer')
    const args = { fromAccountId: 'acc-cny-1', payeeName: '梁乐怡', payeeAccountTail: '9123', amountCents: 80_000, feeCents: 80, memo: '房租' }
    assert.deepEqual(spec.describe(args), spec.describe(args))
  })

  it('describe 在参数缺失时不抛异常（抛了会被闸门转成拒绝）', () => {
    for (const spec of SENSITIVE_OPERATIONS) {
      assert.doesNotThrow(() => spec.describe(undefined), `${spec.toolName} 在 undefined 参数下抛异常`)
      assert.doesNotThrow(() => spec.describe(null), `${spec.toolName} 在 null 参数下抛异常`)
      assert.doesNotThrow(() => spec.describe({}), `${spec.toolName} 在空对象下抛异常`)
    }
  })

  it('转账的展示信息含收款人、金额与手续费', () => {
    const spec = SENSITIVE_OPERATIONS.find(item => item.toolName === 'bank_transfer')
    const fields = spec.describe({
      fromAccountId: 'acc-cny-1',
      payeeName: '梁乐怡',
      payeeAccountTail: '9123',
      amountCents: 80_000,
      feeCents: 80,
      memo: '房租',
    })
    const byLabel = Object.fromEntries(fields.map(field => [field.label, field.value]))
    assert.equal(byLabel['收款人'], '梁乐怡')
    assert.equal(byLabel['转账金额'], '800.00 CNY')
    assert.equal(byLabel['手续费'], '0.80 CNY')
    assert.equal(byLabel['收款账号'], '**** 9123')
    assert.equal(byLabel['备注'], '房租')
  })

  it('金额字段被标成 emphasis（界面上要强调）', () => {
    const spec = SENSITIVE_OPERATIONS.find(item => item.toolName === 'bank_transfer')
    const fields = spec.describe({ amountCents: 1 })
    assert.equal(fields.find(field => field.label === '转账金额')?.emphasis, true)
  })
})

describe('敏感值占位（不允许出现像真卡号的东西）', () => {
  it('演示数据文件里没有完整卡号 / CVV / 支付密码字段', () => {
    const raw = readFileSync(DATA_PATH, 'utf8')
    for (const forbidden of ['cardNumber', 'cvv', 'CVV', 'paymentPassword', 'payPassword', 'idNumber']) {
      assert.ok(!raw.includes(forbidden), `演示数据里出现了 ${forbidden} 字段`)
    }
    // 也不该出现连续的 13–19 位数字（像真卡号）
    assert.ok(!/\d{13,19}/.test(raw), '演示数据里出现了长数字串（像真卡号）')
  })

  it('规则表的展示字段里没有长数字串', () => {
    for (const spec of SENSITIVE_OPERATIONS) {
      const rendered = spec.describe({
        fromAccountId: 'acc-cny-1',
        payeeName: '甲',
        payeeAccountTail: '1234567890123456',
        amountCents: 1,
        cardTail: '1234567890123456',
        productCode: 'X',
        transactionId: 'tx-1',
        field: 'cvv',
        memo: 'm',
        riskAcknowledgement: 'r',
      })
      for (const field of rendered) {
        assert.ok(
          !/\d{13,19}/.test(field.value),
          `${spec.toolName} 的「${field.label}」里出现了长数字串：${field.value}`,
        )
      }
    }
  })
})
