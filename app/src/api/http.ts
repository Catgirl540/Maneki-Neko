import { ApiError, type BankApi, type TransactionQuery } from './contract'
import { routes } from './contract'
import type {
  Account,
  AutoDebit,
  BankCard,
  CardProduct,
  Cents,
  ExportQuery,
  Payee,
  ReceiptFile,
  TransactionRecord,
  TransferQuoteRequest,
  TransferRecallResult,
  TransferRequest,
  User,
} from './types'
import { getAuthToken } from '@/lib/authToken'

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? ''

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  // 令牌只存在内存里（不落盘）：刷新即失效，见 lib/authToken.ts
  const token = getAuthToken()
  const res = await fetch(BASE_URL + path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  })

  const text = await res.text()
  const payload = text ? (JSON.parse(text) as unknown) : null

  if (!res.ok) {
    const body = payload as { message?: string; code?: string } | null
    throw new ApiError(body?.message ?? `请求失败（${res.status}）`, res.status, body?.code)
  }
  return payload as T
}

const post = <T,>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })

const patch = <T,>(path: string, body?: unknown) =>
  request<T>(path, { method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) })

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
      const qs = params.toString()
      return request(routes.transactions(id) + (qs ? `?${qs}` : ''))
    },
    exportTransactions: (id, query: ExportQuery = {}) => {
      const params = new URLSearchParams()
      if (query.from) params.set('from', query.from)
      if (query.to) params.set('to', query.to)
      if (query.category && query.category !== 'all') params.set('category', query.category)
      if (query.keyword) params.set('keyword', query.keyword)
      const qs = params.toString()
      return request(routes.transactionsExport(id) + (qs ? `?${qs}` : ''))
    },
    getTransaction: (id) => request<TransactionRecord>(routes.transaction(id)),
    getReceipt: (id) => request<ReceiptFile>(routes.receipt(id)),
    deposit: (id, amount, channel) => post(routes.deposit(id), { amount, channel }),

    sendSmsCode: (phone) => post(routes.smsCode(), { phone }),

    listBanks: () => request(routes.banks()),
    getReceivingInfo: () => request(routes.receiving()),
    resolveCardBin: (req) => post(routes.cardBin(), req),
    listPayees: () => request<Payee[]>(routes.payees()),
    resolveFps: (idType, fpsId) => post(routes.fpsResolve(), { idType, fpsId }),
    quoteTransfer: (req: TransferQuoteRequest) => post(routes.transferQuote(), req),
    resolveTransferRecipient: (req) => post(routes.transferRecipient(), req),
    submitTransfer: (req: TransferRequest) => post(routes.transfers(), req),
    recallTransfer: (transactionId: string) =>
      post<TransferRecallResult>(routes.transferRecall(transactionId), {}),

    listCards: () => request<BankCard[]>(routes.cards()),
    listCardProducts: () => request<CardProduct[]>(routes.cardProducts()),
    openCard: (req) => post(routes.cardOpen(), req),
    setCardLock: (id, locked) => post(routes.cardLock(id), { locked }),
    replaceCard: (id, req) => post(routes.cardReplace(id), req),
    revealCardSecrets: (id, paymentPassword) => post(routes.cardSecrets(id), { paymentPassword }),
    updateCardSettings: (id, body) => patch(routes.cardSettings(id), body),

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

    getSecurityOverview: () => request(routes.security()),
    setSecurityRule: (id, enabled) => patch(routes.securityRule(id), { enabled }),
    changePhone: (req) => patch(routes.changePhone(), req),
    changePassword: (oldPassword, newPassword) =>
      post<void>(routes.changePassword(), { oldPassword, newPassword }),
    verifyIdentity: (channel) => post(routes.verifyIdentity(), { channel }),

    listSupportMessages: () => request(routes.supportHistory()),
    sendSupportMessage: (text) => post(routes.supportChat(), { text }),
  }
}

export type { Cents }
