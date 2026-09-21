/**
 * 「问用户」的答复者插件。
 *
 * ## 它在这条链上的位置
 *
 * 模型看到工具 `ask_user_question`（来自官方的 `@deepseek-ai/dsh-tool-ask-user`），
 * 调用它 → 工具转给服务 `ctx.userQuestions.ask()`（来自官方的
 * `@deepseek-ai/dsh-user-questions`）→ 服务在 **`user-questions/request`
 * waterfall** 上找人答复 → **本插件就是那个答复者**。
 *
 * 官方只在 DSH 自带的 Web GUI 里实现了答复者（`@deepseek-ai/dsh-client-ui-user-questions`）。
 * 我们用的是自己的银行网页，所以这一段必须自己写——这就是本包存在的理由。
 *
 * ## 为什么和"确认闸门"是两个插件
 *
 * 两者形状像（都是"挂住等用户"），但**语义完全不同**：
 *
 *   · 确认闸门（`luckycat-consent`）管的是**敏感操作能不能执行**，
 *     它挂在 `tools/pre-execute` + `approval/request` 上，
 *     是 `ctx.approval` 没有答复者就**默认拒绝**的那条 fail-closed 路。
 *   · 本插件管的是**信息收集**，答不答都不涉及放行。
 *     它没有验证票据，也不该有——用户点个选项不需要验身份。
 *
 * 合成一个插件会让"哪些操作必须确认"和"模型能不能提问"这两件事互相牵连，
 * 所以分开。代价是 HTTP 通道那段代码与确认通道同形（各自约 60 行）——
 * 两边的载荷与安全语义不同，硬合并反而更难看清哪边在保证什么。
 *
 * ## 硬拦：不许用提问框收凭据
 *
 * 见 `guard.ts`。一句话：人设是软的，这一轮已经实测过一次；
 * 而"问用户要支付密码"的后果是丢钱，所以放在代码里拦。
 *
 * @module @luckycat/dsh-ask
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
// 这两个是**纯类型导入**（`import type {}`）：它们不改运行时行为，只是把
// `Agent.session` 这些增强声明带进编译期。少一个就会报
// "Property 'session' does not exist on type 'Agent'"。
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-user-questions'
import { assertQuestionsAllowed, compileExtraRules } from './guard.ts'
import { createHttpPollChannel, parseQuestions, MAX_QUESTIONS } from './channel.ts'
import { AskError } from './errors.ts'
import type { AskConfig, QuestionAnswer, QuestionItem } from './types.ts'

export type * from './types.ts'
export { AskError } from './errors.ts'
export type { AskErrorCode } from './errors.ts'
export {
  assertAllowedEndpoint, createHttpPollChannel, parseAnswer, parseQuestions,
  MAX_RESPONSE_BYTES, MAX_OPTIONS_PER_QUESTION, MAX_QUESTIONS, MAX_CUSTOM_CHARS,
} from './channel.ts'
export { assertQuestionsAllowed, compileExtraRules, looksLikeCredentialRequest } from './guard.ts'

/** Cordis 插件名。 */
export const name = 'luckycat-ask'

/**
 * 只要 `userQuestions`。
 *
 * 不 inject `tools`：本插件**不注册工具**（工具是官方的 `tool-ask-user`），
 * 它只做答复者。多 inject 一个用不到的服务，只会让"没挂上"更难排查。
 */
export const inject = ['userQuestions']

/** 默认等待时长：和确认通道一个量级。用户在别的页面忙一会儿也该来得及。 */
export const DEFAULT_TIMEOUT_MS = 180_000

export const Config: z<AskConfig> = z.object({
  channelUrl: z.string().required(),
  timeoutMs: z.number().default(DEFAULT_TIMEOUT_MS),
  extraForbiddenPatterns: z.array(z.string()).default([]),
})

/**
 * 挂上答复者。
 *
 * waterfall 监听器的纪律：**别人的请求一定要 `next()` 让出去**。
 * 不调 `next()` 会截断整条链——上游 `noAnswerer` 兜底会抛 `NO_PROVIDER`，
 * 但如果链上还有别的答复者，我们就把它饿死了。
 * @param ctx - 上下文。
 * @param config - 插件配置。
 */
export function apply(ctx: Context, config: AskConfig): void {
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  // 地址与正则都在**加载期**校验：写错了要立刻炸，
  // 而不是等模型第一次提问才失败（那时候现场是用户，不是运维）。
  const channel = createHttpPollChannel({ url: config.channelUrl, timeoutMs })
  const extraRules = compileExtraRules(config.extraForbiddenPatterns ?? [])

  ctx.on('user-questions/request', async function (request, next): Promise<QuestionAnswer> {
    /*
     * 把上游给的题目过一遍自己的校验与守卫，再问出去。
     *
     * 为什么不信上游：`tool-ask-user` 的参数 schema 是 `additionalProperties: true`
     * 且没有长度上限，模型能塞进来任意形状。上游服务只校验了"至少一道题"和
     * plan-review 那个 intent，其余一律透传。所以形状与安全都归这里管。
     */
    let questions: QuestionItem[]
    try {
      questions = parseQuestions(request.questions)
      assertQuestionsAllowed(questions, extraRules)
    } catch (error) {
      // 守卫拒绝是**终点**，不是"让给别人"：让出去的话，别的答复者
      // （如果哪天挂了一个）会照样把这道"问用户要密码"的题弹给用户。
      const detail = error instanceof Error ? error.message : String(error)
      const code = error instanceof AskError ? error.code : 'FORBIDDEN_PATTERN'
      throw new AskError(
        code as AskError['code'],
        `这一问被框架拦下了（${code}），没有送到用户面前：${detail}`,
        { cause: error },
      )
    }

    /*
     * 会话 id 决定卡片推给哪个网页。
     *
     * `request.agent` 是工具调用时带上的（`tool-ask-user` 把 `exec.agent` 透传进来）。
     * 理论上它可能缺（比如哪天有人直接调 `ctx.userQuestions.ask()`），
     * 那时**不发**一个空 id 让服务端去猜——直接失败，理由写清楚。
     */
    const sessionId = request.agent === undefined ? '' : String(request.agent.session.id)
    if (sessionId === '') {
      throw new AskError(
        'MISCONFIGURED',
        '这次提问拿不到会话 id，无法把卡片送到用户面前（要求调用方带上 agent）',
      )
    }

    const answer = await channel.ask(questions, sessionId, request.signal)
    log(ctx, `问用户 ${questions.length} 道题，已答复`)
    return answer
  })

  log(ctx, `提问通道就绪（超时 ${timeoutMs} ms，一次最多 ${MAX_QUESTIONS} 道题）`)
}

/** 写日志（日志是可选服务，sdk-minimal 那棵树不挂 logger）。 */
function log(ctx: Context, message: string): void {
  const logger = (ctx as unknown as { logger?: { info?: (text: string) => void } }).logger
  logger?.info?.(`luckycat-ask: ${message}`)
}
