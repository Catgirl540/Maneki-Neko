/* ==========================================================================
   BankApi —— 前端唯一依赖的接口面
   两套实现：createHttpApi（真后端） / createMockApi（本地模拟）
   组件只 import { api }，永远不关心背后是谁。
   ========================================================================== */

import type {
  Account,
  RegistrationRequest,
  RegistrationResult,
  AutoDebit,
  Bank,
  CardBinQuery,
  CardSecrets,
  ReceivingInfo,
  CardBinResolution,
  BankCard,
  CardApplication,
  CardProduct,
  ChangePhoneRequest,
  ChangePaymentPasswordRequest,
  CardReplaceRequest,
  CashFlow,
  Cents,
  ExportDataset,
  ExportQuery,
  FpsIdType,
  FpsResolveResult,
  Paged,
  Payee,
  ReceiptFile,
  SecurityOverview,
  SmsCodeResult,
  SpendReceipt,
  SpendRequest,
  SpendingAnalysis,
  SupportMessage,
  SupportReply,
  SupportTicket,
  SupportTicketDetail,
  SupportTicketPage,
  HumanSupportRequest,
  Transaction,
  TransactionCategory,
  TransactionDirection,
  RiskAssessment,
  RiskQuestion,
  TransactionRecord,
  TransferQuote,
  TransferRecipientLookup,
  TransferRecipientResult,
  TransferQuoteRequest,
  TransferRecallResult,
  TransferRequest,
  TransferResult,
  User,
  WealthAccount,
  WealthAccountOpeningRequest,
  WealthOverview,
  WealthProduct,
  WealthRedeemRequest,
  WealthRedeemResult,
  WealthSubscribeRequest,
  WealthSubscribeResult,
  Currency,
  ExchangeQuoteRequest,
  ExchangeQuote,
  ExchangeRequest,
  ExchangeResult,
  SavingsOverview,
  SavingsGoal,
  SavingsGoalRequest,
  SavingsGoalUpdate,
  SavingsRuleUpdate,
  SavingsRoundupRule,
  VirtualCardRequest,
  VirtualCard,
  CardLimitPatch,
  InvitationsOverview,
  MembershipOverview,
  SalaryPlan,
  SalaryUpdate,
  OverdraftFacility,
  CreditOverview,
  Loan,
  LoanApplyRequest,
  InstallmentPlan,
  InstallmentConvertRequest,
  CashManagement,
  CashSweepUpdate,
  InvestmentsOverview,
  InvestPlan,
  InvestPlanRequest,
  InvestPlanUpdate,
  InsuranceOverview,
  InsurancePolicy,
  InsuranceEnrollRequest,
} from './types'

/** 与后端约定的 REST 路径表，mock 与 http 共用，保证两边不跑偏 */
export const routes = {
  login: () => '/api/auth/login',
  register: () => '/api/auth/register',
  logout: () => '/api/auth/logout',
  profile: () => '/api/auth/profile',

  accounts: () => '/api/accounts',
  account: (id: string) => `/api/accounts/${id}`,
  transactions: (id: string) => `/api/accounts/${id}/transactions`,
  /** 流水导出（后端给数据集，前端落成 CSV） */
  transactionsExport: (id: string) => `/api/accounts/${id}/transactions/export`,
  /** 单笔交易详情（凭证）。列表接口不下发明细字段，详情单独取 */
  transaction: (id: string) => `/api/transactions/${id}`,
  /** 电子回单文件（真后端返回带签名的临时下载地址） */
  receipt: (id: string) => `/api/transactions/${id}/receipt`,
  deposit: (id: string) => `/api/accounts/${id}/deposit`,

  smsCode: () => '/api/auth/sms-code',

  banks: () => '/api/banks',
  /** 本行的收款信息：别人转钱给你时照着填 */
  receiving: () => '/api/receiving',
  fpsRegistration: () => '/api/receiving/fps',
  /** 卡 BIN 查询：输卡号前缀反查发卡行（银联/网联侧的接口） */
  cardBin: () => '/api/cards/bin',
  payees: () => '/api/payees',
  payee: (id: string) => `/api/payees/${id}`,
  fpsResolve: () => '/api/fps/resolve',
  transferQuote: () => '/api/transfers/quote',
  transferRecipient: () => '/api/transfers/recipient',
  transfers: () => '/api/transfers',
  /** 撤销在途（延迟到账窗口内）的转账指令（清单 §9.3） */
  transferRecall: (id: string) => `/api/transfers/${id}/recall`,

  cards: () => '/api/cards',
  /** 可申请的卡产品（费用与权益由后端给） */
  cardProducts: () => '/api/cards/products',
  cardOpen: () => '/api/cards/open',
  cardLock: (id: string) => `/api/cards/${id}/lock`,
  cardReplace: (id: string) => `/api/cards/${id}/replace`,
  cardSettings: (id: string) => `/api/cards/${id}/settings`,
  cardSpend: (id: string) => `/api/cards/${id}/spend`,
  cardActivate: (id: string) => `/api/cards/${id}/activate`,
  /** 卡安全码：单独验支付密码后取，不进卡列表接口 */
  cardSecrets: (id: string) => `/api/cards/${id}/secrets`,

  wealthProducts: () => '/api/wealth/products',
  wealthProduct: (code: string) => `/api/wealth/products/${code}`,
  wealthOverview: () => '/api/wealth/overview',
  wealthAccountOpen: () => '/api/wealth/account/open',
  wealthRiskQuestions: () => '/api/wealth/risk/questions',
  wealthRiskAssess: () => '/api/wealth/risk/assess',
  wealthSubscribe: () => '/api/wealth/subscribe',
  wealthRedeem: () => '/api/wealth/redeem',

  spending: () => '/api/analysis/spending',
  cashFlow: () => '/api/analysis/cashflow',
  autoDebits: () => '/api/autodebits',
  autoDebit: (id: string) => `/api/autodebits/${id}`,

  security: () => '/api/security/overview',
  securityRule: (id: string) => `/api/security/rules/${id}`,
  changePassword: () => '/api/security/password',
  /** 修改 / 重置支付密码 */
  paymentPassword: () => '/api/security/payment-password',
  /** 更换登录手机号（高危操作） */
  changePhone: () => '/api/auth/phone',
  verifyIdentity: () => '/api/security/verify',

  supportHistory: () => '/api/support/messages',
  supportChat: () => '/api/support/chat',
  supportTickets: () => '/api/support/tickets',
  supportTicket: (id: string) => `/api/support/tickets/${id}`,
  supportTicketMessages: (id: string) => `/api/support/tickets/${id}/messages`,

  // —— 账户域扩展：多币种划转 / 存钱计划 / 一次性卡号 ——
  exchangeQuote: () => '/api/exchange/quote',
  exchange: () => '/api/exchange',
  savingsOverview: () => '/api/savings/overview',
  savingsGoals: () => '/api/savings/goals',
  savingsGoal: (id: string) => `/api/savings/goals/${id}`,
  savingsRoundup: () => '/api/savings/roundup',
  virtualCard: (id: string) => `/api/cards/${id}/virtual`,

  // —— 我的域扩展：邀请 / 会员 ——
  invitations: () => '/api/invitations',
  membership: () => '/api/membership',
  /** 核销一次机场 / 高铁贵宾厅额度（年度次数） */
  membershipLoungePass: () => '/api/membership/lounge-pass',

  // —— 工资与备用金 ——
  salaryPlan: () => '/api/cashflow/salary',
  overdraft: () => '/api/cashflow/overdraft',
  overdraftActivate: () => '/api/cashflow/overdraft/activate',

  // —— 借款与分期 ——
  creditOverview: () => '/api/credit/overview',
  creditApply: () => '/api/credit/loans/apply',
  creditInstallment: (transactionId: string) => `/api/credit/installments/${transactionId}/plan`,

  // —— 理财扩展：现金管理 / 投资与定投 / 保险 ——
  cashManagement: () => '/api/wealth/cash-management',
  cashManagementSweep: () => '/api/wealth/cash-management/sweep',
  investments: () => '/api/wealth/investments',
  investPlan: () => '/api/wealth/investments/plan',
  investPlanStatus: (id: string) => `/api/wealth/investments/plan/${id}`,
  insurance: () => '/api/wealth/insurance',
  insuranceEnroll: () => '/api/wealth/insurance/enroll',
} as const

export interface TransactionQuery {
  page?: number
  size?: number
  category?: TransactionCategory | 'all'
  keyword?: string
  /** 多币种对账：按币种筛选流水 */
  currency?: Currency | 'all'
  /**
   * 收支方向：`in` 收入 / `out` 支出，`all`（或省略）表示不限。
   * 服务端按记账行的 `direction` 过滤，分页总数同口径 —— 不能在前端对当前页过滤。
   */
  direction?: TransactionDirection | 'all'
  /** 起始本地日 `YYYY-MM-DD`（含当天）；省略表示不限 */
  from?: string
  /** 截止本地日 `YYYY-MM-DD`（含当天）；省略表示不限 */
  to?: string
}

export interface BankApi {
  // —— 身份 ——
  /**
   * 登录。**三步都要过**：手机号格式、密码、短信验证码。
   * @param phone - 11 位手机号。
   * @param password - 登录密码。
   * @param smsCode - 短信验证码；先调 `sendSmsCode(phone)` 拿。
   */
  login(phone: string, password: string, smsCode: string): Promise<{ token: string; user: User }>
  /** 注册成功同时开立唯一的储蓄账户并返回登录态。 */
  register(req: RegistrationRequest): Promise<RegistrationResult>
  logout(): Promise<void>
  profile(): Promise<User>

  // —— 账户与流水 ——
  listAccounts(): Promise<Account[]>
  getAccount(id: string): Promise<Account>
  listTransactions(accountId: string, query?: TransactionQuery): Promise<Paged<Transaction>>
  /** 导出流水数据集（后端给列与已格式化的值，前端落成 CSV） */
  exportTransactions(accountId: string, query?: ExportQuery): Promise<ExportDataset>
  /** 单笔交易详情：交易编号、渠道、汇率、交易前后余额等凭证要素 */
  getTransaction(id: string): Promise<TransactionRecord>
  /** 电子回单文件。演示环境 url 为 null，调用方需退回浏览器打印 */
  getReceipt(id: string): Promise<ReceiptFile>
  deposit(accountId: string, amount: Cents, channel: string): Promise<Account>

  // —— 开户 ——
  /** 发送短信验证码。演示环境会回传 demoCode，真后端不会 */
  sendSmsCode(phone: string): Promise<SmsCodeResult>

  // —— 转账 ——
  listBanks(): Promise<Bank[]>
  /** 我的收款信息（户名 / 账户 / 转数快标识），由后端按账户与登记拼好 */
  getReceivingInfo(): Promise<ReceivingInfo>
  registerFps(req: { idType: FpsIdType; id: string; accountId: string; region: 'HK'; currency: 'HKD'; paymentPassword: string }): Promise<ReceivingInfo>
  /** 卡 BIN 查询：卡号前缀 → 发卡行。前缀不认识时明确回 unsupported，界面据此提示 */
  resolveCardBin(req: CardBinQuery): Promise<CardBinResolution>
  listPayees(): Promise<Payee[]>
  /** 删除一条历史收款人；不存在时 404 */
  deletePayee(id: string): Promise<void>
  /** 转数快标识解析：查收款人姓名与收款银行 */
  resolveFps(idType: FpsIdType, fpsId: string): Promise<FpsResolveResult>
  quoteTransfer(req: TransferQuoteRequest): Promise<TransferQuote>
  resolveTransferRecipient(req: TransferRecipientLookup): Promise<TransferRecipientResult>
  submitTransfer(req: TransferRequest): Promise<TransferResult>
  /**
   * 撤销在途转账（清单 §9.3）：延迟到账窗口内，用户随时可以自己撤回。
   * 超窗或已到账 → 409。资金侧只解除冻结，不发生扣款。
   */
  recallTransfer(transactionId: string): Promise<TransferRecallResult>

  // —— 银行卡 ——
  listCards(): Promise<BankCard[]>
  /** 开卡：申请一张新的借记卡，初始状态为待激活 */
  /** 可申请的卡产品列表 */
  listCardProducts(): Promise<CardProduct[]>
  /** 申请新卡：要扣制卡费、要寄送地址、要支付密码 */
  openCard(req: CardApplication): Promise<BankCard>
  setCardLock(id: string, locked: boolean): Promise<BankCard>
  /** 换卡同样要寄卡，所以也要地址与支付密码 */
  replaceCard(id: string, req: CardReplaceRequest): Promise<BankCard>
  /** 查看卡安全码：必须带支付密码；卡未寄到 / 已换卡时拒绝 */
  revealCardSecrets(id: string, paymentPassword: string): Promise<CardSecrets>
  updateCardSettings(
    id: string,
    patch: Partial<
      Pick<
        BankCard,
        | 'onlinePayment'
        | 'overseasPayment'
        | 'dailyLimit'
        | 'paymentEnabled'
        | 'channelLimits'
        | 'merchantLimits'
      >
    > & CardLimitPatch,
  ): Promise<BankCard>
  /** 模拟消费：预设商户刷卡，从卡绑定账户扣款；分类由服务端分类器判定 */
  spendOnCard(id: string, req: SpendRequest): Promise<SpendReceipt>
  /** 激活卡片：收到实体卡后启用（待激活 → 使用中），需支付密码 */
  activateCard(id: string, paymentPassword: string): Promise<BankCard>

  // —— 理财（投资与资产）——
  listWealthProducts(): Promise<WealthProduct[]>
  getWealthProduct(code: string): Promise<WealthProduct>
  getWealthOverview(): Promise<WealthOverview>
  /** 开立理财账户（投资账户）。未开立前不能申购 */
  openWealthAccount(req: WealthAccountOpeningRequest): Promise<WealthAccount>
  listRiskQuestions(): Promise<RiskQuestion[]>
  /** 提交风险承受能力测评；监管要求超过一年须重做 */
  submitRiskAssessment(answers: number[]): Promise<RiskAssessment>
  /** 申购：适当性匹配 + 抄录风险确认语句 + 支付密码，一个都不能少 */
  subscribeWealth(req: WealthSubscribeRequest): Promise<WealthSubscribeResult>
  redeemWealth(req: WealthRedeemRequest): Promise<WealthRedeemResult>

  // —— 财务管理 ——
  getSpending(month?: string): Promise<SpendingAnalysis>
  getCashFlow(days?: number): Promise<CashFlow>
  listAutoDebits(): Promise<AutoDebit[]>
  setAutoDebitEnabled(id: string, enabled: boolean): Promise<AutoDebit>

  // —— 安全中心 ——
  getSecurityOverview(): Promise<SecurityOverview>
  setSecurityRule(id: string, enabled: boolean): Promise<SecurityOverview>
  changePassword(oldPassword: string, newPassword: string): Promise<void>
  /** 修改或重置支付密码：原密码修改 / 人脸核身重置 */
  changePaymentPassword(req: ChangePaymentPasswordRequest): Promise<void>
  /** 更换登录手机号：人脸核身 + 新号短信验证 */
  changePhone(req: ChangePhoneRequest): Promise<User>
  verifyIdentity(channel: 'sms' | 'face'): Promise<{ ticket: string }>

  // —— 智能客服（MVP 为固定话术，后续换真实模型）——
  listSupportMessages(): Promise<SupportMessage[]>
  sendSupportMessage(text: string): Promise<SupportReply>
  requestHumanSupport(req: HumanSupportRequest): Promise<SupportTicket>
  listSupportTickets(page?: number): Promise<SupportTicketPage>
  getSupportTicket(id: string): Promise<SupportTicketDetail>
  replySupportTicket(id: string, req: { requestId: string; text: string }): Promise<{ messageId: string }>

  // —— 账户域扩展 ——
  /** 账户内部换汇报价（区别于向外部账户转账）。锁价口径同转账。 */
  quoteExchange(req: ExchangeQuoteRequest): Promise<ExchangeQuote>
  /** 执行账户内部换汇；目标币种账户不存在时后端自动开立。 */
  submitExchange(req: ExchangeRequest): Promise<ExchangeResult>
  /** 存钱计划总览：目标、凑整规则、打卡、奖励 */
  getSavingsOverview(): Promise<SavingsOverview>
  createSavingsGoal(req: SavingsGoalRequest): Promise<SavingsGoal>
  updateSavingsGoal(id: string, req: SavingsGoalUpdate): Promise<SavingsGoal>
  deleteSavingsGoal(id: string): Promise<void>
  updateSavingsRoundup(req: SavingsRuleUpdate): Promise<SavingsRoundupRule>
  /** 卡详情生成动态一次性卡号 */
  createVirtualCard(id: string, req: VirtualCardRequest): Promise<VirtualCard>

  // —— 我的域扩展 ——
  getInvitations(): Promise<InvitationsOverview>
  getMembership(): Promise<MembershipOverview>
  /** 核销一次机场 / 高铁贵宾厅额度；额度耗尽返回 409 LOUNGE_QUOTA_EXHAUSTED */
  redeemLoungePass(): Promise<MembershipOverview>


  // —— 工资与备用金 ——
  getSalaryPlan(): Promise<SalaryPlan>
  updateSalary(req: SalaryUpdate): Promise<SalaryPlan>
  getOverdraft(): Promise<OverdraftFacility>
  activateOverdraft(active: boolean): Promise<OverdraftFacility>

  // —— 借款与分期 ——
  getCreditOverview(): Promise<CreditOverview>
  applyLoan(req: LoanApplyRequest): Promise<Loan>
  convertToInstallment(transactionId: string, req: InstallmentConvertRequest): Promise<InstallmentPlan>

  // —— 理财扩展 ——
  getCashManagement(): Promise<CashManagement>
  updateCashSweep(req: CashSweepUpdate): Promise<CashManagement>
  getInvestments(): Promise<InvestmentsOverview>
  createInvestPlan(req: InvestPlanRequest): Promise<InvestPlan>
  updateInvestPlan(id: string, req: InvestPlanUpdate): Promise<InvestPlan>
  getInsurance(): Promise<InsuranceOverview>
  enrollInsurance(req: InsuranceEnrollRequest): Promise<InsurancePolicy>
}

export class ApiError extends Error {
  readonly status: number
  readonly code?: string

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}
