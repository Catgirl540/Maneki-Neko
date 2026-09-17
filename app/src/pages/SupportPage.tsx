import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '@/api'
import type { SupportMessage } from '@/api/types'
import { CatMark } from '@/components/brand/Logo'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { Tag } from '@/components/ui/Segmented'
import { ArrowRightIcon, SendIcon, SparkleIcon, UserIcon } from '@/components/ui/icons'
import { cn } from '@/lib/cn'
import { STORAGE_KEYS, storage } from '@/lib/storage'

const QUICK_ASKS = [
  '怎么转账？',
  '本月花了多少？',
  '卡丢了怎么办？',
  '密码怎么重置？',
  '自动扣款在哪里管理？',
]

/** 图片里 AI Agent 分支的 MVP 占位说明 */
const CAPABILITIES = [
  { title: '智能客服', description: '当前版本：固定话术问答', ready: true },
  { title: 'AI 辅助操作', description: '规划中：替用户预填转账表单', ready: false },
  { title: 'Agent 自主操作', description: '规划中：授权后自动执行定期任务', ready: false },
  { title: '手动接管 / 转人工', description: '规划中：一键转人工客服', ready: false },
]

export function SupportPage() {
  const [messages, setMessages] = useState<SupportMessage[]>(() =>
    storage.get<SupportMessage[]>(STORAGE_KEYS.supportHistory, []),
  )
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  const scroller = useRef<HTMLDivElement | null>(null)

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

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })
  }, [messages, thinking])

  async function send(text: string) {
    const value = text.trim()
    if (!value || thinking) return
    const userMessage: SupportMessage = {
      id: `local_${Date.now()}`,
      role: 'user',
      text: value,
      createdAt: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setThinking(true)
    try {
      const { message } = await api.sendSupportMessage(value)
      setMessages((prev) => [...prev, message])
    } finally {
      setThinking(false)
    }
  }

  return (
    <div className="flex flex-col gap-7">
      <header className="float-up flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[30px] leading-tight font-bold tracking-[-0.02em] text-ink">
            智能客服
          </h1>
          <p className="mt-2 text-[14px] text-ink-mute">
            AI Agent 入口的 MVP 版本：先用固定话术跑通交互，后续接入大模型
          </p>
        </div>
        <Tag tone="gold" className="h-8 px-3">
          <SparkleIcon size={14} className="mr-1.5" />
          演示话术
        </Tag>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        {/* 对话 */}
        <Card padded={false} className="float-up flex h-[620px] flex-col overflow-hidden">
          <div className="flex items-center gap-3 border-b border-line px-6 py-5">
            <span className="grid size-10 place-items-center rounded-chip bg-gold-wash">
              <CatMark className="size-6 text-gold-deep" cutout="var(--color-gold-wash)" />
            </span>
            <span>
              <span className="block text-[15px] font-medium text-ink">招财猫智能客服</span>
              <span className="block text-[13px] text-ink-mute">通常即时回复 · 服务时间 09:00–21:00</span>
            </span>
            <Button
              size="sm"
              className="ml-auto"
              onClick={() =>
                void send('我要转人工客服')
              }
            >
              转人工
            </Button>
          </div>

          <div ref={scroller} className="flex-1 space-y-5 overflow-y-auto px-6 py-6">
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}

            {thinking && (
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
          </div>

          <div className="border-t border-line px-6 py-4">
            <div className="mb-3 flex flex-wrap gap-2">
              {QUICK_ASKS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => void send(q)}
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
                void send(input)
              }}
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="描述你的问题，例如：怎么给境外账户转账"
                className="h-12 flex-1 rounded-chip border border-line bg-surface px-4 text-[14px] text-ink outline-none transition-colors placeholder:text-ink-mute focus:border-gold"
              />
              <button
                type="submit"
                aria-label="发送"
                disabled={thinking || !input.trim()}
                className="grid size-12 shrink-0 place-items-center rounded-chip bg-gold text-ink transition-colors hover:bg-gold-deep hover:text-ink-invert disabled:cursor-not-allowed disabled:bg-gold/40"
              >
                <SendIcon size={20} />
              </button>
            </form>
          </div>
        </Card>

        {/* 能力说明 */}
        <div className="flex flex-col gap-6">
          <Card className="float-up" style={{ animationDelay: '60ms' }}>
            <CardHeader title="Agent 能力" />
            <ul className="mt-4 divide-y divide-line">
              {CAPABILITIES.map((item) => (
                <li key={item.title} className="flex items-start gap-4 py-4">
                  <span
                    className={cn(
                      'mt-0.5 grid size-9 shrink-0 place-items-center rounded-tile',
                      item.ready ? 'bg-gold-tint text-gold-deep' : 'bg-sunk text-ink-mute',
                    )}
                  >
                    <SparkleIcon size={18} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-medium text-ink">{item.title}</span>
                    <span className="mt-0.5 block text-[13px] text-ink-mute">
                      {item.description}
                    </span>
                  </span>
                  {item.ready && <Tag tone="blue">已上线</Tag>}
                </li>
              ))}
            </ul>
          </Card>

          <Card className="float-up" style={{ animationDelay: '120ms' }}>
            <CardHeader title="安全与合规" />
            <ul className="mt-4 flex flex-col gap-3 text-[13px] text-ink-soft">
              <li>· 客服不会索取密码、验证码与完整卡号</li>
              <li>· 涉及资金的操作一律需要你在页面上手动确认</li>
              <li>· 高风险操作会触发二次确认与审计日志</li>
              <li>· 可随时切换到手动模式自行操作</li>
            </ul>
            <div className="mt-5 flex gap-3">
              <Link to="/transfer" className="flex-1">
                <Button block size="sm">
                  自行转账
                </Button>
              </Link>
              <Link to="/security" className="flex-1">
                <Button block size="sm">
                  安全中心
                </Button>
              </Link>
            </div>
          </Card>
        </div>
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