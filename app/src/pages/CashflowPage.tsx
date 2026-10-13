import { useState } from 'react'
import { api, ApiError } from '@/api'
import type { SalaryPlan, OverdraftFacility } from '@/api/types'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { Row, Toggle } from '@/components/ui/Toggle'
import { Tag } from '@/components/ui/Segmented'
import { DataLoading, DataUnavailable } from '@/components/ui/DataUnavailable'
import { AlertIcon, HistoryIcon, PencilIcon, PigIcon, WalletIcon } from '@/components/ui/icons'
import { formatAmount, formatDate, toCents } from '@/lib/format'
import { useAsync } from '@/lib/useAsync'
import { useToast } from '@/components/ui/toast-context'

export function CashflowPage() {
  const toast = useToast()
  const salary = useAsync<SalaryPlan>(() => api.getSalaryPlan(), [])
  const overdraft = useAsync<OverdraftFacility>(() => api.getOverdraft(), [])
  const [editOpen, setEditOpen] = useState(false)
  const [day, setDay] = useState('')
  const [amount, setAmount] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [overdraftBusy, setOverdraftBusy] = useState(false)

  function openEdit(plan: SalaryPlan) {
    setDay(String(plan.salaryDay))
    setAmount(String(plan.amount / 100))
    setFormError(null)
    setEditOpen(true)
  }

  async function saveSalary() {
    const amountCents = toCents(amount)
    const salaryDay = Number(day)
    if (!Number.isInteger(salaryDay) || salaryDay < 1 || salaryDay > 28) return setFormError('发薪日需在 1–28 之间')
    if (amountCents <= 0) return setFormError('月薪必须大于 0')
    setSaving(true)
    setFormError(null)
    try {
      const next = await api.updateSalary({ salaryDay, amount: amountCents })
      salary.setData(next)
      toast.show('工资计划已更新', 'success')
      setEditOpen(false)
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : '保存失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  async function toggleOverdraft(next: boolean) {
    setOverdraftBusy(true)
    try {
      const updated = await api.activateOverdraft(next)
      overdraft.setData(updated)
      toast.show(next ? '已开设备用金' : '已关闭备用金', 'success')
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : '操作失败，请稍后重试', 'error')
    } finally {
      setOverdraftBusy(false)
    }
  }

  if (!salary.data || !overdraft.data) {
    const error = salary.error ?? overdraft.error
    const retry = !salary.data ? salary.reload : overdraft.reload
    return error ? <DataUnavailable message={error} onRetry={retry} /> : <DataLoading />
  }
  const plan = salary.data
  const od = overdraft.data

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-[30px] leading-tight font-bold tracking-[-0.02em] text-ink">工资与备用金</h1>

      <Card className="float-up">
        <CardHeader title="工资入账计划" action={<Button size="sm" icon={<PencilIcon size={15} />} onClick={() => openEdit(plan)}>修改</Button>} />
        <div className="mt-4 flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="text-[13px] text-ink-soft">下次发薪</p>
            <p className="num mt-1 text-[34px] leading-none font-bold text-ink">¥{formatAmount(plan.amount)}</p>
            <p className="mt-2 text-[13px] text-ink-mute">{formatDate(plan.nextPayday)} · 每月 {plan.salaryDay} 日</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="grid size-12 place-items-center rounded-tile bg-gold-tint text-gold-deep">
              <WalletIcon size={22} />
            </span>
            <div>
              <p className="text-[13px] text-ink-soft">发薪单位</p>
              <p className="text-[15px] font-medium text-ink">{plan.employer}</p>
            </div>
          </div>
        </div>
        <p className="mt-4 text-[12px] leading-relaxed text-ink-mute">到账日按银行清算时间可能顺延；设置后每月发薪自动入账到指定储蓄账户。</p>
      </Card>

      <Card className="float-up" style={{ animationDelay: '70ms' }}>
        <CardHeader title="备用金" action={<Tag tone={od.active ? 'gold' : 'neutral'}>{od.active ? '已开通' : '未开通'}</Tag>} />
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div>
            <p className="text-[12px] text-ink-mute">额度</p>
            <p className="num mt-1 text-[20px] font-semibold text-ink">¥{formatAmount(od.creditLimit)}</p>
          </div>
          <div>
            <p className="text-[12px] text-ink-mute">已用</p>
            <p className="num mt-1 text-[20px] font-semibold text-ink">¥{formatAmount(od.used)}</p>
          </div>
          <div>
            <p className="text-[12px] text-ink-mute">可用</p>
            <p className="num mt-1 text-[20px] font-semibold text-ink">¥{formatAmount(od.available)}</p>
          </div>
        </div>
        <div className="mt-5 divide-y divide-line">
          <Row icon={<PigIcon size={18} />} title="年化利率" description={`${(od.apr * 100).toFixed(2)}% · ${od.interestNote}`} />
          <Row
            icon={<WalletIcon size={18} />}
            title={od.active ? '关闭备用金' : '开设备用金'}
            description={od.active ? (od.activatedAt ? `${formatDate(od.activatedAt)} 开通` : '已开通') : '开通后可随时小额透支，按日计息'}
            right={<Toggle label="备用金开关" checked={od.active} disabled={overdraftBusy} onChange={(next) => void toggleOverdraft(next)} />}
          />
        </div>
      </Card>

      <Card className="float-up" style={{ animationDelay: '140ms' }}>
        <CardHeader title="发薪记录" action={<span className="text-[13px] text-ink-mute">{plan.history.length} 笔</span>} />
        <div className="mt-3 divide-y divide-line">
          {plan.history.map((record) => (
            <div key={record.id} className="flex items-center gap-4 py-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-chip bg-gold-tint text-gold-deep">
                <HistoryIcon size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-medium text-ink">{record.month} 工资</span>
                <span className="mt-0.5 block text-[13px] text-ink-mute">{formatDate(record.paidAt)} 到账</span>
              </span>
              <span className="num shrink-0 text-[15px] font-semibold text-ink">+¥{formatAmount(record.amount)}</span>
            </div>
          ))}
        </div>
      </Card>

      <Modal
        open={editOpen}
        onClose={() => { if (!saving) setEditOpen(false) }}
        title="修改工资计划"
        description="设置发薪日与预计月薪，用于到账预测与备用金额度评估。"
        closeDisabled={saving}
        footer={
          <>
            <Button block variant="secondary" onClick={() => setEditOpen(false)} disabled={saving}>取消</Button>
            <Button block variant="primary" loading={saving} onClick={() => void saveSalary()}>保存</Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="每月发薪日" inputMode="numeric" value={day} onChange={(e) => setDay(e.target.value.replace(/[^\d]/g, ''))} placeholder="8" trailing={<span className="text-[13px] text-ink-mute">日</span>} />
          <Field label="预计月薪" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} placeholder="0.00" trailing={<span className="text-[13px] text-ink-mute">元</span>} />
          {formError && (
            <p role="alert" className="flex items-start gap-2 text-[13px] text-coral">
              <AlertIcon size={16} className="mt-0.5 shrink-0" />{formError}
            </p>
          )}
        </div>
      </Modal>
    </div>
  )
}
