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

/** 客户号 → 姓名，建单回显用。与下方 demoCustomers 目录保持一致。 */
const CUSTOMER_NAMES: Record<string, string> = {
  u_0001: '林小满',
  u_demo_chen: '陈嘉禾',
  u_0002: '苏晚',
  u_0003: '张伟',
  u_0004: '王芳',
  u_0005: '周杰',
}

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

/** 工单排序：会员 VIP 优先，其次加急，普通最后 */
const PRIORITY_RANK: Record<Ticket['priority'], number> = { vip: 0, high: 1, normal: 2 }

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

/**
 * 客户目录（脱敏摘要，客户查询列表用）。多放几条，方便测姓名 / 手机号 / 客户号搜索。
 * u_0001（林小满）与 u_demo_chen（陈嘉禾）对应客户端 db.ts 的真实演示档案，
 * 其余是 mock 专属测试客户，仅存在于员工端 mock，不会出现在真后端 listAllProfiles()。
 */
const demoCustomers: CustomerSummary[] = [
  { customerId: 'u_0001', name: '林小满', phoneMasked: '138****8000', riskTags: ['大额转账关注'] },
  { customerId: 'u_demo_chen', name: '陈嘉禾', phoneMasked: '136****6000', riskTags: [] },
  { customerId: 'u_0002', name: '苏晚', phoneMasked: '139****1234', riskTags: ['频繁转账'] },
  { customerId: 'u_0003', name: '张伟', phoneMasked: '137****5678', riskTags: ['冻结审查', '大额转账关注'] },
  { customerId: 'u_0004', name: '王芳', phoneMasked: '135****9012', riskTags: [] },
  { customerId: 'u_0005', name: '周杰', phoneMasked: '186****3456', riskTags: ['境外交易关注'] },
]

/** 客户 360：每户一份档案，点开列表里的客户时按 customerId 取（脱敏，不含支付密码/卡安全码）。 */
const demoProfiles: Record<string, CustomerProfile> = {
  u_0001: {
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
  },
  u_demo_chen: {
    customerId: 'u_demo_chen',
    name: '陈嘉禾',
    phoneMasked: '136****6000',
    accounts: [{ id: 'acc_chen', label: '储蓄账户', balance: 800000 }],
    cards: [{ id: 'card_chen', last4: '4471', status: 'active' }],
    autoDebits: [],
    recentTransactions: [
      { id: 'txn_chen_1', amount: 120000, counterparty: '工资入账', status: 'success', createdAt: now },
    ],
  },
  u_0002: {
    customerId: 'u_0002',
    name: '苏晚',
    phoneMasked: '139****1234',
    accounts: [{ id: 'acc_su', label: '储蓄账户', balance: 3200000 }],
    cards: [{ id: 'card_su', last4: '9028', status: 'active' }],
    autoDebits: [{ id: 'ad_su', merchant: '房租', amount: 450000, cycle: '每月 3 日', enabled: true }],
    recentTransactions: [
      { id: 'txn_su_1', amount: 500000, counterparty: '项目款', status: 'success', createdAt: now },
      { id: 'txn_su_2', amount: -50000, counterparty: '转账 · 陈嘉禾', status: 'success', createdAt: now },
    ],
  },
  u_0003: {
    customerId: 'u_0003',
    name: '张伟',
    phoneMasked: '137****5678',
    accounts: [{ id: 'acc_zhang', label: '储蓄账户', balance: 450000 }],
    cards: [{ id: 'card_zhang', last4: '3321', status: 'locked' }],
    autoDebits: [],
    recentTransactions: [
      { id: 'txn_zhang_1', amount: -1500000, counterparty: '转账 · 未知账户', status: 'pending', pendingReason: 'inflight', createdAt: now },
    ],
  },
  u_0004: {
    customerId: 'u_0004',
    name: '王芳',
    phoneMasked: '135****9012',
    accounts: [{ id: 'acc_wang', label: '储蓄账户', balance: 158000 }],
    cards: [{ id: 'card_wang', last4: '1123', status: 'active' }],
    autoDebits: [],
    recentTransactions: [
      { id: 'txn_wang_1', amount: -8000, counterparty: '超市', status: 'success', createdAt: now },
    ],
  },
  u_0005: {
    customerId: 'u_0005',
    name: '周杰',
    phoneMasked: '186****3456',
    accounts: [{ id: 'acc_zhou', label: '储蓄账户', balance: 8900000 }],
    cards: [{ id: 'card_zhou', last4: '2088', status: 'active' }],
    autoDebits: [{ id: 'ad_zhou', merchant: 'Netflix', amount: 13900, cycle: '每月 15 日', enabled: true }],
    recentTransactions: [
      { id: 'txn_zhou_1', amount: -1200000, counterparty: '境外转账 · Wing Chan', status: 'success', createdAt: now },
    ],
  },
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
      if (!['王小明', '李主管', '运维人员'].includes(name)) return Promise.reject(new ApiError('员工账号或密码错误', 401, 'BAD_CREDENTIALS'))
      if (password !== '123456') {
        return Promise.reject(new ApiError('员工账号或密码错误', 401, 'BAD_CREDENTIALS'))
      }
      const staff: StaffUser =
        name === '运维人员' ? { id: 'staff_ops', name: '运维人员', role: 'ops' } : name === '李主管'
          ? { id: 'staff_li', name: '李主管', role: 'supervisor' }
          : { id: 'staff_wang', name: '王小明', role: 'csr' }
      session = staff
      return ok<StaffLoginResult>({ token: 'mock-token', staff })
    },
    getOperationsOverview: () => Promise.reject(new ApiError('请连接银行后端查看真实运维状态', 503, 'OPERATIONS_UNAVAILABLE')),
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

    // 会员 VIP 工单优先，其次加急，同优先级按创建时间倒序
    listTickets: () => ok<Ticket[]>([...tickets.values()]
      .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || b.createdAt.localeCompare(a.createdAt))
      .map(({ messages: _m, ...t }) => t)),
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

    // 与真后端 searchCustomers 对齐：姓名 / 脱敏手机号 / 去星号片段 / 客户号都能命中。
    // 去星号那一条是必须的——界面展示的是 138****8000，员工照着抄回来搜也得命中。
    searchCustomers: (keyword) => {
      const kw = String(keyword ?? '').trim().toLowerCase()
      return ok<CustomerSummary[]>(
        demoCustomers.filter((c) => {
          const hay = `${c.name} ${c.phoneMasked} ${c.customerId} ${c.phoneMasked.replace(/\*/g, '')}`.toLowerCase()
          return kw === '' || hay.includes(kw)
        }),
      )
    },
    getCustomerProfile: (id) => {
      const profile = demoProfiles[id]
      if (!profile) return Promise.reject(new ApiError('客户不存在', 404, 'NOT_FOUND'))
      return ok<CustomerProfile>(profile)
    },

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
