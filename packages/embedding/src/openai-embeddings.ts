/**
 * OpenAI 兼容的向量后端（`POST {baseURL}/embeddings`）。
 *
 * 设计要点：
 * - **凭据只引用环境变量名**，调用时才读，所以换 key 不需要重启；
 * - 错误里**绝不出现密钥**，只出现环境变量名；
 * - 带凭据的请求**不跟随重定向**（redirect: 'error'），避免被转到别的源；
 * - 明文 http **只允许回环地址**（本机模型服务器），其余必须 https；
 * - 重试**有上限**（默认 2 次），不做无限重试（对照：DSH 的 llm-retry 有个
 *   `always` 模式，那个会一直重试且每次都计费）。
 * @module @luckycat/dsh-embedding/openai-embeddings
 */

import { EmbeddingError } from './errors.ts'
import type { EmbeddingProvider, EmbeddingRequest, EmbeddingRouteConfig } from './types.ts'

/** 默认一次请求带多少条文本。 */
const DEFAULT_BATCH_SIZE = 64
/** 默认单次请求超时。 */
const DEFAULT_TIMEOUT_MS = 30_000
/** 默认最大尝试次数（含首次）。 */
const DEFAULT_MAX_ATTEMPTS = 2
/** 错误信息里回显响应体的上限，避免把整页 HTML 塞进日志。 */
const BODY_EXCERPT_LIMIT = 300
/** 首次退避基数；第 n 次重试用 base * 2^(n-1)。 */
const BACKOFF_BASE_MS = 300

/** URL 末尾拼路径，容忍多余的斜杠。 */
function endpointOf(baseURL: string): string {
  return `${baseURL.replace(/\/+$/, '')}/embeddings`
}

/** 只允许 https；明文 http 仅限回环地址。 */
function assertEndpointAllowed(route: string, endpoint: string): void {
  let url: URL
  try {
    url = new URL(endpoint)
  } catch (error) {
    throw new EmbeddingError('ENDPOINT_NOT_ALLOWED', `embedding route "${route}": baseURL 不是合法 URL`, { cause: error })
  }
  if (url.protocol === 'https:') return
  const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1' || url.hostname === '[::1]'
  if (url.protocol === 'http:' && loopback) return
  throw new EmbeddingError(
    'ENDPOINT_NOT_ALLOWED',
    `embedding route "${route}": 只允许 https，或指向回环地址的 http（收到 ${url.protocol}//${url.hostname}）`,
  )
}

/** 把文本切成固定大小的批次。 */
function batchesOf(texts: readonly string[], size: number): string[][] {
  const out: string[][] = []
  for (let index = 0; index < texts.length; index += size) out.push(texts.slice(index, index + size))
  return out
}

/** 截断响应体用于报错回显。 */
function excerpt(body: string): string {
  const flat = body.replace(/\s+/g, ' ').trim()
  return flat.length <= BODY_EXCERPT_LIMIT ? flat : `${flat.slice(0, BODY_EXCERPT_LIMIT)}…`
}

/** 5xx / 429 / 网络抖动可重试；4xx（除 429）不重试。 */
function retriable(status: number | undefined): boolean {
  if (status === undefined) return true
  return status === 429 || status >= 500
}

/** 合并调用方的取消信号与超时信号。 */
function combineSignals(timeoutMs: number, signal: AbortSignal | undefined): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs)
  return signal === undefined ? timeout : AbortSignal.any([signal, timeout])
}

/** 从配置里解析出这次调用要用的凭据。 */
function resolveCredential(route: string, apiKeyEnv: string | undefined): string | undefined {
  if (apiKeyEnv === undefined) return undefined
  const value = process.env[apiKeyEnv]
  if (value === undefined || value.trim() === '') {
    throw new EmbeddingError('MISSING_CREDENTIAL', `embedding route "${route}": 环境变量 ${apiKeyEnv} 未设置（只报告变量名，不打印取值）`)
  }
  return value
}

/**
 * 读取 JSON 响应体。
 *
 * 为什么单独包一层：上游（或中间的代理）出错时常常返回 **HTML 错误页**，
 * 裸 `response.json()` 会抛出没有分类的 `SyntaxError`，调用方只能看到
 * "Unexpected token '<'" 这种没法诊断的消息。这里统一转成
 * `MALFORMED_RESPONSE` 并把响应片段带出来——baseURL 少写 `/v1` 时
 * 就是靠这条信息一眼看出来的（真实踩过）。
 */
async function readJson(route: string, response: Response): Promise<unknown> {
  const text = await response.text()
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('json')) {
    throw new EmbeddingError(
      'MALFORMED_RESPONSE',
      `embedding route "${route}": 期望 JSON，收到 content-type "${contentType || '未知'}"；响应片段：${excerpt(text)}`,
    )
  }
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new EmbeddingError('MALFORMED_RESPONSE', `embedding route "${route}": 响应不是合法 JSON；片段：${excerpt(text)}`, { cause: error })
  }
}

/** 校验并归一化响应体。 */
function parseEmbeddings(route: string, raw: unknown, expected: number): number[][] {
  const data = (raw as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) {
    throw new EmbeddingError('MALFORMED_RESPONSE', `embedding route "${route}": 响应里没有 data 数组`)
  }
  if (data.length !== expected) {
    throw new EmbeddingError('MALFORMED_RESPONSE', `embedding route "${route}": 期望 ${expected} 条向量，收到 ${data.length} 条`)
  }
  const ordered: number[][] = Array.from({ length: expected })
  for (const [position, entry] of data.entries()) {
    const item = entry as { index?: unknown; embedding?: unknown }
    const index = typeof item.index === 'number' ? item.index : position
    const vector = item.embedding
    if (!Array.isArray(vector) || vector.some(value => typeof value !== 'number')) {
      throw new EmbeddingError('MALFORMED_RESPONSE', `embedding route "${route}": 第 ${index} 条不是数字数组`)
    }
    if (index < 0 || index >= expected) {
      throw new EmbeddingError('MALFORMED_RESPONSE', `embedding route "${route}": 返回了越界下标 ${index}`)
    }
    ordered[index] = vector as number[]
  }
  return ordered
}

/**
 * 造一个 OpenAI 兼容的向量后端。
 * @param route - 路由名，只用于错误信息。
 * @param config - 该路由的配置。
 * @param fetchImpl - 注入点（默认全局 fetch），测试用。
 * @returns 可直接注册进服务的后端。
 */
export function createOpenAiEmbeddingsProvider(
  route: string,
  config: EmbeddingRouteConfig,
  fetchImpl: typeof fetch = globalThis.fetch,
): EmbeddingProvider {
  if (typeof config.baseURL !== 'string' || config.baseURL.trim() === '') {
    throw new EmbeddingError('ENDPOINT_NOT_ALLOWED', `embedding route "${route}": baseURL 未配置`)
  }
  const endpoint = endpointOf(config.baseURL)
  assertEndpointAllowed(route, endpoint)

  const batchSize = config.batchSize ?? DEFAULT_BATCH_SIZE
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxAttempts = config.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  if (batchSize < 1) throw new EmbeddingError('MALFORMED_RESPONSE', `embedding route "${route}": batchSize 必须 >= 1`)
  if (maxAttempts < 1) throw new EmbeddingError('MALFORMED_RESPONSE', `embedding route "${route}": maxAttempts 必须 >= 1`)

  async function requestBatch(batch: readonly string[], signal: AbortSignal | undefined): Promise<number[][]> {
    const credential = resolveCredential(route, config.apiKeyEnv)
    let lastError: unknown
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (attempt > 1) await new Promise(resolve => setTimeout(resolve, BACKOFF_BASE_MS * 2 ** (attempt - 2)))
      let status: number | undefined
      try {
        const response = await fetchImpl(endpoint, {
          method: 'POST',
          // 带凭据的请求绝不跟随重定向。
          redirect: 'error',
          headers: {
            'content-type': 'application/json',
            ...credential === undefined ? {} : { authorization: `Bearer ${credential}` },
          },
          body: JSON.stringify({
            model: config.model,
            input: batch,
            encoding_format: 'float',
            ...config.dimensions === undefined ? {} : { dimensions: config.dimensions },
          }),
          signal: combineSignals(timeoutMs, signal),
        })
        status = response.status
        if (!response.ok) {
          const body = await response.text().catch(() => '')
          throw new EmbeddingError('HTTP_STATUS', `embedding route "${route}": HTTP ${response.status} ${excerpt(body)}`)
        }
        return parseEmbeddings(route, await readJson(route, response), batch.length)
      } catch (error) {
        lastError = error
        const failureCode = error instanceof EmbeddingError ? error.code : undefined
        if (signal?.aborted === true) throw new EmbeddingError('TRANSPORT', `embedding route "${route}": 调用方取消`, { cause: error })
        const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
        if (timedOut) {
          lastError = new EmbeddingError('TIMEOUT', `embedding route "${route}": ${timeoutMs}ms 内没有响应`)
        }
        const canRetry = failureCode === undefined || retriable(status)
        if (attempt >= maxAttempts || !canRetry) break
      }
    }
    throw lastError instanceof Error ? lastError : new EmbeddingError('TRANSPORT', `embedding route "${route}": 未知失败`, { cause: lastError })
  }

  return {
    async embed(request: EmbeddingRequest): Promise<number[][]> {
      if (request.texts.length === 0) {
        throw new EmbeddingError('EMPTY_INPUT', `embedding route "${route}": 没有要向量化的文本`)
      }
      const vectors: number[][] = []
      for (const batch of batchesOf(request.texts, batchSize)) {
        vectors.push(...await requestBatch(batch, request.signal))
      }
      return vectors
    },
    listModels(): readonly string[] {
      return config.model === undefined ? [] : [config.model]
    },
  }
}