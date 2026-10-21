import type { Account, CardFeeQuote, CardProduct, Cents, Entitlements, MemberTier, MembershipEvaluation, MembershipOverview, User, WealthProduct } from '../app/src/api/types'

type Profile = {
  accounts: Account[]
  currencyBalances?: Account[]
  user: User
  membership?: MembershipState
  assetSnapshots?: { date: string; assets: Cents }[]
  holdings?: { marketValue: Cents }[]
  wealthAccount?: { opened?: boolean; holdings?: { marketValue: Cents }[] }
  cashManagement?: { balance: Cents }
}

export interface MembershipState {
  tier: MemberTier
  since: string | null
  evaluation: MembershipEvaluation | null
  /** 连续未达当前档门槛的评定周期数；≥2 才降级 */
  belowPeriods: number
  benefitUsage: { year: number; cardFeeWaiversUsed: number; loungePassesUsed: number }
  records: { id: string; label: string; amount: Cents; createdAt: string }[]
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
export const LOUNGE_PASSES_PER_YEAR: Record<MemberTier, number>
export const PLANNED_MEMBER_PERKS: string[]
export const OVERSEAS_TRANSFER_RATE: number
export const OVERSEAS_TRANSFER_MIN_FEE: Cents
export const OCCUPYING_CARD_STATUSES: string[]
export const WEALTH_PRIORITY_LEAD_DAYS: number

export function beijingDay(now?: number): string
export function beijingMonth(now?: number): string
export function previousMonth(month: string): string
export function nextMonth(month: string): string
export function daysInMonth(month: string): number

export function aumAssets(db: Profile, midRates: Record<string, number>): Cents
export const ratedAssets: typeof aumAssets
export function tierForAssets(avgAssets: Cents): MemberTier
export function nextTier(tier: MemberTier): MemberTier | null
export function entitlements(tier: MemberTier): Entitlements
export function memberBenefits(tier: MemberTier): string[]
export function transferFee(db: Profile, req: { amount: Cents; scope: string; isFps?: boolean }): Cents
export function transferFeeWaived(db: Profile, req: { scope: string; isFps?: boolean }): boolean
export function applyRealtimeUpgrade(db: Profile, midRates: Record<string, number>, now?: number): boolean
export function evaluateMembership(db: Profile, now?: number): boolean
export function cardFeeQuote(db: Profile, product: Pick<CardProduct, 'issuingFee' | 'deliveryFee'>): CardFeeQuote
export function recordCardFeeWaiver(db: Profile, waivedAmount: Cents): void
export function effectiveSpread(db: Profile, baseSpread: number): number
export function fxRateFor(db: Profile, from: string, to: string, midRates: Record<string, number>, baseSpread: number): number
export function redeemLoungePass(db: Profile, now?: number): boolean
export function membershipOverview(db: Profile, midRates: Record<string, number>): MembershipOverview
export function normalizeMembership(db: Profile): void
export function freshMembership(): MembershipState
export function recordAssetSnapshot(db: Profile, midRates: Record<string, number>, now?: number): void
export function priorityOpenAt(now?: number): string
export function wealthPriorityGate(product: Pick<WealthProduct, 'priorityOpenAt' | 'priorityTier'>, tier: MemberTier, now?: number): { priorityTier: MemberTier; priorityOpenAt: string; message: string } | null
