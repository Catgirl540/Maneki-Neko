import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { cancelImReminder, createImReminder, ImError, isImFeatureUnavailable, listImReminders, type ImReminder, type ImReminderList } from '@/api/im'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { Tag } from '@/components/ui/Segmented'

const timeLabel = (value: string) => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'short', hour12: false }).format(new Date(value))
const defaultTime = () => new Date(Date.now() + 3600000 + 8 * 3600000).toISOString().slice(0, 16)
const stateLabel: Record<ImReminder['status'], string> = { scheduled: '等待发送', sending: '正在发送', sent: '已发送', cancelled: '已取消', suppressed: '绑定已变更', expired: '已过期', failed: '发送失败', unknown: '发送结果待核实' }
type Draft = { title: string; dueAt: string; bindingId: string; requestId: string; bindingLabel: string }

/** One-time reminders always use a separate, explicit review before writing. */
export function ReminderManager({ initialTitle = '', initialTime = '', compact = false }: { initialTitle?: string; initialTime?: string; compact?: boolean }) {
  const bindingSelectId = useId()
  const [data, setData] = useState<ImReminderList | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<ImError | null>(null)
  const [title, setTitle] = useState(initialTitle)
  const [time, setTime] = useState(initialTime || defaultTime)
  const [binding, setBinding] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [cancelling, setCancelling] = useState<ImReminder | null>(null)
  const [busy, setBusy] = useState(false)
  const [operationError, setOperationError] = useState('')
  const [notice, setNotice] = useState('')
  const cancelRequest = useRef('')
  const load = useCallback(async () => {
    try {
      const result = await listImReminders()
      setData(result)
      setBinding(previous => result.bindings.some(item => item.id === previous) ? previous : result.bindings.length === 1 ? result.bindings[0].id : '')
      setError(null)
    } catch (cause) { setError(cause instanceof ImError ? cause : new ImError('提醒记录暂时无法加载', 0)) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  function review() {
    setNotice('')
    setOperationError('')
    const recipient = data?.bindings.find(item => item.id === binding)
    const clean = title.trim(), dueAt = `${time}:00+08:00`, timestamp = Date.parse(dueAt)
    if (!clean || clean.length > 160 || [...clean].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) return setOperationError('提醒内容须为 1–160 字的单行文字')
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(time) || !Number.isFinite(timestamp) || new Date(timestamp + 8 * 3600000).toISOString().slice(0, 16) !== time || timestamp < Date.now() + 15000 || timestamp > Date.now() + 365 * 86400000) return setOperationError('提醒时间须在 15 秒后至未来 365 天内，请按北京时间填写')
    if (!recipient) return setOperationError('请先连接本人的微信私聊，并选择接收微信')
    setDraft({ title: clean, dueAt, bindingId: recipient.id, bindingLabel: recipient.label, requestId: crypto.randomUUID() })
  }
  async function submit() {
    if (!draft || busy) return
    setBusy(true); setOperationError('')
    try {
      await createImReminder(draft)
      setDraft(null); setTitle(''); setNotice('提醒已创建，等待约定时间发送。'); await load()
    } catch (cause) { setOperationError(cause instanceof Error ? cause.message : '创建失败，请稍后重试') }
    finally { setBusy(false) }
  }
  async function cancel() {
    if (!cancelling || busy) return
    setBusy(true); setOperationError('')
    try {
      await cancelImReminder(cancelling.id, cancelRequest.current)
      setCancelling(null); setNotice('提醒已取消。'); await load()
    } catch (cause) { setOperationError(cause instanceof Error ? cause.message : '取消失败，请刷新记录后重试') }
    finally { setBusy(false) }
  }
  const body = <>
    {error && <div role="alert" className="im-reminder-alert"><p>{isImFeatureUnavailable(error) ? '微信提醒尚未启用，请稍后重试或联系客服。' : error.message}</p><Button size="sm" variant="ghost" onClick={() => { setLoading(true); void load() }}>重试加载提醒</Button></div>}
    {!data && loading && <p className="im-description">正在加载提醒记录…</p>}
    {data && <div className="im-reminders-layout">
      <form className="im-reminder-editor flex flex-col gap-4" onSubmit={event => { event.preventDefault(); review() }}>
        <h3 className="im-subheading">新建提醒</h3>
        <Field label="提醒内容" value={title} maxLength={160} onChange={event => { setTitle(event.target.value); setNotice('') }} placeholder="例如：核对下月订阅费用" />
        <Field label="提醒时间（北京时间）" type="datetime-local" value={time} onChange={event => setTime(event.target.value)} />
        <div><label className="mb-2 block text-[13px] font-medium text-ink-soft" htmlFor={bindingSelectId}>接收微信</label>
          <select id={bindingSelectId} className="im-reminder-select" value={binding} onChange={event => setBinding(event.target.value)} disabled={!data.bindings.length}>
            {!binding && <option value="">{data.bindings.length ? '请选择本人私聊' : '请先连接微信'}</option>}
            {data.bindings.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </div>
        {!data.bindings.length && <p className="im-description">连接本人微信后，可在这里设置一次性文字提醒。</p>}
        <Button type="submit" disabled={busy || !data.bindings.length || !!error}>核对提醒</Button>
      </form>
      <section className="im-reminder-history">
        <div className="im-history-heading"><h3 className="im-subheading">提醒记录</h3><Button size="sm" variant="ghost" onClick={() => { setLoading(true); void load() }} disabled={loading} aria-label="刷新提醒">刷新提醒</Button></div>
        {(data.truncated ?? data.historyMayBeTruncated) && <p className="im-description">仅显示最近 {data.limit ?? 100} 条提醒，较早记录未显示。</p>}
        {data.reminders.length === 0 && <p className="im-description">还没有设置提醒</p>}
        <div className="im-reminder-rows">{data.reminders.map(item => <article className="im-reminder-row" key={item.id}>
          <div className="im-reminder-row-main"><b>{item.title}</b><small>{timeLabel(item.dueAt)}（北京时间）</small>
            {item.errorCode === 'BOT_OFFLINE' && <small>机器人离线，尚未发送；服务恢复后将有限重试。</small>}
            {item.status === 'unknown' && <small>投递结果不确定，为避免重复发送不会自动重发。</small>}
            {item.status === 'suppressed' && <small>原微信绑定已变更，提醒已停止，不会转给新绑定。</small>}
          </div>
          <div className="im-reminder-row-actions"><Tag tone="neutral">{stateLabel[item.status] ?? '状态待核实'}</Tag>{item.status === 'scheduled' && <Button size="sm" variant="ghost" onClick={() => { cancelRequest.current = crypto.randomUUID(); setOperationError(''); setCancelling(item) }}>取消提醒</Button>}</div>
        </article>)}</div>
      </section>
    </div>}
    {operationError && !draft && !cancelling && <p role="alert" className="im-reminder-alert">{operationError}</p>}
    {notice && <p role="status" className="im-description">{notice}</p>}
    <p className="im-reminder-footnote">一次性文字提醒仅向已确认的本人微信发送，不查询账户或执行交易。换绑或解绑会使原提醒停止投递；发送成功表示渠道确认，不代表已读。</p>
    <Modal open={draft !== null} title="请核对这条提醒" onClose={() => { if (!busy) { setDraft(null); setOperationError('') } }} closeDisabled={busy} footer={<><Button variant="ghost" disabled={busy} onClick={() => { setDraft(null); setOperationError('') }}>返回修改</Button><Button disabled={busy} onClick={() => void submit()}>{busy ? '正在创建…' : '确认创建'}</Button></>}>
      {draft && <div className="flex flex-col gap-3 text-[14px]"><p className="break-words">{draft.title}</p><p>{timeLabel(draft.dueAt)}（北京时间）</p><p>接收：{draft.bindingLabel}</p><p className="text-ink-mute">仅发送这条文字提醒，不查询账户或执行交易。</p></div>}
      {operationError && <p role="alert" className="im-reminder-alert">{operationError}</p>}
    </Modal>
    <Modal open={cancelling !== null} title="取消这条提醒" onClose={() => { if (!busy) { setCancelling(null); setOperationError('') } }} closeDisabled={busy} footer={<><Button variant="ghost" disabled={busy} onClick={() => setCancelling(null)}>保留提醒</Button><Button disabled={busy} onClick={() => void cancel()}>{busy ? '正在取消…' : '确认取消'}</Button></>}>
      {cancelling && <p className="text-[14px] break-words">取消后将不再发送「{cancelling.title}」。</p>}
      {operationError && <p role="alert" className="im-reminder-alert">{operationError}</p>}
    </Modal>
  </>
  return compact ? <div className="im-page">{body}</div> : <Card className="im-reminders-card"><CardHeader title="提醒" />{body}</Card>
}
