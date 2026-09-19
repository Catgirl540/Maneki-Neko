import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '@/api'
import type { SupportMessage } from '@/api/types'
import { ConsentCard } from '@/components/agent/ConsentCard'
// 懒加载：Markdown + KaTeX 加起来约 430KB，只有这一页用得上，
// 不该让全部页面（登录、总览、转账…）一起背。首次出现助手回复时才去取。
const Markdown = lazy(() => import('@/components/agent/Markdown').then(m => ({ default: m.Markdown })))
import { SessionList } from '@/components/agent/SessionList'
import { CatMark } from '@/components/brand/Logo'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Modal } from '@/components/ui/Modal'
import { Tag } from '@/components/ui/Segmented'
import {
  AlertIcon,
  ArrowRightIcon,
  CheckIcon,
  HistoryIcon,
  RefreshIcon,
  SendIcon,
  SparkleIcon,
  UserIcon,
} from '@/components/ui/icons'
import { cn } from '@/lib/cn'
import { STORAGE_KEYS, storage } from '@/lib/storage'
import type { StoredConversation } from '@/lib/agentSessions'
import { toolLabel, useAgentChat, type ChatItem } from '@/lib/useAgentChat'

/**
 * 快捷问题。
 *
 * 刻意**不放**"帮我转 800 元给某人"这类**操作**入口：那是一键发起一笔资金操作，
 * 客户可能没看清收款人就点下去。要转账就自己把话说清楚——确认卡片是防误操作的
 * 第二道闸，不该让第一道闸（"要不要发起"）变成一个手滑就能碰到的按钮。
 * 「转账手续费怎么收？」是**咨询**不是操作，保留。
 */
const QUICK_ASKS = [
  '我的账户余额还有多少？',
  '最近有哪些支出？',
  '转账手续费怎么收？',
  '有哪些理财产品？',
  '卡丢了怎么办？',
]

export function SupportPage() {
  const agent = useAgentChat()
  const [messages, setMessages] = useState<SupportMessage[]>(() =>
    storage.get<SupportMessage[]>(STORAGE_KEYS.supportHistory, []),
  )
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(() =>
    storage.get<boolean>(STORAGE_KEYS.agentHistoryOpen, false),
  )
  const [renameTarget, setRenameTarget] = useState<StoredConversation | undefined>(undefined)
  const [renameValue, setRenameValue] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<StoredConversation | undefined>(undefined)
  const scroller = useRef<HTMLDivElement | null>(null)

  const usingAgent = agent.status === 'ready'
  const probing = agent.status === 'probing'
  /** 当前对话的内容（没打开任何一段时是空的）。单独取出来当依赖：`?? []` 每次渲染都是新数组。 */
  const items = agent.active?.items
  const itemCount = items?.length ?? 0
  const activeBusy = agent.activeId !== undefined && agent.busyIds.includes(agent.activeId)

  useEffect(() => {
    storage.set(STORAGE_KEYS.agentHistoryOpen, historyOpen)
  }, [historyOpen])

  // 列表里的"3 分钟前"要自己走，否则抽屉一直开着的时候时间停在打开那一刻。
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!historyOpen) return
    const timer = setInterval(() => { setNow(Date.now()) }, 60_000)
    return () => { clearInterval(timer) }
  }, [historyOpen])

  // 仅当本地没有历史时才拉一次，避免在 effect 里同步 setState
  useEffect(() => {
    if (messages.length > 0) return
    let cancelled = false
    void api.listSupportMessages().then((history) => {
      if (!cancelled) setMessages(history)
    })
    return () => {
      cancelled = true
    }
  }, [messages.length])

  useEffect(() => {
    if (messages.length) storage.set(STORAGE_KEYS.supportHistory, messages)
  }, [messages])

  // 有 agent 时，滚动跟随 agent 的内容；没有时跟随固定话术。
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })
  }, [messages, thinking, items, agent.pending, agent.activeId])

  // 确认卡片出现时把它滚进视野：卡片是"必须看一眼才能决定"的东西，
  // 半截露在滚动区外面等于没展示交易信息。
  const consentRef = useRef<HTMLDivElement | null>(null)
  const pendingChallengeId = agent.pending?.challenge.challengeId
  useEffect(() => {
    if (pendingChallengeId === undefined) return
    consentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [pendingChallengeId])

  /** 固定话术那条路（agent 不在时的回落）。 */
  async function sendCanned(text: string) {
    const value = text.trim()
    if (!value || thinking) return
    setMessages((prev) => [...prev, {
      id: `local_${Date.now()}`,
      role: 'user',
      text: value,
      createdAt: new Date().toISOString(),
    }])
    setInput('')
    setThinking(true)
    try {
      const { message } = await api.sendSupportMessage(value)
      setMessages((prev) => [...prev, message])
    } finally {
      setThinking(false)
    }
  }

  function send(text: string) {
    const value = text.trim()
    if (value === '') return
    if (usingAgent) {
      agent.send(value)
      setInput('')
      return
    }
    void sendCanned(value)
  }

  function openRename(conversation: StoredConversation) {
    setRenameTarget(conversation)
    setRenameValue(conversation.title)
  }

  function confirmRename() {
    if (renameTarget === undefined) return
    agent.rename(renameTarget.id, renameValue)
    setRenameTarget(undefined)
  }

  return (
    <div className="flex flex-col gap-7">
      <header className="float-up flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[30px] leading-tight font-bold tracking-[-0.02em] text-ink">
            智能客服
          </h1>
          <p className="mt-2 text-[14px] text-ink-mute">
            查余额、看流水、转账、看理财，都可以直接对话办理
          </p>
        </div>
        <ModeTag status={agent.status} model={agent.model} />
      </header>

      {/* 对话。高度跟着视口走：右侧两栏撤掉之后，聊天区可以占满一屏，
          确认卡片不用滚动就能看全（有 min-height 兜住小窗口）。 */}
      <Card padded={false} className="float-up flex h-[calc(100vh-240px)] min-h-[560px] overflow-hidden">
        {/* 历史对话是抽屉，不是常驻侧栏：默认收着，聊天窗独占整宽。 */}
        {usingAgent && historyOpen && (
          <aside aria-label="历史对话" className="hidden w-[236px] shrink-0 border-r border-line sm:block">
            <SessionList
              conversations={agent.conversations}
              activeId={agent.activeId}
              busyIds={agent.busyIds}
              lostIds={agent.lostIds}
              now={now}
              onSelect={agent.select}
              onCreate={agent.create}
              onRename={openRename}
              onDelete={setDeleteTarget}
            />
          </aside>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-3 border-b border-line px-6 py-5">
            <span className="grid size-10 place-items-center rounded-chip bg-gold-wash">
              <CatMark className="size-6 text-gold-deep" cutout="var(--color-gold-wash)" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[15px] font-medium text-ink">
                {usingAgent && agent.active !== undefined ? agent.active.title : '招财猫智能助手'}
              </span>
              <span className="block text-[13px] text-ink-mute">
                {usingAgent ? '真模型驱动 · 敏感操作需你确认' : '演示话术 · agent 未连接'}
              </span>
            </span>
            {usingAgent && (
              <span className="ml-auto flex shrink-0 items-center gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  className={cn(historyOpen && 'bg-sunk text-ink')}
                  icon={<HistoryIcon size={15} />}
                  onClick={() => {
                    // 顺手把时间刷新一下：抽屉关了十分钟再打开，
                    // "刚刚"就不该还写"刚刚"。
                    setNow(Date.now())
                    setHistoryOpen(open => !open)
                  }}
                >
                  历史对话
                  <span className="ml-1 text-ink-mute">{agent.conversations.length}</span>
                </Button>
                <Button size="sm" variant="ghost" icon={<RefreshIcon size={15} />} onClick={agent.create}>
                  新对话
                </Button>
              </span>
            )}
          </div>

          <div ref={scroller} className="flex-1 space-y-5 overflow-y-auto px-6 py-6">
            {/* 上下文没了这件事必须在**发言之前**就写在脸上。
                否则用户看到的是一段完整的记录配一个答非所问的助手。 */}
            {usingAgent && agent.contextLost && (
              <div className="flex items-start gap-3 rounded-card bg-coral-wash px-4 py-3 text-[13px] leading-relaxed text-ink">
                <AlertIcon size={16} className="mt-0.5 shrink-0 text-coral" />
                <span>
                  agent 服务重启过，助手已经不记得这段对话了。上面的记录还在，
                  但你继续说话会从一段新的对话开始。
                </span>
              </div>
            )}

            {usingAgent
              ? (items ?? []).map((item) => <AgentBubble key={item.id} item={item} />)
              : messages.map((msg) => <MessageBubble key={msg.id} message={msg} />)}

            {/* 待确认的敏感操作：工具此刻**还没有执行** */}
            {agent.pending !== undefined && (
              <div ref={consentRef}>
                <ConsentCard
                  pending={agent.pending}
                  onApprove={(password) => { agent.answer('approve', password) }}
                  onReject={() => { agent.answer('reject') }}
                />
              </div>
            )}

            {(usingAgent ? activeBusy : thinking) && agent.pending === undefined && (
              <div className="flex items-center gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-chip bg-gold-wash">
                  <CatMark className="size-5 text-gold-deep" cutout="var(--color-gold-wash)" />
                </span>
                <span className="flex gap-1.5 rounded-card bg-sunk px-4 py-3">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="size-1.5 animate-bounce rounded-chip bg-ink-mute"
                      style={{ animationDelay: `${i * 120}ms` }}
                    />
                  ))}
                </span>
              </div>
            )}

            {usingAgent && itemCount === 0 && agent.pending === undefined && (
              <p className="rounded-card bg-sunk px-4 py-3 text-[13px] text-ink-soft">
                试试下面的问题。涉及转账、理财申购、查看卡号密码这类操作时，
                我会先把交易信息列出来，等你确认并验证支付密码之后才执行。
              </p>
            )}
          </div>

          <div className="border-t border-line px-6 py-4">
            <div className="mb-3 flex flex-wrap gap-2">
              {QUICK_ASKS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => send(q)}
                  className="h-8 rounded-chip border border-line px-3 text-[12px] text-ink-soft transition-colors hover:border-gold hover:text-gold-deep"
                >
                  {q}
                </button>
              ))}
            </div>
            <form
              className="flex items-center gap-3"
              onSubmit={(e) => {
                e.preventDefault()
                send(input)
              }}
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={probing ? '正在连接 agent…' : '描述你的需求，例如：帮我转 800 元给梁乐怡'}
                disabled={probing}
                className="h-12 flex-1 rounded-chip border border-line bg-surface px-4 text-[14px] text-ink outline-none transition-colors placeholder:text-ink-mute focus:border-gold disabled:bg-sunk"
              />
              <button
                type="submit"
                aria-label="发送"
                disabled={(usingAgent ? activeBusy : thinking) || !input.trim() || probing}
                className="grid size-12 shrink-0 place-items-center rounded-chip bg-gold text-ink transition-colors hover:bg-gold-deep hover:text-ink-invert disabled:cursor-not-allowed disabled:bg-gold/40"
              >
                <SendIcon size={20} />
              </button>
            </form>
          </div>
        </div>
      </Card>

      <Modal
        open={renameTarget !== undefined}
        onClose={() => { setRenameTarget(undefined) }}
        title="重命名对话"
        description="留空就恢复成按第一句话自动起名。"
        footer={
          <>
            <Button block onClick={confirmRename}>保存</Button>
            <Button variant="ghost" block onClick={() => { setRenameTarget(undefined) }}>取消</Button>
          </>
        }
      >
        <input
          value={renameValue}
          onChange={(e) => { setRenameValue(e.target.value) }}
          onKeyDown={(e) => { if (e.key === 'Enter') confirmRename() }}
          maxLength={40}
          autoFocus
          aria-label="对话标题"
          className="h-12 w-full rounded-chip border border-line bg-surface px-4 text-[14px] text-ink outline-none transition-colors focus:border-gold"
        />
      </Modal>

      <Modal
        open={deleteTarget !== undefined}
        onClose={() => { setDeleteTarget(undefined) }}
        title="删除这段对话？"
        description="只从这台设备上移除。服务端与审计日志里的记录会保留，删不掉也改不了。"
        footer={
          <>
            <Button
              variant="danger"
              block
              onClick={() => {
                if (deleteTarget !== undefined) agent.remove(deleteTarget.id)
                setDeleteTarget(undefined)
              }}
            >
              删除
            </Button>
            <Button variant="ghost" block onClick={() => { setDeleteTarget(undefined) }}>取消</Button>
          </>
        }
      />
    </div>
  )
}

/** 顶部的通道状态标签：让用户一眼看出现在是真 agent 还是固定话术。 */
function ModeTag({ status, model }: { status: 'probing' | 'off' | 'ready'; model?: string }) {
  if (status === 'probing') {
    return (
      <Tag tone="neutral" className="h-8 px-3">
        正在连接 agent…
      </Tag>
    )
  }
  if (status === 'ready') {
    return (
      <Tag tone="blue" className="h-8 px-3">
        <CheckIcon size={14} className="mr-1.5" />
        Agent 已连接{model !== undefined ? ` · ${model}` : ''}
      </Tag>
    )
  }
  return (
    <Tag tone="gold" className="h-8 px-3">
      <SparkleIcon size={14} className="mr-1.5" />
      演示话术（未连接 agent）
    </Tag>
  )
}

/** agent 对话里的一条内容。 */
function AgentBubble({ item }: { item: ChatItem }) {
  if (item.kind === 'notice') {
    return (
      <div className="flex items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-chip bg-coral-wash">
          <AlertIcon size={16} className="text-coral" />
        </span>
        <div className="max-w-[80%] rounded-card bg-coral-wash px-4 py-3 text-[13px] leading-relaxed text-ink">
          {item.text}
        </div>
      </div>
    )
  }

  if (item.kind === 'tool') {
    return (
      <div className="flex items-center gap-2 pl-11">
        <span
          className={cn(
            'inline-flex items-center gap-2 rounded-chip border px-3 py-1.5 text-[12px]',
            item.state === 'running' && 'border-line bg-sunk text-ink-soft',
            item.state === 'done' && 'border-blue-wash bg-blue-wash text-blue',
            item.state === 'error' && 'border-coral-wash bg-coral-wash text-coral',
          )}
        >
          {toolLabel(item.name)}
          <span className="text-ink-mute">
            {item.state === 'running' ? '执行中…' : item.state === 'done' ? '已完成' : '未执行'}
          </span>
        </span>
        {item.text !== undefined && item.text !== '' && (
          <span className="truncate text-[12px] text-ink-mute">{item.text}</span>
        )}
      </div>
    )
  }

  const isUser = item.kind === 'user'
  return (
    <div className={cn('flex items-start gap-3', isUser && 'flex-row-reverse')}>
      <span
        className={cn(
          'grid size-8 shrink-0 place-items-center rounded-chip',
          isUser ? 'bg-ink text-ink-invert' : 'bg-gold-wash',
        )}
      >
        {isUser ? (
          <UserIcon size={17} />
        ) : (
          <CatMark className="size-5 text-gold-deep" cutout="var(--color-gold-wash)" />
        )}
      </span>
      <div
        className={cn(
          'max-w-[85%] rounded-card px-4 py-3',
          isUser ? 'text-[14px] leading-relaxed whitespace-pre-wrap bg-ink text-ink-invert' : 'bg-sunk text-ink',
        )}
      >
        {/* 助手回复可能带 Markdown 表格与公式；用户自己说的话按纯文本显示，
            免得他打的 `#` 或 `*` 被当成格式。
            懒加载期间的兜底就是纯文本——和没有这个功能时的显示一致，不会闪空白。 */}
        {isUser
          ? item.text
          : (
            <Suspense fallback={<span className="whitespace-pre-wrap">{item.text}</span>}>
              <Markdown text={item.text} />
            </Suspense>
          )}
      </div>
    </div>
  )
}

function MessageBubble({ message }: { message: SupportMessage }) {
  const isUser = message.role === 'user'
  return (
    <div className={cn('flex items-start gap-3', isUser && 'flex-row-reverse')}>
      <span
        className={cn(
          'grid size-8 shrink-0 place-items-center rounded-chip',
          isUser ? 'bg-ink text-ink-invert' : 'bg-gold-wash',
        )}
      >
        {isUser ? (
          <UserIcon size={17} />
        ) : (
          <CatMark className="size-5 text-gold-deep" cutout="var(--color-gold-wash)" />
        )}
      </span>

      <div className={cn('max-w-[80%]', isUser && 'flex flex-col items-end')}>
        <div
          className={cn(
            'rounded-card px-4 py-3 text-[14px] leading-relaxed',
            isUser ? 'bg-ink text-ink-invert' : 'bg-sunk text-ink',
          )}
        >
          {message.text}
        </div>

        {message.actions && message.actions.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-2">
            {message.actions.map((action) => (
              <Link key={action.to} to={action.to}>
                <Button size="sm" icon={<ArrowRightIcon size={15} />}>
                  {action.label}
                </Button>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
