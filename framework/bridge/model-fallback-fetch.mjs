/**
 * 仅在 Harness 子进程加载：给 OpenRouter 的聊天请求附加有序备用模型。
 * 使用上游原生 models 路由，不在工具执行后重新发送整轮对话。
 */
export function createFallbackFetch(fetchImpl, models) {
  const fallbacks = [...new Set(models.map(value => value.trim()).filter(Boolean))]
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input)
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
    if (url.origin !== 'https://openrouter.ai' || url.pathname !== '/api/v1/chat/completions' || method.toUpperCase() !== 'POST' || fallbacks.length === 0) {
      return fetchImpl(input, init)
    }
    const raw = init?.body ?? (input instanceof Request ? await input.clone().text() : undefined)
    if (typeof raw !== 'string') return fetchImpl(input, init)
    let body
    try { body = JSON.parse(raw) } catch { return fetchImpl(input, init) }
    if (typeof body.model !== 'string') return fetchImpl(input, init)
    body.models = [...new Set([body.model, ...fallbacks])]
    delete body.model
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
    headers.delete('content-length')
    const options = { ...init, headers, body: JSON.stringify(body) }
    if (input instanceof Request) return fetchImpl(new Request(input, options))
    return fetchImpl(input, options)
  }
}

if (process.env.LUCKYCAT_FALLBACK_MODELS) {
  globalThis.fetch = createFallbackFetch(globalThis.fetch, process.env.LUCKYCAT_FALLBACK_MODELS.split(','))
}
