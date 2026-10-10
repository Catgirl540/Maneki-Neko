/**
 * 挑战的生成与判定。**全部是纯函数**，所以整套安全判定可以在离线单测里逐条验证，
 * 不需要网络、不需要模型、不需要起 agent。
 *
 * 判定口径：**只有明确批准才算批准**。少一个条件、多一个异常、超一点时间，
 * 结果都是拒绝——因为这个函数的返回值直接决定钱动不动。
 *
 * @module @luckycat/dsh-consent/challenge
 */

import { randomUUID } from 'node:crypto'
import type {
  ConsentAnswer, ConsentChallenge, ConsentField, SensitiveOperationSpec, VerificationMethod,
} from './types.ts'

/** 挑战默认有效期（毫秒）。 */
export const DEFAULT_TTL_MS = 180_000

/** 字段值最长保留多少字符（防止工具参数把界面撑爆）。 */
export const MAX_FIELD_VALUE_CHARS = 200

/**
 * 生成一次挑战。
 * @param spec - 该工具的敏感操作声明。
 * @param args - 模型传来的已解析参数。
 * @param context - 会话与调用的身份，用于把答复路由回正确的连接。
 * @param now - 当前时刻（Unix 毫秒）；由调用方注入，便于离线测试。
 * @param ttlMs - 有效期（毫秒）。
 * @returns 待用户确认的挑战。
 * @throws 当 `describe` 抛异常时（调用方须按拒绝处理，绝不能放行）。
 */
export function createChallenge(
  spec: SensitiveOperationSpec,
  args: unknown,
  context: { sessionId: string; callId: string },
  now: number,
  ttlMs: number = DEFAULT_TTL_MS,
): ConsentChallenge {
  const fields = clampFields(spec.describe(args))
  return {
    challengeId: randomUUID(),
    sessionId: context.sessionId,
    callId: context.callId,
    toolName: spec.toolName,
    kind: spec.kind,
    fields,
    ...spec.bindArguments ? { arguments: args } : {},
    ...spec.verification === undefined ? {} : { verification: spec.verification },
    ...spec.consequence === undefined ? {} : { consequence: spec.consequence },
    createdAt: now,
    expiresAt: now + ttlMs,
  }
}

/** 把展示字段收敛成安全的可序列化形状。 */
function clampFields(fields: readonly ConsentField[]): ConsentField[] {
  return fields.map(field => ({
    label: String(field.label),
    value: truncate(String(field.value), MAX_FIELD_VALUE_CHARS),
    ...field.emphasis === true ? { emphasis: true } : {},
  }))
}

/** 按码点截断，避免把多字节字符切成半个。 */
function truncate(text: string, limit: number): string {
  const points = [...text]
  return points.length <= limit ? text : `${points.slice(0, limit).join('')}…`
}

/** 判定结果。`allowed` 为 true 是**唯一**会放行工具执行的情形。 */
export interface ConsentVerdict {
  /** 是否放行。 */
  allowed: boolean
  /** 拒绝理由（模型可见）；放行时为 undefined。 */
  reason?: string
}

/** 放行的唯一取值。 */
const ALLOW: ConsentVerdict = { allowed: true }

/**
 * 判定一次答复。
 *
 * 逐条检查，任何一条不过就拒绝；检查顺序刻意从"最可能是攻击"到"最可能是用户操作"，
 * 这样日志里的理由能直接指出问题。
 * @param challenge - 之前生成的那次挑战。
 * @param answer - 通道送回来的答复；通道故障时传 undefined。
 * @param now - 当前时刻（Unix 毫秒）。
 * @returns 判定结果。
 */
export function judge(
  challenge: ConsentChallenge,
  answer: ConsentAnswer | undefined,
  now: number,
): ConsentVerdict {
  if (answer === undefined) {
    return { allowed: false, reason: '没有收到用户的确认答复（确认通道不可用或超时）' }
  }
  if (answer.challengeId !== challenge.challengeId) {
    return { allowed: false, reason: '确认答复与本次操作对不上（可能是重放的旧答复）' }
  }
  if (now > challenge.expiresAt) {
    return { allowed: false, reason: '确认已过期，请重新发起' }
  }
  if (answer.decision !== 'approve') {
    return { allowed: false, reason: '用户取消了这次操作' }
  }
  if (challenge.verification !== undefined) {
    const verification = answer.verification
    if (verification === undefined || verification.verified !== true) {
      return { allowed: false, reason: `该操作需要身份验证（${methodLabel(challenge.verification)}），但本次确认没有通过验证` }
    }
    if (verification.method !== challenge.verification) {
      return { allowed: false, reason: `身份验证方式不符：需要 ${methodLabel(challenge.verification)}，收到 ${methodLabel(verification.method)}` }
    }
  }
  return ALLOW
}

/** 把验证方式翻译成界面/模型都能读的中文。 */
export function methodLabel(method: VerificationMethod): string {
  switch (method) {
    case 'payment-password': return '支付密码'
    case 'sms': return '短信验证码'
    case 'face': return '人脸核身'
    /* v8 ignore next -- 闭联合穷尽保护 */
    default: return String(method)
  }
}

/**
 * 把挑战渲染成给用户看的纯文本（多行）。用于日志与模型可见的询问理由——
 * **模型看到的理由必须和用户看到的是同一份信息**，否则模型会向用户复述错内容。
 * @param challenge - 待确认的挑战。
 * @returns 多行文本。
 */
export function renderChallenge(challenge: ConsentChallenge): string {
  const lines = [`【待确认】${challenge.kind}`]
  for (const field of challenge.fields) {
    lines.push(`${field.label}：${field.value}`)
  }
  if (challenge.consequence !== undefined) lines.push(challenge.consequence)
  if (challenge.verification !== undefined) {
    lines.push(`需要验证：${methodLabel(challenge.verification)}`)
  }
  return lines.join('\n')
}
