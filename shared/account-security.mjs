export const PAY_PASSWORD_MAX_ATTEMPTS = 5
export const ACCOUNT_FROZEN_MESSAGE = '支付密码连续输错 5 次，账号已冻结，请联系工作人员核验身份后解冻'

export function paymentSecurityStatus(profile) {
  const failedAttempts = Math.max(0, Math.min(PAY_PASSWORD_MAX_ATTEMPTS, Number(profile.payPasswordFailures) || 0))
  const frozen = failedAttempts >= PAY_PASSWORD_MAX_ATTEMPTS
  return { frozen, failedAttempts, maxAttempts: PAY_PASSWORD_MAX_ATTEMPTS, reason: frozen ? ACCOUNT_FROZEN_MESSAGE : null }
}

export function assertAccountActive(profile) {
  if (paymentSecurityStatus(profile).frozen) {
    throw Object.assign(new Error(ACCOUNT_FROZEN_MESSAGE), { status: 423, code: 'ACCOUNT_FROZEN' })
  }
}

export function recordPaymentPasswordFailure(profile) {
  profile.payPasswordFailures = Math.min(PAY_PASSWORD_MAX_ATTEMPTS, paymentSecurityStatus(profile).failedAttempts + 1)
  return paymentSecurityStatus(profile)
}

export function resetPaymentPasswordFailures(profile) {
  assertAccountActive(profile)
  profile.payPasswordFailures = 0
}

/** Internal staff hook only: never expose this through the customer BankApi. */
export function unfreezeAccount(profile) {
  profile.payPasswordFailures = 0
  return paymentSecurityStatus(profile)
}

export function paymentPasswordFailureError(profile) {
  const status = paymentSecurityStatus(profile)
  return Object.assign(new Error(status.frozen ? ACCOUNT_FROZEN_MESSAGE : `支付密码不正确，还可尝试 ${PAY_PASSWORD_MAX_ATTEMPTS - status.failedAttempts} 次`), {
    status: status.frozen ? 423 : 401,
    code: status.frozen ? 'ACCOUNT_FROZEN' : 'BAD_PAY_PASSWORD',
    // The HTTP unit of work must persist this security event after rolling back business changes.
    paymentPasswordFailure: profile.user.id,
  })
}

// Explicitly allow only authentication, read/preview and support while frozen.
// New methods are blocked by default, including mutations that do not take a PIN.
const FROZEN_ALLOWED = new Set([
  'login', 'register', 'logout', 'profile', 'sendSmsCode', 'verifyIdentity',
  'listAccounts', 'getAccount', 'listTransactions', 'exportTransactions', 'getTransaction', 'getReceipt',
  'listBanks', 'getReceivingInfo', 'resolveCardBin', 'listPayees', 'resolveFps', 'quoteTransfer', 'resolveTransferRecipient',
  'listScheduledTransfers', 'listSplitCollections', 'listSplitPaymentRequests', 'getBillingReport', 'exportBillingReport',
  'listCards', 'listCardProducts', 'listWealthProducts', 'getWealthProduct', 'getWealthOverview', 'listRiskQuestions',
  'getSpending', 'getCashFlow', 'listAutoDebits', 'listBirthdayPlans', 'previewBirthdayPlan', 'listBudgets', 'getSecurityOverview',
  'listSupportMessages', 'sendSupportMessage', 'requestHumanSupport', 'listSupportTickets', 'getSupportTicket', 'replySupportTicket',
  'quoteExchange', 'getSavingsOverview', 'getInvitations', 'getMembership', 'getSalaryPlan', 'getOverdraft',
  'getCreditOverview', 'getCashManagement', 'getInvestments', 'getInsurance',
])

export function protectAccountApi(api, getProfile) {
  for (const [method, implementation] of Object.entries(api)) {
    if (typeof implementation !== 'function' || FROZEN_ALLOWED.has(method)) continue
    api[method] = async (...args) => {
      assertAccountMethodAllowed(getProfile(), method)
      return implementation.apply(api, args)
    }
  }
  return api
}

export function assertAccountMethodAllowed(profile, method) {
  if (!FROZEN_ALLOWED.has(method)) assertAccountActive(profile)
}
