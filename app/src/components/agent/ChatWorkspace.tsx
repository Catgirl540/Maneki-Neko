import { lazy, Suspense, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import './assistant-turn.css'
import type { SupportMessage } from '../../api/types'
import type { CustomerVerification } from '../../api/agent'
import type { AgentChatOptions, PendingConsent } from '../../lib/useAgentChat'
import { AgentCardSecret } from './AgentCardSecret'
import { ConsentCard } from './ConsentCard'
import { EditMessageModal, MessageActions } from './MessageActions'
import { QuestionCard } from './QuestionCard'
import { SpeechPlayer } from './SpeechPlayer'
// 懒加载：Markdown + KaTeX 加起来约 430KB，只有这一页用得上，
// 不该让全部页面（登录、总览、转账…）一起背。首次出现助手回复时才去取。
const Markdown = lazy(() => import('./Markdown').then(m => ({ default: m.Markdown })))
import { SessionList } from './SessionList'
import { CatMark } from '../brand/Logo'
import { SupportCat } from '../brand/WorkbenchBrand'
import workingCatVideo from '../../assets/design/support-cat-working.mp4'
import workingCatPoster from '../../assets/design/support-cat-working-poster.webp'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { Modal } from '../ui/Modal'
import { Tag } from '../ui/Segmented'
import {
  CheckIcon,
  ChevronDownIcon,
  CloseIcon,
  HistoryIcon,
  ImagePlusIcon,
  MicIcon,
  RefreshIcon,
  SendIcon,
  SparkleIcon,
  StopIcon,
  UserIcon,
  WaveIcon,
} from '../ui/icons'
import { cn } from '../../lib/cn'
import { useMediaQuery } from '../../lib/useMediaQuery'
import { ASSISTANT } from '../../lib/assistant'
import { preview, voiceLog } from '../../lib/voiceLog'
import { ACCEPTED_MIME_TYPES, prepareImage, type PreparedImage } from '../../lib/image'
import { STORAGE_KEYS, storage } from '../../lib/storage'
import { lastAssistantId, type MessageItem, type StoredConversation } from '../../lib/agentSessions'
import { groupChatMessages, turnContent, type AssistantTurn } from '../../lib/agentTurns'
import { speechText } from '../../lib/speech'
import { toolLabel, useAgentChat, type ChatItem } from '../../lib/useAgentChat'
import { useVoice, type VoicePlayback } from '../../lib/useVoice'

export interface WorkbenchOptions {
  docked: boolean
  tasks: readonly { id: string; label: string }[]
  highlightTaskId?: string
  focusRequest: number
  onActivate: () => void
  onClearTask: (id: string) => void
  /** 新建对话时回调：能力选择按会话隔离，由外层清空已选智能服务。 */
  onNewConversation?: () => void
}

export interface ChatWorkspaceProps extends AgentChatOptions {
  /** 仅网页客户端启用，员工端继续使用原来的共享工作区。 */
  workbench?: WorkbenchOptions
  audience?: 'customer' | 'staff'
  humanSupport?: { request: (items: ChatItem[]) => void; view: () => void }
  /** 会员专属服务标识（专属客户经理 / 理财顾问），由入口按 entitlements 传入 */
  memberBadges?: string[]
  placeholder?: string
  /** 单独读取银行人工留言，不启用固定话术发送兜底。 */
  listMessages?: () => Promise<SupportMessage[]>
  fallback?: {
    list: () => Promise<SupportMessage[]>
    send: (text: string) => Promise<{ message: SupportMessage }>
  }
  renderConsent?: (pending: PendingConsent, approve: (verification?: CustomerVerification) => void, reject: () => void) => ReactNode
}

/** 两端共用消息、图片、录音、朗读、历史及流式输出；业务确认由入口提供。 */
export function ChatWorkspace(props: ChatWorkspaceProps) {
  const { audience = 'customer', fallback, renderConsent, workbench } = props
  const docked = workbench?.docked ?? false
  const loadMessages = props.listMessages ?? fallback?.list
  const historyOpenKey = props.historyOwnerId ? `${STORAGE_KEYS.agentHistoryOpen}.${props.historyOwnerId}` : STORAGE_KEYS.agentHistoryOpen
  const compact = useMediaQuery('(max-width: 959px)')
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const agent = useAgentChat(props)
  const [messages, setMessages] = useState<SupportMessage[]>([])
  const [supportError, setSupportError] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  useEffect(() => {
    if (workbench?.focusRequest) inputRef.current?.focus()
  }, [workbench?.focusRequest])
  const [thinking, setThinking] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(() =>
    storage.get<boolean>(historyOpenKey, false),
  )
  const [renameTarget, setRenameTarget] = useState<StoredConversation | undefined>(undefined)
  const [renameValue, setRenameValue] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<StoredConversation | undefined>(undefined)
  /** 正在编辑的那条用户消息，以及编辑框里的草稿。 */
  const [editTarget, setEditTarget] = useState<ChatItem | undefined>(undefined)
  const [editValue, setEditValue] = useState('')
  /* 待发送的图片（已经压过的那份）与它的处理状态。 */
  const [pendingImage, setPendingImage] = useState<PreparedImage | undefined>(undefined)
  const [imageBusy, setImageBusy] = useState(false)
  const [imageError, setImageError] = useState<string | undefined>(undefined)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const scroller = useRef<HTMLDivElement | null>(null)

  /**
   * 语音模式。开着的时候助手回复会被念出来，并且显示"按住说话"的按钮。
   *
   * 它是**每一轮**的交互，不是全双工：按住说一句、松开、等回答、听。
   * 理由写在 `lib/useVoice.ts` 顶上——最要紧的一条是银行场景下"想清楚再按"
   * 比"抢话"更合适。
   */
  const [voiceMode, setVoiceMode] = useState(false)
  const voice = useVoice(voiceMode, (text) => { send(text) }, agent.voice?.maxSeconds, props.client)
  const voiceUsable = voiceMode && voice.available

  const usingAgent = agent.status === 'ready'
  const probing = agent.status === 'probing'
  /** 当前对话的内容（没打开任何一段时是空的）。单独取出来当依赖：`?? []` 每次渲染都是新数组。 */
  const items = agent.active?.items
  const activeBusy = agent.activeId !== undefined && agent.busyIds.includes(agent.activeId)
  const chatMessages = groupChatMessages(items ?? [])
  const latestTurn = chatMessages.at(-1)
  const latestReply = latestTurn?.kind === 'turn' ? turnContent(latestTurn).reply : undefined
  const latestAssistantTurn = latestTurn?.kind === 'turn' ? turnContent(latestTurn) : undefined
  const runningWorkTool = latestTurn?.kind === 'turn'
    ? latestTurn.items.findLast(item => item.kind === 'tool' && item.state === 'running')
    : undefined
  const retryProgress = latestAssistantTurn?.notices.find(item => item.id === 'model_retry_progress')
  const workbenchActivity = !activeBusy ? undefined
    : retryProgress ? retryProgress.text
      : runningWorkTool?.kind === 'tool' ? `正在${toolLabel(runningWorkTool.name)}`
        : latestReply?.streaming || latestAssistantTurn?.lastTool?.state === 'done' ? '正在整理回复'
          : '正在处理'

  // 员工主动留言（listSupportMessages 已按登录人过滤后并进 messages）。
  // 拆出来单列渲染：usingAgent 时下面走的是 items 分支，混在 messages 里会被顶掉。
  const staffNotices = messages.filter((m) => m.role === 'staff')
  const botMessages = messages.filter((m) => m.role !== 'staff')
  const showWorkbenchPresence = Boolean(workbench && audience === 'customer')
  const emptyWorkbench = Boolean(workbench && !staffNotices.length && !(usingAgent ? items?.length : messages.length)
    && !activeBusy && !thinking && !agent.pending && !agent.ask)

  // 语音模式下，agent 一开口说话就退出"等回答"状态（转圈该停了）。
  useEffect(() => {
    if (voice.state === 'thinking' && !activeBusy) voice.thinking()
  }, [activeBusy, voice])

  /**
   * 语音模式下把**新出现的**助手回复念出来。
   *
   * 记 id 而不是记文本：重新渲染会拿到同一个数组，靠 id 才知道哪条是新的。
   * 只念最后一条——一轮回答里助手可能先说一句再调工具再说一句，
   * 全念会把同一件事念两遍。
   *
   * 念的时候把 id 一起交给 `speak`：这样那条消息上的按钮会变成"停止"，
   * 而不是十条消息同时显示"朗读"、只有一条在响。
   */
  const spokenRef = useRef<string | undefined>(undefined)
  const latestAssistant = latestReply?.id
  const latestAssistantText = !activeBusy && !agent.pending && !agent.ask && !latestReply?.streaming
    ? latestReply?.text : undefined
  useEffect(() => {
    if (!voiceUsable || latestAssistant === undefined || latestAssistantText === undefined) return
    if (spokenRef.current === latestAssistant) return
    spokenRef.current = latestAssistant
    /*
     * 自动播报是 `stopSpeaking` 最常见的一个调用方（"下一条一来就把上一条掐掉"），
     * 所以这里要留痕：闪一下到底是它干的，还是用户点的停止，看日志就分得清。
     */
    voiceLog('自动播报：念最新一条', { id: latestAssistant, 文本: preview(speechText(latestAssistantText)) })
    // 念之前先把 Markdown 去掉：`**` 和 `|---|` 念出来是纯噪音。
    voice.speak(speechText(latestAssistantText), latestAssistant)
  }, [latestAssistant, latestAssistantText, voice, voiceUsable])

  /**
   * 出现待确认事项时**念一句提醒**，但绝不代答。
   *
   * 语音只能用来发起，不能用来确认：电视里的声音、放一段录音，都能骗过
   * "用语音说同意"。所以这里只提醒"去屏幕上核对并输密码"，答复仍然只能手点。
   * （`pendingChallengeId` 在下面确认卡片那段里声明，这里只留 ref。）
   */
  const announcedRef = useRef<string | undefined>(undefined)

  // 关掉语音模式时把"念到哪了"清掉：下次打开时当前这一条要能重新念。
  useEffect(() => {
    if (!voiceMode) spokenRef.current = undefined
  }, [voiceMode])

  useEffect(() => {
    storage.set(historyOpenKey, historyOpen)
  }, [historyOpen, historyOpenKey])

  // 列表里的"3 分钟前"要自己走，否则抽屉一直开着的时候时间停在打开那一刻。
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!historyOpen) return
    const timer = setInterval(() => { setNow(Date.now()) }, 60_000)
    return () => { clearInterval(timer) }
  }, [historyOpen, historyOpenKey])

  // 客服记录从当前用户的银行服务读取，不沿用浏览器中的旧占位记录。
  useEffect(() => {
    if (!loadMessages) return
    let cancelled = false
    void loadMessages().then((history) => {
      if (!cancelled) setMessages(history)
    }).catch((error: unknown) => {
      if (!cancelled) setSupportError(error instanceof Error ? error.message : '客服记录暂时无法加载')
    })
    return () => {
      cancelled = true
    }
  }, [loadMessages])

  // 有 agent 时，滚动跟随 agent 的内容；没有时跟随固定话术。
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: activeBusy ? 'auto' : 'smooth' })
  }, [messages, thinking, items, agent.pending, agent.activeId, activeBusy, docked])

  // 确认卡片出现时把它滚进视野：卡片是"必须看一眼才能决定"的东西，
  // 半截露在滚动区外面等于没展示交易信息。
  const consentRef = useRef<HTMLDivElement | null>(null)
  const pendingChallengeId = agent.pending?.challenge.challengeId
  useEffect(() => {
    if (pendingChallengeId === undefined) return
    consentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [pendingChallengeId])

  // 语音模式下，待确认事项出现时念一句提醒（但不代答，见上面 announcedRef 的说明）。
  const pendingKind = agent.pending?.challenge.kind
  useEffect(() => {
    if (!voiceUsable || pendingChallengeId === undefined || pendingKind === undefined) return
    if (announcedRef.current === pendingChallengeId) return
    announcedRef.current = pendingChallengeId
    voice.speak(
      `需要你确认：${pendingKind}。${audience === 'staff' ? '请在屏幕上核对操作及客户核验信息。' : '请在屏幕上核对信息，并输入支付密码。'}语音不能代替这一步。`,
      // 这条提醒不挂在任何一条消息上，给它一个自己的 key 就够了：
      // 它代替不了确认卡片，所以消息上不会有"它是从哪来的"这个疑问。
      `consent:${pendingChallengeId}`,
    )
  }, [pendingChallengeId, pendingKind, voice, voiceUsable, audience])

  /* ── 每条消息上的小动作（复制 / 朗读 / 重新生成 / 编辑） ────────────────
     一次算好、整包传下去：这一段对话里每条消息拿到的都是同一套。
     倒回重发会**丢掉后面几轮**，还在回答中、或者有一张待确认的卡片没处理时
     一律冻住——前者会把正在写的那条抹掉，后者会绕过一笔还没执行的敏感操作。 */
  const frozenReason = agent.pending !== undefined
    ? '先处理上面的确认卡片'
    : agent.ask !== undefined ? '先回答上面的问题'
      : activeBusy ? '这一轮还在回答中' : undefined
  const bubbleActions: BubbleActions = {
    mascot: Boolean(workbench),
    canSpeak: voice.available,
    speakingId: voice.speakingKey,
    playback: voice.playback,
    regeneratableId: lastAssistantId(items ?? []),
    retryablePromptId: latestTurn?.kind === 'turn' ? latestTurn.promptId : undefined,
    frozen: activeBusy || agent.pending !== undefined || agent.ask !== undefined,
    ...frozenReason === undefined ? {} : { frozenReason },
    onRegenerate: (id) => { agent.rewind(id) },
    onRetry: (id) => { workbench?.onActivate(); agent.retry(id) },
    onSpeak: (item) => { voice.speak(speechText(item.text), item.id) },
    onStopSpeak: voice.stopSpeaking,
    onSeek: (ratio) => { voice.seek(ratio) },
    onEdit: (item) => { setEditTarget(item); setEditValue(item.text) },
  }

  /** 固定话术那条路（agent 不在时的回落）。 */
  async function sendCanned(text: string) {
    const value = text.trim()
    if (!value || thinking || !fallback) return
    setSupportError(null)
    setThinking(true)
    try {
      const { message } = await fallback!.send(value)
      setMessages(prev => [...prev, {
        id: `local_${Date.now()}`, role: 'user', text: value, createdAt: new Date().toISOString(),
      }, message])
      setInput('')
    } catch (error) {
      setSupportError(error instanceof Error ? error.message : '消息未发送，请稍后重试')
      setInput(value)
    } finally {
      setThinking(false)
    }
  }

  function send(text: string, image?: PreparedImage): boolean {
    const draft = text.trim()
    // 只发图不打字是允许的；两个都空才是真的没内容。
    if (draft === '' && image === undefined) return false
    if (activeBusy || thinking || probing) return false
    const value = draft
    const serviceIds = audience === 'customer' && workbench ? workbench.tasks.map(task => task.id) : undefined
    workbench?.onActivate()
    if (usingAgent) {
      agent.send(value, image, serviceIds)
      setInput('')
      return true
    }
    // 固定话术那条路只认文字：它连的不是 agent，图片无处可去。
    if (image !== undefined) {
      setImageError('智能客服未接通，图片发不出去。')
      return false
    }
    void sendCanned(value)
    return Boolean(fallback)
  }

  /**
   * 用户选了一张图：先处理（压缩 + 缩略图），成功了才放进待发区。
   *
   * 处理失败的图**不进待发区**——半成品混进去，用户会以为发出去了，
   * 而服务端那边其实什么也没收到。
   * @param file - 用户选的文件。
   */
  async function pickImage(file: File) {
    setImageBusy(true)
    setImageError(undefined)
    try {
      setPendingImage(await prepareImage(file))
    } catch (error) {
      setPendingImage(undefined)
      setImageError(error instanceof Error ? error.message : String(error))
    } finally {
      setImageBusy(false)
    }
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
    <div className={cn('flex min-h-0 min-w-0 flex-1 flex-col', workbench && 'workbench-chat', docked && 'workbench-chat-docked')}>
      {workbench && !docked && workbench.focusRequest > 0 && <span key={workbench.focusRequest} className="workbench-chat-flash" aria-hidden="true" />}
      {audience === 'customer' && <AgentCardSecret />}
      <h1 hidden={docked} className="sr-only">{audience === 'staff' ? '工作人员助手' : workbench ? '智能金融工作台' : '助手'}</h1>

      {/* 对话铺满工作区，消息区独立滚动，输入栏始终可见。 */}
      <Card padded={false} className="chat-panel relative flex min-h-0 flex-1 overflow-hidden rounded-none border-0">
        {/* 历史对话是抽屉，不是常驻侧栏：默认收着，聊天窗独占整宽。 */}
        {/* 抽屉用**宽度**动画而不是挂载/卸载：聊天区会跟着平滑重排，
            和左侧主导航收起时是同一套动作（`transition-[width]` + 同一条缓动）。

            关着的时候 `inert` + `aria-hidden` 两道一起上，缺一不可：
            `inert` 管焦点与 Tab 顺序，`aria-hidden` 让它从无障碍树里消失。
            只写 `inert` 的话，里面的按钮在**某些无障碍实现**里仍然读得到——
            Playwright 的 role 选择器就还能查到抽屉里的「新对话」，
            于是"新对话"变成两个同名按钮，实测踩到。 */}
        {usingAgent && !docked && (
          <aside
            aria-label="历史对话"
            inert={!historyOpen}
            aria-hidden={!historyOpen}
            className={cn(
              'hidden h-full shrink-0 overflow-hidden lg:block',
              'transition-[width] duration-[var(--duration-state)] ease-[var(--ease-out-soft)]',
              historyOpen ? 'w-[236px] border-r border-line' : 'w-0',
            )}
          >
            <div className="h-full w-[236px]">
              <SessionList
                conversations={agent.conversations}
                activeId={agent.activeId}
                busyIds={agent.busyIds}
                lostIds={agent.lostIds}
                now={now}
                onSelect={agent.select}
                onRename={openRename}
                onDelete={setDeleteTarget}
              />
            </div>
          </aside>
        )}

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div hidden={docked} className="chat-toolbar flex shrink-0 flex-wrap items-center gap-3 border-b border-line px-4 py-4 sm:px-6">
            {!workbench && <><span className="grid size-10 place-items-center rounded-chip bg-gold-wash">
              <CatMark className="size-6 text-gold-deep" cutout="var(--color-gold-wash)" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-medium text-ink">
                {usingAgent && agent.active !== undefined ? agent.active.title : ASSISTANT.title}
              </span>
              <span className="block text-[13px] text-ink-mute">
                {usingAgent ? '在线 · 敏感操作需你确认' : fallback ? '账户客服 · 消息服务' : '工作人员助手未连接'}
              </span>
            </span>
            </>}
            <span className="chat-connection shrink-0"><ModeTag status={agent.status} /></span>
            {audience === 'customer' && props.memberBadges?.map((badge) => (
              <Tag key={badge} tone="gold" className="h-8 px-3">{badge}</Tag>
            ))}
            {(usingAgent || props.humanSupport) && (
              <span className="flex w-full flex-wrap items-center gap-0.5 border-t [&_button]:px-2 sm:gap-1 sm:[&_button]:px-3.5 border-line pt-3 sm:w-auto sm:border-0 sm:pt-0">
                {usingAgent && <>
                {!workbench && <Button
                  size="sm"
                  variant="ghost"
                  className={cn(voiceMode && 'bg-gold-wash text-gold-deep')}
                  icon={<WaveIcon size={15} />}
                  aria-pressed={voiceMode}
                  disabled={!voice.available}
                  title={voice.available ? '语音输入' : voice.unavailableReason ?? '正在检查语音可用性'}
                  onClick={() => {
                    // 这里**只**管麦克风。朗读是每条消息自己的动作
                    // （消息上就有播放/停止），关掉"语音输入"顺手把声音掐掉，
                    // 会让"我只是不想说话"变成"我什么都听不到了"。
                    setVoiceMode(on => !on)
                  }}
                >
                  语音
                </Button>}
                {!workbench && !voice.available && voice.unavailableReason && (
                  <span role="status" className="w-full text-[12px] text-ink-mute sm:order-last">{voice.unavailableReason}</span>
                )}
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
                {/* 当前已经是一段空对话时禁用：用户的意图是"给我一张白纸"，
                    而白纸已经在这儿了，再建只会让列表里堆一串用不上的「新对话」。 */}
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<RefreshIcon size={15} />}
                  disabled={agent.activeIsEmpty}
                  title={agent.activeIsEmpty ? '当前已经是一段空对话' : undefined}
                  onClick={() => { agent.create(); workbench?.onNewConversation?.() }}
                >
                  新对话
                </Button>
                </>}
                {props.humanSupport && <>
                  <Button size="sm" variant="ghost" onClick={() => props.humanSupport?.request(items ?? messages.map(message => ({ kind: message.role === 'user' ? 'user' : 'assistant', id: message.id, text: message.text })))}>转人工</Button>
                  <Button size="sm" variant="ghost" onClick={props.humanSupport.view}>人工工单</Button>
                </>}
              </span>
            )}
          </div>

          {!usingAgent && !probing && !fallback && !workbench && <p role="alert" className="mx-4 mt-3 rounded-field bg-coral-wash p-3 text-sm text-coral">{audience === 'staff' ? '工作人员助手' : '智能助手'}暂时不可用，请检查服务后刷新重试。</p>}
          {supportError && !usingAgent && <p role="alert" className="mx-4 mt-3 rounded-field bg-coral-wash p-3 text-[13px] text-coral">{supportError}</p>}
          <div hidden={docked} className={showWorkbenchPresence
            ? cn('workbench-conversation', emptyWorkbench && 'is-empty')
            : 'contents'}>
          {showWorkbenchPresence && <>
            <div className="workbench-presence-slot" aria-hidden="true" />
            <section className="workbench-agent-presence" aria-label="智能客服状态" aria-live="polite">
              <div className="workbench-agent-presence-media">
                {workbenchActivity && !reducedMotion
                  ? <video src={workingCatVideo} poster={workingCatPoster} autoPlay loop muted playsInline preload="metadata" aria-hidden="true" />
                  : <SupportCat className="workbench-agent-presence-avatar" />}
              </div>
              {workbenchActivity && <div className="workbench-agent-presence-caption">
                <strong>{workbenchActivity}</strong>
              </div>}
            </section>
          </>}
          {workbench && <div className={cn('workbench-chat-hero', !emptyWorkbench && 'is-hidden')} aria-hidden={!emptyWorkbench}>
            <h2>今天想处理什么？</h2>
          </div>}
          <div ref={scroller} hidden={docked} className="chat-message-scroll min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6">
            {staffNotices.length > 0 && (
              <section className="rounded-card border border-gold-deep/30 bg-gold-wash/40 p-3">
                <p className="mb-2 text-[12px] font-medium text-gold-deep">人工客服留言</p>
                <div className="space-y-3">
                  {staffNotices.map((msg) => (
                    <MessageBubble key={msg.id} message={msg} />
                  ))}
                </div>
              </section>
            )}
            {/* 同一次提问的流式分段和工具过程共用一个稳定的助手根节点。 */}
            {usingAgent
              ? chatMessages.map(message => message.kind === 'user'
                ? <UserBubble key={message.id} item={message} actions={bubbleActions} />
                : <AssistantTurnBubble key={`${agent.activeId}-${message.id}`} turn={message} actions={bubbleActions}
                    busy={message === latestTurn && activeBusy}
                    waiting={message === latestTurn ? agent.pending ? '确认' : agent.ask ? '补充信息' : undefined : undefined} />)
              : botMessages.map((msg) => <MessageBubble key={msg.id} message={msg} />)}

            {/* 待确认的敏感操作：工具此刻**还没有执行** */}
            {agent.pending !== undefined && (
              <div ref={consentRef}>
                {renderConsent ? renderConsent(agent.pending,
                  verification => { agent.answer('approve', undefined, undefined, verification) },
                  () => { agent.answer('reject') },
                ) : <ConsentCard
                  pending={agent.pending}
                  onApprove={(password, acknowledgement) => { agent.answer('approve', password, acknowledgement) }}
                  onReject={() => { agent.answer('reject') }}
                />}
              </div>
            )}

            {/* 模型的问题卡片。和确认卡片**并存**：可以先问清一件事，
                问出来的答案再触发一笔需要确认的敏感操作——那是两步，不是一步。
                两张卡同时出现时，确认卡在上面：它挂着的是"还没执行的操作"，
                比"缺一句信息"更要紧。 */}
            {agent.ask !== undefined && (
              <QuestionCard
                key={`${agent.activeId}-${agent.ask.question.questionId}`}
                ask={agent.ask}
                onSubmit={(answers) => { agent.answerAsk(answers) }}
              />
            )}

            {!usingAgent && thinking && agent.pending === undefined && (
              <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-chip bg-gold-wash">
                  {workbench ? <SupportCat className="size-8 object-contain" /> : <CatMark className="size-5 text-gold-deep" cutout="var(--color-gold-wash)" />}
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

          </div>

          <div className="chat-composer shrink-0 border-t border-line px-3 py-3 sm:px-6 sm:py-4">
            {docked && (activeBusy || agent.pending || agent.ask) && <button type="button" className="workbench-chat-alert" onClick={workbench?.onActivate}>
              {agent.pending ? '有一项操作需要确认' : agent.ask ? '助手需要补充信息' : '助手正在回复'}<span>返回对话 →</span>
            </button>}
            {!!workbench?.tasks.length && <div className="workbench-intents" aria-label="已选择的功能">
              {workbench.tasks.map(task => <div key={task.id} className="workbench-intent"><span>{task.label}</span>
                {!docked && workbench.highlightTaskId === task.id && workbench.focusRequest > 0 && <span key={workbench.focusRequest} className="workbench-intent-burst" aria-hidden="true">
                  {Array.from({ length: 8 }, (_, index) => <i key={index} />)}
                </span>}
                {!docked && <button type="button" aria-label={`撤销「${task.label}」`} onClick={() => workbench.onClearTask(task.id)}><CloseIcon size={14} /></button>}
              </div>)}
            </div>}
            {/* 语音状态条：只在语音模式下出现。麦克风开着这件事必须**一直看得见**，
                不能只在按钮上变个颜色——用户切到别的标签页回来就不知道还在不在录。 */}
            {voiceUsable && (
              <div className="mb-3 flex min-h-8 flex-wrap items-center gap-3 text-[12px]">
                <span
                  className={cn(
                    'inline-flex items-center gap-2 rounded-chip px-3 py-1.5',
                    voice.state === 'recording' ? 'bg-coral-wash text-coral' : 'bg-sunk text-ink-soft',
                  )}
                >
                  <span
                    className={cn(
                      'size-1.5 rounded-chip',
                      voice.state === 'recording' ? 'animate-pulse bg-coral' : 'bg-ink-mute',
                    )}
                  />
                  {voice.state === 'asking' && '正在请求麦克风权限…'}
                  {voice.state === 'recording' && `正在录音 ${voice.seconds} / ${agent.voice?.maxSeconds ?? 60} 秒`}
                  {voice.state === 'transcribing' && '正在识别…'}
                  {voice.state === 'thinking' && '正在想…'}
                  {voice.state === 'speaking' && '正在朗读'}
                  {voice.state === 'idle' && '按住麦克风说话'}
                </span>
                {/* 状态栏只放进度条，不放波形：它是"一直在那"的指示，很窄；
                    波形留给消息上那个播放器（那里才是用户盯着看的地方）。 */}
                {voice.state === 'speaking' && voice.playback !== undefined && (
                  <span className="inline-flex min-w-[80px] flex-1 items-center gap-2">
                    {/* 这一条是**重复指示**（真正带无障碍语义的那条在消息上），
                        所以标成 aria-hidden——不然同一页会有两个同名的 progressbar，
                        读屏软件读不出哪个是哪个。文字上的「正在朗读」已经说明了状态。 */}
                    <span
                      aria-hidden="true"
                      className="h-[3px] min-w-[60px] flex-1 overflow-hidden rounded-chip bg-line"
                    >
                      {/* 同 SpeechPlayer：动的是 transform 不是 width */}
                      <span
                        className="block h-full origin-left rounded-chip bg-gold-deep transition-transform duration-200 ease-linear"
                        style={{ transform: `scaleX(${Math.min(1, Math.max(0, voice.playback.ratio))})` }}
                      />
                    </span>
                    <span className="num shrink-0 text-ink-mute">
                      {Math.floor(voice.playback.position)}s / {Math.floor(voice.playback.duration)}s
                    </span>
                  </span>
                )}
                {voice.state === 'speaking' && (
                  <button
                    type="button"
                    onClick={voice.stopSpeaking}
                    className="inline-flex items-center gap-1.5 rounded-chip border border-line px-3 py-1.5 text-ink-soft transition-colors hover:border-gold hover:text-gold-deep"
                  >
                    <StopIcon size={12} />
                    停止朗读
                  </button>
                )}
                {voice.error !== undefined && <span className="text-coral">{voice.error}</span>}
              </div>
            )}

            {/* 播放失败的提示，**不分语音模式**。

                「朗读」按钮是只要服务端有 TTS 就显示的（判据是 `voice.available`，
                和语音模式无关）。但错误原来只画在语音模式那个状态条里，
                于是不在语音模式时点朗读、又失败了（浏览器挡自动播放、音频解不开），
                用户看到的是"播放器闪一下就没" + **一句解释都没有**。
                实测就是这么一例：模型先说了句「我查一下。」，合成出来 1 秒，
                播放器活了 0.9 秒——那是正常结束，但用户没法分辨它和"失败"的区别。
                所以这条提示要在任何模式下都在。 */}
            {!voiceUsable && voice.error !== undefined && (
              <p role="alert" className="mb-3 text-[13px] text-coral">
                朗读失败：{voice.error}
              </p>
            )}

            {/* 已选图片的预览条。放在输入框上面而不是里面：输入框是单行，
                塞进去会把 placeholder 和光标挤得没法用。 */}
            {(pendingImage !== undefined || imageError !== undefined || imageBusy) && (
              <div className="mb-3 flex items-center gap-3 rounded-chip border border-line bg-sunk px-3 py-2">
                {imageBusy && <span className="text-[13px] text-ink-soft">正在处理图片…</span>}
                {!imageBusy && pendingImage !== undefined && (
                  <>
                    <img
                      src={pendingImage.thumb}
                      alt="待发送的图片预览"
                      data-pending-image
                      className="size-12 shrink-0 rounded-chip object-cover"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] text-ink">{pendingImage.name}</p>
                      {/* 敏感信息提示：这一句是**必须**的——图一旦发出去就进了
                          助手的上下文，遮掉的只能是发之前。 */}
                      <p className="mt-0.5 text-[12px] text-ink-soft">
                        这张图会进助手的上下文。卡号、密码一类敏感信息请先遮掉。
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label="移除已选图片"
                      onClick={() => { setPendingImage(undefined); setImageError(undefined) }}
                      className="grid size-7 shrink-0 place-items-center rounded-chip text-ink-soft transition-colors hover:bg-line hover:text-ink"
                    >
                      <CloseIcon size={15} />
                    </button>
                  </>
                )}
                {!imageBusy && imageError !== undefined && (
                  <>
                    <span role="alert" className="flex-1 text-[13px] text-coral">{imageError}</span>
                    <button
                      type="button"
                      aria-label="移除已选图片"
                      onClick={() => { setPendingImage(undefined); setImageError(undefined) }}
                      className="grid size-7 shrink-0 place-items-center rounded-chip text-ink-soft transition-colors hover:bg-line hover:text-ink"
                    >
                      <CloseIcon size={15} />
                    </button>
                  </>
                )}
              </div>
            )}

            <form
              className="chat-input-form flex min-w-0 items-center gap-2 sm:gap-3"
              onSubmit={(e) => {
                e.preventDefault()
                // 发完立刻清掉预览：拖到下一轮再清的话，回答期间用户会以为还能改。
                if (send(input, pendingImage)) {
                  setPendingImage(undefined)
                  setImageError(undefined)
                }
              }}
            >
              {/* 选图的入口。`accept` 和服务端认的类型对齐（见 lib/image.ts）。 */}
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_MIME_TYPES.join(',')}
                className="hidden"
                data-image-input
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  // 清掉 value：同一张图连选两次也要能再次触发 change。
                  e.target.value = ''
                  if (file !== undefined) void pickImage(file)
                }}
              />
              <button
                type="button"
                aria-label="发送图片"
                disabled={probing || !usingAgent}
                title={usingAgent ? '发一张截图给客服' : '智能客服未接通时不能发图'}
                onClick={() => { fileInputRef.current?.click() }}
                className="grid size-12 shrink-0 place-items-center rounded-chip border border-line text-ink-soft transition-colors hover:border-gold hover:text-gold-deep disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ImagePlusIcon size={20} />
              </button>
              <textarea
                ref={inputRef}
                rows={workbench ? 2 : 1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={
                  probing
                    ? '正在连接…'
                    : !usingAgent && !fallback ? '智能助手暂未连接，请稍后重试'
                      : voiceUsable ? '也可以直接打字，或按住右边的麦克风说话' : props.placeholder ?? '描述你的需求，例如：帮我转 800 元给梁乐怡'
                }
                disabled={probing || (!usingAgent && !fallback)}
                aria-label="聊天消息"
                onKeyDown={e => {
                  if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
                  e.preventDefault()
                  e.currentTarget.form?.requestSubmit()
                }}
                className="h-12 min-w-0 flex-1 resize-none rounded-chip border border-line bg-surface px-3 py-3 text-[14px] text-ink outline-none transition-colors placeholder:text-ink-mute focus:border-gold disabled:bg-sunk"
              />
              {workbench && <button type="button" aria-label="语音输入" aria-pressed={voiceMode}
                disabled={!usingAgent || !voice.available} title={voice.unavailableReason ?? '开启后按住麦克风说话'}
                onClick={() => setVoiceMode(on => !on)} className="workbench-voice-toggle">
                <MicIcon size={19} />
              </button>}
              {voiceUsable && (
                /* 按住说话。用 pointer 事件而不是 mouse/touch 两套：
                   pointer 一次性覆盖鼠标、触摸和触控笔，而且松手/移出/取消都能收到。
                   另外要 `touch-none select-none`——不然在手机上按住会触发页面滚动和选中。 */
                <button
                  type="button"
                  aria-label="按住说话"
                  aria-pressed={voice.state === 'recording'}
                  onPointerDown={(e) => { e.preventDefault(); voice.start() }}
                  onPointerUp={() => { voice.stop() }}
                  onPointerLeave={() => { if (voice.state === 'recording') voice.stop() }}
                  onPointerCancel={() => { voice.stop() }}
                  onKeyDown={(e) => {
                    // 键盘也要能用：空格/回车按住说话，重复触发要挡掉（按住会连发）。
                    if (e.key !== ' ' && e.key !== 'Enter') return
                    e.preventDefault()
                    if (e.repeat) return
                    voice.start()
                  }}
                  onKeyUp={(e) => {
                    if (e.key !== ' ' && e.key !== 'Enter') return
                    e.preventDefault()
                    voice.stop()
                  }}
                  disabled={!voice.available}
                  title={voice.available ? '按住说话，松开结束' : voice.unavailableReason}
                  className={cn(
                    'grid size-12 shrink-0 touch-none place-items-center rounded-chip transition-all select-none',
                    voice.state === 'recording'
                      ? 'scale-110 bg-coral text-ink-invert'
                      : 'bg-gold text-ink hover:bg-gold-deep hover:text-ink-invert',
                    'disabled:cursor-not-allowed disabled:bg-gold/30',
                  )}
                >
                  <MicIcon size={20} />
                </button>
              )}
              {usingAgent && activeBusy ? (
                <button type="button" aria-label="停止生成" title="停止生成" disabled={agent.stopping}
                  onClick={() => { spokenRef.current = latestAssistant; voice.stopSpeaking(); agent.stop() }}
                  className="grid size-12 shrink-0 place-items-center rounded-chip bg-ink text-ink-invert transition-opacity disabled:opacity-40">
                  <StopIcon size={20} />
                </button>
              ) : <button
                type="submit"
                aria-label="发送"
                disabled={(usingAgent ? activeBusy : thinking) || (!input.trim() && pendingImage === undefined) || probing || imageBusy || (!usingAgent && !fallback)}
                className="grid size-12 shrink-0 place-items-center rounded-chip bg-gold text-ink transition-colors hover:bg-gold-deep hover:text-ink-invert disabled:cursor-not-allowed disabled:bg-gold/40"
              >
                <SendIcon size={20} />
              </button>}
            </form>
          </div>
        </div>
      </Card>
      <Modal open={usingAgent && historyOpen && compact} onClose={() => setHistoryOpen(false)} title="历史对话">
        <div className="h-[min(55dvh,420px)]">
          <SessionList conversations={agent.conversations} activeId={agent.activeId} busyIds={agent.busyIds} lostIds={agent.lostIds} now={now}
            onSelect={id => { agent.select(id); setHistoryOpen(false) }}
            onRename={conversation => { setHistoryOpen(false); openRename(conversation) }}
            onDelete={conversation => { setHistoryOpen(false); setDeleteTarget(conversation) }} />
        </div>
      </Modal>

      <EditMessageModal
        open={editTarget !== undefined}
        value={editValue}
        /* 这条之后还有几条内容会被删掉——数字要如实算出来给用户看，
           不能只说"后面的会删掉"就让他按。 */
        droppedCount={items === undefined || editTarget === undefined
          ? 0
          : Math.max(0, items.length - 1 - items.findIndex(item => item.id === editTarget.id))}
        onChange={setEditValue}
        onClose={() => { setEditTarget(undefined) }}
        onSubmit={() => {
          if (editTarget !== undefined) agent.rewind(editTarget.id, editValue)
          setEditTarget(undefined)
        }}
      />

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

/**
 * 顶部的通道状态标签：让用户一眼看出现在是真 agent 还是固定话术。
 *
 * **刻意不显示模型名。** 这里以前是「Agent 已连接 · qwen/qwen3.8-flash」——
 * 那对用户是噪音，对外是没必要的信息暴露。现在显示的是助手自己的名字，
 * 而且这个名字和它人设里的自称是同一个（`lib/assistant.ts` 是唯一来源，
 * `tools/check-persona.mjs` 盯着两处一致）。
 *
 * 外面套的那层 `data-agent-status` 是给检查用的**稳定锚点**。
 * 之前几个门禁是按文案 `'Agent 已连接'` 找元素的，改一次文案就集体挂掉
 * （实测：这一改挂了三处断言）。门禁该锚在"状态"上，不该锚在文案上——
 * 文案随时会变，而状态只有三种。
 */
function ModeTag({ status }: { status: 'probing' | 'off' | 'ready' }) {
  if (status === 'probing') {
    return (
      <span data-agent-status="probing">
        <Tag tone="neutral" className="h-8 px-3">
          正在连接…
        </Tag>
      </span>
    )
  }
  if (status === 'ready') {
    return (
      <span data-agent-status="ready">
        <Tag tone="blue" className="h-8 px-3">
          <CheckIcon size={14} className="mr-1.5" />
          {ASSISTANT.name}在线
        </Tag>
      </span>
    )
  }
  return (
    <span data-agent-status="off">
      <Tag tone="gold" className="h-8 px-3">
        <SparkleIcon size={14} className="mr-1.5" />
        智能助手未连接账户服务
      </Tag>
    </span>
  )
}

/**
 * 一条消息上那几个小动作需要的全部东西。
 *
 * 打包传而不是一条消息传十个 prop：同一段对话里每条消息拿到的都是同一套，
 * 只有 `speaking` / `regeneratable` 是按 id 比对出来的。
 */
interface BubbleActions {
  mascot: boolean
  /** 服务端报了语音能力才显示朗读按钮。 */
  canSpeak: boolean
  /** 正在念的是哪一条。 */
  speakingId?: string | undefined
  /** 正在念那一条的播放进度与波形（没在念时是 undefined）。 */
  playback?: VoicePlayback | undefined
  /** 哪一条助手回复可以"重新生成"（最后一条）。 */
  regeneratableId?: string | undefined
  retryablePromptId?: string | undefined
  onRetry: (promptId: string) => void
  /** 现在不能倒回重发。 */
  frozen: boolean
  frozenReason?: string | undefined
  onRegenerate: (id: string) => void
  onSpeak: (item: MessageItem) => void
  onStopSpeak: () => void
  /** 用户拖了/点了朗读进度条，跳到 `ratio`（0–1）。 */
  onSeek: (ratio: number) => void
  onEdit: (item: MessageItem) => void
}

/** 每轮只有一个助手头像，过程展开后也不再产生独立的消息动作。 */
function AssistantTurnBubble({ turn, actions, busy, waiting }: {
  turn: AssistantTurn
  actions: BubbleActions
  busy: boolean
  waiting?: '确认' | '补充信息'
}) {
  const [expanded, setExpanded] = useState(false)
  const detailId = useId()
  const { reply, activity, notices, lastTool } = turnContent(turn)
  const runningTool = turn.items.findLast(item => item.kind === 'tool' && item.state === 'running')
  const unfinished = busy || Boolean(waiting) || Boolean(reply?.streaming)
  const error = notices.some(item => item.tone === 'error')
  const retryProgress = busy ? notices.find(item => item.id === 'model_retry_progress') : undefined
  if (!turn.items.length && !unfinished) return null
  const status = waiting ? `等待您${waiting}`
    : retryProgress ? retryProgress.text
    : busy && runningTool?.kind === 'tool' ? `正在${toolLabel(runningTool.name)}`
      : unfinished ? reply?.streaming || lastTool?.state === 'done' ? '正在整理回复' : '正在处理'
        : error ? '处理未完成'
          : reply ? lastTool ? `${toolLabel(lastTool.name)} · 已完成` : '回复完成'
            : lastTool?.state === 'error' ? '处理未完成' : '处理已结束'
  return (
    <div className="assistant-turn pop-in" data-message-kind="assistant" data-message-id={reply?.id ?? turn.id}
      data-turn-id={turn.id} data-streaming={reply?.streaming ? 'true' : undefined}>
      <span className="assistant-turn-avatar grid size-8 shrink-0 place-items-center rounded-chip bg-gold-wash">
        {actions.mascot ? <SupportCat className="size-8 object-contain" />
          : <CatMark className="size-5 text-gold-deep" cutout="var(--color-gold-wash)" />}
      </span>
      <div className="assistant-turn-content">
        <div className="assistant-turn-root">
          <span className={cn('assistant-turn-status', unfinished && 'is-working', error && 'is-error')}>
            <span className="assistant-turn-dot" aria-hidden="true" />
            <span role={unfinished ? 'status' : undefined}>{status}</span>
          </span>
          {activity.length > 0 && <button type="button" className="assistant-turn-toggle" aria-expanded={expanded}
            aria-controls={detailId} aria-label={expanded ? '收起处理过程' : '展开处理过程'}
            onClick={() => setExpanded(value => !value)}>
            处理过程<ChevronDownIcon size={14} />
          </button>}
        </div>
        {activity.length > 0 && <div id={detailId} className={cn('assistant-turn-collapse', expanded && 'is-expanded')}
          aria-hidden={!expanded} inert={!expanded}>
          <div className="assistant-turn-clip">
          <div className="assistant-turn-details">
          <ol aria-label="处理过程">
            {activity.map(item => <li key={item.id} data-activity-kind={item.kind}>
              {item.kind === 'tool' ? <>
                <div className="assistant-turn-step">
                  <span>{toolLabel(item.name)}</span>
                  <span className={cn('assistant-turn-step-state', item.state === 'error' && 'is-error')}>
                    {item.state === 'running' ? '执行中…' : item.state === 'done' ? '已完成' : '未完成'}
                  </span>
                </div>
                {item.text && <p>{item.text}</p>}
              </> : <Suspense fallback={<span className="whitespace-pre-wrap">{item.text}</span>}>
                <Markdown text={item.text} />
              </Suspense>}
            </li>)}
          </ol>
          </div>
          </div>
        </div>}
        {reply && <div className="assistant-turn-answer rounded-card bg-sunk px-4 py-3 text-ink">
          <Suspense fallback={<span className="whitespace-pre-wrap">{reply.text}</span>}>
            <Markdown text={reply.text} />
          </Suspense>
          {reply.streaming && <span aria-label="正在生成回复" className="ml-1 inline-block h-4 w-0.5 animate-pulse bg-gold-deep align-middle" />}
        </div>}
        {/* 异常始终可见，不藏进折叠的工具过程。确认卡与提问卡仍在工作区直接显示。 */}
        {notices.filter(item => item.id !== 'model_retry_progress').map(item => <p key={item.id} role={item.tone === 'error' ? 'alert' : undefined}
          className={cn('assistant-turn-notice', item.tone === 'error' && 'is-error')}>{item.text}</p>)}
        {(error || lastTool?.state === 'error') && turn.promptId && actions.retryablePromptId === turn.promptId && (
          <button type="button" className="assistant-turn-retry" aria-label="重试这轮请求"
            disabled={actions.frozen || unfinished} title={actions.frozen ? actions.frozenReason : '继续处理上一轮请求'}
            onClick={() => actions.onRetry(turn.promptId!)}>
            <RefreshIcon size={14} />重试
          </button>
        )}
        {reply && !unfinished && <>
          {actions.speakingId === reply.id && actions.playback && <SpeechPlayer className="mt-1.5 w-full"
            onSeek={actions.onSeek} position={actions.playback.position} duration={actions.playback.duration}
            ratio={actions.playback.ratio} waveform={actions.playback.waveform} />}
          <MessageActions text={reply.text} isUser={false} canSpeak={actions.canSpeak}
            speaking={actions.speakingId === reply.id} regeneratable={actions.regeneratableId === reply.id}
            frozen={actions.frozen} frozenReason={actions.frozenReason}
            onRegenerate={() => actions.onRegenerate(reply.id)} onSpeak={() => actions.onSpeak(reply)}
            onStopSpeak={actions.onStopSpeak} onEdit={() => actions.onEdit(reply)} />
        </>}
      </div>
    </div>
  )
}

function UserBubble({ item, actions }: { item: Extract<ChatItem, { kind: 'user' }>; actions: BubbleActions }) {
  return (
    <div className="pop-in flex flex-row-reverse items-start gap-3" data-message-kind="user" data-message-id={item.id}>
      <span className="grid size-8 shrink-0 place-items-center rounded-chip bg-ink text-ink-invert"><UserIcon size={17} /></span>
      <div className="flex min-w-0 max-w-[85%] flex-col items-end">
        <div className="rounded-card bg-ink px-4 py-3 text-[14px] leading-relaxed whitespace-pre-wrap text-ink-invert">
          {item.thumb !== undefined && <img src={item.thumb} alt={item.imageName ? `你发的图片：${item.imageName}` : '你发的图片'}
            data-sent-image className={cn('max-h-56 w-auto max-w-full rounded-chip object-contain', item.text.trim() !== '' && 'mb-2')} />}
          {item.text}
        </div>
        <MessageActions text={item.text} isUser canSpeak={false} speaking={false} regeneratable={false}
          frozen={actions.frozen} frozenReason={actions.frozenReason}
          onRegenerate={() => actions.onRegenerate(item.id)} onSpeak={() => actions.onSpeak(item)}
          onStopSpeak={actions.onStopSpeak} onEdit={() => actions.onEdit(item)} />
      </div>
    </div>
  )
}

function MessageBubble({ message }: { message: SupportMessage }) {
  const isUser = message.role === 'user'
  const isStaff = message.role === 'staff'
  return (
    <div className={cn('pop-in flex items-start gap-3', isUser && 'flex-row-reverse')}>
      <span
        className={cn(
          'grid size-8 shrink-0 place-items-center rounded-chip',
          isUser ? 'bg-ink text-ink-invert' : isStaff ? 'bg-gold text-white' : 'bg-gold-wash',
        )}
      >
        {isUser || isStaff ? (
          <UserIcon size={17} />
        ) : (
          <CatMark className="size-5 text-gold-deep" cutout="var(--color-gold-wash)" />
        )}
      </span>

      <div className={cn('max-w-[80%]', isUser && 'flex flex-col items-end')}>
        {/* 人工客服要标出是谁发的，客户才知道这是真人而不是智能客服 */}
        {isStaff && (
          <p className="mb-1 text-[12px] text-gold-deep">
            人工客服{message.staffName ? ` · ${message.staffName}` : ''}
          </p>
        )}
        <div
          className={cn(
            'rounded-card px-4 py-3 text-[14px] leading-relaxed',
            isUser ? 'bg-ink text-ink-invert' : 'bg-sunk text-ink',
          )}
        >
          {message.text}
        </div>
      </div>
    </div>
  )
}
