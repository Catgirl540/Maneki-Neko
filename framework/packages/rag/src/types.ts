/**
 * RAG 插件的对外类型。本文件**只有类型**。
 * @module @luckycat/dsh-rag/types
 */

export interface CorpusSection { id: string; title: string; text: string }

/** 语料文件里的一条文档。 */
export interface CorpusDocument {
  /** 稳定 id，会出现在检索结果里（审计用）。 */
  id: string
  /** 标题，便于模型理解与人工核对。 */
  title?: string
  sections?: readonly CorpusSection[]
  routes?: readonly string[]
  version?: string
  /** 正文。 */
  text: string
  /** 可选标签，用于关键词检索。 */
  tags?: readonly string[]
}

/** 语料文件格式。 */
export interface CorpusFile {
  version?: string
  documents: readonly CorpusDocument[]
}

/** 切块后的一条可检索单元。 */
export interface Chunk {
  /** 来源文档 id。 */
  documentId: string
  /** 块序号，从 0 开始。 */
  index: number
  /** 来源标题。 */
  title?: string
  sectionId?: string
  sectionTitle?: string
  tags?: readonly string[]
  routes?: readonly string[]
  version?: string
  /** 块正文。 */
  text: string
}

/** 一条检索命中。 */
export interface Hit {
  chunk: Chunk
  /** 综合得分（向量与关键词取较优者）。 */
  score: number
  /** 向量余弦相似度；向量不可用时为 undefined。 */
  similarity?: number
  /** 关键词（字符二元组）覆盖率；始终有值。 */
  coverage: number
  /** 这条命中是靠哪一路胜出的。 */
  matchedBy: 'vector' | 'keyword'
}

/** 检索整体用了哪条通道。 */
export type RetrievalMode = 'hybrid' | 'keyword-only'

/** 检索结果（含降级说明，便于审计）。 */
export interface RetrievalOutcome {
  hits: readonly Hit[]
  mode: RetrievalMode
  /** 降级原因（例如向量服务不可用）；未降级时为 undefined。 */
  degradedReason?: string
  /** 参与检索的块总数。 */
  indexedChunks: number
}