const safeErrors = new WeakSet()
export const bankError = (message, status = 400, code = 'AGENT_BANK_ERROR') => { const error = Object.assign(new Error(message), { status, code }); safeErrors.add(error); return error }
export const isBankError = error => safeErrors.has(error)
