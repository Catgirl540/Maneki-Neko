import { isValidLoginPassword } from '../shared/password-policy.mjs'
import { assertAccountActive, resetPaymentPasswordFailures } from '../shared/account-security.mjs'
import { hashPassword } from './passwords.mjs'

export const PASSWORD_MAINTENANCE_ACTIONS = ['set-staff-password', 'set-customer-password', 'set-payment-password']

export function assertMaintenancePassword(action, password) {
  const valid = typeof password === 'string' && !/[\0\r\n]/.test(password) && (
    action === 'set-customer-password' ? isValidLoginPassword(password) :
    action === 'set-payment-password' ? /^\d{6}$/.test(password) :
    action === 'set-staff-password' && password.length >= 12 && password.length <= 20
  )
  if (!valid) throw Object.assign(new Error('Invalid maintenance password format'), { code: 'INVALID_PASSWORD_FORMAT' })
}

/** Maintenance can reset a credential, but staff must unfreeze a frozen account. */
export function setCustomerMaintenancePassword(profile, action, password) {
  assertMaintenancePassword(action, password)
  if (action === 'set-customer-password') {
    profile.passwordDigest = hashPassword(password)
  } else if (action === 'set-payment-password') {
    assertAccountActive(profile)
    profile.payPassword = hashPassword(password)
    resetPaymentPasswordFailures(profile)
  } else {
    throw Object.assign(new Error('Unknown customer maintenance action'), { code: 'INVALID_PASSWORD_FORMAT' })
  }
}
