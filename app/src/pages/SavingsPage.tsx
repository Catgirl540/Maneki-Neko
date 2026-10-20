import { useRef, useState } from 'react'
import { api, ApiError } from '@/api'
import type { Account, SavingsGoal, SavingsOverview } from '@/api/types'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { Row, Toggle } from '@/components/ui/Toggle'
import { EmptyState, Segmented, Tag } from '@/components/ui/Segmented'
import { DataLoading, DataUnavailable } from '@/components/ui/DataUnavailable'
import { BoltIcon, PencilIcon, PigIcon, PlusIcon, SparkleIcon, TrashIcon, WalletIcon } from '@/components/ui/icons'
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

const SWEEP_CYCLES = [
  { value: '每周', label: '每周' },
  { value: '每两周', label: '每两周' },
  { value: '每月', label: '每月' },
]

function GoalCard({
  goal,
  onEdit,
  onSweep,
  onDelete,
  disabled,
}: {
  goal: SavingsGoal
  onEdit: (goal: SavingsGoal) => void
  onSweep: (goal: SavingsGoal) => void
  onDelete: (goal: SavingsGoal) => void
  disabled: boolean
}) {
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
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            aria-label={`修改目标 ${goal.name}`}
            disabled={disabled}
            onClick={() => onEdit(goal)}
            className="grid size-9 place-items-center rounded-chip text-ink-mute transition-colors hover:bg-gold-wash hover:text-gold-deep"
          >
            <PencilIcon size={16} />
          </button>
          <button
            type="button"
            aria-label={`删除目标 ${goal.name}`}
            disabled={disabled}
            onClick={() => onDelete(goal)}
            className="grid size-9 place-items-center rounded-chip text-ink-mute transition-colors hover:bg-coral-wash hover:text-coral"
          >
            <TrashIcon size={16} />
          </button>
        </div>
      </div>
      <div className="mt-4">
        <div className="flex items-end justify-between gap-2">
          <span className="num text-[20px] font-semibold text-ink">¥{formatAmount(goal.savedAmount)}</span>
          <span className="num text-[13px] text-ink-mute">目标 ¥{formatAmount(goal.targetAmount)}</span>
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-chip bg-sunk" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-chip bg-gold transition-[width] duration-[var(--duration-state)] ease-[var(--ease-out-soft)]" style={{ width: `${percent}%` }} />
        </div>
        <div className="mt-2 flex items-center justify-between gap-2 text-[12px] text-ink-mute">
          <span className="truncate">{goal.sweep ? `归集设置 · ${goal.sweep.cycle} ¥${formatAmount(goal.sweep.amount)}` : '暂无归集设置'}</span>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onSweep(goal)}
            className="shrink-0 rounded-chip border border-line px-2.5 py-1 text-[12px] font-medium text-ink-soft transition-colors hover:border-gold-wash hover:text-gold-deep"
          >
            {goal.sweep ? '修改归集' : '设置归集'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function SavingsPage() {
  const toast = useToast()
  const savings = useAsync<SavingsOverview>(() => api.getSavingsOverview(), [])
  const accounts = useAsync<Account[]>(() => api.listAccounts(), [])
  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<SavingsGoal | null>(null)
  const [sweepTarget, setSweepTarget] = useState<SavingsGoal | null>(null)
  const [name, setName] = useState('')
  const [target, setTarget] = useState('')
  const [deadline, setDeadline] = useState('')
  const [icon, setIcon] = useState('travel')
  const [sweepEnabled, setSweepEnabled] = useState(false)
  const [sweepAmount, setSweepAmount] = useState('')
  const [sweepCycle, setSweepCycle] = useState('每周')
  const [sweepAccountId, setSweepAccountId] = useState('')
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

  function openCreate() {
    resetForm()
    setCreateOpen(true)
  }

  function openEdit(goal: SavingsGoal) {
    setName(goal.name)
    setTarget(String(goal.targetAmount / 100))
    setDeadline(goal.deadline ?? '')
    setIcon(goal.icon || 'travel')
    setFormError(null)
    setEditTarget(goal)
  }

  function openSweep(goal: SavingsGoal) {
    setSweepEnabled(Boolean(goal.sweep))
    setSweepAmount(goal.sweep ? String(goal.sweep.amount / 100) : '')
    setSweepCycle(goal.sweep?.cycle ?? '每周')
    setSweepAccountId(goal.sweep?.accountId ?? accounts.data?.[0]?.id ?? '')
    setFormError(null)
    setSweepTarget(goal)
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

  async function saveEdit() {
    if (writing.current || !editTarget) return
    const amount = parseAmountInput(target)
    if (!name.trim()) return setFormError('请填写目标名称')
    if (amount === null || amount <= 0) return setFormError('请输入有效目标金额，最多两位小数')
    writing.current = true
    setSubmitting(true)
    setFormError(null)
    try {
      await api.updateSavingsGoal(editTarget.id, { name: name.trim(), targetAmount: amount, icon, deadline: deadline || null })
      toast.show(`已保存目标「${name.trim()}」`, 'success')
      setEditTarget(null)
      resetForm()
      savings.reload()
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : '保存失败，请稍后重试')
    } finally {
      writing.current = false
      setSubmitting(false)
    }
  }

  async function saveSweep() {
    if (writing.current || !sweepTarget) return
    if (!sweepEnabled) {
      writing.current = true
      setSubmitting(true)
      setFormError(null)
      try {
        await api.setSavingsSweep(sweepTarget.id, { enabled: false })
        toast.show('已取消自动归集', 'success')
        setSweepTarget(null)
        savings.reload()
      } catch (err) {
        setFormError(err instanceof ApiError ? err.message : '保存失败，请稍后重试')
      } finally {
        writing.current = false
        setSubmitting(false)
      }
      return
    }
    const amount = parseAmountInput(sweepAmount)
    if (amount === null || amount <= 0) return setFormError('请输入有效归集金额，最多两位小数')
    if (!sweepAccountId) return setFormError('请选择扣款账户')
    writing.current = true
    setSubmitting(true)
    setFormError(null)
    try {
      await api.setSavingsSweep(sweepTarget.id, { enabled: true, amount, cycle: sweepCycle, accountId: sweepAccountId })
      toast.show('归集设置已保存', 'success')
      setSweepTarget(null)
      savings.reload()
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : '保存失败，请稍后重试')
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
    if (!savings.data) return
    writing.current = true
    setUpdating(true)
    try {
      await api.updateSavingsRoundup({ enabled: next })
      // 等待设置期间，目标列表可能已经刷新；重读总览，不用旧快照覆盖它。
      savings.reload()
      toast.show('凑整规则已保存', 'success')
    } catch (err) {
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
        <Button variant="primary" size="sm" disabled={updating || submitting} icon={<PlusIcon size={16} />} onClick={openCreate}>
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
            <GoalCard
              key={goal.id}
              goal={goal}
              disabled={updating || submitting}
              onEdit={openEdit}
              onSweep={openSweep}
              onDelete={(g) => void removeGoal(g)}
            />
          ))}
        </div>
        {data.goals.length === 0 && (
          <EmptyState title="还没有存钱目标" description="设置目标金额与期限。" action={<Button variant="primary" size="sm" disabled={updating || submitting} icon={<PlusIcon size={16} />} onClick={openCreate}>新建目标</Button>} />
        )}
      </Card>

      <Card className="float-up" style={{ animationDelay: '120ms' }}>
        <CardHeader title="消费凑整规则" action={<Toggle label="消费凑整转存" disabled={updating || submitting} checked={data.roundup.enabled} onChange={(next) => void toggleRoundup(next)} />} />
        <div className="mt-3 divide-y divide-line">
          <Row icon={<BoltIcon size={18} />} title="凑整到整数" description={`已设置凑整到 ¥${formatAmount(data.roundup.roundupTo)}，按规则自动转存`} />
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

      <Modal
        open={Boolean(editTarget)}
        onClose={() => { if (!submitting) { setEditTarget(null); resetForm() } }}
        title={editTarget ? `修改目标 · ${editTarget.name}` : '修改目标'}
        description="调整目标名称、金额或期限。"
        closeDisabled={submitting}
        footer={
          <>
            <Button variant="secondary" block onClick={() => { setEditTarget(null); resetForm() }} disabled={submitting}>取消</Button>
            <Button variant="primary" block loading={submitting} onClick={() => void saveEdit()}>保存</Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="目标名称" value={name} onChange={(e) => setName(e.target.value)} maxLength={12} />
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
        </div>
      </Modal>

      <Modal
        open={Boolean(sweepTarget)}
        onClose={() => { if (!submitting) setSweepTarget(null) }}
        title={sweepTarget ? `自动归集 · ${sweepTarget.name}` : '自动归集'}
        description="设定后按周期从扣款账户自动转入该目标。"
        closeDisabled={submitting}
        footer={
          <>
            <Button variant="secondary" block onClick={() => setSweepTarget(null)} disabled={submitting}>取消</Button>
            <Button variant="primary" block loading={submitting} onClick={() => void saveSweep()}>保存</Button>
          </>
        }
      >
        {sweepTarget && (
          <div className="flex flex-col gap-4">
            <Row
              icon={<BoltIcon size={18} />}
              title="开启自动归集"
              description={sweepEnabled ? '按设定周期自动转入该目标' : '关闭后不再自动转入'}
              right={
                <Toggle
                  label="开启自动归集"
                  checked={sweepEnabled}
                  disabled={submitting}
                  onChange={(next) => { setSweepEnabled(next); setFormError(null) }}
                />
              }
            />
            {sweepEnabled && (
              <>
                <Field
                  label="每期归集金额"
                  inputMode="decimal"
                  value={sweepAmount}
                  onChange={(e) => { setSweepAmount(e.target.value); setFormError(null) }}
                  placeholder="0.00"
                  trailing={<span className="text-[13px] text-ink-mute">元</span>}
                />
                <div>
                  <p className="mb-2 text-[13px] font-medium text-ink-soft">归集周期</p>
                  <Segmented disabled={submitting} value={sweepCycle} options={SWEEP_CYCLES} onChange={(next) => { setSweepCycle(next); setFormError(null) }} />
                </div>
                <div>
                  <p className="mb-2 text-[13px] font-medium text-ink-soft">扣款账户</p>
                  <div className="flex flex-col gap-2">
                    {(accounts.data ?? []).map((acc) => (
                      <button
                        key={acc.id}
                        type="button"
                        disabled={submitting}
                        onClick={() => { setSweepAccountId(acc.id); setFormError(null) }}
                        className={`flex items-center justify-between rounded-field border px-4 py-3 text-left text-[13px] transition-colors ${
                          sweepAccountId === acc.id ? 'border-gold-wash bg-gold-wash text-gold-deep' : 'border-line bg-surface text-ink-soft hover:text-ink'
                        }`}
                      >
                        <span>{acc.label}</span>
                        <span className="num">¥{formatAmount(acc.balance)}</span>
                      </button>
                    ))}
                    {(accounts.data ?? []).length === 0 && <p className="text-[12px] text-ink-mute">暂无可用账户。</p>}
                  </div>
                </div>
              </>
            )}
            {formError && <p role="alert" className="text-[13px] text-coral">{formError}</p>}
            <p className="text-[12px] text-ink-mute">归集规则保存后立即生效，可随时修改或取消。</p>
          </div>
        )}
      </Modal>

      {savings.refreshing && <p className="text-center text-[12px] text-ink-mute">同步中…</p>}
    </div>
  )
}
