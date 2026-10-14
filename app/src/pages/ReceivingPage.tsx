import { useState } from 'react'
import { api, ApiError, isMockMode } from '@/api'
import type { Cents, ReceivingInfo } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { CopyButton } from '@/components/ui/CopyButton'
import { DataLoading, DataUnavailable } from '@/components/ui/DataUnavailable'
import { Field } from '@/components/ui/Field'
import { ArrowDownLeftIcon } from '@/components/ui/icons'
import { formatAmount } from '@/lib/format'
import { useAsync } from '@/lib/useAsync'
import { receivingRows, receivingText } from '@/lib/receiving'
import { copyText } from '@/lib/clipboard'
import { useToast } from '@/components/ui/toast-context'
import { ManualCopyModal } from '@/components/ui/ManualCopyModal'
import { parseAmountInput } from '@/lib/amountInput'

export function ReceivingContent({ onClose, onUpdate, onBusyChange }: {
  onClose: () => void
  onUpdate: () => void
  onBusyChange: (busy: boolean) => void
}) {
  const toast = useToast()
  const info = useAsync(() => api.getReceivingInfo(), [])
  const accounts = useAsync(() => isMockMode ? api.listAccounts() : Promise.resolve([]), [])
  const [demo, setDemo] = useState(false)
  const [manualText, setManualText] = useState<string | null>(null)
  if (info.error && !info.data) return <DataUnavailable message={info.error} onRetry={info.reload} />
  if (!info.data) return <DataLoading />
  if (demo && isMockMode) return <MoneyInForm accountId={accounts.data?.[0]?.id ?? ''}
    onBack={() => setDemo(false)} onDone={() => { onUpdate(); onClose() }} onBusyChange={onBusyChange} />
  return (
    <div>
      <ReceivingPanel info={info.data} />
      <div className="mt-6 flex flex-wrap gap-3">
        <Button variant="primary" onClick={() => {
          if (!info.data) return
          const text = receivingText(info.data)
          void copyText(text, '收款信息', toast).then(copied => { if (!copied) setManualText(text) })
        }}>复制全部</Button>
        {isMockMode && <Button disabled={!accounts.data?.length} onClick={() => setDemo(true)}>模拟一笔转入</Button>}
      </div>
      <ManualCopyModal text={manualText} label="收款信息" onClose={() => setManualText(null)} />
    </div>
  )
}

const QUICK_AMOUNTS: Cents[] = [100_000, 500_000, 1_000_000, 2_000_000]

/** 模拟入账只在显式 mock 模式下可用。 */
function MoneyInForm({ accountId, onBack, onDone, onBusyChange }: {
  accountId: string
  onBack: () => void
  onDone: () => void
  onBusyChange: (busy: boolean) => void
}) {
  const [amount, setAmount] = useState('1000')
  const [channel, setChannel] = useState<'card' | 'salary'>('card')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  async function submitDeposit() {
    if (loading) return
    setError(null)
    const cents = parseAmountInput(amount)
    if (cents === null || cents <= 0) { setError('请输入有效转入金额，最多两位小数'); return }
    if (cents > 5_000_000) { setError('单笔转入金额不能超过 ¥50,000.00'); return }
    setLoading(true)
    onBusyChange(true)
    try {
      await api.deposit(accountId, cents, channel)
      onDone()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '转入失败，请稍后重试')
    } finally { setLoading(false); onBusyChange(false) }
  }
  return (
    <div>
      <Button size="sm" variant="ghost" disabled={loading} onClick={onBack}>返回收款信息</Button>
      <p className="my-4 text-[13px] text-ink-soft">模拟入账仅用于本地演示。</p>
      <Field
        label="转入金额（元）"
        autoFocus
        value={amount}
        inputMode="decimal"
        onChange={(e) => setAmount(e.target.value)}
        icon={<ArrowDownLeftIcon size={20} />}
        error={error ?? undefined}
        hint="单笔上限 ¥50,000.00"
      />
      <div className="mt-4 flex flex-wrap gap-2">
        {QUICK_AMOUNTS.map((cents) => (
          <button
            key={cents}
            type="button"
            onClick={() => setAmount(String(cents / 100))}
            className="h-9 rounded-chip border border-line px-3.5 text-[13px] text-ink-soft transition-colors hover:border-gold hover:text-gold-deep"
          >
            ¥{formatAmount(cents)}
          </button>
        ))}
      </div>
      <div className="mt-5 flex gap-2">
        {(
          [
            { key: 'card', label: '绑定银行卡' },
            { key: 'salary', label: '工资入账' },
          ] as const
        ).map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setChannel(item.key)}
            className={`h-11 flex-1 rounded-field border text-[14px] transition-colors ${
              channel === item.key
                ? 'border-gold bg-gold-wash text-gold-deep'
                : 'border-line text-ink-soft hover:border-line-strong'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
      <Button className="mt-6" block variant="primary" loading={loading} onClick={() => void submitDeposit()}>确认转入</Button>
    </div>
  )
}

/** 收款信息：一行一项，各自带复制 */
function ReceivingPanel({ info }: { info: ReceivingInfo }) {
  return (
    <div className="flex flex-col gap-3">
      {receivingRows(info).map((row) => (
        <div key={row.key} className="flex items-center gap-3 rounded-field border border-line px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-[12px] text-ink-mute">{row.label}</p>
            <p className="num mt-0.5 break-all text-[16px] font-semibold text-ink">{row.value}</p>
            {row.hint && <p className="mt-1 text-[11px] leading-relaxed text-ink-mute">{row.hint}</p>}
          </div>
          <CopyButton value={row.value} label={row.label} size="md" />
        </div>
      ))}
      <p className="mt-1 text-[12px] leading-relaxed text-ink-mute">
        收款户名需与账户登记一致。
      </p>
      <p role="status" className="text-[12px] leading-relaxed text-ink-mute">{info.fpsRegistered === true ? 'FPS 已登记，仅支持香港港币模拟通道。' : info.fpsRegistered === false ? '尚未登记 FPS，请使用银行账户收款。' : 'FPS 登记状态待确认，请使用银行账户收款。'}</p>
    </div>
  )
}
