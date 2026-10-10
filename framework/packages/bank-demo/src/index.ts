/**
 * 银行示例消费者插件：注册**占位**业务工具，并把"哪些操作敏感、要不要验密码"
 * 的规则声明给通用闸门 `@luckycat/dsh-consent`。
 *
 * 边界（很重要，写在文件头）：本包是**示例消费者**，不是通用框架层。
 * 招财猫银行的业务规则住在这里；真实银行后端应自建同等插件。
 *
 * @module @luckycat/dsh-bank-demo
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@luckycat/dsh-consent'
import { loadDemoData } from './data.ts'
import { SENSITIVE_OPERATIONS } from './specs.ts'
import { BANK_TOOL_NAMES, registerBankTools } from './tools.ts'
import { registerHttpBankTools, HTTP_OPERATIONS } from './http-tools.ts'
import type { BankDemoConfig } from './types.ts'

export type * from './types.ts'
export { loadDemoData, BankDemoDataError } from './data.ts'
export type { DemoData } from './data.ts'
export { SENSITIVE_OPERATIONS, specToolNames } from './specs.ts'
export { BANK_TOOL_NAMES, registerBankTools } from './tools.ts'
export {
  DEMO_NOTICE, DEMO_REFERENCE_PREFIX, demoReference, formatCents, formatTime, maskTail,
} from './format.ts'

/** Cordis 插件名。 */
export const name = 'luckycat-bank-demo'

/** 要注册工具，也要把规则声明给闸门服务。 */
export const inject = ['tools', 'consent']

export const Config: z<BankDemoConfig> = z.object({
  dataPath: z.string().required(),
  transferLimitCents: z.number().default(5_000_000),
  verifyThresholdCents: z.number().default(0),
})

/**
 * 注册演示工具与敏感操作规则。
 * @param ctx - 上下文。
 * @param config - 数据路径与限额。
 */
export function apply(ctx: Context, config: BankDemoConfig): void {
  if (process.env.LUCKYCAT_BANK_MODE !== 'demo') {
    registerHttpBankTools(ctx)
    for (const spec of HTTP_OPERATIONS) ctx.consent.declare(spec)
    return
  }
  // 加载期同步读盘：数据文件坏了立刻报错（fail loud）。
  const data = loadDemoData(config.dataPath)

  let referenceSeq = 0
  registerBankTools(ctx, {
    data,
    nextReference: () => ++referenceSeq,
    transferLimitCents: config.transferLimitCents ?? 5_000_000,
  })

  // 加载期自检：规则表与工具表必须一一对应。漏一条 = 某个工具**没有**确认闸门，
  // 这种错必须在启动时炸出来，而不是等客户点转账才发现钱能直接出去。
  const declared = new Set(SENSITIVE_OPERATIONS.map(spec => spec.toolName))
  const registered = new Set(BANK_TOOL_NAMES)
  const missing = [...registered].filter(tool => !declared.has(tool))
  const extra = [...declared].filter(tool => !registered.has(tool))
  if (missing.length > 0) {
    throw new Error(`luckycat-bank-demo: 这些工具没有声明敏感操作规则（会绕过确认闸门）：${missing.join('、')}`)
  }
  if (extra.length > 0) {
    throw new Error(`luckycat-bank-demo: 规则表里声明了未注册的工具：${extra.join('、')}`)
  }

  for (const spec of SENSITIVE_OPERATIONS) {
    ctx.consent.declare(spec)
  }
}
