import { useState } from 'react'
import { api } from '@/api'
import { DataLoading, DataUnavailable } from '@/components/ui/DataUnavailable'
import { Card, CardHeader } from '@/components/ui/Card'
import { Segmented, Skeleton, Tag } from '@/components/ui/Segmented'
import { Donut, DonutLegend, type DonutSegment } from '@/components/charts/Donut'
import { TrendBars } from '@/components/charts/TrendBars'
import { CashFlowChart, CashFlowLegend } from '@/components/charts/CashFlowChart'
import { CATEGORY_COLOR } from '@/lib/categories'
import { formatAmount, formatMoney } from '@/lib/format'
import { useAsync } from '@/lib/useAsync'

export function AnalysisPage() {
  const [range, setRange] = useState<'7' | '30'>('7')
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const spending = useAsync(() => api.getSpending(), [])
  const cashFlow = useAsync(() => api.getCashFlow(Number(range)), [range])
  const segments: DonutSegment[] = spending.data?.categories.map(c => ({ ...c, color: CATEGORY_COLOR[c.key] })) ?? []
  const top = spending.data?.categories[0]
  const requests = [spending, cashFlow]
  const failed = requests.filter(state => state.error !== null && state.data === null)
  if (failed.length) return <DataUnavailable message={failed[0]!.error!} onRetry={() => failed.forEach(state => state.reload())} />
  if (requests.some(state => state.loading && state.data === null)) return <DataLoading />
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-[30px] leading-tight font-bold tracking-[-0.02em] text-ink">收支分析</h1>
      <div className="float-up grid gap-6 md:grid-cols-2">
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

      <Card>
        <CardHeader title="现金流" action={<Segmented value={range} onChange={setRange} options={[{ value: '7', label: '近 7 天' }, { value: '30', label: '近 30 天' }]} />} />
        <div className="mt-6"><CashFlowChart points={cashFlow.data?.points ?? []} /></div>
        <div className="mt-5 border-t border-line pt-4"><CashFlowLegend totalIncome={cashFlow.data?.totalIncome ?? 0} totalExpense={cashFlow.data?.totalExpense ?? 0} /></div>
      </Card>
    </div>
  )
}
