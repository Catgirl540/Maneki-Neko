const reasons = {
  TRANSPORT: '模型连接中断', TIMEOUT: '模型请求超时', RATE_LIMIT: '模型服务繁忙',
  SERVER: '模型服务暂时不可用', EMPTY_RESPONSE: '模型没有返回内容',
}

/** 只公开重试进度，不把服务商、原始错误或请求内容送到网页。 */
export function projectModelRetry(event) {
  const data = event?.data
  if (!data || !Number.isInteger(data.retry) || data.retry < 1) return undefined
  if (event.type === 'llm/retry-started') return { type: 'model-retry', phase: 'running', attempt: data.retry, delayMs: 0 }
  if (event.type !== 'llm/retry' || data.mode !== 'normal' || !Number.isInteger(data.maxRetries)
    || data.retry > data.maxRetries || !Number.isFinite(data.delayMs) || data.delayMs < 0) return undefined
  return { type: 'model-retry', phase: 'waiting', attempt: data.retry, maxRetries: data.maxRetries,
    delayMs: data.delayMs, reason: reasons[data.failure?.code] ?? '模型请求暂时失败' }
}

export function modelFailureMessage(failure, retries = 0) {
  const reason = reasons[failure?.code]
  if (reason) return `${reason}${retries ? `，已自动重试 ${retries} 次仍未恢复` : ''}，可稍后点击“重试”。`
  if (['AUTH', 'MISSING_CREDENTIAL', 'INVALID_CREDENTIAL'].includes(failure?.code)) return '模型服务认证失败，请联系维护人员检查配置。'
  if (failure?.code === 'CONTEXT_WINDOW_EXCEEDED') return '当前对话内容超出模型容量，请新建对话后重试。'
  return '本轮没有生成完整回复，可点击“重试”继续。'
}
