import { useRef, useState } from 'react'
import { api } from '@/api'
import type { SplitCollection } from '@/api/types'
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
export function PaymentPlans({ tab, onBusyChange }: { tab: 'scheduled' | 'split'; onBusyChange: (busy: boolean) => void }) {
  return tab === 'scheduled'
    ? <ScheduledTransfers onBusyChange={onBusyChange} />
    : <SplitCollections onBusyChange={onBusyChange} />
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
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('')
  const [payment, setPayment] = useState({ collection: '', participant: '', transaction: '' })
  const [cancel, setCancel] = useState('')
  const requestKey = useRef({ fingerprint: '', key: '' })
  async function run(work: () => Promise<unknown>, success: string) { setBusy(true); onBusyChange(true); setMessage(''); try { await work(); if (success) setMessage(success); collections.reload() } catch (error) { setMessage(error instanceof Error ? error.message : '操作失败') } finally { setBusy(false); onBusyChange(false) } }
  function create() {
    const cents = parseAmountInput(amount)
    if (cents == null || cents <= 0) { setMessage('请输入有效金额，最多两位小数'); return }
    const request = { title, amount: cents, currency: 'CNY' as const, participants: names.split(/[,，\n]/).map(name => name.trim()).filter(Boolean) }
    const fingerprint = JSON.stringify(request)
    if (requestKey.current.fingerprint !== fingerprint) requestKey.current = { fingerprint, key: crypto.randomUUID() }
    void run(() => api.createSplitCollection({ ...request, clientRequestId: requestKey.current.key }), 'AA 单已创建；没有扣款或发送邀请。')
  }
  function remind(row: SplitCollection, participantId: string) {
    void run(async () => { const result = await api.remindSplitParticipant(row.id, { participantId, version: row.version }); setMessage(`${result.text} ${result.notice}`) }, '')
  }
  return <section className="mt-5 flex flex-col gap-4" aria-label="AA 收款管理"><p className="text-[13px] text-ink-mute">人民币均分至分，余数按名单顺序每人加 1 分。仅创建收款清单；回款需核对实际成功转入流水，催收文字请自行发送。</p>
    <form className="grid gap-4 md:grid-cols-2" onSubmit={event => { event.preventDefault(); create() }}><label className="text-[13px] text-ink-soft">收款事由<input required value={title} onChange={event => setTitle(event.target.value)} className={inputClass} maxLength={80} /></label><label className="text-[13px] text-ink-soft">待收总额（人民币元）<input required inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} className={inputClass} /></label><label className="text-[13px] text-ink-soft md:col-span-2">付款参与者姓名（逗号或换行分隔，不含已自付份额）<textarea required value={names} onChange={event => setNames(event.target.value)} className={inputClass + ' min-h-20 py-3'} /></label><div><Button type="submit" disabled={busy} variant="primary">创建 AA 收款单</Button></div></form>
    {message && <p role="status" className="whitespace-pre-wrap text-[13px] text-ink-soft">{message}</p>}
    {collections.error ? <DataUnavailable message={collections.error} onRetry={collections.reload} /> : !collections.data ? <DataLoading /> : collections.data.map(row => <article key={row.id} className="border-t border-line py-4"><p className="font-semibold">{row.title} · {formatCurrency(row.amount, row.currency)} · {row.status === 'open' ? '待收款' : row.status === 'complete' ? '已收齐' : '已取消'}</p><p className="mt-1 text-[13px] text-ink-mute">收款账户 {row.accountNo} · 已收 {row.participants.filter(item => item.status === 'paid').length}/{row.participants.length}</p><ul className="mt-3 flex flex-col gap-3">{row.participants.map(item => <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 text-[13px]"><span>{item.name} · {formatCurrency(item.amount, row.currency)} · {item.status === 'paid' ? '已核对到账' : '未确认'}</span>{row.status === 'open' && item.status === 'unpaid' && <div className="flex gap-2"><Button disabled={busy} onClick={() => remind(row, item.id)}>生成催收文字</Button><Button disabled={busy} onClick={() => setPayment({ collection: row.id, participant: item.id, transaction: '' })}>核对回款</Button></div>}</li>)}</ul>
      {payment.collection === row.id && <form className="mt-4 flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); void run(async () => { await api.confirmSplitPayment(row.id, { version: row.version, participantId: payment.participant, transactionId: payment.transaction }); setPayment({ collection: '', participant: '', transaction: '' }) }, '已核对该参与者回款') }}><label className="flex-1 text-[13px]">成功转入流水编号<input required value={payment.transaction} onChange={event => setPayment({ ...payment, transaction: event.target.value })} className={inputClass} /></label><Button type="submit" disabled={busy}>确认核对</Button><Button disabled={busy} onClick={() => setPayment({ collection: '', participant: '', transaction: '' })}>返回</Button></form>}
      {row.status === 'open' && <div className="mt-4">{cancel === row.id ? <><Button disabled={busy} onClick={() => void run(() => api.cancelSplitCollection(row.id, row.version), 'AA 单已取消，已到账款项不变')}>确认取消收款单</Button><Button onClick={() => setCancel('')}>保留</Button></> : <Button disabled={busy} variant="ghost" onClick={() => setCancel(row.id)}>取消收款单</Button>}</div>}
    </article>)}
  </section>
}
