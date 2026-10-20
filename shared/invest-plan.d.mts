import type { InvestProduct, InvestPlan, InvestPlanUpdate } from '../app/src/api/types'
export const INVEST_CYCLES: string[]
export function validateInvestPlan(product: InvestProduct | undefined, risk: {done: boolean; expired: boolean; level: string | null}, opened: boolean, amount: number, cycle: string): asserts product is InvestProduct
export function nextInvestDate(cycle: string, now?: number): string
export function transitionInvestPlan(plan: InvestPlan | undefined, request: InvestPlanUpdate, now?: number): InvestPlan
