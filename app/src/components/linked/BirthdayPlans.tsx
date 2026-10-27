import { useId, useState } from 'react'
import { api } from '@/api'
import type { BirthdayPlan, BirthdayPlanDraft, BirthdayPlanPreview, Currency } from '@/api/types'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { Tag } from '@/components/ui/Segmented'
import { useAsync } from '@/lib/useAsync'
import { parseAmountInput } from '@/lib/amountInput'
import { formatAmount } from '@/lib/format'

const time = (value: string) => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'short', hour12: false }).format(new Date(value))
const statuses: Record<string, string> = { scheduled: '等待预留', reserved: '已预留', needs_funds: '待补足余额', awaiting_order: '待确认订购', awaiting_merchant: '等待商户接入', cancelled: '已取消', expired: '已过期', released: '已释放预留' }

export function BirthdayPlans() {
  const currencyId = useId()
  const plans = useAsync(() => api.listBirthdayPlans(), [])
  const accounts = useAsync(() => api.listAccounts(), [])
  const [contactName, setContactName] = useState('')
  const [relationship, setRelationship] = useState('配偶')
  const [eventDate, setEventDate] = useState('')
  const [amount, setAmount] = useState('1000')
  const [currency, setCurrency] = useState<Currency>('CNY')
  const [review, setReview] = useState<{ input: BirthdayPlanDraft; preview: BirthdayPlanPreview; requestId: string } | null>(null)
  const [action, setAction] = useState<{ operation: 'cancel' | 'order'; plan: BirthdayPlan } | null>(null)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  async function preview() {
    if (busy) return
    setError(''); setNotice('')
    const amountCents = parseAmountInput(amount)
    if (!amountCents) return setError('请输入大于零且最多两位小数的预留金额')
    const account = accounts.data?.flatMap(item => [item, ...(item.currencyBalances ?? [])]).find(item => item.currency === currency)
    if (!account) return setError('对应币种余额尚未开通，请先在账户页核对')
    const input = { contactName, relationship, eventDate, amountCents, currency, accountId: account.id }
    setBusy(true)
    try { setReview({ input, preview: await api.previewBirthdayPlan(input), requestId: crypto.randomUUID() }); setPassword('') }
    catch (cause) { setError(cause instanceof Error ? cause.message : '暂时无法核对计划') }
    finally { setBusy(false) }
  }
  async function create() {
    if (!review || busy) return
    if (!/^\d{6}$/.test(password)) return setError('请输入 6 位数字支付密码')
    setBusy(true); setError('')
    try {
      const result = await api.createBirthdayPlan({ ...review.input, confirmed: true, requestId: review.requestId, paymentPassword: password })
      setReview(null); setPassword(''); setNotice(result.reservation.status === 'held' ? '生日计划已建立，资金已预留。' : '生日计划已建立，请查看预留状态。')
      plans.reload(); accounts.reload(); window.dispatchEvent(new Event('luckycat:bank-updated'))
    } catch (cause) { setError(cause instanceof Error ? cause.message : '创建失败，请稍后重试') }
    finally { setBusy(false) }
  }
  async function performAction() {
    if (!action || busy) return
    setBusy(true); setError('')
    try {
      if (action.operation === 'cancel') await api.cancelBirthdayPlan(action.plan.id, { confirmed: true })
      else await api.confirmBirthdayOrder(action.plan.id, { confirmed: true })
      setNotice(action.operation === 'cancel' ? '计划已取消，已持有的预留金额已释放。' : '已确认订购待办；当前商户未接入，尚未创建真实订单，请到商户应用另行办理。')
      setAction(null); plans.reload(); accounts.reload(); window.dispatchEvent(new Event('luckycat:bank-updated'))
    } catch (cause) { setError(cause instanceof Error ? cause.message : '操作失败，请刷新后重试') }
    finally { setBusy(false) }
  }
  return <div className="flex flex-col gap-6">
    <Card><CardHeader title="生日联动计划" />
      <p className="mt-3 text-[13px] leading-6 text-ink-mute">保存您明确提供的联系人生日，为鲜花和蛋糕预留资金，并在生日前两天生成待确认订购事项。预留会减少可用余额；当前商户未接入，确认待办也不会自动下单或扣款。</p>
      <form className="mt-5 grid grid-cols-2 gap-4" onSubmit={event => { event.preventDefault(); void preview() }}>
        <Field label="生日联系人" value={contactName} maxLength={40} onChange={event => setContactName(event.target.value)} placeholder="请输入姓名" />
        <Field label="与本人的关系" value={relationship} maxLength={20} onChange={event => setRelationship(event.target.value)} />
        <Field label="本次生日日期" type="date" value={eventDate} onChange={event => setEventDate(event.target.value)} />
        <Field label="生日预留金额（元）" inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} />
        <div><label htmlFor={currencyId} className="mb-2 block text-[13px] text-ink-soft">预留币种</label><select id={currencyId} value={currency} onChange={event => setCurrency(event.target.value as Currency)} className="h-14 w-full rounded-field border border-line bg-surface px-4 text-[14px]">{(['CNY', 'USD', 'HKD'] as const).map(value => <option key={value} value={value}>{value}</option>)}</select></div>
        <div className="flex items-end"><Button type="submit" disabled={busy || accounts.loading || !!accounts.error}>核对生日计划</Button></div>
      </form>
      {accounts.error && <p role="alert" className="mt-4 text-[13px] text-coral">{accounts.error}</p>}
      {error && !review && !action && <p role="alert" className="mt-4 text-[13px] text-coral">{error}</p>}
      {notice && <p role="status" className="mt-4 text-[13px] text-ink-soft">{notice}</p>}
    </Card>
    <Card><CardHeader title="已有生日计划" action={<Button size="sm" variant="ghost" onClick={plans.reload} disabled={plans.loading || plans.refreshing}>刷新生日计划</Button>} />
      {plans.loading && <p className="mt-4 text-[13px] text-ink-mute">正在加载计划…</p>}
      {plans.error && <p role="alert" className="mt-4 text-[13px] text-coral">{plans.error}</p>}
      {plans.data?.length === 0 && <p className="mt-4 text-[13px] text-ink-mute">尚未建立生日计划</p>}
      <div className="mt-4 divide-y divide-line">{plans.data?.map(plan => <article key={plan.id} className="py-4">
        <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-[15px] font-medium">{plan.contactName} · {plan.eventDate}</h3><Tag tone="neutral">{statuses[plan.status] ?? '状态待核查'}</Tag></div>
        <p className="mt-2 text-[13px] text-ink-soft">{plan.currency} {formatAmount(plan.amountCents)} · {plan.reservation.status === 'held' ? '已冻结可用余额' : plan.reservation.status === 'released' ? '预留已释放' : '尚未冻结余额'}</p>
        <p className="mt-1 text-[12px] leading-6 text-ink-mute">预留：{time(plan.reserveAt)}；订购待办：{time(plan.orderAt)}（北京时间）</p>
        <p className="text-[12px] leading-6 text-ink-mute">鲜花、蛋糕 · 商户未接入 · 未创建真实订单</p>
        {!['cancelled', 'expired', 'released'].includes(plan.status) && <div className="mt-3 flex flex-wrap gap-2">
          {plan.order.status === 'awaiting_confirmation' && <Button size="sm" onClick={() => { setError(''); setAction({ operation: 'order', plan }) }}>查看订购待办</Button>}
          <Button size="sm" variant="ghost" onClick={() => { setError(''); setAction({ operation: 'cancel', plan }) }}>取消生日计划</Button>
        </div>}
      </article>)}</div>
    </Card>
    <Modal open={review !== null} title="确认生日预留计划" closeDisabled={busy} onClose={() => { if (!busy) { setReview(null); setPassword(''); setError('') } }} footer={<><Button variant="ghost" disabled={busy} onClick={() => { setReview(null); setPassword(''); setError('') }}>返回修改</Button><Button disabled={busy} onClick={() => void create()}>{busy ? '正在建立…' : '确认预留计划'}</Button></>}>
      {review && <div className="flex flex-col gap-3 text-[14px]"><p>{review.preview.contactName}（{review.preview.relationship}）· {review.preview.eventDate}</p><p>预留 {review.preview.currency} {formatAmount(review.preview.amountCents)}</p><p>开始预留：{time(review.preview.reserveAt)}（北京时间）</p><p>订购待办：{time(review.preview.orderAt)}（北京时间）</p><p className="text-[12px] leading-6 text-ink-mute">{review.preview.notice}</p><Field label="支付密码" type="password" inputMode="numeric" maxLength={6} value={password} autoComplete="off" onChange={event => setPassword(event.target.value.replace(/\D/g, ''))} /></div>}
      {error && <p role="alert" className="mt-3 text-[13px] text-coral">{error}</p>}
    </Modal>
    <Modal open={action !== null} title={action?.operation === 'cancel' ? '取消生日计划' : '确认订购待办'} closeDisabled={busy} onClose={() => { if (!busy) { setAction(null); setError('') } }} footer={<><Button variant="ghost" disabled={busy} onClick={() => setAction(null)}>返回</Button><Button disabled={busy} onClick={() => void performAction()}>{action?.operation === 'cancel' ? '确认取消并解冻' : '确认订购待办'}</Button></>}>
      <p className="text-[14px] leading-6">{action?.operation === 'cancel' ? `取消「${action.plan.contactName}」生日计划后，仅释放本计划已冻结的预留资金。` : '鲜花和蛋糕需要在商户应用中另行订购。当前银行尚未接入商户，此次确认只记录您的待办意愿，不生成订单、不消费预留资金。'}</p>
      {error && <p role="alert" className="mt-3 text-[13px] text-coral">{error}</p>}
    </Modal>
  </div>
}
