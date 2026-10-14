/* ==========================================================================
   StaffApi mock 最小版（Phase 0）—— 每接口一份写死样例，页面不白屏即可
   纪律：方法集合必须与 http 实现一致（check-contract 会比对）
   完整业务模拟不做，那是假的完备（xpy 裁决）
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
  TicketMessage,
  TicketStatus,
} from '../types'
import {
  ApiError,
  type CreateApprovalRequest,
  type CreateTicketRequest,
  type CustomerActionRequest,
  type DecideRequest,
  type StaffApi,
  type TransferThreshold,
} from '../contract'

const now = '2026-10-09T12:00:00.000Z'

/** 与真实演示客户对齐（db.ts seed：林小满 u_0001），别让 demo 前后名字打架 */
const CUSTOMER_NAMES: Record<string, string> = { u_0001: '林小满' }

interface MockTicket extends Ticket {
  messages: TicketMessage[]
}

const TICKET_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  open: ['processing', 'suspended'],
  processing: ['waiting', 'resolved', 'suspended'],
  waiting: ['processing', 'resolved'],
  suspended: ['processing'],
  resolved: [],
}

function makeDemoTicket(): MockTicket {
  return {
    ticketId: 'T_demo0001',
    customerId: 'u_0001',
    customerName: CUSTOMER_NAMES.u_0001,
    channel: 'app',
    reason: '客户对一笔 8000 元转账不放心，要求转人工',
    priority: 'high',
    status: 'open',
    assigneeId: null,
    transferId: 'txn_demo8000',
    approvalId: 'A_demo0001',
    agentTranscript: [
      { role: 'user', text: '我要转 8000 给梁乐怡，不放心，帮我找人工' },
      { role: 'assistant', text: '好的，已为您转接人工客服。' },
    ],
    createdAt: now,
    updatedAt: now,
    messages: [
      { id: 'msg_1', ticket_id: 'T_demo0001', sender: 'system', text: '已为您接入人工客服', created_at: now },
    ],
  }
}

/** mock 会话态：让接手/发消息/转派在演示里真的能走通（Phase 1） */
const tickets = new Map<string, MockTicket>([['T_demo0001', makeDemoTicket()]])

const demoApproval: Approval = {
  approvalId: 'A_demo0001',
  bizType: 'transfer',
  payload: {
    amount: 800000,
    payeeName: '梁乐怡',
    transactionId: 'txn_demo8000',
    holdUntil: new Date(Date.now() + 5 * 60_000).toISOString(),
    request: {
      amount: 800000,
      payeeName: '梁乐怡',
      payeeAccountNo: '6222 **** **** 8899',
      memo: '生日快乐',
    },
  },
  riskSummary: '单笔 ¥8,000.00，超过延迟到账阈值 ¥5,000.00，将于窗口到点自动到账',
  applicantId: null,
  status: 'pending',
  executionStatus: 'pending',
  executionError: null,
  decidedBy: null,
  reason: null,
  createdAt: now,
  decidedAt: null,
}

const demoCustomer: CustomerSummary = {
  customerId: 'u_0001',
  name: '林小满',
  phoneMasked: '138****8000',
  riskTags: ['大额转账关注'],
}

const demoProfile: CustomerProfile = {
  customerId: 'u_0001',
  name: '林小满',
  phoneMasked: '138****8000',
  accounts: [{ id: 'acc_1', label: '储蓄账户', balance: 1250000 }],
  cards: [{ id: 'card_1', last4: '6688', status: 'active' }],
  autoDebits: [{ id: 'ad_1', merchant: '网易云音乐', amount: 2500, cycle: '每月 8 日', enabled: true }],
  recentTransactions: [
    // 挂起中的审核单：靠 pendingReason 区分「审核中」与「处理中」（§9.2）
    {
      id: 'txn_demo8000',
      amount: -800000,
      counterparty: '转账 · 梁乐怡',
      status: 'pending',
      pendingReason: 'inflight',
      createdAt: now,
    },
    {
      id: 'txn_demo50',
      amount: -5000,
      counterparty: '便利店',
      status: 'success',
      createdAt: now,
    },
  ],
}

const demoLogs: AuditLog[] = [
  {
    id: 'log_1',
    actor_type: 'agent',
    actor_id: 'agent',
    action: 'ticket.create',
    target_type: 'ticket',
    target_id: 'T_demo0001',
    result: 'ok',
    request_id: null,
    reason: null,
    created_at: now,
  },
]

export function createMockApi(): StaffApi {
  // mock 里也模拟内存会话，让「登录后才进得去」的守卫在演示时成立
  let session: StaffUser | null = null
  // 默认 ¥500,000 = 50000000 分（清单 §9.1）
  const thresholdState: TransferThreshold = {
    transferReviewCents: 50_000_000,
    maxTransferReviewCents: 90_000_000,
  }

  const ok = <T,>(value: T): Promise<T> => Promise.resolve(value)

  return {
    login(name, password) {
      if (password !== '123456') {
        return Promise.reject(new ApiError('员工账号或密码错误', 401, 'BAD_CREDENTIALS'))
      }
      const staff: StaffUser =
        name === '李主管'
          ? { id: 'staff_li', name: '李主管', role: 'supervisor' }
          : { id: 'staff_wang', name: '王小明', role: 'csr' }
      session = staff
      return ok<StaffLoginResult>({ token: 'mock-token', staff })
    },
    logout() {
      session = null
      return ok<void>(undefined)
    },
    me() {
      if (!session) {
        return Promise.reject(new ApiError('未登录', 401, 'UNAUTHORIZED'))
      }
      return ok<StaffUser>(session)
    },

    listTickets: () => ok<Ticket[]>([...tickets.values()].map(({ messages: _m, ...t }) => t)),
    getTicket: (id) => {
      const t = tickets.get(id)
      if (!t) return Promise.reject(new ApiError('工单不存在', 404, 'NOT_FOUND'))
      return ok<TicketDetail>(t)
    },
    createTicket: (req: CreateTicketRequest) => {
      const id = `T_demo${String(tickets.size + 1).padStart(4, '0')}`
      const ts = new Date().toISOString()
      tickets.set(id, {
        ticketId: id,
        customerId: req.customerId,
        customerName: CUSTOMER_NAMES[req.customerId] ?? null,
        channel: req.channel,
        reason: req.reason,
        priority: req.priority === 'high' ? 'high' : 'normal',
        status: 'open',
        assigneeId: null,
        transferId: req.transferId ?? null,
        approvalId: req.approvalId ?? null,
        agentTranscript: req.transcript ?? null,
        createdAt: ts,
        updatedAt: ts,
        messages: [],
      })
      return ok({ ticketId: id, status: 'open' as const })
    },
    updateTicketStatus: (id, status, assigneeId) => {
      const t = tickets.get(id)
      if (!t) return Promise.reject(new ApiError('工单不存在', 404, 'NOT_FOUND'))
      // 纯转派：状态没变、只换负责人（转给主管），不走状态机（contract 注释）
      if (status === t.status) {
        if (!assigneeId) {
          return Promise.reject(new ApiError('状态未变化且未指定负责人', 400, 'INVALID_TRANSITION'))
        }
        t.assigneeId = assigneeId
        t.updatedAt = new Date().toISOString()
        const { messages: _m, ...rest } = t
        return ok<Ticket>(rest)
      }
      if (!TICKET_TRANSITIONS[t.status].includes(status)) {
        return Promise.reject(
          new ApiError(`工单状态不能从「${t.status}」变为「${status}」`, 400, 'INVALID_TRANSITION'),
        )
      }
      t.status = status
      if (status === 'processing') t.assigneeId = assigneeId ?? t.assigneeId ?? 'staff_wang'
      t.updatedAt = new Date().toISOString()
      const { messages: _m, ...rest } = t
      return ok<Ticket>(rest)
    },
    postTicketMessage: (id, text, opts) => {
      const t = tickets.get(id)
      if (!t) return Promise.reject(new ApiError('工单不存在', 404, 'NOT_FOUND'))
      const mid = `msg_${t.messages.length + 1}`
      t.messages.push({
        id: mid,
        ticket_id: id,
        sender: 'staff',
        text,
        created_at: new Date().toISOString(),
      })
      // mock 是最小桩：visibleToCustomer 只保证签名对齐，不做真实投递
      void opts
      return ok({ messageId: mid })
    },

    listApprovals: () => ok<Approval[]>([demoApproval]),
    getApproval: () => ok<Approval>(demoApproval),
    createApproval: (_req: CreateApprovalRequest) =>
      ok({ approvalId: 'A_demo0002', status: 'pending' }),
    decideApproval: (id, req: DecideRequest) => {
      if (demoApproval.status !== 'pending') {
        return Promise.reject(new ApiError('该审批单已裁决，不能重复操作', 409, 'ALREADY_DECIDED'))
      }
      // transfer 类只收 settle / intercept；intercept 必带枚举理由（§9.1）
      if (demoApproval.bizType === 'transfer') {
        if (req.decision !== 'settle' && req.decision !== 'intercept') {
          return Promise.reject(new ApiError('转账单只能「立即到账」或「拦截」', 400, 'BAD_DECISION'))
        }
        if (req.decision === 'intercept' && !req.reasonCode) {
          return Promise.reject(new ApiError('拦截必须选择理由', 400, 'REASON_REQUIRED'))
        }
        demoApproval.status = req.decision === 'settle' ? 'settled' : 'intercepted'
        demoApproval.executionStatus = req.decision === 'settle' ? 'succeeded' : 'failed'
        demoApproval.reason =
          req.decision === 'intercept'
            ? `${req.reasonCode}${req.reasonDetail ? `：${req.reasonDetail}` : ''}`
            : (req.reason ?? null)
      } else {
        if (req.decision !== 'approved' && req.decision !== 'rejected') {
          return Promise.reject(new ApiError('decision 只能是 approved 或 rejected', 400, 'BAD_DECISION'))
        }
        demoApproval.status = req.decision
        demoApproval.reason = req.reason ?? null
      }
      demoApproval.decidedAt = new Date().toISOString()
      return ok<Approval>({ ...demoApproval, approvalId: id })
    },

    // 与真后端 searchCustomers 对齐：姓名 / 脱敏手机号 / 客户号都能命中
    searchCustomers: (keyword) =>
      ok<CustomerSummary[]>(
        [demoCustomer].filter(
          (c) =>
            keyword === '' ||
            `${c.name} ${c.phoneMasked} ${c.customerId} ${c.phoneMasked.replace(/\*/g, '')}`.includes(
              keyword,
            ),
        ),
      ),
    getCustomerProfile: () => ok<CustomerProfile>(demoProfile),

    performCustomerAction: (_id: string, _action: string, _req: CustomerActionRequest) => ok({ ok: true as const }),

    listAuditLogs: () => ok<AuditLog[]>(demoLogs),

    // 运行时阈值（清单 §9.1）。mock 里也做成可改的，演示时两条路径行为一致。
    getTransferThreshold: () => ok<TransferThreshold>({ ...thresholdState }),
    updateTransferThreshold: (cents: number) => {
      if (!Number.isInteger(cents) || cents <= 0) {
        return Promise.reject(new ApiError('阈值必须是正整数分（¥1 = 100）', 400, 'BAD_THRESHOLD'))
      }
      if (cents > thresholdState.maxTransferReviewCents) {
        return Promise.reject(new ApiError('阈值不能超过单笔转账上限', 400, 'BAD_THRESHOLD'))
      }
      thresholdState.transferReviewCents = cents
      return ok<TransferThreshold>({ ...thresholdState })
    },
  }
}
