/**
 * 向量服务的对外类型。本文件**只有类型**，不含运行时代码。
 * @module @luckycat/dsh-embedding/types
 */

/** 一条向量路由的配置。`providers` 字典的**键就是路由名**。 */
export interface EmbeddingRouteConfig {
  /** 展示名，仅用于诊断输出。 */
  displayName?: string
  /** 凭据来源：**环境变量名**（只引用名字，不落密钥）。 */
  apiKeyEnv?: string
  /** 线协议。当前只实现 OpenAI 兼容的 `/embeddings`。 */
  api?: 'openai-embeddings'
  /** 接口根地址，例如 https://openrouter.ai/api/v1 。 */
  baseURL: string
  /** 模型 id。 */
  model?: string
  /** 期望维度；不填则由服务端决定。 */
  dimensions?: number
  /** 一次请求最多带多少条文本。默认 64。 */
  batchSize?: number
  /** 单次请求超时（毫秒）。默认 30000。 */
  timeoutMs?: number
  /** 最大尝试次数（含首次）。默认 2；**不允许无限重试**。 */
  maxAttempts?: number
}

/** 向量服务配置。 */
export interface EmbeddingConfig {
  /** 路由字典，键为路由名。 */
  providers?: Record<string, EmbeddingRouteConfig>
  /** 调用方不指定路由时使用的默认路由名。 */
  defaultRoute?: string
}

/** 一次向量化请求。 */
export interface EmbeddingRequest {
  /** 路由名；省略则用 defaultRoute，再退化为唯一已注册的路由。 */
  route?: string
  /** 待向量化的文本。空数组会被拒绝。 */
  texts: readonly string[]
  /** 取消信号。 */
  signal?: AbortSignal
}

/** 一个向量后端。业务方可以实现它并注册进服务。 */
export interface EmbeddingProvider {
  /** 把若干条文本映射成等长的向量数组，顺序与入参一致。 */
  embed(request: EmbeddingRequest): Promise<number[][]>
  /** 该后端声称支持的模型 id（可选，仅用于诊断）。 */
  listModels?(): readonly string[]
}

/** 失败原因分类：调用方能据此区分"配置错""凭据缺""上游错"。 */
export type EmbeddingErrorCode =
  | 'NO_ROUTE'
  | 'UNKNOWN_ROUTE'
  | 'DUPLICATE_ROUTE'
  | 'EMPTY_INPUT'
  | 'MISSING_CREDENTIAL'
  | 'ENDPOINT_NOT_ALLOWED'
  | 'HTTP_STATUS'
  | 'MALFORMED_RESPONSE'
  | 'TIMEOUT'
  | 'TRANSPORT'