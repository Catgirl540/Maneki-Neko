/**
 * 加固包的对外类型。本文件**只有类型**。
 * @module @luckycat/dsh-hardening/types
 */

/** 一条脱敏规则。 */
export interface RedactionRule {
  /** 规则标签，会出现在替换文本里（`[REDACTED:标签]`）。 */
  label: string
  /** 匹配用正则。 */
  pattern: RegExp
  /** 只替换该捕获组（用于"保留键名、只抹掉取值"的场景）；省略则替换整个匹配。 */
  group?: number
}

/** 加固插件配置。 */
export interface HardeningConfig {
  /** 允许执行的工具名**白名单**；不在名单里的一律拒绝（fail-closed）。 */
  allowedTools: string[]
  /** 需要按"实际取值"脱敏的环境变量名。取值在运行时读取，**不写进配置**。 */
  secretEnv?: string[]
  /** 额外的脱敏正则（字符串形式，便于写进 YAML）。 */
  extraPatterns?: string[]
  /** 是否给遥测导出挂脱敏规则（仅当部署挂了 telemetry 时才有意义）。默认 true。 */
  redactTelemetry?: boolean
}