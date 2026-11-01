import type { AutoDebit, SpendRequest } from '../app/src/api/types'
export function prepareSpendSubscription(input: SpendRequest, currency: string, contracts: AutoDebit[], now?: number): {
  error?: string
  contract: Omit<AutoDebit, 'id'> | null
}
