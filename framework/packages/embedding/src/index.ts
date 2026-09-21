/**
 * luckycat 向量服务：给检索/RAG 提供"文字 → 向量"的能力。
 *
 * 为什么要有这个包：DSH **完全没有** embedding 通道（全仓没有 `ctx.embedding`，
 * `packages/llm/*` 连 `embed(` 都没有），所以这部分必须自己写。
 *
 * 形状对齐 DSH 自己的 `ctx.llm`（adapter registry）：路由名 + 后端注册表 +
 * 「注册即 effect」。换向量模型 = 改配置里的路由，不改代码。
 *
 * ```yaml
 * - id: luckycat-embedding
 *   name: '@luckycat/dsh-embedding'
 *   config:
 *     defaultRoute: openrouter
 *     providers:
 *       openrouter:
 *         apiKeyEnv: OPENROUTER_API_KEY   # 只引用变量名，不落密钥
 *         api: openai-embeddings
 *         baseURL: https://openrouter.ai/api/v1
 *         model: baai/bge-m3
 *         dimensions: 1024
 * ```
 *
 * @module @luckycat/dsh-embedding
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { EmbeddingError } from './errors.ts'
import { createOpenAiEmbeddingsProvider } from './openai-embeddings.ts'
import type { EmbeddingConfig, EmbeddingProvider, EmbeddingRequest, EmbeddingRouteConfig } from './types.ts'

export type * from './types.ts'
export { EmbeddingError } from './errors.ts'
export { createOpenAiEmbeddingsProvider } from './openai-embeddings.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    embedding: EmbeddingService
  }
}

/** 单条路由的配置校验。字段与 {@link EmbeddingRouteConfig} 一一对应。 */
const routeSchema: z<EmbeddingRouteConfig> = z.object({
  displayName: z.string(),
  apiKeyEnv: z.string(),
  api: z.union(['openai-embeddings']),
  baseURL: z.string(),
  model: z.string(),
  dimensions: z.number(),
  batchSize: z.number(),
  timeoutMs: z.number(),
  maxAttempts: z.number(),
})

/**
 * 向量服务：持有一张「路由名 → 后端」的表，并把每次调用路由过去。
 *
 * 构造时按配置把 OpenAI 兼容后端装进表里；业务方也可以用
 * {@link EmbeddingService.registerProvider} 注册自己的后端（注册是 effect，
 * 插件卸载时自动摘掉）。
 */
export class EmbeddingService extends Service {
  /** 配置校验；`providers` 的键就是路由名。 */
  static Config: z<EmbeddingConfig> = z.object({
    providers: z.dict(routeSchema).default({}),
    defaultRoute: z.string(),
  })

  private readonly providers = new Map<string, EmbeddingProvider>()

  /**
   * @param ctx - 所属上下文。
   * @param config - 已由 schemastery 填好默认值的配置。
   */
  constructor(ctx: Context, public config: EmbeddingConfig) {
    super(ctx, 'embedding')
    for (const [route, routeConfig] of Object.entries(config.providers ?? {})) {
      this.registerProvider([route], createOpenAiEmbeddingsProvider(route, routeConfig))
    }
  }

  /**
   * 注册一个后端到一条或多条路由。注册是 effect 作用域，卸载即回收。
   * @param routes - 路由名；重复注册同名路由会抛错（不静默覆盖）。
   * @param provider - 该路由的后端实现。
   * @returns 卸载函数。
   */
  registerProvider(routes: readonly string[], provider: EmbeddingProvider): () => void {
    const names = routes.map(route => route.trim())
    if (names.length === 0) {
      throw new EmbeddingError('NO_ROUTE', 'embedding: registerProvider 至少需要一个路由名')
    }
    for (const name of names) {
      if (name === '') throw new EmbeddingError('NO_ROUTE', 'embedding: 路由名不能为空')
    }
    const providers = this.providers
    return this.ctx.effect(() => {
      for (const name of names) {
        if (providers.has(name)) {
          throw new EmbeddingError('DUPLICATE_ROUTE', `embedding: 路由 "${name}" 已注册`)
        }
        providers.set(name, provider)
      }
      return () => {
        for (const name of names) providers.delete(name)
      }
    }, `embedding.registerProvider(${names.join(',')})`)
  }

  /** 当前已注册的路由名（诊断用）。 */
  listRoutes(): readonly string[] {
    return [...this.providers.keys()]
  }

  /**
   * 把文本向量化。路由解析顺序：请求指定 → `defaultRoute` → 唯一已注册的路由。
   * @param request - 文本与可选路由、取消信号。
   * @returns 与入参等长、顺序一致的向量数组。
   */
  async embed(request: EmbeddingRequest): Promise<number[][]> {
    const routes = this.listRoutes()
    const route = request.route ?? this.config.defaultRoute ?? (routes.length === 1 ? routes[0] : undefined)
    if (route === undefined) {
      throw new EmbeddingError('NO_ROUTE', `embedding: 没有可用路由（已注册 ${routes.length} 条；请设置 defaultRoute 或在请求里指定 route）`)
    }
    const provider = this.providers.get(route)
    if (provider === undefined) {
      throw new EmbeddingError('UNKNOWN_ROUTE', `embedding: 未知路由 "${route}"（已知：${routes.join(', ') || '无'}）`)
    }
    return await provider.embed({ ...request, route })
  }
}

export default EmbeddingService