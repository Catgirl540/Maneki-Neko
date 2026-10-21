import type { Currency, TransactionCategory, TransactionDirection } from '@/api/types'

/**
 * 账单页的筛选条件模型。
 *
 * ## 为什么单独放一个文件
 *
 * 四组条件各自对应**不同的查询参数**，其中「时间范围」在界面上是一个枚举
 * （近 7 / 30 / 90 天），落到接口上却是两个本地日期。这个换算一旦散在页面里，
 * 就会有人顺手写成 `new Date().toISOString().slice(0, 10)` —— 那是 UTC 日，
 * 东八区晚上 8 点之后会整体差一天，筛选窗口和用户看到的日期对不上。
 *
 * 所以这里集中：URL 值 ↔ 查询参数的映射、已选条件计数、日期换算。
 *
 * @module app/lib/billsFilter
 */

export type DirectionFilter = TransactionDirection | 'all'
export type CategoryFilter = TransactionCategory | 'all'
export type RangeFilter = 'all' | '7d' | '30d' | '90d'
export type CurrencyFilter = Extract<Currency, 'CNY' | 'HKD'> | 'all'

export interface BillsFilter {
  direction: DirectionFilter
  category: CategoryFilter
  range: RangeFilter
  currency: CurrencyFilter
}

/** 各组默认值：全部 / 不限。默认项不计入已选条件数。 */
export const DEFAULT_FILTER: BillsFilter = {
  direction: 'all',
  category: 'all',
  range: 'all',
  currency: 'all',
}

export const DIRECTION_OPTIONS: { value: DirectionFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'out', label: '支出' },
  { value: 'in', label: '收入' },
]

/** 分类口径与 `lib/categories.ts` 的 `CATEGORY_LABEL` 完全一致（8 类 + 全部）。 */
export const CATEGORY_OPTIONS: { value: CategoryFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'dining', label: '餐饮' },
  { value: 'shopping', label: '购物' },
  { value: 'housing', label: '房租' },
  { value: 'transport', label: '交通' },
  { value: 'subscription', label: '订阅服务' },
  { value: 'transfer', label: '转账' },
  { value: 'salary', label: '工资入账' },
  { value: 'other', label: '其他' },
]

export const RANGE_OPTIONS: { value: RangeFilter; label: string }[] = [
  { value: 'all', label: '不限' },
  { value: '7d', label: '近 7 天' },
  { value: '30d', label: '近 30 天' },
  { value: '90d', label: '近 90 天' },
]

export const CURRENCY_OPTIONS: { value: CurrencyFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'CNY', label: '人民币 CNY' },
  { value: 'HKD', label: '港币 HKD' },
]

/** 每组一个 URL 参数键：`direction` / `category` / `range` / `currency`。 */
export const FILTER_KEYS = {
  direction: 'direction',
  category: 'category',
  range: 'range',
  currency: 'currency',
} as const

/** URL 里的键名（含分页）——「重置」「清空筛选」要一起摘掉。 */
export const FILTER_PARAM_KEYS = ['direction', 'category', 'range', 'currency'] as const

const pick = <T extends string>(options: { value: T }[], raw: string | null, fallback: T): T =>
  options.some(option => option.value === raw) ? (raw as T) : fallback

/**
 * 从 URL 读筛选条件。**不认识的取值一律回落到默认项**，
 * 免得一个手改的 `?range=1y` 让页面停在既不过滤也说不清的状态。
 */
export function readFilter(params: URLSearchParams): BillsFilter {
  return {
    direction: pick(DIRECTION_OPTIONS, params.get(FILTER_KEYS.direction), DEFAULT_FILTER.direction),
    category: pick(CATEGORY_OPTIONS, params.get(FILTER_KEYS.category), DEFAULT_FILTER.category),
    range: pick(RANGE_OPTIONS, params.get(FILTER_KEYS.range), DEFAULT_FILTER.range),
    currency: pick(CURRENCY_OPTIONS, params.get(FILTER_KEYS.currency), DEFAULT_FILTER.currency),
  }
}

/** 已选条件数：只统计非默认项，四组都是默认时为 0（角标不显示）。 */
export function countActive(filter: BillsFilter): number {
  return (Object.keys(FILTER_KEYS) as (keyof BillsFilter)[])
    .filter(key => filter[key] !== DEFAULT_FILTER[key]).length
}

/** 本地日 `YYYY-MM-DD`。不能用 `toISOString().slice(0, 10)` —— 那是 UTC 日。 */
export function localDayKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * 时间范围 → `from`/`to`（本地自然日，含首尾）。
 *
 * 「近 7 天」= 今天和之前 6 天，共 7 个自然日。用 `new Date(y, m, d - n)`
 * 做减法而不是减毫秒：跨月、跨年和夏令时都由 Date 自己进位，
 * 减 `n * 86400000` 在夏令时那天会差一小时、再被日期截断成差一天。
 */
export function rangeBounds(range: RangeFilter, today: Date = new Date()): { from?: string; to?: string } {
  if (range === 'all') return {}
  const days = Number.parseInt(range, 10)
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1))
  return { from: localDayKey(start), to: localDayKey(today) }
}
