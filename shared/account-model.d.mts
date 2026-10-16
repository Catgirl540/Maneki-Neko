import type { Account, TransactionRecord, SavingsRoundupRule, SpendingAnalysis, CashFlow } from '../app/src/api/types'
type Profile = { accounts: Account[]; currencyBalances?: Account[]; retiredBalances?: Account[]; accountAliases?: Record<string,string>; accountNumberAliases?: Record<string,string>; transactions: TransactionRecord[]; cards: { accountId: string }[]; savings: { roundup: SavingsRoundupRule; goals: {id:string}[] } }
export function ledgerBalances(db: Pick<Profile,'accounts'|'currencyBalances'>): Account[]
export function findBalance(db: Pick<Profile,'accounts'|'currencyBalances'|'accountAliases'>, id?: string): Account | undefined
export function requireCurrencyBalance(db: Profile, id: string, currency?: string): Account
export function normalizeFundingAccount(db: Profile): void
export function validateRoundup(db: Profile, update: Partial<SavingsRoundupRule>): SavingsRoundupRule
export function internalExchange(tx: TransactionRecord): boolean
export function spendingStatistics(db: Profile, month: string, labels: Record<string,string>): SpendingAnalysis
export function cashFlowStatistics(db: Profile, days: number): CashFlow
