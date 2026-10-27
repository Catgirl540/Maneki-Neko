import type { WealthHolding, WealthProduct, WealthHoldingLot } from '../app/src/api/types'
export function wealthHoldingLots(holding: WealthHolding): WealthHoldingLot[]
export function wealthHoldingState(holding: WealthHolding, now?: number): { lots: WealthHoldingLot[]; redeemableShares: number; closed: boolean; redeemableAt: string | null }
export function wealthRedemptionQuote(product: WealthProduct, holding: WealthHolding, shares?: number, now?: number): { shares: number; gross: number; fee: number; net: number; remainingLots: WealthHoldingLot[]; redeemableShares: number }
