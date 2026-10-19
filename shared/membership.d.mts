import type { Account, CardFeeQuote, CardProduct, Cents, MemberTier, MembershipEvaluation, MembershipOverview, MembershipPlan, MembershipSubscription, User } from '../app/src/api/types'

type Profile = {
  accounts: Account[]
  currencyBalances?: Account[]
  user: User
  membership?: MembershipState
  assetSnapshots?: { date: string; assets: Cents }[]
}

export interface MembershipState {
  tier: MemberTier
  since: string | null
  evaluation: MembershipEvaluation | null
  benefitUsage: { year: number; cardFeeWaiversUsed: number }
  records: { id: string; label: string; amount: Cents; createdAt: string }[]
  legacy?: { current: MembershipSubscription | null; plans: MembershipPlan[] }
}

export const MEMBER_TIERS: MemberTier[]
export const MEMBER_TIER_RULES: Record<MemberTier, {
  label: string
  threshold: Cents
  cardFeeFreePerYear: number
  cardFeeRate: number
  includeShipping: boolean
  fxFeeRate: number
}>
export const PLANNED_MEMBER_PERKS: string[]
export const OCCUPYING_CARD_STATUSES: string[]

export function beijingDay(now?: number): string
export function beijingMonth(now?: number): string
export function previousMonth(month: string): string
export function nextMonth(month: string): string
export function daysInMonth(month: string): number

export function ratedAssets(db: Profile, midRates: Record<string, number>): Cents
export function tierForAssets(avgAssets: Cents): MemberTier
export function nextTier(tier: MemberTier): MemberTier | null
export function evaluateMembership(db: Profile, now?: number): boolean
export function cardFeeQuote(db: Profile, product: Pick<CardProduct, 'issuingFee' | 'deliveryFee'>): CardFeeQuote
export function recordCardFeeWaiver(db: Profile, waivedAmount: Cents): void
export function effectiveSpread(db: Profile, baseSpread: number): number
export function fxRateFor(db: Profile, from: string, to: string, midRates: Record<string, number>, baseSpread: number): number
export function membershipOverview(db: Profile, midRates: Record<string, number>): MembershipOverview
export function normalizeMembership(db: Profile): void
export function freshMembership(): MembershipState
export function recordAssetSnapshot(db: Profile, midRates: Record<string, number>, now?: number): void
