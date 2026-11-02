import type { Currency, ExchangeRates } from '../app/src/api/types'
export function referenceExchangeRates(profile: unknown, midRates: Record<Currency, number>, baseSpread: number, now?: number): ExchangeRates
