export const bankError = (message, status = 400, code = 'AGENT_BANK_ERROR') => Object.assign(new Error(message), { status, code })
