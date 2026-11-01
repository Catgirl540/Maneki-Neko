import { useState } from 'react'
import { api } from '@/api'
import type { Currency, BillingReportQuery } from '@/api/types'
import { DataLoading, DataUnavailable } from '@/components/ui/DataUnavailable'
import { Card, CardHeader } from '@/components/ui/Card'
import { Segmented, Tag } from '@/components/ui/Segmented'
import { Donut, DonutLegend, type DonutSegment } from '@/components/charts/Donut'
import { TrendBars } from '@/components/charts/TrendBars'
import { CashFlowChart, CashFlowLegend } from '@/components/charts/CashFlowChart'
import { CATEGORY_COLOR } from '@/lib/categories'
import { CURRENCY_LABEL, formatCurrency } from '@/lib/format'
import { useAsync } from '@/lib/useAsync'
import { Button } from '@/components/ui/Button'
import { toCsv } from '@/lib/csv'
import { downloadText } from '@/lib/download'

export function AnalysisPage() {
  const [currentMonth] = useState(() => new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 7))
  const [month, setMonth] = useState(currentMonth)
  const [currency, setCurrency] = useState<Currency>('CNY')
  const [range, setRange] = useState<'7' | '30'>('7')
  const [reportPeriod, setReportPeriod] = useState<'month' | 'year'>('year')
  const [reportYear, setReportYear] = useState(currentMonth.slice(0, 4))
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-[30px] leading-tight font-bold tracking-[-0.02em] text-ink">收支分析</h1>
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-2 text-[13px] text-ink-soft">
          支出月份
          <input type="month" value={month} min="1900-01" max={currentMonth} onChange={event => { if (event.target.validity.valid && event.target.value) setMonth(event.target.value) }} className="min-h-12 rounded-field border border-line bg-surface px-3 text-ink" />
        </label>
        <Segmented value={currency} onChange={setCurrency} options={(['CNY', 'USD', 'HKD'] as const).map(value => ({ value, label: CURRENCY_LABEL[value] + ' ' + value }))} />
      </div>
      {/* Remount on month change so an old result cannot carry the new month label. */}
      <SpendingPanel key={month} month={month} currency={currency} />
      <Card>
        <CardHeader title="账单报告" action={<Segmented value={reportPeriod} onChange={setReportPeriod} options={[{ value: 'month', label: '月度报告' }, { value: 'year', label: '年度报告' }]} />} />
        {reportPeriod === 'year' && <label className="mt-4 flex items-center gap-3 text-[13px] text-ink-soft">报告年份<input aria-label="报告年份" type="number" min="1900" max={currentMonth.slice(0, 4)} value={reportYear} onChange={event => setReportYear(event.target.value)} className="min-h-11 w-28 rounded-field border border-line bg-surface px-3" /></label>}
        <BillingReportPanel key={`${reportPeriod}:${reportYear}:${month}:${currency}`} query={{ period: reportPeriod, value: reportPeriod === 'year' ? reportYear : month, currency }} />
      </Card>
      <Card>
        <CardHeader title="现金流" action={<Segmented value={range} onChange={setRange} options={[{ value: '7', label: '近 7 天' }, { value: '30', label: '近 30 天' }]} />} />
        <p className="mt-3 text-[13px] text-ink-mute">最近自然日（含今天），独立于所选支出月份；{CURRENCY_LABEL[currency]}单独统计。</p>
        <CashFlowPanel key={range} days={Number(range)} currency={currency} />
      </Card>
    </div>
  )
}

function BillingReportPanel({ query }: { query: BillingReportQuery }) {
  const request = useAsync(() => api.getBillingReport(query), [query.period, query.value, query.currency])
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  if (request.error) return <DataUnavailable message={request.error} onRetry={request.reload} />
  if (!request.data) return <DataLoading />
  const report = request.data
  if (report.period !== query.period || report.value !== query.value || report.currency !== query.currency) return <DataUnavailable message="银行未返回所选报告，请重试。" onRetry={request.reload} />
  async function downloadReport() {
    setExporting(true); setExportError('')
    try { const dataset = await api.exportBillingReport(query); downloadText(dataset.fileName, toCsv(dataset.columns, dataset.rows)) }
    catch (error) { setExportError(error instanceof Error ? error.message : '报告导出失败') }
    finally { setExporting(false) }
  }
  return <div className="mt-4 flex flex-col gap-4" aria-label={`${query.value} ${query.currency} 账单报告`}>
    <p className="text-[13px] text-ink-mute">{report.value} · {report.currency} · 北京时间 · {report.periodStatus === 'complete' ? '完整周期' : '截至查询时点'} · {report.transactionCount} 笔成功记账</p>
    <p className="text-[13px] text-ink-mute">{report.scope}。查询时点 {new Date(report.asOf).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}。</p>
    <div className="grid gap-4 sm:grid-cols-3">{[['收入', report.totalIncome], ['支出', report.totalExpense], ['净收支', report.net]].map(([label, value]) => <div key={label} className="rounded-field bg-surface-raised p-4"><p className="text-[13px] text-ink-mute">{label}</p><p className="num mt-2 text-xl font-semibold">{formatCurrency(Number(value), report.currency)}</p></div>)}</div>
    <DateExclusions ignored={report.ignoredDates} />
    <div className="overflow-x-auto"><table className="w-full text-left text-[13px]"><caption className="sr-only">报告各月收入与支出</caption><thead><tr><th className="py-2">月份</th><th>收入</th><th>支出</th><th>笔数</th></tr></thead><tbody>{report.months.map(row => <tr key={row.month} className="border-t border-line"><td className="py-2">{row.month}</td><td className="num">{formatCurrency(row.income, report.currency)}</td><td className="num">{formatCurrency(row.expense, report.currency)}</td><td>{row.count}</td></tr>)}</tbody></table></div>
    {exportError && <p role="alert" className="text-[13px] text-danger">{exportError}</p>}
    <div><Button variant="secondary" disabled={exporting} onClick={() => void downloadReport()}>{exporting ? '导出中…' : `导出${query.period === 'year' ? '年度' : '月度'}报告 CSV`}</Button></div>
  </div>
}

function DateExclusions({ ignored }: { ignored?: { invalidDate: number; futureDate: number } }) {
  if (!ignored || !(ignored.invalidDate || ignored.futureDate)) return null
  return <p role="status" className="text-[13px] text-ink-mute">该币种来源记录已排除 {ignored.invalidDate} 条无效日期、{ignored.futureDate} 条晚于查询时点的记录；不计入统计。</p>
}

function SpendingPanel({ month, currency }: { month: string; currency: Currency }) {
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const request = useAsync(() => api.getSpending(month), [month])
  if (request.error) return <DataUnavailable message={request.error} onRetry={request.reload} />
  if (!request.data) return <DataLoading />
  const spending = request.data.byCurrency?.[currency] ?? (currency === 'CNY' ? request.data : null)
  if (!spending || spending.month !== month) return <DataUnavailable message="银行未返回所选月份或币种的统计，请重试。" onRetry={request.reload} />
  const segments: DonutSegment[] = spending.categories.map(c => ({ ...c, color: CATEGORY_COLOR[c.key] }))
  const top = spending.categories[0]
  return (
    <section aria-label={month + ' ' + currency + ' 支出统计'} className="flex flex-col gap-6">
      <p className="text-[13px] text-ink-mute">
        {month} · {CURRENCY_LABEL[currency]} · {spending.timeZone === 'Asia/Shanghai' ? '北京时间' : '银行统计时间'}
        {spending.periodStatus === 'partial' ? ' · 本月截至查询时点，环比基数为上月全月' : ''}
        {spending.asOf ? ' · 查询时点 ' + new Date(spending.asOf).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : ''}
      </p>
      <DateExclusions ignored={spending.ignoredDates} />
      <div className="float-up grid gap-6 md:grid-cols-2">
        <Card>
          <p className="text-[13px] text-ink-mute">所选月份支出</p>
          <p className="num mt-2 text-[clamp(26px,3.4vw,34px)] leading-none font-bold tracking-[-0.02em] text-ink">{formatCurrency(spending.total, currency)}</p>
          <p className="num mt-2 text-[13px] text-ink-mute">
            {spending.monthOverMonthComparable === true
              ? '较 ' + spending.previousMonth + ' ' + (spending.monthOverMonth >= 0 ? '↑' : '↓') + ' ' + Math.abs(spending.monthOverMonth * 100).toFixed(1) + '%'
              : spending.monthOverMonthComparable === false ? '上月无可比支出基数' : '环比口径暂不可用'}
          </p>
        </Card>
        <Card>
          <p className="text-[13px] text-ink-mute">最大支出分类</p>
          {top ? <>
            <p className="mt-2 text-[22px] leading-tight font-semibold text-ink">{top.label}</p>
            <p className="num mt-2 text-[13px] text-ink-mute">{formatCurrency(top.amount, currency)} · 占比 {(top.ratio * 100).toFixed(0)}%</p>
          </> : <p className="mt-3 text-[15px] text-ink-mute">所选月份暂无支出</p>}
        </Card>
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
        <Card>
          <CardHeader title="支出构成" />
          <div className="mt-6 flex flex-col items-center gap-7">
            <Donut segments={segments} currency={currency} centerLabel={month + ' 合计'} centerValue={formatCurrency(spending.total, currency)} activeKey={activeCategory} onActiveChange={setActiveCategory} />
            <div className="w-full">
              {segments.length > 0 ? <DonutLegend segments={segments} currency={currency} activeKey={activeCategory} onActiveChange={setActiveCategory} /> : <p className="text-center text-[13px] text-ink-mute">所选月份暂无支出</p>}
            </div>
          </div>
        </Card>
        <Card>
          <CardHeader title="截至所选月的 6 个月走势" action={<Tag tone="gold">{currency}</Tag>} />
          <div className="mt-7"><TrendBars key={currency} points={spending.trend} currency={currency} /></div>
        </Card>
      </div>
    </section>
  )
}

function CashFlowPanel({ days, currency }: { days: number; currency: Currency }) {
  const request = useAsync(() => api.getCashFlow(days), [days])
  if (request.error) return <DataUnavailable message={request.error} onRetry={request.reload} />
  if (!request.data) return <div className="mt-6"><DataLoading /></div>
  const cashFlow = request.data.byCurrency?.[currency] ?? (currency === 'CNY' ? request.data : null)
  if (!cashFlow || cashFlow.days !== days) return <DataUnavailable message="银行未返回所选天数或币种的现金流，请重试。" onRetry={request.reload} />
  return <>
    <p className="mt-3 text-[13px] text-ink-mute">{cashFlow.points[0]?.date} 至 {cashFlow.points.at(-1)?.date} · {cashFlow.timeZone === 'Asia/Shanghai' ? '北京时间' : '银行统计时间'}</p>
    <DateExclusions ignored={cashFlow.ignoredDates} />
    <div className="mt-6"><CashFlowChart key={currency} points={cashFlow.points} currency={currency} /></div>
    <div className="mt-5 border-t border-line pt-4"><CashFlowLegend totalIncome={cashFlow.totalIncome} totalExpense={cashFlow.totalExpense} currency={currency} /></div>
  </>
}
