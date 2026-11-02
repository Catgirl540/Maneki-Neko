import type { MonthlyBudgetInput, MonthlyBudget, MonthlyBudgetsOverview } from '../app/src/api/types'
export const MONTHLY_BUDGET_CATEGORIES: Record<string, string>
export function monthlyBudgetsOverview(db: unknown, month?: string, now?: number): MonthlyBudgetsOverview
export function saveMonthlyBudget(db: unknown, input: MonthlyBudgetInput, now?: number): MonthlyBudget
