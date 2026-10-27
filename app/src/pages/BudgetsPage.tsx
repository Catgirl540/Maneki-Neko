import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '@/api'
import type { Cents, Budget, BudgetInput, BudgetsOverview } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { EmptyState, Tag } from '@/components/ui/Segmented'
import { formatAmount } from '@/lib/format'
import { useAsync } from '@/lib/useAsync'
import { useToast } from '@/components/ui/toast-context'
import { SPEND_PLATFORMS } from '../../../shared/spend-platforms.mjs'
import { ArrowRightIcon, ReceiptIcon } from '@/components/ui/icons'

/** 把「20」「20.5」解析成分；非法返回 null */
function parseYuan(raw: string): Cents | null {
  const text = raw.trim()
  if (!/^\d{1,6}(\.\d{0,2})?$/.test(text)) return null
  const [yuan, cents = ''] = text.split('.')
  const value = Number(yuan) * 100 + Number(cents.padEnd(2, '0'))
  return Number.isSafeInteger(value) ? value : null
}

function progressWidth(used: Cents, limit: Cents) {
  if (limit <= 0) return 0
  return Math.min(100, Math.max(0, (used / limit) * 100))
}

/**
 * 支出预算。
 *
 * 给「奶茶/外卖/打车」这类容易超支的消费套一个每日限额：命中平台的模拟消费在扣款前
 * 先过预算额度，超了直接拒绝。额度和积分都只是规则，不新建账户、不冻结资金。
 */
export function BudgetsPage() {
  const toast = useToast()
  const overview = useAsync<BudgetsOverview>(() => api.listBudgets(), [])
  const [name, setName] = useState('奶茶预算')
  const [platforms, setPlatforms] = useState<string[]>(['luckin', 'starbucks'])
  const [limitText, setLimitText] = useState('20.00')
  const [thresholdText, setThresholdText] = useState('10.00')
  const [creating, setCreating] = useState(false)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [deleteArmed, setDeleteArmed] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const limit = parseYuan(limitText)
  const threshold = parseYuan(thresholdText)
  const canCreate = name.trim().length > 0 && platforms.length > 0 && limit !== null && limit >= 100 && threshold !== null

  const totals = useMemo(() => {
    const budgets = overview.data?.budgets ?? []
    return {
      used: budgets.reduce((sum, budget) => sum + budget.today.used, 0),
      limit: budgets.reduce((sum, budget) => sum + budget.today.limit, 0),
      points: budgets.reduce((sum, budget) => sum + budget.points.available, 0),
    }
  }, [overview.data])

  function togglePlatform(id: string) {
    setPlatforms(current => (current.includes(id) ? current.filter(item => item !== id) : [...current, id]))
  }

  async function create() {
    if (!canCreate || limit === null || threshold === null) return
    setCreating(true); setFormError(null)
    try {
      const input: BudgetInput = { name: name.trim(), platforms, dailyLimit: limit, pointThreshold: threshold }
      await api.createBudget(input)
      toast.show(`已创建「${input.name}」`, 'success')
      setName('')
      overview.reload()
    } catch (cause) {
      setFormError(cause instanceof ApiError ? cause.message : '创建失败，请稍后重试')
    } finally { setCreating(false) }
  }

  async function toggleEnabled(budget: Budget) {
    setPendingId(budget.id)
    try {
      await api.updateBudget(budget.id, { enabled: !budget.enabled })
      toast.show(budget.enabled ? `已停用「${budget.name}」` : `已启用「${budget.name}」`, 'success')
      overview.reload()
    } catch (cause) {
      toast.show(cause instanceof ApiError ? cause.message : '操作失败，请稍后重试', 'error')
    } finally { setPendingId(null) }
  }

  async function remove(budget: Budget) {
    if (deleteArmed !== budget.id) { setDeleteArmed(budget.id); return }
    setPendingId(budget.id)
    try {
      await api.deleteBudget(budget.id)
      toast.show(`已删除「${budget.name}」`, 'success')
      setDeleteArmed(null)
      overview.reload()
    } catch (cause) {
      toast.show(cause instanceof ApiError ? cause.message : '删除失败，请稍后重试', 'error')
    } finally { setPendingId(null) }
  }

  async function redeem(budget: Budget) {
    setPendingId(budget.id)
    try {
      const result = await api.redeemBudgetPass(budget.id, budget.today.day)
      toast.show(`已兑换「${budget.name}」今天 +¥${formatAmount(result.pass.extra)} 额度`, 'success')
      overview.reload()
    } catch (cause) {
      toast.show(cause instanceof ApiError ? cause.message : '兑换失败，请稍后重试', 'error')
    } finally { setPendingId(null) }
  }

  if (overview.error && !overview.data) return <div className="text-[14px] text-coral">{overview.error}</div>
  const budgets = overview.data?.budgets ?? []
  const perPass = overview.data?.pointsPerPass ?? 30
  const passExtra = overview.data?.passExtra ?? 2_000

  return <div className="mx-auto flex w-full max-w-[1080px] flex-col gap-5 px-4 py-7 sm:px-6">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[28px] font-bold tracking-[-0.02em] text-ink">支出预算</h1>
        <p className="mt-2 max-w-[640px] text-[13px] leading-relaxed text-ink-soft">
          给容易超支的消费套一个每日限额：命中平台的钱在扣款前先过预算额度，超了这笔就花不出去。
          当天没花到门槛还能攒积分，换第二天的额外额度。
        </p>
      </div>
      <Tag tone="gold">只拦模拟消费 · 不冻结资金</Tag>
    </header>

    <div className="grid gap-5 lg:grid-cols-[1.25fr_.75fr]">
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader title="今日概览" action={<span className="num text-[13px] text-ink-mute">{overview.data?.today ?? '—'} · 上海时间</span>} />
          <dl className="mt-4 grid grid-cols-3 gap-3 text-[13px]">
            <div><dt className="text-ink-mute">预算总额度</dt><dd className="num mt-1 text-[18px] font-semibold text-ink">¥{formatAmount(totals.limit)}</dd></div>
            <div><dt className="text-ink-mute">已用</dt><dd className="num mt-1 text-[18px] font-semibold text-ink">¥{formatAmount(totals.used)}</dd></div>
            <div><dt className="text-ink-mute">可用积分</dt><dd className="num mt-1 text-[18px] font-semibold text-ink">{totals.points}</dd></div>
          </dl>
          <p className="mt-3 text-[12px] text-ink-mute">积分按上海自然日补算：当天该预算花钱低于门槛记 1 分，{perPass} 分换一次 +¥{formatAmount(passExtra)} 额度。</p>
        </Card>

        {budgets.length === 0 && !overview.loading && <Card>
          <EmptyState title="还没有支出预算" description="在右边建第一个，比如「奶茶预算」每日 ¥20" />
        </Card>}

        {budgets.map(budget => {
          const todayPass = budget.passes.filter(pass => pass.day === budget.today.day).reduce((sum, pass) => sum + pass.extra, 0)
          return <Card key={budget.id}>
            <CardHeader
              title={budget.name}
              action={<Tag tone={budget.enabled ? 'gold' : 'neutral'}>{budget.enabled ? '生效中' : '已停用'}</Tag>}
            />
            <p className="mt-1.5 text-[12px] text-ink-mute">{budget.merchantNames.join(' · ') || '未选平台'}</p>
            <div className="mt-4">
              <div className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="text-ink-soft">今日已用 <span className="num font-semibold text-ink">¥{formatAmount(budget.today.used)}</span> / ¥{formatAmount(budget.today.limit)}</span>
                <span className="num text-[12px] text-ink-mute">剩 ¥{formatAmount(budget.today.remaining)}</span>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-sunk" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progressWidth(budget.today.used, budget.today.limit))}>
                <div className="h-full rounded-full bg-gold" style={{ width: `${progressWidth(budget.today.used, budget.today.limit)}%` }} />
              </div>
              {todayPass > 0 && <p className="mt-2 text-[12px] text-gold-deep">今天已用掉 +¥{formatAmount(todayPass)} 额度券</p>}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3 text-[12px] text-ink-mute">
              <span>积分 <span className="num text-ink">{budget.points.available}</span>（已得 {budget.points.awarded} · 已用 {budget.points.used}）</span>
              <span>门槛 ¥{formatAmount(budget.pointThreshold)}/天</span>
              <span>{budget.passes.length} 张券</span>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" variant="primary" disabled={pendingId === budget.id || budget.points.available < perPass} onClick={() => void redeem(budget)}>
                兑换 +¥{formatAmount(passExtra)} 额度券
              </Button>
              <Button size="sm" variant="ghost" disabled={pendingId === budget.id} onClick={() => void toggleEnabled(budget)}>
                {budget.enabled ? '停用' : '启用'}
              </Button>
              <Button size="sm" variant="ghost" disabled={pendingId === budget.id} onClick={() => void remove(budget)}>
                {deleteArmed === budget.id ? '再点一次删除' : '删除'}
              </Button>
            </div>
          </Card>
        })}

        <Card>
          <CardHeader title="怎么算额度" />
          <ul className="mt-3 flex flex-col gap-2.5 text-[13px] leading-relaxed text-ink-soft">
            <li className="flex gap-2"><ReceiptIcon size={15} className="mt-0.5 shrink-0 text-ink-mute" />只拦「模拟消费」：转账、换汇、理财申赎都不经过预算，不会被限额挡住。</li>
            <li className="flex gap-2"><ReceiptIcon size={15} className="mt-0.5 shrink-0 text-ink-mute" />按上海自然日累计，只算扣款成功的消费；退款与冲正不会自动回冲当天额度。</li>
            <li className="flex gap-2"><ReceiptIcon size={15} className="mt-0.5 shrink-0 text-ink-mute" />自定义收单与 Stripe 不在预算覆盖范围内，预算只能选 12 个预设平台。</li>
            <li className="flex gap-2"><ArrowRightIcon size={15} className="mt-0.5 shrink-0 text-ink-mute" />去 <Link to="/spend" className="font-medium text-gold-deep">模拟消费</Link> 试试超额，服务端会返回预算名与剩余额度。</li>
          </ul>
        </Card>
      </div>

      <Card className="h-fit">
        <CardHeader title="新建预算" />
        <div className="mt-4 flex flex-col gap-4">
          <Field label="名字" value={name} maxLength={20} placeholder="奶茶预算" onChange={e => setName(e.target.value)} />
          <div>
            <p className="mb-2 text-[13px] font-medium text-ink-soft">覆盖平台（可多选）</p>
            <div className="grid grid-cols-2 gap-2">
              {SPEND_PLATFORMS.map(platform => {
                const active = platforms.includes(platform.id)
                return <button key={platform.id} type="button" onClick={() => togglePlatform(platform.id)}
                  className={`rounded-card border px-2.5 py-2 text-left text-[12px] transition-colors ${active ? 'border-gold bg-gold-tint text-ink' : 'border-line bg-surface text-ink-soft hover:bg-sunk'}`}>
                  {platform.name}
                </button>
              })}
            </div>
          </div>
          <Field label="每日限额（元）" value={limitText} inputMode="decimal"
            error={limit === null ? '请输入金额' : limit < 100 ? '最低 ¥1.00' : undefined}
            onChange={e => setLimitText(e.target.value)} />
          <Field label="积分门槛（元/天）" value={thresholdText} inputMode="decimal"
            hint="当天该预算花钱低于这个数记 1 分，0 消费也算达标"
            error={threshold === null ? '请输入金额' : undefined}
            onChange={e => setThresholdText(e.target.value)} />
          {formError && <p role="alert" className="text-[13px] text-coral">{formError}</p>}
          <Button block variant="primary" loading={creating} disabled={!canCreate} onClick={() => void create()}>
            创建预算
          </Button>
        </div>
      </Card>
    </div>
  </div>
}
