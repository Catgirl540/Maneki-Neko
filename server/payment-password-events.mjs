import { AsyncLocalStorage } from 'node:async_hooks'

// Security verification events survive a business savepoint rollback. Each root
// unit owns its list; nested staff callbacks join it and cannot mix customers.
const events = new AsyncLocalStorage()
export const withPaymentPasswordEvents = (list, work) => events.run(list, work)
export function recordPaymentPasswordEvent(ownerId, verified) {
  events.getStore()?.push({ ownerId, verified })
}
