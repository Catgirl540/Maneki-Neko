/**
 * 脱敏：把密钥类字符串从"将要落盘 / 将要发给模型的文本"里抹掉。
 *
 * 两类规则：
 * 1. **按取值**：配置里只写环境变量**名**，运行时读它的值来匹配。
 *    这样密钥的值永远不出现在配置、代码或日志里。
 * 2. **按形态**：内置若干常见密钥形态（`sk-…`、Bearer、赋值式、AWS、PEM）。
 *
 * 纯函数，离线可测。
 * @module @luckycat/dsh-hardening/redact
 */

import type { RedactionRule } from './types.ts'

/** 环境变量取值至少要有这么长才值得当密钥匹配，避免把 "1" 这种值当密钥。 */
const MIN_SECRET_VALUE_LENGTH = 8

/** 正则里的元字符转义（把环境变量的取值当字面量匹配）。 */
function escapeForRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 内置的"按形态"规则。 */
export const BUILT_IN_PATTERNS: readonly { label: string; source: string; flags: string; group?: number }[] = [
  // OpenAI / OpenRouter / 类似的 sk- 前缀密钥
  { label: 'sk-key', source: 'sk-[A-Za-z0-9_-]{16,}', flags: 'g' },
  // Authorization: Bearer xxx
  { label: 'bearer', source: '(?:Bearer|bearer)\\s+[A-Za-z0-9._~+/=-]{16,}', flags: 'g' },
  // api_key = "xxx" / token: xxx / password=xxx —— 保留键名，只抹掉取值
  {
    label: 'assigned-secret',
    source: '(?:api[_-]?key|secret|token|password|passwd|pwd)\\s*[:=]\\s*["\']?([A-Za-z0-9._~+/=-]{12,})',
    flags: 'gi',
    group: 1,
  },
  // AWS access key id
  { label: 'aws-key', source: 'AKIA[0-9A-Z]{16}', flags: 'g' },
  // PEM 私钥整块
  { label: 'pem-private-key', source: '-----BEGIN[^-]*PRIVATE KEY-----[\\s\\S]*?-----END[^-]*PRIVATE KEY-----', flags: 'g' },
]

/**
 * 造出这次运行要用的规则集合。
 * @param options - 额外正则（字符串）与要按取值脱敏的环境变量名。
 * @param env - 环境变量表（注入点，便于测试）。
 * @returns 规则数组：环境变量取值规则在前（更精确），再内置形态规则。
 */
export function buildRules(
  options: { extraPatterns?: readonly string[]; secretEnv?: readonly string[] } = {},
  env: Record<string, string | undefined> = process.env,
): RedactionRule[] {
  const rules: RedactionRule[] = []
  for (const name of options.secretEnv ?? []) {
    const value = env[name]
    if (value === undefined || value.length < MIN_SECRET_VALUE_LENGTH) continue
    rules.push({ label: `env:${name}`, pattern: new RegExp(escapeForRegExp(value), 'g') })
  }
  for (const source of options.extraPatterns ?? []) {
    rules.push({ label: 'custom', pattern: new RegExp(source, 'g') })
  }
  for (const builtIn of BUILT_IN_PATTERNS) {
    rules.push({
      label: builtIn.label,
      pattern: new RegExp(builtIn.source, builtIn.flags),
      ...builtIn.group === undefined ? {} : { group: builtIn.group },
    })
  }
  return rules
}

/** 脱敏结果。 */
export interface RedactionResult {
  /** 脱敏后的文本（没有命中时与入参相同）。 */
  text: string
  /** 命中的规则标签（去重、按首次出现顺序）。 */
  hits: readonly string[]
}

/**
 * 按规则抹掉文本里的密钥。
 * @param text - 原文。
 * @param rules - 规则集合。
 * @returns 脱敏后的文本与命中的标签。
 */
export function redactText(text: string, rules: readonly RedactionRule[]): RedactionResult {
  let current = text
  const hits: string[] = []
  for (const rule of rules) {
    // 每次都重置 lastIndex：正则是带 g 的有状态对象，跨调用复用会漏匹配。
    rule.pattern.lastIndex = 0
    if (!rule.pattern.test(current)) continue
    rule.pattern.lastIndex = 0
    let changed = false
    current = current.replace(rule.pattern, (...replaceArgs: unknown[]) => {
      changed = true
      if (rule.group === undefined) return `[REDACTED:${rule.label}]`
      // 保留匹配里除目标捕获组之外的部分，只把捕获组换成占位。
      const match = replaceArgs[0] as string
      const captured = replaceArgs[rule.group] as string | undefined
      if (captured === undefined) return match
      const at = match.indexOf(captured)
      if (at < 0) return `[REDACTED:${rule.label}]`
      return `${match.slice(0, at)}[REDACTED:${rule.label}]${match.slice(at + captured.length)}`
    })
    if (changed) hits.push(rule.label)
  }
  return { text: current, hits }
}

/** 深拷贝式脱敏：对 JSON 结构里所有字符串做脱敏。 */
export function redactDeep<T>(value: T, rules: readonly RedactionRule[], depth = 0): { value: T; hits: readonly string[] } {
  if (typeof value === 'string') {
    const result = redactText(value, rules)
    return { value: result.text as unknown as T, hits: result.hits }
  }
  // 深度上限：遥测记录是 JSON，正常不会很深；防御异常结构。
  if (depth > 12 || value === null || typeof value !== 'object') return { value, hits: [] }
  const hits: string[] = []
  if (Array.isArray(value)) {
    const next = value.map(entry => {
      const result = redactDeep(entry, rules, depth + 1)
      hits.push(...result.hits)
      return result.value
    })
    return { value: next as unknown as T, hits }
  }
  const source = value as Record<string, unknown>
  const next: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(source)) {
    const result = redactDeep(entry, rules, depth + 1)
    hits.push(...result.hits)
    next[key] = result.value
  }
  return { value: next as unknown as T, hits }
}