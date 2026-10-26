import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import {
  ImError,
  isImFeatureUnavailable,
  cancelImReminder,
  claimImCode,
  continueImRequest,
  createImReminder,
  listImBindings,
  listImReminders,
  previewImCode,
  revokeImBinding,
  imSessionPortalUrl,
  type ImBinding,
  type ImCodePreview,
  type ImReminderList,
  type ImContinuation,
} from '@/api/im'
import { WeixinQrBinding } from '@/components/im/WeixinQrBinding'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { DataUnavailable } from '@/components/ui/DataUnavailable'
import { Field } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { EmptyState, Skeleton, Tag } from '@/components/ui/Segmented'
import { AlertIcon, BellIcon, ChatIcon, ChevronDownIcon, RefreshIcon, ShieldIcon } from '@/components/ui/icons'
import { useToast } from '@/components/ui/toast-context'
import { useSession } from '@/store/session-context'
import '@/components/im/im-page.css'

/** 后端只按北京时间发提醒，界面上的时间一律标出来，避免和本机时区混淆。 */
const BEIJING = 'Asia/Shanghai'
const beijingTime = (value: string | number) =>
  new Intl.DateTimeFormat('zh-CN', {
    timeZone: BEIJING,
    dateStyle: 'medium',
    timeStyle: 'short',
    hour12: false,
  }).format(new Date(value))

/**
 * `datetime-local` 的字符串按北京时间理解。
 * 先加上东八区偏移再取 ISO 前 16 位，得到的正是「北京此刻的墙上时间」。
 */
const beijingInputValue = (time = Date.now() + 120_000) =>
  new Date(time + 8 * 3_600_000).toISOString().slice(0, 16)

const STATUS_LABEL: Record<string, string> = {
  scheduled: '等待发送',
  sending: '正在发送',
  sent: '已提交微信（不代表已读）',
  cancelled: '已取消',
  suppressed: '绑定变化已停止',
  expired: '超时未发送',
  failed: '机器人未就绪',
  unknown: '结果不确定',
}

const STATUS_TONE: Record<string, 'neutral' | 'gold' | 'blue' | 'coral'> = {
  scheduled: 'gold',
  sending: 'blue',
  sent: 'blue',
  cancelled: 'neutral',
  suppressed: 'neutral',
  expired: 'neutral',
  failed: 'coral',
  unknown: 'coral',
}

const EXPIRED_CODE_HINT =
  '此绑定码已使用或已过期。请回到原微信私聊发送「绑定」，打开机器人新回复的链接后重新核对；无需重新扫码机器人。'

const messageOf = (error: unknown, fallback: string) =>
  error instanceof ImError ? error.message : fallback

/** 提醒内容必须是单行文本：粘贴也可能把换行或其它控制字符带进来。 */
const hasControlChar = (text: string) => [...text].some(char => {
  const code = char.codePointAt(0) ?? 0
  return code < 32 || code === 127
})

/** 一次提醒的核对草稿：`requestId` 在这里生成，重复点「确认创建」不会创建第二条。 */
interface ReminderDraft {
  title: string
  dueAt: string
  bindingId: string
  label: string
  requestId: string
}

/**
 * 助手页内的客户 IM 管理：扫码、绑定与提醒共用现有登录身份。
 *
 * 渠道运维管理留在桥接服务；客户可核对绑定码、逐条解绑并管理提醒。
 * 已保存提醒自动同步；资金业务的 `#session=` 仍可打开原确认门户。
 *
 * @module app/components/im/ImConnectView
 */
export function ImConnectView() {
  const { user } = useSession()
  return user ? <ImManagement key={user.id} /> : null
}

function ImManagement() {
  const toast = useToast()
  const [showConnectionForm, setShowConnectionForm] = useState(false)
  const location = useLocation()
  const bindingSelectId = useId()
  const lifecycle = useRef(0)
  useEffect(() => () => { lifecycle.current++ }, [])

  /* ── 绑定列表：与提醒一样要区分 404/503（桥接未启用 IM），所以不用 useAsync ── */
  const [bindingList, setBindingList] = useState<ImBinding[] | null>(null)
  const [bindingsError, setBindingsError] = useState<ImError | null>(null)
  const [bindingsLoading, setBindingsLoading] = useState(true)
  const bindingRequest = useRef(0)
  const bindingTask = useRef<Promise<void> | null>(null)
  const loadBindings = useCallback((background = false): Promise<void> => {
    if (background && bindingTask.current) return bindingTask.current
    const generation = lifecycle.current
    const previous = bindingTask.current ?? Promise.resolve()
    const task = previous.then(async () => {
      if (generation !== lifecycle.current) return
      const request = ++bindingRequest.current
      if (!background) setBindingsLoading(true)
      try {
        const data = await listImBindings()
        if (generation !== lifecycle.current || request !== bindingRequest.current) return
      setBindingList(data)
      setContinuation(data.find(item => item.continuation)?.continuation ?? null)
        setBindingsError(null)
      } catch (error) {
        if (generation !== lifecycle.current || request !== bindingRequest.current) return
        const failure = error instanceof ImError ? error : new ImError('IM 连接列表暂时无法加载', 0)
        setBindingList(null)
        setBindingsError(failure)
      } finally {
        if (generation === lifecycle.current && request === bindingRequest.current) setBindingsLoading(false)
      }
    })
    bindingTask.current = task
    void task.then(() => { if (bindingTask.current === task) bindingTask.current = null })
    return task
  }, [])
  useEffect(() => { void loadBindings() }, [loadBindings])

  /* ── 提醒列表：要区分 503/404（未启用）与真正的失败，所以不用 useAsync ── */
  const [reminders, setReminders] = useState<ImReminderList | null>(null)
  const [remindersError, setRemindersError] = useState<ImError | null>(null)
  const [remindersLoading, setRemindersLoading] = useState(true)
  const reminderRequest = useRef(0)
  const reminderTask = useRef<Promise<void> | null>(null)
  const loadReminders = useCallback((background = false): Promise<void> => {
    if (background && reminderTask.current) return reminderTask.current
    const generation = lifecycle.current
    const previous = reminderTask.current ?? Promise.resolve()
    const task = previous.then(async () => {
      if (generation !== lifecycle.current) return
      const request = ++reminderRequest.current
      if (!background) setRemindersLoading(true)
      try {
        const data = await listImReminders()
        if (generation !== lifecycle.current || request !== reminderRequest.current) return
        setReminders(data)
        setRemindersError(null)
      } catch (error) {
        if (generation !== lifecycle.current || request !== reminderRequest.current) return
        const failure = error instanceof ImError ? error : new ImError('提醒暂时无法加载，请稍后重试', 0)
        // 保留本人的上次结果和编辑草稿；同步失败不冒充空列表，也不能继续提交。
        if (isImFeatureUnavailable(failure)) setReminders(null)
        setRemindersError(failure)
      } finally {
        if (generation === lifecycle.current && request === reminderRequest.current) setRemindersLoading(false)
      }
    })
    reminderTask.current = task
    void task.then(() => { if (reminderTask.current === task) reminderTask.current = null })
    return task
  }, [])
  useEffect(() => { void loadReminders() }, [loadReminders])
  useEffect(() => {
    if (location.pathname !== '/assistant' || new URLSearchParams(location.search).get('view') !== 'im') return
    let active = true, refreshing = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const sync = async () => {
      if (!active || refreshing) return
      clearTimeout(timer)
      refreshing = true
      try {
        if (!document.hidden) await Promise.all([loadBindings(true), loadReminders(true)])
      } finally {
        refreshing = false
        if (active) timer = setTimeout(() => { void sync() }, 15_000)
      }
    }
    const resume = () => { if (!document.hidden) void sync() }
    timer = setTimeout(() => { void sync() }, 15_000)
    window.addEventListener('focus', resume)
    window.addEventListener('online', resume)
    document.addEventListener('visibilitychange', resume)
    return () => {
      active = false; clearTimeout(timer)
      window.removeEventListener('focus', resume)
      window.removeEventListener('online', resume)
      document.removeEventListener('visibilitychange', resume)
    }
  }, [loadBindings, loadReminders, location.pathname, location.search])
  const remindersDisabled = reminders === null && remindersError !== null
    && isImFeatureUnavailable(remindersError)

  /* ── 绑定码：核对 → 确认绑定 ──────────────────────────────────────── */
  const [code, setCode] = useState('')
  const [manualOpen, setManualOpen] = useState(false)
  const [preview, setPreview] = useState<ImCodePreview | null>(null)
  const [checkedCode, setCheckedCode] = useState('')
  const [codeError, setCodeError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [claiming, setClaiming] = useState(false)
  const [continuation, setContinuation] = useState<ImContinuation | null>(null)
  const [continuing, setContinuing] = useState(false)
  const codeRequest = useRef(0)

  async function checkCode(value = code.trim()) {
    const request = ++codeRequest.current
    if (!value) {
      setCodeError('请粘贴或输入微信里收到的绑定码')
      return
    }
    setChecking(true)
    setCodeError(null)
    setPreview(null)
    setCheckedCode('')
    try {
      const data = await previewImCode(value)
      if (request !== codeRequest.current) return
      setPreview(data)
      setCheckedCode(value)
    } catch (error) {
      if (request !== codeRequest.current) return
      setCodeError(error instanceof ImError && error.status === 404 ? EXPIRED_CODE_HINT : messageOf(error, '核对失败，请稍后重试'))
    } finally {
      if (request === codeRequest.current) setChecking(false)
    }
  }

  async function claim() {
    if (!preview || checkedCode !== code.trim()) {
      setCodeError('请先核对绑定来源')
      return
    }
    setClaiming(true)
    setCodeError(null)
    try {
      const result = await claimImCode(code.trim())
      setContinuation(result.continuation ?? null)
      setPreview(null)
      setCheckedCode('')
      setCode('')
      // 绑定码不进浏览器历史：与旧门户一致，换页或后退都看不到它。
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
      toast.show('已绑定此 IM 私聊', 'success')
      await loadBindings()
      await loadReminders()
    } catch (error) {
      if (error instanceof ImError && error.status === 404) {
        setPreview(null)
        setCodeError(EXPIRED_CODE_HINT)
      } else {
        setCodeError(messageOf(error, '绑定失败，请稍后重试'))
      }
    } finally {
      setClaiming(false)
    }
  }

  /** 每次更换微信链接都重新核对；旧请求不能覆盖新来源。 */
  const autoChecked = useRef('')
  useEffect(() => {
    const fromHash = new URLSearchParams(location.hash.replace(/^#/, '')).get('code')?.trim() ?? ''
    if (!fromHash) { autoChecked.current = ''; return }
    if (autoChecked.current === fromHash) return
    autoChecked.current = fromHash
    setManualOpen(true)
    setCode(fromHash)
    void checkCode(fromHash)
    // checkCode 只读、无状态依赖，跑一次即可
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.hash])

  /* ── 解除绑定 ────────────────────────────────────────────────────── */
  const [revokeTarget, setRevokeTarget] = useState<ImBinding | null>(null)
  const [revoking, setRevoking] = useState(false)
  const [revokeError, setRevokeError] = useState<string | null>(null)

  async function confirmRevoke() {
    if (!revokeTarget) return
    setRevoking(true)
    setRevokeError(null)
    try {
      await revokeImBinding(revokeTarget.id)
      setRevokeTarget(null)
      toast.show('已解除绑定，旧提醒将停止发送', 'success')
      await loadBindings()
      await loadReminders()
    } catch (error) {
      setRevokeError(messageOf(error, '解除失败，请稍后重试'))
    } finally {
      setRevoking(false)
    }
  }

  /* ── 新建提醒：填写 → 核对 → 确认创建 ─────────────────────────────── */
  const [bindingId, setBindingId] = useState('')
  const [title, setTitle] = useState('')
  const [when, setWhen] = useState(() => beijingInputValue())
  const [draft, setDraft] = useState<ReminderDraft | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const available = reminders?.bindings ?? []
  const reminderBindingReady = (id: string) => !remindersError && available.some(item => item.id === id)
  useEffect(() => {
    if (available.length === 0) {
      setBindingId('')
      return
    }
    setBindingId(previous => (available.some(item => item.id === previous) ? previous : available[0].id))
  }, [reminders]) // eslint-disable-line react-hooks/exhaustive-deps

  function reviewReminder() {
    if (remindersLoading || remindersError) return setFormError('提醒状态尚未确认，请重新加载后再核对')
    const text = title.trim()
    const label = available.find(item => item.id === bindingId)?.label
    if (!text || text.length > 160) return setFormError('提醒内容须为 1–160 字的单行文字')
    if (hasControlChar(text)) return setFormError('提醒内容不能包含换行或控制字符')
    if (!label) return setFormError('请选择接收提醒的微信私聊')
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(when)) return setFormError('请选择提醒时间（北京时间）')
    const time = Date.parse(`${when}:00+08:00`)
    if (!Number.isFinite(time) || time < Date.now() + 15_000 || time > Date.now() + 365 * 86400_000) return setFormError('提醒时间需在 15 秒后至未来 365 天内（北京时间）')
    setFormError(null)
    setDraft({ title: text, dueAt: `${when}:00+08:00`, bindingId, label, requestId: crypto.randomUUID() })
  }

  async function submitReminder() {
    if (!draft) {
      setFormError('请先核对提醒信息')
      return
    }
    if (remindersLoading || remindersError || !available.some(binding => binding.id === draft.bindingId)) {
      setDraft(null)
      setFormError('接收连接或提醒状态已变化，请重新加载并核对')
      return
    }
    setCreating(true)
    setFormError(null)
    try {
      await createImReminder({
        title: draft.title,
        dueAt: draft.dueAt,
        bindingId: draft.bindingId,
        requestId: draft.requestId,
      })
      setDraft(null)
      setTitle('')
      setWhen(beijingInputValue())
      toast.show('提醒已保存，等待到期发送', 'success')
      await loadReminders()
    } catch (error) {
      setFormError(messageOf(error, '提醒创建失败，请稍后重试'))
    } finally {
      setCreating(false)
    }
  }

  /* ── 取消提醒：行内二次确认 ───────────────────────────────────────── */
  const [cancelTarget, setCancelTarget] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)

  async function cancelReminder(id: string) {
    setCancelling(true)
    setCancelError(null)
    try {
      await cancelImReminder(id, crypto.randomUUID())
      setCancelTarget(null)
      toast.show('提醒已取消', 'success')
      await loadReminders()
    } catch (error) {
      setCancelError(messageOf(error, '取消失败，请稍后重试'))
    } finally {
      setCancelling(false)
    }
  }

  /* ── 渲染 ────────────────────────────────────────────────────────── */
  // 桥接没启用 IM 时两个接口都 404：这是「未启用」状态，不是错误。
  const imDisabled = isImFeatureUnavailable(bindingsError)
  const serviceUnavailable = !imDisabled && bindingsError && !bindingList && !reminders && !remindersLoading

  const bindingCount = bindingList?.length ?? 0
  const liveCount = bindingList?.filter(binding => binding.connected).length ?? 0
  const showQr = !bindingsLoading && !bindingsError && (liveCount === 0 || showConnectionForm)
  const truncated = reminders?.truncated ?? reminders?.historyMayBeTruncated ?? false
  const pendingSession = new URLSearchParams(location.hash.replace(/^#/, '')).get('session')

  return (
    <div className="im-page flex flex-col gap-6">
      <Card className="im-status-card">
        <CardHeader title="连接状态" action={<span className="im-status-actions">
          {!bindingsLoading && !bindingsError && <Tag tone={liveCount > 0 ? 'gold' : 'neutral'}>{liveCount > 0 ? '已连接' : !remindersError && available.length > 0 ? '提醒已绑定' : bindingCount > 0 ? '需重新授权' : '未连接'}</Tag>}
          {bindingCount > 0 && !bindingsError && <Button size="sm" variant="ghost" onClick={() => setShowConnectionForm(value => !value)}>{showConnectionForm ? '收起扫码' : '添加/重新连接'}</Button>}
        </span>} />
        <p className="im-description">{bindingsLoading ? '正在核对当前账户的连接状态…' : bindingsError ? '连接状态暂时无法确认，请重新加载。' : liveCount > 0 ? '已绑定本人私聊，可管理下方提醒或解除单条绑定。' : !remindersError && available.length > 0 ? '本人微信提醒绑定仍有效，可直接在微信设置日程；银行业务需要单独恢复授权。' : bindingCount > 0 ? '原绑定仍保留，可在原微信获取新绑定码恢复银行授权；恢复后请检查提醒状态。' : '在本页连接本人微信，再设置日程提醒。'}</p>
        {!bindingsLoading && !bindingsError && bindingCount > 0 && <p className="mt-2 text-[12px] text-ink-mute">连接状态表示银行授权是否有效；微信提醒是否送达，请以提醒记录为准。</p>}
      </Card>

      {pendingSession && <Card><CardHeader title="微信业务待确认" /><p className="im-description">本次微信操作有独立确认页。打开后直接定位该会话；若已过期，会明确提示重新发起。</p><a className="mt-3 inline-flex text-[13px] font-medium text-gold-deep underline" href={imSessionPortalUrl(pendingSession)}>打开业务确认</a></Card>}
      {continuation && <Card><CardHeader title="继续这次微信请求" /><p className="im-description whitespace-pre-wrap">{continuation.request}</p><p className="mt-2 text-[12px] text-ink-mute">连接已恢复，这次请求尚未执行。继续后会显示查询结果或独立的银行操作确认卡。</p><Button className="mt-3" loading={continuing} onClick={async () => {
        if (continuation.expiresAt <= Date.now()) { setCodeError('这次请求已过期，请回微信重新发送'); setContinuation(null); return }
        setContinuing(true)
        try { const result = await continueImRequest(continuation.token); setContinuation(null); window.location.assign(imSessionPortalUrl(result.sessionId)) }
        catch (error) { setCodeError(messageOf(error, '无法继续，请核对会话或回微信重新发送')) }
        finally { setContinuing(false) }
      }}>继续这次请求</Button></Card>}

      {serviceUnavailable && <DataUnavailable
        message="IM 服务暂时不可用，连接与提醒状态尚未确认。请稍后重试。"
        onRetry={() => { void loadBindings(); void loadReminders() }}
      />}

      <div className="flex flex-col gap-6">
      {showQr && <WeixinQrBinding onBound={async () => { setShowConnectionForm(false); await loadBindings(); await loadReminders() }} />}
      {showConnectionForm && bindingCount > 0 && <p className="im-rebind-note">扫码不会自动解除原绑定。如需更换微信，请先解除原连接；旧提醒不会迁移到新连接。</p>}
      <Card className="im-bindings-card float-up">
        <CardHeader
          title={<span className="im-section-title"><span className="im-section-icon"><ChatIcon size={18} /></span>私聊绑定</span>}
          action={<Button size="sm" variant="ghost" aria-label="刷新私聊绑定" loading={bindingsLoading} icon={<RefreshIcon size={15} />} onClick={() => { void loadBindings(); void loadReminders() }}>刷新</Button>}
        />
        <p className="im-description">仅展示当前账户绑定的私聊，连接状态一目了然。</p>
        <div className="im-manual-binding">
          <button type="button" className="im-manual-toggle" aria-expanded={manualOpen} aria-controls="im-manual-code" onClick={() => setManualOpen(value => !value)}>
            <span><b>使用绑定码连接</b><small>已有微信机器人或连接企业微信</small></span><ChevronDownIcon size={17} className={manualOpen ? 'rotate-180' : ''} />
          </button>
          <div id="im-manual-code" hidden={!manualOpen} className="im-manual-content">
          <p className="text-[12px] leading-relaxed text-ink-mute">在原私聊发送「绑定」，粘贴回复中的绑定码，或直接打开回复链接。绑定码十分钟有效，用后失效。</p>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="min-w-0 sm:flex-1">
              <Field
                label="绑定码"
                value={code}
                disabled={checking || claiming}
                onChange={event => { setCode(event.target.value); setPreview(null); setCheckedCode(''); setCodeError(null) }}
                placeholder="从机器人回复的链接获取"
                autoComplete="off"
                maxLength={80}
              />
            </div>
            <Button onClick={() => void checkCode()} loading={checking} disabled={!code.trim()}>核对来源</Button>
          </div>
          {preview && (
            <div className="mt-3 rounded-field border border-gold-wash bg-gold-wash/50 p-3">
              <p className="text-[13px] text-ink">来源：{preview.label}</p>
              {preview.request && <p className="mt-2 whitespace-pre-wrap text-[13px] text-ink">本次微信请求：{preview.request}（尚未开始办理）</p>}
              <p className="mt-1 text-[12px] text-ink-soft">
                有效至 {beijingTime(preview.expiresAt)}（北京时间）。请确认这是您正在使用的 IM 私聊。
              </p>
              <Button variant="ink" size="sm" className="mt-3" loading={claiming} onClick={() => void claim()}>
                确认绑定到当前银行账户
              </Button>
            </div>
          )}
          {codeError && (
            <p role="alert" className="mt-3 flex items-start gap-2 text-[13px] text-coral">
              <AlertIcon size={16} className="mt-0.5 shrink-0" />{codeError}
            </p>
          )}
          </div>
        </div>

        <div className="im-binding-list">
          {!bindingsError && bindingList && <p className="im-list-label">我的连接 <span className="num">{bindingCount.toString().padStart(2, '0')}</span></p>}
          {bindingsLoading && !bindingList ? (
            <Skeleton className="h-16 w-full" />
          ) : imDisabled ? (
            <EmptyState
              title="IM 连接尚未启用"
              description="桥接服务启用 IM 后，这里可以核对绑定码并管理本人私聊；未启用不影响银行页面操作。"
            />
          ) : bindingsError && !bindingList ? (
            <div role="alert" className="rounded-field bg-coral-wash p-4 text-[13px] text-ink">
              <p>IM 连接列表暂时无法加载。</p>
              <Button size="sm" className="mt-3" onClick={() => void loadBindings()}>重新加载</Button>
            </div>
          ) : bindingCount === 0 ? (
            <div className="im-compact-empty"><span className="im-empty-icon"><ChatIcon size={24} /></span><p>还没有绑定 IM 私聊</p><small>先在扫码区连接微信，已有绑定码也可直接填写。</small></div>
          ) : (
            <div className="divide-y divide-line">
              {bindingList?.map(binding => (
                <div key={binding.id} className="im-binding-row im-status-line">
                  <span className="grid size-10 shrink-0 place-items-center rounded-chip bg-gold-tint text-gold-deep">
                    <ChatIcon size={18} />
                  </span>
                  <span className="min-w-0 flex-1"><span className="block text-[14px] font-medium break-words text-ink">{binding.label}</span><span className="mt-1 block text-[12px] text-ink-mute">{binding.connected ? '仅当前银行账户可用' : reminderBindingReady(binding.id) ? '微信提醒仍可用；查询账户或办理银行业务需要重新授权' : '在原微信发送「绑定」恢复银行授权，或解除此绑定'}</span></span>
                  <Tag tone={binding.connected ? 'gold' : 'neutral'}>
                    {binding.connected ? '已连接' : reminderBindingReady(binding.id) ? '提醒已绑定' : '需重新授权'}
                  </Tag>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => { setRevokeTarget(binding); setRevokeError(null) }}
                  >
                    解除绑定
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
        <p className="im-binding-footnote">连接成功后，请先在微信 ClawBot 私聊发送一条消息，激活查询与提醒。</p>
      </Card>
      </div>

      <p className="im-security-note"><ShieldIcon size={16} />银行登录密码、支付密码仅在银行页面填写；资金操作仍需单独确认。</p>

      <Card className="im-reminders-card float-up" style={{ animationDelay: '70ms' }}>
        <CardHeader
          title={<span className="im-section-title"><span className="im-section-icon"><BellIcon size={18} /></span>提醒</span>}
          action={<span className="im-channel-label">北京时间 · UTC+8</span>}
        />
        {remindersDisabled ? (
          <EmptyState
            title="提醒尚未启用"
            description="桥接服务启用提醒后，这里可以创建和查看提醒；未启用不影响绑定与银行页面操作。"
          />
        ) : remindersLoading && !reminders ? (
          <Skeleton className="mt-4 h-24 w-full" />
        ) : remindersError && !reminders ? (
          <div role="alert" className="mt-4 rounded-field bg-coral-wash p-4 text-[13px] text-ink">
            <p>{remindersError.message}</p>
            <Button size="sm" className="mt-3" onClick={() => void loadReminders()}>重新加载</Button>
          </div>
        ) : reminders && (
          <>
            {remindersError && <p role="alert" className="mt-3 text-[13px] text-coral">提醒同步失败：{remindersError.message}。当前显示上次结果，请刷新后再操作。</p>}
            <p className="im-description">记下重要的事，在约定时间送达本人微信。</p>
            <div className="im-reminders-layout">
            <div className="im-reminder-editor">
            <h3 className="im-subheading">新建提醒</h3>
            <p className="im-description mb-4">也可在已绑定的微信 ClawBot 直接说“明天上午九点提醒我买花”，无需打开网页确认。保存后本页自动更新，页面可见时约每 15 秒同步一次。</p>
            {available.length === 0 ? (
              <p className="mt-4 rounded-field border border-line bg-sunk/60 p-4 text-[13px] text-ink-soft">
                请先在上方绑定本人微信私聊，再创建提醒。
              </p>
            ) : draft ? (
              <div className="mt-4 rounded-card border border-gold-wash bg-gold-wash/40 p-4">
                <p className="text-[14px] font-medium text-ink">请核对这条提醒</p>
                <dl className="mt-2 flex flex-col gap-1.5 text-[13px] text-ink-soft">
                  <div>内容：<span className="break-words text-ink">{draft.title}</span></div>
                  <div>时间：<span className="text-ink">{beijingTime(draft.dueAt)}（北京时间）</span></div>
                  <div>接收微信：<span className="break-words text-ink">{draft.label}</span></div>
                </dl>
                <p className="mt-2 text-[12px] leading-relaxed text-ink-mute">
                  仅发送本条提醒，不查询账户或执行交易；解绑后旧提醒停止。
                </p>
                <div className="mt-3 flex flex-wrap gap-3">
                  <Button variant="ink" size="sm" loading={creating} disabled={!!remindersError || remindersLoading} onClick={() => void submitReminder()}>确认创建</Button>
                  <Button size="sm" variant="secondary" disabled={creating} onClick={() => setDraft(null)}>返回修改</Button>
                </div>
              </div>
            ) : (
              <div className="mt-4 flex flex-col gap-4">
                <div className="min-w-0">
                  <label htmlFor={bindingSelectId} className="mb-2 block text-[13px] font-medium text-ink-soft">接收微信</label>
                  <select
                    id={bindingSelectId}
                    value={bindingId}
                    onChange={event => setBindingId(event.target.value)}
                    className="h-14 w-full rounded-field border border-line bg-surface px-4 text-[15px] text-ink outline-none focus:border-gold"
                  >
                    {available.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
                  </select>
                </div>
                <Field
                  label="提醒内容"
                  value={title}
                  onChange={event => setTitle(event.target.value)}
                  maxLength={160}
                  placeholder="例如：查看理财到期情况"
                  hint="1–160 字，只能单行"
                />
                <Field
                  label="提醒时间（北京时间）"
                  type="datetime-local"
                  value={when}
                  onChange={event => setWhen(event.target.value)}
                  hint="按北京时间填写，需在 15 秒后至未来 365 天内"
                />
                <div>
                  <Button variant="ink" icon={<BellIcon size={16} />} disabled={!!remindersError || remindersLoading} onClick={reviewReminder}>核对提醒</Button>
                </div>
              </div>
            )}
            {formError && (
              <p role="alert" className="mt-3 flex items-start gap-2 text-[13px] text-coral">
                <AlertIcon size={16} className="mt-0.5 shrink-0" />{formError}
              </p>
            )}

            </div>
            <section className="im-reminder-history" aria-label="提醒记录">
            <div className="im-history-heading"><h3 className="im-subheading">提醒记录</h3><Button size="sm" variant="ghost" aria-label="刷新提醒记录" loading={remindersLoading} icon={<RefreshIcon size={15} />} onClick={() => void loadReminders()}>刷新</Button></div>
            {truncated && <p className="mt-2 text-[12px] text-ink-mute">仅显示最近 100 条提醒。</p>}
            <div className="divide-y divide-line">
              {reminders.reminders.length === 0 ? (
                <div className="im-compact-empty im-history-empty"><span className="im-empty-icon"><BellIcon size={25} /></span><p>还没有提醒</p><small>设置一条提醒，把重要的事交给微信记住。</small></div>
              ) : reminders.reminders.map(reminder => (
                <div key={reminder.id} className="py-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-medium break-words text-ink">{reminder.title}</span>
                      <span className="mt-0.5 block text-[13px] text-ink-mute">{beijingTime(reminder.dueAt)}（北京时间）</span>
                    </span>
                    <Tag tone={STATUS_TONE[reminder.status] ?? 'neutral'}>
                      {STATUS_LABEL[reminder.status] ?? reminder.status}
                    </Tag>
                    {reminder.status === 'scheduled' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={!!remindersError || remindersLoading}
                        onClick={() => { setCancelTarget(reminder.id); setCancelError(null) }}
                      >
                        取消提醒
                      </Button>
                    )}
                  </div>
                  {reminder.errorCode === 'BOT_OFFLINE' && reminder.status === 'scheduled' && (
                    <p className="mt-2 text-[12px] text-ink-mute">机器人离线，等待恢复；尚未发送。</p>
                  )}
                  {cancelTarget === reminder.id && (
                    <div className="mt-3 rounded-field border border-line bg-sunk/60 p-3">
                      <p className="text-[13px] text-ink-soft">确认取消这条未发送的提醒？此操作不取消银行交易或商户订阅。</p>
                      <div className="mt-3 flex flex-wrap gap-3">
                        <Button size="sm" variant="danger" loading={cancelling} disabled={!!remindersError || remindersLoading} onClick={() => void cancelReminder(reminder.id)}>确认取消</Button>
                        <Button size="sm" variant="secondary" disabled={cancelling} onClick={() => setCancelTarget(null)}>保留提醒</Button>
                      </div>
                      {cancelError && (
                        <p role="alert" className="mt-3 flex items-start gap-2 text-[13px] text-coral">
                          <AlertIcon size={16} className="mt-0.5 shrink-0" />{cancelError}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
            </section>
            </div>
            <p className="im-reminder-footnote">保存不代表已发送，已提交微信不代表已读；提醒只发送本条内容，不查询账户或执行交易，解绑后旧提醒停止。</p>
          </>
        )}
      </Card>

      <Modal
        open={revokeTarget !== null}
        onClose={() => { if (!revoking) setRevokeTarget(null) }}
        title="解除 IM 绑定"
        description="解除后此私聊将无法查询或办理银行业务，已设置的旧提醒也会停止发送。"
        closeDisabled={revoking}
        footer={
          <>
            <Button block variant="secondary" disabled={revoking} onClick={() => setRevokeTarget(null)}>保留连接</Button>
            <Button block variant="danger" loading={revoking} onClick={() => void confirmRevoke()}>确认解除</Button>
          </>
        }
      >
        <p className="text-[14px] text-ink-soft">
          即将解除：<b className="font-medium break-words text-ink">{revokeTarget?.label}</b>
        </p>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-mute">
          重新绑定需要回到微信私聊发送「绑定」，使用机器人新回复的链接；不会自动恢复旧提醒。
        </p>
        {revokeError && (
          <p role="alert" className="mt-3 flex items-start gap-2 text-[13px] text-coral">
            <AlertIcon size={16} className="mt-0.5 shrink-0" />{revokeError}
          </p>
        )}
      </Modal>
    </div>
  )
}
