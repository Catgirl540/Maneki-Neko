import { Link, useSearchParams } from 'react-router-dom'
import { api } from '@/api'
import type { Paged, Transaction } from '@/api/types'
import { MoneyInDialog, MoneyOutDialog } from '@/components/account/MoneyDialogs'
import { CatMark } from '@/components/brand/Logo'
import { CashFlowChart } from '@/components/charts/CashFlowChart'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { DataLoading, DataUnavailable } from '@/components/ui/DataUnavailable'
import { RevealToggle } from '@/components/ui/Reveal'
import { EmptyState, Skeleton } from '@/components/ui/Segmented'
import { TransactionRow } from '@/components/ui/TransactionRow'
import {
  ArrowDownLeftIcon,
  ArrowUpRightIcon,
  CardIcon,
  ChartIcon,
  ChevronRightIcon,
  GlobalIcon,
  PigIcon,
  TransferIcon,
} from '@/components/ui/icons'
import { CURRENCY_SYMBOL, formatCurrency, formatToday } from '@/lib/format'
import { useAsync } from '@/lib/useAsync'
import { useReveal } from '@/lib/useReveal'

/** 首屏高频操作：桌面端一屏内即可点开，其余功能下移。 */
const QUICK_ACTIONS = [
  { to: '/transfer', label: '转账', desc: '转给他人或跨行汇款', Icon: TransferIcon },
  { to: '/analysis', label: '账单', desc: '收支明细与统计', Icon: ChartIcon },
  { to: '/cards', label: '银行卡', desc: '卡片与限额管理', Icon: CardIcon },
  { to: '/dashboard/savings', label: '存钱计划', desc: '零钱自动攒起来', Icon: PigIcon },
  { to: '/exchange', label: '多币种换汇', desc: '按实时汇率兑换', Icon: GlobalIcon },
]

const MORE_SERVICES = [
  { to: '/cashflow', label: '工资与备用金', desc: '发薪计划与小额透支' },
  { to: '/credit', label: '借款与分期', desc: '额度、借款与账单分期' },
  { to: '/wealth/cash-management', label: '现金管理', desc: '活期自动转入货币基金' },
  { to: '/wealth/investments', label: '投资与定投', desc: '基金定投与智能投顾' },
  { to: '/wealth/insurance', label: '保险保障', desc: '医疗重疾与意外保障' },
]

export function DashboardPage() {
  const [params, setParams] = useSearchParams()
  const flow = params.get('flow')
  const accounts = useAsync(() => api.listAccounts(), [])
  const current = accounts.data?.[0]
  const transactions = useAsync<Paged<Transaction> | null>(() => current ? api.listTransactions(current.id, { size: 5 }) : Promise.resolve(null), [current?.id])
  const cashFlow = useAsync(() => api.getCashFlow(30), [])
  const balance = useReveal()
  const openFlow = (value: 'in' | 'out') => setParams(previous => { const next = new URLSearchParams(previous); next.set('flow', value); return next })
  const closeFlow = () => setParams(previous => { const next = new URLSearchParams(previous); next.delete('flow'); return next }, { replace: true })
  const refresh = () => { accounts.reload(); transactions.reload(); cashFlow.reload() }

  if (accounts.error && !accounts.data) return <DataUnavailable message={accounts.error} onRetry={accounts.reload} />
  if (!accounts.data) return <DataLoading />
  return (
    <div className="page-stack">
      <PageHeader title="账户概览" actions={<p className="text-[12px] text-ink-mute">{formatToday()}</p>} />
      {!current ? <Card><EmptyState title="暂无资金账户" /></Card> : <>
        {/* 首屏：左侧余额主卡 + 右侧高频操作，桌面上无需滚动即可点开常用功能 */}
        <div className="grid items-stretch gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <section aria-label="账户余额" className="relative flex min-w-0 flex-col overflow-hidden rounded-card bg-ink p-5 text-ink-invert sm:p-8">
            <CatMark className="pointer-events-none absolute top-6 right-6 size-28 text-white/[0.06]" cutout="var(--color-ink)" />
            <div className="relative flex items-center gap-2 text-[12px] text-white/65"><span className="size-1.5 rounded-full bg-gold" />{current.label}<span className="ml-1 rounded-chip border border-white/20 px-2 py-0.5">{current.currency}</span></div>
            <p className="relative mt-6 text-[13px] text-white/65">储蓄账户余额</p>
            <div className="relative mt-2 flex flex-wrap items-center gap-3">
              <span className="num text-[clamp(30px,4vw,44px)] leading-tight font-semibold tracking-[-0.03em]">{balance.shown ? formatCurrency(current.balance, current.currency) : `${CURRENCY_SYMBOL[current.currency]}••••••`}</span>
              <RevealToggle shown={balance.shown} onToggle={balance.toggle} tone="onDark" />
            </div>
            <p className="num relative mt-3 break-all text-[12px] tracking-wide text-white/50">{current.accountNo}</p>
            <dl className="relative mt-6 grid grid-cols-2 gap-3 border-t border-white/15 pt-5">
              <div><dt className="text-[12px] text-white/60">可用余额</dt><dd className="num mt-1.5 break-all text-[16px] font-medium">{balance.shown ? formatCurrency(current.available, current.currency) : '••••••'}</dd></div>
              <div><dt className="text-[12px] text-white/60">本月净变动</dt><dd className="num mt-1.5 break-all text-[16px] font-medium">{balance.shown ? `${current.monthNetChange < 0 ? '-' : '+'}${formatCurrency(current.monthNetChange, current.currency)}` : '••••••'}</dd></div>
            </dl>
            <div className="relative mt-auto grid grid-cols-2 gap-3 pt-6">
              <button type="button" onClick={() => openFlow('in')} className="inline-flex h-12 items-center justify-center gap-2 rounded-chip border border-white/20 bg-white/10 text-[14px] font-medium text-white transition-colors hover:bg-white/20"><ArrowDownLeftIcon size={18} />转入</button>
              <button type="button" onClick={() => openFlow('out')} className="inline-flex h-12 items-center justify-center gap-2 rounded-chip bg-gold text-[14px] font-medium text-ink transition-colors hover:bg-gold-wash"><ArrowUpRightIcon size={18} />转出</button>
            </div>
          </section>
          <Card as="section" className="flex flex-col" aria-label="常用功能">
            <CardHeader title="常用功能" />
            <ul className="mt-4 flex flex-1 flex-col gap-2">
              {QUICK_ACTIONS.map(({ to, label, desc, Icon }) => (
                <li key={to} className="flex-1">
                  <Link to={to} className="group flex h-full min-h-11 items-center gap-3 rounded-tile border border-line bg-surface px-3.5 py-2.5 transition-colors hover:border-gold-wash hover:bg-gold-tint">
                    <span className="grid size-9 shrink-0 place-items-center rounded-tile bg-gold-tint text-gold-deep transition-colors group-hover:bg-gold-wash"><Icon size={19} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] font-medium text-ink">{label}</span>
                      <span className="mt-0.5 block truncate text-[12px] text-ink-mute">{desc}</span>
                    </span>
                    <ChevronRightIcon size={16} className="shrink-0 text-ink-mute transition-colors group-hover:text-gold-deep" />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </div>
        {/* 折叠之下：数据与流水，首屏之外的深度内容 */}
        <Card>
          <CardHeader title="近 30 天收支" />
          {cashFlow.error && !cashFlow.data ? <SectionError message={cashFlow.error} onRetry={cashFlow.reload} /> : !cashFlow.data ? <Skeleton className="mt-6 h-64 w-full" /> : <>
            <dl className="mt-6 grid grid-cols-2 gap-3">
              <div><dt className="flex items-center gap-2 text-[12px] text-ink-mute"><span className="size-1.5 rounded-full bg-gold" />收入</dt><dd className="num mt-2 break-all text-[clamp(19px,2.2vw,26px)] font-semibold">{formatCurrency(cashFlow.data.totalIncome, 'CNY')}</dd></div>
              <div><dt className="flex items-center gap-2 text-[12px] text-ink-mute"><span className="size-1.5 rounded-full bg-blue" />支出</dt><dd className="num mt-2 break-all text-[clamp(19px,2.2vw,26px)] font-semibold">{formatCurrency(cashFlow.data.totalExpense, 'CNY')}</dd></div>
            </dl>
            <div className="mt-6"><CashFlowChart points={cashFlow.data.points} maxTicks={4} /></div>
          </>}
        </Card>
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <Card>
            <CardHeader title="最近交易" action={<Link to="/analysis" className="inline-flex min-h-10 items-center gap-1 text-[13px] text-gold-deep hover:underline">查看账单<ChevronRightIcon size={15} /></Link>} />
            {transactions.error && !transactions.data ? <SectionError message={transactions.error} onRetry={transactions.reload} /> : !transactions.data ? <Skeleton className="mt-4 h-56 w-full" /> : <div className="mt-2 divide-y divide-line">
              {transactions.data.items.map(tx => <TransactionRow key={tx.id} tx={tx} />)}
              {transactions.data.items.length === 0 && <EmptyState title="还没有交易记录" />}
            </div>}
          </Card>
          <Card>
            <CardHeader title="资金账户" action={<span className="inline-flex flex-wrap items-center gap-3"><Link to="/dashboard/savings" className="inline-flex min-h-10 items-center gap-1 text-[13px] text-gold-deep hover:underline">存钱计划<ChevronRightIcon size={15} /></Link><Link to="/exchange" className="inline-flex min-h-10 items-center gap-1 text-[13px] text-gold-deep hover:underline">多币种换汇<ChevronRightIcon size={15} /></Link><Link to="/cards" className="inline-flex min-h-10 items-center gap-1 text-[13px] text-gold-deep hover:underline">银行卡管理<ChevronRightIcon size={15} /></Link></span>} />
            <p className="mt-1 text-[12px] text-ink-mute">{accounts.data.length} 个资金账户</p>
            <ul className="mt-4 divide-y divide-line">
              {accounts.data.map(account => <li key={account.id} className="flex min-w-0 items-start gap-3 py-4">
                <span className="grid size-10 shrink-0 place-items-center rounded-tile bg-gold-tint text-gold-deep"><CardIcon size={20} /></span>
                <div className="min-w-0 flex-1"><p className="text-[14px] font-medium text-ink">{account.label}</p><p className="num mt-1 text-[12px] text-ink-mute">尾号 {account.accountNo.slice(-4)} · {account.currency}</p><p className="num mt-2 text-[17px] font-semibold text-ink">{balance.shown ? formatCurrency(account.balance, account.currency) : '••••••'}</p></div>
              </li>)}
            </ul>

          </Card>
        </div>
        {/* 第二屏：其余服务入口 */}
        <Card as="section" aria-label="更多服务">
          <CardHeader title="更多服务" />
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {MORE_SERVICES.map((service) => (
              <Link key={service.to} to={service.to} className="flex min-h-16 items-center justify-between gap-3 rounded-tile border border-line bg-surface px-4 py-3 transition-colors hover:border-gold-wash hover:bg-gold-tint">
                <span className="min-w-0">
                  <span className="block text-[14px] font-medium text-ink">{service.label}</span>
                  <span className="mt-0.5 block text-[12px] text-ink-mute">{service.desc}</span>
                </span>
                <ChevronRightIcon size={16} className="shrink-0 text-gold-deep" />
              </Link>
            ))}
          </div>
        </Card>
      </>}
      <MoneyInDialog open={flow === 'in' && !!current} onClose={closeFlow} onUpdate={refresh} />
      <MoneyOutDialog open={flow === 'out' && !!current} onClose={closeFlow} onUpdate={refresh} />
    </div>
  )
}

function SectionError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div role="alert" className="mt-5"><p className="text-[13px] text-ink-soft">{message}</p><Button size="sm" className="mt-3" onClick={onRetry}>重新加载</Button></div>
}
