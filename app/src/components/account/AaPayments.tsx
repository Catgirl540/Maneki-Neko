import { useEffect, useState } from 'react'
import { api } from '@/api'
import type { AaPaymentRequest } from '@/api/types'
import { useAsync } from '@/lib/useAsync'
import { formatCurrency } from '@/lib/format'
import { Button } from '@/components/ui/Button'
import { PinInput } from '@/components/ui/PinInput'
import { DataLoading, DataUnavailable } from '@/components/ui/DataUnavailable'

const statusLabel = { unpaid: '待付款', processing: '付款处理中', paid: '已付款', cancelled: '已取消' }
type BusyProps = { onBusyChange: (busy: boolean) => void }

export function AaPayables({ onBusyChange }: BusyProps) {
  const requests = useAsync(() => api.listSplitPaymentRequests(), [])
  const [selected, setSelected] = useState<AaPaymentRequest | null>(null)
  const [password, setPassword] = useState(''), [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('')
  useEffect(() => {
    const timer = window.setInterval(() => { if (!busy && !selected) requests.reload() }, 15000)
    return () => window.clearInterval(timer)
  }, [busy, selected, requests.reload])
  const pending = requests.data?.filter(row => row.status === 'unpaid' || row.status === 'processing') ?? []
  const history = requests.data?.filter(row => row.status === 'paid' || row.status === 'cancelled') ?? []
  async function pay() {
    if (!selected || !confirmed || password.length !== 6) return
    setBusy(true); onBusyChange(true); setMessage('')
    try {
      const result = await api.paySplitRequest(selected.id, { version: selected.version, confirmed: true, paymentPassword: password })
      setSelected(null); setConfirmed(false)
      setMessage(result.status === 'paid' ? 'AA 付款成功，转账备注已写入双方流水。' : '付款已提交，正在处理中，请勿重复付款。')
      requests.reload(); window.dispatchEvent(new Event('luckycat:bank-updated'))
    } catch (error) { setMessage(error instanceof Error ? error.message : '付款失败'); requests.reload(); setSelected(null); setConfirmed(false) }
    finally { setPassword(''); setBusy(false); onBusyChange(false) }
  }
  const rowView = (row: AaPaymentRequest) => <article key={row.id} className="rounded-field border border-line p-4"><p className="font-medium">{row.title} · {formatCurrency(row.amount, row.currency)} · {statusLabel[row.status]}</p><p className="mt-2 text-[13px]">收款人：{row.collectorName}</p><p className="whitespace-pre-wrap break-words text-[13px]">转账备注：{row.memo}</p>{row.status === 'unpaid' && <Button className="mt-3" disabled={busy} variant="primary" onClick={() => { setSelected(row); setPassword(''); setConfirmed(false); setMessage('') }}>查看并付款</Button>}{row.transactionId && <p className="mt-2 text-[13px] text-ink-mute">付款流水：{row.transactionId}</p>}</article>
  return <section className="flex flex-col gap-5" aria-label="AA 付款">
    <div className="flex items-center justify-between"><h3 className="font-semibold">待付款（{pending.length}）</h3><Button disabled={busy} onClick={requests.reload}>刷新付款通知</Button></div>
    {requests.error ? <DataUnavailable message={requests.error} onRetry={requests.reload} /> : !requests.data ? <DataLoading /> : pending.length === 0 ? <p className="text-[13px] text-ink-mute">暂无待付款通知</p> : pending.map(rowView)}
    {selected && <form aria-label="确认 AA 付款" className="rounded-field border border-line p-4" onSubmit={event => { event.preventDefault(); void pay() }}><h3 className="font-semibold">确认 AA 付款</h3><p className="mt-3">收款人：{selected.collectorName}</p><p className="break-all text-[13px]">收款账号：{selected.collectorAccountNo}</p><p className="my-2 font-medium">付款金额：{formatCurrency(selected.amount, selected.currency)}</p><p className="mb-4 whitespace-pre-wrap break-words text-[13px]">转账备注：{selected.memo}</p><PinInput label="AA 付款支付密码" value={password} onChange={setPassword} disabled={busy} className="max-w-[360px]" /><label className="my-4 flex items-start gap-2 text-[13px]"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} />我已核对收款人、金额和转账备注，确认支付</label><div className="flex flex-wrap gap-3"><Button type="submit" variant="primary" disabled={busy || !confirmed || password.length !== 6}>确认支付</Button><Button disabled={busy} onClick={() => { setSelected(null); setPassword(''); setConfirmed(false) }}>暂不付款</Button></div></form>}
    {message && <p role="status" className="text-[13px]">{message}</p>}
    {history.length > 0 && <><h3 className="mt-3 font-semibold">付款记录</h3>{history.map(rowView)}</>}
  </section>
}
