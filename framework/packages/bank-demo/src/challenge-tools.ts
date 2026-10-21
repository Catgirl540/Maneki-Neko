/**
 * 赛题工程的工具定义。
 *
 * 为什么放包内：tsconfig 的 rootDir=src + include=[src] 逼 tool schema 必须落在
 * framework/packages/bank-demo/src/ 里。业务逻辑在 challenge/bridge/tools.mjs，
 * 这里只有 schema 文本，队友不会碰。
 *
 * 新工具必须同步加到 framework/profiles/luckycat/{cordis,doctor}.patch.yml 的
 * allowedTools，否则 check-bank-tool-policy.mjs 会拦下来。
 */
import type { ParameterSchemaSpec } from '@deepseek-ai/dsh-tools'

const str = (description: string, required = false) => ({ type: 'string' as const, description, ...(required ? { required: true as const } : {}) })
const num = (description: string, required = false) => ({ type: 'number' as const, description, ...(required ? { required: true as const } : {}) })

export const CHALLENGE_TOOL_DEFINITIONS: { name: string; kind: string; description: string; parameters: ParameterSchemaSpec; verification?: 'payment-password' }[] = [
  {
    name: 'bank_resolve_payee',
    kind: '查询收款人',
    description: 'Resolve a user-supplied person reference (nickname, relation like "my mom", partial name, phone fragment or memo keyword) into saved payees or historical transfer counterparts. Returns ranked candidates with disambiguation hints. Use this BEFORE scheduling a transfer when the recipient is not an explicit full name. Never guess the recipient; always ask when multiple candidates match.',
    parameters: {
      query: str('User-supplied reference: name, nickname, relation, phone fragment or memo keyword.', true),
    },
  },
  {
    name: 'bank_schedule_transfer',
    kind: '定时转账',
    verification: 'payment-password' as const,
    description: 'Schedule a bank transfer to execute at a future date/time. Requires explicit payer account, FULL payee account number (never tail digits only), bank code/region and amount. The confirmation card shows both the business execution time and a demo countdown. Once confirmed and password-verified, the transfer executes automatically at the scheduled time without further confirmation; it can be cancelled anytime before execution via bank_cancel_scheduled. The server re-checks balance and fees at execution time — the final debit may differ slightly from the displayed quote.',
    parameters: {
      fromAccountId: str('Explicit owned payer account ID.', true),
      payeeName: str('Registered payee name.', true),
      payeeAccountNo: str('FULL bank account number, never only tail digits.', true),
      payeeBankCode: str('Bank code, e.g. LCB.', true),
      payeeBankRegion: str('CN or HK.', true),
      amountCents: num('Positive integer amount in payer currency cents.', true),
      runAt: str('ISO 8601 date-time for execution, must be in the future.', true),
      memo: str('User supplied memo.'),
      payeeCurrency: str('CNY, HKD or USD. Ask explicitly for cross-currency; omit for same currency.'),
    },
  },
  {
    name: 'bank_list_scheduled',
    kind: '查询定时动作',
    description: 'List the customer\'s scheduled actions (timed transfers etc.) with status, countdown and cancel eligibility. Use after scheduling to confirm creation, or when the user asks about pending scheduled items. Confirm first.',
    parameters: {},
  },
  {
    name: 'bank_cancel_scheduled',
    kind: '取消定时动作',
    description: 'Cancel a pending scheduled action before it executes. Only pending actions can be cancelled; completed or failed ones cannot. Use the actionId from bank_list_scheduled. Confirm first.',
    parameters: {
      actionId: str('Scheduled action ID from bank_list_scheduled.', true),
      reason: str('User-supplied cancellation reason.'),
    },
  },
  {
    name: 'bank_list_invest_plans',
    kind: '查询定投计划',
    description: 'List the customer\'s investment plans (dollar-cost averaging) with status, cycle, next execution date, accumulated runs and total invested. plan-only: saving a plan never debits or schedules automatic execution. Use when the user asks about existing plans. bank_list_investments additionally returns the separate investment product catalog. Confirm first.',
    parameters: {},
  },
  {
    name: 'bank_pause_invest_plan',
    kind: '暂停定投计划',
    description: 'Pause an active or resume a paused investment plan by explicit status transition. Terminal plans cannot be resumed. Use the plan ID from bank_list_investments or bank_list_invest_plans. plan-only: this only changes the saved plan, never debits or refunds. Confirm first.',
    parameters: {
      planId: str('Investment plan ID from bank_list_investments or bank_list_invest_plans.', true),
    },
  },
  {
    name: 'bank_terminate_invest_plan',
    kind: '终止定投计划',
    description: 'Permanently terminate an investment plan. Terminal and irreversible — the plan cannot be resumed. Preserves investment history; does not redeem or refund. Use the plan ID from bank_list_investments or bank_list_invest_plans. Confirm first.',
    parameters: {
      planId: str('Investment plan ID from bank_list_investments or bank_list_invest_plans.', true),
    },
  },
  {
    name: 'bank_list_savings_goals',
    kind: '查询存钱目标',
    description: 'List the customer\'s savings goals with name, target amount, saved amount, progress, deadline and auto-sweep settings. Use when the user asks about savings goals or before creating one. Confirm first.',
    parameters: {},
  },
  {
    name: 'bank_create_savings_goal',
    kind: '创建存钱目标',
    description: 'Create a new savings goal with a name and target amount. Optionally set a deadline. The goal starts with zero saved. Auto-sweep can be configured separately via bank_set_savings_sweep. Confirm first.',
    parameters: {
      name: str('Goal name, e.g. "旅行基金".', true),
      targetAmountCents: num('Positive integer target amount in cents.', true),
      deadline: str('Optional deadline as YYYY-MM-DD.'),
    },
  },
  {
    name: 'bank_update_savings_goal',
    kind: '修改存钱目标',
    description: 'Update an existing savings goal\'s name, target amount or deadline. Use the goal ID from bank_list_savings_goals. Confirm first.',
    parameters: {
      goalId: str('Savings goal ID from bank_list_savings_goals.', true),
      name: str('New goal name.'),
      targetAmountCents: num('New target amount in cents.'),
      deadline: str('New deadline as YYYY-MM-DD, or "none" to remove.'),
    },
  },
  {
    name: 'bank_delete_savings_goal',
    kind: '删除存钱目标',
    description: 'Delete a savings goal permanently. The saved amount is not withdrawn or transferred — it remains in the account. Confirm first.',
    parameters: {
      goalId: str('Savings goal ID from bank_list_savings_goals.', true),
    },
  },
  {
    name: 'bank_set_savings_sweep',
    kind: '设置自动归集',
    description: 'Save, change or clear the periodic savings sweep rule (定期归集) for a savings goal: per-cycle amount, cycle and debit account. The rule is stored and can be edited or cancelled anytime; actual automatic debit is NOT yet available, so never promise a debit date or that money has moved. Use the goal ID from bank_list_savings_goals. Confirm first.',
    parameters: {
      goalId: str('Savings goal ID from bank_list_savings_goals.', true),
      enabled: str('true to enable, false to disable.', true),
      amountCents: num('Amount to sweep per cycle in cents (required when enabling).'),
      cycle: str('Sweep cycle: 每周, 每两周, or 每月 N 日 (required when enabling).'),
      accountId: str('Source account ID (required when enabling).'),
    },
  },
  {
    name: 'bank_get_cash_management',
    kind: '查询现金管理',
    description: 'Query the customer\'s cash management account status: current balance, total yield earned, 7-day annualized yield, auto-sweep setting and sweep threshold. Note: yield figures are static display values from the product catalog, not real-time calculated interest. Confirm first.',
    parameters: {},
  },
  {
    name: 'bank_update_cash_sweep',
    kind: '设置现金归集',
    description: 'Update the cash management auto-sweep rule: enable or disable it, and set the sweep threshold (minimum balance to keep in the checking account). The rule is stored and can be changed anytime; actual automatic sweep is NOT yet available, so never promise that money has moved or a transfer date. Yield figures are static display values. Confirm first.',
    parameters: {
      enabled: str('true to enable auto-sweep, false to disable.', true),
      thresholdCents: num('Minimum balance to keep in checking account in cents. Excess above this is swept to cash management.'),
    },
  },
  {
    name: 'bank_get_insurance',
    kind: '查询保险产品与保单',
    description: 'Query the customer\'s insurance products (available for purchase) and existing policies (purchased) with total coverage. Use when the user asks about insurance options or their current policies. Present product facts objectively — never recommend which product to buy. Confirm first.',
    parameters: {},
  },
  {
    name: 'bank_enroll_insurance',
    kind: '投保',
    verification: 'payment-password' as const,
    description: 'Enroll in an insurance product after the user has reviewed the terms and completed health disclosure. YOU MUST ask the three health disclosure questions and collect answers BEFORE calling this tool. If ANY answer is "yes", REFUSE enrollment and direct the user to human support (bank_request_human_support). Pass all three answers as healthAnswers. The confirmation card includes the mandatory disclaimer summary and waiting period — never omit these. Confirm first; no password in tool arguments.',
    parameters: {
      productId: str('Insurance product ID from bank_get_insurance.', true),
      insuredName: str('Insured person\'s full name.', true),
      healthAnswers: str('Three comma-separated yes/no answers to health disclosure questions (e.g. "no,no,no"). Any "yes" blocks enrollment.', true),
    },
  },
]
