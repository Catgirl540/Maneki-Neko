import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '@/api'
import type { SupportMessage } from '@/api/types'
import { ConsentCard } from '@/components/agent/ConsentCard'
import { CatMark } from '@/components/brand/Logo'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Tag } from '@/components/ui/Segmented'
import { AlertIcon, ArrowRightIcon, CheckIcon, RefreshIcon, SendIcon, SparkleIcon, UserIcon } from '@/components/ui/icons'
import { cn } from '@/lib/cn'
import { STORAGE_KEYS, storage } from '@/lib/storage'
import { toolLabel, useAgentChat, type ChatItem } from '@/lib/useAgentChat'

const QUICK_ASKS = [
  '我的账户余额还有多少？',
  '帮我转 800 元给梁乐怡，账号尾号 9123，备注房租',
  '最近有哪些支出？',
  '转账手续费怎么收？',
  '卡丢了怎么办？',
]

export function SupportPage() {
  const agent = useAgentChat()
  const [messages, setMessages] = useState<SupportMessage[]>(() =>
    storage.get<SupportMessage[]>(STORAGE_KEYS.supportHistory, []),
  )
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  const scroller = useRef<HTMLDivElement | null>(null)

  const usingAgent = agent.status === 'ready'
  const probing = agent.status === 'probing'

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
  }, [messages, thinking, agent.items, agent.pending])

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

      {/* 对话 */}
            {/* 高度跟着视口走：右侧两栏撤掉之后，聊天区可以占满一屏，
          确认卡片不用滚动就能看全（有 min-height 兜住小窗口）。 */}
      <Card padded={false} className="float-up flex h-[calc(100vh-240px)] min-h-[560px] flex-col overflow-hidden">
        <div className="flex items-center gap-3 border-b border-line px-6 py-5">
          <span className="grid size-10 place-items-center rounded-chip bg-gold-wash">
            <CatMark className="size-6 text-gold-deep" cutout="var(--color-gold-wash)" />
          </span>
          <span>
            <span className="block text-[15px] font-medium text-ink">招财猫智能助手</span>
            <span className="block text-[13px] text-ink-mute">
              {usingAgent ? '真模型驱动 · 敏感操作需你确认' : '演示话术 · agent 未连接'}
            </span>
          </span>
          {usingAgent && (
            <Button size="sm" variant="ghost" className="ml-auto" icon={<RefreshIcon size={15} />} onClick={agent.reset}>
              新对话
            </Button>
          )}
        </div>

        <div ref={scroller} className="flex-1 space-y-5 overflow-y-auto px-6 py-6">
          {usingAgent
            ? agent.items.map((item) => <AgentBubble key={item.id} item={item} />)
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

          {(usingAgent ? agent.busy : thinking) && agent.pending === undefined && (
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

          {usingAgent && agent.items.length === 0 && agent.pending === undefined && (
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
              disabled={(usingAgent ? agent.busy : thinking) || !input.trim() || probing}
              className="grid size-12 shrink-0 place-items-center rounded-chip bg-gold text-ink transition-colors hover:bg-gold-deep hover:text-ink-invert disabled:cursor-not-allowed disabled:bg-gold/40"
            >
              <SendIcon size={20} />
            </button>
          </form>
        </div>
      </Card>
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
      <div className={cn('max-w-[80%] rounded-card px-4 py-3 text-[14px] leading-relaxed whitespace-pre-wrap', isUser ? 'bg-ink text-ink-invert' : 'bg-sunk text-ink')}>
        {item.text}
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
