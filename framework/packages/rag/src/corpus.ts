/**
 * 语料加载与切块。全部是纯函数 + 一次同步读盘，便于离线测试。
 * @module @luckycat/dsh-rag/corpus
 */

import { readFileSync } from 'node:fs'
import type { Chunk, CorpusDocument, CorpusFile } from './types.ts'

/** 默认单块最大字符数（按码点计）。 */
export const DEFAULT_MAX_CHUNK_CHARS = 800

/** 语料格式或路径有问题时抛出；信息里带路径，便于定位。 */
export class CorpusError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'CorpusError'
  }
}

/** 校验一条文档的形状。 */
function assertDocument(raw: unknown, position: number, path: string): CorpusDocument {
  const document = raw as Partial<CorpusDocument> | null
  if (document === null || typeof document !== 'object') {
    throw new CorpusError(`corpus ${path}: documents[${position}] 不是对象`)
  }
  if (typeof document.id !== 'string' || document.id.trim() === '') {
    throw new CorpusError(`corpus ${path}: documents[${position}].id 必须是非空字符串`)
  }
  if (typeof document.text !== 'string' || document.text.trim() === '') {
    throw new CorpusError(`corpus ${path}: documents[${position}]（id=${document.id}）的 text 必须是非空字符串`)
  }
  return document as CorpusDocument
}

/**
 * 同步读取并校验语料文件。
 *
 * 刻意**同步 + 启动期**：路径写错、JSON 坏了、字段缺了，都在加载插件时立刻报错，
 * 而不是等到客户提问才失败（对齐 DSH 的 "misconfiguration fails loud" 约定）。
 * @param path - 语料 JSON 的绝对路径。
 * @returns 校验通过的文档数组。
 */
export function loadCorpus(path: string): CorpusDocument[] {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (error) {
    throw new CorpusError(`corpus ${path}: 读不到文件（${(error as NodeJS.ErrnoException).code ?? 'unknown'}）`, { cause: error })
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new CorpusError(`corpus ${path}: 不是合法 JSON`, { cause: error })
  }
  const documents = (parsed as Partial<CorpusFile> | null)?.documents
  if (!Array.isArray(documents)) {
    throw new CorpusError(`corpus ${path}: 缺少 documents 数组`)
  }
  if (documents.length === 0) {
    throw new CorpusError(`corpus ${path}: documents 为空`)
  }
  const ids = new Set<string>()
  return documents.map((entry, position) => {
    const document = assertDocument(entry, position, path)
    if (ids.has(document.id)) throw new CorpusError(`corpus ${path}: 文档 id 重复：${document.id}`)
    ids.add(document.id)
    return document
  })
}

/** 按空行切段。 */
function paragraphsOf(text: string): string[] {
  return text.split(/\n\s*\n/).map(part => part.trim()).filter(part => part !== '')
}

/** 把过长的段落按码点硬切成若干段。 */
function hardSplit(paragraph: string, maxChars: number): string[] {
  const points = Array.from(paragraph)
  if (points.length <= maxChars) return [paragraph]
  const pieces: string[] = []
  for (let index = 0; index < points.length; index += maxChars) {
    pieces.push(points.slice(index, index + maxChars).join(''))
  }
  return pieces
}

/**
 * 把文档切成可检索的块：先按空行分段，超长段落再按码点硬切。
 * 按码点切保证**不会把一个字切成半个**。
 * @param documents - 语料文档。
 * @param maxChunkChars - 单块最大码点数。
 * @returns 展平后的块数组。
 */
export function chunkDocuments(documents: readonly CorpusDocument[], maxChunkChars: number = DEFAULT_MAX_CHUNK_CHARS): Chunk[] {
  const chunks: Chunk[] = []
  for (const document of documents) {
    const pieces = paragraphsOf(document.text).flatMap(paragraph => hardSplit(paragraph, maxChunkChars))
    pieces.forEach((text, index) => {
      chunks.push({
        documentId: document.id,
        index,
        text,
        ...document.title === undefined ? {} : { title: document.title },
      })
    })
  }
  return chunks
}