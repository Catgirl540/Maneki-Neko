import { ApiError, type BankApi, type TransactionQuery } from './contract'
import { routes } from './contract'
import type {
  Account,
  AutoDebit,
  BankCard,
  CardProduct,
  Cents,
  ExportQuery,
  BudgetsOverview,
  Payee,
  ReceiptFile,
  TransactionRecord,
  TransferQuoteRequest,
  TransferRecallResult,
  TransferRequest,
  User,
} from './types'
import { AUTH_EXPIRED_EVENT, forgetSession, getAuthToken } from '@/lib/authToken'

const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').trim().replace(/\/+$/, '')
const REQUEST_TIMEOUT_MS = 12_000

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getAuthToken()
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(BASE_URL + path, {
      ...init,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
    })
    const text = await res.text()
    let payload: unknown = null
    if (text) {
      try { payload = JSON.parse(text) }
      catch {
        throw new ApiError('银行接口返回了无效响应，请检查后端服务与 /api 代理配置', res.status || 502, 'INVALID_RESPONSE')
      }
    }
    if (!res.ok) {
      const body = payload as { message?: string; code?: string } | null
      if (res.status === 401 && token && (body?.code === 'UNAUTHORIZED' || (!body?.code && path !== routes.login()))) {
        forgetSession()
        window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT))
      }
      throw new ApiError(body?.message ?? `请求失败（${res.status}）`, res.status, body?.code)
    }
    return payload as T
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError(controller.signal.aborted ? '银行服务响应超时，请稍后重试' : '无法连接银行服务，请检查网络或后端是否启动', 0, controller.signal.aborted ? 'TIMEOUT' : 'NETWORK_ERROR')
  } finally {
    window.clearTimeout(timer)
  }
}

const post = <T,>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })

const patch = <T,>(path: string, body?: unknown) =>
  request<T>(path, { method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) })

const del = <T,>(path: string, body?: unknown) =>
  request<T>(path, { method: 'DELETE', body: body === undefined ? undefined : JSON.stringify(body) })

/**
 * 真后端实现。后端就绪后只需设置 VITE_API_BASE_URL（或走 vite proxy），
 * 业务代码与 mock 实现完全一致。
 */
export function createHttpApi(): BankApi {
  return {
    login: (phone, password, smsCode) => post(routes.login(), { phone, password, smsCode }),
    register: (req) => post(routes.register(), req),
    logout: () => post<void>(routes.logout()),
    profile: () => request<User>(routes.profile()),

    listAccounts: () => request<Account[]>(routes.accounts()),
    getAccount: (id) => request<Account>(routes.account(id)),
    listTransactions: (id, query: TransactionQuery = {}) => {
      const params = new URLSearchParams()
      if (query.page) params.set('page', String(query.page))
      if (query.size) params.set('size', String(query.size))
      if (query.category && query.category !== 'all') params.set('category', query.category)
      if (query.keyword) params.set('keyword', query.keyword)
      if (query.currency && query.currency !== 'all') params.set('currency', query.currency)
      if (query.direction && query.direction !== 'all') params.set('direction', query.direction)
      if (query.from) params.set('from', query.from)
      if (query.to) params.set('to', query.to)
      const qs = params.toString()
      return request(routes.transactions(id) + (qs ? `?${qs}` : ''))
    },
    exportTransactions: (id, query: ExportQuery = {}) => {
      const params = new URLSearchParams()
      if (query.from) params.set('from', query.from)
      if (query.to) params.set('to', query.to)
      if (query.category && query.category !== 'all') params.set('category', query.category)
      if (query.keyword) params.set('keyword', query.keyword)
      if (query.currency && query.currency !== 'all') params.set('currency', query.currency)
      if (query.direction && query.direction !== 'all') params.set('direction', query.direction)
      const qs = params.toString()
      return request(routes.transactionsExport(id) + (qs ? `?${qs}` : ''))
    },
    getTransaction: (id) => request<TransactionRecord>(routes.transaction(id)),
    getReceipt: (id) => request<ReceiptFile>(routes.receipt(id)),
    deposit: (id, amount, channel) => post(routes.deposit(id), { amount, channel }),

    sendSmsCode: (phone) => post(routes.smsCode(), { phone }),

    listBanks: () => request(routes.banks()),
    getReceivingInfo: () => request(routes.receiving()),
    registerFps: (req) => post(routes.fpsRegistration(), req),
    resolveCardBin: (req) => post(routes.cardBin(), req),
    listPayees: (keyword) => request<Payee[]>(routes.payees() + (keyword ? `?keyword=${encodeURIComponent(keyword)}` : '')),
    updatePayeeRemark: (id, remark) => patch(routes.payee(encodeURIComponent(id)), { remark }),
    listScheduledTransfers: () => request(routes.scheduledTransfers()),
    createScheduledTransfer: req => post(routes.scheduledTransfers(), req),
    cancelScheduledTransfer: (id, version) => del(routes.scheduledTransfer(encodeURIComponent(id)), { version }),
    listSplitCollections: () => request(routes.splitCollections()),
    listSplitPaymentRequests: () => request(routes.splitPaymentRequests()),
    paySplitRequest: (id, input) => post(routes.splitPay(encodeURIComponent(id)), input),
    createSplitCollection: req => post(routes.splitCollections(), req),
    cancelSplitCollection: (id, version) => del(routes.splitCollection(encodeURIComponent(id)), { version }),
    confirmSplitPayment: (id, req) => post(routes.splitPayment(encodeURIComponent(id)), req),
    remindSplitParticipant: (id, req) => post(routes.splitReminder(encodeURIComponent(id)), req),
    getBillingReport: query => request(routes.billingReport() + '?' + new URLSearchParams({ ...query })),
    exportBillingReport: query => request(routes.billingReportExport() + '?' + new URLSearchParams({ ...query })),
    deletePayee: (id) => del<void>(routes.payee(id)),
    resolveFps: (idType, fpsId) => post(routes.fpsResolve(), { idType, fpsId }),
    quoteTransfer: (req: TransferQuoteRequest) => post(routes.transferQuote(), req),
    resolveTransferRecipient: (req) => post(routes.transferRecipient(), req),
    submitTransfer: async (req: TransferRequest) => {
      const support = await request<{ transferPaymentPassword?: boolean }>("/api/agent/transfer/requirements")
      if (support.transferPaymentPassword !== true) throw new ApiError("银行服务暂不支持转账支付密码保护，请稍后再试", 503, "TRANSFER_SECURITY_UNAVAILABLE")
      return post(routes.transfers(), req)
    },
    recallTransfer: (transactionId: string) =>
      post<TransferRecallResult>(routes.transferRecall(transactionId), {}),

    listCards: () => request<BankCard[]>(routes.cards()),
    listCardProducts: () => request<CardProduct[]>(routes.cardProducts()),
    openCard: (req) => post(routes.cardOpen(), req),
    setCardLock: (id, locked) => post(routes.cardLock(id), { locked }),
    reportCardLost: (id, paymentPassword) => post(routes.cardLost(id), { paymentPassword }),
    recoverCard: (id, paymentPassword) => post(routes.cardRecover(id), { paymentPassword }),
    replaceCard: (id, req) => post(routes.cardReplace(id), req),
    revealCardSecrets: (id, paymentPassword) => post(routes.cardSecrets(id), { paymentPassword }),
    updateCardSettings: (id, body) => patch(routes.cardSettings(id), body),
    spendOnCard: (id, req) => post(routes.cardSpend(id), req),
    activateCard: (id, paymentPassword) => post(routes.cardActivate(id), { paymentPassword }),

    listWealthProducts: () => request(routes.wealthProducts()),
    getWealthProduct: (code) => request(routes.wealthProduct(code)),
    getWealthOverview: () => request(routes.wealthOverview()),
    openWealthAccount: (req) => post(routes.wealthAccountOpen(), req),
    listRiskQuestions: () => request(routes.wealthRiskQuestions()),
    submitRiskAssessment: (answers) => post(routes.wealthRiskAssess(), { answers }),
    subscribeWealth: (req) => post(routes.wealthSubscribe(), req),
    redeemWealth: (req) => post(routes.wealthRedeem(), req),

    getSpending: (month) =>
      request(routes.spending() + (month ? `?month=${month}` : '')),
    getCashFlow: (days) =>
      request(routes.cashFlow() + (days ? `?days=${days}` : '')),
    listAutoDebits: () => request<AutoDebit[]>(routes.autoDebits()),
    setAutoDebitEnabled: (id, enabled) => patch(routes.autoDebit(id), { enabled }),
    listBirthdayPlans: () => request(routes.birthdayPlans()),
    previewBirthdayPlan: req => post(routes.birthdayPlanPreview(), req),
    createBirthdayPlan: req => post(routes.birthdayPlans(), req),
    cancelBirthdayPlan: (id, req) => post(routes.birthdayPlanCancel(encodeURIComponent(id)), req),
    confirmBirthdayOrder: (id, req) => post(routes.birthdayPlanOrder(encodeURIComponent(id)), req),

    listBudgets: () => request<BudgetsOverview>(routes.budgets()),
    createBudget: (req) => post(routes.budgets(), req),
    updateBudget: (id, req) => patch(routes.budget(id), req),
    deleteBudget: (id) => del(routes.budget(id)),
    redeemBudgetPass: (id, day) => post(routes.budgetPass(id), { day }),

    getSecurityOverview: () => request(routes.security()),
    setSecurityRule: (id, enabled) => patch(routes.securityRule(id), { enabled }),
    changePhone: (req) => patch(routes.changePhone(), req),
    changePassword: (oldPassword, newPassword) =>
      post<void>(routes.changePassword(), { oldPassword, newPassword }),
    changePaymentPassword: (req) => post<void>(routes.paymentPassword(), req),
    verifyIdentity: (channel) => post(routes.verifyIdentity(), { channel }),

    listSupportMessages: () => request(routes.supportHistory()),
    sendSupportMessage: (text) => post(routes.supportChat(), { text }),

    requestHumanSupport: (req) => post(routes.supportTickets(), req),
    listSupportTickets: (page) => request(routes.supportTickets() + `?page=${page ?? 1}`),
    getSupportTicket: (id) => request(routes.supportTicket(encodeURIComponent(id))),
    replySupportTicket: (id, req) => post(routes.supportTicketMessages(encodeURIComponent(id)), req),

    // —— 账户域扩展 ——
    quoteExchange: (req) => post(routes.exchangeQuote(), req),
    submitExchange: (req) => post(routes.exchange(), req),
    getSavingsOverview: () => request(routes.savingsOverview()),
    createSavingsGoal: (req) => post(routes.savingsGoals(), req),
    updateSavingsGoal: (id, req) => patch(routes.savingsGoal(id), req),
    deleteSavingsGoal: (id) => del<void>(routes.savingsGoal(id)),
    updateSavingsRoundup: (req) => patch(routes.savingsRoundup(), req),
    createVirtualCard: (id, req) => post(routes.virtualCard(id), req),

    // —— 我的域扩展 ——
    getInvitations: () => request(routes.invitations()),
    getMembership: () => request(routes.membership()),
    redeemLoungePass: () => post(routes.membershipLoungePass()),

    // —— 工资与备用金 ——
    getSalaryPlan: () => request(routes.salaryPlan()),
    updateSalary: (req) => patch(routes.salaryPlan(), req),
    getOverdraft: () => request(routes.overdraft()),
    activateOverdraft: (active) => post(routes.overdraftActivate(), { active }),

    // —— 借款与分期 ——
    getCreditOverview: () => request(routes.creditOverview()),
    applyLoan: (req) => post(routes.creditApply(), req),
    convertToInstallment: (transactionId, req) => post(routes.creditInstallment(transactionId), req),

    // —— 理财扩展 ——
    getCashManagement: () => request(routes.cashManagement()),
    updateCashSweep: (req) => patch(routes.cashManagementSweep(), req),
    getInvestments: () => request(routes.investments()),
    createInvestPlan: (req) => post(routes.investPlan(), req),
    updateInvestPlan: (id, req) => patch(routes.investPlanStatus(id), req),
    getInsurance: () => request(routes.insurance()),
    enrollInsurance: (req) => post(routes.insuranceEnroll(), req),
  }
}

export type { Cents }
