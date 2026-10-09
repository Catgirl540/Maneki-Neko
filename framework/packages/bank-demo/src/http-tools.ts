/** 当前登录客户的 HTTP 银行工具。令牌和密码只存在桥接服务，不进入模型进程。 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ParameterSchemaSpec } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { SensitiveOperationSpec } from '@luckycat/dsh-consent/types'

const str = (description: string, required = false) => ({ type: 'string' as const, description, ...(required ? { required: true as const } : {}) })
const num = (description: string, required = false) => ({ type: 'number' as const, description, ...(required ? { required: true as const } : {}) })
const definitions: { name: string; kind: string; description: string; parameters: ParameterSchemaSpec; verification?: 'payment-password' }[] = [
  { name: 'bank_get_balance', kind: '查询账户余额', description: 'Query the authenticated customer accounts, balances, masked cards and wealth holdings from the bank backend. Confirm first. Omit accountId to list all owned accounts and their IDs.', parameters: { accountId: str('Owned account ID; omit to list all.') } },
  { name: 'bank_list_transactions', kind: '查询交易流水', description: 'List transactions from the authenticated customer account. Query account IDs first if unknown. Confirm first.', parameters: { accountId: str('Explicit owned account ID.', true), limit: num('1–20 rows, default 10.'), keyword: str('Optional search term.') } },
  { name: 'bank_get_transaction_detail', kind: '查看交易详情', description: 'Read one authenticated customer transaction receipt by ID. Confirm first.', parameters: { transactionId: str('Transaction ID returned by the backend.', true) } },
  { name: 'bank_transfer', kind: '转账', verification: 'payment-password' as const, description: 'Submit a domestic same-currency bank transfer to a FULL account number. Never transfer with only tail digits; ask for missing information. Explicit payer account, payee name, FULL account number and bank code/region are required. The server shows authoritative fees and target details and collects payment password outside the conversation. Only report success after the backend receipt.', parameters: { fromAccountId: str('Explicit owned payer account ID.', true), payeeName: str('Registered payee name.', true), payeeAccountNo: str('FULL bank account number, never only tail digits.', true), payeeBankCode: str('Bank code, e.g. LCB for this bank.', true), payeeBankRegion: str('CN or HK.', true), amountCents: num('Positive integer amount in cents.', true), memo: str('User supplied memo.') } },
  { name: 'bank_wealth_quote', kind: '查询理财产品', description: 'Query actual bank wealth products. Omit productCode to list products. Benchmarks are not promised returns. Confirm first.', parameters: { productCode: str('Product code; omit to list available products.') } },
  { name: 'bank_wealth_subscribe', kind: '申购理财产品', verification: 'payment-password' as const, description: 'Subscribe via the authenticated bank wealth account. User must already have opened the wealth account and completed risk assessment in the web page. Risk acknowledgement is copied by the user directly on the confirmation card, never generate it or collect it through chat. Server checks eligibility, amount, risk and payment password. Confirm first; no password in tool arguments.', parameters: { productCode: str('Backend product code.', true), amountCents: num('Positive integer cents.', true) } },
  { name: 'bank_wealth_redeem', kind: '赎回理财产品', verification: 'payment-password' as const, description: 'Redeem an actual customer holding. Use holdingId returned by bank_get_balance. Confirm and verify payment password first. Shares are optional; omit to redeem all. Only report the backend accepted/estimated result; do not promise settlement.', parameters: { holdingId: str('Owned wealth holding ID.', true), shares: num('Positive share count; omit for all.') } },
  { name: 'bank_reveal_card_secret', kind: '查看卡安全信息', verification: 'payment-password' as const, description: 'Show a sensitive field of an owned card in a temporary secure browser dialog after confirmation and payment-password verification. The model receives no full card number or CVV. Use cardId returned by bank_get_balance.', parameters: { cardId: str('Explicit owned card ID.', true), field: str('card-number or cvv.', true) } },
]

export const HTTP_OPERATIONS: readonly SensitiveOperationSpec[] = definitions.map(tool => ({
  toolName: tool.name, kind: tool.kind, verification: tool.verification, bindArguments: true,
  describe: () => [{ label: '确认信息', value: '由银行后端核对账户、收款信息和金额后展示。' }],
  consequence: tool.verification ? '确认并验证支付密码后提交到银行服务。' : '查询结果会显示在对话中。',
}))

export function registerHttpBankTools(ctx: Context): void {
  const base = process.env.LUCKYCAT_BANK_TOOL_URL
  const token = process.env.LUCKYCAT_INTERNAL_TOKEN
  if (!base || !token) throw new Error('HTTP 银行工具缺少可信桥接通道配置')
  for (const tool of definitions) {
    ctx.tools.register(defineTool({
      name: tool.name, description: tool.description, parameters: tool.parameters,
      output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text' as const, text: JSON.stringify(value) }] },
      async execute(args, exec): Promise<JsonValue> {
        const sessionId = exec.agent === undefined ? '' : String(exec.agent.session.id)
        if (!sessionId) throw new Error('工具调用没有登录会话')
        const response = await fetch(base, {
          method: 'POST', headers: { 'content-type': 'application/json', 'x-luckycat-internal': token },
          body: JSON.stringify({ sessionId, callId: String(exec.callId), toolName: tool.name, arguments: args }),
          signal: AbortSignal.timeout(20_000),
        })
        const result = await response.json() as { error?: string } & JsonValue
        if (!response.ok) throw new Error(result.error ?? '银行服务执行失败')
        return result
      },
    }))
  }
}
