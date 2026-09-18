/**
 * luckycat 知识库检索插件：注册 `knowledge_lookup` 工具。
 *
 * 一次调用做三件事：
 * 1. 用向量 + 关键词两路检索语料（向量不可用时**降级为关键词，并在输出里说明**）；
 * 2. 把命中（含原文）作为工具结果返回——模型据此作答，来源可审计；
 * 3. 用 `exec.deferContext()` 把同一批命中作为**有界**引用块注入**后续请求**
 *    （loop 会在 `tool/result` 之后追加），这样后面几轮即使不再调用工具也还看得到依据。
 *
 * 注入与结果都会进会话日志（DSH 的 "model-visible ⟺ logged"），
 * 所以"这一轮到底依据了哪几条资料"是可回查的。
 * @module @luckycat/dsh-rag
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { boundContextSummary, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { boundHits, DEFAULT_MAX_INJECT_BYTES } from './bound.ts'
import { chunkDocuments, DEFAULT_MAX_CHUNK_CHARS, loadCorpus } from './corpus.ts'
import { outcomeOf, rankHits } from './retrieve.ts'

export type * from './types.ts'
export { CorpusError, chunkDocuments, loadCorpus, DEFAULT_MAX_CHUNK_CHARS } from './corpus.ts'
export { boundHits, truncateUtf8, DEFAULT_MAX_INJECT_BYTES } from './bound.ts'
export { cosine, keywordCoverage, rankHits, outcomeOf, bigramsOf, normalizeForKeywords } from './retrieve.ts'

/** Cordis 插件名。 */
export const name = 'luckycat-rag'

/** 只硬依赖工具注册表；向量服务用 `ctx.get('embedding')` 可选读取，缺失时降级。 */
export const inject = ['tools']

/** 插件配置。 */
export interface Config {
  /** 语料 JSON 的**绝对路径**；读不到就在加载期报错（fail loud）。 */
  corpusPath: string
  /** 向量路由名；省略则用向量服务的 defaultRoute。 */
  route?: string
  /** 最多返回几条。默认 3。 */
  topK?: number
  /** 低于此分不返回。默认 0.34。 */
  minScore?: number
  /** 注入后续请求的字节预算（含包装）。默认 2000。 */
  maxInjectBytes?: number
  /** 单块最大字符数（按码点）。默认 800。 */
  maxChunkChars?: number
}

export const Config: z<Config> = z.object({
  corpusPath: z.string().required(),
  route: z.string(),
  topK: z.number().default(3),
  minScore: z.number().default(0.34),
  maxInjectBytes: z.number().default(DEFAULT_MAX_INJECT_BYTES),
  maxChunkChars: z.number().default(DEFAULT_MAX_CHUNK_CHARS),
})

/** 向量服务的最小结构类型（可选读取，避免与那个包耦合）。 */
interface EmbeddingLike {
  embed(request: { texts: readonly string[]; route?: string }): Promise<number[][]>
}

/** 参数限幅。 */
function clamp(value: number, low: number, high: number): number {
  if (!Number.isFinite(value)) return low
  return Math.min(high, Math.max(low, Math.trunc(value)))
}

/** 把任意失败描述成一行可读原因（带错误分类码，若有）。 */
function describeFailure(error: unknown): string {
  const code = (error as { code?: string }).code
  const message = error instanceof Error ? error.message : String(error)
  return code === undefined ? message : `${code}: ${message}`
}

/**
 * 注册 `knowledge_lookup`。
 * @param ctx - 上下文。
 * @param config - 插件配置。
 */
export function apply(ctx: Context, config: Config): void {
  // 启动期就同步读语料：路径错、JSON 坏、字段缺，立刻失败，不留到客户提问时。
  const documents = loadCorpus(config.corpusPath)
  const chunks = chunkDocuments(documents, config.maxChunkChars)
  const route = config.route === undefined ? {} : { route: config.route }
  const embeddingOf = (): EmbeddingLike | undefined =>
    (ctx as unknown as { get(name: string): unknown }).get('embedding') as EmbeddingLike | undefined

  // 块向量缓存：首次调用时算一次并复用；失败则清空缓存，下次可重试。
  let chunkVectorsPromise: Promise<number[][]> | undefined
  function ensureChunkVectors(embedding: EmbeddingLike): Promise<number[][]> {
    chunkVectorsPromise ??= embedding.embed({ texts: chunks.map(chunk => chunk.text), ...route }).catch((error: unknown) => {
      chunkVectorsPromise = undefined
      throw error
    })
    return chunkVectorsPromise
  }

  ctx.tools.register(defineTool({
    name: 'knowledge_lookup',
    description:
      'Search the internal knowledge base and return the most relevant passages with their source ids. '
      + 'Call this before answering any question about the organisation\'s own policies, fees, limits, or procedures. '
      + 'Answer from the returned passages and cite the source ids; if the passages do not cover the question, say so instead of guessing.',
    parameters: {
      query: { type: 'string', required: true, description: 'The question or keywords to search for.' },
      top_k: { type: 'number', description: 'Maximum number of passages to return. Defaults to the configured value.' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec): Promise<JsonValue> {
      const query = typeof args.query === 'string' ? args.query.trim() : ''
      if (query === '') {
        return { error: 'query must be a non-empty string' }
      }
      const topK = clamp(typeof args.top_k === 'number' ? args.top_k : (config.topK ?? 3), 1, 10)

      const embedding = embeddingOf()
      let queryVector: readonly number[] | undefined
      let chunkVectors: readonly (readonly number[])[] | undefined
      let degradedReason: string | undefined
      if (embedding === undefined) {
        degradedReason = '未挂载向量服务 ctx.embedding，已降级为关键词检索'
      } else {
        try {
          chunkVectors = await ensureChunkVectors(embedding)
          const queryVectors = await embedding.embed({ texts: [query], ...route })
          queryVector = queryVectors[0]
          if (queryVector === undefined) degradedReason = '向量服务没有返回查询向量，已降级为关键词检索'
        } catch (error) {
          chunkVectors = undefined
          queryVector = undefined
          degradedReason = `向量检索不可用，已降级为关键词检索（${describeFailure(error)}）`
        }
      }

      const hits = rankHits({
        query,
        chunks,
        ...queryVector === undefined || chunkVectors === undefined ? {} : { queryVector, chunkVectors },
        topK,
        minScore: config.minScore ?? 0.34,
      })
      const outcome = outcomeOf(hits, chunks, degradedReason)
      const bounded = boundHits(hits, config.maxInjectBytes ?? DEFAULT_MAX_INJECT_BYTES)

      // 注入后续请求：即使后面几轮不再调用工具，依据仍在上下文里。
      if (bounded.text !== '') {
        exec.deferContext(createUserMessage({
          content: [{ type: 'text', text: bounded.text }],
          source: {
            kind: 'plugin',
            plugin: name,
            form: 'notice',
            summary: boundContextSummary(`知识库命中 ${hits.length} 条，注入 ${bounded.injectedBytes} 字节`),
          },
        }))
      }

      return {
        query,
        mode: outcome.mode,
        ...outcome.degradedReason === undefined ? {} : { degradedReason: outcome.degradedReason },
        indexedChunks: outcome.indexedChunks,
        corpusPath: config.corpusPath,
        injection: {
          bytes: bounded.injectedBytes,
          dropped: bounded.dropped,
          truncated: bounded.truncated,
        },
        hits: hits.map(hit => ({
          source: `${hit.chunk.documentId}#${hit.chunk.index}`,
          ...hit.chunk.title === undefined ? {} : { title: hit.chunk.title },
          score: Number(hit.score.toFixed(4)),
          matchedBy: hit.matchedBy,
          coverage: Number(hit.coverage.toFixed(4)),
          ...hit.similarity === undefined ? {} : { similarity: Number(hit.similarity.toFixed(4)) },
          text: hit.chunk.text,
        })),
      } as unknown as JsonValue
    },
  }))
}