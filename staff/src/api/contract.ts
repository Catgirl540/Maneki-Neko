/* ==========================================================================
   StaffApi —— 工作人员端前端唯一依赖的接口面
   版本：v1.1（2026-10-09 Phase 1 工单前端；v1 冻结后仅新增可选字段 Ticket.customerName）
   变更规则：改签名/字段/错误码 → 单独 commit 带 [contract] 前缀 + 版本号 +1 + 群里广播
   两套实现：createHttpApi / createMockApi，组件只 import { api }
   功能规格：design/staff-console/工作人员端清单.md
   ========================================================================== */

import type {
  Approval,
  ApprovalBizType,
  AuditLog,
  CustomerProfile,
  CustomerSummary,
  StaffLoginResult,
  StaffUser,
  Ticket,
  TicketChannel,
  TicketDetail,
  TicketPriority,
  TicketStatus,
  TranscriptEntry,
} from './types'

/** 与后端约定的 REST 路径表，mock 与 http 共用（照抄客户端 check-contract 的纪律） */
export const routes = {
  login: () => '/staff-api/login',
  logout: () => '/staff-api/logout',
  me: () => '/staff-api/me',

  tickets: () => '/staff-api/tickets',
  ticket: (id: string) => `/staff-api/tickets/${id}`,
  ticketStatus: (id: string) => `/staff-api/tickets/${id}/status`,
  ticketMessages: (id: string) => `/staff-api/tickets/${id}/messages`,

  approvals: () => '/staff-api/approvals',
  approval: (id: string) => `/staff-api/approvals/${id}`,
  approvalDecide: (id: string) => `/staff-api/approvals/${id}/decide`,

  customers: () => '/staff-api/customers',
  customerProfile: (id: string) => `/staff-api/customers/${id}/profile`,

  customerActions: (id: string, action: string) => `/staff-api/customers/${id}/actions/${action}`,

  auditLogs: () => '/staff-api/audit-logs',

  health: () => '/staff-api/health',
} as const

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

export interface CreateTicketRequest {
  customerId: string
  channel: TicketChannel
  reason: string
  priority?: TicketPriority
  transcript?: TranscriptEntry[]
  transferId?: string | null
  approvalId?: string | null
}

export interface CreateApprovalRequest {
  customerId: string
  bizType: ApprovalBizType
  /** transfer 类只传 transferId，payload 由服务端从挂起指令读取（§5.2 防伪造） */
  transferId?: string | null
  ticketId?: string | null
  payload?: Record<string, unknown>
}

export interface CustomerActionRequest {
  /** 关联工单（代客动作必须挂单，§2 P1） */
  ticketId: string
  verificationMethod: 'phone' | 'sms' | 'face' | 'simulated'
  verificationResult: 'passed' | 'failed'
  reason: string
}

/**
 * 拦截原因码：只收枚举，不收自由文本（§9.1）。
 * 自由文本会退化成「看着不爽就拦」，枚举强制员工给出可审计的客观理由。
 */
export const INTERCEPT_REASONS = [
  '疑似诈骗',
  '收款方风险名单',
  '交易行为异常',
  '客户来电要求叫停',
] as const
export type InterceptReason = (typeof INTERCEPT_REASONS)[number]

export interface DecideRequest {
  /**
   * transfer 类走「在途窗口」语义：
   * - settle = 立即到账（把窗口提前收口，正常放行）
   * - intercept = 拦截（必须带 reasonCode，钱退回客户可用余额）
   * 其他类仍走审批语义：approved / rejected。
   */
  decision: 'settle' | 'intercept' | 'approved' | 'rejected'
  /** intercept 必填，值域 INTERCEPT_REASONS */
  reasonCode?: InterceptReason
  /** 拦截补充说明，可选 */
  reasonDetail?: string
  /** approved / rejected / settle 的备注，可选 */
  reason?: string
}

export interface StaffApi {
  login(name: string, password: string): Promise<StaffLoginResult>
  logout(): Promise<void>
  me(): Promise<StaffUser>

  listTickets(): Promise<Ticket[]>
  getTicket(id: string): Promise<TicketDetail>
  createTicket(req: CreateTicketRequest): Promise<{ ticketId: string; status: TicketStatus }>
  /** status 与当前相同 + 传 assigneeId = 纯转派（转给主管），不走状态机 */
  updateTicketStatus(id: string, status: TicketStatus, assigneeId?: string): Promise<Ticket>
  postTicketMessage(id: string, text: string): Promise<{ messageId: string }>

  listApprovals(): Promise<Approval[]>
  getApproval(id: string): Promise<Approval>
  createApproval(req: CreateApprovalRequest): Promise<{ approvalId: string; status: string }>
  /**
   * 处置一笔待决记录。
   * transfer 类：settle（立即到账）| intercept（拦截，必带 reasonCode）。
   * 其他类：approved | rejected。
   */
  decideApproval(id: string, req: DecideRequest): Promise<Approval>

  searchCustomers(keyword: string): Promise<CustomerSummary[]>
  getCustomerProfile(id: string, reason: string): Promise<CustomerProfile>

  /** 代客办理白名单动作（B 模块，Phase 1 接通） */
  performCustomerAction(id: string, action: string, req: CustomerActionRequest): Promise<{ ok: true }>

  listAuditLogs(): Promise<AuditLog[]>
}
