import type { SplitExpense, SplitExpenseDetail } from '../app/src/api/types'
export function calculateSplitCollection(input: { amount?: number; participants?: string[]; collectorName?: string; expenses?: SplitExpense[] }): {
  amount: number; participants: { name: string; amount: number }[];
  collectorName?: string; expenseTotal?: number; selfAmount?: number; expenses?: SplitExpenseDetail[];
}
