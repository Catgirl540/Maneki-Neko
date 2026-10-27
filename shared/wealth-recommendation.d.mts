import type { WealthProduct, WealthOverview } from '../app/src/api/types'
export interface WealthRecommendationPreferences { amountCents: number; liquidity?: 'any' | 'open'; maxTermDays?: number; limit?: number }
export interface WealthRecommendations {
  source: string; asOf: string; criteria: { amountCents: number; liquidity: string; maxTermDays: number | null }; ranking: string
  riskAssessment: { status: string; level: string | null }; wealthAccountOpened: boolean
  matches: { code: string; name: string; risk: string; openEnded: boolean; termDays: number | null; minAmountCents: number; annualFeeRate: number; subscriptionRate: number; estimatedSubscriptionFeeCents: number; reasons: string[] }[]
  totalMatches: number; excluded: { code: string; reasons: string[] }[]; notice: string
}
export function recommendWealthProducts(catalog: WealthProduct[], overview: Pick<WealthOverview, 'risk' | 'account'>, preferences: WealthRecommendationPreferences, now?: number): WealthRecommendations
