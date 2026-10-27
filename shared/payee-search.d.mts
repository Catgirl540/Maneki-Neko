import type { Payee } from '../app/src/api/types'
export function searchPayees(payees: Payee[], keyword?: string): Payee[]
export function updatePayeeRemark(payees: Payee[], id: string, remark: string): Payee
export function rememberInternalPayee(db: { payees: Payee[] }, request: import('../app/src/api/types').TransferRequest, nextId: (prefix: string) => string): void
