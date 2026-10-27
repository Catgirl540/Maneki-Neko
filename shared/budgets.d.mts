export interface BudgetRecord {
  id: string
  name: string
  /** 覆盖的预设平台 id（见 shared/spend-platforms.mjs） */
  platforms: string[]
  /** 每日基础限额（分） */
  dailyLimit: number
  /** 当日消费低于该值（含 0）记 1 分 */
  pointThreshold: number
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export interface BudgetPassRecord {
  id: string
  budgetId: string
  /** 额度生效的上海自然日 YYYY-MM-DD */
  day: string
  extra: number
  createdAt: string
}

export interface BudgetPointDay {
  budgetId: string
  day: string
  spent: number
  awardedAt: string
}

export interface BudgetTransaction {
  direction?: string
  status?: string
  amount?: number
  createdAt?: string
  detail?: { merchantId?: string } | null
}

export interface BudgetDbView {
  budgets?: BudgetRecord[]
  budgetPasses?: BudgetPassRecord[]
  budgetPointDays?: BudgetPointDay[]
  transactions?: BudgetTransaction[]
}

export interface BudgetToday {
  day: string
  used: number
  limit: number
  remaining: number
}

export interface BudgetView extends BudgetRecord {
  merchantNames: string[]
  today: BudgetToday
  points: { awarded: number; used: number; available: number }
  passes: BudgetPassRecord[]
}

export const BUDGET_MAX_COUNT: number
export const BUDGET_NAME_MAX: number
export const BUDGET_MIN_DAILY_LIMIT: number
export const BUDGET_MAX_DAILY_LIMIT: number
export const BUDGET_MIN_POINT_THRESHOLD: number
export const BUDGET_MAX_POINT_THRESHOLD: number
export const BUDGET_DEFAULT_POINT_THRESHOLD: number
export const BUDGET_POINTS_PER_PASS: number
export const BUDGET_PASS_EXTRA_CENTS: number
export const BUDGET_PASS_MAX_FUTURE_DAYS: number
export const BUDGET_POINT_LOOKBACK_DAYS: number

export function shanghaiDay(time?: number): string
export function shanghaiDayStart(time: number): number
export function addDays(day: string, count: number): string
export function isDayKey(value: unknown): boolean

export class BudgetError extends Error {
  readonly code: string
  readonly status: number
  constructor(message: string, code: string, status?: number)
}

export function budgetMerchantIds(budget: BudgetRecord): Set<string>
export function budgetPlatformNames(budget: BudgetRecord): string[]
export function budgetSpentCents(transactions: BudgetTransaction[] | undefined, budget: BudgetRecord, day: string): number
export function budgetPassExtra(passes: BudgetPassRecord[] | undefined, budgetId: string, day: string): number
export function budgetEffectiveLimit(budget: BudgetRecord, passes: BudgetPassRecord[] | undefined, day: string): number
export function budgetPoints(
  pointDays: BudgetPointDay[] | undefined,
  passes: BudgetPassRecord[] | undefined,
  budgetId: string,
): { awarded: number; used: number; available: number }
export function validateBudgetInput(input: unknown): {
  name: string
  platforms: string[]
  dailyLimit: number
  pointThreshold: number
}
export function validateBudgetPatch(patch: unknown, current: BudgetRecord): BudgetRecord
export function checkBudgetLimit(
  budgets: BudgetRecord[] | undefined,
  passes: BudgetPassRecord[] | undefined,
  transactions: BudgetTransaction[] | undefined,
  merchantId: string,
  amount: number,
  day: string,
): void
export function settleBudgetPoints(db: BudgetDbView, now?: number): number
export function budgetsOverview(db: BudgetDbView, now?: number): BudgetView[]
export function validatePassDay(day: unknown, now?: number): string
