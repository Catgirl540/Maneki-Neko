/**
 * 敏感操作闸门的错误类型。所有失败都带稳定的 `code`，让调用方能分辨
 * "配置写错""通道连不上""上游返回了看不懂的东西"，而不是只看到一句字符串。
 * @module @luckycat/dsh-consent/errors
 */

/** 通道层失败的稳定分类。 */
export type ConsentErrorCode =
  /** 通道地址不是 https，也不是本机回环地址。 */
  | 'ENDPOINT_NOT_ALLOWED'
  /** 连不上通道（DNS、连接被拒、TLS 失败）。 */
  | 'CHANNEL_UNREACHABLE'
  /** 通道返回了非 2xx。 */
  | 'CHANNEL_HTTP_STATUS'
  /** 通道返回的不是可解析的答复（例如网关吐了一段 HTML）。 */
  | 'CHANNEL_MALFORMED_RESPONSE'
  /** 等待答复超时。 */
  | 'CHANNEL_TIMEOUT'
  /** 配置本身有问题（缺字段、值非法）。 */
  | 'MISCONFIGURED'

/** 闸门抛出的唯一错误类型。 */
export class ConsentError extends Error {
  /**
   * @param code - 稳定的失败分类。
   * @param message - 面向诊断的说明；**不得包含任何凭据**。
   * @param options - 透传的 cause（例如底层 fetch 错误）。
   */
  constructor(
    readonly code: ConsentErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = 'ConsentError'
  }
}
