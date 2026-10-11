/**
 * 有界注入：把命中的资料拼成注入文本，并**保证总字节不超过预算**。
 *
 * 这是框架最容易出事的地方，所以规则写死并且可测：
 * 1. 预算包含**包装标签**在内的全部字节；
 * 2. 超预算时**先丢分数最低的**；
 * 3. 若只剩一条仍超预算，就**按码点安全截断**它（绝不切断一个字）；
 * 4. 丢了几条、有没有截断，都记在返回值里，会随工具结果一起进会话日志。
 * @module @luckycat/dsh-rag/bound
 */

import type { Hit } from './types.ts'

/** 默认注入预算（字节）。 */
export const DEFAULT_MAX_INJECT_BYTES = 2_000

/** 截断后至少还要留下这么多字节，否则宁可整条丢掉（留半个字没用）。 */
const MIN_USEFUL_BYTES = 80

/** 注入内容的固定包装。 */
const HEADER = [
  '<knowledge_reference>',
  '依据以下资料回答；来源编号、分数和内部路径仅供审计，不向客户展示。',
  '回复须为二至四个短句、三百字以内。多项业务各用一句说明能否办理、入口与必要限制，不得把部分不支持概括为全部不能办理。不复制资料或补充未问细节，不加示例、验证步骤、人工服务或追问邀请。',
  '无依据明确说明，不编造。实时余额、实际费用、汇率、净值、额度及状态须查询；查询失败引导对应页面。',
  '',
  '',
].join('\n')
const FOOTER = '</knowledge_reference>'

/** 有界注入的结果。 */
export interface BoundedContext {
  /** 要注入的完整文本（已含包装标签）。 */
  text: string
  /** 实际注入的字节数。 */
  injectedBytes: number
  /** 因预算被整条丢掉的命中数。 */
  dropped: number
  /** 是否有命中被截断。 */
  truncated: boolean
}

const encoder = new TextEncoder()

/**
 * 按**码点**安全截断到不超过 maxBytes。
 * 用 Array.from 按码点切，避免把 UTF-16 代理对切成半个字符。
 * @param text - 原文。
 * @param maxBytes - 字节上限。
 * @returns 截断后的文本（可能为空串）。
 */
export function truncateUtf8(text: string, maxBytes: number): string {
  if (encoder.encode(text).length <= maxBytes) return text
  const points = Array.from(text)
  let low = 0
  let high = points.length
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (encoder.encode(points.slice(0, mid).join('')).length <= maxBytes) low = mid
    else high = mid - 1
  }
  return points.slice(0, low).join('')
}

/** 渲染一条命中。 */
function renderHit(hit: Hit): string {
  const label = `${hit.chunk.documentId}#${hit.chunk.sectionId ?? hit.chunk.index}`
  const title = hit.chunk.title === undefined ? '' : ` ${hit.chunk.title}`
  const similarity = hit.similarity === undefined ? '' : `，向量 ${hit.similarity.toFixed(3)}`
  return `[${label}]${title}（得分 ${hit.score.toFixed(3)}，${hit.matchedBy}，关键词覆盖 ${hit.coverage.toFixed(3)}${similarity}）\n${hit.chunk.text}\n\n`
}

/**
 * 把命中拼成有界注入文本。
 * @param hits - 已按分数降序的命中。
 * @param maxBytes - 总字节预算（含包装标签）。
 * @returns 注入文本与降级统计。
 */
export function boundHits(hits: readonly Hit[], maxBytes: number = DEFAULT_MAX_INJECT_BYTES): BoundedContext {
  const fixedBytes = encoder.encode(HEADER).length + encoder.encode(FOOTER).length
  if (hits.length === 0) {
    return { text: '', injectedBytes: 0, dropped: 0, truncated: false }
  }
  // 预算连包装都放不下：什么都不注入（注入一个空引用块只会污染上下文），但如实报告全部命中被丢。
  if (fixedBytes >= maxBytes) {
    return { text: '', injectedBytes: 0, dropped: hits.length, truncated: false }
  }

  const budget = maxBytes - fixedBytes
  const parts: string[] = []
  let used = 0
  let dropped = 0
  let truncated = false

  for (const [position, hit] of hits.entries()) {
    const rendered = renderHit(hit)
    const size = encoder.encode(rendered).length
    if (used + size <= budget) {
      parts.push(rendered)
      used += size
      continue
    }
    const room = budget - used
    if (parts.length === 0 && room >= MIN_USEFUL_BYTES) {
      const clipped = truncateUtf8(rendered, room)
      parts.push(clipped)
      used += encoder.encode(clipped).length
      truncated = true
      dropped += hits.length - position - 1
    } else {
      dropped += hits.length - position
    }
    break
  }

  // 一条都没能留下可用的正文：同样什么都不注入。
  if (parts.length === 0) {
    return { text: '', injectedBytes: 0, dropped: hits.length, truncated: false }
  }

  const text = `${HEADER}${parts.join('')}${FOOTER}`
  return { text, injectedBytes: encoder.encode(text).length, dropped, truncated }
}