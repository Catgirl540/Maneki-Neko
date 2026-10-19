// Server-owned business implementation; API contract preserved from the existing client.
/* ==========================================================================
   BankApi —— 前端唯一依赖的接口面
   两套实现：createHttpApi（真后端） / createMockApi（本地模拟）
   组件只 import { api }，永远不关心背后是谁。
   ========================================================================== */
/** 与后端约定的 REST 路径表，mock 与 http 共用，保证两边不跑偏 */
export const routes = {
    login: () => '/api/auth/login',
    register: () => '/api/auth/register',
    logout: () => '/api/auth/logout',
    profile: () => '/api/auth/profile',
    accounts: () => '/api/accounts',
    account: (id) => `/api/accounts/${id}`,
    transactions: (id) => `/api/accounts/${id}/transactions`,
    /** 流水导出（后端给数据集，前端落成 CSV） */
    transactionsExport: (id) => `/api/accounts/${id}/transactions/export`,
    /** 单笔交易详情（凭证）。列表接口不下发明细字段，详情单独取 */
    transaction: (id) => `/api/transactions/${id}`,
    /** 电子回单文件（真后端返回带签名的临时下载地址） */
    receipt: (id) => `/api/transactions/${id}/receipt`,
    deposit: (id) => `/api/accounts/${id}/deposit`,
    smsCode: () => '/api/auth/sms-code',
    banks: () => '/api/banks',
    /** 本行的收款信息：别人转钱给你时照着填 */
    receiving: () => '/api/receiving',
    fpsRegistration: () => '/api/receiving/fps',
    /** 卡 BIN 查询：输卡号前缀反查发卡行（银联/网联侧的接口） */
    cardBin: () => '/api/cards/bin',
    payees: () => '/api/payees',
    fpsResolve: () => '/api/fps/resolve',
    transferQuote: () => '/api/transfers/quote',
    transferRecipient: () => '/api/transfers/recipient',
    transfers: () => '/api/transfers',
    /** 撤销在途（延迟到账窗口内）的转账指令（清单 §9.3） */
    transferRecall: (id) => `/api/transfers/${id}/recall`,
    cards: () => '/api/cards',
    /** 可申请的卡产品（费用与权益由后端给） */
    cardProducts: () => '/api/cards/products',
    cardOpen: () => '/api/cards/open',
    cardLock: (id) => `/api/cards/${id}/lock`,
    cardReplace: (id) => `/api/cards/${id}/replace`,
    cardSettings: (id) => `/api/cards/${id}/settings`,
    /** 卡安全码：单独验支付密码后取，不进卡列表接口 */
    cardSecrets: (id) => `/api/cards/${id}/secrets`,
    wealthProducts: () => '/api/wealth/products',
    wealthProduct: (code) => `/api/wealth/products/${code}`,
    wealthOverview: () => '/api/wealth/overview',
    wealthAccountOpen: () => '/api/wealth/account/open',
    wealthRiskQuestions: () => '/api/wealth/risk/questions',
    wealthRiskAssess: () => '/api/wealth/risk/assess',
    wealthSubscribe: () => '/api/wealth/subscribe',
    wealthRedeem: () => '/api/wealth/redeem',
    spending: () => '/api/analysis/spending',
    cashFlow: () => '/api/analysis/cashflow',
    autoDebits: () => '/api/autodebits',
    autoDebit: (id) => `/api/autodebits/${id}`,
    security: () => '/api/security/overview',
    securityRule: (id) => `/api/security/rules/${id}`,
    changePassword: () => '/api/security/password',
    /** 修改 / 重置支付密码 */
    paymentPassword: () => '/api/security/payment-password',
    /** 更换登录手机号（高危操作） */
    changePhone: () => '/api/auth/phone',
    verifyIdentity: () => '/api/security/verify',
    supportHistory: () => '/api/support/messages',
    supportChat: () => '/api/support/chat',
    supportTickets: () => '/api/support/tickets',
    supportTicket: (id) => `/api/support/tickets/${id}`,
    supportTicketMessages: (id) => `/api/support/tickets/${id}/messages`,
    // —— 账户域扩展：多币种划转 / 存钱计划 / 一次性卡号 ——
    exchangeQuote: () => '/api/exchange/quote',
    exchange: () => '/api/exchange',
    savingsOverview: () => '/api/savings/overview',
    savingsGoals: () => '/api/savings/goals',
    savingsGoal: (id) => `/api/savings/goals/${id}`,
    savingsRoundup: () => '/api/savings/roundup',
    virtualCard: (id) => `/api/cards/${id}/virtual`,
    // —— 我的域扩展：邀请 / 会员 / 身份认证 ——
    invitations: () => '/api/invitations',
    membership: () => '/api/membership',
    identityStatus: () => '/api/identity/status',
    identityOcr: () => '/api/identity/ocr',
    identityLiveness: () => '/api/identity/liveness',
    // —— 工资与备用金 ——
    salaryPlan: () => '/api/cashflow/salary',
    overdraft: () => '/api/cashflow/overdraft',
    overdraftActivate: () => '/api/cashflow/overdraft/activate',
    // —— 借款与分期 ——
    creditOverview: () => '/api/credit/overview',
    creditApply: () => '/api/credit/loans/apply',
    creditInstallment: (transactionId) => `/api/credit/installments/${transactionId}/plan`,
    // —— 理财扩展：现金管理 / 投资与定投 / 保险 ——
    cashManagement: () => '/api/wealth/cash-management',
    cashManagementSweep: () => '/api/wealth/cash-management/sweep',
    investments: () => '/api/wealth/investments',
    investPlan: () => '/api/wealth/investments/plan',
    insurance: () => '/api/wealth/insurance',
    insuranceEnroll: () => '/api/wealth/insurance/enroll',
};
export class ApiError extends Error {
    status;
    code;
    constructor(message, status, code) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.code = code;
    }
}
