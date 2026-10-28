export const PAY_PASSWORD_MAX_ATTEMPTS: 5
export const ACCOUNT_FROZEN_MESSAGE: string
export interface AccountSecurityStatus { frozen: boolean; failedAttempts: number; maxAttempts: 5; reason: string | null }
interface SecurityProfile { payPasswordFailures?: number }
export function paymentSecurityStatus(profile: SecurityProfile): AccountSecurityStatus
export function assertAccountActive(profile: SecurityProfile): void
export function assertAccountMethodAllowed(profile: SecurityProfile, method: string): void
export function recordPaymentPasswordFailure(profile: SecurityProfile): AccountSecurityStatus
export function resetPaymentPasswordFailures(profile: SecurityProfile): void
export function unfreezeAccount(profile: SecurityProfile): AccountSecurityStatus
export function paymentPasswordFailureError(profile: SecurityProfile & { user: { id: string } }): Error & { status: number; code: string; paymentPasswordFailure: string }
export function protectAccountApi<T extends object>(api: T, getProfile: () => SecurityProfile): T
