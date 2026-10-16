import { Link, useSearchParams } from 'react-router-dom'
import { api } from '@/api'
import { MoneyInDialog, MoneyOutDialog } from '@/components/account/MoneyDialogs'
import { CashFlowChart } from '@/components/charts/CashFlowChart'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { DataLoading, DataUnavailable } from '@/components/ui/DataUnavailable'
import { RevealToggle } from '@/components/ui/Reveal'
import { EmptyState, Skeleton } from '@/components/ui/Segmented'
import { TransactionRow } from '@/components/ui/TransactionRow'
import { ArrowDownLeftIcon, ArrowUpRightIcon, CardIcon, GlobalIcon } from '@/components/ui/icons'
import { CURRENCY_SYMBOL, formatCurrency, formatToday } from '@/lib/format'
import { useAsync } from '@/lib/useAsync'
import { useReveal } from '@/lib/useReveal'

/** 资金数据独立于智能首页，金额与流水始终来自当前账户接口。 */
export function DashboardPage() {
  const [params, setParams] = useSearchParams()
  const accounts = useAsync(() => api.listAccounts(), [])
  const current = accounts.data?.[0]
  const transactions = useAsync(async () => current ? { ...await api.listTransactions(current.id, { size: 5 }), accountId: current.id } : null, [current?.id])
  const visibleTransactions = transactions.data?.accountId === current?.id ? transactions.data : null
  const cashFlow = useAsync(() => api.getCashFlow(30), [])
  const balance = useReveal()
  const flow = params.get('flow')
  const openFlow = (value: 'in' | 'out') => setParams(previous => { const next = new URLSearchParams(previous); next.set('flow', value); return next })
  const closeFlow = () => setParams(previous => { const next = new URLSearchParams(previous); next.delete('flow'); return next }, { replace: true })
  const refresh = () => { accounts.reload(); transactions.reload(); cashFlow.reload() }

  if (accounts.error && !accounts.data) return <DataUnavailable message={accounts.error} onRetry={accounts.reload} />
  if (!accounts.data) return <DataLoading />
  return <div className="page-stack">
    <PageHeader title="账户资产" actions={<span className="text-[12px] text-ink-mute">{formatToday()}</span>} />
    {!current ? <Card><EmptyState title="暂无资金账户" /></Card> : <>
      <section className="account-summary-strip" aria-label="账户余额">
        <div className="account-summary-lead">
          <div className="flex items-center justify-between gap-3"><span>{current.label} · {current.currency}</span><RevealToggle shown={balance.shown} onToggle={balance.toggle} tone="onDark" /></div>
          <strong className="num">{balance.shown ? formatCurrency(current.balance, current.currency) : `${CURRENCY_SYMBOL[current.currency]}••••••`}</strong>
          <span className="num">尾号 {current.accountNo.slice(-4)}</span>
        </div>
        <div><span>可用余额</span><strong className="num">{balance.shown ? formatCurrency(current.available, current.currency) : '••••••'}</strong></div>
        <div><span>本月净变动</span><strong className="num">{balance.shown ? `${current.monthNetChange < 0 ? '-' : '+'}${formatCurrency(current.monthNetChange, current.currency)}` : '••••••'}</strong></div>
        <div className="account-summary-actions"><Button size="sm" onClick={() => openFlow('in')} icon={<ArrowDownLeftIcon size={16} />}>转入</Button><Button size="sm" variant="primary" onClick={() => openFlow('out')} icon={<ArrowUpRightIcon size={16} />}>转出</Button></div>
      </section>
      {accounts.data.length > 1 && <div className="account-balance-list" aria-label="其他资金账户">
        {accounts.data.slice(1).map(account => <article key={account.id}>
          <span>{account.label}<small>{account.currency} · 尾号 {account.accountNo.slice(-4)}</small></span>
          <strong className="num">{balance.shown ? formatCurrency(account.balance, account.currency) : '••••••'}</strong>
        </article>)}
      </div>}
      <div className="account-detail-grid">
        <Card><CardHeader title="最近交易" action={<Link to={`/analysis?account=${current.id}`} className="text-[13px] text-gold-deep">全部交易 →</Link>} />
          <div className="mt-3 divide-y divide-line">
            {!visibleTransactions && !transactions.error && <Skeleton className="h-40 rounded-field" />}
            {transactions.error && <DataUnavailable message={transactions.error} onRetry={transactions.reload} />}
            {!transactions.error && visibleTransactions?.items.map(tx => <TransactionRow key={tx.id} tx={tx} />)}
            {!transactions.error && visibleTransactions?.items.length === 0 && <EmptyState title="暂无交易记录" />}
          </div>
        </Card>
        <Card><CardHeader title="近 30 天现金流" action={<Link to="/cashflow" className="text-[13px] text-gold-deep">查看 →</Link>} />
          {cashFlow.loading && <Skeleton className="mt-5 h-40 rounded-field" />}
          {cashFlow.error && <DataUnavailable message={cashFlow.error} onRetry={cashFlow.reload} />}
          {cashFlow.data && (balance.shown ? <CashFlowChart points={cashFlow.data.points} /> : <div className="grid h-48 place-items-center text-ink-mute">••••••</div>)}
        </Card>
      </div>
      <div className="flex flex-wrap gap-3"><Link className="service-link gap-2" to="/cards"><CardIcon size={16} />银行卡管理</Link><Link className="service-link gap-2" to="/exchange"><GlobalIcon size={16} />多币种换汇</Link></div>
    </>}
    <MoneyInDialog open={flow === 'in'} onClose={closeFlow} onUpdate={refresh} />
    <MoneyOutDialog open={flow === 'out'} onClose={closeFlow} onUpdate={refresh} />
  </div>
}
