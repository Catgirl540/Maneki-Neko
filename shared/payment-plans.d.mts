import type { BankApi, } from '../app/src/api/contract'
import type { TransferRequest, TransferResult } from '../app/src/api/types'
type PlanMethods = Pick<BankApi, 'listScheduledTransfers' | 'createScheduledTransfer' | 'cancelScheduledTransfer' | 'listSplitCollections' | 'createSplitCollection' | 'cancelSplitCollection' | 'confirmSplitPayment' | 'remindSplitParticipant'>
export function createPaymentPlans(options: { getDb: () => unknown; persist: () => void; nextId: (prefix: string) => string; verifyPassword: (password: string) => void | Promise<void>; resolveRecipient: (request: TransferRequest) => unknown; executeTransfer: (request: TransferRequest) => Promise<TransferResult>; now?: () => number }): PlanMethods & { settleScheduledTransfers(): Promise<unknown[]> }
