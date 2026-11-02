import { isBankError } from './bank-error.mjs'
export function publicError(error) {
  const status = Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599 ? error.status : 500
  const message = isBankError(error) && status < 500 ? error.message : error?.code === 'CREDENTIAL_BLOCKED' ? '请勿在对话中发送密码或银行卡安全码，请使用安全验证窗口。' : status >= 500 ? '助手服务暂时不可用，请稍后重试' : '请求未通过校验，请检查输入后重试'
  return { status, error: message, code: (isBankError(error) || ['CREDENTIAL_BLOCKED', 'CREDENTIAL_CHECK_UNAVAILABLE'].includes(error?.code)) && typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code) ? error.code : 'AGENT_REQUEST_FAILED' }
}
