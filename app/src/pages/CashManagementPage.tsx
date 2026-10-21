import { useState } from 'react'
import { Link } from 'react-router-dom'
import { WealthHeader } from '@/components/wealth/WealthHeader'
import { api, ApiError } from '@/api'
import type { CashManagement } from '@/api/types'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { Row, Toggle } from '@/components/ui/Toggle'
import { Tag } from '@/components/ui/Segmented'
import { DataLoading, DataUnavailable } from '@/components/ui/DataUnavailable'
import { AlertIcon, BoltIcon, PigIcon, WalletIcon } from '@/components/ui/icons'
import { formatAmount } from '@/lib/format'
import { useAsync } from '@/lib/useAsync'
import { parseAmountInput } from '@/lib/amountInput'
import { useToast } from '@/components/ui/toast-context'

export function CashManagementPage() {
  const toast = useToast()
  const cash = useAsync<CashManagement>(() => api.getCashManagement(), [])
  const [editOpen, setEditOpen] = useState(false)
  const [threshold, setThreshold] = useState('')
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  function openEdit(data: CashManagement) {
    setThreshold(String(data.sweepThreshold / 100))
    setFormError(null)
    setEditOpen(true)
  }

  async function toggleSweep(next: boolean) {
    setBusy(true)
    try {
      const updated = await api.updateCashSweep({ enabled: next })
      cash.setData(updated)
      toast.show('规则已保存，自动执行尚未开放', 'success')
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : '操作失败，请稍后重试', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function saveThreshold() {
    const cents = parseAmountInput(threshold)
    if (cents === null) return setFormError('请输入有效金额，最多两位小数')
    setBusy(true)
    setFormError(null)
    try {
      const updated = await api.updateCashSweep({ threshold: cents })
      cash.setData(updated)
      toast.show('已更新保留金额', 'success')
      setEditOpen(false)
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : '保存失败，请稍后重试')
    } finally {
      setBusy(false)
    }
  }

  if (!cash.data) return cash.error ? <DataUnavailable message={cash.error} onRetry={cash.reload} /> : <DataLoading />
  const data = cash.data

  return (
    <div className="wealth-workspace">
      <WealthHeader title="现金管理设置" />
      <Link to="/wealth/products?category=cash" className="text-[13px] text-gold-deep">← 返回现金管理产品</Link>

      <Card className="float-up">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="text-[13px] text-ink-soft">活钱余额</p>
            <p className="num mt-1 text-[34px] leading-none font-bold text-ink">¥{formatAmount(data.balance)}</p>
            <p className="mt-2 text-[13px] text-ink-mute">7 日年化 {(data.sevenDayYield * 100).toFixed(2)}% · 累计收益 +¥{formatAmount(data.totalYield)}</p>
          </div>
          <span className="grid size-12 place-items-center rounded-tile bg-gold-tint text-gold-deep"><PigIcon size={22} /></span>
        </div>
      </Card>

      <Card className="float-up" style={{ animationDelay: '70ms' }}>
        <CardHeader title="自动转入规则" action={<Tag tone="neutral">仅保存设置</Tag>} />
        <div className="mt-3 divide-y divide-line">
          <Row
            icon={<BoltIcon size={18} />}
            title="自动转入规则开关"
            description={data.sweepEnabled ? `已设置保留 ¥${formatAmount(data.sweepThreshold)}，超出部分的自动转入尚未开放` : '自动执行尚未开放，开关只保存规则'}
            right={<Toggle label="自动转入活钱" checked={data.sweepEnabled} disabled={busy} onChange={(next) => void toggleSweep(next)} />}
          />
          <Row
            icon={<WalletIcon size={18} />}
            title="活期保留金额"
            description={`已设置保留 ¥${formatAmount(data.sweepThreshold)}`}
            right={<Button size="sm" disabled={busy} onClick={() => openEdit(data)}>修改</Button>}
          />
        </div>
      </Card>

      <Modal
        open={editOpen}
        onClose={() => { if (!busy) setEditOpen(false) }}
        title="修改活期保留金额"
        description="保存自动转入规则的保留金额。"
        closeDisabled={busy}
        footer={
          <>
            <Button block variant="secondary" onClick={() => setEditOpen(false)} disabled={busy}>取消</Button>
            <Button block variant="primary" loading={busy} onClick={() => void saveThreshold()}>保存</Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="活期保留金额" inputMode="decimal" value={threshold} onChange={(e) => setThreshold(e.target.value)} trailing={<span className="text-[13px] text-ink-mute">元</span>} />
          {formError && <p role="alert" className="flex items-start gap-2 text-[13px] text-coral"><AlertIcon size={16} className="mt-0.5 shrink-0" />{formError}</p>}
        </div>
      </Modal>
    </div>
  )
}
