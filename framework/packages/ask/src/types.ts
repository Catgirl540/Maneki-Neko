/**
 * 「问用户」这一层的类型。
 *
 * 这些形状**刻意与上游 `@deepseek-ai/dsh-user-questions` 对齐**（字段名一致），
 * 因为真正的工具是官方的 `ask_user_question`，我们只是它的**答复者**。
 * 多一层自己的类型是为了：通道上传输的东西要能被 `parseAnswer` 逐个字段校验，
 * 而不是把上游的类型当作"一定是好的"。
 *
 * @module @luckycat/dsh-ask/types
 */

/** 一个可选项。 */
export interface QuestionOption {
  /** 展示给用户的短标签。 */
  label: string
  /** 一句话说明代价或影响（可选）。 */
  description?: string
}

/** 一道题。 */
export interface QuestionItem {
  /** 调用方给的稳定 id，答复里原样回传。 */
  id: string
  /** 题目本身。 */
  question: string
  /** 短标题（可选）。 */
  header?: string
  /** 可选项（可选）。没有选项时就是一道纯自由输入题。 */
  options?: QuestionOption[]
  /** 是否允许多选；缺省是单选。 */
  multiSelect?: boolean
}

/** 一道题的答复。 */
export interface QuestionAnswerItem {
  /** 对应的问题 id。 */
  id: string
  /** 选中的选项标签；纯自由输入时是空数组。 */
  selected: string[]
  /** 用户自己写的答案（「其他」）。 */
  custom?: string
}

/** 一次问询的答复。 */
export interface QuestionAnswer {
  answers: QuestionAnswerItem[]
}

/** 通道接口：把问题送出去、等答复回来。 */
export interface QuestionChannel {
  /**
   * @param questions - 要问的题。
   * @param sessionId - 这次问询属于哪个会话；服务端靠它决定卡片推给哪个网页。
   * @param signal - 会话取消信号。
   * @returns 用户的答复。
   */
  ask(questions: QuestionItem[], sessionId: string, signal?: AbortSignal): Promise<QuestionAnswer>
}

/** 插件配置（`cordis.patch.yml` 里由部署方给）。 */
export interface AskConfig {
  /** 通道地址：桥接服务上的问询端点。 */
  channelUrl: string
  /** 等用户答多久（毫秒）。超时按"没答"处理。 */
  timeoutMs?: number
  /**
   * 额外的**禁止提问**正则（字符串形式，加载期编译）。
   *
   * 默认已经拦掉"索要凭据"那一类（见 `guard.ts`）；这个配置只用于**加**规则，
   * 不能用来放宽默认规则——放宽一个"问用户要密码"的口子不该有配置开关。
   */
  extraForbiddenPatterns?: string[]
}
