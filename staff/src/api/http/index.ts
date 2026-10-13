/* ==========================================================================
   StaffApi 真后端实现 —— 全部经由 base.ts 的 request()
   ========================================================================== */

import type {
  Approval,
  AuditLog,
  CustomerProfile,
  CustomerSummary,
  StaffLoginResult,
  StaffUser,
  Ticket,
  TicketDetail,
  TicketStatus,
} from '../types'
import {
  routes,
  type CreateApprovalRequest,
  type CreateTicketRequest,
  type CustomerActionRequest,
  type StaffApi,
  type TransferThreshold,
} from '../contract'
import { get, patch, post, put, setStaffToken } from './base'

export function createHttpApi(): StaffApi {
  return {
    getOperationsOverview: () => get(routes.operations()),
    login: async (name, password) => {
      const result = await post<StaffLoginResult>(routes.login(), { name, password })
      setStaffToken(result.token)
      return result
    },
    logout: async () => {
      await post<void>(routes.logout())
      setStaffToken(null)
    },
    me: () => get<StaffUser>(routes.me()),

    listTickets: () => get<Ticket[]>(routes.tickets()),
    getTicket: (id) => get<TicketDetail>(routes.ticket(id)),
    createTicket: (req: CreateTicketRequest) =>
      post(routes.tickets(), req),
    updateTicketStatus: (id: string, status: TicketStatus, assigneeId?: string) =>
      patch<Ticket>(routes.ticketStatus(id), { status, assigneeId }),
    postTicketMessage: (id: string, text: string) =>
      post(routes.ticketMessages(id), { text }),

    listApprovals: () => get<Approval[]>(routes.approvals()),
    getApproval: (id) => get<Approval>(routes.approval(id)),
    createApproval: (req: CreateApprovalRequest) => post(routes.approvals(), req),
    decideApproval: (id, req) =>
      post<Approval>(routes.approvalDecide(id), req),

    searchCustomers: (keyword) =>
      get<CustomerSummary[]>(`${routes.customers()}?keyword=${encodeURIComponent(keyword)}`),
    // reason 与资料同接口原子落账（§2 客户查询），前端不补记
    getCustomerProfile: (id, reason) =>
      get<CustomerProfile>(`${routes.customerProfile(id)}?reason=${encodeURIComponent(reason)}`),

    performCustomerAction: (id, action, req: CustomerActionRequest) =>
      post(routes.customerActions(id, action), req),

    listAuditLogs: () => get<AuditLog[]>(routes.auditLogs()),

    // 运行时阈值（清单 §9.1）：改完立刻对下一笔转账生效
    getTransferThreshold: () => get<TransferThreshold>(routes.transferThreshold()),
    updateTransferThreshold: (cents) =>
      put<TransferThreshold>(routes.transferThreshold(), { transferReviewCents: cents }),
  }
}
