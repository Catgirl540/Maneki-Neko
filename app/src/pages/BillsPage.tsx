import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, ApiError } from '@/api'
import type { BankCard, Transaction, TransactionCategory } from '@/api/types'
import { DataLoading, DataUnavailable } from '@/components/ui/DataUnavailable'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { PageHeader } from '@/components/layout/PageHeader'
import { TransactionRow } from '@/components/ui/TransactionRow'
import { EmptyState, Segmented, Skeleton } from '@/components/ui/Segmented'
import { CloseIcon, DownloadIcon, SearchIcon } from '@/components/ui/icons'
import { CATEGORY_LABEL } from '@/lib/categories'
import { toCsv } from '@/lib/csv'
import { downloadText } from '@/lib/download'
import { useAsync } from '@/lib/useAsync'
import { useToast } from '@/components/ui/toast-context'

const FILTERS: { value: TransactionCategory | 'all'; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'dining', label: '餐饮' },
  { value: 'shopping', label: '购物' },
  { value: 'housing', label: '房租' },
  { value: 'transport', label: '交通' },
  { value: 'subscription', label: '订阅' },
]
const PAGE_SIZE = 6

export function BillsPage() {
  const toast = useToast()
  const [exporting, setExporting] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()
  const keyword = searchParams.get('q') ?? ''
  const [keywordDraft, setKeywordDraft] = useState(keyword)
  const selectedAccountId = searchParams.get('account') ?? ''
  const candidate = searchParams.get('category') ?? 'all'
  const category = (FILTERS.some(item => item.value === candidate) ? candidate : 'all') as TransactionCategory | 'all'
  const rawPage = Number(searchParams.get('page') ?? '1')
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1
  const setFilter = (key: string, value: string) => setSearchParams(previous => {
    const next = new URLSearchParams(previous)
    next.delete('page')
    if (value && value !== 'all') next.set(key, value)
    else next.delete(key)
    return next
  }, { replace: true })
  const setKeyword = (value: string) => setFilter('q', value)
  const setCategory = (value: TransactionCategory | 'all') => setFilter('category', value)
  const setSelectedAccountId = (value: string) => setFilter('account', value)
  const account = useAsync(() => api.listAccounts(), [])
  const cards = useAsync<BankCard[]>(() => api.listCards(), [])
  const accountId = account.data?.find(row => row.id === selectedAccountId)?.id ?? account.data?.[0]?.id
  const queryKey = JSON.stringify([accountId, category, keyword, page])
  const transactions = useAsync<{ items: Transaction[]; total: number; queryKey: string }>(
    async () => ({ ...(accountId ? await api.listTransactions(accountId, { page, size: PAGE_SIZE, category, keyword }) : { items: [], total: 0 }), queryKey }),
    [accountId, category, keyword, page],
  )
  // 换页/筛选后不能将上一页的缓存显示为新页结果。
  const visibleTransactions = transactions.data?.queryKey === queryKey ? transactions.data : null
  const totalPages = Math.max(1, Math.ceil((visibleTransactions?.total ?? 0) / PAGE_SIZE))
  const setPage = (value: number) => setSearchParams(previous => {
    const next = new URLSearchParams(previous)
    if (value === 1) next.delete('page')
    else next.set('page', String(value))
    return next
  })

  async function exportCsv() {
    if (!accountId) return
    setExporting(true)
    try {
      const dataset = await api.exportTransactions(accountId, { category, keyword })
      if (dataset.total === 0) {
        toast.show('当前筛选条件下没有可导出的流水', 'info')
        return
      }
      downloadText(dataset.fileName, toCsv(dataset.columns, dataset.rows))
      toast.show(`已导出 ${dataset.total} 笔流水 · 批次 ${dataset.batchNo}`, 'success')
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : '导出失败，请稍后重试', 'error')
    } finally {
      setExporting(false)
    }
  }

  const requests = [account, cards, transactions]
  const failed = requests.filter(state => state.error !== null && state.data === null)
  if (failed.length) return <DataUnavailable message={failed[0]!.error!} onRetry={() => failed.forEach(state => state.reload())} />
  if (requests.some(state => state.loading && state.data === null)) return <DataLoading />
  return (
    <div className="page-stack">
      <PageHeader
        title="账单"
        actions={
          <>
            <Link to="/analysis/statistics" className="inline-flex min-h-11 items-center rounded-chip border border-line bg-surface px-4 hover:border-gold">收支分析</Link>
            <Link to="/analysis/autodebits" className="inline-flex min-h-11 items-center rounded-chip border border-line bg-surface px-4 hover:border-gold">自动扣款</Link>
          </>
        }
      />
      {/* 流水 */}
      <Card className="float-up" style={{ animationDelay: '180ms' }}>
        <CardHeader
          title="交易流水"
          action={
            <div className="flex items-center gap-4">
              <span className="num text-[13px] text-ink-mute">
                共 {visibleTransactions?.total ?? '—'} 笔
              </span>
              <Button
                size="sm"
                icon={<DownloadIcon size={16} />}
                loading={exporting}
                disabled={!accountId}
                onClick={() => void exportCsv()}
              >
                导出流水
              </Button>
            </div>
          }
        />

        {(account.data?.length ?? 0) > 1 && (
          <div className="mt-5 flex flex-wrap gap-2" aria-label="选择流水账户">
            {account.data?.map((row) => {
              const card = cards.data?.find((item) => item.accountId === row.id && item.status !== 'replaced')
              return <button key={row.id} type="button" onClick={() => setSelectedAccountId(row.id)}
                aria-pressed={accountId === row.id}
                className={`rounded-chip border px-3 py-2 text-[12px] transition-colors ${accountId === row.id
                  ? 'border-gold bg-gold-wash text-gold-deep'
                  : 'border-line text-ink-soft hover:border-gold'}`}>
                {card?.productName ?? row.label} · 尾号 {card?.last4 ?? row.accountNo.slice(-4)}
              </button>
            })}
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Segmented value={category} options={FILTERS} onChange={setCategory} />
          <form
            role="search"
            onSubmit={(e) => { e.preventDefault(); setKeyword(keywordDraft.trim()) }}
            className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-chip border border-line bg-surface px-3 transition-colors focus-within:border-gold sm:max-w-[360px] sm:gap-3 sm:px-4"
          >
            <SearchIcon size={18} className="shrink-0 text-ink-mute" />
            <input
              type="search"
              value={keywordDraft}
              onChange={(e) => setKeywordDraft(e.target.value)}
              placeholder="搜索交易"
              aria-label="交易搜索"
              className="h-full min-w-0 w-full bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-mute"
            />
            {keywordDraft && (
              <button
                type="button"
                onClick={() => { setKeywordDraft(''); setKeyword('') }}
                aria-label="清除关键词"
                className="grid size-6 shrink-0 place-items-center rounded-chip text-ink-mute transition-colors hover:bg-sunk hover:text-ink"
              >
                <CloseIcon size={16} />
              </button>
            )}
            <button type="submit" className="sr-only">搜索</button>
          </form>
        </div>

        <div className="mt-3 divide-y divide-line">
          {!visibleTransactions && !transactions.error &&
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 py-4">
                <Skeleton className="size-10 rounded-chip" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4 w-20" />
              </div>
            ))}

          {transactions.error && <div role="alert" className="py-4 text-[13px] text-coral"><p>{transactions.error}</p><Button size="sm" className="mt-3" onClick={transactions.reload}>重新加载流水</Button></div>}

          {visibleTransactions?.items.map((tx) => (
            <TransactionRow key={tx.id} tx={tx} showAccount={CATEGORY_LABEL[tx.category]} />
          ))}

          {visibleTransactions?.items.length === 0 && (
            <EmptyState
              title={page > 1 ? '此页暂无流水' : '没有匹配的流水'}
              description={page > 1 ? undefined : '换个分类或关键词再试试。'}
              action={
                <Button
                  size="sm"
                  onClick={() => {
                    if (page > 1) { setPage(1); return }
                    setKeywordDraft('')
                    setSearchParams(previous => {
                      const next = new URLSearchParams(previous)
                      next.delete('category')
                      next.delete('q')
                      next.delete('page')
                      return next
                    }, { replace: true })
                  }}
                >
                  {page > 1 ? '回到第一页' : '清空筛选'}
                </Button>
              }
            />
          )}
        </div>
        {visibleTransactions && (totalPages > 1 || page > 1) && (
          <nav aria-label="流水分页" className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <span className="num text-[13px] text-ink-mute">第 {page} 页 / 共 {totalPages} 页</span>
            <div className="flex gap-2">
              <Button size="sm" disabled={page <= 1 || transactions.refreshing} onClick={() => setPage(Math.min(page - 1, totalPages))}>上一页</Button>
              <Button size="sm" disabled={page >= totalPages || transactions.refreshing} onClick={() => setPage(page + 1)}>下一页</Button>
            </div>
          </nav>
        )}
      </Card>

    </div>
  )
}
