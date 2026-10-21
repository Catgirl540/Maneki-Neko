import { Link, useSearchParams } from 'react-router-dom'
import { api } from '@/api'
import { WealthHeader } from '@/components/wealth/WealthHeader'
import { Button } from '@/components/ui/Button'
import { EmptyState, Segmented, Tag } from '@/components/ui/Segmented'
import { DataLoading, DataUnavailable } from '@/components/ui/DataUnavailable'
import { useAsync } from '@/lib/useAsync'
import { formatAmount, formatDateTimeFull } from '@/lib/format'
import { wealthRecordQuery } from '@/lib/wealth-workspace'

/** 展示既有资金流水，不能将记账成功冒充理财订单已确认或赎回已到账。 */
export function WealthRecordsPage() {
  const [params, setParams] = useSearchParams()
  const kind = params.get('type') === 'redeem' ? 'redeem' : 'subscribe'
  const rawPage = Number(params.get('page') ?? 1)
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1
  const accounts = useAsync(() => api.listAccounts(), [])
  const accountId = accounts.data?.[0]?.id
  const queryKey = JSON.stringify([accountId, kind, page])
  const records = useAsync(async () => ({
    ...(accountId ? await api.listTransactions(accountId, wealthRecordQuery(kind, page)) : { items: [], total: 0 }), queryKey,
  }), [accountId, kind, page])
  const visible = records.data?.queryKey === queryKey ? records.data : null
  function update(key: 'type' | 'page', value: string) {
    setParams(previous => { const next = new URLSearchParams(previous); if (key === 'type') next.delete('page'); next.set(key, value); return next })
  }
  const failed = accounts.error ?? records.error
  return <div className="wealth-workspace">
    <WealthHeader title="交易记录" />
    <section className="wealth-section">
      <div className="wealth-section-heading"><Segmented value={kind} onChange={value => update('type', value)} options={[{ value: 'subscribe', label: '申购资金流水' }, { value: 'redeem', label: '赎回资金流水' }]} /><span className="text-[12px] text-ink-mute">人民币 · CNY</span></div>
      <p className="mb-5 text-[12px] leading-relaxed text-ink-mute">展示储蓄资金账户的申赎记账记录。份额以持仓为准，赎回到账以银行回执与资金流水为准。</p>
      {failed ? <DataUnavailable message={failed} onRetry={() => { accounts.reload(); records.reload() }} /> : !accounts.data || !visible ? <DataLoading /> : <>
        {visible.items.length > 0 ? <div className="wealth-table-scroll"><table className="wealth-table"><thead><tr><th scope="col">产品 / 业务</th><th scope="col">记账金额</th><th scope="col">记账时间</th><th scope="col">资金记账状态</th><th scope="col">操作</th></tr></thead><tbody>{visible.items.map(transaction => <tr key={transaction.id}>
          <td><strong>{transaction.counterparty}</strong><small>{transaction.memo}</small></td>
          <td className="num">{transaction.direction === 'in' ? '+' : '-'}¥{formatAmount(transaction.amount)}</td>
          <td className="num">{formatDateTimeFull(transaction.createdAt)}</td>
          <td><Tag tone={transaction.status === 'success' ? 'blue' : transaction.status === 'failed' ? 'coral' : 'neutral'}>{transaction.status === 'success' ? '已记账' : transaction.status === 'failed' ? '记账失败' : '处理中'}</Tag></td>
          <td><Link className="text-gold-deep" to={`/transactions/${encodeURIComponent(transaction.id)}`}>详情与回单 →</Link></td>
        </tr>)}</tbody></table></div> : <EmptyState title={page > 1 ? '此页暂无记录' : '暂无相关资金流水'} action={page > 1 ? <Button size="sm" onClick={() => update('page', '1')}>回到第一页</Button> : <Link className="service-link" to="/wealth/products">浏览产品</Link>} />}
        {(visible.total > 10 || page > 1) && <nav aria-label="理财流水分页" className="mt-5 flex items-center justify-between border-t border-line pt-4"><span className="text-[12px] text-ink-mute">共 {visible.total} 条 · 第 {page} 页</span><div className="flex gap-2"><Button size="sm" disabled={page <= 1 || records.refreshing} onClick={() => update('page', String(page - 1))}>上一页</Button><Button size="sm" disabled={page * 10 >= visible.total || records.refreshing} onClick={() => update('page', String(page + 1))}>下一页</Button></div></nav>}
      </>}
    </section>
  </div>
}
