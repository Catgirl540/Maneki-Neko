/**
 * 检索打分：向量余弦 + 关键词（字符二元组）覆盖，取较优者。
 *
 * 为什么两路都要：向量擅长"意思相近"，但对**精确数字与专名**（"千分之一"、
 * "50 元"）有时会漏；关键词覆盖正好补这一点。两路都算、都记进结果里，
 * 出问题时能看清是哪一路把某条资料捞出来的。
 * @module @luckycat/dsh-rag/retrieve
 */

import type { Chunk, Hit, RetrievalOutcome } from './types.ts'

/** 关键词归一化：转小写、去掉空白与常见标点。 */
export function normalizeForKeywords(text: string): string {
  return text.toLowerCase().replace(/[\s，。、；：？！“”‘’（）《》【】,.;:?!"'()<>[\]{}\-_/\\|~`=+*&^%$#@]+/gu, '')
}

/** 取字符二元组集合；不足两个码点时退化为该字符本身。 */
export function bigramsOf(text: string): Set<string> {
  const points = Array.from(normalizeForKeywords(text))
  const grams = new Set<string>()
  if (points.length === 0) return grams
  if (points.length === 1) {
    grams.add(points[0] as string)
    return grams
  }
  for (let index = 0; index + 1 < points.length; index += 1) {
    grams.add(`${points[index]}${points[index + 1]}`)
  }
  return grams
}

/**
 * 查询词在候选文本里的覆盖率：命中的二元组数 / 查询二元组总数。
 * 覆盖率是"查询的多少被这段文本覆盖"，所以长度越接近、重叠越多分越高。
 * @param query - 用户问题。
 * @param text - 候选块正文。
 * @returns 0..1 之间的覆盖率。
 */
export function keywordCoverage(query: string, text: string): number {
  const queryGrams = bigramsOf(query)
  if (queryGrams.size === 0) return 0
  const textGrams = bigramsOf(text)
  let matched = 0
  for (const gram of queryGrams) if (textGrams.has(gram)) matched += 1
  return matched / queryGrams.size
}

/** 余弦相似度；任一向量为零向量时返回 0。 */
export function cosine(a: readonly number[], b: readonly number[]): number {
  const length = Math.min(a.length, b.length)
  let dot = 0
  let normA = 0
  let normB = 0
  for (let index = 0; index < length; index += 1) {
    const left = a[index] as number
    const right = b[index] as number
    dot += left * right
    normA += left * left
    normB += right * right
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

/** 移除口语提问外壳，保留业务名词；不改动金额、币种与否定条件。 */
export function queryKeywords(query: string): string {
  const normalized = normalizeForKeywords(query)
    .replace(/请问|请帮我|帮我|我想要|我想|能不能|可以不可以|在哪里|在哪儿|哪里|怎么|如何|是不是|需要|应该|一下|什么|哪些|多少|准备|怎么办|的吗|了吗|呢|吗|呀|啊|啥|的/gu, '')
  return normalized || query
}

/** 排序与截断的入参。 */
export interface RankInput {
  /** 用户问题。 */
  query: string
  /** 查询向量；向量不可用时省略。 */
  queryVector?: readonly number[]
  /** 全部块。 */
  chunks: readonly Chunk[]
  /** 与 chunks 一一对应的块向量；顺序必须一致。 */
  chunkVectors?: readonly (readonly number[])[]
  /** 最多返回几条。 */
  topK: number
  /** 低于此分不返回。 */
  minScore: number
}

/**
 * 打分并排序。综合分取两路中较优者，同时保留两路各自的原始值。
 * @param input - 查询、块、可选的向量。
 * @returns 命中的块（已按分数降序、已截断到 topK）。
 */
export function rankHits(input: RankInput): Hit[] {
  const hits: Hit[] = []
  const keywords = queryKeywords(input.query)
  // 多个业务问题并列时，完整句子覆盖率会被其他问题稀释；同时检索各个有效分句。
  const clauses = input.query.split(/[，、；。？！,;.!?]/u).map(queryKeywords)
    .filter(part => Array.from(part).length >= 3 && !/^(到|在|去)?(操作|办理|处理|页面|入口)$/.test(part)).slice(0, 8)
  const bodyCoverage = (text: string): number => Math.max(keywordCoverage(keywords, text),
    ...clauses.map(clause => keywordCoverage(clause, text) * 0.9))
  for (const [position, chunk] of input.chunks.entries()) {
    const coverage = Math.max(
      bodyCoverage(chunk.text) * (chunk.sectionTitle ? 0.85 : 1)
        + (chunk.sectionTitle ? bodyCoverage(chunk.sectionTitle) * 0.15 : 0),
      // 文档级关键词只作辅助，避免同篇所有问答得到相同高分。
      keywordCoverage(keywords, [chunk.title, ...(chunk.tags ?? [])].filter(Boolean).join(' ')) * 0.6,
    )
    const vector = input.queryVector === undefined ? undefined : input.chunkVectors?.[position]
    const similarity = vector === undefined ? undefined : cosine(input.queryVector as readonly number[], vector)
    const score = Math.max(similarity ?? 0, coverage)
    if (score < input.minScore) continue
    hits.push({
      chunk,
      score,
      coverage,
      ...similarity === undefined ? {} : { similarity },
      matchedBy: (similarity ?? 0) >= coverage ? 'vector' : 'keyword',
    })
  }
  hits.sort((left, right) => right.score - left.score)
  return hits.slice(0, input.topK)
}

/** 组装检索结果，含"走了哪条通道"的说明。 */
export function outcomeOf(hits: readonly Hit[], chunks: readonly Chunk[], degradedReason?: string): RetrievalOutcome {
  return {
    hits,
    mode: degradedReason === undefined ? 'hybrid' : 'keyword-only',
    ...degradedReason === undefined ? {} : { degradedReason },
    indexedChunks: chunks.length,
  }
}