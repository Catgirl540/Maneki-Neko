import type { Account, CurrencyBalance } from '@/api/types'

/** 币种切换使用记账分区 ID；对客始终显示唯一资金账户号。 */
export function currencyBalances(accounts: readonly Account[]): CurrencyBalance[] {
  return accounts.flatMap(account => account.currencyBalances ?? [account])
}
