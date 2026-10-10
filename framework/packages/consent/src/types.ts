/**
 * 敏感操作闸门的对外类型。本文件**只有类型**，不含运行时代码。
 *
 * 这一层是**通用框架层**：它只知道「有个操作需要先给用户看、再确认、再验身份」，
 * 不知道任何银行业务规则（金额上限、哪些字段算敏感）——那些属于消费者插件。
 *
 * @module @luckycat/dsh-consent/types
 */

/** 身份验证的方式。框架不实现任何一种，只声明「需要哪一种」。 */
export type VerificationMethod = 'payment-password' | 'sms' | 'face'

/**
 * 一条「展示给用户看的信息」。渲染成纯文本表格交给用户，
 * 所以字段名用中文业务词，不用代码字段名。
 */
export interface ConsentField {
  /** 展示名，例如「收款人」。 */
  label: string
  /** 展示值，例如「梁乐怡」。 */
  value: string
  /** 是否需要在界面上强调（例如金额）。 */
  emphasis?: boolean
}

/** 一个敏感操作的声明。消费者插件（例如银行示例）为每个工具声明一条。 */
export interface SensitiveOperationSpec {
  /** 要拦截的工具名，必须与 `tools.register` 的名字一致。 */
  toolName: string
  /** 操作类别，仅用于展示与审计，例如「转账」。 */
  kind: string
  /**
   * 把工具参数变成「给用户看的信息」。
   *
   * 必须是**纯函数**：只读参数，不做 I/O。参数已经过工具自己的 schema 校验。
   * 抛异常会被闸门捕获并转成拒绝（fail-closed），所以不要在这里做会失败的事。
   * @param args - 模型传来的已解析参数。
   * @returns 按展示顺序排列的字段。
   */
  describe(args: unknown): ConsentField[]
  /** 将参数绑定到后端的一次性授权；仅用于可信确认通道，不展示给浏览器。 */
  bindArguments?: boolean
  /**
   * 需要哪种身份验证；省略表示**只确认、不验身份**。
   * 这是业务决定，由消费者插件给值，框架不设默认值（对齐 DSH 的
   * "configurability does not justify an unsupported default"）。
   */
  verification?: VerificationMethod
  /** 界面上那句「确认后会发生什么」的补充说明，例如「确认后立即扣款，不可撤销」。 */
  consequence?: string
}

/** 待用户确认的一次挑战。由闸门生成，交给通道送给用户。 */
export interface ConsentChallenge {
  /** 本次挑战的 id（同时是防重放的 nonce）。 */
  challengeId: string
  /** 会话 id，便于后端把挑战路由回正确的用户连接。 */
  sessionId: string
  /** 工具调用 id，用于和工具调用轨迹对上。 */
  callId: string
  /** 工具名。 */
  toolName: string
  /** 操作类别。 */
  kind: string
  /** 展示给用户的信息。 */
  fields: ConsentField[]
  arguments?: unknown
  /** 需要哪种身份验证；省略表示不需要。 */
  verification?: VerificationMethod
  /** 补充说明。 */
  consequence?: string
  /** 挑战的创建时刻（Unix 毫秒）。 */
  createdAt: number
  /** 超时时刻（Unix 毫秒）；超过即视为拒绝。 */
  expiresAt: number
}

/** 用户对一次挑战的答复。 */
export interface ConsentAnswer {
  /** 用户是否同意。 */
  decision: 'approve' | 'reject'
  /** 必须与对应挑战的 challengeId 一致，否则视为重放。 */
  challengeId: string
  /**
   * 身份验证结果。需要验证时**必须**给出 `verified: true` 且 `method` 与声明一致，
   * 否则闸门按拒绝处理。票据由通道那一侧（后端 / 演示服务）签发，
   * agent 进程只信任「这张票说的是什么」，不校验密码本身。
   */
  verification?: {
    method: VerificationMethod
    verified: boolean
    /** 票据标识，仅用于审计（**不得**是密码或验证码本身）。 */
    ticket?: string
  }
}

/** 把挑战送给用户、并等答复的通道。后端 / 演示服务实现它。 */
export interface ConsentChannel {
  /**
   * 送出一个挑战并等待答复。
   * @param challenge - 待确认的挑战。
   * @param signal - 会话取消信号；中止即放弃等待。
   * @returns 用户的答复；通道自身故障时抛异常（闸门会转成拒绝）。
   */
  ask(challenge: ConsentChallenge, signal?: AbortSignal): Promise<ConsentAnswer>
}

/** 闸门插件配置。 */
export interface ConsentConfig {
  /** 通道种类。当前只实现 HTTP 长轮询。 */
  channel: 'http-poll'
  /** 通道地址，例如 http://127.0.0.1:8788/consent/challenge 。 */
  channelUrl: string
  /** 单次等待答复的超时（毫秒）。默认 180000（3 分钟）。 */
  timeoutMs?: number
  /** 挑战的展示有效期（毫秒），到期即拒绝。默认与 timeoutMs 相同。 */
  ttlMs?: number
}
