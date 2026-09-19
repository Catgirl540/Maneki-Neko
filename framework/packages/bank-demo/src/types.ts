/**
 * 银行示例消费者的对外类型。本文件**只有类型**。
 *
 * 注意边界：本包是**示例消费者**，不是通用框架层。
 * 招财猫银行前端要用的业务工具与"哪些操作要确认、要不要验密码"的规则都在这里；
 * 真实银行后端应当自建同等插件，而不是把业务规则塞进 `framework/` 的通用层。
 *
 * @module @luckycat/dsh-bank-demo
 */

/** 演示数据里的一条账户。 */
export interface DemoAccount {
  id: string
  name: string
  /** 卡号后四位（演示数据里也只放尾号，不放完整卡号）。 */
  tail: string
  currency: string
  /** 余额（分）。 */
  balanceCents: number
}

/** 演示数据里的一条流水。 */
export interface DemoTransaction {
  id: string
  accountId: string
  /** 金额（分）；负数为支出。 */
  amountCents: number
  currency: string
  counterparty: string
  category: string
  /** ISO 8601 时刻。 */
  occurredAt: string
  memo: string
  channel: string
}

/** 演示数据里的一款理财产品。 */
export interface DemoWealthProduct {
  code: string
  name: string
  riskLevel: 'R1' | 'R2' | 'R3' | 'R4' | 'R5'
  /** 业绩比较基准（**不是**预期收益率）。 */
  benchmark: string
  minAmountCents: number
}

/** 本插件配置。 */
export interface BankDemoConfig {
  /** 演示用的账户与流水数据文件（JSON）的绝对路径。 */
  dataPath: string
  /** 单笔转账上限（分）。超过即拒绝——演示里不假装能转无限额。 */
  transferLimitCents?: number
  /** 触发"必须验支付密码"的金额门槛（分）。默认 0（即所有转账都要验）。 */
  verifyThresholdCents?: number
}
