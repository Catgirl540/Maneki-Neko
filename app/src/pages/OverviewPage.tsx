import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '@/api'
import type { CashFlowPoint } from '@/api/types'
import { CashFlowChart } from '@/components/charts/CashFlowChart'
import { Donut, DonutLegend, type DonutSegment } from '@/components/charts/Donut'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardHeader } from '@/components/ui/Card'
import { DataLoading, DataUnavailable } from '@/components/ui/DataUnavailable'
import { RevealToggle } from '@/components/ui/Reveal'
import { EmptyState, Skeleton, Tag } from '@/components/ui/Segmented'
import { TransactionRow } from '@/components/ui/TransactionRow'
import { ArrowDownLeftIcon, CardIcon, ChartIcon, GlobalIcon, TransferIcon } from '@/components/ui/icons'
import { categoryColor } from '@/lib/categories'
import { cn } from '@/lib/cn'
import { CURRENCY_SYMBOL, formatCurrency, formatMoneySigned, formatToday } from '@/lib/format'
import { salaryPlanConfigured } from '@/lib/salary-plan'
import { useAsync } from '@/lib/useAsync'
import { useReveal } from '@/lib/useReveal'

/**
 * 总览页（/dashboard · 登录后落地页）。
 *
 * 布局：总资产（含人民币活期）｜快捷操作 → 近 30 天现金流｜待办 → 最近交易｜本月消费分类。
 * 初版依据 `docs/design/drafts/2026-10-20-overview-and-assistant.html` Sheet 2，已按用户要求去掉会员条与币种余额。
 * 助手不内嵌在本页，只在 /assistant 与业务页 docked 面板出现。
 */
export function OverviewPage() {
  const accounts = useAsync(() => api.listAccounts(), [])
  const current = accounts.data?.[0]
  const transactions = useAsync(async () => current ? { ...await api.listTransactions(current.id, { size: 8 }), accountId: current.id } : null, [current?.id])
  const visibleTransactions = transactions.data?.accountId === current?.id ? transactions.data : null
  const cashFlow = useAsync(() => api.getCashFlow(30), [])
  const spending = useAsync(() => api.getSpending(), [])
  const salaryPlan = useAsync(() => api.getSalaryPlan(), [])
  const cards = useAsync(() => api.listCards(), [])
  const autoDebits = useAsync(() => api.listAutoDebits(), [])
  const balance = useReveal()
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  // 进入页面那一刻的时点：自动扣款「3 日内到期」以此为基准。
  const [now] = useState(() => Date.now())

  if (accounts.error && !accounts.data) return <DataUnavailable message={accounts.error} onRetry={accounts.reload} />
  if (!accounts.data) return <DataLoading />

  /* —— 待办：四类真实数据源推导，全部为空时显示「暂无待办」 —— */
  const todos: { key: string; tone: 'gold' | 'coral' | 'blue'; text: string; to: string; action: string }[] = []
  if (salaryPlan.data && !salaryPlanConfigured(salaryPlan.data)) {
    todos.push({ key: 'salary', tone: 'gold', text: '未设置工资计划，设置后每月自动划转储蓄', to: '/cashflow', action: '去设置' })
  }
  const pendingCards = cards.data?.filter(card => card.status === 'pending').length ?? 0
  if (pendingCards > 0) {
    todos.push({ key: 'cards', tone: 'coral', text: `${pendingCards} 张银行卡待签收`, to: '/cards', action: '去签收' })
  }
  const inflight = visibleTransactions?.items.filter(tx => tx.status === 'pending' && tx.pendingReason === 'inflight').length ?? 0
  if (inflight > 0) {
    todos.push({ key: 'inflight', tone: 'coral', text: `${inflight} 笔在途转账可撤回`, to: '/transfer', action: '去撤回' })
  }
  for (const debit of autoDebits.data ?? []) {
    if (!debit.enabled || !debit.nextRunAt) continue
    const days = Math.ceil((Date.parse(debit.nextRunAt) - now) / 86_400_000)
    if (days >= 0 && days <= 3) {
      todos.push({ key: `debit-${debit.id}`, tone: 'blue', text: `自动扣款 ${days} 日内到期 ${formatCurrency(debit.amount, 'CNY')}（${debit.merchant}）`, to: '/analysis/autodebits', action: '查看合约' })
    }
  }
  const todosLoading = salaryPlan.loading || cards.loading || autoDebits.loading || transactions.loading

  const spendingSegments: DonutSegment[] = (spending.data?.categories ?? []).map(c => ({ ...c, color: categoryColor(c.key) }))

  return <div className="page-stack">
    <PageHeader title="总览" actions={<span className="text-[12px] text-ink-mute">{formatToday()}</span>} />
    {!current ? <Card><EmptyState title="暂无资金账户" /></Card> : <>
      {/* 总资产 ｜ 快捷操作 */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title="总资产" action={<span className="flex items-center gap-3">
            <Link to="/accounts" className="text-[13px] text-gold-deep">资产明细 →</Link>
            <RevealToggle shown={balance.shown} onToggle={balance.toggle} />
          </span>} />
          <div className="num mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-2">
            <span className="text-[clamp(28px,3.4vw,36px)] font-bold tracking-[-0.02em] text-ink">
              {balance.shown ? formatCurrency(current.balance, 'CNY') : `${CURRENCY_SYMBOL.CNY}••••••`}
            </span>
            <Tag tone={current.monthNetChange >= 0 ? 'blue' : 'coral'}>
              本月净变动 {balance.shown ? formatMoneySigned(current.monthNetChange) : '••••••'}
            </Tag>
          </div>
          <div className="mt-4 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-line pt-3">
            <span className="text-[13px] text-ink-soft">人民币活期</span>
            <span className="num text-[15px] font-medium text-ink">{balance.shown ? formatCurrency(current.balance, 'CNY') : `${CURRENCY_SYMBOL.CNY}••••••`}</span>
          </div>
          {cashFlow.data
            ? <div className={balance.shown ? undefined : 'pointer-events-none select-none blur-[14px] opacity-60'} aria-hidden={!balance.shown}><NetTrend points={cashFlow.data.points} /></div>
            : cashFlow.loading ? <Skeleton className="mt-4 h-[84px] rounded-field" /> : null}
          <p className="mt-3 text-[12px] text-ink-mute">近 30 天净额走势 · 仅含储蓄资金账户余额，理财与授信不计入</p>
        </Card>
        <Card>
          <CardHeader title="快捷操作" />
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Link className="service-link gap-2" to="/transfer"><TransferIcon size={16} />转账</Link>
            <Link className="service-link gap-2" to="/exchange"><GlobalIcon size={16} />多币种换汇</Link>
            <Link className="service-link gap-2" to="/accounts?flow=in"><ArrowDownLeftIcon size={16} />收款与转入</Link>
            <Link className="service-link gap-2" to="/cards"><CardIcon size={16} />银行卡管理</Link>
            <Link className="service-link col-span-2 gap-2" to="/analysis"><ChartIcon size={16} />账单与交易</Link>
          </div>
        </Card>
      </div>

      {/* 近 30 天现金流 ｜ 待办 */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title="近 30 天现金流" action={<Link to="/cashflow" className="text-[13px] text-gold-deep">查看 →</Link>} />
          {cashFlow.loading && <Skeleton className="mt-5 h-40 rounded-field" />}
          {cashFlow.error && <DataUnavailable message={cashFlow.error} onRetry={cashFlow.reload} />}
          {cashFlow.data && <div className={cn('mt-4', !balance.shown && 'pointer-events-none select-none blur-[14px] opacity-60')} aria-hidden={!balance.shown}><CashFlowChart points={cashFlow.data.points} currency={cashFlow.data.currency} /></div>}
        </Card>
        <Card>
          <CardHeader title="待办" action={todos.length > 0 ? <span className="text-[12px] text-ink-mute">{todos.length} 项</span> : undefined} />
          {todosLoading ? <Skeleton className="mt-4 h-32 rounded-field" /> : (
            <div className="mt-1 divide-y divide-line">
              {todos.map(todo => <div key={todo.key} className="flex items-center gap-3 py-3">
                <span className={cn('size-2 shrink-0 rounded-full', { gold: 'bg-gold', coral: 'bg-coral', blue: 'bg-blue' }[todo.tone])} aria-hidden="true" />
                <span className="num min-w-0 flex-1 text-[13px] leading-relaxed text-ink-soft">{todo.text}</span>
                <Link to={todo.to} className="shrink-0 text-[12px] text-gold-deep">{todo.action} →</Link>
              </div>)}
              {todos.length === 0 && <EmptyState title="暂无待办" />}
            </div>
          )}
        </Card>
      </div>

      {/* 最近交易 ｜ 本月消费分类 */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title="最近交易" action={<Link to={`/analysis?account=${current.id}`} className="text-[13px] text-gold-deep">全部交易 →</Link>} />
          <div className="mt-3 divide-y divide-line">
            {!visibleTransactions && !transactions.error && <Skeleton className="h-40 rounded-field" />}
            {transactions.error && <DataUnavailable message={transactions.error} onRetry={transactions.reload} />}
            {!transactions.error && visibleTransactions?.items.map(tx => <TransactionRow key={tx.id} tx={tx} />)}
            {!transactions.error && visibleTransactions?.items.length === 0 && <EmptyState title="暂无交易记录" />}
          </div>
        </Card>
        <Card>
          <CardHeader title="本月消费分类" action={<Link to="/analysis/statistics" className="text-[13px] text-gold-deep">查看 →</Link>} />
          {spending.loading && <Skeleton className="mt-5 h-48 rounded-field" />}
          {spending.error && <DataUnavailable message={spending.error} onRetry={spending.reload} />}
          {spending.data && (spendingSegments.length === 0 ? <EmptyState title="本月暂无消费分类" /> : (
            <div className="mt-5 flex flex-col items-center gap-6">
              <Donut segments={spendingSegments} size={164} centerLabel={spending.data.month + ' 合计'} centerValue={formatCurrency(spending.data.total, 'CNY')} activeKey={activeCategory} onActiveChange={setActiveCategory} />
              <div className="w-full min-w-0"><DonutLegend segments={spendingSegments} activeKey={activeCategory} onActiveChange={setActiveCategory} /></div>
            </div>
          ))}
          <p className="mt-4 text-[12px] text-ink-mute">分类由系统自动归类，仅供参考</p>
        </Card>
      </div>
    </>}
  </div>
}

/**
 * 总资产卡里的迷你走势：没有专门的总资产历史接口，用近 30 天现金流净额
 * 累加画净额走势（与草稿一致，标注为净额而非资产额）。
 */
function NetTrend({ points }: { points: CashFlowPoint[] }) {
  if (points.length < 2) return null
  const W = 520
  const H = 84
  const PAD = 8
  const net = points.map(p => p.income - p.expense)
  const values = net.map((_, i) => net.slice(0, i + 1).reduce((sum, v) => sum + v, 0))
  const min = Math.min(...values, 0)
  const max = Math.max(...values, 0)
  const span = max - min || 1
  const xOf = (index: number) => (index / (values.length - 1)) * W
  const yOf = (value: number) => PAD + (1 - (value - min) / span) * (H - PAD * 2)
  const line = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`).join(' ')
  const zeroY = yOf(0)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="mt-3 h-[84px] w-full" role="img" aria-label="近 30 天净额走势">
      <line x1={0} y1={zeroY} x2={W} y2={zeroY} stroke="var(--color-line)" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
      <path d={`${line} L${W},${H} L0,${H} Z`} fill="var(--color-gold)" opacity={0.07} stroke="none" />
      <path d={line} fill="none" stroke="var(--color-gold)" strokeWidth={1.8} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <circle cx={W} cy={yOf(values[values.length - 1])} r={2.6} fill="var(--color-gold)" />
    </svg>
  )
}
