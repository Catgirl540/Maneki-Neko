/**
 * agent 对话状态：把 SSE 事件整理成界面能直接渲染的东西。
 *
 * 与固定话术那条路**并存**：agent 服务不在时 `status` 为 'off'，
 * 页面回落到原来的固定话术，部署在纯静态环境（bank.waveflow.cn）上不受影响。
 *
 * 会话是**懒创建**的：不打开页面就建会话会平白多出一堆空会话日志。
 * 创建时会等事件流真正握手成功（收到 `hello`）再返回，否则"发言早于订阅"
 * 会丢掉开头的事件——这是实测踩到的（点「新对话」后立刻发消息，回答永远不来）。
 *
 * @module app/lib/useAgentChat
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  agentEnabled,
  answerConsent,
  createAgentSession,
  openAgentStream,
  probeAgent,
  sendAgentMessage,
  type AgentEvent,
  type ConsentChallenge,
} from '@/api/agent'

/** 对话里的一条内容。 */
export type ChatItem =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string }
  | { kind: 'tool'; id: string; name: string; state: 'running' | 'done' | 'error'; text?: string }
  | { kind: 'notice'; id: string; text: string; tone: 'info' | 'error' }

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

let seq = 0
const nextId = (): string => `i${++seq}`

/** 工具名的中文标签（只是展示用；没有映射的显示原名）。 */
const TOOL_LABELS: Record<string, string> = {
  knowledge_lookup: '查询知识库',
  bank_get_balance: '查询余额',
  bank_list_transactions: '查询交易流水',
  bank_get_transaction_detail: '查看交易详情',
  bank_transfer: '转账',
  bank_wealth_quote: '查询理财产品',
  bank_wealth_subscribe: '申购理财产品',
  bank_wealth_redeem: '赎回理财产品',
  bank_reveal_card_secret: '查看卡安全信息',
  luckycat_ping: '框架自检',
}

/** 工具名的中文标签。 */
export function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? name
}

/** 一个已就绪的 agent 会话。 */
interface LiveSession {
  id: string
  close: () => void
}

export interface AgentChat {
  /** 通道状态：探测中 / 不可用（回落固定话术）/ 可用。 */
  status: AgentStatus
  /** 当前模型名（可用时才有）。 */
  model?: string
  /** 对话内容。 */
  items: ChatItem[]
  /** 正在等待回复。 */
  busy: boolean
  /** 待用户确认的敏感操作。 */
  pending?: PendingConsent
  /** 发一条消息。 */
  send: (text: string) => void
  /** 答复待确认事项。 */
  answer: (decision: 'approve' | 'reject', paymentPassword?: string) => void
  /** 清空对话（下次发言时另开一个 agent 会话，旧上下文不再影响）。 */
  reset: () => void
}

/**
 * agent 对话 hook。挂载时只做一次健康探测；服务不在就保持 off，不发任何请求。
 * @returns 对话状态与操作。
 */
export function useAgentChat(): AgentChat {
  const [status, setStatus] = useState<AgentStatus>(agentEnabled ? 'probing' : 'off')
  const [model, setModel] = useState<string | undefined>(undefined)
  const [items, setItems] = useState<ChatItem[]>([])
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<PendingConsent | undefined>(undefined)

  /** 当前会话；未创建或已重置时为 undefined。 */
  const sessionRef = useRef<LiveSession | undefined>(undefined)
  /** 会话创建中的 promise，避免同一时刻建出两个会话。 */
  const creatingRef = useRef<Promise<LiveSession> | undefined>(undefined)
  /** 每条工具调用的 callId → 对话条目的 id，用于把结果写回同一行。 */
  const toolRows = useRef(new Map<string, string>())
  const mountedRef = useRef(true)

  const pushItem = useCallback((item: ChatItem) => {
    if (!mountedRef.current) return
    setItems(prev => [...prev, item])
  }, [])

  const handleEvent = useCallback((event: AgentEvent) => {
    switch (event.type) {
      case 'hello':
        return
      case 'status':
        setBusy(event.status === 'running')
        return
      case 'assistant':
        pushItem({ kind: 'assistant', id: nextId(), text: event.text })
        return
      case 'tool-call': {
        const id = nextId()
        toolRows.current.set(event.callId, id)
        pushItem({ kind: 'tool', id, name: event.name, state: 'running' })
        return
      }
      case 'tool-result': {
        const id = toolRows.current.get(event.callId)
        setItems(prev => prev.map(item => {
          if (item.kind !== 'tool') return item
          // 有 callId 就精确匹配；没有（上游偶尔不回填）就退回"最后一个还在执行的行"。
          if (id !== undefined ? item.id !== id : item.state !== 'running') return item
          return { ...item, state: event.isError ? 'error' : 'done', text: summarize(item.name, event.text) }
        }))
        return
      }
      case 'consent':
        setPending({ challenge: event.challenge, submitting: false })
        return
      case 'consent-resolved':
        setPending(prev => prev?.challenge.challengeId === event.challengeId ? undefined : prev)
        return
      case 'consent-decided':
        return
      case 'error':
        pushItem({ kind: 'notice', id: nextId(), text: event.message, tone: 'error' })
        return
      default:
        return
    }
  }, [pushItem])

  /** 开一条事件流，等它握手成功（收到 hello）再算就绪。 */
  const openStream = useCallback((sessionId: string): Promise<() => void> => {
    return new Promise((resolve, reject) => {
      let settled = false
      let close: () => void = () => {}
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        close()
        reject(new Error('事件流连接超时'))
      }, 8_000)
      close = openAgentStream(sessionId, (event) => {
        if (event.type === 'hello') {
          if (settled) return
          settled = true
          clearTimeout(timer)
          resolve(close)
          return
        }
        handleEvent(event)
      }, () => {
        // EventSource 会自己重连；只在还没握手时把它当作失败。
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(new Error('事件流连接失败'))
      })
    })
  }, [handleEvent])

  /** 取当前会话；没有就建一个（含事件流握手）。 */
  const ensureSession = useCallback(async (): Promise<LiveSession> => {
    const existing = sessionRef.current
    if (existing !== undefined) return existing
    creatingRef.current ??= (async () => {
      const id = await createAgentSession()
      const close = await openStream(id)
      const live: LiveSession = { id, close }
      sessionRef.current = live
      return live
    })().finally(() => { creatingRef.current = undefined })
    return await creatingRef.current
  }, [openStream])

  // 挂载时探测一次。刻意**不**建会话：会话按需创建，避免留下空日志。
  useEffect(() => {
    mountedRef.current = true
    if (!agentEnabled) return
    let cancelled = false
    void (async () => {
      const health = await probeAgent()
      if (cancelled || !mountedRef.current) return
      if (health === null) {
        setStatus('off')
        return
      }
      setModel(health.model)
      setStatus('ready')
    })()
    return () => {
      cancelled = true
      mountedRef.current = false
      sessionRef.current?.close()
      sessionRef.current = undefined
    }
  }, [])

  const send = useCallback((text: string) => {
    const value = text.trim()
    if (value === '' || status !== 'ready') return
    pushItem({ kind: 'user', id: nextId(), text: value })
    setBusy(true)
    void (async () => {
      try {
        const session = await ensureSession()
        if (!mountedRef.current) return
        await sendAgentMessage(session.id, value)
      } catch (error) {
        if (!mountedRef.current) return
        setBusy(false)
        pushItem({
          kind: 'notice',
          id: nextId(),
          text: `发送失败：${error instanceof Error ? error.message : String(error)}`,
          tone: 'error',
        })
      }
    })()
  }, [ensureSession, pushItem, status])

  const answer = useCallback((decision: 'approve' | 'reject', paymentPassword?: string) => {
    const current = pending
    if (current === undefined) return
    const challengeId = current.challenge.challengeId
    if (decision === 'reject') {
      setPending(undefined)
      void answerConsent(challengeId, 'reject')
      return
    }
    setPending({ ...current, submitting: true, error: undefined })
    void answerConsent(challengeId, 'approve', paymentPassword).then((result) => {
      if (!mountedRef.current) return
      // 成功时真正的移除交给 consent-resolved 事件；这里只收起"提交中"。
      setPending(prev => prev?.challenge.challengeId === challengeId
        ? result.ok
          ? { ...prev, submitting: false }
          : { ...prev, submitting: false, error: result.error ?? '确认失败' }
        : prev)
    })
  }, [pending])

  const reset = useCallback(() => {
    sessionRef.current?.close()
    sessionRef.current = undefined
    toolRows.current.clear()
    setItems([])
    setPending(undefined)
    setBusy(false)
  }, [])

  return { status, model, items, busy, pending, send, answer, reset }
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
function summarize(name: string, text: string): string {
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
    default:
      return '已完成'
  }
}
