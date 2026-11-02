import type { Payee } from '../app/src/api/types'
export function searchPayees(payees: Payee[], keyword?: string): Payee[]
export function updatePayeeRemark(payees: Payee[], id: string, remark: string): Payee
export function rememberInternalPayee(db: { payees: Payee[] }, request: import('../app/src/api/types').TransferRequest, nextId: (prefix: string) => string): void
/** 手动添加收款人（转账与 AA 共用通讯录）。 */
export function addPayee(payees: Payee[], input: { name: string; phone?: string; accountNo?: string }, nextId: (prefix: string) => string): Payee
/** AA 发起成功时记下参与者，供下次从户名下拉里选择。 */
export function rememberAaContact(db: { payees?: Payee[] }, contact: { name: string; phone?: string; accountNo?: string }, nextId: (prefix: string) => string): void
