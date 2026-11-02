import { AaPayables } from './AaPayments'
import { Segmented } from '@/components/ui/Segmented'
import { calculateSplitCollection } from '../../../../shared/split-collection.mjs'
import { useEffect, useRef, useState } from 'react'
import { api } from '@/api'
import type { SplitCollection, SplitCollectionRequest, AaAllocation, SplitIdentity } from '@/api/types'
import { useAsync } from '@/lib/useAsync'
import { parseAmountInput } from '@/lib/amountInput'
import { formatCurrency } from '@/lib/format'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import { PlusIcon } from '@/components/ui/icons'
import { useSession } from '@/store/session-context'
import { nameMatches } from '../../../../shared/aa-payments.mjs'
import { PinInput } from '@/components/ui/PinInput'
import { DataLoading, DataUnavailable } from '@/components/ui/DataUnavailable'

const inputClass = 'min-h-11 w-full rounded-field border border-line bg-surface px-3 text-[14px] text-ink'
// 表格里的输入框不要每格都描边，靠行分隔线区分即可；聚焦时才提示边界。
/**
 * 金额输入只收数字：与转账页同一套口径（最多两位小数），但**在输入时就过滤**，
 * 而不是等提交才报错——AA 表单里直接敲进字母会让人以为填好了。
 */
const filterAmount = (raw: string) => {
  const cleaned = raw.replace(/[^\d.]/g, '')
  const [whole = '', ...rest] = cleaned.split('.')
  if (!rest.length) return whole.slice(0, 9)
  // 小数点的写法统一成 0.5，不留下 ".5" 这种容易被当成笔误的形态。
  return `${whole.slice(0, 9) || '0'}.${rest.join('').slice(0, 2)}`
}

const tableInput = 'h-9 w-full min-w-0 rounded-field border border-transparent bg-transparent px-2 text-[13px] text-ink outline-none transition-colors placeholder:text-ink-mute hover:border-line focus:border-gold focus:bg-surface'
// 表格外的独立字段（收款事由、金额）仍需常规描边：表格内的输入靠行分隔线区分，这两处没有。
const fieldInput = 'h-11 w-full min-w-0 rounded-field border border-line bg-surface px-3 text-[14px] text-ink outline-none transition-colors placeholder:text-ink-mute focus:border-gold'
/** 参与者身份行：姓名 + 手机号或本行账号（二者填一个）。 */
interface PersonRow { id: string; name: string; identity: string }
/** 消费行：事由 + 全额 + 勾选的参加者（用参与者行的 id，而不是名字）。 */
interface ExpenseRow { id: string; title: string; amount: string; memberIds: string[] }
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
  // 通讯录与转账页共用一份：这里只读，发起 AA 成功时后端会把这个成员记进去。
  const contacts = useAsync(() => api.listPayees(), [])
  const [title, setTitle] = useState(''), [amount, setAmount] = useState('')
  // 参与者一律以「姓名 + 手机号或账号」录入：只写名字无法区分同名的人，也无法确定钱发给谁。
  const [people, setPeople] = useState<PersonRow[]>([{ id: crypto.randomUUID(), name: '', identity: '' }])
  const [review, setReview] = useState<SplitCollectionRequest | null>(null)
  // 转账备注逐人可改：默认等于收款事由，改了就用改过的。键用手机号/账号，避免同名串台。
  const [memos, setMemos] = useState<Record<string, string>>({})
  // 默认均分：大多数 AA 就是「一共多少钱、几个人平摊」，分项只在真有多项活动时才用。
  const [mode, setMode] = useState<'items' | 'equal'>('equal')
  const [expenses, setExpenses] = useState<ExpenseRow[]>([{ id: crypto.randomUUID(), title: '', amount: '', memberIds: [] }])
  const updateExpense = (index: number, patch: Partial<ExpenseRow>) => setExpenses(rows => rows.map((row, i) => i === index ? { ...row, ...patch } : row))
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('')
  const [payment, setPayment] = useState({ collection: '', participant: '', transaction: '' })
  const [cancel, setCancel] = useState('')
  const requestKey = useRef({ fingerprint: '', key: '' })
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible' && !busy && !collections.loading && !collections.refreshing) collections.reload()
    }
    const timer = window.setInterval(refresh, 5000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [busy, collections.loading, collections.refreshing, collections.reload])
  async function run(work: () => Promise<unknown>, success: string) { setBusy(true); onBusyChange(true); setMessage(''); try { await work(); if (success) setMessage(success); collections.reload() } catch (error) { setMessage(error instanceof Error ? error.message : '操作失败') } finally { setBusy(false); onBusyChange(false) } }
  // 发起人就是收款人：后端记的是当前登录用户，没必要让用户再选一次「我是谁」。
  // 参与者表里姓名与本人户名一致的那行就是本人；不在表里说明这次本人不参加，自付份额为 0。
  const { user } = useSession()
  const selfRow = people.find(person => person.name.trim() && nameMatches(person.name, user))
  const personById = (id: string) => people.find(person => person.id === id)
  /** 把当前这一行存进通讯录，之后转账和 AA 都能选到。 */
  async function saveContact(person: PersonRow) {
    try {
      const identity = toIdentity(person)
      await api.addPayee(identity)
      contacts.reload(); setMessage(`已把 ${identity.name} 存入收款人通讯录。`)
    } catch (error) { setMessage(error instanceof Error ? error.message : '保存失败') }
  }
  /** 把一行参与者转成「姓名 + 手机号或账号」，同时校验格式。 */
  const toIdentity = (row: PersonRow): SplitIdentity => {
    const name = row.name.trim()
    const digits = row.identity.replace(/\D/g, '')
    if (!name) throw Error('请填写参与者姓名')
    if (!digits) throw Error(`请填写${name}的手机号或本行账号`)
    if (digits.length > 11 && !/^\d{12,19}$/.test(digits)) throw Error(`${name}的账号须为 12 至 19 位数字`)
    if (digits.length <= 11 && !/^1[3-9]\d{9}$/.test(digits)) throw Error(`${name}的手机号须为 11 位`)
    return { name, ...(digits.length > 11 ? { accountNo: digits } : { phone: digits }) }
  }
  const parseAmount = (value: string) => {
    const result = parseAmountInput(value)
    if (result == null || result <= 0) throw Error('请输入有效金额，最多两位小数')
    return result
  }
  function buildRequest(): AaAllocation {
    if (mode === 'equal') return { amount: parseAmount(amount), participants: people.map(toIdentity) }
    if (!selfRow) throw Error(`参与者表里要有一位是你本人（${user?.name ?? '当前账户户名'}）`)
    return {
      collectorName: toIdentity(selfRow),
      expenses: expenses.map(item => {
        if (!item.memberIds.length) throw Error('每项消费至少要选一位参与者')
        return { title: item.title, amount: parseAmount(item.amount), participants: item.memberIds.map(id => toIdentity(personById(id) ?? (() => { throw Error('参加者已不存在，请重新选择') })())) }
      }),
    }
  }
  let preview: ReturnType<typeof calculateSplitCollection> | undefined
  let previewError = ''
  try { preview = calculateSplitCollection(buildRequest()) } catch (error) { previewError = error instanceof Error ? error.message : '请补全消费信息' }
  function create() {
    try {
      const allocation = buildRequest(), calculated = calculateSplitCollection(allocation)
      if (!title.trim()) throw Error('请填写收款事由')
      // 成员表直接由分摊结果生成：身份来自同一批输入，不会再出现「算账一个名字、发钱另一个账号」。
      const members = calculated.participants.map(person => {
        const key = person.accountNo ?? person.phone ?? ''
        // 转账备注默认与收款事由一致，可在下方逐人修改。
        const memo = (memos[key] ?? title).trim()
        if (!memo || memo.length > 140) throw Error(`请填写${person.name}的转账备注，最多 140 字`)
        return { name: person.name, ...(person.phone ? { phone: person.phone } : {}), ...(person.accountNo ? { accountNo: person.accountNo } : {}), amount: person.amount, memo }
      })
      const keys = members.map(person => person.accountNo ?? person.phone)
      if (new Set(keys).size !== members.length) throw Error('同一位成员不能重复填写')
      const request = { title: title.trim(), currency: 'CNY' as const, allocation, members, confirmed: true as const, clientRequestId: '' }
      const fingerprint = JSON.stringify(request)
      if (requestKey.current.fingerprint !== fingerprint) requestKey.current = { fingerprint, key: crypto.randomUUID() }
      setReview({ ...request, clientRequestId: requestKey.current.key }); setMessage('')
    } catch (error) { setMessage(error instanceof Error ? error.message : '请检查输入') }
  }
  function remind(row: SplitCollection, participantId: string) {
    void run(async () => { const result = await api.remindSplitParticipant(row.id, { participantId, version: row.version }); setMessage(`${result.text} ${result.notice}`) }, '')
  }
  return <section className="mt-5 flex flex-col gap-4" aria-label="AA 收款管理">
    <h3 className="font-semibold">均分清单</h3>
    {/* 先选分摊方式，再填这一次的收款信息：两种方式共用「收款事由」，均分模式多一个待收总额。 */}
    {!review && <Segmented value={mode} onChange={setMode} options={[{ value: 'equal', label: '待收金额均分' }, { value: 'items', label: '分项 AA' }]} />}
    {!review && <div className="overflow-hidden rounded-field border border-line">
      <div className="border-b border-line bg-sunk px-4 py-3"><h3 className="text-[14px] font-semibold text-ink">{mode === 'equal' ? '收款信息' : '收款事由'}</h3></div>
      <div className={mode === 'equal' ? 'grid gap-4 px-4 py-3 md:grid-cols-2' : 'px-4 py-3'}>
        <label className="text-[13px] text-ink-soft">收款事由<input required value={title} onChange={event => setTitle(event.target.value)} className={fieldInput} maxLength={80} /></label>
        {mode === 'equal' && <label className="text-[13px] text-ink-soft">待收总额（人民币元）<input required inputMode="decimal" aria-label="待收总额（人民币元）" value={amount} onChange={event => setAmount(filterAmount(event.target.value))} placeholder="0.00" className={fieldInput + ' num tabular-nums'} /></label>}
      </div>
    </div>}
    {review?.members ? <div aria-label="确认 AA 收款通知" className="overflow-hidden rounded-field border border-line">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line bg-sunk px-4 py-3"><h3 className="text-[14px] font-semibold text-ink">{review.title}</h3><p className="text-[13px] text-ink-soft">共 {review.members.length} 人 · 待收总额 <span className="font-semibold text-ink">{formatCurrency(review.members.reduce((sum, person) => sum + person.amount, 0), review.currency)}</span></p></div>
      <table aria-label="待发送的 AA 收款通知" className="w-full border-collapse text-[13px]"><thead className="bg-surface text-left text-[12px] text-ink-mute"><tr className="border-b border-line"><th scope="col" className="w-[18%] px-4 py-2.5 font-medium">姓名</th><th scope="col" className="w-[30%] px-4 py-2.5 font-medium">手机号 / 本行账号</th><th scope="col" className="w-[16%] px-4 py-2.5 text-right font-medium">应付</th><th scope="col" className="px-4 py-2.5 font-medium">转账备注</th></tr></thead><tbody>
        {review.members.map(person => <tr key={person.phone ?? person.accountNo} className="border-b border-line last:border-0"><td className="px-4 py-2.5 font-medium text-ink">{person.name}</td><td className="px-4 py-2.5 tabular-nums text-ink-soft">{person.phone ?? person.accountNo}</td><td className="whitespace-nowrap px-4 py-2.5 text-right text-[14px] font-semibold tabular-nums text-ink">{formatCurrency(person.amount, review.currency)}</td><td className="px-4 py-2.5 text-ink-soft"><span className="line-clamp-2 break-words">{person.memo}</span></td></tr>)}
      </tbody></table>
      <div className="flex flex-wrap gap-3 border-t border-line px-4 py-3"><Button disabled={busy} variant="primary" onClick={() => void run(async () => { await api.createSplitCollection(review); setReview(null); setTitle(''); setAmount(''); setMemos({}); setPeople([{ id: crypto.randomUUID(), name: '', identity: '' }]); setExpenses([{ id: crypto.randomUUID(), title: '', amount: '', memberIds: [] }]) }, 'AA 收款已发起，付款通知已送达成员账号。')}>确认发送付款通知</Button><Button disabled={busy} onClick={() => setReview(null)}>返回修改</Button></div>
    </div> :
    <form className="flex flex-col gap-4" onSubmit={event => { event.preventDefault(); create() }}>
      {/* 通讯录数据源：姓名格用 <input list> 关联，选中的成员会带出手机号或账号。 */}
      <datalist id="aa-contacts">{(contacts.data ?? []).map(item => <option key={item.id} value={item.name}>{item.phone ?? item.accountNo ?? ''}</option>)}</datalist>
      {/* 参与者身份表：姓名 + 手机号或本行账号。两张模式复用同一张表，参加者从这里勾选。 */}
      <div className="overflow-hidden rounded-field border border-line">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line bg-sunk px-4 py-3"><h3 className="text-[14px] font-semibold text-ink">参与者身份</h3><p className="text-[12px] text-ink-mute">姓名须与账户户名一致；手机号或本行账号填一个即可</p></div>
        <table aria-label="参与者身份" className="w-full border-collapse text-[13px]">
          <thead className="text-left text-[12px] text-ink-mute"><tr className="border-b border-line"><th scope="col" className="w-16 whitespace-nowrap px-4 py-2.5 font-medium">序号</th><th scope="col" className="w-[26%] px-4 py-2.5 font-medium">姓名</th><th scope="col" className="px-4 py-2.5 font-medium">手机号或本行账号</th><th scope="col" className="w-16 px-4 py-2.5 font-medium"><span className="sr-only">操作</span></th></tr></thead>
          <tbody>{people.map((person, index) => <tr key={person.id} className="border-b border-line transition-colors last:border-0 hover:bg-sunk/60 focus-within:bg-gold-tint/40">
            <td className="px-4 py-2 tabular-nums text-ink-mute">{index + 1}</td>
            <td className="px-4 py-2"><div className="flex items-center gap-2">
              <input aria-label={`第 ${index + 1} 位参与者姓名`} list="aa-contacts" maxLength={40} placeholder="与账户户名一致" value={person.name} onChange={event => {
                const value = event.target.value
                const hit = (contacts.data ?? []).find(item => item.name === value)
                setPeople(rows => rows.map(row => row.id === person.id ? { ...row, name: value, ...(hit && !row.identity ? { identity: hit.phone ?? hit.accountNo ?? '' } : {}) } : row))
              }} className={tableInput} />
              {person.id === selfRow?.id && <span className="shrink-0 rounded-chip bg-gold-tint px-1.5 py-0.5 text-[11px] text-ink">本人</span>}
              {person.name.trim() && person.id !== selfRow?.id && !(contacts.data ?? []).some(item => item.name === person.name.trim())
                ? <button type="button" disabled={busy} aria-label={`把${person.name}存入通讯录`} title="存入收款人通讯录" onClick={() => void saveContact(person)} className="shrink-0 rounded-chip px-1.5 py-0.5 text-[11px] text-ink-soft transition-colors hover:bg-sunk hover:text-ink disabled:text-ink-mute">存</button>
                : null}
            </div></td>
            <td className="px-4 py-2"><input aria-label={`第 ${index + 1} 位参与者手机号或本行账号`} inputMode="numeric" maxLength={19} placeholder="11 位手机号或 12–19 位账号" value={person.identity} onChange={event => setPeople(rows => rows.map(row => row.id === person.id ? { ...row, identity: event.target.value.replace(/\D/g, '') } : row))} className={tableInput + ' tabular-nums'} /></td>
            <td className="px-4 py-2 text-right">{people.length > 1 && <button type="button" disabled={busy} onClick={() => { setPeople(rows => rows.filter(row => row.id !== person.id)); setExpenses(rows => rows.map(row => ({ ...row, memberIds: row.memberIds.filter(id => id !== person.id) }))) }} className="whitespace-nowrap rounded-chip px-2 py-1 text-[12px] text-coral transition-colors hover:bg-coral-wash disabled:text-ink-mute">删除</button>}</td>
          </tr>)}</tbody>
        </table>
        <div className="border-t border-line px-4 py-3"><Button type="button" size="sm" variant="ghost" aria-label="添加参与者" title="添加参与者" disabled={busy || people.length >= 30} onClick={() => setPeople(rows => [...rows, { id: crypto.randomUUID(), name: '', identity: '' }])}><PlusIcon className="h-4 w-4" /></Button></div>
      </div>
      {mode === 'equal' ? <>
      </> : <>
        <div className="overflow-hidden rounded-field border border-line">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line bg-sunk px-4 py-3"><h3 className="text-[14px] font-semibold text-ink">消费明细</h3><p className="text-[12px] text-ink-mute">每项独立均摊，再汇总每人应付并扣除本人份额</p></div>
          <table aria-label="消费明细" className="w-full border-collapse text-[13px]">
            <thead className="text-left text-[12px] text-ink-mute"><tr className="border-b border-line"><th scope="col" className="w-16 whitespace-nowrap px-4 py-2.5 font-medium">序号</th><th scope="col" className="w-[30%] px-4 py-2.5 font-medium">消费事由</th><th scope="col" className="w-[16%] px-4 py-2.5 text-right font-medium">全额（元）</th><th scope="col" className="px-4 py-2.5 font-medium">参加者</th><th scope="col" className="w-16 px-4 py-2.5 font-medium"><span className="sr-only">操作</span></th></tr></thead>
            <tbody>{expenses.map((item, index) => <tr key={item.id} className="border-b border-line align-top transition-colors last:border-0 hover:bg-sunk/60 focus-within:bg-gold-tint/40">
              <td className="px-4 py-2 tabular-nums text-ink-mute">{index + 1}</td>
              <td className="px-4 py-2"><input aria-label={`第 ${index + 1} 项消费事由`} maxLength={80} value={item.title} onChange={event => updateExpense(index, { title: event.target.value })} placeholder="聚餐、打车…" className={tableInput} /></td>
              <td className="px-4 py-2"><input aria-label={`第 ${index + 1} 项消费全额（人民币元）`} inputMode="decimal" value={item.amount} onChange={event => updateExpense(index, { amount: filterAmount(event.target.value) })} placeholder="0.00" className={tableInput + ' text-right tabular-nums'} /></td>
              <td className="px-4 py-2"><div role="group" aria-label={`第 ${index + 1} 项消费的参加者`} className="flex flex-wrap gap-1.5 py-1">{people.map(person => {
                const checked = item.memberIds.includes(person.id)
                return <label key={person.id} className={cn('cursor-pointer rounded-chip border px-2 py-1 text-[12px] transition-colors', checked ? 'border-gold bg-gold-tint text-ink' : 'border-line text-ink-soft hover:border-line-strong')}>
                  <input type="checkbox" className="sr-only" checked={checked} disabled={busy || !person.name} onChange={() => updateExpense(index, { memberIds: checked ? item.memberIds.filter(id => id !== person.id) : [...item.memberIds, person.id] })} />
                  {person.name || '未命名'}
                </label>
              })}</div></td>
              <td className="px-4 py-2 text-right">{expenses.length > 1 && <button type="button" disabled={busy} onClick={() => setExpenses(rows => rows.filter((_, i) => i !== index))} className="whitespace-nowrap rounded-chip px-2 py-1 text-[12px] text-coral transition-colors hover:bg-coral-wash disabled:text-ink-mute">删除</button>}</td>
            </tr>)}</tbody>
          </table>
          <div className="border-t border-line px-4 py-3"><Button type="button" size="sm" variant="ghost" aria-label="添加消费" title="添加消费" disabled={busy || expenses.length >= 30} onClick={() => setExpenses(rows => [...rows, { id: crypto.randomUUID(), title: '', amount: '', memberIds: [] }])}><PlusIcon className="h-4 w-4" /></Button></div>
        </div>
      </>}
      {preview && <div className="overflow-hidden rounded-field border border-line" aria-live="polite">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line bg-sunk px-4 py-3">
          <h3 className="text-[14px] font-semibold text-ink">参与人清单</h3>
          {preview ? <p className="text-[13px] text-ink-soft">共 {preview.participants.length} 人 · 待收 {formatCurrency(preview.amount, 'CNY')}{preview.selfAmount !== undefined && <> · 本人份额 {formatCurrency(preview.selfAmount, 'CNY')}</>}</p> : <p role="alert" className="text-[13px] text-coral">{previewError}</p>}
        </div>
        {preview.expenses && preview.expenses.length > 0 && <p className="border-b border-line px-4 py-2 text-[12px] text-ink-mute">消费合计 {formatCurrency(preview.expenseTotal!, 'CNY')}：{preview.expenses.map(item => `${item.title} ${item.shares.map(share => `${share.name} ${formatCurrency(share.amount, 'CNY')}`).join('／')}`).join('；')}</p>}
          <table aria-label="AA 参与人清单" className="w-full border-collapse text-[13px]">
            <caption className="sr-only">AA 参与人清单：每位参与人的身份与应付金额</caption>
            <thead className="bg-surface text-left text-[12px] text-ink-mute">
              <tr className="border-b border-line">
                <th scope="col" className="w-[26%] px-4 py-2.5 font-medium">姓名</th>
                <th scope="col" className="w-[34%] px-4 py-2.5 font-medium">手机号 / 本行账号</th>
                <th scope="col" className="w-[18%] px-4 py-2.5 text-right font-medium">应付</th>
                <th scope="col" className="px-4 py-2.5 font-medium">备注</th>
              </tr>
            </thead>
            <tbody>
              {preview.participants.map(person => <tr key={person.accountNo ?? person.phone} className="border-b border-line last:border-0">
                <td className="px-4 py-2.5 font-medium text-ink">{person.name}</td>
                <td className="px-4 py-2.5 tabular-nums text-ink-soft">{person.phone ?? person.accountNo}</td>
                <td className="whitespace-nowrap px-4 py-2.5 text-right text-[14px] font-semibold tabular-nums text-ink">{formatCurrency(person.amount, 'CNY')}</td>
                <td className="px-4 py-2"><input aria-label={`${person.name}转账备注`} maxLength={140} placeholder={title.trim() || '转账备注'} value={memos[person.accountNo ?? person.phone ?? ''] ?? title} onChange={event => setMemos(rows => ({ ...rows, [person.accountNo ?? person.phone ?? '']: event.target.value }))} className={tableInput} /></td>
              </tr>)}
            </tbody>
        </table>
      </div>}
      <div><Button type="submit" disabled={busy || !preview} variant="primary">核对并发起 AA 收款</Button></div>
    </form>}
    {message && <p role="status" className="whitespace-pre-wrap text-[13px] text-ink-soft">{message}</p>}
    <div className="flex items-center justify-between gap-3 text-[13px] text-ink-mute"><span>页面可见时自动更新收款状态</span><Button disabled={busy || collections.refreshing} onClick={collections.reload}>刷新收款状态</Button></div>
    {collections.error ? <DataUnavailable message={collections.error} onRetry={collections.reload} /> : !collections.data ? <DataLoading /> : collections.data.map(row => <article key={row.id} className="border-t border-line py-4"><p className="font-semibold">{row.title} · {formatCurrency(row.amount, row.currency)} · {row.status === 'open' ? '待收款' : row.status === 'complete' ? '已收齐' : '已取消'}</p><p className="mt-1 text-[13px] text-ink-mute">收款账户 {row.accountNo} · 已收 {row.participants.filter(item => item.status === 'paid').length}/{row.participants.length}</p>{row.expenses && <div className="mt-2 text-[13px] text-ink-mute"><p>消费合计 {formatCurrency(row.expenseTotal!, row.currency)} · 本人份额 {formatCurrency(row.selfAmount!, row.currency)}</p>{row.expenses.map((item, i) => <p key={i}>{item.title}：{item.shares.map(share => `${share.name} ${formatCurrency(share.amount, row.currency)}`).join('；')}</p>)}</div>}<ul className="mt-3 flex flex-col gap-3">{row.participants.map(item => <li key={item.id ?? item.accountNo ?? item.phone ?? item.name} className="flex flex-wrap items-center justify-between gap-2 text-[13px]"><span>{item.splitName ?? item.name}{item.phone ? ` · ${item.phone}` : ''} · {formatCurrency(item.amount, row.currency)} · {{ paid: '已核对到账', unpaid: '待付款', processing: '付款处理中', cancelled: '已取消' }[item.status ?? 'unpaid']}{item.memo && <span className="mt-1 block whitespace-pre-wrap break-words">转账备注：{item.memo}</span>}</span>{row.delivery !== 'account-inbox' && row.status === 'open' && item.status === 'unpaid' && item.id && <div className="flex gap-2"><Button disabled={busy} onClick={() => remind(row, item.id!)}>生成催收文字</Button><Button disabled={busy} onClick={() => setPayment({ collection: row.id, participant: item.id!, transaction: '' })}>核对回款</Button></div>}</li>)}</ul>
      {payment.collection === row.id && <form className="mt-4 flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); void run(async () => { await api.confirmSplitPayment(row.id, { version: row.version, participantId: payment.participant, transactionId: payment.transaction }); setPayment({ collection: '', participant: '', transaction: '' }) }, '已核对该参与者回款') }}><label className="flex-1 text-[13px]">成功转入流水编号<input required value={payment.transaction} onChange={event => setPayment({ ...payment, transaction: event.target.value })} className={inputClass} /></label><Button type="submit" disabled={busy}>确认核对</Button><Button disabled={busy} onClick={() => setPayment({ collection: '', participant: '', transaction: '' })}>返回</Button></form>}
      {row.status === 'open' && <div className="mt-4">{cancel === row.id ? <><Button disabled={busy} onClick={() => void run(() => api.cancelSplitCollection(row.id, row.version), 'AA 单已取消，已到账款项不变')}>确认取消收款单</Button><Button onClick={() => setCancel('')}>保留</Button></> : <Button disabled={busy} variant="ghost" onClick={() => setCancel(row.id)}>取消收款单</Button>}</div>}
    </article>)}
  </section>
}
