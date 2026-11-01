import { AaPayables } from './AaPayments'
import { Segmented } from '@/components/ui/Segmented'
import { calculateSplitCollection } from '../../../../shared/split-collection.mjs'
import { useRef, useState } from 'react'
import { api } from '@/api'
import type { SplitCollection, SplitCollectionRequest, AaAllocation } from '@/api/types'
import { useAsync } from '@/lib/useAsync'
import { parseAmountInput } from '@/lib/amountInput'
import { formatCurrency } from '@/lib/format'
import { Button } from '@/components/ui/Button'
import { PinInput } from '@/components/ui/PinInput'
import { DataLoading, DataUnavailable } from '@/components/ui/DataUnavailable'

const inputClass = 'min-h-11 w-full rounded-field border border-line bg-surface px-3 text-[14px] text-ink'
const dateLabel = (iso: string) => new Date(iso).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
const scheduleStatus = { scheduled: '待执行', executed: '已执行', failed: '执行失败', cancelled: '已取消' }

/** Separate instructions from an immediate transfer so its confirmation remains unambiguous. */
export function PaymentPlans({ tab, onBusyChange }: { tab: 'scheduled' | 'split' | 'payable'; onBusyChange: (busy: boolean) => void }) {
  return tab === 'scheduled'
    ? <ScheduledTransfers onBusyChange={onBusyChange} />
    : tab === 'payable' ? <AaPayables onBusyChange={onBusyChange} /> : <SplitCollections onBusyChange={onBusyChange} />
}

function ScheduledTransfers({ onBusyChange }: { onBusyChange: (busy: boolean) => void }) {
  const accounts = useAsync(() => api.listAccounts(), [])
  const banks = useAsync(() => api.listBanks(), [])
  const schedules = useAsync(() => api.listScheduledTransfers(), [])
  const [name, setName] = useState(''), [number, setNumber] = useState(''), [bank, setBank] = useState('LCB')
  const [amount, setAmount] = useState(''), [date, setDate] = useState(''), [memo, setMemo] = useState(''), [password, setPassword] = useState('')
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [cancel, setCancel] = useState('')
  const requestKey = useRef({ fingerprint: '', key: '' })
  const account = accounts.data?.[0]
  async function create() {
    setBusy(true); onBusyChange(true); setMessage('')
    try {
      const cents = parseAmountInput(amount)
      if (!account || cents == null || cents <= 0 || !date || !confirmed) throw new Error('请完整填写指令并勾选授权确认')
      const request = { fromAccountId: account.id, channel: 'bank' as const, scope: 'domestic' as const, payeeName: name, payeeAccountNo: number, payeeBankCode: bank, payeeBankRegion: 'CN' as const, amount: cents, memo, executeAt: new Date(date + ':00+08:00').toISOString() }
      const fingerprint = JSON.stringify(request)
      if (requestKey.current.fingerprint !== fingerprint) requestKey.current = { fingerprint, key: crypto.randomUUID() }
      await api.createScheduledTransfer({ ...request, confirmed: true, paymentPassword: password, clientRequestId: requestKey.current.key })
      setPassword(''); setConfirmed(false); setMessage('定时转账已保存，请在待执行清单核对。'); schedules.reload()
    } catch (error) { setPassword(''); setMessage(error instanceof Error ? error.message : '保存失败') }
    finally { setBusy(false); onBusyChange(false) }
  }
  async function cancelSchedule(id: string, version: number) {
    setBusy(true); onBusyChange(true)
    try { await api.cancelScheduledTransfer(id, version); setCancel(''); schedules.reload() }
    catch (error) { setMessage(error instanceof Error ? error.message : '取消失败') }
    finally { setBusy(false); onBusyChange(false) }
  }
  const loadError = accounts.error || banks.error
  return <section className="mt-5 flex flex-col gap-4" aria-label="定时转账管理">
    <p className="text-[13px] text-ink-mute">境内银行账户同币种转账，手续费 0。时间为北京时间。保存后不冻结资金；到期按指令执行，余额不足会失败。大额转账仍经过风控在途窗口。跨境及换汇请届时重新询价。</p>
    {loadError ? <DataUnavailable message={loadError} onRetry={() => { accounts.reload(); banks.reload() }} /> : !account || !banks.data ? <DataLoading /> : <form onSubmit={event => { event.preventDefault(); void create() }} className="grid gap-4 md:grid-cols-2">
      <label className="text-[13px] text-ink-soft">收款人姓名<input required value={name} onChange={event => { setName(event.target.value); setConfirmed(false) }} className={inputClass} maxLength={80} /></label>
      <label className="text-[13px] text-ink-soft">收款银行<select value={bank} onChange={event => { setBank(event.target.value); setConfirmed(false) }} className={inputClass}>{banks.data.filter(item => item.region === 'CN').map(item => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label>
      <label className="text-[13px] text-ink-soft">完整收款账号<input required inputMode="numeric" value={number} onChange={event => { setNumber(event.target.value.replace(/\D/g, '')); setConfirmed(false) }} className={inputClass} maxLength={19} /></label>
      <label className="text-[13px] text-ink-soft">转账金额（{account.currency} 元）<input required inputMode="decimal" value={amount} onChange={event => { setAmount(event.target.value); setConfirmed(false) }} className={inputClass} /></label>
      <label className="text-[13px] text-ink-soft">执行时间（北京时间）<input required type="datetime-local" value={date} onChange={event => { setDate(event.target.value); setConfirmed(false) }} className={inputClass} /></label>
      <label className="text-[13px] text-ink-soft">转账备注<input value={memo} onChange={event => { setMemo(event.target.value); setConfirmed(false) }} className={inputClass} maxLength={140} /></label>
      <div className="md:col-span-2"><PinInput label="定时转账支付密码" value={password} onChange={setPassword} disabled={busy} className="max-w-[360px]" /></div>
      <label className="flex items-start gap-2 text-[13px] text-ink-soft md:col-span-2"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />我确认在上述北京时间，从本人 {account.currency} 余额向 {name || '指定收款人'} 的账号 {number || '（待填写）'} 自动转出 {amount || '0'} 元，并已核对银行、账号及金额。</label>
      <div><Button type="submit" variant="primary" disabled={busy || password.length !== 6 || !confirmed}>保存定时转账</Button></div>
    </form>}
    {message && <p role="status" className="text-[13px] text-ink-soft">{message}</p>}
    {schedules.error ? <DataUnavailable message={schedules.error} onRetry={schedules.reload} /> : !schedules.data ? <DataLoading /> : <div className="divide-y divide-line">{schedules.data.map(row => <article key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-4"><div><p className="font-medium">{row.payeeName} · {formatCurrency(row.amount, row.currency)} · {scheduleStatus[row.status]}</p><p className="text-[13px] text-ink-mute">{dateLabel(row.executeAt)} · 账号 {row.payeeAccountNo} · {row.memo}</p>{row.failureReason && <p role="alert" className="text-[13px] text-danger">{row.failureReason}</p>}{row.transactionId && <p className="text-[13px] text-ink-mute">交易编号 {row.transactionId} · {row.settlementStatus === 'pending' ? '转账处理中' : '已记账'}</p>}</div>{row.status === 'scheduled' && (cancel === row.id ? <div className="flex gap-2"><Button disabled={busy} onClick={() => void cancelSchedule(row.id, row.version)}>确认取消指令</Button><Button disabled={busy} onClick={() => setCancel('')}>保留</Button></div> : <Button disabled={busy} onClick={() => setCancel(row.id)}>取消定时转账</Button>)}</article>)}{!schedules.data.length && <p className="py-3 text-[13px] text-ink-mute">暂无定时转账。</p>}<Button variant="ghost" onClick={schedules.reload}>刷新执行状态</Button></div>}
  </section>
}

function SplitCollections({ onBusyChange }: { onBusyChange: (busy: boolean) => void }) {
  const collections = useAsync(() => api.listSplitCollections(), [])
  const [title, setTitle] = useState(''), [amount, setAmount] = useState(''), [names, setNames] = useState('')
  const [contacts, setContacts] = useState<Record<string, { phone?: string; memo?: string }>>({})
  const [review, setReview] = useState<SplitCollectionRequest | null>(null)
  const [mode, setMode] = useState<'items' | 'equal'>('items')
  const [collectorName, setCollectorName] = useState('')
  const [expenses, setExpenses] = useState([{ title: '', amount: '', names: '' }])
  const updateExpense = (index: number, field: 'title' | 'amount' | 'names', value: string) => setExpenses(rows => rows.map((row, i) => i === index ? { ...row, [field]: value } : row))
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('')
  const [payment, setPayment] = useState({ collection: '', participant: '', transaction: '' })
  const [cancel, setCancel] = useState('')
  const requestKey = useRef({ fingerprint: '', key: '' })
  async function run(work: () => Promise<unknown>, success: string) { setBusy(true); onBusyChange(true); setMessage(''); try { await work(); if (success) setMessage(success); collections.reload() } catch (error) { setMessage(error instanceof Error ? error.message : '操作失败') } finally { setBusy(false); onBusyChange(false) } }
  const parseNames = (value: string) => value.split(/[,，\n]/).map(name => name.trim()).filter(Boolean)
  const parseAmount = (value: string) => {
    const result = parseAmountInput(value)
    if (result == null || result <= 0) throw Error('请输入有效金额，最多两位小数')
    return result
  }
  function buildRequest(): AaAllocation {
    return mode === 'equal'
      ? { amount: parseAmount(amount), participants: parseNames(names) }
      : { collectorName, expenses: expenses.map(item => ({ title: item.title, amount: parseAmount(item.amount), participants: parseNames(item.names) })) }
  }
  let preview: ReturnType<typeof calculateSplitCollection> | undefined
  let previewError = ''
  try { preview = calculateSplitCollection(buildRequest()) } catch (error) { previewError = error instanceof Error ? error.message : '请补全消费信息' }
  function create() {
    try {
      const allocation = buildRequest(), calculated = calculateSplitCollection(allocation)
      if (!title.trim()) throw Error('请填写收款事由')
      const members = calculated.participants.map(person => {
        const phone = contacts[person.name]?.phone?.trim() ?? ''
        const memo = (contacts[person.name]?.memo ?? title).trim()
        if (!/^1[3-9]\d{9}$/.test(phone)) throw Error(`请填写${person.name}的 11 位注册手机号`)
        if (!memo || memo.length > 140) throw Error(`请填写${person.name}的转账备注，最多 140 字`)
        return { phone, amount: person.amount, memo }
      })
      if (new Set(members.map(person => person.phone)).size !== members.length) throw Error('成员手机号不能重复')
      const request = { title: title.trim(), currency: 'CNY' as const, allocation, members, confirmed: true as const, clientRequestId: '' }
      const fingerprint = JSON.stringify(request)
      if (requestKey.current.fingerprint !== fingerprint) requestKey.current = { fingerprint, key: crypto.randomUUID() }
      setReview({ ...request, clientRequestId: requestKey.current.key }); setMessage('')
    } catch (error) { setMessage(error instanceof Error ? error.message : '请检查输入') }
  }
  function remind(row: SplitCollection, participantId: string) {
    void run(async () => { const result = await api.remindSplitParticipant(row.id, { participantId, version: row.version }); setMessage(`${result.text} ${result.notice}`) }, '')
  }
  return <section className="mt-5 flex flex-col gap-4" aria-label="AA 收款管理"><p className="text-[13px] text-ink-mute">先填写消费与参加名单，系统自动计算每人应付金额；在均分清单中补全手机号和转账备注，核对后向对应账号发送付款通知。成员在「AA 付款 → 待付款」确认支付。</p>
    <h3 className="font-semibold">均分清单</h3>
    {!review && <Segmented value={mode} onChange={setMode} options={[{ value: 'items', label: '分项 AA' }, { value: 'equal', label: '待收金额均分' }]} />}
    {review?.members ? <div aria-label="确认 AA 收款通知" className="rounded-field border border-line p-4"><h3 className="font-semibold">{review.title}</h3>
      {review.members.map((person, index) => <div key={person.phone} className="border-b border-line py-3 text-[14px]"><p>{calculateSplitCollection(review.allocation!).participants[index].name} · {person.phone} · {formatCurrency(person.amount, review.currency)}</p><p className="whitespace-pre-wrap break-words">转账备注：{person.memo}</p></div>)}
      <p className="my-4 font-medium">待收总额 {formatCurrency(review.members.reduce((sum, person) => sum + person.amount, 0), review.currency)}</p>
      <div className="flex flex-wrap gap-3"><Button disabled={busy} variant="primary" onClick={() => void run(async () => { await api.createSplitCollection(review); setReview(null); setTitle(''); setAmount(''); setNames(''); setContacts({}); setExpenses([{ title: '', amount: '', names: '' }]) }, 'AA 收款已发起，付款通知已送达成员账号。')}>确认发送付款通知</Button><Button disabled={busy} onClick={() => setReview(null)}>返回修改</Button></div>
    </div> :
    <form className="grid gap-4 md:grid-cols-2" onSubmit={event => { event.preventDefault(); create() }}>
      <label className="text-[13px] text-ink-soft">收款事由<input required value={title} onChange={event => setTitle(event.target.value)} className={inputClass} maxLength={80} /></label>
      {mode === 'equal' ? <>
        <label className="text-[13px] text-ink-soft">待收总额（人民币元）<input required inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} className={inputClass} /></label>
        <label className="text-[13px] text-ink-soft md:col-span-2">付款参与者姓名（逗号或换行分隔，不含已自付份额）<textarea required value={names} onChange={event => setNames(event.target.value)} className={inputClass + ' min-h-20 py-3'} /></label>
      </> : <>
        <label className="text-[13px] text-ink-soft">本人完整姓名<input required maxLength={40} value={collectorName} onChange={event => setCollectorName(event.target.value)} className={inputClass} /></label>
        <p className="text-[13px] text-ink-mute md:col-span-2">适用于本人已垫付全部消费。每项填写完整消费金额和实际参加者（本人参加时也须写入），分别均摊后汇总每人应付金额，扣除本人份额。</p>
        {expenses.map((item, index) => <fieldset key={index} className="grid gap-3 rounded-field border border-line p-3 md:col-span-2 md:grid-cols-2"><legend>消费 {index + 1}</legend>
          <label className="text-[13px]">活动事由<input required maxLength={80} value={item.title} onChange={event => updateExpense(index, 'title', event.target.value)} className={inputClass} /></label>
          <label className="text-[13px]">消费全额（人民币元）<input required inputMode="decimal" value={item.amount} onChange={event => updateExpense(index, 'amount', event.target.value)} className={inputClass} /></label>
          <label className="text-[13px] md:col-span-2">本项参加者（逗号或换行分隔，本人参加时须包含）<textarea required value={item.names} onChange={event => updateExpense(index, 'names', event.target.value)} className={inputClass + ' min-h-20 py-3'} /></label>
          {expenses.length > 1 && <Button type="button" disabled={busy} onClick={() => setExpenses(rows => rows.filter((_, i) => i !== index))}>删除本项</Button>}
        </fieldset>)}
        <div><Button type="button" disabled={busy || expenses.length >= 30} onClick={() => setExpenses(rows => [...rows, { title: '', amount: '', names: '' }])}>添加消费</Button></div>
      </>}
      <div className="rounded-field bg-surface p-3 text-[13px] md:col-span-2" aria-live="polite">{preview ? <>
        {preview.expenses?.map((item, i) => <p key={i}>{item.title}：{item.shares.map(share => `${share.name} ${formatCurrency(share.amount, 'CNY')}`).join('；')}</p>)}
        {preview.selfAmount !== undefined && <p>消费合计 {formatCurrency(preview.expenseTotal!, 'CNY')} · 本人份额 {formatCurrency(preview.selfAmount, 'CNY')}</p>}
        <p>待收总额 {formatCurrency(preview.amount, 'CNY')}</p>
        {preview.participants.map(person => <fieldset key={person.name} className="mt-3 grid gap-3 rounded-field border border-line p-3 md:grid-cols-2"><legend>{person.name} 应付 {formatCurrency(person.amount, 'CNY')}</legend>
          <label>{person.name}手机号<input required inputMode="tel" maxLength={11} value={contacts[person.name]?.phone ?? ''} onChange={event => setContacts(rows => ({ ...rows, [person.name]: { ...rows[person.name], phone: event.target.value } }))} className={inputClass} /></label>
          <label>{person.name}转账备注<textarea aria-label={person.name + '转账备注'} required maxLength={140} value={contacts[person.name]?.memo ?? title.trim()} onChange={event => setContacts(rows => ({ ...rows, [person.name]: { ...rows[person.name], memo: event.target.value } }))} className={inputClass + ' min-h-20 py-3'} /></label>
        </fieldset>)}
      </> : previewError}</div>
      <div><Button type="submit" disabled={busy || !preview} variant="primary">核对并发起 AA 收款</Button></div>
    </form>}
    {message && <p role="status" className="whitespace-pre-wrap text-[13px] text-ink-soft">{message}</p>}
    {collections.error ? <DataUnavailable message={collections.error} onRetry={collections.reload} /> : !collections.data ? <DataLoading /> : collections.data.map(row => <article key={row.id} className="border-t border-line py-4"><p className="font-semibold">{row.title} · {formatCurrency(row.amount, row.currency)} · {row.status === 'open' ? '待收款' : row.status === 'complete' ? '已收齐' : '已取消'}</p><p className="mt-1 text-[13px] text-ink-mute">收款账户 {row.accountNo} · 已收 {row.participants.filter(item => item.status === 'paid').length}/{row.participants.length}</p>{row.expenses && <div className="mt-2 text-[13px] text-ink-mute"><p>消费合计 {formatCurrency(row.expenseTotal!, row.currency)} · 本人份额 {formatCurrency(row.selfAmount!, row.currency)}</p>{row.expenses.map((item, i) => <p key={i}>{item.title}：{item.shares.map(share => `${share.name} ${formatCurrency(share.amount, row.currency)}`).join('；')}</p>)}</div>}<ul className="mt-3 flex flex-col gap-3">{row.participants.map(item => <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 text-[13px]"><span>{item.splitName ?? item.name}{item.phone ? ` · ${item.phone}` : ''} · {formatCurrency(item.amount, row.currency)} · {{ paid: '已核对到账', unpaid: '待付款', processing: '付款处理中', cancelled: '已取消' }[item.status]}{item.memo && <span className="mt-1 block whitespace-pre-wrap break-words">转账备注：{item.memo}</span>}</span>{row.delivery !== 'account-inbox' && row.status === 'open' && item.status === 'unpaid' && <div className="flex gap-2"><Button disabled={busy} onClick={() => remind(row, item.id)}>生成催收文字</Button><Button disabled={busy} onClick={() => setPayment({ collection: row.id, participant: item.id, transaction: '' })}>核对回款</Button></div>}</li>)}</ul>
      {payment.collection === row.id && <form className="mt-4 flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); void run(async () => { await api.confirmSplitPayment(row.id, { version: row.version, participantId: payment.participant, transactionId: payment.transaction }); setPayment({ collection: '', participant: '', transaction: '' }) }, '已核对该参与者回款') }}><label className="flex-1 text-[13px]">成功转入流水编号<input required value={payment.transaction} onChange={event => setPayment({ ...payment, transaction: event.target.value })} className={inputClass} /></label><Button type="submit" disabled={busy}>确认核对</Button><Button disabled={busy} onClick={() => setPayment({ collection: '', participant: '', transaction: '' })}>返回</Button></form>}
      {row.status === 'open' && <div className="mt-4">{cancel === row.id ? <><Button disabled={busy} onClick={() => void run(() => api.cancelSplitCollection(row.id, row.version), 'AA 单已取消，已到账款项不变')}>确认取消收款单</Button><Button onClick={() => setCancel('')}>保留</Button></> : <Button disabled={busy} variant="ghost" onClick={() => setCancel(row.id)}>取消收款单</Button>}</div>}
    </article>)}
  </section>
}
