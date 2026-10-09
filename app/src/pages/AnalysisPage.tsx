import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, ApiError } from '@/api'
import type { AutoDebit, BankCard, SpendingAnalysis, Transaction, TransactionCategory } from '@/api/types'
import { Donut, DonutLegend, type DonutSegment } from '@/components/charts/Donut'
import { TrendBars } from '@/components/charts/TrendBars'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { CategoryIcon } from '@/components/ui/CategoryIcon'
import { TransactionRow } from '@/components/ui/TransactionRow'
import { EmptyState, Segmented, Skeleton, Tag } from '@/components/ui/Segmented'
import { Row, Toggle } from '@/components/ui/Toggle'
import { CATEGORY_COLOR, CATEGORY_LABEL } from '@/lib/categories'
import { toCsv } from '@/lib/csv'
import { downloadText } from '@/lib/download'
import { formatAmount, formatDate, formatMoney } from '@/lib/format'
import { useAsync } from '@/lib/useAsync'
import { useToast } from '@/components/ui/toast-context'
import { DownloadIcon, PlayIcon, SearchIcon } from '@/components/ui/icons'

const FILTERS: { value: TransactionCategory | 'all'; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'dining', label: '餐饮' },
  { value: 'shopping', label: '购物' },
  { value: 'housing', label: '房租' },
  { value: 'transport', label: '交通' },
  { value: 'subscription', label: '订阅' },
]

export function AnalysisPage() {
  const toast = useToast()
  const [category, setCategory] = useState<TransactionCategory | 'all'>('all')
  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [exporting, setExporting] = useState(false)
  /** 支出构成的联动高亮：圆环与图例共用，鼠标停在任一边都能亮 */
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  // 顶栏全局搜索会带上 ?q=，这里直接接管
  const [searchParams, setSearchParams] = useSearchParams()
  const keyword = searchParams.get('q') ?? ''
  const setKeyword = (value: string) => {
    setSearchParams(previous => {
      const next = new URLSearchParams(previous)
      if (value) next.set('q', value)
      else next.delete('q')
      return next
    }, { replace: true })
  }

  const spending = useAsync<SpendingAnalysis>(() => api.getSpending(), [])
  const autoDebits = useAsync<AutoDebit[]>(() => api.listAutoDebits(), [])
  const account = useAsync(() => api.listAccounts(), [])
  const cards = useAsync<BankCard[]>(() => api.listCards(), [])
  const accountId = account.data?.find((row) => row.id === selectedAccountId)?.id ?? account.data?.[0]?.id

  const transactions = useAsync<{ items: Transaction[]; total: number }>(
    () =>
      accountId
        ? api.listTransactions(accountId, { size: 6, category, keyword })
        : Promise.resolve({ items: [], total: 0 }),
    [accountId, category, keyword],
  )

  /**
   * 乐观更新：开关立刻反映到界面，接口失败再回滚并提示。
   * 不用 reload()，避免整块列表重新拉取带来的延迟与闪烁。
   */
  async function toggleAutoDebit(item: AutoDebit, next: boolean) {
    const snapshot = autoDebits.data
    if (!snapshot) return
    autoDebits.setData(snapshot.map((a) => (a.id === item.id ? { ...a, enabled: next } : a)))
    try {
      await api.setAutoDebitEnabled(item.id, next)
      toast.show(next ? `已开启「${item.merchant}」自动扣款` : `已关闭「${item.merchant}」自动扣款`, 'success')
    } catch (err) {
      autoDebits.setData(snapshot)
      toast.show(err instanceof ApiError ? err.message : '操作失败，请稍后重试', 'error')
    }
  }

  /**
   * 导出当前筛选条件下的流水。
   * 数据集由后端给（导出哪些列、金额怎么表达、账号怎么脱敏都是银行的账务口径），
   * 前端只负责文件机制：转义、BOM、文件名、触发下载。
   */
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

  const segments: DonutSegment[] =
    spending.data?.categories.map((c) => ({
      key: c.key,
      label: c.label,
      amount: c.amount,
      ratio: c.ratio,
      color: CATEGORY_COLOR[c.key],
    })) ?? []

  const top = spending.data?.categories[0]

  return (
    <div className="flex flex-col gap-7">
      <header className="float-up">
        <h1 className="text-[30px] leading-tight font-bold tracking-[-0.02em] text-ink">
          消费分析
        </h1>
        <p className="mt-2 text-[14px] text-ink-mute">
          按分类看本月支出结构，并管理所有周期性自动扣款
        </p>
      </header>

      {/* 概览数字。
          三栏里的金额是不可断行的，写死 34px 在 640–1000px 这段会被撑出卡片，
          所以用 clamp 让字号跟着视口走、并且要到 md 才分三栏。 */}
      <div className="float-up grid gap-6 md:grid-cols-3">
        <Card className="md:col-span-1">
          <p className="text-[13px] text-ink-mute">本月支出</p>
          {spending.loading ? (
            <Skeleton className="mt-3 h-9 w-40" />
          ) : (
            <>
              <p className="num mt-2 text-[clamp(26px,3.4vw,34px)] leading-none font-bold tracking-[-0.02em] text-ink">
                {formatMoney(spending.data?.total ?? 0)}
              </p>
              <p className="num mt-2 text-[13px] text-ink-mute">
                环比 {spending.data && spending.data.monthOverMonth >= 0 ? '↑' : '↓'}{' '}
                {Math.abs((spending.data?.monthOverMonth ?? 0) * 100).toFixed(1)}%
              </p>
            </>
          )}
        </Card>

        <Card>
          <p className="text-[13px] text-ink-mute">最大支出分类</p>
          {top ? (
            <>
              <p className="mt-2 text-[22px] leading-tight font-semibold text-ink">{top.label}</p>
              <p className="num mt-2 text-[13px] text-ink-mute">
                ¥{formatAmount(top.amount)} · 占比 {(top.ratio * 100).toFixed(0)}%
              </p>
            </>
          ) : (
            <p className="mt-3 text-[15px] text-ink-mute">暂无数据</p>
          )}
        </Card>

        <Card>
          <p className="text-[13px] text-ink-mute">在用自动扣款</p>
          <p className="num mt-2 text-[34px] leading-none font-bold text-ink">
            {autoDebits.data?.filter((a) => a.enabled).length ?? 0}
          </p>
          <p className="mt-2 text-[13px] text-ink-mute">
            合计每月约 ¥
            {formatAmount(
              (autoDebits.data ?? [])
                .filter((a) => a.enabled)
                .reduce((sum, a) => sum + a.amount, 0),
            )}
          </p>
        </Card>
      </div>

      {/* 环形图 + 趋势 */}
      <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
        <Card className="float-up" style={{ animationDelay: '60ms' }}>
          <CardHeader title="支出构成" />
          {spending.loading ? (
            <div className="mt-6 flex justify-center">
              <Skeleton className="size-44 rounded-full" />
            </div>
          ) : (
            <div className="mt-6 flex flex-col items-center gap-7">
              <Donut
                segments={segments}
                centerLabel="本月合计"
                centerValue={formatMoney(spending.data?.total ?? 0)}
                activeKey={activeCategory}
                onActiveChange={setActiveCategory}
              />
              <div className="w-full">
                {segments.length > 0 ? (
                  <DonutLegend
                    segments={segments}
                    activeKey={activeCategory}
                    onActiveChange={setActiveCategory}
                  />
                ) : (
                  <p className="text-center text-[13px] text-ink-mute">本月暂无支出</p>
                )}
              </div>
            </div>
          )}
        </Card>

        <Card className="float-up" style={{ animationDelay: '120ms' }}>
          <CardHeader
            title="近 6 个月走势"
            action={<Tag tone="gold">单位：元</Tag>}
          />
          {spending.loading ? (
            <Skeleton className="mt-6 h-33 w-full" />
          ) : (
            <div className="mt-7">
              <TrendBars points={spending.data?.trend ?? []} />
            </div>
          )}
        </Card>
      </div>

      {/* 自动扣款 */}
      <Card className="float-up" style={{ animationDelay: '150ms' }}>
        <CardHeader
          title="自动扣款"
          action={<span className="text-[13px] text-ink-mute">共 {autoDebits.data?.length ?? 0} 项</span>}
        />
        <div className="mt-3 divide-y divide-line">
          {autoDebits.loading &&
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="py-4">
                <Skeleton className="h-10 w-full" />
              </div>
            ))}
          {autoDebits.data?.map((item) => (
            <Row
              key={item.id}
              icon={<CategoryIcon category={item.category} />}
              title={item.merchant}
              description={`${item.cycle} · 下次扣款 ${formatDate(item.nextRunAt)}`}
              right={
                <span className="flex items-center gap-5">
                  <span className="num text-[15px] font-semibold text-ink">
                    ¥{formatAmount(item.amount)}
                  </span>
                  <Toggle
                    label={`${item.merchant} 自动扣款`}
                    checked={item.enabled}
                    onChange={(next) => void toggleAutoDebit(item, next)}
                  />
                </span>
              }
            />
          ))}
          {!autoDebits.loading && autoDebits.data?.length === 0 && (
            <EmptyState title="没有签约的自动扣款" />
          )}
        </div>
      </Card>

      {/* 流水 */}
      <Card className="float-up" style={{ animationDelay: '180ms' }}>
        <CardHeader
          title="交易流水"
          action={
            <div className="flex items-center gap-4">
              <span className="num text-[13px] text-ink-mute">
                共 {transactions.data?.total ?? 0} 笔
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
          <div className="min-w-[200px] flex-1">
            <Field
              icon={<SearchIcon size={18} />}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索商户或备注"
            />
          </div>
        </div>

        <div className="mt-3 divide-y divide-line">
          {transactions.loading &&
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 py-4">
                <Skeleton className="size-10 rounded-chip" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4 w-20" />
              </div>
            ))}

          {transactions.data?.items.map((tx) => (
            <TransactionRow key={tx.id} tx={tx} showAccount={CATEGORY_LABEL[tx.category]} />
          ))}

          {!transactions.loading && transactions.data?.items.length === 0 && (
            <EmptyState
              title="没有匹配的流水"
              description="换个分类或关键词再试试。"
              action={
                <Button
                  size="sm"
                  onClick={() => {
                    setCategory('all')
                    setKeyword('')
                  }}
                >
                  清空筛选
                </Button>
              }
            />
          )}
        </div>
      </Card>

      <p className="inline-flex items-center gap-2 text-[13px] text-ink-mute">
        <PlayIcon size={16} />
        订阅类扣款关停后，商户不会再次发起扣款；已产生的账单仍需支付。
      </p>
    </div>
  )
}
