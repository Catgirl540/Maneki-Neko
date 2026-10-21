import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import {
  ImError,
  isImFeatureUnavailable,
  cancelImReminder,
  claimImCode,
  createImReminder,
  listImBindings,
  listImReminders,
  previewImCode,
  revokeImBinding,
  type ImBinding,
  type ImCodePreview,
  type ImReminderList,
} from '@/api/im'
import { PageHeader } from '@/components/layout/PageHeader'
import { WeixinQrBinding } from '@/components/im/WeixinQrBinding'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { DataUnavailable } from '@/components/ui/DataUnavailable'
import { Field } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { EmptyState, Skeleton, Tag } from '@/components/ui/Segmented'
import { AlertIcon, BellIcon } from '@/components/ui/icons'
import { useToast } from '@/components/ui/toast-context'

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
 * IM 连接（客户侧）。
 *
 * 只做「绑定本人 IM 私聊」与「微信日程提醒」两件事：机器人管理留在桥接服务，
 * IM 会话面板（`#session=`）也仍在旧门户——银行页面里不做对话，避免把
 * 确认与办理混进聊天窗口。
 *
 * @module app/pages/ImPage
 */
export function ImPage() {
  const toast = useToast()
  const location = useLocation()
  const bindingSelectId = useId()

  /* ── 绑定列表：与提醒一样要区分 404/503（桥接未启用 IM），所以不用 useAsync ── */
  const [bindingList, setBindingList] = useState<ImBinding[] | null>(null)
  const [bindingsError, setBindingsError] = useState<ImError | null>(null)
  const [bindingsLoading, setBindingsLoading] = useState(true)
  const loadBindings = useCallback(async () => {
    setBindingsLoading(true)
    try {
      setBindingList(await listImBindings())
      setBindingsError(null)
    } catch (error) {
      const failure = error instanceof ImError ? error : new ImError('IM 连接列表暂时无法加载', 0)
      if (failure.status === 404 || failure.status === 503) setBindingList(null)
      setBindingsError(failure)
    } finally {
      setBindingsLoading(false)
    }
  }, [])
  useEffect(() => { void loadBindings() }, [loadBindings])

  /* ── 提醒列表：要区分 503/404（未启用）与真正的失败，所以不用 useAsync ── */
  const [reminders, setReminders] = useState<ImReminderList | null>(null)
  const [remindersError, setRemindersError] = useState<ImError | null>(null)
  const [remindersLoading, setRemindersLoading] = useState(true)
  const loadReminders = useCallback(async () => {
    setRemindersLoading(true)
    try {
      const data = await listImReminders()
      setReminders(data)
      setRemindersError(null)
    } catch (error) {
      const failure = error instanceof ImError ? error : new ImError('提醒暂时无法加载，请稍后重试', 0)
      // 未启用是状态而不是错误：清掉旧列表，交给「尚未启用」的空态。
      if (failure.status === 404 || failure.status === 503) setReminders(null)
      setRemindersError(failure)
    } finally {
      setRemindersLoading(false)
    }
  }, [])
  useEffect(() => { void loadReminders() }, [loadReminders])
  const remindersDisabled = reminders === null && remindersError !== null
    && isImFeatureUnavailable(remindersError)

  /* ── 绑定码：核对 → 确认绑定 ──────────────────────────────────────── */
  const [code, setCode] = useState('')
  const [preview, setPreview] = useState<ImCodePreview | null>(null)
  const [codeError, setCodeError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [claiming, setClaiming] = useState(false)

  async function checkCode(value = code.trim()) {
    if (!value) {
      setCodeError('请粘贴或输入微信里收到的绑定码')
      return
    }
    setChecking(true)
    setCodeError(null)
    setPreview(null)
    try {
      setPreview(await previewImCode(value))
    } catch (error) {
      setCodeError(error instanceof ImError && error.status === 404 ? EXPIRED_CODE_HINT : messageOf(error, '核对失败，请稍后重试'))
    } finally {
      setChecking(false)
    }
  }

  async function claim() {
    if (!preview) {
      setCodeError('请先核对绑定来源')
      return
    }
    setClaiming(true)
    setCodeError(null)
    try {
      await claimImCode(code.trim())
      setPreview(null)
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

  /** 从微信里的链接打开（`#code=`）时预填并自动核对一次。 */
  const autoChecked = useRef(false)
  useEffect(() => {
    if (autoChecked.current) return
    const fromHash = new URLSearchParams(location.hash.replace(/^#/, '')).get('code')?.trim() ?? ''
    if (!fromHash) return
    autoChecked.current = true
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
  useEffect(() => {
    if (available.length === 0) {
      setBindingId('')
      return
    }
    setBindingId(previous => (available.some(item => item.id === previous) ? previous : available[0].id))
  }, [reminders]) // eslint-disable-line react-hooks/exhaustive-deps

  function reviewReminder() {
    const text = title.trim()
    const label = available.find(item => item.id === bindingId)?.label
    if (!text || text.length > 160) return setFormError('提醒内容须为 1–160 字的单行文字')
    if (hasControlChar(text)) return setFormError('提醒内容不能包含换行或控制字符')
    if (!label) return setFormError('请选择接收提醒的微信私聊')
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(when)) return setFormError('请选择提醒时间（北京时间）')
    setFormError(null)
    setDraft({ title: text, dueAt: `${when}:00+08:00`, bindingId, label, requestId: crypto.randomUUID() })
  }

  async function submitReminder() {
    if (!draft) {
      setFormError('请先核对提醒信息')
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
  const truncated = reminders?.truncated ?? reminders?.historyMayBeTruncated ?? false

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="IM 连接"
        description="绑定本人微信/企微私聊，并按北京时间设置提醒；提醒只发消息，不查询账户、不执行交易。"
      />

      <WeixinQrBinding onBound={async () => { await loadBindings(); await loadReminders() }} />

      {serviceUnavailable && <DataUnavailable
        message="IM 服务暂时不可用，连接与提醒状态尚未确认。请稍后重试。"
        onRetry={() => { void loadBindings(); void loadReminders() }}
      />}

      <Card className="float-up">
        <CardHeader
          title="私聊绑定"
          action={bindingCount > 0 ? <span className="text-[13px] text-ink-mute">共 {bindingCount} 个私聊</span> : undefined}
        />
        <p className="mt-3 text-[13px] leading-relaxed text-ink-soft">
          绑定本人微信/企微私聊后，可在登录有效期内查询本人信息；转账等写操作仍需在银行页面单独确认。
          登录密码、支付密码不在 IM 对话里填写。
        </p>

        <div className="mt-5 rounded-card border border-line bg-sunk/60 p-4 sm:p-5">
          <p className="text-[14px] font-medium text-ink">绑定新的 IM 私聊</p>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-mute">
            在微信里给机器人发送「绑定」，打开回复里的链接（带 #code=）会自动填好绑定码；绑定码十分钟有效，用完即失效。
          </p>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="min-w-0 sm:flex-1">
              <Field
                label="绑定码"
                value={code}
                onChange={event => { setCode(event.target.value); setPreview(null); setCodeError(null) }}
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
              <p className="mt-1 text-[12px] text-ink-soft">
                有效至 {beijingTime(preview.expiresAt)}（北京时间）。请确认这是您正在使用的 IM 私聊。
              </p>
              <Button variant="primary" size="sm" className="mt-3" loading={claiming} onClick={() => void claim()}>
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

        <div className="mt-5">
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
            <EmptyState
              title="还没有绑定 IM 私聊"
              description="在微信里给机器人发送「绑定」，打开回复里的链接即可回到这里完成绑定。"
            />
          ) : (
            <div className="divide-y divide-line">
              {bindingList?.map(binding => (
                <div key={binding.id} className="flex flex-wrap items-center gap-3 py-4">
                  <span className="grid size-10 shrink-0 place-items-center rounded-chip bg-gold-tint text-gold-deep">
                    <BellIcon size={18} />
                  </span>
                  <span className="min-w-0 flex-1 text-[15px] font-medium break-words text-ink">{binding.label}</span>
                  <Tag tone={binding.connected ? 'gold' : 'neutral'}>
                    {binding.connected ? '已连接' : '请回到 IM 获取新绑定码'}
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
      </Card>

      <Card className="float-up" style={{ animationDelay: '70ms' }}>
        <CardHeader
          title="提醒"
          action={<span className="text-[13px] text-ink-mute">按北京时间发送</span>}
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
            <p className="mt-3 text-[12px] leading-relaxed text-ink-mute">
              保存不代表已发送，已提交微信不代表已读；提醒只发送本条内容，不查询账户或执行交易，解绑后旧提醒停止。
            </p>
            {truncated && <p className="mt-2 text-[12px] text-ink-mute">仅显示最近 100 条提醒。</p>}

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
                  <Button variant="primary" size="sm" loading={creating} onClick={() => void submitReminder()}>确认创建</Button>
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
                  <Button variant="primary" onClick={reviewReminder}>核对提醒</Button>
                </div>
              </div>
            )}
            {formError && (
              <p role="alert" className="mt-3 flex items-start gap-2 text-[13px] text-coral">
                <AlertIcon size={16} className="mt-0.5 shrink-0" />{formError}
              </p>
            )}

            <div className="mt-5 divide-y divide-line">
              {reminders.reminders.length === 0 ? (
                <EmptyState
                  title="还没有提醒"
                  description="设置一条提醒后，会在约定时间发送到您绑定的微信私聊。"
                />
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
                        <Button size="sm" variant="danger" loading={cancelling} onClick={() => void cancelReminder(reminder.id)}>确认取消</Button>
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
