import { useState } from 'react'
import { api } from '@/api'
import type { Currency, MonthlyBudgetCategory, MonthlyBudgetInput, MonthlyBudget } from '@/api/types'
import { useAsync } from '@/lib/useAsync'
import { parseAmountInput } from '@/lib/amountInput'
import { formatCurrency } from '@/lib/format'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { DataUnavailable } from '@/components/ui/DataUnavailable'
import { MONTHLY_BUDGET_CATEGORIES } from '../../../../shared/monthly-budgets.mjs'

const inputClass = 'min-h-11 rounded-field border border-line bg-surface px-3 text-[14px] text-ink'
export function MonthlyBudgets() {
  const [month, setMonth] = useState(() => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 7))
  const overview = useAsync(() => api.listMonthlyBudgets(month), [month])
  const [category, setCategory] = useState<MonthlyBudgetCategory>('dining')
  const [currency, setCurrency] = useState<Currency>('CNY')
  const [limit, setLimit] = useState('')
  const [review, setReview] = useState<MonthlyBudgetInput | null>(null)
  const [deleteReview, setDeleteReview] = useState<MonthlyBudget | null>(null)
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('')
  const ready = overview.data?.month === month && !overview.loading && !overview.refreshing && !overview.error
  function prepare() {
    const cents = parseAmountInput(limit)
    if (!ready || cents == null || cents < 1 || cents > 100000000) { setMessage('请输入有效目标金额，最多两位小数，上限 100 万'); return }
    const prior = overview.data?.goals.find(row => row.category === category && row.currency === currency)
    setReview({ month, category, currency, limit: cents, version: prior?.version ?? 0 }); setMessage('')
  }
  async function save() {
    if (!review) return
    setBusy(true)
    try {
      await api.setMonthlyBudget(review)
      setReview(null); setLimit(''); setMessage('月度分类目标已保存')
      window.dispatchEvent(new Event('luckycat:bank-updated'))
    } catch (error) { setReview(null); setMessage(error instanceof Error ? error.message : '保存失败'); overview.reload() }
    finally { setBusy(false) }
  }
  async function remove() {
    if (!deleteReview || busy) return
    setBusy(true)
    try {
      await api.deleteMonthlyBudget({ id: deleteReview.id, version: deleteReview.version })
      setDeleteReview(null); setMessage('月度分类目标已删除')
      window.dispatchEvent(new Event('luckycat:bank-updated'))
    } catch (error) { setDeleteReview(null); setMessage(error instanceof Error ? error.message : '删除失败'); overview.reload() }
    finally { setBusy(false) }
  }
  return <section aria-label="月度分类目标" className="flex flex-col gap-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-[20px] font-semibold">月度分类目标</h2><label className="text-[13px]">预算月份 <input aria-label="预算月份" className={inputClass} type="month" required value={month} disabled={busy} onChange={e => { if (e.target.value) setMonth(e.target.value); setReview(null); setDeleteReview(null) }} /></label></div>
    <div><Button disabled={busy || overview.refreshing} onClick={overview.reload}>刷新月度用量</Button></div>
    <p className="text-[13px] text-ink-soft">按北京时间和原记账币种对比目标与实际成功支出，不阻止支付。流水分类完成或更新后，用量可能变化。</p>
    {overview.error && <DataUnavailable message={overview.error} onRetry={overview.reload} />}
    {overview.data?.month === month && overview.data.goals.map(goal => <Card key={goal.id}><div className="flex items-center justify-between gap-3"><h3 className="font-semibold">{goal.month} · {goal.categoryLabel} · {goal.currency}</h3><Button variant="ghost" size="sm" disabled={busy || !ready} aria-label={`删除${goal.month}${goal.categoryLabel}${goal.currency}月度目标`} onClick={() => { setDeleteReview(goal); setReview(null); setMessage('') }}>删除目标</Button></div><p className="mt-2 text-[14px]">目标 {formatCurrency(goal.limit, goal.currency)} · 已用 {formatCurrency(goal.spent, goal.currency)} · 剩余 {formatCurrency(goal.remaining, goal.currency)}{goal.overBy > 0 && <span className="text-danger"> · 超出 {formatCurrency(goal.overBy, goal.currency)}</span>}</p></Card>)}
    {ready && !overview.data?.goals.length && <p className="text-[13px] text-ink-mute">本月尚未设置分类目标</p>}
    {deleteReview && <Card><div aria-label="确认删除月度目标"><h3 className="font-semibold">删除月度分类目标</h3><p className="mt-2">{deleteReview.month} · {deleteReview.categoryLabel} · {deleteReview.currency} · 目标 {formatCurrency(deleteReview.limit, deleteReview.currency)}</p><p className="my-3 text-[13px] text-ink-mute">仅删除此分类目标，已有消费流水、资金余额和每日平台限额不受影响。</p><div className="flex gap-3"><Button variant="danger" disabled={busy} onClick={() => void remove()}>确认删除月度目标</Button><Button disabled={busy} onClick={() => setDeleteReview(null)}>取消删除</Button></div></div></Card>}
    {!deleteReview && <Card>{review ? <div aria-label="确认月度分类目标"><p>{review.month} · {MONTHLY_BUDGET_CATEGORIES[review.category]} · 目标 {formatCurrency(review.limit, review.currency)}</p><p className="my-3 text-[13px] text-ink-mute">保存后仅对比实际支出，不冻结资金、不改变每日平台限额。</p><div className="flex gap-3"><Button disabled={busy} onClick={() => void save()}>确认保存月度目标</Button><Button disabled={busy} onClick={() => setReview(null)}>返回修改</Button></div></div> : <form className="flex flex-wrap items-end gap-4" onSubmit={e => { e.preventDefault(); prepare() }}>
      <label className="flex flex-col gap-2 text-[13px]">消费分类<select aria-label="月度预算分类" value={category} className={inputClass} onChange={e => setCategory(e.target.value as MonthlyBudgetCategory)}>{Object.entries(MONTHLY_BUDGET_CATEGORIES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label className="flex flex-col gap-2 text-[13px]">币种<select aria-label="月度预算币种" value={currency} className={inputClass} onChange={e => setCurrency(e.target.value as Currency)}>{['CNY', 'USD', 'HKD'].map(key => <option key={key}>{key}</option>)}</select></label>
      <label className="flex flex-col gap-2 text-[13px]">目标金额（元）<input aria-label="月度目标金额" required inputMode="decimal" value={limit} className={inputClass} onChange={e => setLimit(e.target.value)} /></label>
      <Button type="submit" disabled={busy || !ready}>核对月度目标</Button>
    </form>}</Card>}
    {message && <p role="status" className="text-[13px]">{message}</p>}
  </section>
}
