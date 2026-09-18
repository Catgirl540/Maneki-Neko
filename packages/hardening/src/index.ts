/**
 * luckycat 加固包：三件"只收紧"的事。
 *
 * 1. **工具结果脱敏**——在结果成为 durable 事件**之前**替换投影，所以密钥
 *    既不进会话日志，也不发给模型。这是"在做出决定的那一步执行"：
 *    挂在 `tools/post-execute` 这个 waterfall 上，而不是事后清洗日志
 *    （DSH 的规范化日志按设计**永不重写**，事后清洗根本不可能）。
 * 2. **白名单守卫**——`ctx.tools.guard()`，名单外的工具一律拒绝；
 *    DSH 保证后续监听者不能把已拒绝改成允许（只能收紧）。
 * 3. **遥测导出脱敏**——仅当部署挂了 telemetry 时才有效；DSH 的脱敏 waterfall
 *    **出厂零规则**，所以这条要自己挂。
 *
 * @module @luckycat/dsh-hardening
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ContentBlock, UserMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session-telemetry'
import type { PostToolDecision, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { makeToolAllowListGuard } from './guard.ts'
import { buildRules, redactDeep, redactText } from './redact.ts'
import type { HardeningConfig, RedactionRule } from './types.ts'

export type * from './types.ts'
export { buildRules, redactDeep, redactText, BUILT_IN_PATTERNS } from './redact.ts'
export { makeToolAllowListGuard, normalizeAllowList, denialReason } from './guard.ts'

/** Cordis 插件名。 */
export const name = 'luckycat-hardening'

/** 要挂守卫与结果 waterfall，必须先有工具注册表。 */
export const inject = ['tools']

export const Config: z<HardeningConfig> = z.object({
  allowedTools: z.array(z.string()).required(),
  secretEnv: z.array(z.string()),
  extraPatterns: z.array(z.string()),
  redactTelemetry: z.boolean(),
})

/** 对内容块做脱敏；没有任何改动时返回 undefined（避免无谓的投影替换）。 */
function redactBlocks(blocks: readonly ContentBlock[], rules: readonly RedactionRule[]): ContentBlock[] | undefined {
  let changed = false
  const next = blocks.map(block => {
    if (block.type !== 'text' || typeof block.text !== 'string') return block
    const result = redactText(block.text, rules)
    if (result.text === block.text) return block
    changed = true
    return { ...block, text: result.text }
  })
  return changed ? next : undefined
}

/**
 * 注册加固的三件事。
 * @param ctx - 上下文。
 * @param config - 插件配置。
 */
export function apply(ctx: Context, config: HardeningConfig): void {
  // 白名单为空会在加载期抛错（fail loud）。
  const allowed = makeToolAllowListGuard(config.allowedTools)

  // 日志是**可选**服务：sdk-minimal 那棵树不挂 logger，直接 `ctx.logger.warn`
  // 会抛异常，而监听器里抛异常会让 waterfall **退回原结果**——脱敏就白做了。
  // （这是实测踩到的：密钥照样进了日志与模型，且没有任何报错。）
  const warn = (message: string): void => {
    const logger = (ctx as unknown as { logger?: { warn?: (text: string) => void } }).logger
    logger?.warn?.(`luckycat-hardening: ${message}`)
  }

  // 规则按环境变量取值构造，所以密钥轮换后不需要重启：
  // 用"当前取值"做缓存键，取值变了就重建。
  const secretEnv = config.secretEnv ?? []
  const extraPatterns = config.extraPatterns ?? []
  let cachedKey = ''
  let cachedRules: RedactionRule[] = []
  function currentRules(): RedactionRule[] {
    const key = secretEnv.map(name => `${name}=${process.env[name] ?? ''}`).join('\u0000')
    if (key !== cachedKey) {
      cachedRules = buildRules({ extraPatterns, secretEnv })
      cachedKey = key
    }
    return cachedRules
  }

  // 规则先构造一次：**非法正则要在加载期就报错**，而不是等到第一次调用才炸。
  currentRules()

  /**
   * 对一条 post-execute 判定做脱敏。结果可能是三种形态之一，**都要处理**：
   * `value`（尚未渲染的 canonical JSON）、`content`（已渲染）、或两者都没有
   * （退回 `result.content`，对齐 DSH 自己的 spill-policy 写法）。
   */
  function redactDecision(
    name: string,
    decision: PostToolDecision,
    result: Readonly<ToolExecutionResult>,
    rules: readonly RedactionRule[],
  ): PostToolDecision {
    const keepContexts = (): { additionalContexts?: UserMessage[] } =>
      'additionalContexts' in decision && decision.additionalContexts !== undefined
        ? { additionalContexts: decision.additionalContexts }
        : {}

    if (decision.kind === 'block') {
      const feedback = redactBlocks(decision.feedback, rules)
      if (feedback === undefined) return decision
      warn(`工具 ${name} 的失败反馈里含密钥，已脱敏`)
      return { ...decision, feedback }
    }
    if (Object.hasOwn(decision, 'value')) {
      const redacted = redactDeep((decision as { value: unknown }).value, rules)
      if (redacted.hits.length === 0) return decision
      warn(`工具 ${name} 的结果里含密钥，已脱敏（原始值不会进日志或模型）`)
      return { kind: 'accept', value: redacted.value as never, ...keepContexts() }
    }
    const content = decision.content ?? result.content
    const redacted = redactBlocks(content, rules)
    if (redacted === undefined) return decision
    warn(`工具 ${name} 的结果里含密钥，已脱敏（原始值不会进日志或模型）`)
    return { kind: 'accept', content: redacted, ...keepContexts() }
  }

  // 1) 工具结果脱敏：替换投影，让密钥既不入库也不进模型。
  // 按 DSH 自己的写法：先 next() 让下游结算，再变换它接受的结果；
  // `{ prepend: true }` 让我们处在这条 waterfall 的外层（先于其它变换器）。
  ctx.on('tools/post-execute', async (exec, result, next): Promise<PostToolDecision> => {
    const decision = await next()
    try {
      return redactDecision(exec.name, decision, result, currentRules())
    } catch (error) {
      // **fail-closed**：脱敏失败就绝不放行原结果。宁可阻断这次结果，
      // 也不能把可能带密钥的原文放出去（监听器里抛异常会让 waterfall 静默
      // 退回原结果，等于安全控制失效——这是实测踩到的坑）。
      warn(`脱敏过程出错，已阻断该结果以避免泄漏：${error instanceof Error ? error.message : String(error)}`)
      return {
        kind: 'block',
        feedback: [{ type: 'text', text: '该工具结果因脱敏失败被安全策略阻断。请勿重试同一调用，并向用户说明需要管理员检查加固配置。' }],
      }
    }
  }, { prepend: true })

  // 2) 单调守卫：白名单之外一律拒绝。
  ctx.tools.guard(execution => allowed(execution.name))

  // 3) 遥测导出脱敏：仅在部署挂了 telemetry 时生效（DSH 出厂零规则）。
  const telemetry = (ctx as unknown as { get(name: string): unknown }).get('sessionTelemetry')
  if (telemetry !== undefined && config.redactTelemetry !== false) {
    ctx.on('session-telemetry/record', (record, next) => redactDeep(next(), currentRules()).value)
  }
}