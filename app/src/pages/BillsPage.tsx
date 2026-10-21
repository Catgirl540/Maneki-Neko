import { currencyBalances } from '@/lib/currencyBalances'
import { CURRENCY_LABEL } from '@/lib/format'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, ApiError } from '@/api'
import type { Transaction, TransactionCategory } from '@/api/types'
import { DataLoading, DataUnavailable } from '@/components/ui/DataUnavailable'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { Drawer } from '@/components/ui/Drawer'
import { PageHeader } from '@/components/layout/PageHeader'
import { TransactionRow } from '@/components/ui/TransactionRow'
import { EmptyState, Segmented, Skeleton } from '@/components/ui/Segmented'
import { CloseIcon, DownloadIcon, FilterIcon, SearchIcon } from '@/components/ui/icons'
import { CATEGORY_LABEL } from '@/lib/categories'
import {
  CATEGORY_OPTIONS,
  CURRENCY_OPTIONS,
  DEFAULT_FILTER,
  DIRECTION_OPTIONS,
  FILTER_KEYS,
  FILTER_PARAM_KEYS,
  RANGE_OPTIONS,
  countActive,
  rangeBounds,
  readFilter,
  type BillsFilter,
} from '@/lib/billsFilter'
import { toCsv } from '@/lib/csv'
import { downloadText } from '@/lib/download'
import { useAsync } from '@/lib/useAsync'
import { useResetOnOpen } from '@/lib/usePresence'
import { useToast } from '@/components/ui/toast-context'

/**
 * 分类快捷 chips。口径与 `lib/categories.ts` 一致 —— 筛选抽屉里能选的 8 类
 * 这里都得能选到，否则从抽屉选了「转账」而这一行没有任何项高亮，
 * 同一组条件在两个控件上会显示成互相矛盾的状态。
 */
const FILTERS: { value: TransactionCategory | 'all'; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'dining', label: '餐饮' },
  { value: 'shopping', label: '购物' },
  { value: 'housing', label: '房租' },
  { value: 'transport', label: '交通' },
  { value: 'subscription', label: '订阅' },
  { value: 'transfer', label: '转账' },
  { value: 'salary', label: '工资入账' },
  { value: 'other', label: '其他' },
]
const PAGE_SIZE = 6

/** 抽屉里的一组单选 chips。用 `aria-pressed` 而不是 radiogroup：后者承诺方向键切换。 */
function FilterGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: { value: T; label: string }[]
  value: T
  onChange: (next: T) => void
}) {
  return (
    <section className="border-t border-line py-4 first:border-t-0">
      <h3 className="text-[13px] font-medium text-ink-soft">{label}</h3>
      <div role="group" aria-label={label} className="mt-2.5 flex flex-wrap gap-2">
        {options.map((option) => {
          const active = option.value === value
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(option.value)}
              className={`min-h-9 rounded-chip border px-3 text-[13px] transition-colors ${active
                ? 'border-gold bg-gold-wash font-medium text-gold-deep'
                : 'border-line text-ink-soft hover:border-line-strong hover:text-ink'}`}
            >
              {option.label}
            </button>
          )
        })}
      </div>
    </section>
  )
}

export function BillsPage() {
  const toast = useToast()
  const [exporting, setExporting] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()
  const keyword = searchParams.get('q') ?? ''
  const [keywordDraft, setKeywordDraft] = useState(keyword)
  const selectedAccountId = searchParams.get('account') ?? ''
  const filter = readFilter(searchParams)
  const { direction, category, range, currency } = filter
  const activeCount = countActive(filter)
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
  const setCategory = (value: TransactionCategory | 'all') => setFilter(FILTER_KEYS.category, value)
  /**
   * 币种 chips 选的是**同一资金账户下的余额分区**（`account` 参数），不是新账户。
   * 手动点分区等于明确"就看这个币种的账"，所以同时摘掉抽屉里的币种条件，
   * 免得两个控件各说一套、把列表筛成空。
   */
  const setSelectedAccountId = (value: string) => setSearchParams(previous => {
    const next = new URLSearchParams(previous)
    next.delete('page')
    next.delete(FILTER_KEYS.currency)
    if (value) next.set('account', value)
    else next.delete('account')
    return next
  }, { replace: true })
  const account = useAsync(() => api.listAccounts(), [])
  const balances = currencyBalances(account.data ?? [])
  // 抽屉里选了具体币种 → 直接用该币种的记账分区；否则沿用 chips 选的分区。
  const currencyBalance = currency === 'all' ? undefined : balances.find(row => row.currency === currency)
  const accountId = currencyBalance?.id ?? balances.find(row => row.id === selectedAccountId)?.id ?? balances[0]?.id
  const bounds = rangeBounds(range)
  const queryKey = JSON.stringify([accountId, category, keyword, page, direction, currency, bounds.from, bounds.to])
  const transactions = useAsync<{ items: Transaction[]; total: number; queryKey: string }>(
    async () => ({
      ...(accountId
        ? await api.listTransactions(accountId, {
            page,
            size: PAGE_SIZE,
            category,
            keyword,
            direction,
            currency,
            from: bounds.from,
            to: bounds.to,
          })
        : { items: [], total: 0 }),
      queryKey,
    }),
    [accountId, category, keyword, page, direction, currency, bounds.from, bounds.to],
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

  // 抽屉里的改动先落在草稿上，按「应用」才写进 URL —— 否则每组点一下列表就重拉一次。
  const [filterOpen, setFilterOpen] = useState(false)
  const [draft, setDraft] = useState<BillsFilter>(filter)
  useResetOnOpen(filterOpen, () => setDraft(filter))
  const applyFilter = () => {
    setSearchParams(previous => {
      const next = new URLSearchParams(previous)
      next.delete('page')
      for (const key of FILTER_PARAM_KEYS) {
        const value = draft[key]
        if (value && value !== 'all') next.set(key, value)
        else next.delete(key)
      }
      return next
    }, { replace: true })
    setFilterOpen(false)
  }
  const clearAllFilters = () => {
    setKeywordDraft('')
    setSearchParams(previous => {
      const next = new URLSearchParams(previous)
      next.delete('q')
      next.delete('page')
      for (const key of FILTER_PARAM_KEYS) next.delete(key)
      return next
    }, { replace: true })
  }

  async function exportCsv() {
    if (!accountId) return
    setExporting(true)
    try {
      // 导出必须套用同一组条件：屏幕上筛过的范围，导出的 CSV 里也得是这些行。
      const dataset = await api.exportTransactions(accountId, {
        category,
        keyword,
        direction,
        currency,
        from: bounds.from,
        to: bounds.to,
      })
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

  const requests = [account, transactions]
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

        {balances.length > 1 && (
          <div className="mt-5 flex flex-wrap gap-2" aria-label="选择流水币种">
            {balances.map((row) => {
              return <button key={row.id} type="button" onClick={() => setSelectedAccountId(row.id)}
                aria-pressed={accountId === row.id}
                className={`rounded-chip border px-3 py-2 text-[12px] transition-colors ${accountId === row.id
                  ? 'border-gold bg-gold-wash text-gold-deep'
                  : 'border-line text-ink-soft hover:border-gold'}`}>
                {CURRENCY_LABEL[row.currency]} · {row.currency}
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
          <button
            type="button"
            onClick={() => setFilterOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={filterOpen}
            className={`relative ml-auto inline-flex h-11 items-center gap-2 rounded-chip border px-3.5 text-[13px] font-medium transition-colors ${activeCount > 0
              ? 'border-ink-deep bg-ink-deep text-ink-invert'
              : 'border-line bg-surface text-ink-soft hover:border-line-strong hover:text-ink'}`}
          >
            <FilterIcon size={16} />
            筛选
            {activeCount > 0 && (
              <>
                <span
                  aria-hidden="true"
                  className="num absolute -top-1.5 -right-1.5 grid min-w-[18px] place-items-center rounded-full bg-gold px-1 text-[11px] leading-[18px] font-semibold text-ink-invert"
                >
                  {activeCount}
                </span>
                <span className="sr-only">已选 {activeCount} 项</span>
              </>
            )}
          </button>
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
              description={page > 1 ? undefined : '换个分类、关键词或筛选条件再试试。'}
              action={
                <Button
                  size="sm"
                  onClick={() => {
                    if (page > 1) { setPage(1); return }
                    clearAllFilters()
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

      <Drawer
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        title="筛选"
        description="同一资金账户下的流水，按条件缩小范围。"
        footer={
          <>
            <Button block onClick={() => setDraft(DEFAULT_FILTER)}>重置</Button>
            <Button block variant="ink" onClick={applyFilter}>应用</Button>
          </>
        }
      >
        <FilterGroup label="收支" options={DIRECTION_OPTIONS} value={draft.direction} onChange={(value) => setDraft(prev => ({ ...prev, direction: value }))} />
        <FilterGroup label="分类" options={CATEGORY_OPTIONS} value={draft.category} onChange={(value) => setDraft(prev => ({ ...prev, category: value }))} />
        <FilterGroup label="时间范围" options={RANGE_OPTIONS} value={draft.range} onChange={(value) => setDraft(prev => ({ ...prev, range: value }))} />
        <FilterGroup label="币种" options={CURRENCY_OPTIONS} value={draft.currency} onChange={(value) => setDraft(prev => ({ ...prev, currency: value }))} />
      </Drawer>

    </div>
  )
}
