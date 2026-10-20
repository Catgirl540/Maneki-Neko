import { isMockMode } from './dataMode'
/**
 * agent 对话状态：多段对话并存，并把 SSE 事件整理成界面能直接渲染的东西。
 *
 * 与固定话术那条路**并存**：agent 服务不在时 `status` 为 'off'，
 * 页面回落到原来的固定话术，部署在纯静态环境（bank.waveflow.cn）上不受影响。
 *
 * 三条设计上的硬规矩，都是踩过才写下的：
 *
 *   1. **会话是懒创建的。** 不打开页面就建会话，会平白多出一堆空会话日志；
 *      而"建了空会话"这件事在服务端是看得见的。所以发第一句话时才建。
 *   2. **发言必须晚于订阅。** 建会话时等事件流真正握手成功（收到 `hello`）再返回，
 *      否则"发言早于订阅"会丢掉开头的事件——实测踩到过：点「新对话」后立刻发消息，
 *      回答永远不来。
 *   3. **切走不等于断线。** 这一段还在回答时切到别的对话，事件流**不关**，
 *      回答照样写回它自己那一行。会话管理最容易做错的地方就是这里：
 *      一切走就断流，用户切回来发现回答没了，而这正是他要会话管理的原因。
 *
 * 内存里同时开着的连接数是有意压住的：**只有"当前打开的那一段"和"正在回答的那几段"
 * 留着流**，其余的空闲对话一律关掉。浏览器对同一个源只允许 6 条左右的并发连接，
 * 全都挂着 SSE 会把普通请求一起堵死。
 *
 * @module app/lib/useAgentChat
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { restoreSession } from './authToken'
import type { PreparedImage } from './image'
import { prepareTurnRetry, retryRequestText } from './agentTurns'
import {
  defaultAgentClient,
  type AgentClient,
  type CustomerVerification,
  type AgentEvent,
  type ConsentChallenge,
  type PendingQuestion,
  type QuestionAnswerItem,
  type VoiceCapability,
} from '../api/agent'
import {
  recoveryHistory,
  isEmptyConversation,
  loadConversations,
  makeConversation,
  promptOf,
  rewindTo,
  saveConversations,
  titleFrom,
  type ChatItem,
  type StoredConversation,
} from './agentSessions'

export type { ChatItem, StoredConversation } from './agentSessions'

/** agent 通道的可用状态。 */
export type AgentStatus = 'probing' | 'off' | 'ready'

/** 待确认事项的界面状态。 */
export interface PendingConsent {
  challenge: ConsentChallenge
  /** 正在提交答复。 */
  submitting: boolean
  /** 上一次提交失败的原因（例如支付密码不正确）。 */
  error?: string
}

/**
 * 一次待答复问询的界面态。
 *
 * `submitting` / `error` 只在**提交那一下**有用：提交成功之后真正的移除
 * 交给 `question-resolved` 事件——和确认卡片同一套，避免"界面已经收起来了、
 * 服务端其实没收到"这种两边不一致。
 */
export interface PendingAsk {
  question: PendingQuestion
  submitting: boolean
  error?: string
}

let seq = 0
/**
 * 本次页面加载的随机标记，拼进消息 id。
 *
 * **为什么必须有它**：`seq` 是模块级的，刷新之后从 0 重来；而历史消息的 id
 * 是从 localStorage 读回来的（`i1`、`i2`…）。于是刷新后新建的那一条会拿到一个
 * **和老消息完全相同的 id**。
 *
 * 两条消息同 id 不是"看着别扭"，是会真的坏掉：
 *   · `speakingId === item.id` 同时命中两条 → 页面上**冒出两个朗读播放器**（实测）；
 *   · React 的 `key={item.id}` 重复 → 列表复用错行；
 *   · 「重新生成 / 编辑」按 id 定位，会指到另一条上去。
 *
 * 加一个只属于本次加载的标记，跨刷新就不可能撞了；同一次加载内由 `seq` 保证唯一。
 */
const pageTag = Math.random().toString(36).slice(2, 6)
const nextId = (): string => `i${pageTag}_${++seq}`

/** 工具名的中文标签（只是展示用；没有映射的显示原名）。 */
const TOOL_LABELS: Record<string, string> = {
  staff_search_customers: '查询客户',
  staff_get_customer: '查看客户资料',
  staff_list_tickets: '查询工单',
  staff_get_ticket: '查看工单',
  staff_create_ticket: '创建工单',
  staff_update_ticket_status: '更新工单状态',
  staff_post_ticket_message: '回复工单',
  staff_list_approvals: '查询处置记录',
  staff_get_approval: '查看处置记录',
  staff_decide_approval: '处置审批',
  staff_customer_action: '代客办理',
  staff_get_transfer_threshold: '查询转账阈值',
  staff_set_transfer_threshold: '调整转账阈值',
  staff_audit_logs: '查询审计日志',
  staff_operations_overview: '查询运维监控',
  read: '读取文件', read_image: '查看图片', write: '写入文件', edit: '编辑文件',
  glob: '查找文件', grep: '搜索文件内容', bash: '执行命令', powershell: '执行命令',
  web_fetch: '读取网页', job_list: '查询任务', job_output: '查看任务输出', job_kill: '停止任务',
  bank_request_human_support: '转人工',
  bank_list_support_tickets: '查询人工工单',
  bank_get_support_ticket: '查看人工回复',
  bank_reply_support_ticket: '补充人工工单',
  knowledge_lookup: '查询知识库',
  skill: '准备办理',
  bank_get_balance: '查询余额',
  bank_list_transactions: '查询交易流水',
  bank_get_transaction_detail: '查看交易详情',
  bank_transfer: '转账',
  bank_fps_transfer: 'FPS 转账',
  bank_list_banks: '查询银行',
  bank_list_payees: '查询收款人',
  bank_resolve_fps: '查询 FPS 登记',
  bank_verify_recipient: '校验收款账号',
  bank_recall_transfer: '撤回在途转账',
  bank_wealth_quote: '查询理财产品',
  bank_wealth_subscribe: '申购理财产品',
  bank_wealth_redeem: '赎回理财产品',
  bank_reveal_card_secret: '查看卡安全信息',
  bank_list_cards: '查询银行卡',
  bank_card_products: '查询卡产品',
  bank_set_card_lock: '锁卡或解锁',
  bank_update_card_settings: '修改卡片设置',
  bank_apply_card: '申请新卡',
  bank_replace_card: '换卡',
  bank_list_autodebits: '查询自动扣款',
  bank_set_autodebit: '管理自动扣款',
  bank_get_spending: '查询消费分析',
  bank_get_cashflow: '查询现金流',
  // —— 赛题工程扩展：转账编排 / 理财对比 / 定投 / 存钱 / 现金管理 / 保险 ——
  bank_resolve_payee: '查询收款人匹配',
  bank_schedule_transfer: '创建定时转账',
  bank_list_scheduled: '查询定时动作',
  bank_cancel_scheduled: '取消定时动作',
  bank_wealth_compare: '理财产品对比',
  bank_list_invest_plans: '查询定投计划',
  bank_create_invest_plan: '创建定投计划',
  bank_pause_invest_plan: '暂停定投计划',
  bank_terminate_invest_plan: '终止定投计划',
  bank_list_savings_goals: '查询存钱目标',
  bank_create_savings_goal: '新建存钱目标',
  bank_update_savings_goal: '修改存钱目标',
  bank_delete_savings_goal: '删除存钱目标',
  bank_set_savings_sweep: '设置自动归集',
  bank_get_cash_management: '查询现金管理',
  bank_update_cash_sweep: '调整自动归集',
  bank_get_insurance: '查询保险与保单',
  bank_enroll_insurance: '投保',
  luckycat_ping: '框架自检',
}

/** 工具名的中文标签。 */
export function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? name
}

/** 一条已接上的会话：agent 侧会话 id + 关流函数。 */
interface LiveSession {
  agentSessionId: string
  close: () => void
}

export interface AgentChat {
  /** 通道状态：探测中 / 不可用（回落固定话术）/ 可用。 */
  status: AgentStatus
  /** 服务端支持的语音能力（可用时才有）。 */
  voice?: VoiceCapability
  /** 历史对话，从新到旧。 */
  conversations: StoredConversation[]
  /** 当前打开的对话 id。 */
  activeId?: string
  /** 当前打开的对话。 */
  active?: StoredConversation
  /** 正在回答的对话 id（**不止当前这一段**，列表上用得到）。 */
  busyIds: string[]
  stopping: boolean
  stop: () => void
  /** 上下文已经不在助手记忆里的对话 id（列表上标出来）。 */
  lostIds: string[]
  /** 当前对话待确认的敏感操作。 */
  pending?: PendingConsent
  /** 当前对话待答复的问题（模型问用户的那张卡片）。 */
  ask?: PendingAsk
  /** 旧版记录尚待迁入文字上下文。 */
  contextLost: boolean
  /** 当前就是一段**空对话**（建出来没发过话）：此时不该再新建。 */
  activeIsEmpty: boolean
  /**
   * 发一条消息到当前对话。
   * @param text - 用户输入；只发图片时可以是空串。
   * @param image - 一起发的图片（已经 `prepareImage` 压过的那份）。
   */
  send: (text: string, image?: PreparedImage, serviceIds?: readonly string[]) => void
  /**
   * 倒回某条用户消息并重发：编辑重发（传 `text`）和重新生成（不传）共用。
   *
   * 只倒退本地这份记录；服务端的会话日志退不了，助手仍记得被丢掉的话，
   * 所以这等于"在同一个上下文里再问一遍"。
   */
  rewind: (itemId: string, text?: string) => void
  /** 恢复最后一轮失败的请求，保留已执行操作并先核对结果。 */
  retry: (promptId: string) => void
  /** 答复当前对话待确认的事项。 */
  answer: (decision: 'approve' | 'reject', paymentPassword?: string, riskAcknowledgement?: string, customerVerification?: CustomerVerification) => void
  /**
   * 答复当前对话的问题卡片。
   * @param answers - 每道题的答复（选中的选项 + 可能的自由输入）。
   */
  answerAsk: (answers: QuestionAnswerItem[]) => void
  /** 开一段新对话。 */
  create: () => void
  /** 切到另一段对话。 */
  select: (id: string) => void
  /** 改标题；传空串恢复成自动标题。 */
  rename: (id: string, title: string) => void
  /** 从列表里删掉一段。 */
  remove: (id: string) => void
}

/**
 * agent 对话 hook。挂载时只做一次健康探测；服务不在就保持 off，不发任何请求。
 * @returns 对话状态与操作。
 */
export interface AgentChatOptions {
  client?: AgentClient
  ownerId?: string
  /** 本地存档键与上传身份分开，员工按角色及账号隔离。 */
  historyOwnerId?: string
}
export function useAgentChat(options: AgentChatOptions = {}): AgentChat {
  const { agentEnabled, answerConsent, answerQuestion, createAgentSession, openAgentStream,
    probeAgent, probeAgentSession, sendAgentMessage, stopAgentTurn } = options.client ?? defaultAgentClient
  const ownerId = options.ownerId ?? restoreSession()?.user.id ?? ''
  const historyOwnerId = options.historyOwnerId ?? (isMockMode ? undefined : ownerId)
  const historyOwnerRef = useRef(historyOwnerId)
  const retryImage = useRef<{ convId: string; promptId: string; image: PreparedImage } | undefined>(undefined)
  useEffect(() => { retryImage.current = undefined }, [historyOwnerId])
  const [status, setStatus] = useState<AgentStatus>(agentEnabled ? 'probing' : 'off')
  const [voice, setVoice] = useState<VoiceCapability | undefined>(undefined)
  const [conversations, setConversations] = useState<StoredConversation[]>(() => {
    const loaded = loadConversations(historyOwnerId)
    // 列表里最少留一段：一段都没有的时候直接给一段空的，
    // 省得用户先点「新对话」才能开口。
    return loaded.length === 0 ? [makeConversation()] : loaded
  })
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined)
  const [busyIds, setBusyIds] = useState<string[]>([])
  const [pendings, setPendings] = useState<Record<string, PendingConsent>>({})
  /** 每段对话当前待答复的问题。与确认卡片并存：两者可以同时存在。 */
  const [asks, setAsks] = useState<Record<string, PendingAsk>>({})
  const [stoppingIds, setStoppingIds] = useState<string[]>([])
  const stoppingRef = useRef(new Set<string>())
  const dispatches = useRef(new Map<string, Promise<void>>())
  const [lostIds, setLostIds] = useState<string[]>([])

  /**
   * 当前打开的对话：显式选过就用选的，否则落到最近的一段。
   * 派生而不是用 effect 去"补"一个状态——删掉当前这段之后该打开哪一段，
   * 本来就能从列表直接算出来。
   */
  const activeId = selectedId !== undefined && conversations.some(c => c.id === selectedId)
    ? selectedId
    : conversations[0]?.id

  /** 已接上事件流的对话：本地 id → 会话。 */
  const live = useRef(new Map<string, LiveSession>())
  /** 正在建会话的对话，避免同一时刻建出两个。 */
  const creating = useRef(new Map<string, Promise<LiveSession>>())
  /** 每条工具调用的 callId → 对话条目的 id，用于把结果写回同一行。按对话分开。 */
  const toolRows = useRef(new Map<string, Map<string, string>>())
  /** 本次页面加载里已经问过"上下文还在不在"的对话。 */
  const probed = useRef(new Set<string>())
  /** 确认上下文已经没了、下次发言要重新开始的对话。 */
  const lost = useRef(new Set<string>())

  const mountedRef = useRef(true)
  /*
   * 当前登录账户 id，服务端拿它决定图片落到哪个上传目录（不同账户互不可见）。
   *
   * 用 ref 而不是 props：这个 id 在一次页面加载里不会变（登录态在 sessionStorage），
   * 而 `send` 是 useCallback，把它写进依赖会让整条发送链路每次登录都重建。
   * 没有登录态时留空串——服务端会以 400 "缺少 accountId" 拒掉带图的那条，
   * 不会静默地把图存进某个公共目录。
   */
  const accountIdRef = useRef<string>(ownerId)
  /** state 的同步镜像：回调里要读最新值，而 setState 是异步的。 */
  const conversationsRef = useRef(conversations)
  const activeIdRef = useRef<string | undefined>(activeId)
  const busyRef = useRef(new Set<string>())

  // 镜像跟着渲染结果走，回调里才能立刻读到现在打开的是哪一段。
  useEffect(() => {
    activeIdRef.current = activeId
  }, [activeId])

  const commit = useCallback((next: StoredConversation[]) => {
    conversationsRef.current = next
    setConversations(next)
  }, [])

  const patch = useCallback((id: string, updater: (conversation: StoredConversation) => StoredConversation) => {
    commit(conversationsRef.current.map(c => (c.id === id ? updater(c) : c)))
  }, [commit])

  const pushItem = useCallback((convId: string, item: ChatItem) => {
    const now = Date.now()
    patch(convId, conversation => ({
      ...conversation,
      items: [...conversation.items, item],
      updatedAt: now,
    }))
  }, [patch])

  const setBusy = useCallback((convId: string, value: boolean) => {
    if (value) busyRef.current.add(convId)
    else busyRef.current.delete(convId)
    setBusyIds([...busyRef.current])
  }, [])

  /** 一段对话空闲、而且不是当前打开的那段 → 把事件流关掉（省连接）。 */
  const closeIfIdle = useCallback((convId: string) => {
    if (busyRef.current.has(convId)) return
    if (activeIdRef.current === convId) return
    const entry = live.current.get(convId)
    if (entry === undefined) return
    entry.close()
    live.current.delete(convId)
  }, [])

  /**
   * 把一段对话彻底从内存和列表里拿掉（**不碰服务端**：服务端与审计日志里的记录会保留）。
   *
   * 收摊的清单不能漏：事件流、正在建会话的 promise、工具行的映射、探测与失忆标记、
   * 忙碌集合、待确认事项，最后才是列表本身。漏掉任何一项，那段对话都会以某种形式
   * 阴魂不散——比如它的 SSE 还在推事件，写进一条已经不在列表里的对话。
   */
  const destroy = useCallback((id: string) => {
    live.current.get(id)?.close()
    live.current.delete(id)
    creating.current.delete(id)
    toolRows.current.delete(id)
    probed.current.delete(id)
    lost.current.delete(id)
    busyRef.current.delete(id)
    setBusyIds([...busyRef.current])
    setLostIds([...lost.current])
    setPendings((prev) => {
      if (!(id in prev)) return prev
      const rest = { ...prev }
      delete rest[id]
      return rest
    })
    commit(conversationsRef.current.filter(c => c.id !== id))
  }, [commit])

  const handleEvent = useCallback((convId: string, event: AgentEvent) => {
    if (['assistant', 'assistant-update', 'tool-call', 'error', 'stopped', 'session-restored'].includes(event.type)
      || event.type === 'status' && event.status === 'idle') {
      const current = conversationsRef.current.find(c => c.id === convId)
      if (current?.items.some(item => item.id === 'model_retry_progress')) {
        patch(convId, c => ({ ...c, items: c.items.filter(item => item.id !== 'model_retry_progress') }))
      }
    }
    switch (event.type) {
      case 'model-retry': {
        const count = `${event.attempt}${event.maxRetries ? `/${event.maxRetries}` : ''}`
        const text = event.phase === 'running' ? `正在自动重试（${count}）`
          : `${event.reason ?? '模型请求暂时失败'}，${Math.ceil(event.delayMs / 1000)} 秒后自动重试（${count}）`
        patch(convId, c => ({ ...c, items: [...c.items.filter(item => item.id !== 'model_retry_progress'),
          { kind: 'notice', id: 'model_retry_progress', tone: 'info', text }] }))
        return
      }
      case 'session-restored':
        setPendings(prev => { const next = { ...prev }; delete next[convId]; return next })
        setAsks(prev => { const next = { ...prev }; delete next[convId]; return next })
        patch(convId, c => ({ ...c, items: c.items.map(item => item.kind === 'tool' && item.state === 'running'
          ? { ...item, state: 'error', text: '本次处理已中断，请核对银行记录' }
          : item.kind === 'assistant' ? { ...item, streaming: false } : item) }))
        if (event.interrupted) pushItem(convId, { kind: 'notice', id: nextId(), text: '服务已恢复，上次处理已中断。已提交的业务请核对银行记录。', tone: 'info' })
        return
      case 'bank-updated':
        window.dispatchEvent(new Event('luckycat:bank-updated'))
        return
      case 'card-secret':
        window.dispatchEvent(new CustomEvent('luckycat:agent-card-secret', { detail: event }))
        return
      case 'hello':
        return
      case 'status':
        setBusy(convId, event.status === 'running')
        if (event.status !== 'running') {
          stoppingRef.current.delete(convId)
          setStoppingIds([...stoppingRef.current])
          patch(convId, conversation => ({ ...conversation, items: conversation.items.map(item =>
            item.kind === 'assistant' && item.streaming ? { ...item, streaming: false } : item) }))
          closeIfIdle(convId)
        }
        return
      case 'stopped':
        pushItem(convId, { kind: 'notice', id: nextId(), text: '已停止生成', tone: 'info' })
        patch(convId, c => ({ ...c, items: c.items.map(item => item.kind === 'tool' && item.state === 'running'
          ? { ...item, state: 'error', text: '已中断；已提交业务请以银行记录为准' } : item) }))
        return
      case 'assistant-update':
      case 'assistant':
        patch(convId, conversation => {
          const existing = event.messageId === undefined ? undefined : conversation.items.find(item =>
            item.kind === 'assistant' && item.messageId === event.messageId)
          // 完成后迟到或重复的快照不覆盖最终回复。
          if (event.type === 'assistant-update' && existing?.kind === 'assistant' && !existing.streaming) return conversation
          const item: ChatItem = { kind: 'assistant', id: existing?.id ?? nextId(), text: event.text,
            ...(event.messageId === undefined ? {} : { messageId: event.messageId }), streaming: event.type === 'assistant-update' }
          return { ...conversation, updatedAt: Date.now(), items: existing
            ? conversation.items.map(row => row.id === existing.id ? item : row) : [...conversation.items, item] }
        })
        return
      case 'assistant-reset':
        patch(convId, conversation => ({ ...conversation, items: conversation.items.filter(item =>
          item.kind !== 'assistant' || item.messageId !== event.messageId || !item.streaming) }))
        return
      case 'tool-call': {
        const id = nextId()
        const rows = toolRows.current.get(convId) ?? new Map<string, string>()
        rows.set(event.callId, id)
        toolRows.current.set(convId, rows)
        pushItem(convId, { kind: 'tool', id, name: event.name, state: 'running' })
        return
      }
      case 'tool-result': {
        const rows = toolRows.current.get(convId)
        const id = rows?.get(event.callId)
        const now = Date.now()
        patch(convId, conversation => {
          const target = id !== undefined
            ? conversation.items.find(item => item.id === id && item.kind === 'tool')
            : conversation.items.findLast(item => item.kind === 'tool' && item.state === 'running')
          const failureId = target ? `failure_${target.id}` : undefined
          const failure = event.isError && target?.kind === 'tool' && target.name.startsWith('bank_')
            && !conversation.items.some(item => item.id === failureId)
            ? [{ kind: 'notice' as const, id: failureId!, tone: 'error' as const,
                text: `${toolLabel(target.name)}未完成：${event.text.trim().replace(/^Error:\s*/, '').slice(0, 360)}` }]
            : []
          return {
            ...conversation,
            updatedAt: now,
            items: [...conversation.items.map<ChatItem>((item) => {
              if (item.kind !== 'tool') return item
              // 有 callId 就精确匹配；没有时只回填最后一个仍在执行的行。
              if (item.id !== target?.id) return item
              return { ...item, state: event.isError ? 'error' : 'done', text: summarize(item.name, event.text, event.isError) }
            }), ...failure],
          }
        })
        return
      }
      case 'consent':
        setPendings(prev => ({ ...prev, [convId]: { challenge: event.challenge, submitting: false } }))
        return
      case 'consent-resolved':
        setPendings(prev => {
          const current = prev[convId]
          if (current === undefined || current.challenge.challengeId !== event.challengeId) return prev
          const next = { ...prev }
          delete next[convId]
          return next
        })
        return
      case 'consent-decided':
        return
      case 'question':
        setAsks(prev => ({ ...prev, [convId]: { question: event.question, submitting: false } }))
        return
      case 'question-resolved':
        setAsks(prev => {
          const current = prev[convId]
          if (current === undefined || current.question.questionId !== event.questionId) return prev
          const next = { ...prev }
          delete next[convId]
          return next
        })
        return
      case 'error':
        pushItem(convId, { kind: 'notice', id: nextId(), text: event.message, tone: 'error' })
        return
      default:
        return
    }
  }, [closeIfIdle, patch, pushItem, setBusy])

  /** 开一条事件流，等它握手成功（收到 hello）再算就绪。 */
  const openStream = useCallback((convId: string, agentSessionId: string): Promise<() => void> => {
    return new Promise((resolve, reject) => {
      let settled = false
      let close: () => void = () => {}
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        close()
        reject(new Error('事件流连接超时'))
      }, 15_000)
      close = openAgentStream(agentSessionId, (event) => {
        if (event.type === 'hello') {
          if (settled) return
          settled = true
          clearTimeout(timer)
          resolve(close)
          return
        }
        handleEvent(convId, event)
      }, () => {
        // 两种接收方式都失败时取消底层连接，避免占用浏览器连接池。
        if (settled) return
        settled = true
        clearTimeout(timer)
        close()
        reject(new Error('事件流连接失败'))
      })
    })
  }, [handleEvent, openAgentStream])

  /**
   * 取当前对话的会话；没有就建一个（含事件流握手）。
   * @param convId - 本地对话 id。
   * @param fresh - 无视存下来的会话 id，另开一个（上下文已经失效时用）。
   * @returns 接上的会话。
   */
  const ensureLive = useCallback(async (convId: string, fresh = false): Promise<LiveSession> => {
    const inflight = creating.current.get(convId)
    if (fresh) {
      // 先把可能已经在建的旧会话收干净，免得建出两条流。
      if (inflight !== undefined) {
        try { (await inflight).close() } catch { /* 建失败就算了 */ }
        creating.current.delete(convId)
      }
      const stale = live.current.get(convId)
      if (stale !== undefined) {
        stale.close()
        live.current.delete(convId)
      }
    } else {
      const existing = live.current.get(convId)
      if (existing !== undefined) return existing
      if (inflight !== undefined) return await inflight
    }

    const task = (async (): Promise<LiveSession> => {
      const conversation = conversationsRef.current.find(c => c.id === convId)
      if (conversation === undefined) throw new Error('这段对话已经不在列表里了')
      let agentSessionId = fresh ? undefined : conversation.agentSessionId
      if (agentSessionId === undefined) {
        // 当前刚写入的待发消息另行提交，迁移时不重复带入。
        agentSessionId = await createAgentSession(fresh ? recoveryHistory(conversation.items.slice(0, -1)) : undefined)
        const created = agentSessionId
        patch(convId, c => ({ ...c, agentSessionId: created }))
        lost.current.delete(convId)
        setLostIds([...lost.current])
      }
      const close = await openStream(convId, agentSessionId)
      if (!mountedRef.current || !conversationsRef.current.some(c => c.id === convId)) {
        close()
        throw new Error('对话已关闭')
      }
      const entry: LiveSession = { agentSessionId, close }
      live.current.set(convId, entry)
      return entry
    })().finally(() => { creating.current.delete(convId) })

    creating.current.set(convId, task)
    return await task
  }, [openStream, patch, createAgentSession])

  /**
   * 先弄清"这一段在助手的记忆里还在不在"。
   *
   * 三种情况：本来就没会话（全新，直接开）；本次已经接上了（不用问）；
   * 从磁盘恢复来的（要问一次）。问不到时按"还记得"处理——按"忘了"处理会把
   * 一个还在的上下文丢掉，那是不可逆的；按"还记得"处理最坏只是答得不对。
   * @param convId - 本地对话 id。
   * @returns 'resume' 接着聊；'fresh' 上下文没了，要重新开始。
   */
  const prepare = useCallback(async (convId: string): Promise<'resume' | 'fresh'> => {
    const conversation = conversationsRef.current.find(c => c.id === convId)
    if (conversation?.agentSessionId === undefined) return 'fresh'
    if (live.current.has(convId)) return 'resume'
    if (probed.current.has(convId)) return lost.current.has(convId) ? 'fresh' : 'resume'
    const state = await probeAgentSession(conversation.agentSessionId)
    if (!mountedRef.current) return 'resume'
    if (state === null) return 'resume'
    probed.current.add(convId)
    if (state.known) return 'resume'
    lost.current.add(convId)
    setLostIds([...lost.current])
    return 'fresh'
  }, [probeAgentSession])

  /**
   * 把一句话真正发出去（接上会话 → 发过去 → 失败就写成一条通知）。
   *
   * 抽出来是因为「发新话」和「倒回重发」要走的**是同一段路**：
   * 都得先弄清上下文还在不在（`prepare`），再确保事件流接上了（`ensureLive`）。
   * 唯一的区别是谁把这句话写进列表——`send` 追加一条，`rewind` 是倒回后重写。
   * @param convId - 本地对话 id。
   * @param value - 已经 trim 过、并且已经写进列表的那句话。
   */
  /**
   * @param convId - 本地对话 id。
   * @param value - 已经 trim 过、并且已经写进列表的那句话。
   * @param image - 一起发出去的图片（已压缩的那份）。
   */
  const dispatch = useCallback((convId: string, value: string, image?: PreparedImage, serviceIds?: readonly string[]) => {
    setBusy(convId, true)
    const task = (async () => {
      try {
        const mode = await prepare(convId)
        if (!mountedRef.current) return
        // 旧版文字在建新会话时自动迁入；新版按原会话继续。
        const session = await ensureLive(convId, mode === 'fresh')
        if (!mountedRef.current) return
        if (stoppingRef.current.has(convId)) {
          setBusy(convId, false)
          return
        }
        await sendAgentMessage(
          session.agentSessionId,
          value,
          image === undefined ? undefined : { data: image.data, mimeType: image.mimeType },
          accountIdRef.current,
          serviceIds,
        )
      } catch (error) {
        if (!mountedRef.current) return
        setBusy(convId, false)
        pushItem(convId, {
          kind: 'notice',
          id: nextId(),
          text: `发送失败：${error instanceof Error ? error.message : String(error)}`,
          tone: 'error',
        })
      }
    })().finally(() => { dispatches.current.delete(convId) })
    dispatches.current.set(convId, task)
  }, [ensureLive, prepare, pushItem, setBusy, sendAgentMessage])

  const stop = useCallback(() => {
    const convId = activeIdRef.current
    if (!convId || !busyRef.current.has(convId) || stoppingRef.current.has(convId)) return
    stoppingRef.current.add(convId)
    setStoppingIds([...stoppingRef.current])
    void (async () => {
      try {
        // 等入队请求完成，避免停止先于本轮提交；还没提交时 dispatch 会直接退出。
        await dispatches.current.get(convId)
        const sessionId = live.current.get(convId)?.agentSessionId
        if (sessionId && busyRef.current.has(convId)) await stopAgentTurn(sessionId)
      } catch (error) {
        pushItem(convId, { kind: 'notice', id: nextId(), text: `停止失败：${error instanceof Error ? error.message : String(error)}`, tone: 'error' })
      } finally {
        if (mountedRef.current) {
          stoppingRef.current.delete(convId)
          setStoppingIds([...stoppingRef.current])
        }
      }
    })()
  }, [pushItem, stopAgentTurn])

  const send = useCallback((text: string, image?: PreparedImage, serviceIds?: readonly string[]) => {
    const value = text.trim()
    const convId = activeIdRef.current
    // 只发图不打字是允许的；两个都空才是真的没内容。
    if ((value === '' && image === undefined) || status !== 'ready' || convId === undefined) return
    if (busyRef.current.has(convId)) return
    // 有待确认卡片、或者模型正等着用户答那张问题卡片时，都不许再发新话：
    // 前者会绕过一笔还没执行的敏感操作，后者会让模型的提问和用户的新要求错位。
    if (pendings[convId] !== undefined || asks[convId] !== undefined) return
    const conversation = conversationsRef.current.find(c => c.id === convId)
    if (conversation === undefined) return

    // 第一句话定标题；改过名的就不动了。只有图片时用文件名当标题。
    const wasUntitled = conversation.titleEdited !== true && conversation.title === '新对话'
    const promptId = nextId()
    if (image) retryImage.current = { convId, promptId, image }
    pushItem(convId, {
      kind: 'user',
      id: promptId,
      text: value,
      ...serviceIds === undefined ? {} : { serviceIds: [...serviceIds] },
      ...image === undefined ? {} : { thumb: image.thumb, imageName: image.name },
    })
    if (wasUntitled) patch(convId, c => ({ ...c, title: titleFrom(value === '' ? image?.name ?? '' : value) }))
    dispatch(convId, value, image, serviceIds === undefined ? undefined : [...serviceIds])
  }, [asks, dispatch, patch, pendings, pushItem, status])

  const retry = useCallback((promptId: string) => {
    const convId = activeIdRef.current
    if (status !== 'ready' || !convId || busyRef.current.has(convId) || stoppingRef.current.has(convId)
      || pendings[convId] || asks[convId]) return
    const conversation = conversationsRef.current.find(c => c.id === convId)
    if (!conversation) return
    const plan = prepareTurnRetry(conversation.items, promptId)
    if (!plan) return
    const image = retryImage.current?.convId === convId && retryImage.current.promptId === promptId
      ? retryImage.current.image : undefined
    if (plan.prompt.thumb && !image) {
      pushItem(convId, { kind: 'notice', id: nextId(), tone: 'error', text: '原图已不在当前页面，请重新上传图片后发送；不会只发送文字来代替图片请求。' })
      return
    }
    patch(convId, c => ({ ...c, items: plan.items, updatedAt: Date.now() }))
    dispatch(convId, retryRequestText(plan.prompt.text), image, plan.prompt.serviceIds)
  }, [asks, dispatch, patch, pendings, pushItem, status])

  /**
   * 倒回某条用户消息并重发。
   *
   * 三种情况会被挡下来，都是"宁可什么都不做，也不要做出一个用户没想要的结果"：
   *   · 这段话正在回答中（倒回会把正在写的那条抹掉，而事件流还在往里写）
   *   · 有一张待确认的卡片没处理（那是一笔**还没执行**的敏感操作，先处理完它）
   *   · 倒回的目标不是用户说的话、或找到之后是空的
   * @param itemId - 倒回到的那条用户消息。
   * @param text - 换成新的说法（编辑重发）；不传就沿用原文（重新生成）。
   */
  const rewind = useCallback((itemId: string, text?: string) => {
    const convId = activeIdRef.current
    if (status !== 'ready' || convId === undefined) return
    if (busyRef.current.has(convId) || pendings[convId] !== undefined || asks[convId] !== undefined) return
    const conversation = conversationsRef.current.find(c => c.id === convId)
    if (conversation === undefined) return

    const value = text === undefined ? undefined : text.trim()
    if (value === '') return
    // 传进来的可能是助手回复（"重新生成"的按钮挂在回复上），
    // 先换算成产生它的那句提问，`rewindTo` 只认用户消息。
    const promptId = promptOf(conversation.items, itemId)
    if (promptId === undefined) return
    const next = rewindTo(conversation.items, promptId, value)
    if (next === undefined) return
    const last = next[next.length - 1]
    if (last === undefined || last.kind !== 'user' || last.text.trim() === '') return

    // 丢掉的那些工具行不会再收到结果了，把 callId 的映射一并清掉：
    // 留着它只会让后面某条 tool-result 去找一条已经不在列表里的行。
    toolRows.current.delete(convId)
    // 名字是跟着第一句话起的；没手动改过就跟着新说法走。
    const firstUser = next.find(item => item.kind === 'user')
    patch(convId, c => ({
      ...c,
      items: next,
      updatedAt: Date.now(),
      ...conversation.titleEdited === true || firstUser === undefined
        ? {}
        : { title: titleFrom(firstUser.text) },
    }))
    dispatch(convId, last.text.trim(), undefined, last.serviceIds)
  }, [asks, dispatch, patch, pendings, status])

  const answer = useCallback((decision: 'approve' | 'reject', paymentPassword?: string, riskAcknowledgement?: string, customerVerification?: CustomerVerification) => {
    const convId = activeIdRef.current
    if (convId === undefined) return
    const current = pendings[convId]
    if (current === undefined) return
    const challengeId = current.challenge.challengeId
    setPendings(prev => ({ ...prev, [convId]: { ...current, submitting: true, error: undefined } }))
    void answerConsent(challengeId, decision,
      decision === 'approve' ? paymentPassword : undefined,
      decision === 'approve' ? riskAcknowledgement : undefined,
      decision === 'approve' ? customerVerification : undefined,
    ).then((result) => {
      if (!mountedRef.current) return
      // 成功时真正的移除交给 consent-resolved 事件；这里只收起"提交中"。
      setPendings(prev => {
        const entry = prev[convId]
        if (entry === undefined || entry.challenge.challengeId !== challengeId) return prev
        return {
          ...prev,
          [convId]: result.ok
            ? { ...entry, submitting: false }
            : { ...entry, submitting: false, error: result.error ?? '确认失败' },
        }
      })
    })
  }, [pendings, answerConsent])

  /**
   * 答复一次问询。
   *
   * 和确认卡片一样：提交成功之后**不在这里删**，等 `question-resolved` 事件回来再收。
   * 差别是失败时不用清空——用户选的东西还在，改一下能再提交，
   * 而确认卡片失败通常是密码错，也该让他重输。
   */
  const answerAsk = useCallback((answers: QuestionAnswerItem[]) => {
    const convId = activeIdRef.current
    if (convId === undefined) return
    const current = asks[convId]
    if (current === undefined) return
    const questionId = current.question.questionId
    setAsks(prev => ({ ...prev, [convId]: { ...current, submitting: true, error: undefined } }))
    void answerQuestion(questionId, answers).then((result) => {
      if (!mountedRef.current) return
      setAsks(prev => {
        const entry = prev[convId]
        if (entry === undefined || entry.question.questionId !== questionId) return prev
        return {
          ...prev,
          [convId]: result.ok
            ? { ...entry, submitting: false }
            : { ...entry, submitting: false, error: result.error ?? '答复失败' },
        }
      })
    })
  }, [asks, answerQuestion])

  /**
   * 新建一段对话。
   *
   * **当前已经是空对话就什么都不做。** 用户点「新对话」的意图是"给我一张白纸"，
   * 而白纸已经在这儿了；再建一段的结果是列表里慢慢堆一串用不上的「新对话」。
   * 界面上这个按钮在空对话时是禁用的，这里再兜一道：`create` 也能被代码调到。
   */
  const create = useCallback(() => {
    const current = conversationsRef.current.find(c => c.id === activeIdRef.current)
    if (current !== undefined && isEmptyConversation(current)) return
    const conversation = makeConversation()
    commit([conversation, ...conversationsRef.current])
    activeIdRef.current = conversation.id
    setSelectedId(conversation.id)
    if (current !== undefined) closeIfIdle(current.id)
  }, [closeIfIdle, commit])

  /** 打开一段的事件流（已经有 agent 会话 id 才需要）。 */
  const openForViewing = useCallback((convId: string) => {
    const conversation = conversationsRef.current.find(c => c.id === convId)
    if (conversation?.agentSessionId === undefined) return
    if (live.current.has(convId) || creating.current.has(convId)) return
    void ensureLive(convId).catch(() => {
      // 打不开就算了：发消息时会再试一次，失败会以通知的形式出现在对话里。
    })
  }, [ensureLive])

  const select = useCallback((id: string) => {
    const previous = activeIdRef.current
    if (previous === id) return
    activeIdRef.current = id
    setSelectedId(id)
    // 离开一段空对话就把它销毁。空对话没有内容可回看，留着只是在列表里占位；
    // 而且这时候刚刚新建它的那个动作已经被用户放弃了（他改主意去看了别的）。
    const leaving = previous === undefined
      ? undefined
      : conversationsRef.current.find(c => c.id === previous)
    if (leaving !== undefined && isEmptyConversation(leaving)) destroy(leaving.id)
    else if (previous !== undefined) closeIfIdle(previous)
    openForViewing(id)
  }, [closeIfIdle, destroy, openForViewing])

  const rename = useCallback((id: string, title: string) => {
    const clean = title.trim()
    patch(id, c => clean === ''
      // 清空 = 恢复自动标题：下一句话重新起名。
      ? { ...c, title: '新对话', titleEdited: false }
      : { ...c, title: clean.slice(0, 40), titleEdited: true })
  }, [patch])

  const remove = useCallback((id: string) => {
    const wasActive = activeIdRef.current === id
    destroy(id)
    if (wasActive) {
      const next = conversationsRef.current[0]?.id
      activeIdRef.current = next
      setSelectedId(next)
    }
  }, [destroy])

  // 挂载时探测一次。刻意**不**建会话：会话按需创建，避免留下空日志。
  useEffect(() => {
    mountedRef.current = true
    // 捕获 Map 本身（身份不变，只是一直被改），而不是在清理函数里读 `live.current`。
    const open = live.current
    const shutdown = () => {
      mountedRef.current = false
      for (const entry of open.values()) entry.close()
      open.clear()
    }
    if (!agentEnabled) return shutdown
    let cancelled = false
    void (async () => {
      const health = await probeAgent()
      if (cancelled || !mountedRef.current) return
      if (health === null) {
        setStatus('off')
        return
      }
      setVoice(health.voice)
      setStatus('ready')
    })()
    return () => {
      cancelled = true
      shutdown()
    }
  }, [agentEnabled, probeAgent])

  // 当前这段打开时确认一下上下文还在不在（一次页面加载只问一次）。
  useEffect(() => {
    if (status !== 'ready' || activeId === undefined) return
    const conversation = conversationsRef.current.find(c => c.id === activeId)
    if (conversation?.agentSessionId === undefined) return
    if (probed.current.has(activeId) || live.current.has(activeId)) return
    const target = activeId
    void prepare(target).then((mode) => {
      if (!mountedRef.current || mode === 'fresh') return
      if (activeIdRef.current === target) openForViewing(target)
    })
  }, [activeId, openForViewing, prepare, status])

  // 生成期间节流写盘，完成时立即保存；关标签页前补存当前快照。
  useEffect(() => {
    const save = () => saveConversations(conversationsRef.current, historyOwnerRef.current)
    const streaming = conversations.some(c => c.items.some(item => item.kind === 'assistant' && item.streaming))
    if (!streaming) { save(); return }
    const timer = window.setTimeout(save, 300)
    window.addEventListener('pagehide', save)
    return () => { window.clearTimeout(timer); window.removeEventListener('pagehide', save) }
  }, [conversations])

  const active = useMemo(
    () => conversations.find(c => c.id === activeId),
    [activeId, conversations],
  )

  return {
    status,
    voice,
    conversations,
    activeId,
    active,
    busyIds,
    stopping: activeId !== undefined && stoppingIds.includes(activeId),
    stop,
    lostIds,
    pending: activeId === undefined ? undefined : pendings[activeId],
    ask: activeId === undefined ? undefined : asks[activeId],
    contextLost: activeId !== undefined && lostIds.includes(activeId),
    activeIsEmpty: active !== undefined && isEmptyConversation(active),
    send,
    rewind,
    retry,
    answer,
    answerAsk,
    create,
    select,
    rename,
    remove,
  }
}

/**
 * 把工具结果压成**一行给人看的摘要**。
 *
 * 两条规矩：
 *   1. 按工具名认形状，**绝不把原始 JSON 直接倒到界面上**——工具结果里有
 *      `corpusPath` 这类内部字段，之前就在客户的聊天窗里显示过
 *      `/home/…/framework/examples/bank/corpus.json`（实测踩到）；
 *   2. 认不出来的形状就说"已完成"，宁可少说，也不泄漏内部结构。
 * 完整结果在会话日志里，排查问题看那边。
 * @param name - 工具名。
 * @param text - 工具返回的渲染文本（JSON 字符串）。
 * @returns 一行摘要。
 */
function summarize(name: string, text: string, isError = false): string {
  // 原生技能结果包含指令和资源路径，只保留办理状态；完整内容留在日志。
  if (name === 'skill') return isError ? '办理流程暂时无法准备，请稍后重试' : '办理流程已就绪'
  const trimmed = text.trim()
  if (trimmed === '') return ''
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(trimmed) as Record<string, unknown>
  } catch {
    // 不是 JSON：只取第一行、限长，避免把一大段原文塞进标签。
    const firstLine = trimmed.split('\n')[0] ?? ''
    return firstLine.length > 60 ? `${firstLine.slice(0, 60)}…` : firstLine
  }

  if (parsed['dataSource'] === 'http') {
    if (name === 'bank_reveal_card_secret') return '已在临时窗口展示'
    if (name === 'bank_get_balance') return Array.isArray(parsed['accounts']) ? `已查询 ${parsed['accounts'].length} 个账户` : '已完成'
    const result = parsed['result']
    if (Array.isArray(result)) {
      if (name === 'bank_wealth_quote') return `${result.length} 个理财产品`
      if (name === 'bank_list_scheduled') return result.length ? `${result.length} 条定时动作` : '暂无定时动作'
      return '已完成'
    }
    if (result && typeof result === 'object') {
      parsed = result as Record<string, unknown>
      if (typeof parsed['referenceNo'] === 'string') return `回执号 ${parsed['referenceNo']}`
      if (name === 'bank_list_transactions' && Array.isArray(parsed['items'])) return `${parsed['items'].length} 条流水`
      if (name === 'bank_wealth_subscribe') return '银行已确认申购'
      if (name === 'bank_wealth_redeem') return '银行已受理赎回'
      if (name === 'bank_wealth_quote' && typeof parsed['name'] === 'string') return parsed['name']
    }
  }

  // 失败信息始终如实显示——那是客户需要知道的。
  if (typeof parsed['error'] === 'string') return parsed['error']

  const reference = parsed['reference']
  if (typeof reference === 'string') return `回执号 ${reference}`

  switch (name) {
    case 'knowledge_lookup': {
      const hits = parsed['hits']
      if (!Array.isArray(hits)) return '已完成'
      if (hits.length === 0) return '知识库里没有相关资料'
      const mode = parsed['mode'] === 'hybrid' ? '向量 + 关键词' : '关键词'
      return `找到 ${hits.length} 段资料（${mode}）`
    }
    case 'bank_get_balance':
      return typeof parsed['balance'] === 'string' ? `余额 ${parsed['balance']}` : '已完成'
    case 'bank_list_transactions': {
      const rows = parsed['transactions']
      return Array.isArray(rows) ? `${rows.length} 条流水` : '已完成'
    }
    case 'bank_get_transaction_detail': {
      const amount = parsed['amount']
      const counterparty = parsed['counterparty']
      return typeof amount === 'string' && typeof counterparty === 'string'
        ? `${counterparty} · ${amount}`
        : '已完成'
    }
    case 'bank_wealth_quote': {
      const risk = parsed['riskLevel']
      return typeof risk === 'string' ? `风险等级 ${risk}` : '已完成'
    }
    case 'bank_reveal_card_secret':
      return '已返回占位值（非真实卡信息）'

    // —— 赛题工程扩展 ——
    case 'bank_resolve_payee': {
      const candidates = parsed['candidates']
      return Array.isArray(candidates)
        ? (candidates.length ? `匹配到 ${candidates.length} 位收款人` : '没有匹配的收款人')
        : '已完成'
    }
    case 'bank_schedule_transfer': {
      const action = parsed['action'] as Record<string, unknown> | undefined
      const title = action && typeof action['title'] === 'string' ? action['title'] : null
      return title ? `已创建定时动作「${title}」` : '已创建定时动作'
    }
    case 'bank_list_scheduled': {
      const rows = parsed['actions'] ?? parsed
      return Array.isArray(rows) ? (rows.length ? `${rows.length} 条定时动作` : '暂无定时动作') : '已完成'
    }
    case 'bank_cancel_scheduled': {
      const title = typeof parsed['title'] === 'string' ? parsed['title'] : null
      return title ? `已取消「${title}」` : '已取消定时动作'
    }
    case 'bank_wealth_compare': {
      const count = parsed['count']
      return typeof count === 'number' ? `已对比 ${count} 个产品` : '已完成'
    }
    case 'bank_list_invest_plans': {
      const plans = parsed['plans']
      return Array.isArray(plans) ? (plans.length ? `${plans.length} 个定投计划` : '暂无定投计划') : '已完成'
    }
    case 'bank_create_invest_plan':
    case 'bank_pause_invest_plan':
    case 'bank_terminate_invest_plan': {
      const productName = typeof parsed['productName'] === 'string' ? parsed['productName'] : null
      const done = name === 'bank_create_invest_plan' ? '已创建定投' : name === 'bank_pause_invest_plan' ? '已暂停定投' : '已终止定投'
      return productName ? `${done}「${productName}」` : done
    }
    case 'bank_list_savings_goals': {
      const goals = parsed['goals']
      return Array.isArray(goals) ? (goals.length ? `${goals.length} 个存钱目标` : '暂无存钱目标') : '已完成'
    }
    case 'bank_create_savings_goal':
    case 'bank_update_savings_goal':
    case 'bank_set_savings_sweep': {
      const goalName = typeof parsed['name'] === 'string' ? parsed['name'] : null
      const done = name === 'bank_create_savings_goal' ? '已创建目标' : name === 'bank_update_savings_goal' ? '已保存目标' : '已设置归集'
      return goalName ? `${done}「${goalName}」` : done
    }
    case 'bank_delete_savings_goal':
      return '已删除目标'
    case 'bank_get_cash_management':
      return '已查询现金管理'
    case 'bank_update_cash_sweep':
      return '已更新自动归集'
    case 'bank_get_insurance': {
      const policies = parsed['policies']
      return Array.isArray(policies) ? `已查询 ${policies.length} 份保单` : '已完成'
    }
    case 'bank_enroll_insurance': {
      const productName = typeof parsed['productName'] === 'string' ? parsed['productName'] : null
      return productName ? `已投保「${productName}」` : '已投保'
    }
    default:
      return '已完成'
  }
}
