/**
 * 提问层的错误分类。
 *
 * 分这么细是因为**同一个失败对不同人意义不同**：
 *   · 对模型：`CREDENTIAL_REQUEST_BLOCKED` 是"换个问法或者别问了"，
 *     `CHANNEL_TIMEOUT` 是"用户没理你"，两者该说的话完全不同；
 *   · 对运维：`CHANNEL_UNREACHABLE` 是部署问题（桥接没起），
 *     `CHANNEL_MALFORMED_RESPONSE` 是两边协议对不上。
 *
 * @module @luckycat/dsh-ask/errors
 */

/** 错误的稳定分类。 */
export type AskErrorCode =
  /** 配置写错了（地址不合法、正则不合法）。 */
  | 'MISCONFIGURED'
  /** 通道地址不是 https（本机回环除外）。 */
  | 'ENDPOINT_NOT_ALLOWED'
  /** 连不上通道。 */
  | 'CHANNEL_UNREACHABLE'
  /** 通道返回了非 2xx。 */
  | 'CHANNEL_HTTP_STATUS'
  /** 通道返回的东西看不懂。 */
  | 'CHANNEL_MALFORMED_RESPONSE'
  /** 等用户答复超时。 */
  | 'CHANNEL_TIMEOUT'
  /** 这一问在索要凭据，被守卫拦下。 */
  | 'CREDENTIAL_REQUEST_BLOCKED'
  /** 这一问命中了部署方配置的禁止模式。 */
  | 'FORBIDDEN_PATTERN'

/** 提问层的错误。 */
export class AskError extends Error {
  readonly code: AskErrorCode

  /**
   * @param code - 稳定分类。
   * @param message - 面向模型/运维的说明。
   * @param options - 原始错误（`cause`）。
   */
  constructor(code: AskErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'AskError'
    this.code = code
  }
}
