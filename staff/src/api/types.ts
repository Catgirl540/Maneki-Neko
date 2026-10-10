/* ==========================================================================
   工作人员端类型定义 —— 与 contract.ts 配套
   角色枚举 csr/supervisor（不叫 agent，与 AI agent 撞名，2026-10-09 拍板）
   金额一律整数分（Cents），与客户端一致
   ========================================================================== */

/** 金额单位：整数分（¥5,000 = 500000） */
export type Cents = number

export type StaffRole = 'csr' | 'supervisor'

export interface StaffUser {
  id: string
  name: string
  role: StaffRole
}

export interface StaffLoginResult {
  token: string
  staff: StaffUser
}

export type TicketStatus = 'open' | 'processing' | 'waiting' | 'resolved' | 'suspended'
export type TicketChannel = 'app' | 'im' | 'web'
export type TicketPriority = 'normal' | 'high'

export interface TranscriptEntry {
  role: 'user' | 'assistant'
  text: string
}

export interface Ticket {
  ticketId: string
  customerId: string
  /** 展示用客户名（可选，拿不到就回落显示 customerId） */
  customerName?: string | null
  channel: TicketChannel
  reason: string
  priority: TicketPriority
  status: TicketStatus
  assigneeId: string | null
  /** 串链字段：把工单挂到那笔挂起转账上（§9） */
  transferId: string | null
  approvalId: string | null
  agentTranscript: TranscriptEntry[] | null
  createdAt: string
  updatedAt: string
}

export interface TicketMessage {
  id: string
  ticket_id: string
  sender: 'staff' | 'customer' | 'system'
  text: string
  created_at: string
}

export interface TicketDetail extends Ticket {
  messages: TicketMessage[]
}

export type ApprovalBizType =
  | 'transfer'
  | 'card_lock'
  | 'limit_adjust'
  | 'wealth_subscribe'
  | 'other'

/**
 * 处置状态。
 * - transfer 类走「在途窗口」语义：pending → settled（自动/立即到账）
 *   | intercepted（员工拦截） | recalled（用户撤销）
 * - 其他类（锁卡/调额…）仍是审批语义：pending → approved | rejected
 */
export type ApprovalStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'settled'
  | 'intercepted'
  | 'recalled'
/** 资金执行结果，与处置结果分开存（§9.4） */
export type ExecutionStatus = 'pending' | 'succeeded' | 'failed'

export interface Approval {
  approvalId: string
  bizType: ApprovalBizType
  /** 裁决时的参数快照，建单后冻结 */
  payload: Record<string, unknown>
  riskSummary: string
  applicantId: string | null
  status: ApprovalStatus
  executionStatus: ExecutionStatus
  executionError: string | null
  decidedBy: string | null
  reason: string | null
  createdAt: string
  decidedAt: string | null
}

export interface AuditLog {
  id: string
  actor_type: 'staff' | 'agent'
  actor_id: string | null
  action: string
  target_type: string | null
  target_id: string | null
  result: string
  request_id: string | null
  reason: string | null
  created_at: string
}

/** 客户查询（B 模块，Phase 0 只定形状） */
export interface CustomerSummary {
  customerId: string
  name: string
  phoneMasked: string
  riskTags: string[]
}

export interface CustomerProfile {
  customerId: string
  name: string
  phoneMasked: string
  accounts: Array<{ id: string; label: string; balance: Cents }>
  cards: Array<{ id: string; last4: string; status: string }>
  recentTransactions: Array<{
    id: string
    amount: Cents
    counterparty: string
    status: string
    /** 'inflight' = 在途延迟到账 · 'clearing' = 模拟清算（§9.2） */
    pendingReason?: 'inflight' | 'clearing'
    createdAt: string
  }>
}

export interface CustomerAccessLog {
  id: string
  staff_id: string
  customer_id: string
  reason: string
  created_at: string
}
