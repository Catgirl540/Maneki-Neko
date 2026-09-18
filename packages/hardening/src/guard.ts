/**
 * 白名单守卫：**不在名单里的工具一律拒绝**。
 *
 * 为什么用白名单而不是黑名单：黑名单永远漏（新插件可以起任意工具名），
 * 而我们的框架口径是"业务 agent，只有它该有的工具"。白名单让"新增一个能力"
 * 变成一次**显式动作**（改配置），而不是默认放开。
 *
 * 这条守卫还要满足"单调性"：DSH 的 `ctx.tools.guard()` 保证
 * **后续监听者不能把已被拒绝的调用改成允许**——所以它是只收紧不放宽的那一层。
 *
 * 纯函数，离线可测。
 * @module @luckycat/dsh-hardening/guard
 */

/** 归一化后的白名单。 */
export function normalizeAllowList(allowedTools: readonly string[]): Set<string> {
  return new Set(allowedTools.map(tool => tool.trim()).filter(tool => tool !== ''))
}

/**
 * 生成"不给理由就拒绝"的模型可见理由。
 * 按 DSH 的约定，模型可见文案要从**模型视角**写：说清哪条不可用、该改用什么。
 * @param name - 被拒的工具名。
 * @param allowed - 当前白名单。
 * @returns 面向模型的拒绝理由。
 */
export function denialReason(name: string, allowed: ReadonlySet<string>): string {
  const list = [...allowed]
  const available = list.length === 0 ? '（无）' : list.join('、')
  return `Tool "${name}" is not enabled in this deployment. Available tools: ${available}. `
    + 'Do not retry it; use an available tool or tell the user the capability is not enabled.'
}

/**
 * 造一个白名单守卫。
 * @param allowedTools - 允许执行的工具名。
 * @returns 守卫函数：返回字符串即拒绝，返回 undefined 表示放行（交给后面的判定）。
 */
export function makeToolAllowListGuard(allowedTools: readonly string[]): (name: string) => string | undefined {
  const allowed = normalizeAllowList(allowedTools)
  if (allowed.size === 0) {
    // 空名单会让所有工具都不可用，属于配置错误，加载期就报出来。
    throw new Error('luckycat-hardening: allowedTools 不能为空（空名单会让所有工具都不可用）')
  }
  return (name: string) => allowed.has(name) ? undefined : denialReason(name, allowed)
}