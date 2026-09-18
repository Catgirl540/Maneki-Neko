/**
 * 向量服务的错误类型。所有失败都带稳定的 `code`，让调用方能分辨
 * "配置写错""凭据缺失""上游拒绝"，而不是只看到一句字符串。
 * @module @luckycat/dsh-embedding/errors
 */

import type { EmbeddingErrorCode } from './types.ts'

/** 向量服务抛出的唯一错误类型。 */
export class EmbeddingError extends Error {
  /**
   * @param code - 稳定的失败分类。
   * @param message - 面向诊断的说明；**不得包含密钥**。
   * @param options - 透传的 cause（例如底层 fetch 错误）。
   */
  constructor(
    readonly code: EmbeddingErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = 'EmbeddingError'
  }
}