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
import {
  agentEnabled,
  answerConsent,
  createAgentSession,
  openAgentStream,
  probeAgent,
  probeAgentSession,
  sendAgentMessage,
  type AgentEvent,
  type ConsentChallenge,
} from '@/api/agent'
import {
  loadConversations,
  makeConversation,
  saveConversations,
  titleFrom,
  type ChatItem,
  type StoredConversation,
} from '@/lib/agentSessions'

export type { ChatItem, StoredConversation } from '@/lib/agentSessions'

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

/** 一条已接上的会话：agent 侧会话 id + 关流函数。 */
interface LiveSession {
  agentSessionId: string
  close: () => void
}

export interface AgentChat {
  /** 通道状态：探测中 / 不可用（回落固定话术）/ 可用。 */
  status: AgentStatus
  /** 当前模型名（可用时才有）。 */
  model?: string
  /** 历史对话，从新到旧。 */
  conversations: StoredConversation[]
  /** 当前打开的对话 id。 */
  activeId?: string
  /** 当前打开的对话。 */
  active?: StoredConversation
  /** 正在回答的对话 id（**不止当前这一段**，列表上用得到）。 */
  busyIds: string[]
  /** 上下文已经不在助手记忆里的对话 id（列表上标出来）。 */
  lostIds: string[]
  /** 当前对话待确认的敏感操作。 */
  pending?: PendingConsent
  /** 当前对话的上下文已经不在助手的记忆里（服务重启过）。 */
  contextLost: boolean
  /** 发一条消息到当前对话。 */
  send: (text: string) => void
  /** 答复当前对话待确认的事项。 */
  answer: (decision: 'approve' | 'reject', paymentPassword?: string) => void
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
export function useAgentChat(): AgentChat {
  const [status, setStatus] = useState<AgentStatus>(agentEnabled ? 'probing' : 'off')
  const [model, setModel] = useState<string | undefined>(undefined)
  const [conversations, setConversations] = useState<StoredConversation[]>(() => {
    const loaded = loadConversations()
    // 列表里最少留一段：一段都没有的时候直接给一段空的，
    // 省得用户先点「新对话」才能开口。
    return loaded.length === 0 ? [makeConversation()] : loaded
  })
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined)
  const [busyIds, setBusyIds] = useState<string[]>([])
  const [pendings, setPendings] = useState<Record<string, PendingConsent>>({})
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

  const handleEvent = useCallback((convId: string, event: AgentEvent) => {
    switch (event.type) {
      case 'hello':
        return
      case 'status':
        setBusy(convId, event.status === 'running')
        if (event.status !== 'running') closeIfIdle(convId)
        return
      case 'assistant':
        pushItem(convId, { kind: 'assistant', id: nextId(), text: event.text })
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
        patch(convId, conversation => ({
          ...conversation,
          updatedAt: now,
          items: conversation.items.map((item) => {
            if (item.kind !== 'tool') return item
            // 有 callId 就精确匹配；没有（上游偶尔不回填）就退回"最后一个还在执行的行"。
            if (id !== undefined ? item.id !== id : item.state !== 'running') return item
            return { ...item, state: event.isError ? 'error' : 'done', text: summarize(item.name, event.text) }
          }),
        }))
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
      }, 8_000)
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
        // EventSource 会自己重连；只在还没握手时把它当作失败。
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(new Error('事件流连接失败'))
      })
    })
  }, [handleEvent])

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
        agentSessionId = await createAgentSession()
        const created = agentSessionId
        patch(convId, c => ({ ...c, agentSessionId: created }))
      }
      const close = await openStream(convId, agentSessionId)
      const entry: LiveSession = { agentSessionId, close }
      live.current.set(convId, entry)
      return entry
    })().finally(() => { creating.current.delete(convId) })

    creating.current.set(convId, task)
    return await task
  }, [openStream, patch])

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
    if (state.started) return 'resume'
    lost.current.add(convId)
    setLostIds([...lost.current])
    return 'fresh'
  }, [])

  const send = useCallback((text: string) => {
    const value = text.trim()
    const convId = activeIdRef.current
    if (value === '' || status !== 'ready' || convId === undefined) return
    if (busyRef.current.has(convId)) return
    const conversation = conversationsRef.current.find(c => c.id === convId)
    if (conversation === undefined) return

    // 第一句话定标题；改过名的就不动了。
    const wasUntitled = conversation.titleEdited !== true && conversation.title === '新对话'
    pushItem(convId, { kind: 'user', id: nextId(), text: value })
    if (wasUntitled) patch(convId, c => ({ ...c, title: titleFrom(value) }))
    setBusy(convId, true)

    void (async () => {
      try {
        const mode = await prepare(convId)
        if (!mountedRef.current) return
        // 上下文没了的时候**不在这里补一条通知**：界面上有一条常驻的提示，
        // 在用户按下发送之前就已经写着了（见 SupportPage 的 contextLost）。
        const session = await ensureLive(convId, mode === 'fresh')
        if (!mountedRef.current) return
        await sendAgentMessage(session.agentSessionId, value)
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
    })()
  }, [ensureLive, patch, prepare, pushItem, setBusy, status])

  const answer = useCallback((decision: 'approve' | 'reject', paymentPassword?: string) => {
    const convId = activeIdRef.current
    if (convId === undefined) return
    const current = pendings[convId]
    if (current === undefined) return
    const challengeId = current.challenge.challengeId
    if (decision === 'reject') {
      setPendings(prev => {
        const next = { ...prev }
        delete next[convId]
        return next
      })
      void answerConsent(challengeId, 'reject')
      return
    }
    setPendings(prev => ({ ...prev, [convId]: { ...current, submitting: true, error: undefined } }))
    void answerConsent(challengeId, 'approve', paymentPassword).then((result) => {
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
  }, [pendings])

  const create = useCallback(() => {
    const conversation = makeConversation()
    commit([conversation, ...conversationsRef.current])
    activeIdRef.current = conversation.id
    setSelectedId(conversation.id)
  }, [commit])

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
    if (previous !== undefined) closeIfIdle(previous)
    openForViewing(id)
  }, [closeIfIdle, openForViewing])

  const rename = useCallback((id: string, title: string) => {
    const clean = title.trim()
    patch(id, c => clean === ''
      // 清空 = 恢复自动标题：下一句话重新起名。
      ? { ...c, title: '新对话', titleEdited: false }
      : { ...c, title: clean.slice(0, 40), titleEdited: true })
  }, [patch])

  const remove = useCallback((id: string) => {
    live.current.get(id)?.close()
    live.current.delete(id)
    creating.current.delete(id)
    toolRows.current.delete(id)
    probed.current.delete(id)
    lost.current.delete(id)
    busyRef.current.delete(id)
    setBusyIds([...busyRef.current])
    setLostIds([...lost.current])
    const next = conversationsRef.current.filter(c => c.id !== id)
    commit(next)
    setPendings((prev) => {
      if (!(id in prev)) return prev
      const rest = { ...prev }
      delete rest[id]
      return rest
    })
    if (activeIdRef.current === id) {
      activeIdRef.current = next[0]?.id
      setSelectedId(next[0]?.id)
    }
  }, [commit])

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
      setModel(health.model)
      setStatus('ready')
    })()
    return () => {
      cancelled = true
      shutdown()
    }
  }, [])

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

  // 存回本地。不防抖：一轮对话只产生几条内容，而防抖会在关标签页时丢掉最后一段。
  useEffect(() => {
    saveConversations(conversations)
  }, [conversations])

  const active = useMemo(
    () => conversations.find(c => c.id === activeId),
    [activeId, conversations],
  )

  return {
    status,
    model,
    conversations,
    activeId,
    active,
    busyIds,
    lostIds,
    pending: activeId === undefined ? undefined : pendings[activeId],
    contextLost: activeId !== undefined && lostIds.includes(activeId),
    send,
    answer,
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
