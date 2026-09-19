/**
 * **银行的规则表**：哪些工具算敏感操作、要给用户看什么、要不要验身份。
 *
 * 这是整个"敏感操作确认"里唯一属于业务的部分，所以它刻意放在**示例消费者包**里，
 * 而不是通用闸门 `@luckycat/dsh-consent` 里。真实银行要改规则，改这个文件（或自建同等插件）。
 *
 * 规则口径（演示版，可改）：
 *   - **转账、理财申赎、查看卡密**：属于"动钱"或"看敏感信息" → 确认 **+ 验支付密码**；
 *   - **余额、流水、交易详情、行情**：只读 → 只确认，不验密码。
 *   如果你的口径是"所有查询也要验身份"，把下面的 `verification` 字段补上即可。
 *
 * @module @luckycat/dsh-bank-demo/specs
 */

import type { SensitiveOperationSpec } from '@luckycat/dsh-consent/types'
import { formatCents, maskTail } from './format.ts'

/** 把未知参数当对象读（工具自己的 schema 已经校验过，这里只做展示）。 */
function record(args: unknown): Record<string, unknown> {
  return args !== null && typeof args === 'object' && !Array.isArray(args)
    ? args as Record<string, unknown>
    : {}
}

/** 读一个必填字符串；缺了就用「（未提供）」——展示层不该因为缺字段就抛异常。 */
function text(value: unknown): string {
  return typeof value === 'string' && value.trim() !== '' ? value : '（未提供）'
}

/** 读一个分金额。 */
function cents(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : 0
}

/**
 * 本示例声明为敏感操作的全部工具。
 *
 * 注意 `describe` 全部是纯函数：只读参数、只做格式化。它们在
 * `tools/pre-execute` 里被调用，抛异常会导致该次调用被**拒绝**（fail-closed）。
 */
export const SENSITIVE_OPERATIONS: readonly SensitiveOperationSpec[] = [
  {
    toolName: 'bank_get_balance',
    kind: '查询账户余额',
    describe: (args) => {
      const input = record(args)
      return [
        { label: '账户', value: text(input.accountId) === '（未提供）' ? '默认主账户' : text(input.accountId) },
        { label: '查询内容', value: '账户余额与可用余额' },
      ]
    },
    consequence: '查询结果会显示在对话里。',
  },

  {
    toolName: 'bank_list_transactions',
    kind: '查询交易流水',
    describe: (args) => {
      const input = record(args)
      const limit = typeof input.limit === 'number' && Number.isFinite(input.limit) ? Math.trunc(input.limit) : 10
      return [
        { label: '账户', value: text(input.accountId) === '（未提供）' ? '默认主账户' : text(input.accountId) },
        { label: '查询条数', value: String(Math.min(20, Math.max(1, limit))) },
        { label: '查询内容', value: '近期交易流水（含对手方与金额）' },
      ]
    },
    consequence: '流水含对手方名称与金额，会显示在对话里。',
  },

  {
    toolName: 'bank_get_transaction_detail',
    kind: '查看交易详情',
    describe: (args) => {
      const input = record(args)
      return [
        { label: '交易编号', value: text(input.transactionId) },
        { label: '查看内容', value: '单笔交易要素（金额、对手方、渠道、时间）' },
      ]
    },
    consequence: '交易要素会显示在对话里。',
  },

  {
    toolName: 'bank_transfer',
    kind: '转账',
    describe: (args) => {
      const input = record(args)
      return [
        { label: '付款账户', value: text(input.fromAccountId) === '（未提供）' ? '默认主账户' : text(input.fromAccountId) },
        { label: '收款人', value: text(input.payeeName) },
        { label: '收款账号', value: maskTail(text(input.payeeAccountTail)) },
        { label: '转账金额', value: formatCents(cents(input.amountCents)), emphasis: true },
        { label: '手续费', value: formatCents(cents(input.feeCents)) },
        { label: '备注', value: text(input.memo) },
      ]
    },
    verification: 'payment-password',
    consequence: '确认并验证支付密码后立即扣款，不可撤销。',
  },

  {
    toolName: 'bank_wealth_quote',
    kind: '查询理财产品',
    describe: (args) => {
      const input = record(args)
      return [
        { label: '产品代码', value: text(input.productCode) },
        { label: '查询内容', value: '产品要素与业绩比较基准' },
      ]
    },
    consequence: '业绩比较基准不是预期收益率，不构成收益承诺。',
  },

  {
    toolName: 'bank_wealth_subscribe',
    kind: '申购理财产品',
    describe: (args) => {
      const input = record(args)
      return [
        { label: '产品代码', value: text(input.productCode) },
        { label: '申购金额', value: formatCents(cents(input.amountCents)), emphasis: true },
        { label: '风险确认', value: text(input.riskAcknowledgement) },
      ]
    },
    verification: 'payment-password',
    consequence: '理财非存款、产品有风险、投资须谨慎。确认并验证支付密码后扣款，不可撤销。',
  },

  {
    toolName: 'bank_wealth_redeem',
    kind: '赎回理财产品',
    describe: (args) => {
      const input = record(args)
      return [
        { label: '产品代码', value: text(input.productCode) },
        { label: '赎回份额金额', value: formatCents(cents(input.amountCents)), emphasis: true },
      ]
    },
    verification: 'payment-password',
    consequence: '确认并验证支付密码后提交赎回，不可撤销。',
  },

  {
    toolName: 'bank_reveal_card_secret',
    kind: '查看卡安全信息',
    describe: (args) => {
      const input = record(args)
      return [
        { label: '卡片', value: maskTail(text(input.cardTail)) },
        { label: '要查看的字段', value: text(input.field) },
      ]
    },
    verification: 'payment-password',
    consequence: '卡安全信息属于敏感信息，查看行为会被记录。演示环境返回的是占位值。',
  },
]

/** 按工具名索引，便于加载期自检"声明与工具一一对应"。 */
export function specToolNames(): string[] {
  return SENSITIVE_OPERATIONS.map(spec => spec.toolName)
}
