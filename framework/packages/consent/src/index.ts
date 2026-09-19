/**
 * 敏感操作闸门（通用框架层）：**在做出决定的那一步执行**。
 *
 * 为什么挂在 `tools/pre-execute` 而不是别处：
 *   DSH 的工具执行流水线是 `tools/pre-execute` → 审批 `ask` → 单调守卫 → 执行。
 *   在 `pre-execute` 里返回 `{ kind: 'ask' }`，上游就会去问 `ctx.approval`；
 *   而 `ctx.approval` **没有答复者时一律拒绝**（fail-closed，上游行为）。
 *   所以"没人确认就不执行"这件事是**内核保证**的，不是我们的提示词或工具 schema 保证的
 *   ——按 DSH 自己的话：schema 省略、提示词过滤、包装器都不是 enforcement。
 *
 * 本插件提供三件东西：
 *   1. 服务 `ctx.consent`：消费者插件用它声明"哪个工具算敏感操作"；
 *   2. `tools/pre-execute` 监听：查到声明就生成挑战、登记、返回 `ask`；
 *   3. `approval/request` 答复者：把挑战通过通道送给用户，按判定结果返回批准或拒绝。
 *
 * 这一层**不含任何银行业务规则**：金额阈值、哪些字段要展示、要不要验密码，
 * 全部由消费者插件在 `declare()` 时给出。
 *
 * @module @luckycat/dsh-consent
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-user-approval'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import { createChallenge, DEFAULT_TTL_MS, judge, methodLabel, renderChallenge } from './challenge.ts'
import { createHttpPollChannel } from './channel.ts'
import { ConsentError } from './errors.ts'
import type { ConsentChallenge, ConsentChannel, ConsentConfig, SensitiveOperationSpec } from './types.ts'

export type * from './types.ts'
export { ConsentError } from './errors.ts'
export type { ConsentErrorCode } from './errors.ts'
export {
  createChallenge, judge, methodLabel, renderChallenge,
  DEFAULT_TTL_MS, MAX_FIELD_VALUE_CHARS,
} from './challenge.ts'
export type { ConsentVerdict } from './challenge.ts'
export { assertAllowedEndpoint, createHttpPollChannel, parseAnswer, MAX_RESPONSE_BYTES } from './channel.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    consent: ConsentService
  }
}

/** Cordis 插件名。 */
export const name = 'luckycat-consent'

/** 要挂工具流水线监听，必须先有工具注册表；答复者要挂在审批服务上。 */
export const inject = ['tools', 'approval']

export const Config: z<ConsentConfig> = z.object({
  channel: z.union(['http-poll'] as const).default('http-poll'),
  channelUrl: z.string().required(),
  timeoutMs: z.number().default(DEFAULT_TTL_MS),
  ttlMs: z.number(),
})

/** 一次判定的结果；`allowed` 为 true 是**唯一**会放行的情形。 */
export interface ConsentDecision {
  /** 是否放行。 */
  allowed: boolean
  /** 拒绝理由（面向模型）。 */
  reason?: string
  /** 验证票据（仅审计用，**不含**密码）。 */
  ticket?: string
}

/**
 * 敏感操作登记处。
 *
 * 为什么是服务而不是"给工具加个元数据字段"：DSH 的 `defineTool` 没有可扩展的元数据位，
 * 而"哪些操作敏感"是**部署/业务决定**，会随业务变化——正好是配置该管的事。
 * 登记是 effect：消费者插件卸载，登记自动回收，不会留下悬空的拦截规则。
 */
export class ConsentService extends Service {
  static Config = Config

  private readonly registrations = new Map<string, SensitiveOperationSpec>()
  private readonly channel: ConsentChannel
  private readonly ttlMs: number

  /**
   * @param ctx - 所属上下文。
   * @param config - 通道配置（由 schemastery 填好默认值）。
   */
  constructor(ctx: Context, public config: ConsentConfig) {
    super(ctx, 'consent')
    this.ttlMs = config.ttlMs ?? config.timeoutMs ?? DEFAULT_TTL_MS
    // 通道地址在加载期就校验：写错地址要立刻报错，而不是等客户点了转账才炸。
    this.channel = createHttpPollChannel({
      url: config.channelUrl,
      timeoutMs: config.timeoutMs ?? DEFAULT_TTL_MS,
    })
  }

  /**
   * 声明一个敏感操作。同一个工具名重复声明会抛错（不静默覆盖）。
   * @param spec - 该工具的展示方式与验证要求。
   * @returns 注销函数；登记本身是 effect，插件卸载时同样自动回收。
   */
  declare(spec: SensitiveOperationSpec): () => void {
    if (spec.toolName.trim() === '') throw new Error('luckycat-consent: toolName 不能为空')
    if (spec.kind.trim() === '') throw new Error(`luckycat-consent: ${spec.toolName} 的 kind 不能为空`)
    const registrations = this.registrations
    return this.ctx.effect(() => {
      if (registrations.has(spec.toolName)) {
        throw new Error(`luckycat-consent: 工具 "${spec.toolName}" 已经被声明过敏感操作，不能重复声明`)
      }
      registrations.set(spec.toolName, spec)
      return () => { registrations.delete(spec.toolName) }
    }, `consent.declare(${spec.toolName})`)
  }

  /** 已声明的工具名（诊断用）。 */
  declaredTools(): readonly string[] {
    return [...this.registrations.keys()].sort()
  }

  /** 取某个工具的声明；没声明过返回 undefined。 */
  specOf(toolName: string): SensitiveOperationSpec | undefined {
    return this.registrations.get(toolName)
  }

  /** 挑战有效期（毫秒）。 */
  challengeTtlMs(): number {
    return this.ttlMs
  }

  /**
   * 把一次挑战交给通道并判定结果。
   *
   * 通道抛异常（连不上、超时、返回看不懂）时**不放行**：返回拒绝判定，
   * 理由里说明是通道问题，让模型能如实告诉用户"确认通道不可用"而不是"用户拒绝了"。
   * @param challenge - 待确认的挑战。
   * @param signal - 会话取消信号。
   * @returns 判定结果。
   */
  async decide(challenge: ConsentChallenge, signal?: AbortSignal): Promise<ConsentDecision> {
    try {
      const answer = await this.channel.ask(challenge, signal)
      const verdict = judge(challenge, answer, Date.now())
      if (!verdict.allowed) return { allowed: false, reason: verdict.reason }
      return {
        allowed: true,
        ...answer.verification?.ticket === undefined ? {} : { ticket: answer.verification.ticket },
      }
    } catch (error) {
      const code = error instanceof ConsentError ? error.code : 'CHANNEL_UNREACHABLE'
      const detail = error instanceof Error ? error.message : String(error)
      return { allowed: false, reason: `确认通道不可用（${code}）：${detail}` }
    }
  }
}

// 刻意**不**导出 default：本包是"函数插件"形态（name / inject / Config / apply）。
// DSH 的 Loader 一旦看到 default export，就会把函数插件的命名空间整体丢掉
// ——`apply` 不再被调用，于是闸门的监听器一个都没挂上，工具会**照常执行**。
// 这是实测踩到的：服务能读到、规则表有 8 条，但 pre-execute 从不触发。
// 参见 packages/AGENTS.md 的 "Plugin exports" 与 docs/postmortem/0001。

/** 从工具调用里取出会话 id；拿不到就用调用 id 顶替（挑战仍然能路由回连接）。 */
function sessionIdOf(exec: Readonly<ToolExecution>): string {
  const agent = exec.agent as Agent | undefined
  return agent === undefined ? String(exec.callId) : String(agent.session.id)
}

/**
 * 挂上闸门。
 * @param ctx - 上下文。
 * @param config - 插件配置。
 */
export function apply(ctx: Context, config: ConsentConfig): void {
  const service = new ConsentService(ctx, config)

  // 待确认的挑战按「会话 + 调用」索引。用调用 id 而不是工具名做键：
  // 同一个工具可以在同一轮里被并行调用多次，用工具名会串号。
  const pending = new Map<string, ConsentChallenge>()
  const keyOf = (sessionId: string, callId: string): string => `${sessionId}\u0000${callId}`

  /**
   * 清掉已经过期的待确认项。
   *
   * 正常情况下每一条都会被答复者取走；只有一种情况会留下：`pre-execute` 登记了挑战，
   * 但审批环节压根没走到答复者（例如审批策略被设成 never）。那种情况下没人来取，
   * 不清理就会一直占着内存。登记新挑战时顺手扫一遍，成本可忽略。
   */
  const pruneExpired = (now: number): void => {
    for (const [key, challenge] of pending) {
      if (now > challenge.expiresAt) pending.delete(key)
    }
  }

  ctx.on('tools/pre-execute', (exec, next): Promise<PreToolDecision> => {
    const spec = service.specOf(exec.name)
    if (spec === undefined) return next()
    const now = Date.now()
    pruneExpired(now)
    let challenge: ConsentChallenge
    try {
      challenge = createChallenge(
        spec,
        exec.arguments,
        { sessionId: sessionIdOf(exec), callId: String(exec.callId) },
        now,
        service.challengeTtlMs(),
      )
    } catch (error) {
      // 展示信息生成失败 → 绝不放行。连"要给用户看什么"都算不出来的操作，
      // 更不可能得到一次有意义的确认。
      const detail = error instanceof Error ? error.message : String(error)
      return Promise.resolve({
        kind: 'deny',
        reason: `敏感操作 "${exec.name}" 的展示信息生成失败，已按安全策略拒绝：${detail}`,
      })
    }
    pending.set(keyOf(challenge.sessionId, challenge.callId), challenge)
    // 理由里带上**和用户看到的一模一样**的信息：模型据此向用户复述，
    // 不能让模型自己编一份"转账给某人 800 元"。
    const need = challenge.verification === undefined ? '' : `（需要${methodLabel(challenge.verification)}验证）`
    return Promise.resolve({
      kind: 'ask',
      reason: `${renderChallenge(challenge)}${need}`,
    })
  })

  // 答复者：把挑战送给用户，按判定结果决定是否批准。
  // 只处理本插件登记过的调用；别人的审批请求一律 next() 让出去
  // ——waterfall 监听器必须调 next() 才能委派，否则会截断整条链。
  ctx.on('approval/request', async function (request, next): Promise<ApprovalOutcome> {
    const agent = request.agent as Agent | undefined
    if (agent === undefined || request.callId === undefined) return next()
    const key = keyOf(String(agent.session.id), String(request.callId))
    const challenge = pending.get(key)
    if (challenge === undefined) return next()
    // 先摘掉：一次挑战只可能被答复一次，重复到达的询问按"没有待确认项"让出去。
    pending.delete(key)
    const outcome = await service.decide(challenge, request.signal)
    if (outcome.allowed) return 'allowed-once'
    // 拒绝理由通过 `approval/decided` 只进日志；模型看到的是上游固定的
    // `the user rejected tool "..."`。所以把真实原因写进日志，便于排查
    // "是用户点了取消，还是验证没过，还是通道连不上"。
    logRejection(ctx, challenge, outcome.reason)
    return 'rejected'
  })
}

/** 把拒绝原因写到日志（可选服务，缺失时静默）。 */
function logRejection(ctx: Context, challenge: ConsentChallenge, reason: string | undefined): void {
  const logger = (ctx as unknown as { logger?: { warn?: (text: string) => void } }).logger
  logger?.warn?.(`luckycat-consent: 拒绝敏感操作 ${challenge.toolName}（${challenge.kind}）：${reason ?? '未说明'}`)
}
