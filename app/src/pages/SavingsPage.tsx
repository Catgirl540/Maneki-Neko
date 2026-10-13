import { useRef, useState } from 'react'
import { api, ApiError } from '@/api'
import type { SavingsGoal, SavingsOverview } from '@/api/types'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { Row, Toggle } from '@/components/ui/Toggle'
import { EmptyState, Tag } from '@/components/ui/Segmented'
import { DataLoading, DataUnavailable } from '@/components/ui/DataUnavailable'
import { BoltIcon, PigIcon, PlusIcon, SparkleIcon, TrashIcon, WalletIcon } from '@/components/ui/icons'
import { formatAmount, formatDate } from '@/lib/format'
import { useAsync } from '@/lib/useAsync'
import { parseAmountInput } from '@/lib/amountInput'
import { useToast } from '@/components/ui/toast-context'

const GOAL_ICONS: { value: string; label: string }[] = [
  { value: 'travel', label: '旅行' },
  { value: 'device', label: '数码' },
  { value: 'home', label: '居家' },
  { value: 'flag', label: '其他' },
]

function GoalCard({ goal, onDelete, disabled }: { goal: SavingsGoal; onDelete: (goal: SavingsGoal) => void; disabled: boolean }) {
  const ratio = goal.targetAmount > 0 ? Math.min(1, goal.savedAmount / goal.targetAmount) : 0
  const percent = Math.round(ratio * 100)
  return (
    <div className="rounded-tile border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-medium text-ink">{goal.name}</p>
          <p className="mt-0.5 text-[13px] text-ink-mute">
            {goal.deadline ? `目标日 ${formatDate(goal.deadline)}` : '无固定期限'}
          </p>
        </div>
        <button
          type="button"
          aria-label={`删除目标 ${goal.name}`}
          disabled={disabled}
          onClick={() => onDelete(goal)}
          className="grid size-9 shrink-0 place-items-center rounded-chip text-ink-mute transition-colors hover:bg-coral-wash hover:text-coral"
        >
          <TrashIcon size={16} />
        </button>
      </div>
      <div className="mt-4">
        <div className="flex items-end justify-between gap-2">
          <span className="num text-[20px] font-semibold text-ink">¥{formatAmount(goal.savedAmount)}</span>
          <span className="num text-[13px] text-ink-mute">目标 ¥{formatAmount(goal.targetAmount)}</span>
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-chip bg-sunk" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-chip bg-gold transition-[width] duration-[var(--duration-state)] ease-[var(--ease-out-soft)]" style={{ width: `${percent}%` }} />
        </div>
        <div className="mt-2 flex items-center justify-between text-[12px] text-ink-mute">
          <span>{goal.sweep ? `归集设置 · ${goal.sweep.cycle} ¥${formatAmount(goal.sweep.amount)}` : '暂无归集设置'}</span>
          <span className="num">{percent}%</span>
        </div>
      </div>
    </div>
  )
}

export function SavingsPage() {
  const toast = useToast()
  const savings = useAsync<SavingsOverview>(() => api.getSavingsOverview(), [])
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [target, setTarget] = useState('')
  const [deadline, setDeadline] = useState('')
  const [icon, setIcon] = useState('travel')
  const [submitting, setSubmitting] = useState(false)
  const [updating, setUpdating] = useState(false)
  const writing = useRef(false)
  const [formError, setFormError] = useState<string | null>(null)

  function resetForm() {
    setName('')
    setTarget('')
    setDeadline('')
    setIcon('travel')
    setFormError(null)
  }

  async function createGoal() {
    if (writing.current) return
    const amount = parseAmountInput(target)
    if (!name.trim()) return setFormError('请填写目标名称')
    if (amount === null || amount <= 0) return setFormError('请输入有效目标金额，最多两位小数')
    writing.current = true
    setSubmitting(true)
    setFormError(null)
    try {
      await api.createSavingsGoal({ name: name.trim(), targetAmount: amount, icon, deadline: deadline || null })
      toast.show(`已创建目标「${name.trim()}」`, 'success')
      setCreateOpen(false)
      resetForm()
      savings.reload()
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : '创建失败，请稍后重试')
    } finally {
      writing.current = false
      setSubmitting(false)
    }
  }

  async function removeGoal(goal: SavingsGoal) {
    if (writing.current) return
    const snapshot = savings.data
    if (!snapshot) return
    writing.current = true
    setUpdating(true)
    savings.setData({ ...snapshot, goals: snapshot.goals.filter((g) => g.id !== goal.id) })
    try {
      await api.deleteSavingsGoal(goal.id)
      toast.show(`已删除目标「${goal.name}」`, 'success')
      savings.reload()
    } catch (err) {
      savings.setData(snapshot)
      toast.show(err instanceof ApiError ? err.message : '删除失败，请稍后重试', 'error')
    } finally {
      writing.current = false
      setUpdating(false)
    }
  }

  async function toggleRoundup(next: boolean) {
    if (writing.current) return
    const snapshot = savings.data
    if (!snapshot) return
    writing.current = true
    setUpdating(true)
    try {
      const roundup = await api.updateSavingsRoundup({ enabled: next })
      savings.setData({ ...snapshot, roundup })
      toast.show('凑整规则已保存', 'success')
    } catch (err) {
      savings.setData(snapshot)
      toast.show(err instanceof ApiError ? err.message : '操作失败，请稍后重试', 'error')
    } finally {
      writing.current = false
      setUpdating(false)
    }
  }

  if (savings.error && !savings.data) return <DataUnavailable message={savings.error} onRetry={savings.reload} />
  if (savings.loading && !savings.data) return <DataLoading />

  const data = savings.data
  if (!data) return <DataLoading />

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[30px] leading-tight font-bold tracking-[-0.02em] text-ink">存钱计划</h1>
        <Button variant="primary" size="sm" disabled={updating || submitting} icon={<PlusIcon size={16} />} onClick={() => setCreateOpen(true)}>
          新建目标
        </Button>
      </div>

      <Card className="float-up">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="text-[13px] text-ink-soft">已存总额</p>
            <p className="num mt-1 text-[34px] leading-none font-bold text-ink">¥{formatAmount(data.totalSaved)}</p>
            <p className="mt-2 text-[13px] text-ink-mute">共 {data.goals.length} 个目标</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="grid size-12 place-items-center rounded-tile bg-gold-tint text-gold-deep">
              <BoltIcon size={22} />
            </span>
            <div>
              <p className="text-[13px] text-ink-soft">连续存钱</p>
              <p className="num text-[20px] font-semibold text-ink">{data.streak.days} 天</p>
            </div>
          </div>
        </div>
      </Card>

      <Card className="float-up" style={{ animationDelay: '60ms' }}>
        <CardHeader title="存钱目标" action={<span className="text-[13px] text-ink-mute">{data.goals.length} 个</span>} />
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {data.goals.map((goal) => (
            <GoalCard key={goal.id} goal={goal} disabled={updating || submitting} onDelete={(g) => void removeGoal(g)} />
          ))}
        </div>
        {data.goals.length === 0 && (
          <EmptyState title="还没有存钱目标" description="设置目标金额与期限。" action={<Button variant="primary" size="sm" disabled={updating || submitting} icon={<PlusIcon size={16} />} onClick={() => setCreateOpen(true)}>新建目标</Button>} />
        )}
      </Card>

      <Card className="float-up" style={{ animationDelay: '120ms' }}>
        <CardHeader title="消费凑整规则" action={<Toggle label="消费凑整转存" disabled={updating || submitting} checked={data.roundup.enabled} onChange={(next) => void toggleRoundup(next)} />} />
        <div className="mt-3 divide-y divide-line">
          <Row icon={<BoltIcon size={18} />} title="凑整到整数" description={`已设置凑整到 ¥${formatAmount(data.roundup.roundupTo)}，自动执行暂未开放`} />
          <Row icon={<WalletIcon size={18} />} title="单日上限" description={`每天最多转存 ¥${formatAmount(data.roundup.dailyCap)}`} />
        </div>
      </Card>

      <Card className="float-up" style={{ animationDelay: '180ms' }}>
        <CardHeader title="连续打卡与徽章" action={<span className="text-[13px] text-ink-mute">最长 {data.streak.longestDays} 天</span>} />
        <div className="mt-4 flex flex-wrap gap-3">
          {data.streak.badges.map((badge) => (
            <div key={badge.id} className={`flex min-w-[120px] flex-col items-center gap-2 rounded-tile border p-4 text-center ${badge.earned ? 'border-gold-wash bg-gold-tint' : 'border-line bg-sunk opacity-70'}`}>
              <span className={`grid size-11 place-items-center rounded-chip ${badge.earned ? 'bg-gold text-ink-invert' : 'bg-line-strong text-ink-invert'}`}>
                <SparkleIcon size={20} />
              </span>
              <span className="text-[13px] font-medium text-ink">{badge.label}</span>
              <span className="text-[12px] text-ink-mute">{badge.earned ? '已获得' : badge.hint}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card className="float-up" style={{ animationDelay: '240ms' }}>
        <CardHeader title="存钱奖励 / 利息加成" />
        <div className="mt-3 divide-y divide-line">
          {data.rewards.map((reward) => (
            <Row
              key={reward.id}
              icon={<PigIcon size={18} />}
              title={reward.title}
              description={reward.description}
              right={
                <span className="flex items-center gap-3">
                  <Tag tone={reward.status === 'credited' ? 'blue' : 'gold'}>{reward.status === 'credited' ? '已入账' : '已达标'}</Tag>
                  <span className="num text-[15px] font-semibold text-ink">+¥{formatAmount(reward.amount)}</span>
                </span>
              }
            />
          ))}
          {data.rewards.length === 0 && <EmptyState title="暂无奖励" description="奖励以实际记录为准。" />}
        </div>
      </Card>

      <Modal
        open={createOpen}
        onClose={() => { if (!submitting) { setCreateOpen(false); resetForm() } }}
        title="新建存钱目标"
        description="设定目标金额与期限。"
        closeDisabled={submitting}
        footer={
          <>
            <Button variant="secondary" block onClick={() => { setCreateOpen(false); resetForm() }} disabled={submitting}>取消</Button>
            <Button variant="primary" block loading={submitting} onClick={() => void createGoal()}>创建</Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="目标名称" value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：旅行基金" maxLength={12} />
          <Field
            label="目标金额"
            inputMode="decimal"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="0.00"
            trailing={<span className="text-[13px] text-ink-mute">元</span>}
          />
          <div>
            <p className="mb-2 text-[13px] font-medium text-ink-soft">目标图标</p>
            <div className="flex flex-wrap gap-2">
              {GOAL_ICONS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setIcon(item.value)}
                  className={`min-h-10 rounded-chip border px-4 text-[13px] font-medium transition-colors ${icon === item.value ? 'border-gold-wash bg-gold-wash text-gold-deep' : 'border-line bg-surface text-ink-soft hover:text-ink'}`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <Field label="目标日期（选填）" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          {formError && <p role="alert" className="text-[13px] text-coral">{formError}</p>}
          <p className="text-[12px] text-ink-mute">目标仅保存金额与期限。</p>
        </div>
      </Modal>

      {savings.refreshing && <p className="text-center text-[12px] text-ink-mute">同步中…</p>}
    </div>
  )
}
