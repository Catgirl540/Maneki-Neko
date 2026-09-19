/**
 * 银行示例工具（**返回值全是占位数据**）。
 *
 * 为什么返回值必须是占位：本阶段明确"不接后端"。工具如果真的返回编造的卡号、余额、
 * 回执号，模型会把它当事实转述给客户——在银行场景里这比"功能没做"更糟。
 * 所以每条结果都带 `demo: true` 与「演示占位数据」声明，回执号统一 `LCB-DEMO-` 前缀。
 *
 * 这些工具本身**不做确认**：确认与身份验证由 `@luckycat/dsh-consent` 在
 * `tools/pre-execute` 里拦截（见 specs.ts 的规则表）。分工是刻意的——
 * 工具作者不可能"忘记加确认"，因为确认不在工具里。
 *
 * @module @luckycat/dsh-bank-demo/tools
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { DemoData } from './data.ts'
import { DEMO_NOTICE, demoReference, formatCents, formatTime, maskTail } from './format.ts'

/** 工具共享的运行时状态。 */
export interface BankDemoRuntime {
  data: DemoData
  /** 回执号自增序号。 */
  nextReference: () => number
  /** 单笔转账上限（分）。 */
  transferLimitCents: number
}

/** 把结果包装成统一的 JSON 输出（每条都带演示声明）。 */
function result(payload: Record<string, JsonValue>): JsonValue {
  return { demo: true, notice: DEMO_NOTICE, ...payload }
}

/** 按账户 id 找账户；找不到返回 undefined（由调用方给出可读错误）。 */
function findAccount(data: DemoData, accountId: string) {
  return data.accounts.find(account => account.id === accountId)
}

/**
 * 解析出账账户：模型没给 id 时退回演示主账户（数据里的第一个）。
 *
 * 这是**示例消费者**的便利，不是通用行为：真实后端必须要求显式账户 id
 * （"扣哪个账户"绝不能靠默认值决定）。写在这里是为了让演示的提示词不必先教模型
 * 一个内部 id，从而把注意力留给真正要演示的确认流程。
 */
function resolveFromAccount(data: DemoData, accountId: unknown) {
  if (typeof accountId === 'string' && accountId.trim() !== '') return findAccount(data, accountId.trim())
  return data.accounts[0]
}

/** 渲染成给模型读的 JSON 文本。 */
const renderJson = (_args: unknown, value: JsonValue) => [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }]

/**
 * 注册全部演示工具。
 * @param ctx - 上下文。
 * @param runtime - 数据与限额。
 */
export function registerBankTools(ctx: Context, runtime: BankDemoRuntime): void {
  const { data } = runtime

  ctx.tools.register(defineTool({
    name: 'bank_get_balance',
    description:
      'Query one account balance (DEMO placeholder data only — this deployment is not connected to a bank backend). '
      + 'Use it when the customer asks how much money they have. It requires the customer to confirm before it runs.',
    parameters: {
      accountId: { type: 'string', description: 'Account id, e.g. "acc-cny-1". Defaults to the primary demo account.' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    execute(args): Promise<JsonValue> {
      const account = resolveFromAccount(data, args.accountId)
      if (account === undefined) {
        return Promise.resolve(result({
          error: `账户 ${args.accountId} 不存在（演示数据里只有：${data.accounts.map(a => a.id).join('、')}）`,
        }))
      }
      return Promise.resolve(result({
        accountId: account.id,
        accountName: account.name,
        cardTail: maskTail(account.tail),
        currency: account.currency,
        balance: formatCents(account.balanceCents, account.currency),
        balanceCents: account.balanceCents,
      }))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'bank_list_transactions',
    description:
      'List recent transactions of one account (DEMO placeholder data only). '
      + 'Use it when the customer asks about recent spending or a specific charge. It requires the customer to confirm before it runs.',
    parameters: {
      accountId: { type: 'string', description: 'Account id. Defaults to the primary demo account.' },
      limit: { type: 'number', description: 'How many transactions to return. Defaults to 10, maximum 20.' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    execute(args): Promise<JsonValue> {
      const account = resolveFromAccount(data, args.accountId)
      if (account === undefined) {
        return Promise.resolve(result({ error: `账户 ${args.accountId} 不存在` }))
      }
      const requested = typeof args.limit === 'number' && Number.isFinite(args.limit) ? Math.trunc(args.limit) : 10
      const limit = Math.min(20, Math.max(1, requested))
      const rows = data.transactions
        .filter(entry => entry.accountId === account.id)
        .slice(0, limit)
        .map(entry => ({
          transactionId: entry.id,
          amount: formatCents(entry.amountCents, entry.currency),
          amountCents: entry.amountCents,
          counterparty: entry.counterparty,
          category: entry.category,
          channel: entry.channel,
          occurredAt: formatTime(entry.occurredAt),
          memo: entry.memo,
        }))
      return Promise.resolve(result({
        accountId: account.id,
        accountName: account.name,
        count: rows.length,
        transactions: rows,
      }))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'bank_get_transaction_detail',
    description:
      'Read the full receipt fields of one transaction by its id (DEMO placeholder data only). '
      + 'Use it when the customer asks for the details of one specific transaction. It requires the customer to confirm before it runs.',
    parameters: {
      transactionId: { type: 'string', required: true, description: 'Transaction id, e.g. "tx-1".' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    execute(args): Promise<JsonValue> {
      const entry = data.transactions.find(item => item.id === args.transactionId)
      if (entry === undefined) {
        return Promise.resolve(result({ error: `交易 ${args.transactionId} 不存在` }))
      }
      const account = findAccount(data, entry.accountId)
      return Promise.resolve(result({
        transactionId: entry.id,
        accountId: entry.accountId,
        accountName: account?.name ?? '（未知账户）',
        amount: formatCents(entry.amountCents, entry.currency),
        amountCents: entry.amountCents,
        currency: entry.currency,
        counterparty: entry.counterparty,
        category: entry.category,
        channel: entry.channel,
        memo: entry.memo,
        occurredAt: formatTime(entry.occurredAt),
      }))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'bank_transfer',
    description:
      'Transfer money out of one account (DEMO placeholder only — no real money moves, no backend is connected). '
      + 'Before calling it, you MUST already have the payee name, the payee account tail, the amount and the memo from the customer. '
      + 'The runtime will show the customer a confirmation card and require payment-password verification; '
      + 'never ask the customer for their password yourself and never claim the transfer succeeded before the tool returns.',
    parameters: {
      fromAccountId: { type: 'string', description: 'Account id to debit. Defaults to the primary demo account.' },
      payeeName: { type: 'string', required: true, description: 'Payee name.' },
      payeeAccountTail: { type: 'string', required: true, description: 'Last digits of the payee account or FPS id.' },
      amountCents: { type: 'number', required: true, description: 'Amount in cents (integer).' },
      feeCents: { type: 'number', description: 'Fee in cents. Defaults to 0.' },
      memo: { type: 'string', description: 'Transfer memo.' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    execute(args): Promise<JsonValue> {
      const account = resolveFromAccount(data, args.fromAccountId)
      if (account === undefined) {
        return Promise.resolve(result({ error: `账户 ${args.fromAccountId} 不存在` }))
      }
      const feeCents = typeof args.feeCents === 'number' && Number.isSafeInteger(args.feeCents) ? args.feeCents : 0
      const total = args.amountCents + feeCents
      if (args.amountCents <= 0) {
        return Promise.resolve(result({ error: '转账金额必须大于 0' }))
      }
      if (total > runtime.transferLimitCents) {
        return Promise.resolve(result({
          error: `单笔上限 ${formatCents(runtime.transferLimitCents)}，本笔含手续费共 ${formatCents(total)}，已拒绝`,
        }))
      }
      if (total > account.balanceCents) {
        return Promise.resolve(result({
          error: `余额不足：可用 ${formatCents(account.balanceCents, account.currency)}，本笔需 ${formatCents(total)}`,
        }))
      }
      // 注意：**不真的扣余额**。工具是无状态占位，扣了反而会让演示数据越用越乱。
      return Promise.resolve(result({
        reference: demoReference(runtime.nextReference()),
        fromAccountId: account.id,
        fromAccountTail: maskTail(account.tail),
        payeeName: args.payeeName,
        payeeAccountTail: maskTail(args.payeeAccountTail),
        amount: formatCents(args.amountCents),
        fee: formatCents(feeCents),
        memo: args.memo ?? '',
        status: '演示：未真实扣款',
        occurredAt: formatTime(new Date().toISOString()),
      }))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'bank_wealth_quote',
    description:
      'Look up one wealth product (DEMO placeholder data only). The benchmark shown is a performance benchmark, '
      + 'not an expected return and not a promise of profit. It requires the customer to confirm before it runs.',
    parameters: {
      productCode: { type: 'string', required: true, description: 'Product code, e.g. "LC-WM-001".' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    execute(args): Promise<JsonValue> {
      const product = data.products.find(item => item.code === args.productCode)
      if (product === undefined) {
        return Promise.resolve(result({ error: `产品 ${args.productCode} 不存在` }))
      }
      return Promise.resolve(result({
        productCode: product.code,
        name: product.name,
        riskLevel: product.riskLevel,
        benchmark: product.benchmark,
        minAmount: formatCents(product.minAmountCents),
        notice: `${DEMO_NOTICE} 业绩比较基准不是预期收益率，不构成收益承诺。`,
      }))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'bank_wealth_subscribe',
    description:
      'Subscribe to a wealth product (DEMO placeholder only — no real money moves). '
      + 'Regulatory rules require the customer to copy the risk acknowledgement text verbatim and verify their payment password; '
      + 'the runtime enforces both. It requires the customer to confirm and verify before it runs.',
    parameters: {
      productCode: { type: 'string', required: true, description: 'Product code.' },
      amountCents: { type: 'number', required: true, description: 'Amount in cents (integer).' },
      riskAcknowledgement: { type: 'string', required: true, description: 'The risk acknowledgement sentence the customer copied verbatim.' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    execute(args): Promise<JsonValue> {
      const product = data.products.find(item => item.code === args.productCode)
      if (product === undefined) {
        return Promise.resolve(result({ error: `产品 ${args.productCode} 不存在` }))
      }
      if (args.amountCents < product.minAmountCents) {
        return Promise.resolve(result({ error: `起购金额 ${formatCents(product.minAmountCents)}` }))
      }
      return Promise.resolve(result({
        reference: demoReference(runtime.nextReference()),
        productCode: product.code,
        name: product.name,
        riskLevel: product.riskLevel,
        amount: formatCents(args.amountCents),
        riskAcknowledgement: args.riskAcknowledgement,
        status: '演示：未真实扣款',
      }))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'bank_wealth_redeem',
    description:
      'Redeem a wealth product (DEMO placeholder only). It requires the customer to confirm and verify their payment password before it runs.',
    parameters: {
      productCode: { type: 'string', required: true, description: 'Product code.' },
      amountCents: { type: 'number', required: true, description: 'Amount in cents (integer).' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    execute(args): Promise<JsonValue> {
      const product = data.products.find(item => item.code === args.productCode)
      if (product === undefined) {
        return Promise.resolve(result({ error: `产品 ${args.productCode} 不存在` }))
      }
      return Promise.resolve(result({
        reference: demoReference(runtime.nextReference()),
        productCode: product.code,
        name: product.name,
        amount: formatCents(args.amountCents),
        status: '演示：未真实赎回',
      }))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'bank_reveal_card_secret',
    description:
      'Reveal one sensitive card field such as the full card number or CVV (DEMO placeholder only — the returned value is NOT a real card number). '
      + 'It requires the customer to confirm and verify their payment password before it runs. '
      + 'Never ask the customer for their password yourself; the runtime collects it.',
    parameters: {
      cardTail: { type: 'string', required: true, description: 'Card tail digits identifying the card.' },
      field: { type: 'string', required: true, description: 'Which field to reveal: "card-number" or "cvv".' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    execute(args): Promise<JsonValue> {
      const label = args.field === 'cvv' ? 'CVV' : '卡号'
      const tail = args.cardTail.replace(/\D/g, '').slice(-4)
      return Promise.resolve(result({
        cardTail: maskTail(args.cardTail),
        field: args.field,
        // 刻意返回一段**不可能被误认成真值**的占位：全部是 0，并写明是占位。
        value: args.field === 'cvv' ? '000' : '0000 0000 0000 0000',
        valueNotice: `${label}为演示占位值，不是真实卡信息。`,
        // 只回显尾号（maskTail 已取尾 4 位），避免把模型给的长数字串原样带回对话。
        tailDigits: tail,
      }))
    },
  }))
}

/** 本包注册的全部工具名（用于加载期自检与配置白名单）。 */
export const BANK_TOOL_NAMES: readonly string[] = [
  'bank_get_balance',
  'bank_list_transactions',
  'bank_get_transaction_detail',
  'bank_transfer',
  'bank_wealth_quote',
  'bank_wealth_subscribe',
  'bank_wealth_redeem',
  'bank_reveal_card_secret',
]
