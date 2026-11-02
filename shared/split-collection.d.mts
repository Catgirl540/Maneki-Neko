import type { SplitExpense, SplitExpenseDetail, SplitParticipant } from '../app/src/api/types'
/** 参与者身份：姓名必填，手机号与本行账号至少填一个（这是参与者的唯一标识，不能只靠姓名）。 */
export type SplitIdentity = { name: string; phone?: string; accountNo?: string }
export function calculateSplitCollection(input: { amount?: number; participants?: SplitIdentity[]; collectorName?: SplitIdentity; expenses?: SplitExpense[] }): {
  amount: number; participants: SplitParticipant[];
  collectorName?: string; collector?: { name: string; phone?: string; accountNo?: string };
  expenseTotal?: number; selfAmount?: number; expenses?: SplitExpenseDetail[];
}
